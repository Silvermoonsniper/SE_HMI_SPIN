from spin.config import Config, Device, Page, Param

from frappy.client import SecopClient



def extract_modules_and_parameters(data):
    modules = data.get("modules", {})
    module_list = list(modules.keys())

    parameter_map = {}

    for module_name, module_info in modules.items():
        params = module_info.get("accessibles", {})
        parameter_list = []

        for param_name, param_info in params.items():
            datainfo = param_info.get("datainfo", {})

        
            parameter_list.append(param_name)

        parameter_map[module_name] = parameter_list

    return module_list, parameter_map


url = "localhost:10801"


gas_dosing: SecopClient = SecopClient(url)

gas_dosing.connect()

# connect to sec node and extract all module names, and parameters
modulelist , para_List = extract_modules_and_parameters(gas_dosing.descriptive_data)


dev_config = {}

for module in modulelist:
     
     params = []
     for para_name in para_List[module]:
           params.append(Param(para_name))
    

     dev_config[module] = ( Device(f"secop://{url}/{module}",
                     pollinterval=1.0,
                     # Expose additional commonly useful parameters so the
                     # frontend can display them in the "More" panel.
                     params= params))


config = Config()
config.server = '0.0.0.0:8000'
config.control_url = 'http://localhost:8080/'
config.plugins = []
config.pages = {
    'default': Page('../content/gas_dosing.html',readonly=False),
}

print(dev_config)
config.devices = dev_config
# config.devices = {
#     'massflow_contr1':  Device('secop://localhost:10801/massflow_contr1',
#                      pollinterval=1.0,
#                      # Expose additional commonly useful parameters so the
#                      # frontend can display them in the "More" panel.
#                      params=[
#                          Param('value'),
#                          Param('target'),
#                          Param('setpoint'),
#                          Param('status'),
#                          Param('ramp'),
#                          Param('_gastype'),
                        
#                      ] ),
#     'massflow_contr2': Device('secop://localhost:10801/massflow_contr2',
#                      pollinterval=1.0,
#                      params=[
#                          Param('value'),
#                          Param('target'),
#                          Param('setpoint'),
#                          Param('status'),
#                          Param('ramp'),
#                          Param('_gastype'),
#                      ]), 
# }