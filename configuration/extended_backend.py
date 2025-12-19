from spin.backend import Backend, Update, State
import asyncio
import os, json
from flask import Flask, jsonify
from flask_cors import CORS
from waitress import serve
from threading import Thread
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
                        
                        # Store latest value of all parameters for API
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
        # Start Flask API server for latest values in a thread
        start_api_server()


def start_api_server():
   
    app = Flask(__name__)
   
    CORS(app)
   
    @app.route('/api/latest_values')
   
    def get_latest_values():
   
        return jsonify(ExtendedBackend.latest_values)
   
    
    # start WSGI server in background with separate thread
    def run_waitress():
         serve(app, host='0.0.0.0', port=8001)

   # Start in a background thread
    Thread(target=run_waitress, daemon=True).start()

 
    
