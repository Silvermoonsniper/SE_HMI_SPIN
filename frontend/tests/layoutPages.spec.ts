import { expect, test, type Page } from '@playwright/test'

const temperature = {
  original_name: 'temperature', module_name: 'temperature',
  params: [], all_params: ['value', 'status'], commands: [], interface_classes: ['Readable'],
}
const mainCanvas = {
  devices: [{
    id: 'box-demo_temperature', device: 'temperature', deviceKey: 'demo_temperature',
    logicalName: 'demo_temperature', left: '80px', top: '80px', width: '', height: '', info: temperature,
  }],
  decorations: [{
    id: 'deco-main', type: 'label', text: 'Main overview',
    left: '400px', top: '160px', width: '180px', height: '30px',
  }],
  valveIcons: [], plots: [], connections: [],
}

async function prompt(page: Page, name: string) {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill(name)
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
}

async function save(page: Page) {
  await page.getByRole('button', { name: 'Save layout', exact: true }).click()
  await prompt(page, 'Pages demo')
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => console.error('Browser error:', error.message))
  await page.route('**/c/device_params.json', (route) => route.fulfill({ json: { demo_temperature: temperature } }))
  await page.route('http://127.0.0.1:5174/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const json = path === '/api/latest_values' ? { 'demo_temperature.value': { value: 12, unit: 'K', state: 'State.OK', state_str: '' } }
      : path === '/api/nexus_export/status' ? { status: 'ok', export: { running: false } }
      : path === '/api/storage/status' ? { status: 'ok', storage: { level: 'normal', filesystem_free_bytes: 1000000000 } }
      : path === '/api/data_saving/status' ? { status: 'ok', export: null }
      : path === '/api/node_for_device' ? { status: 'ok', addr: 'mock-node:10800' }
      : path === '/api/send_request' ? { status: 'sent', response: 'reply temperature:value [12,{}]' }
      : path === '/api/plot_updates' ? { status: 'ok', mode: 'history', samples: {}, server_time_ms: Date.now() }
      : { status: 'ok', names: ['Pages demo'], action: null, data: null, files: [] }
    await route.fulfill({ json })
  })
  await page.routeWebSocket('**/ws', (socket) => socket.send(JSON.stringify({ type: 'snapshot', values: {} })))
  await page.addInitScript((layout) => {
    if (!sessionStorage.getItem('selectedLayout')) sessionStorage.setItem('selectedLayout', 'Pages demo')
    if (!sessionStorage.getItem('pendingLayoutRenderMode')) sessionStorage.setItem('pendingLayoutRenderMode', 'configure')
    if (!localStorage.getItem('gas_system_layouts')) {
      localStorage.setItem('gas_system_layouts', JSON.stringify({ 'Pages demo': layout }))
    }
  }, mainCanvas)
})

test('creates independent subpages, preserves edits when switching, and saves/reloads all pages', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const serverSaves: Record<string, any>[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/nodemanager/save_layout')) serverSaves.push(request.postDataJSON())
  })
  await page.goto('/system')
  await expect(page.locator('#deco-main')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove page', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '+ Add page', exact: true }).click()
  await prompt(page, 'Gas system')
  await expect(page.getByRole('tab', { name: 'Gas system', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.device-box')).toHaveCount(0)
  await expect(page.locator('#deco-main')).toHaveCount(0)

  // The same live device can appear at different positions on different pages.
  await page.locator('#device-grid').click({ button: 'right', position: { x: 150, y: 150 } })
  await page.locator('[data-submenu="device"]').hover()
  await page.getByRole('button', { name: 'temperature', exact: true }).click()
  const box = page.locator('.device-box')
  await expect(box).toHaveCount(1)
  const header = await box.locator('.device-header').boundingBox()
  if (!header) throw new Error('Device header is missing')
  await page.mouse.move(header.x + 25, header.y + 12)
  await page.mouse.down()
  await page.mouse.move(header.x + 145, header.y + 62, { steps: 5 })
  await page.mouse.up()
  const subpageLeft = await box.evaluate((element) => (element as HTMLElement).style.left)
  expect(subpageLeft).not.toBe('80px')
  await page.getByRole('tab', { name: 'Main', exact: true }).click()
  await expect(box).toHaveCSS('left', '80px')
  await expect(page.locator('#deco-main')).toBeVisible()
  await page.getByRole('tab', { name: 'Gas system', exact: true }).click()
  await expect(box).toHaveCSS('left', subpageLeft)

  await page.getByRole('button', { name: 'Rename page', exact: true }).click()
  await prompt(page, 'Gas controls')
  await save(page)
  expect(serverSaves.at(-1)?.layout.pages[0].name).toBe('Gas controls')
  expect(serverSaves.at(-1)?.layout.devices[0].left).toBe('80px')
  expect(serverSaves.at(-1)?.layout.pages[0].layout.devices[0].left).toBe(subpageLeft)
  await page.reload()
  await expect(page.locator('#deco-main')).toBeVisible()
  await page.getByRole('tab', { name: 'Gas controls', exact: true }).click()
  await expect(box).toHaveCSS('left', subpageLeft)
  expect(errors).toEqual([])
})

test('validates names and removes only the selected subpage after confirmation', async ({ page }) => {
  await page.goto('/system')
  await expect(page.locator('#deco-main')).toBeVisible()
  await page.getByRole('button', { name: '+ Add page', exact: true }).click()
  await prompt(page, 'Main')
  await expect(page.getByRole('dialog')).toContainText('unique page name')
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  for (const name of ['Gas controls', 'Diagnostics']) {
    await page.getByRole('button', { name: '+ Add page', exact: true }).click()
    await prompt(page, name)
  }
  await page.getByRole('button', { name: 'Remove page', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Diagnostics', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Remove page', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Diagnostics', exact: true })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Gas controls', exact: true })).toBeVisible()
  await expect(page.locator('#deco-main')).toBeVisible()
  await save(page)
  await page.reload()
  await expect(page.getByRole('tab')).toHaveCount(2)
})

test('run mode keeps page navigation available and hides page editing controls', async ({ page }) => {
  await page.goto('/system')
  await expect(page.locator('#deco-main')).toBeVisible()
  await page.getByRole('button', { name: '+ Add page', exact: true }).click()
  await prompt(page, 'Diagnostics')
  await save(page)
  await page.evaluate(() => sessionStorage.setItem('pendingLayoutRenderMode', 'connect'))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Start Data Saving', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop Data Saving', exact: true })).toBeVisible()
  await expect(page.locator('#data-saving-status')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Diagnostics', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '+ Add page', exact: true })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Diagnostics', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Main', exact: true }).click()
  await expect(page.locator('#deco-main')).toBeVisible()
  await page.getByRole('button', { name: 'Start Data Saving', exact: true }).click()
  await expect(page.locator('#data-saving-overlay')).toBeVisible()
})

test('connecting to a single-page GUI keeps the data-saving top bar visible', async ({ page }) => {
  await page.goto('/system')
  await page.evaluate(() => sessionStorage.setItem('pendingLayoutRenderMode', 'connect'))
  await page.reload()
  await expect(page.locator('#deco-main')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start Data Saving', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop Data Saving', exact: true })).toBeVisible()
  await expect(page.locator('#data-saving-status')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Configure GUI', exact: true })).toHaveCount(1)
  const header = await page.locator('#main-panel-header').boundingBox()
  const viewport = await page.locator('#viewport').boundingBox()
  if (!header || !viewport) throw new Error('GUI header or canvas is missing')
  expect(viewport.y).toBeGreaterThanOrEqual(header.y + header.height)
  expect(viewport.height).toBeGreaterThan(300)
  await page.getByRole('button', { name: 'Start Data Saving', exact: true }).click()
  await expect(page.locator('#data-saving-overlay')).toBeVisible()
})
