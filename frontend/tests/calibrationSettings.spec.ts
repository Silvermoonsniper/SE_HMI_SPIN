import { expect, test } from '@playwright/test'

test('edits calibration struct fields and saves typed values while preserving untouched fields', async ({ page }) => {
  const device = 'demo_MFC_group_1_calibration'
  const moduleName = 'MFC_group_1_calibration'
  const info = {
    module_name: moduleName, params: ['calibration_settings'], commands: ['start', 'stop'],
    all_params: ['calibration_settings'],
    accessibles: { calibration_settings: { readonly: false, datainfo: { type: 'struct', members: {
      dwell: { type: 'double', min: 1, max: 60, unit: 's' },
      enabled: { type: 'bool' }, mode: { type: 'enum', members: { slow: 0, fast: 1 } },
      points: { type: 'array', members: { type: 'double' } },
      calibrate_device: { type: 'enum', members: { massflow_contr0: 0 } },
      calibration_target_array: { type: 'array', members: { type: 'double' } },
      correction: { type: 'struct', members: { offset: { type: 'double' } } },
    } } } },
  }
  let settings = { dwell: 10, enabled: true, mode: 0, points: [0, 25], correction: { offset: 2 }, untouched: 'keep me',
    calibrate_device: 0, calibration_target_array: [0, 10, 20, 30, 40, 50] }
  let results = { measurement: [0, 9.8], inverse_calib_coeff: [0.1, 1.02], forward_calib_coeff: [-0.1, 0.98] }
  const writes: unknown[] = []
  let failSave = true
  await page.route('**/c/device_params.json', (route) => route.fulfill({ json: { [device]: info,
    flow_controller: { module_name: 'massflow_contr0', params: ['target'], all_params: ['target'], commands: [],
      param_info: [{ target: { datainfo: { type: 'double', unit: 'mln/min' } } }] },
  } }))
  await page.route('http://127.0.0.1:5174/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let json: unknown = { status: 'ok', names: [], files: [], data: null }
    if (path === '/api/latest_values') json = {
      [`${device}.calibration_settings`]: { value: settings, unit: '', state: 'State.OK', state_str: '' },
      [`${device}.value`]: { value: results, unit: '', state: 'State.OK', state_str: '' },
    }
    if (path === '/api/node_for_device') json = { status: 'ok', addr: 'mock:10800' }
    if (path === '/api/send_request') {
      const isValue = route.request().postDataJSON().command.endsWith(':value')
      json = { status: 'sent', response: `reply ${moduleName}:${isValue ? 'value' : 'calibration_settings'} ${JSON.stringify([isValue ? results : settings, {}])}` }
    }
    if (path === '/api/device_parameter') {
      if (failSave) { await route.fulfill({ status: 500, json: { error: 'Write failed' } }); return }
      const write = route.request().postDataJSON()
      writes.push(write)
      settings = write.value
    }
    if (path === '/api/plot_updates') json = { status: 'ok', mode: 'history', samples: {}, server_time_ms: Date.now() }
    await route.fulfill({ json })
  })
  await page.routeWebSocket('**/ws', (socket) => socket.send(JSON.stringify({ type: 'snapshot', values: {} })))
  await page.addInitScript(({ device, moduleName, info }) => {
    sessionStorage.setItem('selectedLayout', 'Calibration demo')
    sessionStorage.setItem('pendingLayoutRenderMode', 'configure')
    localStorage.setItem('gas_system_layouts', JSON.stringify({ 'Calibration demo': {
      devices: [{ id: 'calibration', device: moduleName, deviceKey: device, logicalName: device,
        left: '80px', top: '80px', width: '', height: '', info }],
      decorations: [], valveIcons: [], plots: [], connections: [],
    } }))
  }, { device, moduleName, info })
  await page.goto('/system')
  const box = page.locator('.device-box')
  await expect(box.locator('.calibration-settings')).toContainText('keep me')
  await expect(box).toContainText('Calibration results')
  await expect(box.locator('.calibration-results')).toContainText('measurement')
  await expect(box.locator('.calibration-results')).toContainText('[0, 9.8]')
  await expect(box.locator('.calibration-results')).toContainText('inverse calib coeff')
  await box.getByRole('button', { name: 'Edit calibration settings' }).click()
  const editor = page.getByRole('dialog', { name: `${moduleName} — Calibration settings` })
  for (let index = 1; index <= 6; index++) {
    await expect(editor.getByRole('spinbutton', { name: `calibration_flow_rate ${index} (mln/min)`, exact: true })).toHaveValue(String((index - 1) * 10))
  }
  await expect(editor.getByRole('group', { name: 'calibration_flow_rate (mln/min)', exact: true })).toBeVisible()
  await editor.getByRole('spinbutton', { name: 'calibration_flow_rate 6 (mln/min)', exact: true }).fill('60')
  await expect(editor.getByRole('spinbutton', { name: 'dwell (s)', exact: true })).toHaveValue('10')
  await editor.getByRole('spinbutton', { name: 'dwell (s)', exact: true }).fill('70')
  await editor.getByRole('button', { name: 'Save settings' }).click()
  expect(writes).toEqual([])
  expect(await editor.getByRole('spinbutton', { name: 'dwell (s)', exact: true }).evaluate((input: HTMLInputElement) => input.validity.rangeOverflow)).toBe(true)
  await editor.getByRole('spinbutton', { name: 'dwell (s)', exact: true }).fill('20')
  await editor.getByRole('combobox', { name: 'enabled', exact: true }).selectOption('false')
  await editor.getByRole('combobox', { name: 'mode', exact: true }).selectOption('1')
  await editor.getByRole('spinbutton', { name: 'points 2', exact: true }).fill('50')
  await editor.getByRole('spinbutton', { name: 'offset', exact: true }).fill('3.5')
  await editor.getByRole('button', { name: 'Save settings' }).click()
  await expect(editor.getByRole('alert')).toContainText('Could not save')
  await expect(editor.getByRole('spinbutton', { name: 'offset', exact: true })).toHaveValue('3.5')
  failSave = false
  await editor.getByRole('button', { name: 'Save settings' }).click()
  await expect.poll(() => writes).toEqual([{ device, param: 'calibration_settings', value: {
    dwell: 20, enabled: false, mode: 1, points: [0, 50], correction: { offset: 3.5 }, untouched: 'keep me',
    calibrate_device: 0, calibration_target_array: [0, 10, 20, 30, 40, 60],
  } }])
  await expect(editor).not.toBeVisible()
  await expect(box.locator('.calibration-settings')).toContainText('3.5')
  await box.getByRole('button', { name: 'Edit calibration settings' }).click()
  await editor.getByRole('spinbutton', { name: 'dwell (s)', exact: true }).fill('30')
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(writes).toHaveLength(1)
})
