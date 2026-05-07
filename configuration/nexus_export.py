import json
import os
from datetime import datetime, timezone

import h5py
import numpy as np


EXPORT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'nexus_exports'))
PREVIEW_LIMIT = 20


def ensure_export_dir():
    os.makedirs(EXPORT_DIR, exist_ok=True)


def _sanitize_name(value):
    text = str(value or '').strip()
    if not text:
        return 'unnamed'
    safe = ''.join(ch if ch.isalnum() or ch in ('-', '_') else '_' for ch in text)
    return safe.strip('_') or 'unnamed'


def _utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def _safe_export_name(file_name):
    safe_name = os.path.basename(str(file_name or '').strip())
    if not safe_name:
        raise ValueError('missing export file name')
    if not safe_name.endswith('.nxs'):
        raise ValueError('export file must end with .nxs')
    return safe_name


def resolve_export_file(file_name):
    ensure_export_dir()
    safe_name = _safe_export_name(file_name)
    file_path = os.path.join(EXPORT_DIR, safe_name)
    if not os.path.isfile(file_path):
        raise FileNotFoundError(safe_name)
    return file_path


def list_export_files():
    ensure_export_dir()
    exports = []
    for entry in os.listdir(EXPORT_DIR):
        if not entry.endswith('.nxs'):
            continue
        file_path = os.path.join(EXPORT_DIR, entry)
        try:
            stat = os.stat(file_path)
        except OSError:
            continue
        exports.append({
            'name': entry,
            'size': stat.st_size,
            'modified_time': datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        })
    exports.sort(key=lambda item: item['modified_time'], reverse=True)
    return exports


def _attrs_to_json(attrs):
    values = {}
    for key, value in attrs.items():
        values[str(key)] = _jsonable_data(value)
    return values


def _normalize_object_path(object_path):
    text = str(object_path or '/').strip() or '/'
    if not text.startswith('/'):
        text = '/' + text
    return text


def _jsonable_data(value):
    if isinstance(value, np.ndarray):
        return _jsonable_data(value.tolist())
    if isinstance(value, np.generic):
        return _jsonable_data(value.item())
    if isinstance(value, bytes):
        return value.decode('utf-8', errors='replace')
    if isinstance(value, (list, tuple)):
        return [_jsonable_data(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _jsonable_data(item) for key, item in value.items()}
    return value


def _dataset_preview(dataset):
    if dataset.shape == ():
        return _jsonable_data(dataset[()])

    first_dim = dataset.shape[0] if dataset.shape else 0
    limit = min(first_dim, PREVIEW_LIMIT)
    if len(dataset.shape) == 1:
        data = dataset[:limit]
    else:
        slices = [slice(0, limit)] + [slice(None)] * (len(dataset.shape) - 1)
        data = dataset[tuple(slices)]
    return _jsonable_data(data)


def inspect_export_object(file_name, object_path='/'):
    file_path = resolve_export_file(file_name)
    normalized_path = _normalize_object_path(object_path)

    with h5py.File(file_path, 'r') as handle:
        obj = handle[normalized_path]
        info = {
            'file_name': os.path.basename(file_path),
            'path': normalized_path,
            'kind': 'group' if isinstance(obj, h5py.Group) else 'dataset',
            'attrs': _attrs_to_json(obj.attrs),
        }

        if isinstance(obj, h5py.Group):
            children = []
            for child_name in obj.keys():
                child = obj[child_name]
                child_path = child.name
                children.append({
                    'name': child_name,
                    'path': child_path,
                    'kind': 'group' if isinstance(child, h5py.Group) else 'dataset',
                })
            info['children'] = children
            return info

        info['shape'] = list(obj.shape)
        info['dtype'] = str(obj.dtype)
        info['preview'] = _dataset_preview(obj)
        info['size'] = int(obj.size)
        return info


class NexusRunExporter:
    def __init__(self):
        self.file_handle = None
        self.file_path = None
        self.run_name = None
        self.start_time = None
        self.signal_groups = {}

    @property
    def is_running(self):
        return self.file_handle is not None

    def start(self, run_name=None):
        if self.is_running:
            return self.file_path

        ensure_export_dir()
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        self.run_name = _sanitize_name(run_name or f'run_{timestamp}')
        file_name = f'{self.run_name}_{timestamp}.nxs'
        self.file_path = os.path.join(EXPORT_DIR, file_name)
        self.start_time = _utc_now_iso()
        self.signal_groups = {}

        handle = h5py.File(self.file_path, 'w')
        handle.attrs['NX_class'] = 'NXroot'
        handle.attrs['file_name'] = file_name
        handle.attrs['file_time'] = self.start_time
        handle.attrs['creator'] = 'spin-gui-SE'

        entry = handle.create_group('entry')
        entry.attrs['NX_class'] = 'NXentry'
        entry.create_dataset('start_time', data=self.start_time, dtype=h5py.string_dtype('utf-8'))
        entry.create_dataset('definition', data='NXsensor_scan', dtype=h5py.string_dtype('utf-8'))

        instrument = entry.create_group('instrument')
        instrument.attrs['NX_class'] = 'NXinstrument'

        metadata = entry.create_group('metadata')
        metadata.attrs['NX_class'] = 'NXcollection'
        metadata.create_dataset('run_name', data=self.run_name, dtype=h5py.string_dtype('utf-8'))

        self.file_handle = handle
        self.file_handle.flush()
        return self.file_path

    def stop(self):
        if not self.is_running:
            return None

        end_time = _utc_now_iso()
        try:
            entry = self.file_handle['entry']
            if 'end_time' in entry:
                del entry['end_time']
            entry.create_dataset('end_time', data=end_time, dtype=h5py.string_dtype('utf-8'))
            self.file_handle.flush()
        finally:
            path = self.file_path
            self.file_handle.close()
            self.file_handle = None
            self.file_path = None
            self.run_name = None
            self.start_time = None
            self.signal_groups = {}
        return path

    def status(self):
        return {
            'running': self.is_running,
            'file_path': self.file_path,
            'run_name': self.run_name,
            'start_time': self.start_time,
        }

    def append_update(self, key, payload):
        if not self.is_running or not key:
            return

        signal_group = self._ensure_signal_group(key, payload)
        timestamp_ds = signal_group['time']
        value_ds = signal_group['value']
        state_ds = signal_group['state']
        state_str_ds = signal_group['state_str']

        next_index = timestamp_ds.shape[0]
        timestamp_ds.resize((next_index + 1,))
        value_ds.resize((next_index + 1,))
        state_ds.resize((next_index + 1,))
        state_str_ds.resize((next_index + 1,))

        timestamp_ds[next_index] = datetime.now(timezone.utc).timestamp()
        value_ds[next_index] = json.dumps(payload.get('value'))
        state_ds[next_index] = str(payload.get('state', ''))
        state_str_ds[next_index] = str(payload.get('state_str', ''))
        self.file_handle.flush()

    def _ensure_signal_group(self, key, payload):
        if key in self.signal_groups:
            return self.signal_groups[key]

        device_name, _, param_name = key.partition('.')
        if not param_name:
            param_name = 'value'

        instrument = self.file_handle['entry']['instrument']
        device_group = instrument.require_group(_sanitize_name(device_name))
        if 'NX_class' not in device_group.attrs:
            device_group.attrs['NX_class'] = 'NXcollection'
            device_group.attrs['device_name'] = str(device_name)

        signal_group = device_group.create_group(_sanitize_name(param_name))
        signal_group.attrs['NX_class'] = 'NXlog'
        signal_group.attrs['signal_name'] = key
        signal_group.attrs['parameter_name'] = str(param_name)
        signal_group.attrs['unit'] = str(payload.get('unit', ''))

        string_dtype = h5py.string_dtype('utf-8')
        signal_group.create_dataset('time', shape=(0,), maxshape=(None,), chunks=True, dtype=np.float64)
        signal_group.create_dataset('value', shape=(0,), maxshape=(None,), chunks=True, dtype=string_dtype)
        signal_group.create_dataset('state', shape=(0,), maxshape=(None,), chunks=True, dtype=string_dtype)
        signal_group.create_dataset('state_str', shape=(0,), maxshape=(None,), chunks=True, dtype=string_dtype)

        self.signal_groups[key] = signal_group
        return signal_group