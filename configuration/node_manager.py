
from spin.device import BaseDevice
from spin.backend import Reply
import json
import os
import asyncio
from frappy.client import SecopClient
import time

# Increase asyncio stream reader limit to handle large plotly parameters
# Default is 64KB, we increase to 10MB
asyncio.streams._DEFAULT_LIMIT = 10 * 1024 * 1024

NODES_FILE = os.path.join(os.path.dirname(__file__), 'nodes.json')

DEVICE_PARAMS_FILE = os.path.join(os.path.dirname(__file__), 'device_params.json')

LAYOUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'layout'))

def ensure_layout_dir():

    try:

        os.makedirs(LAYOUT_DIR, exist_ok=True)

    except Exception as e:

        print(f"Failed to create layout dir {LAYOUT_DIR}: {e}")

def is_running_in_docker():
    """Check if the application is running inside a Docker container."""

    return os.path.exists('/.dockerenv') or os.path.exists('/run/.containerenv')

def resolve_host(host):
    """
    Resolve the host address based on whether we're running in Docker.
    - On macOS/Windows: localhost -> host.docker.internal
    - On Linux: localhost -> host.docker.internal (requires --add-host in docker-compose)
    """
    if not is_running_in_docker():

        return host
    
    # If not localhost, return as-is
    if host not in ('localhost', '127.0.0.1'):

        return host
    
    # In Docker, use host.docker.internal to access host services
    return 'host.docker.internal'

"""

args:
    data: dict - descriptive data from SEC node
returns:
    module_list: list of (module_name, unique_name) tuples
    parameter_map: dict of unique_name -> list of parameter names
    device_data_map: dict of unique_name -> device data dict
       
"""
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
 
        param_info_map = {}

        for param_name, param_info in params.items():
 
            datainfo = param_info.get("datainfo", {})
 
            dtype = datainfo.get("type")
        
            parameter_list.append(param_name)
            
            # Extract datainfo for enum parameters
            if datainfo:
 
                param_metadata = {}
 
                # Check if it's an enum type
                if "members" in datainfo:
 
                    param_metadata["members"] = datainfo["members"]
                # Store type info
 
                if "type" in datainfo:
 
                    param_metadata["type"] = datainfo["type"]
                # Store min/max for numeric types
                if "min" in datainfo:
 
                    param_metadata["min"] = datainfo["min"]
                if "max" in datainfo:
 
                    param_metadata["max"] = datainfo["max"]
                
                if param_metadata:
 
                    param_info_map[param_name] = param_metadata
            
            if dtype == 'command':
 
                command_list.append(param_name)
 
            elif not param_info.get("readonly", False):
 
                writable_list.append(param_name)

        parameter_map[unique_name] = parameter_list
 
        device_data_map[unique_name] = {
 
            "params": writable_list,
 
            "all_params": list(params.keys()),  # all accessible parameters, including readonly
 
            "commands": command_list,
 
            "original_name": module_name,
 
            "interface_classes": module_info.get("interface_classes", []),
 
            "param_info": param_info_map,
 
            "accessibles": params  # include full accessibles dict for later use
        }

    return module_list, parameter_map, device_data_map

"""
args:
   
   host: str - hostname or IP of the node manager
   
   port: int - port number of the node manager

returns:
   mod_list: list of (module_name, unique_name) tuples
   para_map: dict of unique_name -> list of parameter names
   dev_data: dict of unique_name -> device data dict
"""
def connect_and_fetch_params(host, port):
    # Resolve the host for Docker environment
    resolved_host = resolve_host(host)
 
    url = f"{resolved_host}:{port}"
    
    
    try:
        # Create client and connect
        client = SecopClient(url)
      
        client.connect()
        
        # Extract the equipment_id (SEC node name) to use as prefix
      
        equipment_id = client.descriptive_data.get("equipment_id", "")
      
        # Use equipment_id as prefix to create unique device names
      
        prefix = equipment_id if equipment_id else ""
        
        mod_list, para_map, dev_data = extract_modules_and_parameters(client.descriptive_data, prefix)
        
        # Print the ready message with the node name
        if equipment_id:
      
            print(f"{equipment_id} ready")
        
        return mod_list, para_map, dev_data
            
    except Exception as e:
      
        print(f"Failed to connect to {url}: {e}")
      
        return None, None, None

class NodeManagerDevice(BaseDevice):
    
    def read(self, param):
        # Try to read from attributes, or return None if not found
        # You can extend this logic to read from internal state, files, etc.
        return getattr(self, param, None)
    
    def init(self):
    
        self.log.info("NodeManager initialized")
    
 

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
        # Ensure all_params is present and up to date for each device
      
        for dev, info in data.items():
            # Compute a robust all_params as the union of all known sources:
            # - keys of 'accessibles' (if present),
            # - 'params' (writable parameters),
            # - 'commands',
            # - keys from 'param_info' (metadata for params)
            ap_set = set()

            if 'accessibles' in info and isinstance(info['accessibles'], dict):
                try:
                    ap_set.update(info['accessibles'].keys())
                except Exception:
                    pass

            if 'params' in info and isinstance(info['params'], (list, tuple)):
                ap_set.update(info['params'])

            if 'commands' in info and isinstance(info['commands'], (list, tuple)):
                ap_set.update(info['commands'])

            if 'param_info' in info and isinstance(info['param_info'], dict):
                ap_set.update(info['param_info'].keys())

            all_params = sorted([p for p in ap_set if p is not None])

            if info.get('all_params') != all_params:
                info['all_params'] = all_params
         
      
      
    
        self.run_task(self.send_param('device_params', data, ''))

    async def _clear_status(self):
        await asyncio.sleep(3)
        await self.send_param('status', '', '')

    async def _delayed_restart(self, delay=2):
        """Delay a short time and then exit the process so the container restarts it.

        We use os._exit to ensure the process terminates even if other tasks are running.
        Docker's restart policy (unless-stopped) will bring the container back up.
        """
        try:
            await asyncio.sleep(delay)
        except Exception:
            pass
        try:
            self.log.info("NodeManager requested restart to pick up new node configuration")
        except Exception:
            pass
        # Force exit; allow container runtime to restart the service
        os._exit(0)

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
               
                # Verify connection first
                mod_list, para_map, new_dev_data = connect_and_fetch_params(host, port)
          
                if not new_dev_data:
                    msg = f"Failed to connect to node {host}:{port}"
                   
                    self.run_task(self.send_param('status', msg, ''))
                    self.run_task(self._clear_status())
                    return Reply(request.connection, request.key, request.transform, 'error', msg)

                # Update nodes.json
                nodes = []
                if os.path.exists(NODES_FILE):
                    with open(NODES_FILE, 'r') as f:
                        try:
                            nodes = json.load(f)
                        except Exception as e:
                            print(f"[add_node] Failed to load nodes.json: {e}")
                exists = False
                for n in nodes:
                    if n.get('host') == host and str(n.get('port')) == str(port):
                        exists = True
                        break
                if not exists:
                    
                    nodes.append({"host": host, "port": int(port)})
                    try:
                        with open(NODES_FILE, 'w') as f:
                            json.dump(nodes, f, indent=2)
                        # ...removed debug print...
                    except Exception as e:
                        print(f"[add_node] Failed to write nodes.json: {e}")
                else:
                    print(f"[add_node] Node already exists in nodes.json: {host}:{port}")

                # Update device_params.json with fetched data
                if new_dev_data:
                    all_data = {}
                    if os.path.exists(DEVICE_PARAMS_FILE):
                        try:
                            with open(DEVICE_PARAMS_FILE, 'r') as f:
                                all_data = json.load(f)
                        except Exception as e:
                            print(f"[add_node] Failed to load device_params.json: {e}")

                    # Merge new_dev_data into all_data to avoid losing fields
                    for dev, info in new_dev_data.items():
                        # Ensure shapes
                        if 'param_info' not in info or not isinstance(info.get('param_info'), dict):
                            info['param_info'] = info.get('param_info', {}) or {}

                        existing = all_data.get(dev, {}) or {}

                        # Merge accessibles: prefer the new one if present, otherwise keep existing
                        accessibles = info.get('accessibles') if isinstance(info.get('accessibles'), dict) else existing.get('accessibles')

                        # Merge params (writable) and commands as union of lists
                        existing_params = existing.get('params') or []
                        new_params = info.get('params') or []
                        merged_params = sorted(list({*existing_params, *new_params}))

                        existing_cmds = existing.get('commands') or []
                        new_cmds = info.get('commands') or []
                        merged_cmds = sorted(list({*existing_cmds, *new_cmds}))

                        # Merge param_info dictionaries
                        merged_param_info = {}
                        merged_param_info.update(existing.get('param_info') or {})
                        merged_param_info.update(info.get('param_info') or {})

                        # Interface classes, original_name
                        interface_classes = existing.get('interface_classes') or []
                        for c in info.get('interface_classes') or []:
                            if c not in interface_classes:
                                interface_classes.append(c)

                        original_name = info.get('original_name') or existing.get('original_name')

                        # Compute all_params from accessibles if available, otherwise union
                        if isinstance(accessibles, dict):
                            all_params = sorted(list(accessibles.keys()))
                        else:
                            ap_set = set()
                            ap_set.update(merged_params)
                            ap_set.update(merged_cmds)
                            ap_set.update(merged_param_info.keys())
                            all_params = sorted(list(ap_set))

                        # Build merged info
                        merged_info = {
                            'params': merged_params,
                            'all_params': all_params,
                            'commands': merged_cmds,
                            'original_name': original_name,
                            'interface_classes': interface_classes,
                            'param_info': merged_param_info,
                        }
                        if isinstance(accessibles, dict):
                            merged_info['accessibles'] = accessibles

                        # Preserve any other existing keys not handled explicitly
                        for k, v in existing.items():
                            if k not in merged_info:
                                merged_info[k] = v

                        all_data[dev] = merged_info

                    try:
                        with open(DEVICE_PARAMS_FILE, 'w') as f:
                            json.dump(all_data, f, indent=2)
                    except Exception as e:
                        print(f"[add_node] Failed to write device_params.json: {e}")

                    # self.update_device_params_param()
                
                self.update_nodes_param()
                   
                msg = "Node added successfully"
                
                self.run_task(self.send_param('status', msg, ''))
              
                self.run_task(self._clear_status())
               
            
            except Exception as e:
               
                self.run_task(self.send_param('status', f"Error: {str(e)}", ''))
            
                self.run_task(self._clear_status())
            
                return Reply(request.connection, request.key, request.transform, 'error', str(e))

        elif cmd == 'list_nodes':
           
            self.update_nodes_param()
           
            return None

        elif cmd == 'get_device_params':
           
            self.update_device_params_param()
           
            return None

        elif cmd == 'save_layout':
            # Save layout JSON to project layout directory
            try:
                data = request.data
                if isinstance(data, str):
                    data = json.loads(data)
                name = data.get('name')
                layout = data.get('layout')
                if not layout:
                    return Reply(request.connection, request.key, request.transform, 'error', 'No layout provided')
                ensure_layout_dir()
                if not name:
                    name = f"layout_{int(time.time())}"
                # sanitize name
                safe_name = ''.join(c for c in name if c.isalnum() or c in (' ', '-', '_')).rstrip()
                file_path = os.path.join(LAYOUT_DIR, safe_name + '.json')
                # Log where we are writing the layout for easier debugging
                try:
                    self.log.info(f"Saving layout '{safe_name}' to {file_path}")
                except Exception:
                    print(f"Saving layout '{safe_name}' to {file_path}")
                with open(file_path, 'w') as f:
                    json.dump(layout, f, indent=2)
                # Return the filesystem path so clients can see where it was written
                return Reply(request.connection, request.key, request.transform, 'ack', {'status': 'ok', 'name': safe_name, 'path': file_path})
            except Exception as e:
                self.log.error(f"save_layout failed: {e}")
                return Reply(request.connection, request.key, request.transform, 'error', str(e))

        elif cmd == 'list_layouts':
            try:
                ensure_layout_dir()
                files = []
                for fname in os.listdir(LAYOUT_DIR):
                    if fname.endswith('.json'):
                        files.append(fname[:-5])
                return Reply(request.connection, request.key, request.transform, 'ack', files)
            except Exception as e:
                self.log.error(f"list_layouts failed: {e}")
                return Reply(request.connection, request.key, request.transform, 'error', str(e))

        elif cmd == 'get_layout':
            try:
                data = request.data
                if isinstance(data, str):
                    data = json.loads(data)
                name = data.get('name') if data else None
                if not name:
                    return Reply(request.connection, request.key, request.transform, 'error', 'No name provided')
                file_path = os.path.join(LAYOUT_DIR, name + '.json')
                if not os.path.exists(file_path):
                    return Reply(request.connection, request.key, request.transform, 'error', 'Not found')
                with open(file_path, 'r') as f:
                    layout = json.load(f)
                return Reply(request.connection, request.key, request.transform, 'ack', layout)
            except Exception as e:
                self.log.error(f"get_layout failed: {e}")
                return Reply(request.connection, request.key, request.transform, 'error', str(e))

        elif cmd == 'delete_layout':
            try:
                data = request.data
                if isinstance(data, str):
                    data = json.loads(data)
                name = data.get('name') if data else None
                if not name:
                    return Reply(request.connection, request.key, request.transform, 'error', 'No name provided')
                file_path = os.path.join(LAYOUT_DIR, name + '.json')
                if os.path.exists(file_path):
                    os.remove(file_path)
            
                    return Reply(request.connection, request.key, request.transform, 'ack', {'status': 'ok'})
                else:
            
                    return Reply(request.connection, request.key, request.transform, 'error', 'Not found')
            
            except Exception as e:
            
                self.log.error(f"delete_layout failed: {e}")
            
                return Reply(request.connection, request.key, request.transform, 'error', str(e))
            
        return None

def init_plugin(conf, loop):
    return {
        'protos': {
            'nodemanager': NodeManagerDevice
        }
    }


# Generic Device base class for all  devices
class Device(BaseDevice):
    def read(self, param):
        # Try to read from attributes, or return None if not found
        return getattr(self, param, None)

