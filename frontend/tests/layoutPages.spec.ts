import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'

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

async function stagePlot(page: Page) {
  await page.goto('/system')
  await expect(page.locator('#deco-main')).toBeVisible()
  await page.locator('#device-grid').click({ button: 'right', position: { x: 300, y: 300 } })
  await page.getByRole('button', { name: 'New plot', exact: true }).click()
  await page.locator('#curve-key').selectOption('demo_temperature.value')
  await page.getByRole('button', { name: 'Add Line', exact: true }).click()
}

test('creates a plot on the selected layout page and preserves it after saving', async ({ page }) => {
  const popups: Page[] = []
  page.on('popup', (popup) => popups.push(popup))
  await stagePlot(page)
  await expect(page.getByLabel('Plot placement')).toHaveValue('window')
  await page.getByLabel('Plot placement').selectOption('layout')
  await page.getByRole('button', { name: 'Create Plot', exact: true }).click()
  await prompt(page, 'Embedded temperature')
  const plot = page.locator('.plot-panel[data-plot-name="Embedded temperature"]')
  await expect(plot).toBeVisible()
  await expect(plot).toHaveCSS('left', '300px')
  await expect(plot).toHaveCSS('top', '300px')
  await page.getByRole('button', { name: '+ Add page', exact: true }).click()
  await prompt(page, 'Diagnostics')
  await expect(page.locator('.plot-panel')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Main', exact: true }).click()
  await expect(plot).toBeVisible()
  await save(page)
  await page.reload()
  await expect(plot).toBeVisible()
  expect(popups).toHaveLength(0)
})

test('creates plots in a separate window by default', async ({ page }) => {
  await stagePlot(page)
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Create Plot', exact: true }).click()
  await prompt(page, 'Window temperature')
  const popup = await popupPromise
  await expect(popup).toHaveURL(/\/plot\?config=Window\+temperature/)
  await expect(popup.locator('.standalone-plot-panel')).toBeVisible()
  await expect(page.locator('.plot-panel')).toHaveCount(0)
  await popup.close()
})

test('plots retain history and collect live values while their layout page is hidden', async ({ page }) => {
  let socket: WebSocketRoute | undefined
  await page.routeWebSocket('**/ws', (connection) => {
    socket = connection
    connection.send(JSON.stringify({ type: 'snapshot', values: {} }))
  })
  await page.addInitScript((main) => {
    const plot = {
      id: 'saved-plot', configName: 'Temperature', title: 'Temperature',
      left: '300px', top: '300px', width: '700px', height: '420px',
      traces: ['demo_temperature.value'],
    }
    sessionStorage.setItem('pendingLayoutRenderMode', 'connect')
    localStorage.setItem('gas_system_layouts', JSON.stringify({
      'Pages demo': {
        ...main, plots: [plot],
        pages: [{ id: 'plots-page', name: 'Plots', layout: { ...main, plots: [{ ...plot, id: 'subpage-plot' }] } }],
      },
    }))
  }, mainCanvas)
  await page.goto('/system')
  const plot = page.locator('.plot-panel')
  await expect(plot).toBeVisible()
  const mainPlotId = await plot.getAttribute('id')
  await expect.poll(() => !!socket).toBe(true)
  const sendValue = (value: number) => socket!.send(JSON.stringify({
    type: 'update', data: { key: 'demo_temperature.value', value, unit: 'K', state: 'idle', state_str: '' },
  }))
  const values = () => plot.locator('.js-plotly-plot').evaluate((element) =>
    ((element as HTMLElement & { data?: Array<{ y: number[] }> }).data?.[0]?.y ?? []),
  )
  sendValue(101)
  await expect.poll(values).toContain(101)
  await page.getByRole('tab', { name: 'Plots', exact: true }).click()
  await expect.poll(values).toContain(101)
  const subpagePlotId = await plot.getAttribute('id')
  expect(subpagePlotId).not.toBe(mainPlotId)
  sendValue(202)
  await expect.poll(values).toContain(202)
  await page.getByRole('tab', { name: 'Main', exact: true }).click()
  await expect(plot).toHaveAttribute('id', mainPlotId!)
  await expect.poll(values).toContain(101)
  await expect.poll(values).toContain(202)
  sendValue(303)
  await expect.poll(values).toContain(303)
  await page.getByRole('tab', { name: 'Plots', exact: true }).click()
  await expect(plot).toHaveAttribute('id', subpagePlotId!)
  await expect.poll(values).toEqual(expect.arrayContaining([101, 202, 303]))
})

test('batches burst updates and leaves unchanged plots idle', async ({ page }) => {
  let socket: WebSocketRoute | undefined
  await page.routeWebSocket('**/ws', (connection) => {
    socket = connection
    connection.send(JSON.stringify({ type: 'snapshot', values: {} }))
  })
  await page.addInitScript((main) => {
    sessionStorage.setItem('pendingLayoutRenderMode', 'connect')
    localStorage.setItem('gas_system_layouts', JSON.stringify({
      'Pages demo': {
        ...main,
        plots: ['value', 'status'].map((param, index) => ({
          id: `saved-${param}`, title: param, configName: param,
          left: `${index * 710}px`, top: '300px', width: '700px', height: '420px',
          traces: [`demo_temperature.${param}`],
        })),
      },
    }))
  }, mainCanvas)
  await page.goto('/system')
  const chart = page.locator('[data-plot-name="value"] .js-plotly-plot')
  await expect.poll(() => chart.evaluate((el: any) => el.data?.length)).toBe(1)
  await page.waitForTimeout(250)
  await page.locator('.js-plotly-plot').evaluateAll((elements) => elements.forEach((el: any) => {
    el.dataset.redraws = '0'
    el.on('plotly_afterplot', () => { el.dataset.redraws = String(Number(el.dataset.redraws) + 1) })
  }))
  await expect.poll(() => !!socket).toBe(true)
  const start = Date.now()
  for (let i = 0; i < 40; i += 1) {
    socket!.send(JSON.stringify({
      type: 'update', data: { key: 'demo_temperature.value', value: 1000 + i, unit: 'K', state: 'idle', state_str: '' },
    }))
  }
  await expect.poll(() => chart.evaluate((el: any) => el.data?.[0]?.y?.at(-1)), { timeout: 15000 }).toBe(1039)
  const burstRedraws = Number(await chart.getAttribute('data-redraws'))
  const unrelatedRedraws = Number(await page.locator('[data-plot-name="status"] .js-plotly-plot').getAttribute('data-redraws'))
  console.log(JSON.stringify({ burstUpdates: 40, burstRedraws, unrelatedRedraws, elapsedMs: Date.now() - start }))
  expect(burstRedraws).toBeLessThanOrEqual(3)
  expect(unrelatedRedraws).toBe(0)
  await page.waitForTimeout(2300)
  expect(Number(await chart.getAttribute('data-redraws'))).toBe(burstRedraws)
})

test('bounds long-running live buffers and rendered points for every plot type', async ({ page }) => {
  await page.goto('/system')
  await expect(page.locator('#deco-main')).toBeVisible()
  const result = await page.evaluate(async () => {
    // Exercise the same ingestion used by WebSocket and poll replay, without network delays.
    const plotSource = '/src/store/plotStore.ts'
    const appSource = '/src/store/appStore.ts'
    const { usePlotStore, ingestPlotUpdate, MAX_STORED_PLOT_HISTORY_POINTS, MAX_RENDERED_PLOT_POINTS } = await import(plotSource)
    const { useAppStore } = await import(appSource)
    useAppStore.getState().setConfigurationMode(false)
    const store = usePlotStore.getState()
    const lineId = store.createPlot({ name: 'buffer-line', plotType: 'line', lines: [{ key: 'perf.value' }] }, undefined, 'main')
    const arrayId = store.createPlot({ name: 'buffer-array', plotType: 'array', lines: [{ key: 'perf.array' }] }, undefined, 'main')
    const xyId = store.createPlot({ name: 'buffer-xy', plotType: 'xy', lines: [{ key: 'curve', xKey: 'perf.x', yKey: 'perf.y' }] }, undefined, 'main')
    for (let i = 0; i < 60000; i += 1) {
      ingestPlotUpdate('perf.value', i, Date.now(), true)
      ingestPlotUpdate('perf.array', [i, i * 2], Date.now(), true)
    }
    const largeBatch = Array.from({ length: 150000 }, (_, i) => i)
    ingestPlotUpdate('perf.x', largeBatch, Date.now(), true)
    ingestPlotUpdate('perf.y', largeBatch, Date.now(), true)
    const current = usePlotStore.getState().plots
    const traces = [
      current[lineId].traces['perf.value'],
      ...Object.values(current[arrayId].traces['perf.array'].children),
      current[xyId].traces.curve,
    ] as any[]
    return {
      maxStored: MAX_STORED_PLOT_HISTORY_POINTS,
      maxRendered: MAX_RENDERED_PLOT_POINTS,
      lengths: traces.map((trace) => [(trace.rawX ?? trace.x).length, (trace.rawY ?? trace.y).length]),
      latest: traces.map((trace) => (trace.rawY ?? trace.y).at(-1)),
    }
  })
  for (const [xLength, yLength] of result.lengths) {
    expect(xLength).toBeLessThanOrEqual(result.maxStored)
    expect(xLength).toBeGreaterThan(0)
    expect(xLength).toBe(yLength)
  }
  expect(result.latest).toEqual([59999, 59999, 119998, 149999])
  for (const name of ['buffer-line', 'buffer-array', 'buffer-xy']) {
    const chart = page.locator(`[data-plot-name="${name}"] .js-plotly-plot`)
    await expect.poll(() => chart.evaluate((el: any) => (el.data?.[0]?.y?.length ?? 0) > 0)).toBe(true)
    const traces = await chart.evaluate((el: any) => el.data.map((trace: any) => ({ length: trace.y.length, mode: trace.mode })))
    for (const trace of traces) {
      expect(trace.length).toBeLessThanOrEqual(result.maxRendered)
      expect(trace.mode).toBe('lines')
    }
  }
})

test('keeps short historical peaks visible as new samples arrive', async ({ page }) => {
  await page.goto('/system')
  const results = await page.evaluate(async () => {
    const source = '/src/store/plotStore.ts'
    const { sampleTracePoints, MAX_RENDERED_PLOT_POINTS } = await import(source)
    const start = Date.now() - 120000
    const x = Array.from({ length: 6000 }, (_, i) => new Date(start + i * 10))
    const y = x.map((_, i) => i === 3000 ? 100 : i === 4000 ? -100 : 0)
    return Array.from({ length: 20 }, (_, step) => {
      x.push(new Date(start + (6000 + step) * 10))
      y.push(0)
      const sampled = sampleTracePoints(x, y)
      return {
        peak: sampled.y.includes(100), trough: sampled.y.includes(-100),
        length: sampled.y.length, limit: MAX_RENDERED_PLOT_POINTS,
        completed: sampled.x.filter((time: Date) => time.getTime() < start + 50000).map((time: Date) => time.getTime()),
      }
    })
  })
  for (const result of results) {
    expect(result.peak).toBe(true)
    expect(result.trough).toBe(true)
    expect(result.length).toBeLessThanOrEqual(result.limit)
    expect(result.completed).toEqual(results[0].completed)
  }
})

test('merges delayed polling samples in time order without replaying duplicate points', async ({ page }) => {
  await page.goto('/system')
  await expect(page.locator('#deco-main')).toBeVisible()
  const samples = await page.evaluate(async () => {
    const plotSource = '/src/store/plotStore.ts'
    const appSource = '/src/store/appStore.ts'
    const { usePlotStore, ingestPlotUpdate } = await import(plotSource)
    const { useAppStore } = await import(appSource)
    useAppStore.getState().setConfigurationMode(false)
    const id = usePlotStore.getState().createPlot({ name: 'Ordered', plotType: 'line', lines: [{ key: 'ordered.value' }] }, undefined, 'main')
    const start = Date.now() - 120000
    // A live point is already present when polling replays the preceding interval.
    for (const [offset, value] of [[0, 0], [30000, 3], [10000, 1], [20000, 2], [20000, 2]]) {
      ingestPlotUpdate('ordered.value', value, start + offset, false)
    }
    const trace = usePlotStore.getState().plots[id].traces['ordered.value']
    return { x: trace.rawX.map((x: Date) => x.getTime() - start), y: trace.rawY }
  })
  expect(samples).toEqual({ x: [0, 10000, 20000, 30000], y: [0, 1, 2, 3] })
})
