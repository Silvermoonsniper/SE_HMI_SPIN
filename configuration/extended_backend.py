from spin.backend import Backend, Update, State, Reply, fixup_params
from spin.config import Device as ConfigDevice, Param
import asyncio
from collections import deque
import csv
from datetime import datetime, timezone
import enum
import os, json
import psycopg
import socket
import shutil
import shutil
import sys
import threading
import time
import importlib
from urllib.parse import quote, urlparse
import mlzlog
from spin import secop as spin_secop
from spin.utils import extract_addr
from frappy.client import SecopClient
from frappy.lib.enum import EnumMember
from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.serving import make_server
from functools import wraps

from configuration.nexus_export import NexusRunExporter, inspect_export_object, list_export_files


DATA_EXPORT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data_exports'))
DEFAULT_POSTGRES_STORAGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'postgres_data'))
ASSETS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), 'assets'))
SECOP_STREAM_READER_LIMIT = 10 * 1024 * 1024


def _split_csv_env(name):
    raw_value = str(os.environ.get(name, '') or '').strip()
    if not raw_value:
        return []
    return [item.strip() for item in raw_value.split(',') if item.strip()]


def _cors_origins_config():
    return '*'


def _api_auth_token():
    return str(os.environ.get('SPIN_API_AUTH_TOKEN', '') or '').strip()


def _is_loopback_host(host):
    normalized = str(host or '').strip().lower()
    return normalized in {'127.0.0.1', 'localhost', '::1'}


def _is_private_ipv4(host):
    parts = str(host or '').split('.')
    if len(parts) != 4:
        return False
    try:
        octets = [int(part) for part in parts]
    except ValueError:
        return False
    if any(octet < 0 or octet > 255 for octet in octets):
        return False

    first, second = octets[0], octets[1]
    if first == 10:
        return True
    if first == 172 and 16 <= second <= 31:
        return True
    if first == 192 and second == 168:
        return True
    return False

def _require_api_auth():
    def decorator(view_func):
        @wraps(view_func)
        def wrapped(*args, **kwargs):
            return view_func(*args, **kwargs)

        return wrapped

    return decorator


def _read_json_body(required=False):
    data = request.get_json(force=False, silent=True)
    if data is None:
        if required:
            return None, (jsonify({'status': 'error', 'error': 'invalid or missing JSON body'}), 400)
        return {}, None
    if not isinstance(data, dict):
        return None, (jsonify({'status': 'error', 'error': 'JSON body must be an object'}), 400)
    return data, None


def _parse_positive_float(value, default_value):
    if value in (None, ''):
        return float(default_value)
    parsed = float(value)
    if parsed <= 0:
        raise ValueError('value must be greater than 0')
    return parsed


def _parse_addr_payload(data, backend=None):
    addr = str(data.get('addr') or '').strip()
    if addr:
        try:
            host, port_raw = addr.rsplit(':', 1)
        except ValueError:
            raise ValueError('addr must be in host:port format')
    else:
        host = str(data.get('host') or '').strip()
        port_raw = data.get('port')

    if not host or port_raw in (None, ''):
        raise ValueError('missing addr or command target')

    try:
        port = int(port_raw)
    except (TypeError, ValueError):
        raise ValueError('port must be an integer')

    if port < 1 or port > 65535:
        raise ValueError('port must be between 1 and 65535')

    return f'{host}:{port}'


def ensure_data_export_dir():
    try:
        os.makedirs(DATA_EXPORT_DIR, exist_ok=True)
    except Exception as exc:
        print(f'Failed to create data export dir {DATA_EXPORT_DIR}: {exc}')


def _read_plot_history_limit():
    raw_value = str(os.environ.get('PLOT_HISTORY_LIMIT', '')).strip()
    if not raw_value:
        return None
    try:
        parsed = int(raw_value)
    except Exception:
        return None
    return parsed if parsed > 0 else None


def _storage_alert_thresholds():
    def _safe_percent(name, fallback):
        raw_value = os.environ.get(name, fallback)
        try:
            value = float(raw_value)
        except Exception:
            value = float(fallback)
        return max(1.0, min(value, 99.9))

    warn_percent = _safe_percent('STORAGE_ALERT_WARN_PERCENT', 85)
    critical_percent = _safe_percent('STORAGE_ALERT_CRITICAL_PERCENT', 95)
    if critical_percent <= warn_percent:
        critical_percent = min(99.9, warn_percent + 5.0)
    return warn_percent, critical_percent


def resolve_storage_monitor_path():
    configured_path = str(os.environ.get('STORAGE_MONITOR_PATH') or os.environ.get('POSTGRES_STORAGE_PATH') or '').strip()
    if configured_path:
        return os.path.abspath(configured_path)
    if is_running_in_docker():
        return '/app/postgres_data'
    return DEFAULT_POSTGRES_STORAGE_DIR


def get_storage_monitor_status(backend=None):
    monitor_path = resolve_storage_monitor_path()
    if not os.path.exists(monitor_path):
        monitor_path = DATA_EXPORT_DIR if os.path.exists(DATA_EXPORT_DIR) else os.path.abspath(os.path.dirname(__file__))

    usage = shutil.disk_usage(monitor_path)
    used_percent = (float(usage.used) / float(usage.total) * 100.0) if usage.total else 0.0
    warn_percent, critical_percent = _storage_alert_thresholds()
    level = 'normal'
    if used_percent >= critical_percent:
        level = 'critical'
    elif used_percent >= warn_percent:
        level = 'warning'

    database_bytes = None
    if backend and hasattr(backend, '_open_history_db_connection'):
        try:
            with backend._open_history_db_connection() as connection:
                row = connection.execute(
                    'SELECT pg_database_size(current_database())'
                ).fetchone()
            database_bytes = int(row[0]) if row and row[0] is not None else None
        except Exception:
            database_bytes = None

    return {
        'monitor_path': monitor_path,
        'filesystem_total_bytes': int(usage.total),
        'filesystem_used_bytes': int(usage.used),
        'filesystem_free_bytes': int(usage.free),
        'filesystem_used_percent': round(used_percent, 2),
        'warning_percent': warn_percent,
        'critical_percent': critical_percent,
        'level': level,
        'database_bytes': database_bytes,
    }


class CsvDataSaver:
    def __init__(self, backend):
        self._backend = backend
        self._lock = threading.Lock()
        self._thread = None
        self._stop_event = threading.Event()
        self._is_running = False
        self._file_path = None
        self._directory = None
        self._file_name = None
        self._interval_seconds = 10.0
        self._started_at_ms = None
        self._last_write_ms = None
        self._write_cycles = 0
        self._header_keys = []

    def _resolve_file_path(self, directory, file_name):
        ensure_data_export_dir()
        raw_directory = str(directory or '').strip()
        if not raw_directory:
            target_directory = DATA_EXPORT_DIR
        elif os.path.isabs(raw_directory):
            target_directory = raw_directory
        else:
            target_directory = os.path.abspath(os.path.join(DATA_EXPORT_DIR, raw_directory))

        os.makedirs(target_directory, exist_ok=True)

        raw_file_name = str(file_name or '').strip() or f"data_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        if not raw_file_name.lower().endswith('.csv'):
            raw_file_name += '.csv'

        safe_file_name = os.path.basename(raw_file_name)
        if not safe_file_name:
            raise ValueError('invalid CSV file name')

        return target_directory, safe_file_name, os.path.join(target_directory, safe_file_name)

    def _format_csv_value(self, value):
        if value is None:
            return ''
        safe_value = _json_safe_value(value)
        if isinstance(safe_value, (str, int, float)):
            return safe_value
        if isinstance(safe_value, bool):
            return 'true' if safe_value else 'false'
        return json.dumps(safe_value)

    def _snapshot_latest_values(self):
        snapshot_timestamp_ms = int(time.time() * 1000)
        values_by_key = {}
        for key, payload in list(ExtendedBackend.latest_values.items()):
            if not isinstance(payload, dict):
                payload = {'value': payload}
            values_by_key[key] = self._format_csv_value(payload.get('value'))
        return snapshot_timestamp_ms, values_by_key

    def _rewrite_with_headers(self, header_keys):
        fieldnames = ['timestamp_iso', 'timestamp_ms', *header_keys]
        existing_rows = []
        if self._file_path and os.path.exists(self._file_path) and os.path.getsize(self._file_path) > 0:
            with open(self._file_path, 'r', newline='') as handle:
                reader = csv.DictReader(handle)
                existing_rows = list(reader)

        with open(self._file_path, 'w', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in existing_rows:
                writer.writerow({field: row.get(field, '') for field in fieldnames})

    def _writer_loop(self):
        try:
            while not self._stop_event.is_set():
                snapshot_timestamp_ms, values_by_key = self._snapshot_latest_values()
                if values_by_key and self._file_path:
                    header_keys = sorted(values_by_key.keys())
                    if header_keys != self._header_keys:
                        self._rewrite_with_headers(header_keys)
                        self._header_keys = header_keys

                    row = {
                        'timestamp_iso': datetime.fromtimestamp(snapshot_timestamp_ms / 1000, tz=timezone.utc).isoformat(),
                        'timestamp_ms': snapshot_timestamp_ms,
                    }
                    for key in self._header_keys:
                        row[key] = values_by_key.get(key, '')

                    with open(self._file_path, 'a', newline='') as handle:
                        writer = csv.DictWriter(handle, fieldnames=['timestamp_iso', 'timestamp_ms', *self._header_keys])
                        writer.writerow(row)
                    with self._lock:
                        self._last_write_ms = snapshot_timestamp_ms
                        self._write_cycles += 1

                if self._stop_event.wait(self._interval_seconds):
                    break
        except Exception as exc:
            try:
                if getattr(self._backend, 'log', None):
                    self._backend.log.warning(f'CSV data saver stopped after error: {exc}')
            except Exception:
                pass
        finally:
            with self._lock:
                self._is_running = False
                self._thread = None

    def start(self, directory=None, file_name=None, interval_seconds=10):
        with self._lock:
            if self._is_running:
                raise RuntimeError('CSV data saving is already running')

            safe_interval = float(interval_seconds or 10)
            if safe_interval <= 0:
                raise ValueError('interval_seconds must be greater than 0')

            target_directory, safe_file_name, file_path = self._resolve_file_path(directory, file_name)
            self._stop_event = threading.Event()
            self._directory = target_directory
            self._file_name = safe_file_name
            self._file_path = file_path
            self._interval_seconds = safe_interval
            self._started_at_ms = int(time.time() * 1000)
            self._last_write_ms = None
            self._write_cycles = 0
            self._header_keys = []
            self._is_running = True
            self._thread = threading.Thread(target=self._writer_loop, name='csv-data-saver', daemon=True)
            self._thread.start()
            return self._file_path

    def stop(self):
        with self._lock:
            if not self._is_running:
                return self._file_path
            self._stop_event.set()
            thread = self._thread

        if thread is not None:
            thread.join(timeout=2.0)

        with self._lock:
            self._is_running = False
            self._thread = None
            return self._file_path

    def status(self):
        with self._lock:
            return {
                'running': bool(self._is_running),
                'file_path': self._file_path,
                'directory': self._directory,
                'file_name': self._file_name,
                'interval_seconds': self._interval_seconds,
                'start_time_ms': self._started_at_ms,
                'last_write_ms': self._last_write_ms,
                'write_cycles': self._write_cycles,
                'default_directory': DATA_EXPORT_DIR,
            }


def _history_db_connection_settings():
    database_url = os.environ.get('HISTORY_DATABASE_URL') or os.environ.get('POSTGRES_URL')
    if database_url:
        return {
            'dsn': database_url,
            'backend': 'postgresql',
            'host': os.environ.get('POSTGRES_HOST', ''),
            'port': os.environ.get('POSTGRES_PORT', ''),
            'database': os.environ.get('POSTGRES_DB', ''),
        }

    host = os.environ.get('POSTGRES_HOST', 'postgres')
    port = os.environ.get('POSTGRES_PORT', '5432')
    database = os.environ.get('POSTGRES_DB', 'spin_history')
    user = os.environ.get('POSTGRES_USER', 'spin')
    password = os.environ.get('POSTGRES_PASSWORD', 'spin')
    sslmode = os.environ.get('POSTGRES_SSLMODE', 'prefer')
    dsn = f'postgresql://{user}:{password}@{host}:{port}/{database}?sslmode={sslmode}'
    return {
        'dsn': dsn,
        'backend': 'postgresql',
        'host': host,
        'port': port,
        'database': database,
    }


def is_running_in_docker():
    return os.path.exists('/.dockerenv') or os.path.exists('/run/.containerenv')


def resolve_host(host):
    if not is_running_in_docker():
        return host
    if host not in ('localhost', '127.0.0.1'):
        return host
    return 'host.docker.internal'


def _restart_process():
    original_argv = list(getattr(sys, 'orig_argv', []) or [])
    if original_argv:
        executable = original_argv[0]
        if not os.path.isabs(executable):
            executable = shutil.which(executable) or executable
            original_argv[0] = executable
        os.execvpe(executable, original_argv, os.environ)

    launcher = sys.argv[0] if sys.argv else ''
    if launcher and not os.path.isabs(launcher):
        launcher = shutil.which(launcher) or os.path.abspath(launcher)

    restart_argv = [sys.executable]
    if launcher:
        restart_argv.append(launcher)
    restart_argv.extend(sys.argv[1:])
    os.execvpe(sys.executable, restart_argv, os.environ)


class RuntimeSECNode(spin_secop.SECNode):
    def __init__(self, addr, log):
        super().__init__(addr, log)
        self._description = None

    async def _open_connection(self):
        host, port = extract_addr(self.addr, self.default_port)
        reader, writer = await asyncio.open_connection(
            host,
            port,
            family=socket.AF_INET,
            limit=SECOP_STREAM_READER_LIMIT,
        )
        self.conn_read = reader
        self.conn_write = writer

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

    def stop_api_server(self):
        server = getattr(self, '_api_server', None)
        thread = getattr(self, '_api_server_thread', None)

        if server is not None:
            try:
                server.shutdown()
            except Exception:
                pass
            try:
                server.server_close()
            except Exception:
                pass

        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            try:
                thread.join(timeout=2.0)
            except Exception:
                pass

        self._api_server = None
        self._api_server_thread = None

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
            self._plot_history_limit = _read_plot_history_limit()
        if not hasattr(self, '_last_recorded_payloads'):
            self._last_recorded_payloads = {}
        if not hasattr(self, '_history_db_info'):
            self._history_db_info = _history_db_connection_settings()
        if not hasattr(self, '_history_db_lock'):
            self._history_db_lock = threading.Lock()
        if not hasattr(self, '_history_write_queue'):
            self._history_write_queue = deque()
        if not hasattr(self, '_history_writer_event'):
            self._history_writer_event = threading.Event()
        if not hasattr(self, '_history_writer_stop'):
            self._history_writer_stop = threading.Event()
        if not hasattr(self, '_history_db_initialized'):
            self._init_history_db()
            self._history_db_initialized = True
        if not hasattr(self, '_history_writer_thread'):
            self._history_writer_thread = self._start_history_writer()
        if not hasattr(self, '_nexus_exporter'):
            self._nexus_exporter = NexusRunExporter()
        if not hasattr(self, '_csv_data_saver'):
            self._csv_data_saver = CsvDataSaver(self)

    def _open_history_db_connection(self):
        db_info = getattr(self, '_history_db_info', None) or _history_db_connection_settings()
        return psycopg.connect(db_info['dsn'], autocommit=True)

    def _init_history_db(self):
        with self._open_history_db_connection() as connection:
            connection.execute(
                '''
                CREATE TABLE IF NOT EXISTS device_history (
                    id BIGSERIAL PRIMARY KEY,
                    key TEXT NOT NULL,
                    timestamp_ms BIGINT NOT NULL,
                    value_json JSONB,
                    unit TEXT,
                    state TEXT,
                    state_str TEXT
                )
                '''
            )
            connection.execute(
                'CREATE INDEX IF NOT EXISTS idx_device_history_key_time ON device_history(key, timestamp_ms)'
            )
            connection.execute(
                'CREATE INDEX IF NOT EXISTS idx_device_history_time ON device_history(timestamp_ms)'
            )

    def _start_history_writer(self):
        writer = threading.Thread(target=self._history_writer_loop, name='device-history-writer', daemon=True)
        writer.start()
        return writer

    def _dequeue_history_samples(self, max_items=1000):
        batch = []
        with self._history_db_lock:
            while self._history_write_queue and len(batch) < max_items:
                batch.append(self._history_write_queue.popleft())
        return batch

    def _requeue_history_samples(self, samples):
        if not samples:
            return
        with self._history_db_lock:
            for sample in reversed(samples):
                self._history_write_queue.appendleft(sample)

    def _history_writer_loop(self):
        connection = None
        while not self._history_writer_stop.is_set():
            self._history_writer_event.wait(timeout=1.0)
            self._history_writer_event.clear()

            batch = self._dequeue_history_samples()
            if not batch:
                continue

            try:
                if connection is None or connection.closed:
                    connection = self._open_history_db_connection()

                with connection.cursor() as cursor:
                    cursor.executemany(
                        '''
                        INSERT INTO device_history (key, timestamp_ms, value_json, unit, state, state_str)
                        VALUES (%s, %s, %s::jsonb, %s, %s, %s)
                        ''',
                        batch,
                    )
            except Exception as exc:
                self._requeue_history_samples(batch)
                try:
                    if getattr(self, 'log', None):
                        self.log.warning(f'Failed to flush device history batch to PostgreSQL: {exc}')
                except Exception:
                    pass
                try:
                    if connection is not None:
                        connection.close()
                except Exception:
                    pass
                connection = None
                time.sleep(2.0)

        try:
            if connection is not None:
                connection.close()
        except Exception:
            pass

    def _append_persistent_history_sample(self, key, payload, timestamp_ms):
        self._ensure_runtime_storage()
        record = (
            key,
            int(timestamp_ms),
            json.dumps(payload.get('value')),
            payload.get('unit', ''),
            payload.get('state', ''),
            payload.get('state_str', ''),
        )
        with self._history_db_lock:
            self._history_write_queue.append(record)
        self._history_writer_event.set()

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
        previous_payload = self._last_recorded_payloads.get(key)
        is_changed = previous_payload != payload
        self._last_recorded_payloads[key] = payload.copy()
        ExtendedBackend.latest_values[key] = payload
        if is_changed:
            self._append_plot_history_sample(key, payload, timestamp_ms)
            self._append_persistent_history_sample(key, payload, timestamp_ms)
        if is_changed and hasattr(self, '_nexus_exporter') and self._nexus_exporter.is_running:
            try:
                self._nexus_exporter.append_update(key, payload)
            except Exception as exc:
                self.log.warning(f'Failed to append NeXus export for {key}: {exc}')
        return safe_value, payload, is_changed

    def get_device_history(self, keys=None, start_ms=None, end_ms=None, limit=10000, offset=0, cursor_timestamp_ms=None, cursor_id=None):
        self._ensure_runtime_storage()
        clauses = []
        params = []

        if keys:
            normalized_keys = [str(key).strip() for key in keys if str(key).strip()]
            if normalized_keys:
                clauses.append('key = ANY(%s)')
                params.append(normalized_keys)

        if start_ms is not None:
            clauses.append('timestamp_ms >= %s')
            params.append(int(start_ms))

        if end_ms is not None:
            clauses.append('timestamp_ms <= %s')
            params.append(int(end_ms))

        cursor_active = cursor_timestamp_ms is not None
        if cursor_active:
            safe_cursor_timestamp_ms = int(cursor_timestamp_ms)
            safe_cursor_id = max(0, int(cursor_id or 0))
            clauses.append('(timestamp_ms > %s OR (timestamp_ms = %s AND id > %s))')
            params.extend([safe_cursor_timestamp_ms, safe_cursor_timestamp_ms, safe_cursor_id])

        where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ''
        safe_limit = max(1, min(int(limit or 10000), 50000))
        safe_offset = max(0, int(offset or 0))
        query = f'''
            SELECT id, key, timestamp_ms, value_json, unit, state, state_str
            FROM device_history
            {where_clause}
            ORDER BY timestamp_ms ASC, id ASC
            LIMIT %s
        '''
        query_params = list(params)
        query_params.append(safe_limit + 1)
        if not cursor_active and safe_offset:
            query += '\n            OFFSET %s\n        '
            query_params.append(safe_offset)

        with self._open_history_db_connection() as connection:
            rows = connection.execute(query, query_params).fetchall()

        has_more = len(rows) > safe_limit
        page_rows = rows[:safe_limit]

        samples = {}
        next_cursor = None
        if has_more and page_rows:
            last_row = page_rows[-1]
            next_cursor = {
                'timestamp_ms': int(last_row[2]),
                'id': int(last_row[0]),
            }

        for row_id, key, timestamp_ms, value_json, unit, state, state_str in page_rows:
            samples.setdefault(key, []).append({
                'id': int(row_id),
                'timestamp_ms': int(timestamp_ms),
                'value': value_json,
                'unit': unit or '',
                'state': state or '',
                'state_str': state_str or '',
            })

        return {
            'backend': self._history_db_info['backend'],
            'host': self._history_db_info['host'],
            'port': self._history_db_info['port'],
            'database': self._history_db_info['database'],
            'samples': samples,
            'returned_rows': len(page_rows),
            'limit': safe_limit,
            'offset': safe_offset,
            'has_more': has_more,
            'next_cursor': next_cursor,
            'paging_mode': 'cursor' if cursor_active else 'offset',
        }

    def get_device_history_stats(self):
        self._ensure_runtime_storage()
        with self._open_history_db_connection() as connection:
            row = connection.execute(
                '''
                SELECT COUNT(*), MIN(timestamp_ms), MAX(timestamp_ms)
                FROM device_history
                '''
            ).fetchone()

        total_rows, min_ts, max_ts = row or (0, None, None)
        return {
            'backend': self._history_db_info['backend'],
            'host': self._history_db_info['host'],
            'port': self._history_db_info['port'],
            'database': self._history_db_info['database'],
            'total_rows': int(total_rows or 0),
            'oldest_timestamp_ms': int(min_ts) if min_ts is not None else None,
            'newest_timestamp_ms': int(max_ts) if max_ts is not None else None,
        }

    def get_device_history_keys(self, limit=2000):
        self._ensure_runtime_storage()
        safe_limit = max(1, min(int(limit or 2000), 10000))
        with self._open_history_db_connection() as connection:
            rows = connection.execute(
                '''
                SELECT key, MAX(timestamp_ms) AS newest_timestamp_ms
                FROM device_history
                GROUP BY key
                ORDER BY key ASC
                LIMIT %s
                ''',
                (safe_limit,),
            ).fetchall()

        keys = []
        for key, newest_timestamp_ms in rows:
            keys.append({
                'key': key,
                'newest_timestamp_ms': int(newest_timestamp_ms) if newest_timestamp_ms is not None else None,
            })

        return {
            'backend': self._history_db_info['backend'],
            'host': self._history_db_info['host'],
            'port': self._history_db_info['port'],
            'database': self._history_db_info['database'],
            'keys': keys,
            'returned_keys': len(keys),
            'limit': safe_limit,
        }

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

            filtered_para_map = {name: (para_map or {}).get(name, []) for _, name in filtered_mod_list}
            filtered_dev_data = {name: (dev_data or {}).get(name, {}) for _, name in filtered_mod_list}
            self.add_runtime_secop_node(host, port, filtered_mod_list, filtered_para_map, filtered_dev_data)

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
        if self.is_initialized:
            dev.run_task(self._activate_device(dev))
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
            safe_value, _, changed = self._record_latest_value(key, unit, state, state_str, value)
            if not changed:
                continue
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
                        
                        safe_val, _, changed = self._record_latest_value(key, unit, state, state_str, val)
                        if not changed:
                            continue

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

        try:
            self.refresh_runtime_latest_values()
        except Exception as exc:
            self.log.warning(f'Failed to recover runtime nodes during startup: {exc}')

        self.run_task(self.poll_all_parameters())
        # Start Flask API server for latest values in a thread, pass self so
        # the API can inspect device->connection mappings.
        start_api_server(self)




def start_api_server(backend=None):
   
    app = Flask(__name__)
   
    CORS(app, resources={r'/api/*': {'origins': _cors_origins_config()}})

    @app.route('/api/runtime_node_ready')
    def get_runtime_node_ready():
        addr = (request.args.get('addr') or '').strip()
        if not addr:
            return jsonify({'status': 'error', 'error': 'missing addr'}), 400

        if backend and hasattr(backend, 'refresh_runtime_latest_values'):
            backend.refresh_runtime_latest_values()

        candidate_addrs = {addr}
        try:
            host, port = addr.rsplit(':', 1)
            candidate_addrs.add(f'{resolve_host(host)}:{port}')
        except ValueError:
            pass

        runtime_addrs = getattr(backend, '_runtime_device_addrs', {}) if backend else {}
        matched_devices = sorted(
            device_name for device_name, device_addr in runtime_addrs.items()
            if device_addr in candidate_addrs
        )

        latest_keys = []
        for device_name in matched_devices:
            prefix = f'{device_name}.'
            if any(key.startswith(prefix) for key in ExtendedBackend.latest_values.keys()):
                latest_keys.append(device_name)

        return jsonify({
            'status': 'ok',
            'ready': bool(matched_devices and latest_keys),
            'matched_devices': matched_devices,
            'devices_with_latest_values': latest_keys,
        })
   
    @app.route('/api/latest_values')
   
    def get_latest_values():
        return jsonify(_json_safe_value(ExtendedBackend.latest_values))

    @app.route('/api/plot_updates')
    def get_plot_updates():
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

    @app.route('/api/device_history')
    def get_device_history():
        keys_raw = request.args.get('keys', '')
        keys = [item for item in keys_raw.split(',') if item.strip()]

        start_raw = request.args.get('start_ms')
        end_raw = request.args.get('end_ms')
        limit_raw = request.args.get('limit')
        offset_raw = request.args.get('offset')
        cursor_timestamp_raw = request.args.get('cursor_timestamp_ms')
        cursor_id_raw = request.args.get('cursor_id')

        try:
            start_ms = int(start_raw) if start_raw not in (None, '') else None
        except (TypeError, ValueError):
            start_ms = None

        try:
            end_ms = int(end_raw) if end_raw not in (None, '') else None
        except (TypeError, ValueError):
            end_ms = None

        try:
            limit = int(limit_raw) if limit_raw not in (None, '') else 10000
        except (TypeError, ValueError):
            limit = 10000

        try:
            offset = int(offset_raw) if offset_raw not in (None, '') else 0
        except (TypeError, ValueError):
            offset = 0

        try:
            cursor_timestamp_ms = int(cursor_timestamp_raw) if cursor_timestamp_raw not in (None, '') else None
        except (TypeError, ValueError):
            cursor_timestamp_ms = None

        try:
            cursor_id = int(cursor_id_raw) if cursor_id_raw not in (None, '') else None
        except (TypeError, ValueError):
            cursor_id = None

        if backend and hasattr(backend, 'get_device_history'):
            payload = backend.get_device_history(
                keys=keys,
                start_ms=start_ms,
                end_ms=end_ms,
                limit=limit,
                offset=offset,
                cursor_timestamp_ms=cursor_timestamp_ms,
                cursor_id=cursor_id,
            )
        else:
            info = _history_db_connection_settings()
            payload = {
                'backend': info['backend'],
                'host': info['host'],
                'port': info['port'],
                'database': info['database'],
                'samples': {},
                'returned_rows': 0,
                'limit': limit,
                'offset': offset,
                'has_more': False,
                'next_cursor': None,
                'paging_mode': 'cursor' if cursor_timestamp_ms is not None else 'offset',
            }

        payload['status'] = 'ok'
        return jsonify(_json_safe_value(payload))

    @app.route('/api/device_history/stats')
    def get_device_history_stats():
        if backend and hasattr(backend, 'get_device_history_stats'):
            payload = backend.get_device_history_stats()
        else:
            info = _history_db_connection_settings()
            payload = {
                'backend': info['backend'],
                'host': info['host'],
                'port': info['port'],
                'database': info['database'],
                'total_rows': 0,
                'oldest_timestamp_ms': None,
                'newest_timestamp_ms': None,
            }

        payload['status'] = 'ok'
        return jsonify(_json_safe_value(payload))

    @app.route('/api/device_history/keys')
    def get_device_history_keys():
        limit_raw = request.args.get('limit')

        try:
            limit = int(limit_raw) if limit_raw not in (None, '') else 2000
        except (TypeError, ValueError):
            limit = 2000

        if backend and hasattr(backend, 'get_device_history_keys'):
            payload = backend.get_device_history_keys(limit=limit)
        else:
            info = _history_db_connection_settings()
            payload = {
                'backend': info['backend'],
                'host': info['host'],
                'port': info['port'],
                'database': info['database'],
                'keys': [],
                'returned_keys': 0,
                'limit': limit,
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
    @_require_api_auth()
    def api_nexus_export_start():
        try:
            if not backend:
                return jsonify({'status': 'error', 'error': 'backend unavailable'}), 500
            backend._ensure_runtime_storage()
            data, error_response = _read_json_body()
            if error_response:
                return error_response
            run_name = data.get('run_name')
            file_path = backend._nexus_exporter.start(run_name)
            return jsonify({'status': 'ok', 'file_path': file_path, 'export': backend._nexus_exporter.status()})
        except Exception as exc:
            app.logger.exception('api_nexus_export_start failed')
            return jsonify({'status': 'error', 'error': str(exc)}), 500

    @app.route('/api/nexus_export/stop', methods=['POST'])
    @_require_api_auth()
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

    @app.route('/api/data_saving/status', methods=['GET'])
    def api_data_saving_status():
        try:
            if backend and hasattr(backend, '_ensure_runtime_storage'):
                backend._ensure_runtime_storage()
            status = backend._csv_data_saver.status() if backend and hasattr(backend, '_csv_data_saver') else {
                'running': False,
                'file_path': None,
                'directory': DATA_EXPORT_DIR,
                'file_name': None,
                'interval_seconds': 10.0,
                'start_time_ms': None,
                'last_write_ms': None,
                'write_cycles': 0,
                'default_directory': DATA_EXPORT_DIR,
            }
            nexus_status = backend._nexus_exporter.status() if backend and hasattr(backend, '_nexus_exporter') else {
                'running': False,
                'file_path': None,
                'run_name': None,
                'start_time': None,
            }
            status['nexus'] = nexus_status
            return jsonify({'status': 'ok', 'export': status})
        except Exception as exc:
            app.logger.exception('api_data_saving_status failed')
            return jsonify({'status': 'error', 'error': str(exc)}), 500

    @app.route('/api/data_saving/start', methods=['POST'])
    @_require_api_auth()
    def api_data_saving_start():
        try:
            if not backend:
                return jsonify({'status': 'error', 'error': 'backend unavailable'}), 500
            backend._ensure_runtime_storage()
            data, error_response = _read_json_body()
            if error_response:
                return error_response
            directory = data.get('directory')
            file_name = data.get('file_name')
            interval_seconds = _parse_positive_float(data.get('interval_seconds', 10), 10)
            save_nexus = bool(data.get('save_nexus', True))
            file_path = backend._csv_data_saver.start(directory=directory, file_name=file_name, interval_seconds=interval_seconds)
            nexus_file_path = None
            if save_nexus:
                base_name = os.path.splitext(os.path.basename(str(file_name or '').strip() or 'data_export'))[0]
                nexus_file_name = f'{base_name}.nxs'
                nexus_file_path = backend._nexus_exporter.start(run_name=base_name, directory=directory, file_name=nexus_file_name)
            status = backend._csv_data_saver.status()
            status['nexus'] = backend._nexus_exporter.status()
            return jsonify({'status': 'ok', 'file_path': file_path, 'nexus_file_path': nexus_file_path, 'export': status})
        except ValueError as exc:
            return jsonify({'status': 'error', 'error': str(exc)}), 400
        
        except Exception as exc:
            app.logger.exception('api_data_saving_start failed')
            return jsonify({'status': 'error', 'error': str(exc)}), 500

    @app.route('/api/data_saving/stop', methods=['POST'])
    @_require_api_auth()
    def api_data_saving_stop():
        try:
            if not backend:
                return jsonify({'status': 'error', 'error': 'backend unavailable'}), 500
            backend._ensure_runtime_storage()
            file_path = backend._csv_data_saver.stop()
            nexus_file_path = backend._nexus_exporter.stop() if backend._nexus_exporter.is_running else None
            status = backend._csv_data_saver.status()
            status['nexus'] = backend._nexus_exporter.status()
            return jsonify({'status': 'ok', 'file_path': file_path, 'nexus_file_path': nexus_file_path, 'export': status})
        except Exception as exc:
            app.logger.exception('api_data_saving_stop failed')
            return jsonify({'status': 'error', 'error': str(exc)}), 500

    @app.route('/api/storage/status', methods=['GET'])
    def api_storage_status():
        try:
            payload = get_storage_monitor_status(backend=backend)
            return jsonify({'status': 'ok', 'storage': payload})
        except Exception as exc:
            app.logger.exception('api_storage_status failed')
            return jsonify({'status': 'error', 'error': str(exc)}), 500

    @app.route('/api/node_for_device', methods=['GET', 'POST'])
    def api_node_for_device():
        """Return the node addr (host:port) responsible for the given device.

        Accepts JSON { device: '<device_name>' } or query param ?device=...
        """
        # read device from JSON body or query string
        data, error_response = _read_json_body() if request.method == 'POST' else ({}, None)
        if error_response:
            return error_response
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

    @app.route('/api/assets/svg', methods=['GET'])
    def api_assets_svg():
        try:
            files = []
            if os.path.isdir(ASSETS_DIR):
                for fname in sorted(os.listdir(ASSETS_DIR)):
                    if fname.lower().endswith('.svg'):
                        files.append({
                            'name': fname,
                            'url': f'/c/assets/{quote(fname)}',
                        })
            return jsonify({'status': 'ok', 'files': files})
        except Exception as exc:
            app.logger.exception('api_assets_svg failed')
            return jsonify({'status': 'error', 'error': str(exc)}), 500

    # POST endpoint to send a raw SECoP line (or any line-based TCP command)
    @app.route('/api/send_request', methods=['POST'])
    @_require_api_auth()
    def api_send_request():
        """Accept JSON { host, port, command } and send the raw line to the node.

        Uses spin.utils.StreamConnection to open a socket and send the line.
        Returns JSON with the (optional) response line.
        """
        data, error_response = _read_json_body(required=True)
        if error_response:
            return error_response
        cmd = data.get('command') or data.get('cmd') or data.get('line')

        if not cmd:
            return jsonify({'status': 'error', 'error': 'missing addr or command'}), 400
        if not isinstance(cmd, str):
            return jsonify({'status': 'error', 'error': 'command must be a string'}), 400
        if len(cmd) > 4096:
            return jsonify({'status': 'error', 'error': 'command too long'}), 400

        try:
            addr = _parse_addr_payload(data, backend=backend)
        except ValueError as exc:
            return jsonify({'status': 'error', 'error': str(exc)}), 400

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
    @_require_api_auth()
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
                    if backend and hasattr(backend, 'stop_api_server'):
                        backend.stop_api_server()
                    _restart_process()
                except Exception:
                    os._exit(0)

            threading.Thread(target=_delayed_restart_process, daemon=True).start()
            
            return jsonify({'status': 'ok', 'method': 'process_restart'}), 202
        
        except Exception as e:
        
            app.logger.exception('api_restart failed')
            
            return jsonify({'status': 'error', 'error': str(e)}), 500

    api_server = make_server('0.0.0.0', 8001, app, threaded=True)
    api_thread = threading.Thread(target=api_server.serve_forever, name='spin-api-server', daemon=True)
    api_thread.start()

    if backend is not None:
        backend._api_server = api_server
        backend._api_server_thread = api_thread
