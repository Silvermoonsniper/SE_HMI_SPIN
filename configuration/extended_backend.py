from spin.backend import Backend, Update, State, Reply, fixup_params
from spin.config import Device as ConfigDevice, Param
import asyncio
from collections import deque
import enum
import os, json
import sys
import threading
import time
import importlib
from urllib.parse import urlparse
import mlzlog
from spin import secop as spin_secop
from frappy.client import SecopClient
from frappy.lib.enum import EnumMember
from flask import Flask, jsonify, request
from flask_cors import CORS

from configuration.nexus_export import NexusRunExporter, inspect_export_object, list_export_files


def is_running_in_docker():
    return os.path.exists('/.dockerenv') or os.path.exists('/run/.containerenv')


def resolve_host(host):
    if not is_running_in_docker():
        return host
    if host not in ('localhost', '127.0.0.1'):
        return host
    return 'host.docker.internal'


class RuntimeSECNode(spin_secop.SECNode):
    def __init__(self, addr, log):
        super().__init__(addr, log)
        self._description = None

    async def _synchronize(self):
        self.log.info('connected to node')
        await self._send(b'*IDN?')
        proto = await self._receive()
        if ',SECoP,' not in proto:
            raise RuntimeError('not a SECoP node, IDN = {proto!r}')
        await self._send(b'describe')
        description_msg = await self._receive()
        _, _, description = self._decode(description_msg)
        self._description = description
        await self._set_units(description)
        self.log.info('waiting for initial updates')
        await self._send(b'activate')
        unseen = set(self.devices)
        while True:
            msg = self._decode(await self._receive())
            if msg[0] == 'active':
                break
            await self._handle_message(msg)
            unseen.discard(msg[1])
        if unseen:
            self.log.warning('not all initial updates from SEC node received (missing %s)', unseen)

    async def _set_units_for_device(self, device):
        if not self._description:
            return
        modules = self._description.get('modules', {})
        module = modules.get(device.device, {})
        accessibles = module.get('accessibles', {})
        for param in ['value', *(device.extra_params or [])]:
            if param == 'status':
                continue
            datainfo = accessibles.get(param, {}).get('datainfo')
            if datainfo:
                device.set_datainfo(param, datainfo)

    async def _activate_device(self, device):
        try:
            await self._set_units_for_device(device)
            await self._send(f'activate {device.device}'.encode())
        except Exception as exc:
            device.log.exception('failed to activate hot-added device: %r', exc)
            await device.send(State.ERROR, f'Could not activate device: {exc}')

    def add_device(self, device):
        super().add_device(device)
        if self.is_initialized:
            device.run_task(self._activate_device(device))


class Device(spin_secop.Device):
    _connclass = RuntimeSECNode

    async def update(self, action, ident, data):
        await super().update(action, ident, data)

        if action != 'update':
            return

        _, _, param = ident.partition(':')
        if not param:
            return

        value = self.cache.get(param)
        unit = getattr(self, '_units', {}).get(param, '') if hasattr(self, '_units') else ''
        state, state_str = self.cache.get('status', (State.UNKNOWN, ''))
        if hasattr(self, '_backend') and hasattr(self._backend, '_ensure_runtime_storage'):
            self._backend._ensure_runtime_storage()
            self._backend._record_latest_value(f'{self._name}.{param}', unit, state, state_str, value)
        else:
            ExtendedBackend.latest_values[f'{self._name}.{param}'] = {
                'value': _json_safe_value(value),
                'unit': str(unit),
                'state': str(state),
                'state_str': str(state_str),
            }


def _json_safe_value(value):
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, EnumMember):
        return value.value
    if isinstance(value, dict):
        return {str(_json_safe_value(key)): _json_safe_value(val) for key, val in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe_value(item) for item in value]
    return value


def _build_device_aliases(device_name):
    aliases = set()
    if not device_name:
        return aliases

    aliases.add(device_name)

    parts = [part for part in str(device_name).split('_') if part]
    for index in range(len(parts)):
        aliases.add('_'.join(parts[index:]))

    try:
        json_path = os.path.join(os.path.dirname(__file__), 'device_params.json')
        with open(json_path, 'r') as handle:
            device_params = json.load(handle)
        info = device_params.get(device_name) or {}
        for field in ('module_name', 'original_name'):
            value = info.get(field)
            if value:
                aliases.add(value)
    except Exception:
        pass

    return {alias for alias in aliases if alias}


def _resolve_device_addr(backend, device_name):
    if not backend or not hasattr(backend, '_devices'):
        runtime_addrs = getattr(backend, '_runtime_device_addrs', {}) if backend else {}
        return runtime_addrs.get(device_name)

    runtime_addrs = getattr(backend, '_runtime_device_addrs', {})
    if device_name in runtime_addrs:
        return runtime_addrs[device_name]

    aliases = _build_device_aliases(device_name)
    devices = getattr(backend, '_devices', {})

    for alias in aliases:
        addr = runtime_addrs.get(alias)
        if addr:
            return addr

    for alias in aliases:
        dev_obj = devices.get(alias)
        if dev_obj and hasattr(dev_obj, '_conn') and getattr(dev_obj._conn, 'addr', None):
            return dev_obj._conn.addr

    for key, dev_obj in devices.items():
        try:
            module_name = getattr(dev_obj, 'device', None)
            names_to_check = {key, module_name}
            if any(name and (name in aliases or any(name.endswith(alias) for alias in aliases)) for name in names_to_check):
                if hasattr(dev_obj, '_conn') and getattr(dev_obj._conn, 'addr', None):
                    return dev_obj._conn.addr
        except Exception:
            continue

    return None

"""
an extended backend to poll all device parameters to port 8001 every poll_interval
for frontend spin updates
"""
class ExtendedBackend(Backend):
    # Store latest values for API
    latest_values = {}

    def _ensure_runtime_storage(self):
        if not hasattr(self, '_runtime_node_configs'):
            self._runtime_node_configs = {}
        if not hasattr(self, '_runtime_node_tasks'):
            self._runtime_node_tasks = {}
        if not hasattr(self, '_runtime_device_addrs'):
            self._runtime_device_addrs = {}
        if not hasattr(self, '_plot_history'):
            self._plot_history = {}
        if not hasattr(self, '_plot_history_lock'):
            self._plot_history_lock = threading.Lock()
        if not hasattr(self, '_plot_history_limit'):
            self._plot_history_limit = 7200
        if not hasattr(self, '_nexus_exporter'):
            self._nexus_exporter = NexusRunExporter()

    def _append_plot_history_sample(self, key, payload, timestamp_ms):
        self._ensure_runtime_storage()

        sample = {
            'timestamp_ms': int(timestamp_ms),
            'value': payload.get('value'),
            'unit': payload.get('unit', ''),
            'state': payload.get('state', ''),
            'state_str': payload.get('state_str', ''),
        }

        with self._plot_history_lock:
            history = self._plot_history.get(key)
            if history is None:
                history = deque(maxlen=self._plot_history_limit)
                self._plot_history[key] = history
            history.append(sample)

    def _record_latest_value(self, key, unit, state, state_str, value):
        safe_value = _json_safe_value(value)
        timestamp_ms = int(time.time() * 1000)
        payload = {
            'value': safe_value,
            'unit': str(unit),
            'state': str(state),
            'state_str': str(state_str),
        }
        ExtendedBackend.latest_values[key] = payload
        self._append_plot_history_sample(key, payload, timestamp_ms)
        if hasattr(self, '_nexus_exporter') and self._nexus_exporter.is_running:
            try:
                self._nexus_exporter.append_update(key, payload)
            except Exception as exc:
                self.log.warning(f'Failed to append NeXus export for {key}: {exc}')
        return safe_value, payload

    def get_plot_updates(self, since_ms=None):
        self._ensure_runtime_storage()
        server_time_ms = int(time.time() * 1000)

        if not since_ms or since_ms <= 0:
            snapshot = {}
            for key, payload in ExtendedBackend.latest_values.items():
                snapshot[key] = {
                    'timestamp_ms': server_time_ms,
                    'value': payload.get('value'),
                    'unit': payload.get('unit', ''),
                    'state': payload.get('state', ''),
                    'state_str': payload.get('state_str', ''),
                }
            return {
                'mode': 'snapshot',
                'server_time_ms': server_time_ms,
                'values': snapshot,
            }

        with self._plot_history_lock:
            samples = {}
            for key, history in self._plot_history.items():
                pending = [sample.copy() for sample in history if sample.get('timestamp_ms', 0) > since_ms]
                if pending:
                    samples[key] = pending

        return {
            'mode': 'history',
            'server_time_ms': server_time_ms,
            'samples': samples,
        }

    def _recover_runtime_nodes_from_files(self):
        self._ensure_runtime_storage()

        device_params_path = os.path.join(os.path.dirname(__file__), 'device_params.json')
        nodes_path = os.path.join(os.path.dirname(__file__), 'nodes.json')

        try:
            with open(device_params_path, 'r') as handle:
                device_params = json.load(handle)
        except Exception:
            return

        candidate_devices = {
            name for name in device_params.keys()
            if name not in getattr(self, '_devices', {}) and name not in self._runtime_device_addrs
        }
        if not candidate_devices:
            return

        try:
            with open(nodes_path, 'r') as handle:
                nodes = json.load(handle)
        except Exception:
            return

        try:
            from configuration.node_manager import connect_and_fetch_params
        except Exception as exc:
            self.log.warning(f'Failed to import runtime node recovery helper: {exc}')
            return

        for node in nodes or []:
            if not candidate_devices:
                break

            host = node.get('host')
            port = node.get('port')
            if not host or not port:
                continue

            try:
                mod_list, para_map, dev_data = connect_and_fetch_params(host, port)
            except Exception:
                continue

            filtered_mod_list = [(original_name, unique_name) for original_name, unique_name in mod_list or [] if unique_name in candidate_devices]
            if not filtered_mod_list:
                continue

            filtered_dev_data = {name: (dev_data or {}).get(name, {}) for _, name in filtered_mod_list}
            self.register_runtime_secop_node(host, port, filtered_mod_list, filtered_dev_data)

            for _, unique_name in filtered_mod_list:
                candidate_devices.discard(unique_name)

    def _create_runtime_device(self, name, device_conf):
        parsed = urlparse(device_conf.device)
        if parsed.scheme not in self.protos:
            raise ValueError(f'{device_conf.device}: unknown protocol')

        fixup_params(device_conf)
        devcls = self.protos[parsed.scheme]
        if isinstance(devcls, str):
            devcls = importlib.import_module(devcls).Device

        log = mlzlog.getLogger(parsed.scheme).getChild(name)
        dev = devcls(name, device_conf, parsed, self, log)
        self._devices[name] = dev
        dev.init()
        return dev

    def add_runtime_secop_node(self, host, port, mod_list, para_map, device_data=None):
        if device_data:
            self.register_runtime_secop_node(host, port, mod_list, device_data)

            resolved_host = resolve_host(host)
            addr = f"{resolved_host}:{port}"

            async def _prime_once():
                try:
                    snapshot_updates = await asyncio.to_thread(self._collect_runtime_snapshot, addr)
                    if snapshot_updates:
                        await self._publish_runtime_snapshot(snapshot_updates)
                except Exception as exc:
                    self.log.warning(f'Failed to publish runtime snapshot for {addr}: {exc}')

            self.run_task(_prime_once())

        resolved_host = resolve_host(host)
        url = f"{resolved_host}:{port}"
        added = []

        for original_name, unique_name in mod_list or []:
            if unique_name in self._devices:
                continue

            params = [Param(para_name) for para_name in para_map.get(unique_name, [])]
            device_conf = ConfigDevice(
                f"secop://{url}/{original_name}",
                pollinterval=1.0,
                params=params,
            )
            dev = self._create_runtime_device(unique_name, device_conf)
            dev.all_params = para_map.get(unique_name, [])
            added.append(unique_name)

        return added

    def register_runtime_secop_node(self, host, port, mod_list, device_data, poll_interval=2.0):
        self._ensure_runtime_storage()

        resolved_host = resolve_host(host)
        addr = f"{resolved_host}:{port}"
        node_cfg = self._runtime_node_configs.setdefault(addr, {'devices': {}, 'poll_interval': poll_interval})
        node_cfg['poll_interval'] = poll_interval

        for original_name, unique_name in mod_list or []:
            info = (device_data or {}).get(unique_name) or {}
            node_cfg['devices'][unique_name] = {
                'module': original_name,
                'info': info,
            }
            self._runtime_device_addrs[unique_name] = addr

        if addr not in self._runtime_node_tasks:
            task = self._loop.create_task(self._poll_runtime_node(addr))
            self._runtime_node_tasks[addr] = task
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    async def _publish_runtime_snapshot(self, snapshot_updates):
        for key, unit, state, state_str, value, is_main in snapshot_updates:
            safe_value, _ = self._record_latest_value(key, unit, state, state_str, value)
            await self.send_update(Update(key, unit, state, state_str, safe_value))
            if is_main:
                device_name = key.split('.', 1)[0]
                await self.send_update(Update(device_name, unit, state, state_str, safe_value))

    def refresh_runtime_latest_values(self):
        self._recover_runtime_nodes_from_files()
        runtime_nodes = list(getattr(self, '_runtime_node_configs', {}).keys())
        for addr in runtime_nodes:
            try:
                snapshot_updates = self._collect_runtime_snapshot(addr)
            except Exception as exc:
                self.log.warning(f'Failed to refresh runtime node {addr}: {exc}')
                continue

            for key, unit, state, state_str, value, _ in snapshot_updates:
                self._record_latest_value(key, unit, state, state_str, value)

    def _collect_runtime_snapshot(self, addr):
        node_cfg = getattr(self, '_runtime_node_configs', {}).get(addr)
        if not node_cfg:
            return []

        client = SecopClient(addr)
        client.connect()
        updates = []

        for unique_name, cfg in node_cfg['devices'].items():
            module = cfg['module']
            info = cfg['info'] or {}
            accessibles = info.get('accessibles') or {}
            commands = set(info.get('commands') or [])

            status_value = None
            status_state = State.OK
            status_state_str = ''
            if 'status' in (info.get('all_params') or []):
                try:
                    status_item = client.readParameter(module, 'status')
                    status_value = getattr(status_item, 'value', status_item)
                    status_state, status_state_str = spin_secop.to_state(status_value)
                except Exception as exc:
                    status_value = None
                    status_state = State.ERROR
                    status_state_str = str(exc)
                updates.append((f'{unique_name}.status', '', status_state, status_state_str, status_value, False))

            for param_name in info.get('all_params') or []:
                if param_name in commands or param_name == 'status':
                    continue

                unit = str(accessibles.get(param_name, {}).get('datainfo', {}).get('unit', ''))
                try:
                    item = client.readParameter(module, param_name)
                    value = getattr(item, 'value', item)
                    state, state_str = status_state, status_state_str
                except Exception as exc:
                    value = None
                    state = State.ERROR
                    state_str = str(exc)

                updates.append((f'{unique_name}.{param_name}', unit, state, state_str, value, param_name == 'value'))

        return updates

    async def _poll_runtime_node(self, addr):
        while True:
            try:
                snapshot_updates = await asyncio.to_thread(self._collect_runtime_snapshot, addr)
                if snapshot_updates:
                    await self._publish_runtime_snapshot(snapshot_updates)
            except Exception as exc:
                self.log.warning(f'Failed to poll runtime node {addr}: {exc}')

            node_cfg = getattr(self, '_runtime_node_configs', {}).get(addr) or {}
            await asyncio.sleep(node_cfg.get('poll_interval', 2.0))

    def prime_runtime_secop_node(self, host, port, mod_list, device_data):
        self.register_runtime_secop_node(host, port, mod_list, device_data)

        resolved_host = resolve_host(host)
        addr = f"{resolved_host}:{port}"

        async def _prime_once():
            try:
                snapshot_updates = await asyncio.to_thread(self._collect_runtime_snapshot, addr)
                if snapshot_updates:
                    await self._publish_runtime_snapshot(snapshot_updates)
            except Exception as exc:
                self.log.warning(f'Failed to prime runtime node {addr}: {exc}')

        self.run_task(_prime_once())
    
    async def poll_all_parameters(self, poll_interval=2):
       
        while True:
            for devname, dev in list(self._devices.items()):
               

                all_params = getattr(dev, 'all_params', None)
                
                if all_params is None and hasattr(dev, 'params'):
          
                    all_params = [p.name if hasattr(p, 'name') else p for p in dev.params]
          
                if not all_params:
          
                    continue
                
                for param in all_params:
          
                    try:
                       
                        value = dev.cache.get(param)
          
                        unit = getattr(value, 'unit', '')
                        
                        state = getattr(value, 'state', State.OK)
                        
                        state_str = getattr(value, 'state_str', '')
                        
                        val = getattr(value, 'value', value)
                        
                        key = f"{devname}.{param}"

                        update = Update(key, unit, state, state_str, val)
                        try:
                            short = repr(val)
                            if len(short) > 160:
                                short = short[:160] + '...'
                           
                        except Exception:
                            pass
                        
                        safe_val, _ = self._record_latest_value(key, unit, state, state_str, val)
                      
                        await self.send_update(Update(key, unit, state, state_str, safe_val))
                       
                    except Exception as e:
                        self.log.warning(f"Failed to poll {devname}.{param}: {e}")
                 
            await asyncio.sleep(poll_interval)


    def start(self, conf, asset_list):
        # Add nodemanager protocol if missing, use correct module name
        self.protos['secop'] = 'configuration.extended_backend'
        if 'nodemanager' not in self.protos:
            self.protos['nodemanager'] = 'configuration.node_manager'
        super().start(conf, asset_list)
        self._ensure_runtime_storage()

    # Set all_params for each device from device_params.json
       
        json_path = os.path.join(os.path.dirname(__file__), 'device_params.json')
       
        try:
            
            with open(json_path, 'r') as f:
   
                device_data = json.load(f)
   
            for devname, dev in self._devices.items():
   
                all_params = device_data.get(devname, {}).get('all_params', None)
   
                if all_params:
   
                    dev.all_params = all_params
                   
        except Exception as e:
   
            print(f"[ExtendedBackend] Could not set all_params from device_params.json: {e}")

        self.run_task(self.poll_all_parameters())
        # Start Flask API server for latest values in a thread, pass self so
        # the API can inspect device->connection mappings.
        start_api_server(self)




def start_api_server(backend=None):
   
    app = Flask(__name__)
   
    CORS(app)
   
    @app.route('/api/latest_values')
   
    def get_latest_values():
        if backend and hasattr(backend, 'refresh_runtime_latest_values'):
            backend.refresh_runtime_latest_values()

        return jsonify(_json_safe_value(ExtendedBackend.latest_values))

    @app.route('/api/plot_updates')
    def get_plot_updates():
        if backend and hasattr(backend, 'refresh_runtime_latest_values'):
            backend.refresh_runtime_latest_values()

        since_raw = request.args.get('since')
        try:
            since_ms = int(since_raw) if since_raw not in (None, '') else None
        except (TypeError, ValueError):
            since_ms = None

        if backend and hasattr(backend, 'get_plot_updates'):
            payload = backend.get_plot_updates(since_ms)
        else:
            server_time_ms = int(time.time() * 1000)
            payload = {
                'mode': 'snapshot',
                'server_time_ms': server_time_ms,
                'values': {
                    key: {
                        'timestamp_ms': server_time_ms,
                        'value': value.get('value') if isinstance(value, dict) else value,
                        'unit': value.get('unit', '') if isinstance(value, dict) else '',
                        'state': value.get('state', '') if isinstance(value, dict) else '',
                        'state_str': value.get('state_str', '') if isinstance(value, dict) else '',
                    }
                    for key, value in ExtendedBackend.latest_values.items()
                },
            }

        payload['status'] = 'ok'
        return jsonify(_json_safe_value(payload))

    @app.route('/api/nexus_export/status', methods=['GET'])
    def api_nexus_export_status():
        try:
            if backend and hasattr(backend, '_ensure_runtime_storage'):
                backend._ensure_runtime_storage()
            status = backend._nexus_exporter.status() if backend and hasattr(backend, '_nexus_exporter') else {
                'running': False,
                'file_path': None,
                'run_name': None,
                'start_time': None,
            }
            return jsonify({'status': 'ok', 'export': status})
        except Exception as exc:
            app.logger.exception('api_nexus_export_status failed')
            return jsonify({'status': 'error', 'error': str(exc)}), 500

    @app.route('/api/nexus_export/files', methods=['GET'])
    def api_nexus_export_files():
        try:
            return jsonify({'status': 'ok', 'files': list_export_files()})
        except Exception as exc:
            app.logger.exception('api_nexus_export_files failed')
            return jsonify({'status': 'error', 'error': str(exc)}), 500

    @app.route('/api/nexus_export/inspect', methods=['GET'])
    def api_nexus_export_inspect():
        file_name = request.args.get('file')
        object_path = request.args.get('path') or '/'
        if not file_name:
            return jsonify({'status': 'error', 'error': 'missing file'}), 400

        try:
            payload = inspect_export_object(file_name, object_path)
            return jsonify({'status': 'ok', 'node': payload})
        except FileNotFoundError:
            return jsonify({'status': 'not_found'}), 404
        except KeyError:
            return jsonify({'status': 'not_found'}), 404
        except Exception as exc:
            app.logger.exception('api_nexus_export_inspect failed')
            return jsonify({'status': 'error', 'error': str(exc)}), 500

    @app.route('/api/nexus_export/start', methods=['POST'])
    def api_nexus_export_start():
        try:
            if not backend:
                return jsonify({'status': 'error', 'error': 'backend unavailable'}), 500
            backend._ensure_runtime_storage()
            data = request.get_json(force=False, silent=True) or {}
            run_name = data.get('run_name')
            file_path = backend._nexus_exporter.start(run_name)
            return jsonify({'status': 'ok', 'file_path': file_path, 'export': backend._nexus_exporter.status()})
        except Exception as exc:
            app.logger.exception('api_nexus_export_start failed')
            return jsonify({'status': 'error', 'error': str(exc)}), 500

    @app.route('/api/nexus_export/stop', methods=['POST'])
    def api_nexus_export_stop():
        try:
            if not backend:
                return jsonify({'status': 'error', 'error': 'backend unavailable'}), 500
            backend._ensure_runtime_storage()
            file_path = backend._nexus_exporter.stop()
            return jsonify({'status': 'ok', 'file_path': file_path, 'export': backend._nexus_exporter.status()})
        except Exception as exc:
            app.logger.exception('api_nexus_export_stop failed')
            return jsonify({'status': 'error', 'error': str(exc)}), 500

    @app.route('/api/node_for_device', methods=['GET', 'POST'])
    def api_node_for_device():
        """Return the node addr (host:port) responsible for the given device.

        Accepts JSON { device: '<device_name>' } or query param ?device=...
        """
        # read device from JSON body or query string
        data = None
        try:
            data = request.get_json(force=False, silent=True) or {}
        except Exception:
            data = {}
        device = data.get('device') or request.args.get('device')
        if not device:
            return jsonify({'status': 'error', 'error': 'missing device'}), 400

        try:
            if backend and hasattr(backend, '_recover_runtime_nodes_from_files'):
                backend._recover_runtime_nodes_from_files()
            addr = _resolve_device_addr(backend, device)
            if addr:
                return jsonify({'status': 'ok', 'addr': addr})
        except Exception:
            app.logger.exception('api_node_for_device lookup failed')

        return jsonify({'status': 'not_found'}), 404

    @app.route('/api/plot_configs', methods=['GET'])
    def api_plot_configs():
        plot_config_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'plot_config'))
        try:
            names = []
            if os.path.isdir(plot_config_dir):
                for fname in os.listdir(plot_config_dir):
                    if fname.endswith('.json'):
                        names.append(fname[:-5])
            return jsonify({'status': 'ok', 'names': sorted(names)})
        except Exception as exc:
            app.logger.exception('api_plot_configs failed')
            return jsonify({'status': 'error', 'error': str(exc)}), 500

    @app.route('/api/plot_configs/<path:name>', methods=['GET'])
    def api_plot_config(name):
        plot_config_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'plot_config'))
        safe_name = os.path.basename(name)
        file_path = os.path.join(plot_config_dir, safe_name + '.json')
        try:
            if not os.path.exists(file_path):
                return jsonify({'status': 'not_found'}), 404
            with open(file_path, 'r') as handle:
                config = json.load(handle)
            if isinstance(config, dict) and 'name' not in config:
                config['name'] = safe_name
            return jsonify({'status': 'ok', 'config': config})
        except Exception as exc:
            app.logger.exception('api_plot_config failed')
            return jsonify({'status': 'error', 'error': str(exc)}), 500
   
    threading.Thread(target=lambda: app.run(host='0.0.0.0', port=8001, debug=False), daemon=True).start()

    # POST endpoint to send a raw SECoP line (or any line-based TCP command)
    @app.route('/api/send_request', methods=['POST'])
    def api_send_request():
        """Accept JSON { host, port, command } and send the raw line to the node.

        Uses spin.utils.StreamConnection to open a socket and send the line.
        Returns JSON with the (optional) response line.
        """
        data = request.get_json(force=True, silent=True) or {}
        host = data.get('host')
        port = data.get('port')
        addr = data.get('addr')
        cmd = data.get('command') or data.get('cmd') or data.get('line')

        if not addr:
            if host and port:
                addr = f"{host}:{port}"

        if not addr or not cmd:
            return jsonify({'status': 'error', 'error': 'missing addr or command'}), 400

        # Import here to avoid circular imports at module import time
        try:
            from spin.utils import StreamConnection
        except Exception as e:
            app.logger.exception('Failed to import StreamConnection')
            return jsonify({'status': 'error', 'error': str(e)}), 500

        async def _send_and_recv(a, line):
            conn = StreamConnection(a, app.logger)
            # open connection and send line (StreamConnection expects bytes)
            await conn._open_connection()
            await conn._send(line.encode() if isinstance(line, str) else line)
            # attempt to read one line response with timeout
            try:
                resp = await asyncio.wait_for(conn._receive(), timeout=3.0)
            except asyncio.TimeoutError:
                resp = ''
            try:
                # close writer if possible
                if conn.conn_write:
                    conn.conn_write.close()
                    await conn.conn_write.wait_closed()
            except Exception:
                pass
            return resp

        try:
            response = asyncio.run(_send_and_recv(addr, cmd))
            return jsonify({'status': 'sent', 'response': response})
        except Exception as e:
            app.logger.exception('api_send_request failed')
            return jsonify({'status': 'error', 'error': str(e)}), 500

    @app.route('/api/restart', methods=['POST'])
    def api_restart():
        """Request the backend to restart. If a nodemanager device is present it
        will schedule its _delayed_restart coroutine. Otherwise the process will
        exit after a short delay to allow container restart policies to bring it up.
        """
        try:
            # Prefer nodemanager-controlled restart if available
            if backend and hasattr(backend, '_devices') and 'nodemanager' in backend._devices:
                nm = backend._devices.get('nodemanager')
                try:
                    # Schedule the node manager's delayed restart task
                    nm.run_task(nm._delayed_restart())
                    return jsonify({'status': 'ok', 'method': 'nodemanager'}), 202
                except Exception:
                    app.logger.exception('Failed to schedule nodemanager restart')
            # Fallback: restart the current process directly.
            def _delayed_restart_process():
                try:
                    import time
                    time.sleep(1.0)
                except Exception:
                    pass
                try:
                    os.execv(sys.executable, [sys.executable] + sys.argv)
                except Exception:
                    os._exit(0)

            threading.Thread(target=_delayed_restart_process, daemon=True).start()
            
            return jsonify({'status': 'ok', 'method': 'process_restart'}), 202
        
        except Exception as e:
        
            app.logger.exception('api_restart failed')
            
            return jsonify({'status': 'error', 'error': str(e)}), 500
