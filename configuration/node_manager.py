from spin.device import BaseDevice
from spin.backend import Reply
import json
import os
from frappy.client import SecopClient

NODES_FILE = os.path.join(os.path.dirname(__file__), 'nodes.json')
DEVICE_PARAMS_FILE = os.path.join(os.path.dirname(__file__), 'device_params.json')

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

def connect_and_fetch_params(host, port):
    url = f"{host}:{port}"
    # No prefix for device names as per user request
    prefix = "" 
    print(f"Connecting to {url}...")
    
    try:
        client = SecopClient(url)
        client.connect()
        
        mod_list, para_map, dev_data = extract_modules_and_parameters(client.descriptive_data, prefix)
        return dev_data
            
    except Exception as e:
        print(f"Failed to connect to {url}: {e}")
        return {}

class NodeManagerDevice(BaseDevice):
    def init(self):
        self.log.info("NodeManager initialized")
        self.update_nodes_param()

    def update_nodes_param(self):
        nodes = []
        if os.path.exists(NODES_FILE):
            with open(NODES_FILE, 'r') as f:
                try:
                    nodes = json.load(f)
                except:
                    pass
        # We need to run this in the event loop
        self.run_task(self.send_param('nodes', nodes, ''))

    def update_device_params_param(self):
        data = {}
        if os.path.exists(DEVICE_PARAMS_FILE):
            try:
                with open(DEVICE_PARAMS_FILE, 'r') as f:
                    data = json.load(f)
            except:
                pass
        self.run_task(self.send_param('device_params', data, ''))

    async def handle_request(self, request):
        # request.key is 'nodemanager.something'
        cmd = request.key.split('.')[-1]
        
        if cmd == 'add_node':
            try:
                data = request.data
                if isinstance(data, str):
                    data = json.loads(data)
                
                host = data.get('host')
                port = data.get('port')
                
                # Update nodes.json
                nodes = []
                if os.path.exists(NODES_FILE):
                    with open(NODES_FILE, 'r') as f:
                        try:
                            nodes = json.load(f)
                        except:
                            pass
                
                exists = False
                for n in nodes:
                    if n.get('host') == host and str(n.get('port')) == str(port):
                        exists = True
                        break
                
                if not exists:
                    nodes.append({"host": host, "port": int(port)})
                    with open(NODES_FILE, 'w') as f:
                        json.dump(nodes, f, indent=2)
                
                # Fetch params from new node and update device_params.json
                new_dev_data = connect_and_fetch_params(host, port)
                if new_dev_data:
                    all_data = {}
                    if os.path.exists(DEVICE_PARAMS_FILE):
                        try:
                            with open(DEVICE_PARAMS_FILE, 'r') as f:
                                all_data = json.load(f)
                        except:
                            pass
                    
                    all_data.update(new_dev_data)
                    
                    with open(DEVICE_PARAMS_FILE, 'w') as f:
                        json.dump(all_data, f)
                        
                    self.update_device_params_param()

                self.update_nodes_param()
                
                return Reply(request.connection, request.key, request.transform, 'ack', 
                             {"status": "ok", "message": "Node added. Please restart server."})
            except Exception as e:
                return Reply(request.connection, request.key, request.transform, 'error', str(e))

        elif cmd == 'list_nodes':
            self.update_nodes_param()
            return None

        elif cmd == 'get_device_params':
            self.update_device_params_param()
            return None
            
        return None

def init_plugin(conf, loop):
    return {
        'protos': {
            'nodemanager': NodeManagerDevice
        }
    }

