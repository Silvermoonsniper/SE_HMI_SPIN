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
            "commands": command_list,
            "original_name": module_name,
            "interface_classes": module_info.get("interface_classes", []),
            "param_info": param_info_map
        }

    return module_list, parameter_map, device_data_map

async def discover_secop_nodes(timeout=2.0):
    """
    Discover SECoP nodes on the network using UDP broadcast.
    SECoP nodes listen on UDP port 10767 for discovery requests.
    
    Returns:
        list: List of discovered nodes with format [{'host': str, 'port': int, 'equipment_id': str}, ...]
    """
    discovered_nodes = []
    DISCOVERY_PORT = 10767
    
    loop = asyncio.get_event_loop()
    
    # Use asyncio UDP transport for proper async/await support
    class DiscoveryProtocol:
        def __init__(self):
            self.transport = None
            self.responses = []
            
        def connection_made(self, transport):
            self.transport = transport
            
        def datagram_received(self, data, addr):
            try:
                response = data.decode('utf-8').strip()
                # Parse response - typical format: "ISSE,<equipment_id>,<version>,<description>"
                # or just equipment_id
                parts = response.split(',')
                equipment_id = parts[1] if len(parts) > 1 else response
                
                # Default SECoP port is 10767
                node_info = {
                    'host': addr[0],
                    'port': 10767,  # Standard SECoP port
                    'equipment_id': equipment_id.strip()
                }
                
                # Avoid duplicates
                if not any(n['host'] == node_info['host'] for n in self.responses):
                    self.responses.append(node_info)
                    print(f"Discovered SECoP node: {equipment_id} at {addr[0]}")
                    
            except Exception as e:
                print(f"Error parsing discovery response: {e}")
    
    try:
        # Create UDP endpoint
        transport, protocol = await loop.create_datagram_endpoint(
            DiscoveryProtocol,
            allow_broadcast=True
        )
        
        # SECoP discovery message format: "*IDN?\n"
        discovery_msg = b"*IDN?\n"
        
        # Broadcast to all interfaces
        transport.sendto(discovery_msg, ('255.255.255.255', DISCOVERY_PORT))
        
        # Wait for responses
        await asyncio.sleep(timeout)
        
        discovered_nodes = protocol.responses
        transport.close()
        
    except Exception as e:
        print(f"Discovery error: {e}")
    
    return discovered_nodes

def connect_and_fetch_params(host, port):
    # Resolve the host for Docker environment
    resolved_host = resolve_host(host)
    url = f"{resolved_host}:{port}"
    print(f"Connecting to {url}...")
    
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
    def init(self):
        self.log.info("NodeManager initialized")
        self.update_nodes_param()
        self.update_device_params_param()

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

    async def _clear_status(self):
        await asyncio.sleep(3)
        await self.send_param('status', '', '')

    async def handle_request(self, request):
        # request.key is 'nodemanager.something'
        cmd = request.key.split('.')[-1]

        if cmd == 'discover_nodes':
            try:
                self.log.info("Starting SECoP node discovery via UDP...")
                discovered = await discover_secop_nodes(timeout=2.0)
                self.log.info(f"Discovered {len(discovered)} nodes.")
                # Send the list of discovered nodes to the frontend
                self.run_task(self.send_param('discovered_nodes', discovered, ''))
                return Reply(request.connection, request.key, request.transform, 'ack', discovered)
            except Exception as e:
                self.log.error(f"Discovery failed: {e}")
                return Reply(request.connection, request.key, request.transform, 'error', str(e))
        
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
                
                # Update device_params.json with fetched data
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
                
                msg = "Node added successfully. Please restart server to use new devices."
                self.run_task(self.send_param('status', msg, ''))
                self.run_task(self._clear_status())
                
                return Reply(request.connection, request.key, request.transform, 'ack', 
                             {"status": "ok", "message": msg})
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

