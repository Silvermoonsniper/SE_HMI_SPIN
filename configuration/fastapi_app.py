"""FastAPI application exposing the ExtendedBackend state to the React frontend.

This module is a drop-in replacement for the legacy Flask API server that used
to live in ``extended_backend.py``. It keeps every ``/api/*`` route contract
identical so the legacy Spin frontend keeps working, and additionally provides:

- ``/ws`` WebSocket streaming Spin ``Update`` events (same shape as the
  ``spinupdate`` CustomEvent detail: ``{key, unit, state, state_str, value}``).
- ``POST /api/nodemanager/{command}`` bridging nodemanager commands
  (``add_node``, ``list_nodes``, ``get_device_params``, ``save_layout``,
  ``list_layouts``, ``get_layout``, ``delete_layout``, ``save_plot_config``,
  ``list_plot_configs``, ``get_plot_config``, ``delete_plot_config``) to the
  running ``NodeManagerDevice``.
- Static mounts for ``/c/assets/*`` and ``/c/device_params.json`` plus SPA
  hosting of the React build in ``frontend/dist`` when present.
"""

import asyncio
import contextlib
import json
import os
import threading
import time
from typing import Any, Dict, Optional

from fastapi import Body, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import uvicorn

from spin.backend import Request as SpinRequest
from spin.utils import StreamConnection

from configuration.extended_backend import (
    ASSETS_DIR,
    DATA_EXPORT_DIR,
    ExtendedBackend,
    _history_db_connection_settings,
    _json_safe_value,
    _list_saved_layout_names,
    _load_saved_layout,
    _parse_addr_payload,
    _parse_positive_float,
    _resolve_device_addr,
    get_storage_monitor_status,
    resolve_csv_export_file,
    resolve_host,
)
from configuration.nexus_export import (
    inspect_export_object,
    list_export_files,
    resolve_export_file,
)
from configuration.ws_hub import update_hub

CONFIG_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIST = os.path.abspath(os.path.join(CONFIG_DIR, '..', 'frontend', 'dist'))

NODEMANAGER_COMMANDS = {
    'add_node',
    'list_nodes',
    'get_device_params',
    'save_layout',
    'list_layouts',
    'get_layout',
    'delete_layout',
    'save_plot_config',
    'list_plot_configs',
    'get_plot_config',
    'delete_plot_config',
}


def _error(message, status_code=400):
    """Return a JSON error response with the legacy Flask response shape."""
    return JSONResponse({'status': 'error', 'error': str(message)}, status_code=status_code)


def _not_found():
    """Return a 404 response with the legacy Flask response shape."""
    return JSONResponse({'status': 'not_found'}, status_code=404)


def _parse_int(value, default=None):
    """Parse an optional integer query parameter, mirroring the Flask code."""
    if value in (None, ''):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


class SPAStaticFiles(StaticFiles):
    """StaticFiles with a SPA fallback: unknown paths serve index.html."""

    async def get_response(self, path, scope):
        """Serve the requested file, falling back to index.html for 404s."""
        from starlette.exceptions import HTTPException as StarletteHTTPException

        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response('index.html', scope)
            raise


def create_app(backend=None):
    """Build the FastAPI application bound to one ExtendedBackend instance."""

    @contextlib.asynccontextmanager
    async def lifespan(_app):
        """Bind the update hub to the running API event loop at startup."""
        update_hub.bind_loop(asyncio.get_running_loop())
        yield

    app = FastAPI(title='spin-gui-SE API', lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=['*'],
        allow_methods=['*'],
        allow_headers=['*'],
    )

    # ------------------------------------------------------------------
    # WebSocket live-update stream
    # ------------------------------------------------------------------

    @app.websocket('/ws')
    async def ws_updates(websocket: WebSocket):
        """Stream Spin update events and an initial latest-values snapshot."""
        await websocket.accept()
        queue = update_hub.subscribe()
        try:
            snapshot = _json_safe_value(ExtendedBackend.latest_values)
            await websocket.send_json({'type': 'snapshot', 'values': snapshot})
            while True:
                message = await queue.get()
                await websocket.send_json({'type': 'update', 'data': message})
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            update_hub.unsubscribe(queue)

    # ------------------------------------------------------------------
    # Core read APIs
    # ------------------------------------------------------------------

    @app.get('/api/runtime_node_ready')
    def api_runtime_node_ready(addr: Optional[str] = None):
        """Return whether a runtime node has produced latest values yet."""
        addr = (addr or '').strip()
        if not addr:
            return _error('missing addr', 400)

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

        return {
            'status': 'ok',
            'ready': bool(matched_devices and latest_keys),
            'matched_devices': matched_devices,
            'devices_with_latest_values': latest_keys,
        }

    @app.get('/api/latest_values')
    def api_latest_values():
        """Return the latest cached device values as JSON."""
        return _json_safe_value(ExtendedBackend.latest_values)

    @app.get('/api/layouts')
    def api_layouts():
        """List the names of saved frontend layout presets."""
        try:
            return {'status': 'ok', 'names': _list_saved_layout_names()}
        except Exception as exc:
            return _error(str(exc), 500)

    @app.get('/api/layouts/{name:path}')
    def api_layout_by_name(name: str):
        """Load one saved frontend layout by name."""
        try:
            layout = _load_saved_layout(name)
            return {'status': 'ok', 'layout': _json_safe_value(layout)}
        except ValueError as exc:
            return _error(str(exc), 400)
        except FileNotFoundError:
            return _not_found()
        except Exception as exc:
            return _error(str(exc), 500)

    @app.get('/api/plot_updates')
    def api_plot_updates(request: Request):
        """Return plot snapshots or incremental samples for frontend charts."""
        since_ms = _parse_int(request.query_params.get('since'))

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
        return _json_safe_value(payload)

    @app.get('/api/device_history')
    def api_device_history(request: Request):
        """Return paged device history samples using query-string filters."""
        params = request.query_params
        keys = [item for item in params.get('keys', '').split(',') if item.strip()]
        start_ms = _parse_int(params.get('start_ms'))
        end_ms = _parse_int(params.get('end_ms'))
        limit = _parse_int(params.get('limit'), 10000)
        offset = _parse_int(params.get('offset'), 0)
        cursor_timestamp_ms = _parse_int(params.get('cursor_timestamp_ms'))
        cursor_id = _parse_int(params.get('cursor_id'))

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
        return _json_safe_value(payload)

    @app.get('/api/device_history/stats')
    def api_device_history_stats():
        """Return aggregate device history statistics for the frontend."""
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
        return _json_safe_value(payload)

    @app.get('/api/device_history/keys')
    def api_device_history_keys(request: Request):
        """Return the distinct history keys available in persistent storage."""
        limit = _parse_int(request.query_params.get('limit'), 2000)

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
        return _json_safe_value(payload)

    # ------------------------------------------------------------------
    # NeXus export APIs
    # ------------------------------------------------------------------

    @app.get('/api/nexus_export/status')
    def api_nexus_export_status():
        """Return the current NeXus exporter status payload."""
        try:
            if backend and hasattr(backend, '_ensure_runtime_storage'):
                backend._ensure_runtime_storage()
            status = backend._nexus_exporter.status() if backend and hasattr(backend, '_nexus_exporter') else {
                'running': False,
                'file_path': None,
                'run_name': None,
                'start_time': None,
            }
            return {'status': 'ok', 'export': status}
        except Exception as exc:
            return _error(str(exc), 500)

    @app.get('/api/nexus_export/files')
    def api_nexus_export_files():
        """List saved NeXus export files for the in-app browser."""
        try:
            return {'status': 'ok', 'files': list_export_files()}
        except Exception as exc:
            return _error(str(exc), 500)

    @app.get('/api/nexus_export/download')
    def api_nexus_export_download(request: Request):
        """Download one saved NeXus export file by name."""
        file_name = request.query_params.get('file')
        if not file_name:
            return _error('missing file', 400)

        try:
            file_path = resolve_export_file(file_name)
            return FileResponse(
                file_path,
                filename=os.path.basename(file_path),
                media_type='application/octet-stream',
            )
        except ValueError as exc:
            return _error(str(exc), 400)
        except FileNotFoundError:
            return _not_found()
        except Exception as exc:
            return _error(str(exc), 500)

    @app.get('/api/nexus_export/inspect')
    def api_nexus_export_inspect(request: Request):
        """Inspect one object path within a saved NeXus export file."""
        file_name = request.query_params.get('file')
        object_path = request.query_params.get('path') or '/'
        if not file_name:
            return _error('missing file', 400)

        try:
            payload = inspect_export_object(file_name, object_path)
            return {'status': 'ok', 'node': payload}
        except (FileNotFoundError, KeyError):
            return _not_found()
        except Exception as exc:
            return _error(str(exc), 500)

    @app.post('/api/nexus_export/start')
    def api_nexus_export_start(payload: Optional[Dict[str, Any]] = Body(None)):
        """Start a manual NeXus export run on the backend."""
        try:
            if not backend:
                return _error('backend unavailable', 500)
            backend._ensure_runtime_storage()
            data = payload or {}
            run_name = data.get('run_name')
            file_path = backend._nexus_exporter.start(run_name)
            return {'status': 'ok', 'file_path': file_path, 'export': backend._nexus_exporter.status()}
        except Exception as exc:
            return _error(str(exc), 500)

    @app.post('/api/nexus_export/stop')
    def api_nexus_export_stop():
        """Stop the currently active NeXus export run."""
        try:
            if not backend:
                return _error('backend unavailable', 500)
            backend._ensure_runtime_storage()
            file_path = backend._nexus_exporter.stop()
            return {'status': 'ok', 'file_path': file_path, 'export': backend._nexus_exporter.status()}
        except Exception as exc:
            return _error(str(exc), 500)

    # ------------------------------------------------------------------
    # CSV data saving APIs
    # ------------------------------------------------------------------

    @app.get('/api/data_saving/status')
    def api_data_saving_status():
        """Return the current CSV data-saving status and linked NeXus status."""
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
            return {'status': 'ok', 'export': status}
        except Exception as exc:
            return _error(str(exc), 500)

    @app.get('/api/data_saving/download')
    def api_data_saving_download(request: Request):
        """Download one generated CSV export file by name."""
        file_name = request.query_params.get('file')
        if not file_name:
            return _error('missing file', 400)

        try:
            file_path = resolve_csv_export_file(file_name)
            return FileResponse(
                file_path,
                filename=os.path.basename(file_path),
                media_type='text/csv',
            )
        except ValueError as exc:
            return _error(str(exc), 400)
        except FileNotFoundError:
            return _not_found()
        except Exception as exc:
            return _error(str(exc), 500)

    @app.post('/api/data_saving/start')
    def api_data_saving_start(payload: Optional[Dict[str, Any]] = Body(None)):
        """Start periodic CSV data saving and optional paired NeXus export."""
        try:
            if not backend:
                return _error('backend unavailable', 500)
            backend._ensure_runtime_storage()
            data = payload or {}
            directory = data.get('directory')
            file_name = data.get('file_name')
            interval_seconds = _parse_positive_float(data.get('interval_seconds', 10), 10)
            save_nexus = bool(data.get('save_nexus', True))
            file_path = backend._csv_data_saver.start(
                directory=directory,
                file_name=file_name,
                interval_seconds=interval_seconds,
            )
            nexus_file_path = None
            if save_nexus:
                base_name = os.path.splitext(os.path.basename(str(file_name or '').strip() or 'data_export'))[0]
                nexus_file_name = f'{base_name}.nxs'
                nexus_file_path = backend._nexus_exporter.start(
                    run_name=base_name,
                    directory=directory,
                    file_name=nexus_file_name,
                )
            status = backend._csv_data_saver.status()
            status['nexus'] = backend._nexus_exporter.status()
            return {'status': 'ok', 'file_path': file_path, 'nexus_file_path': nexus_file_path, 'export': status}
        except ValueError as exc:
            return _error(str(exc), 400)
        except Exception as exc:
            return _error(str(exc), 500)

    @app.post('/api/data_saving/stop')
    def api_data_saving_stop():
        """Stop periodic CSV saving and finalize any active paired NeXus run."""
        try:
            if not backend:
                return _error('backend unavailable', 500)
            backend._ensure_runtime_storage()
            file_path = backend._csv_data_saver.stop()
            nexus_file_path = backend._nexus_exporter.stop() if backend._nexus_exporter.is_running else None
            status = backend._csv_data_saver.status()
            status['nexus'] = backend._nexus_exporter.status()
            return {'status': 'ok', 'file_path': file_path, 'nexus_file_path': nexus_file_path, 'export': status}
        except Exception as exc:
            return _error(str(exc), 500)

    # ------------------------------------------------------------------
    # Storage / node lookup / plot configs / assets
    # ------------------------------------------------------------------

    @app.get('/api/storage/status')
    def api_storage_status():
        """Return storage usage information for the backend host."""
        try:
            payload = get_storage_monitor_status(backend=backend)
            return {'status': 'ok', 'storage': payload}
        except Exception as exc:
            return _error(str(exc), 500)

    @app.api_route('/api/node_for_device', methods=['GET', 'POST'])
    def api_node_for_device(request: Request, payload: Optional[Dict[str, Any]] = Body(None)):
        """Return the node addr (host:port) responsible for the given device."""
        data = payload or {}
        device = data.get('device') or request.query_params.get('device')
        if not device:
            return _error('missing device', 400)

        try:
            if backend and hasattr(backend, '_recover_runtime_nodes_from_files'):
                backend._recover_runtime_nodes_from_files()
            addr = _resolve_device_addr(backend, device)
            if addr:
                return {'status': 'ok', 'addr': addr}
        except Exception:
            pass

        return _not_found()

    @app.get('/api/plot_configs')
    def api_plot_configs():
        """List the saved plot configuration names."""
        plot_config_dir = os.path.abspath(os.path.join(CONFIG_DIR, '..', 'plot_config'))
        try:
            names = []
            if os.path.isdir(plot_config_dir):
                for fname in os.listdir(plot_config_dir):
                    if fname.endswith('.json'):
                        names.append(fname[:-5])
            return {'status': 'ok', 'names': sorted(names)}
        except Exception as exc:
            return _error(str(exc), 500)

    @app.get('/api/plot_configs/{name:path}')
    def api_plot_config(name: str):
        """Load one saved plot configuration by name."""
        plot_config_dir = os.path.abspath(os.path.join(CONFIG_DIR, '..', 'plot_config'))
        safe_name = os.path.basename(name)
        file_path = os.path.join(plot_config_dir, safe_name + '.json')
        try:
            if not os.path.exists(file_path):
                return _not_found()
            with open(file_path, 'r') as handle:
                config = json.load(handle)
            if isinstance(config, dict) and 'name' not in config:
                config['name'] = safe_name
            return {'status': 'ok', 'config': config}
        except Exception as exc:
            return _error(str(exc), 500)

    @app.get('/api/assets/svg')
    def api_assets_svg():
        """List SVG assets available to the frontend asset browser."""
        from urllib.parse import quote

        try:
            files = []
            if os.path.isdir(ASSETS_DIR):
                for fname in sorted(os.listdir(ASSETS_DIR)):
                    if fname.lower().endswith('.svg'):
                        files.append({
                            'name': fname,
                            'url': f'/c/assets/{quote(fname)}',
                        })
            return {'status': 'ok', 'files': files}
        except Exception as exc:
            return _error(str(exc), 500)

    # ------------------------------------------------------------------
    # Write / command APIs
    # ------------------------------------------------------------------

    @app.post('/api/send_request')
    def api_send_request(payload: Optional[Dict[str, Any]] = Body(None)):
        """Accept JSON { host, port, command } and send the raw line to the node."""
        if payload is None:
            return _error('invalid or missing JSON body', 400)
        data = payload
        cmd = data.get('command') or data.get('cmd') or data.get('line')

        if not cmd:
            return _error('missing addr or command', 400)
        if not isinstance(cmd, str):
            return _error('command must be a string', 400)
        if len(cmd) > 4096:
            return _error('command too long', 400)

        try:
            addr = _parse_addr_payload(data, backend=backend)
        except ValueError as exc:
            return _error(str(exc), 400)

        async def _send_and_recv(a, line):
            """Send one raw line to a TCP node and read a single reply line."""
            import logging

            conn = StreamConnection(a, logging.getLogger('spin.api'))
            await conn._open_connection()
            await conn._send(line.encode() if isinstance(line, str) else line)
            try:
                resp = await asyncio.wait_for(conn._receive(), timeout=3.0)
            except asyncio.TimeoutError:
                resp = ''
            try:
                if conn.conn_write:
                    conn.conn_write.close()
                    await conn.conn_write.wait_closed()
            except Exception:
                pass
            return resp

        try:
            response = asyncio.run(_send_and_recv(addr, cmd))
            return {'status': 'sent', 'response': response}
        except Exception as exc:
            return _error(str(exc), 500)

    @app.post('/api/device_parameter')
    def api_device_parameter(payload: Optional[Dict[str, Any]] = Body(None)):
        """Write one device parameter through the backend without a websocket."""
        if payload is None:
            return _error('invalid or missing JSON body', 400)
        data = payload

        device = str(data.get('device') or '').strip()
        param = str(data.get('param') or '').strip()
        value = data.get('value')

        if not device or not param:
            return _error('missing device or param', 400)
        if not backend or not hasattr(backend, '_devices'):
            return _error('backend unavailable', 503)

        dev = backend._devices.get(device)
        if dev is None:
            return _error(f'unknown device {device}', 404)

        request_obj = SpinRequest(None, f'{device}.{param}', '', 'input', '', value)

        async def _perform_write():
            await dev.handle_request(request_obj)

        try:
            future = asyncio.run_coroutine_threadsafe(_perform_write(), backend._loop)
            future.result(timeout=10.0)
            return {'status': 'ok'}
        except Exception as exc:
            return _error(str(exc), 500)

    @app.post('/api/nodemanager/{command}')
    def api_nodemanager_command(command: str, payload: Optional[Dict[str, Any]] = Body(None)):
        """Bridge nodemanager commands to the running NodeManagerDevice."""
        if command not in NODEMANAGER_COMMANDS:
            return _error(f'unknown nodemanager command {command}', 400)
        if not backend or not hasattr(backend, '_devices'):
            return _error('backend unavailable', 503)

        dev = backend._devices.get('nodemanager')
        if dev is None:
            return _error('nodemanager device unavailable', 503)

        request_obj = SpinRequest(None, f'nodemanager.{command}', '', 'input', '', payload or {})

        try:
            future = asyncio.run_coroutine_threadsafe(dev.handle_request(request_obj), backend._loop)
            reply = future.result(timeout=60.0)
        except Exception as exc:
            return _error(str(exc), 500)

        if reply is None:
            # Command results are pushed asynchronously as nodemanager.* updates.
            return {'status': 'ok', 'action': None, 'data': None}

        action = getattr(reply, 'action', None)
        reply_data = _json_safe_value(getattr(reply, 'data', None))
        if action == 'error':
            return JSONResponse({'status': 'error', 'action': action, 'error': reply_data}, status_code=400)
        return {'status': 'ok', 'action': action, 'data': reply_data}

    @app.post('/api/restart')
    def api_restart():
        """Request the backend to restart via nodemanager or process re-exec."""
        from configuration.extended_backend import _restart_process

        try:
            # Prefer nodemanager-controlled restart if available
            if backend and hasattr(backend, '_devices') and 'nodemanager' in backend._devices:
                nm = backend._devices.get('nodemanager')
                try:
                    nm.run_task(nm._delayed_restart())
                    return JSONResponse({'status': 'ok', 'method': 'nodemanager'}, status_code=202)
                except Exception:
                    pass

            # Fallback: restart the current process directly.
            def _delayed_restart_process():
                """Restart the current backend process after a short delay."""
                try:
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

            return JSONResponse({'status': 'ok', 'method': 'process_restart'}, status_code=202)

        except Exception as exc:
            return _error(str(exc), 500)

    # ------------------------------------------------------------------
    # Static assets: SVG library, device params, and the React SPA build
    # ------------------------------------------------------------------

    @app.get('/c/device_params.json')
    def serve_device_params():
        """Serve the generated device parameter metadata for the frontend."""
        file_path = os.path.join(CONFIG_DIR, 'device_params.json')
        if not os.path.isfile(file_path):
            return _not_found()
        return FileResponse(file_path, media_type='application/json')

    @app.get('/c/nodes.json')
    def serve_nodes():
        """Serve the configured SECoP node list for the frontend."""
        file_path = os.path.join(CONFIG_DIR, 'nodes.json')
        if not os.path.isfile(file_path):
            return _not_found()
        return FileResponse(file_path, media_type='application/json')

    if os.path.isdir(ASSETS_DIR):
        app.mount('/c/assets', StaticFiles(directory=ASSETS_DIR), name='assets')

    if os.path.isdir(FRONTEND_DIST):
        app.mount('/', SPAStaticFiles(directory=FRONTEND_DIST, html=True), name='spa')

    return app


def run_api_server(backend=None, host='0.0.0.0', port=8001):
    """Run the FastAPI application in a daemon thread and return server/thread."""
    app = create_app(backend)
    # log_config=None: uvicorn's default logging setup builds color formatters
    # that query sys.stdout.isatty(), which raises under the spin startup in
    # Docker (stdout may already be closed there) and crashes the whole config.
    config = uvicorn.Config(app, host=host, port=port, log_level='info', access_log=False, log_config=None)
    server = uvicorn.Server(config)

    def _run():
        """Run the uvicorn server coroutine on a dedicated event loop."""
        try:
            asyncio.run(server.serve())
        except Exception as exc:
            try:
                print(f'FastAPI server on :{port} stopped: {exc}')
            except Exception:
                pass

    thread = threading.Thread(target=_run, name='spin-fastapi-server', daemon=True)
    thread.start()
    try:
        print(f'FastAPI API listening on http://{host}:{port} (REST /api/*, WS /ws)')
    except Exception:
        pass
    return server, thread
