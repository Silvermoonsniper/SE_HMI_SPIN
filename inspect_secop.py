from frappy.client import SecopClient
import json

url = "localhost:10801"
client = SecopClient(url)
client.connect()

data = client.descriptive_data
modules = data.get("modules", {})

# Inspect the first module to see structure
first_module_name = list(modules.keys())[0]
module = modules[first_module_name]

print(f"--- Module: {first_module_name} ---")
print("Keys in module:", module.keys())

if 'commands' in module:
    print("\n--- Commands ---")
    for cmd_name, cmd_info in module['commands'].items():
        print(f"Command: {cmd_name}, Info: {cmd_info}")

if 'accessibles' in module:
    print("\n--- Checking specific accessibles ---")
    for name in ['stop', '_factory_reset', 'target']:
        if name in module['accessibles']:
            info = module['accessibles'][name]
            datainfo = info.get('datainfo', {})
            print(f"Name: {name}")
            print(f"  Readonly: {info.get('readonly')}")
            print(f"  Datainfo Type: {datainfo.get('type')}")
            print(f"  Full Datainfo: {datainfo}")
