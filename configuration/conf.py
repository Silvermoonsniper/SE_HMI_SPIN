from spin.config import Config, Device, Page, Param
import json
import os
from frappy.client import SecopClient

NODES_FILE = os.path.join(os.path.dirname(__file__), 'nodes.json')

def extract_modules_and_parameters(data, prefix=""):
    modules = data.get("modules", {})
    
    parameter_map = {}
    device_data_map = {}
    module_list = []

    for module_name, module_info in modules.items():
        # Create unique name if prefix provided
        unique_name = f"{prefix}_{module_name}" if prefix else module_name
        module_list.append((module_name, unique_name))

        params = module_info.get("accessibles", {})
        parameter_list = []
        writable_list = []
        command_list = []

        for param_name, param_info in params.items():
            datainfo = param_info.get("datainfo", {})
            dtype = datainfo.get("type")
        
            parameter_list.append(param_name)
            
            if dtype == 'command':
                command_list.append(param_name)
            elif not param_info.get("readonly", False):
                writable_list.append(param_name)

        parameter_map[unique_name] = parameter_list
        device_data_map[unique_name] = {
            "params": writable_list,
            "commands": command_list,
            "original_name": module_name
        }

    return module_list, parameter_map, device_data_map

def connect_node(host, port):
    url = f"{host}:{port}"
    prefix = ""
    print(f"Connecting to {url}...")
    
    try:
        client = SecopClient(url)
        client.connect()
        
        mod_list, para_map, dev_data = extract_modules_and_parameters(client.descriptive_data, prefix)
        return mod_list, para_map, dev_data
            
    except Exception as e:
        print(f"Failed to connect to {url}: {e}")
        return [], {}, {}

# Load nodes configuration
nodes_file = NODES_FILE
nodes = []
if os.path.exists(nodes_file):
    try:
        with open(nodes_file, 'r') as f:
            nodes = json.load(f)
    except Exception as e:
        print(f"Error loading nodes.json: {e}")

if not nodes:
    print("No nodes configured in nodes.json. Using default.")
    # Don't force default if file exists but empty, only if no file/config
    # But here we just proceed.

all_device_data = {}
dev_config = {}

# Initial connection
for node in nodes:
    host = node.get("host", "localhost")
    port = node.get("port", 10801)
    url = f"{host}:{port}"
    
    mod_list, para_map, dev_data = connect_node(host, port)
    
    # Merge into global data
    all_device_data.update(dev_data)
    
    # Configure Spin devices
    for original_name, unique_name in mod_list:
        params = []
        for para_name in para_map[unique_name]:
            params.append(Param(para_name))
        
        dev_config[unique_name] = Device(
            f"secop://{url}/{original_name}",
            pollinterval=1.0,
            params=params
        )

# Add NodeManager device
dev_config['nodemanager'] = Device('nodemanager://localhost', pollinterval=1.0)

config = Config()
config.server = '0.0.0.0:8000'
config.control_url = 'http://localhost:8080/'
config.plugins = [os.path.abspath(os.path.join(os.path.dirname(__file__), 'node_manager.py'))]
config.pages = {
    'default': Page('../content/system.html', readonly=False),
}

config.devices = dev_config

# Write device data (params + commands) to JSON file for frontend
json_path = os.path.join(os.path.dirname(__file__), 'device_params.json')
try:
    with open(json_path, 'w') as f:
        json.dump(all_device_data, f)
    print(f"Device data saved to {json_path}")
except Exception as e:
    print(f"Error saving device data: {e}")

