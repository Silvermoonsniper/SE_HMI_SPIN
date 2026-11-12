import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'

const members = { unknown: 0, wafer_001_measurement_position_1: 1, wafer_001_measurement_position_2: 2, wafer_001_measurement_position_3: 3, wafer_002_measurement_position_1: 4, wafer_002_measurement_position_2: 5 }
const devices = {
  spots: { all_params: ['value', 'target'], param_info: [{ target: { datainfo: { type: 'enum', members } } }] },
  gas: { all_params: ['value'], param_info: [{ value: { datainfo: { type: 'struct', members: { gas_list: { type: 'array' }, composition: { type: 'array' }, total_flow: { type: 'double', unit: 'ml/min' } } } } }] },
  potentiostat: { all_params: ['_technique_config'], param_info: [{ _technique_config: { datainfo: { type: 'string' } } }] },
}
const value = (reading: unknown) => ({ value: reading, unit: '', state: 'idle', state_str: '' })
const values = {
  'spots.value': value(1),
  'gas.value': value({ gas_list: ['N2', 'Ar'], composition: [25, 75], total_flow: 100 }),
  'potentiostat._technique_config': value('{"technique":"CA","voltage":0.5,"duration":30}'),
  'potentiostat._active_technique': value('CA'),
}
let socket: WebSocketRoute | undefined
async function prompt(page: Page, text: string) {
  await page.getByRole('dialog').getByRole('textbox').fill(text)
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
}
async function addBlock(page: Page) {
  await page.goto('/system')
  await page.locator('#device-grid').click({ button: 'right', position: { x: 100, y: 120 } })
  await page.locator('[data-submenu="decoration"]').hover()
  await page.getByRole('button', { name: 'Wafer measurement tab', exact: true }).click()
  await expect(page.locator('.wafer-measurement-tab')).toBeVisible()
}
test.beforeEach(async ({ page }) => {
  socket = undefined
  await page.route('**/c/device_params.json', (route) => route.fulfill({ json: devices }))
  await page.route('http://127.0.0.1:5174/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const json = path === '/api/latest_values' ? values
      : path === '/api/storage/status' ? { status: 'ok', storage: { level: 'normal' } }
      : path === '/api/nexus_export/status' || path === '/api/data_saving/status' ? { status: 'ok', export: null }
      : path === '/api/plot_updates' ? { status: 'ok', mode: 'history', samples: {}, server_time_ms: Date.now() }
      : { status: 'ok', names: [], files: [] }
    return route.fulfill({ json })
  })
  await page.routeWebSocket('**/ws', (connection) => {
    socket = connection
    connection.send(JSON.stringify({ type: 'snapshot', values }))
  })
  await page.addInitScript(() => {
    sessionStorage.setItem('selectedLayout', 'Wafer demo')
    if (!sessionStorage.getItem('pendingLayoutRenderMode')) sessionStorage.setItem('pendingLayoutRenderMode', 'configure')
    if (!localStorage.getItem('gas_system_layouts')) localStorage.setItem('gas_system_layouts', JSON.stringify({
      'Wafer demo': { devices: [], decorations: [], plots: [], connections: [], valveIcons: [] },
    }))
  })
})

test('creates a live wafer block with spot selection, live settings, and layout persistence', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && /device_parameter|send_request/.test(request.url())) writes.push(request.url())
  })
  await addBlock(page)
  const block = page.locator('.wafer-measurement-tab')
  const selector = block.getByLabel('Measurement spot', { exact: true })
  await expect(selector).toHaveValue('1')
  await expect(block.getByRole('button', { name: /wafer_001_measurement/ })).toHaveCount(3)
  await expect(block.getByLabel('Argon flow', { exact: true })).toHaveText('75 ml/min')
  await expect(block.getByLabel('N2 flow', { exact: true })).toHaveText('25 ml/min')
  await expect(block.getByLabel('Technique configuration')).toContainText('voltage')
  await block.getByRole('button', { name: 'Save session for this spot', exact: true }).click()
  await expect(block.getByRole('status', { name: 'Session save status' })).toContainText('Session saved with the layout.')
  await selector.selectOption('4')
  await expect(block.getByRole('button', { name: /wafer_002_measurement/ })).toHaveCount(2)
  await block.getByRole('button', { name: 'wafer_002_measurement_position_2', exact: true }).click()
  await expect(selector).toHaveValue('5')
  await expect.poll(() => !!socket).toBe(true)
  socket!.send(JSON.stringify({ type: 'update', data: { key: 'gas.value', ...value({ gas_list: ['Ar', 'N2'], composition: [60, 40], total_flow: 200 }) } }))
  await expect(block.getByLabel('Argon flow', { exact: true })).toHaveText('120 ml/min')
  await expect(block.getByLabel('N2 flow', { exact: true })).toHaveText('80 ml/min')
  socket!.send(JSON.stringify({ type: 'update', data: { key: 'potentiostat._technique_config', ...value('{"technique":"CV","cycles":5}') } }))
  await expect(block.getByLabel('Technique configuration')).toContainText('CV')
  await block.getByRole('button', { name: 'Save session for this spot', exact: true }).click()
  await expect(block.getByRole('status', { name: 'Session save status' })).toContainText('Session saved with the layout.')
  await selector.selectOption('1')
  await expect(block.getByLabel('Argon flow', { exact: true })).toHaveText('75 ml/min')
  await expect(block.getByLabel('Technique configuration')).toContainText('CA')
  await selector.selectOption('5')
  await expect(block.getByLabel('Argon flow', { exact: true })).toHaveText('120 ml/min')
  const sessions = await page.evaluate(() => JSON.parse(localStorage.getItem('gas_system_layouts')!)['Wafer demo'].decorations[0].waferMeasurement.sessions)
  expect(Object.keys(sessions)).toHaveLength(2)
  expect(sessions['spots:wafer_001_measurement_position_1'].techniqueConfig.technique).toBe('CA')
  expect(sessions['spots:wafer_002_measurement_position_2'].techniqueConfig.technique).toBe('CV')
  const header = await block.locator('h3').boundingBox()
  if (!header) throw new Error('Missing wafer header')
  await page.mouse.move(header.x + 20, header.y + 10)
  await page.mouse.down()
  await page.mouse.move(header.x + 90, header.y + 50, { steps: 4 })
  await page.mouse.up()
  await expect(block).toHaveCSS('left', '170px')
  await block.hover()
  const handle = await block.locator('.resize-handle').boundingBox()
  if (!handle) throw new Error('Missing resize handle')
  await page.mouse.move(handle.x + 4, handle.y + 4)
  await page.mouse.down()
  await page.mouse.move(handle.x + 74, handle.y + 44, { steps: 4 })
  await page.mouse.up()
  await expect(block).toHaveCSS('width', '850px')
  await expect(block.getByLabel('Argon flow', { exact: true })).toHaveText('120 ml/min')
  await expect(block.getByLabel('Technique configuration')).toContainText('CV')
  await block.getByText('Data sources', { exact: true }).click()
  await block.getByLabel('Potentiostat', { exact: true }).selectOption('potentiostat')
  await page.getByRole('button', { name: '+ Add page', exact: true }).click()
  await prompt(page, 'Other page')
  await expect(block).toHaveCount(0)
  await page.getByRole('tab', { name: 'Main', exact: true }).click()
  await expect(selector).toHaveValue('5')
  await page.getByRole('button', { name: 'Save layout', exact: true }).click()
  await prompt(page, 'Wafer demo')
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
  await page.reload()
  await expect(selector).toHaveValue('5')
  await expect(block).toHaveCSS('width', '850px')
  await expect(block.getByLabel('Argon flow', { exact: true })).toHaveText('120 ml/min')
  await expect(block.getByLabel('Technique configuration')).toContainText('CV')
  await page.evaluate(() => sessionStorage.setItem('pendingLayoutRenderMode', 'connect'))
  await page.reload()
  await selector.selectOption('2')
  await expect(block.getByRole('button', { name: 'wafer_001_measurement_position_2', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(block.getByRole('button', { name: 'Remove wafer measurement tab' })).toHaveCount(0)
  await block.getByRole('button', { name: 'Save session for this spot', exact: true }).click()
  await expect(block.getByRole('status', { name: 'Session save status' })).toContainText('Session saved with the layout.')
  await page.reload()
  await expect(selector).toHaveValue('2')
  await expect(block.getByRole('button', { name: 'Update saved session', exact: true })).toBeVisible()
  expect(writes).toEqual([])
  expect(errors).toEqual([])
  await block.screenshot({ path: '/tmp/wafer-measurement-tab.png' })
})

test('shows missing sources clearly and removes the wafer block', async ({ page }) => {
  await page.route('**/c/device_params.json', (route) => route.fulfill({ json: {} }))
  await addBlock(page)
  const block = page.locator('.wafer-measurement-tab')
  await expect(block.getByLabel('Measurement spot', { exact: true })).toBeDisabled()
  await expect(block.getByLabel('Argon flow', { exact: true })).toHaveText('Unavailable')
  await expect(block).toContainText('No potentiostat connected.')
  await expect(block).toContainText('No measurement spots available.')
  await block.getByRole('button', { name: 'Remove wafer measurement tab' }).click()
  await expect(block).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Main', exact: true })).toBeVisible()
})
