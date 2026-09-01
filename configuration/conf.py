"""Spin configuration bootstrap utilities and startup wiring for the SE HMI."""

from spin.config import Config, Device, Page, Param
import json
import os
import asyncio
from frappy.client import SecopClient
from configuration.extended_backend import ExtendedBackend
import mlzlog,time
import socket
# Increase asyncio stream reader limit to handle large plotly parameters
# Default is 64KB, we increase to 10MB
asyncio.streams._DEFAULT_LIMIT = 10 * 1024 * 1024

NODES_FILE = os.path.join(os.path.dirname(__file__), 'nodes.json')

def is_running_in_docker():
    """Check if the application is running inside a Docker container."""
    return os.path.exists('/.dockerenv') or os.path.exists('/run/.containerenv')

def resolve_host(host):
    """
    Resolve the host address based on whether we're running in Docker.
    - Both macOS and Linux: localhost -> host.docker.internal
    - We use extra_hosts in docker-compose.yml to make this work on Linux
    """
    if not is_running_in_docker():
        return host
    
    # If not localhost, return as-is
    if host not in ('localhost', '127.0.0.1'):
        return host
    
    # In Docker, always use host.docker.internal
    # (configured via extra_hosts in docker-compose.yml for Linux)
    return 'host.docker.internal'



def connect_node(host, port):
    """Resolve a node address before connecting to it.

    This top-level helper is currently kept only for compatibility.
    """
    # Resolve the host for Docker environment
    resolved_host = resolve_host(host)
    return f"{resolved_host}:{port}"



# Top-level SpinConfigManager class for use by spin and as script
class SpinConfigManager:
    """Discover SECoP nodes and build the runtime Spin configuration."""
    
    def __init__(self, nodes_file=None):
        """Initialize file paths and in-memory config state."""
    
        self.base_dir = os.path.dirname(__file__)
    
        self.NODES_FILE = nodes_file or os.path.join(self.base_dir, 'nodes.json')
    
        self.DEVICE_PARAMS_FILE = os.path.join(self.base_dir, 'device_params.json')
    
        self.config = None
    
        self.nodes = []

   

    def resolve_host(self, host):
        """Return the host string to use for direct node access.

        Bug fix: delegate to the module-level resolve_host() so that
        'localhost' is translated to 'host.docker.internal' when running in
        Docker. Previously this returned 'localhost' unchanged, so nodes added
        with a localhost address became unreachable after every container
        restart and device_params.json was overwritten with an empty object.
        """

        return resolve_host(host)

    def extract_modules_and_parameters(self, data, prefix=""):
        """Extract module names and parameter metadata from SECoP descriptive data."""

        modules = data.get("modules", {})

        parameter_map = {}

        device_data_map = {}

        module_list = []

        for module_name, module_info in modules.items():

            unique_name = f"{prefix}_{module_name}" if prefix else module_name

            module_list.append((module_name, unique_name))

            params = module_info.get("accessibles", {})

            parameter_list = []

            writable_list = []

            command_list = []

            param_info_List = []

            for param_name, param_info in params.items():

                datainfo = param_info.get("datainfo", {})

                dtype = datainfo.get("type")

                parameter_list.append(param_name)

                if dtype == 'command':

                    command_list.append(param_name)

                elif not param_info.get("readonly", False):

                    writable_list.append(param_name)

                param_info_List.append({param_name: param_info})

            parameter_map[unique_name] = parameter_list

            device_data_map[unique_name] = {

                "params": writable_list,

                "all_params": parameter_list,

                "commands": command_list,

                "original_name": module_name,

                "interface_classes": module_info.get("interface_classes", []),

                "module_name": module_name,

                "param_info": list(param_info_List),
            }

        return module_list, parameter_map, device_data_map

    def connect_node(self, host, port):
        """Connect to one node and collect module and parameter metadata."""

        resolved_host = self.resolve_host(host)

        url = f"{resolved_host}:{port}"

        print(f"Connecting to {url}...")

        try:

            client = SecopClient(url)

            client.connect()

            equipment_id = client.descriptive_data.get("equipment_id", "")

            prefix = equipment_id if equipment_id else ""

            mod_list, para_map, dev_data = self.extract_modules_and_parameters(client.descriptive_data, prefix)

            if equipment_id:

                print(f"{equipment_id} ready")

            return mod_list, para_map, dev_data

        except Exception as e:

            print(f"Failed to connect to {url}: {e}")

            return [], {}, {}

    async def discover_and_save_nodes(self, timeout=2.0):
            """Broadcast a SECoP discovery request and persist discovered nodes."""
            
            class FrappyDiscoveryProtocol(asyncio.DatagramProtocol):
                """Collect UDP discovery responses from reachable SECoP nodes."""
   
                def __init__(self):
                    """Prepare transport and response storage."""
   
                    self.transport = None
   
                    self.responses = []
   
                def connection_made(self, transport):
                    """Store the datagram transport used for discovery replies."""
   
                    self.transport = transport
                
                def get_local_ip(self):
                   """Best-effort detection of the local outbound IPv4 address."""
                   s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                   
                   s.settimeout(0)
                   
                   try:
                       s.connect(('8.8.8.8', 1))  # Connecting to an external address (Google DNS)
                       local_ip = s.getsockname()[0]  # Get the local IP address
                   except Exception:
                       local_ip = '127.0.0.1'  # If it fails, fallback to localhost
                   finally:
                       s.close()
                   return local_ip    
   
                def datagram_received(self, data, addr):
                    """Parse one discovery response and deduplicate the node entry."""

                    # get local ip 
                    local_ip = self.get_local_ip()  
                    # Ignore responses from localhost (127.0.0.1)
                    # if addr[0] != local_ip:
                    #        return
                    try:
   
                        response = data.decode('utf-8').strip()
   
                        desc = json.loads(response)
   
                        if desc.get('SECoP') == 'node':
   
                            node_info = {
   
                                'host': addr[0],
                                'port': desc.get('port', addr[1]),
                                'equipment_id': desc.get('equipment_id', ''),
                                'firmware': desc.get('firmware', ''),
                                'description': desc.get('description', ''),
                            }
   
                            if not any(n['host'] == node_info['host'] and n['port'] == node_info['port'] for n in self.responses):
   
                                self.responses.append(node_info)
   
                    except Exception as e:
   
                        print(f"Error parsing discovery response: {e}")
            
            DISCOVERY_PORT = 10767
   
            loop = asyncio.get_event_loop()
   
            protocol = FrappyDiscoveryProtocol()
   
            try:
   
                transport, _ = await loop.create_datagram_endpoint(
   
                    lambda: protocol,
   
                    local_addr=('0.0.0.0', 0),
   
                    family=socket.AF_INET,
   
                    allow_broadcast=True
                )
   
                discovery_msg = json.dumps({'SECoP': 'discover'}).encode('utf-8')
   
                transport.sendto(discovery_msg, ('255.255.255.255', DISCOVERY_PORT))
   
                await asyncio.sleep(timeout)
                
               
                discovered_nodes = protocol.responses
                
                      

                transport.close()
   
            except Exception as e:
   
                print(f"Discovery error: {e}")
   
                discovered_nodes = []
            # Write discovered nodes to nodes.json
            with open(self.NODES_FILE, 'w') as f:
   
                json.dump([{'host': n['host'], 'port': n['port']} for n in discovered_nodes], f, indent=2)
   
            self.nodes = [{'host': n['host'], 'port': n['port']} for n in discovered_nodes]
   
            return self.nodes

    def spin_server_start(self, nodes):
            """Build the Spin Config object and device metadata from discovered nodes."""
   
            all_device_data = {}
   
            dev_config = {}
   
            for node in nodes:
   
                host = node.get("host", "localhost")
   
                port = node.get("port", 10801)
   
                mod_list, para_map, dev_data = self.connect_node(host, port)
              
                for dev_name, dev_info in dev_data.items():
                    
                    all_device_data[dev_name] = dev_info
               
                resolved_host = self.resolve_host(host)
   
                url = f"{resolved_host}:{port}"
   
                for original_name, unique_name in mod_list:
   
                    params = [Param(para_name) for para_name in para_map.get(unique_name, [])]
   
                    dev = Device(
                        f"secop://{url}/{original_name}",
                        pollinterval=1.0,
                        params=params
                    )
   
                    dev.all_params = para_map.get(unique_name, [])
   
                    dev_config[unique_name] = dev
   
         
            config = Config()
   
            config.server = '0.0.0.0:8000'
   
            config.control_url = None
   
            config.plugins = [os.path.abspath(os.path.join(self.base_dir, 'node_manager.py'))]
   
            # The React + FastAPI frontend (port 8001) is now the single UI.
            # Spin's page-serving on :8000 is retired; point all pages at a
            # minimal stub so the spin backend keeps starting cleanly.
            config.pages = {
                'default': Page('../content/index.html', readonly=False),
            }
            dev_config['nodemanager'] = Device('nodemanager://localhost', pollinterval=1.0)
   
            config.devices = dev_config
           
            # Write device data (params + commands) to JSON file for frontend
            try:
   
                with open(self.DEVICE_PARAMS_FILE, 'w') as f:
                    
                    json.dump(all_device_data, f)
   
                print(f"Device data saved to {self.DEVICE_PARAMS_FILE}")
   
            except Exception as e:
   
                print(f"Error saving device data: {e}")
   
            self.config = config
            
          
   
            return config

    def start_extended_backend(self, config):
            """Start the extended backend that serves polling and Flask APIs."""
   
            loop = asyncio.get_event_loop()
   
            connections = []
   
            log = mlzlog.getLogger("spin")
   
            backend = ExtendedBackend(loop, connections, log)
   
            backend.start(config, [])





  


# For compatibility with spin: expose 'config' as a global variable
manager = SpinConfigManager()

# Prefer an existing nodes.json (useful when running in Docker where UDP discovery fails).
# If nodes.json exists, load it and use those entries; otherwise run discovery.
nodes = []
if os.path.exists(NODES_FILE):
    try:
        with open(NODES_FILE, 'r') as f:
            loaded_nodes = json.load(f)
        if isinstance(loaded_nodes, list):
            nodes = loaded_nodes
        else:
            print(f"Ignoring invalid node list in {NODES_FILE}: expected list, got {type(loaded_nodes).__name__}")
        print(f"Using nodes from {NODES_FILE}: {nodes}")
    except Exception as e:
        print(f"Failed to read {NODES_FILE}, falling back to discovery: {e}")

if not nodes:
      nodes = asyncio.get_event_loop().run_until_complete(manager.discover_and_save_nodes(timeout=1.0))


config = manager.spin_server_start(nodes)

time.sleep(5)

# Start the extended backend (poller + Flask API) so frontend can poll latest values
manager.start_extended_backend(config)



