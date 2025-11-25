from spin.config import Config, Device, Page, Param

config = Config()
config.server = '0.0.0.0:8000'
config.control_url = 'http://localhost:8080/'
config.plugins = []
config.pages = {
    'default': Page('../content/gas_dosing.html',readonly=False),
}
config.devices = {
    'massflow_contr1':  Device('secop://localhost:10801/massflow_contr1',
                     pollinterval=1.0,
                     params=[Param('value'), Param('target')] ),
    'massflow_contr2': Device('secop://localhost:10801/massflow_contr2',
                     pollinterval=1.0,
                     params=[Param('value'), Param('target')]), 
}