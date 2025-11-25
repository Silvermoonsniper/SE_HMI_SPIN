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
                     # Expose additional commonly useful parameters so the
                     # frontend can display them in the "More" panel.
                     params=[
                         Param('value'),
                         Param('target'),
                         Param('setpoint'),
                         Param('status'),
                         Param('ramp'),
                         Param('_gastype'),
                        
                     ] ),
    'massflow_contr2': Device('secop://localhost:10801/massflow_contr2',
                     pollinterval=1.0,
                     params=[
                         Param('value'),
                         Param('target'),
                         Param('setpoint'),
                         Param('status'),
                         Param('ramp'),
                         Param('_gastype'),
                     ]), 
}