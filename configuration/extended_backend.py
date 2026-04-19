from spin.backend import Backend, Update, State, Reply, fixup_params
from spin.config import Device as ConfigDevice, Param
import asyncio
import os, json
import threading
import importlib
from urllib.parse import urlparse
import mlzlog
from spin import secop as spin_secop
from flask import Flask, jsonify, request
from flask_cors import CORS


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
        ExtendedBackend.latest_values[f'{self._name}.{param}'] = {
            'value': value,
            'unit': str(unit),
            'state': str(state),
            'state_str': str(state_str),
        }


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
        return None

    aliases = _build_device_aliases(device_name)
    devices = getattr(backend, '_devices', {})

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

    def add_runtime_secop_node(self, host, port, mod_list, para_map):
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
                        
                        # Store for API
                        try:
                          
                                ExtendedBackend.latest_values[key] = {
                                    "value": value,
                                    "unit": str(unit),
                                    "state": str(state),
                                    "state_str": str(state_str)
                                }
                        except Exception:
                            pass
                      
                        await self.send_update(update)
                       
                    except Exception as e:
                        self.log.warning(f"Failed to poll {devname}.{param}: {e}")
                 
            await asyncio.sleep(poll_interval)


    def start(self, conf, asset_list):
        # Add nodemanager protocol if missing, use correct module name
        self.protos['secop'] = 'configuration.extended_backend'
        if 'nodemanager' not in self.protos:
            self.protos['nodemanager'] = 'configuration.node_manager'
        super().start(conf, asset_list)

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
   
        return jsonify(ExtendedBackend.latest_values)

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
            addr = _resolve_device_addr(backend, device)
            if addr:
                return jsonify({'status': 'ok', 'addr': addr})
        except Exception:
            app.logger.exception('api_node_for_device lookup failed')

        return jsonify({'status': 'not_found'}), 404
   
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
            # Fallback: exit process after short delay so external supervisor restarts it
            def _delayed_exit():
                try:
                    import time
                    time.sleep(1.0)
                except Exception:
                    pass
                try:
                    os._exit(0)
                except Exception:
                    pass

            threading.Thread(target=_delayed_exit, daemon=True).start()
            
            return jsonify({'status': 'ok', 'method': 'process_exit'}), 202
        
        except Exception as e:
        
            app.logger.exception('api_restart failed')
            
            return jsonify({'status': 'error', 'error': str(e)}), 500
