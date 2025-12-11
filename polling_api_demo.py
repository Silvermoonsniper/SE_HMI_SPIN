from flask_cors import CORS

# Simple Flask API for polling latest SECoP values
from flask import Flask, jsonify
import threading
import time
from configuration.node_manager import connect_and_fetch_params
from frappy.client import SecopClient
import json
import os
from configuration.conf import resolve_host
# This should be replaced with your actual device value retrieval logic
latest_values = {}

def update_real_values():
    
    # Load nodes from nodes.json
    nodes_path = os.path.join(os.path.dirname(__file__), 'configuration', 'nodes.json')
    with open(nodes_path, 'r') as f:
        nodes = json.load(f)
    # Load device params from device_params.json
    params_path = os.path.join(os.path.dirname(__file__), 'configuration', 'device_params.json')
    with open(params_path, 'r') as f:
         device_params = json.load(f)
  
    # Build devices list: match host/port to device name
    devices = []
    clients = {}
    for node in nodes:
        host = node['host']
        port = node['port']
        for devname, devinfo in device_params.items():
            # Collect all numeric params, both writable and readonly
      
           
            all_params = devinfo.get("all_params", [])
            devices.append({"host": host, "port": port, "name": devinfo["original_name"], "devkey": devname, "params": all_params})
            # Connect client once per device
            resolved_host = resolve_host(host)
            client_key = f'{resolved_host}:{port}'
            if client_key not in clients:
                client = SecopClient(client_key)
                client.connect()
                clients[client_key] = client
           
    while True:
        for device in devices:
            try:
                client_key = f'{resolve_host(device["host"])}:{device["port"]}'
                client = clients[client_key]
                
                for param in device["params"]:
                    key = f'{device["devkey"]}.{param}'
                    
                    value = client.readParameter(device["name"], param)
                   
                    val = value.value
                    if isinstance(val, (float, int)) or (isinstance(val, (list, tuple)) and all(isinstance(x, (float, int)) for x in val)):
                        latest_values[key] = {
                            "value": val,
                            "unit": str(getattr(value, 'unit', '')),
                            "state": str(getattr(value, 'state', '')),
                            "state_str": str(getattr(value, 'state_str', ''))
                        }
                    else:
                        print(f"Skipping non-numeric value for {key}: {val}")
            except Exception as e:
                print(f"Error polling {param}")
        time.sleep(1)

# Start the real value updater in a background thread
threading.Thread(target=update_real_values, daemon=True).start()

app = Flask(__name__)
CORS(app)
@app.route('/api/latest_values')
def get_latest_values():
    # Print latest_values for debugging
    
    # Return the latest values as JSON
    return jsonify(latest_values)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8001, debug=True)
