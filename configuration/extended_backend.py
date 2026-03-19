from spin.backend import Backend, Update, State, Reply
import asyncio
import os, json
import threading
from flask import Flask, jsonify, request
from flask_cors import CORS
"""
an extended backend to poll all device parameters to port 8001 every poll_interval
for frontend spin updates
"""
class ExtendedBackend(Backend):
    # Store latest values for API
    latest_values = {}
    
    async def poll_all_parameters(self, poll_interval=2):
       
        while True:
            for devname, dev in self._devices.items():
               

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

        # Try to find exact device in backend._devices
        try:
            if backend and hasattr(backend, '_devices'):
                dev_obj = backend._devices.get(device)
                if dev_obj and hasattr(dev_obj, '_conn') and getattr(dev_obj._conn, 'addr', None):
                    return jsonify({'status': 'ok', 'addr': dev_obj._conn.addr})

                # fallback: search by device.device attribute or device name substring
                for k, v in backend._devices.items():
                    try:
                        # v.device is the module name held in Device
                        if getattr(v, 'device', None) == device or k == device or device in k:
                            if hasattr(v, '_conn') and getattr(v._conn, 'addr', None):
                                return jsonify({'status': 'ok', 'addr': v._conn.addr})
                    except Exception:
                        continue
        except Exception as e:
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
