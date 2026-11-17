import { expect, test } from '@playwright/test'

for (const mode of ['configure', 'connect']) {
  for (const livePosition of [true, false]) {
    test(`wafer click opens a spot window in ${mode} mode with ${livePosition ? 'string positions' : 'saved wafer IDs'}`, async ({ page }) => {
      const positionDevice = 'demo_sample_at_measurement_position'
      const devices = { [positionDevice]: {
        module_name: 'sample_at_measurement_position', params: ['target'], all_params: ['value', 'target'], commands: [],
        param_info: [{ target: { datainfo: { type: 'string' }, readonly: false } }, { value: { datainfo: { type: 'string' }, readonly: true } }],
      } }
      const values = livePosition ? {
        [`${positionDevice}.value`]: { value: 'wafer_001_measurement_position_1', unit: '', state: 'State.OK', state_str: '' },
      } : {}
      const session = (waferId: string) => ({
        waferId, spotLabel: 'Saved spot', capturedAt: '2026-11-17T10:00:00Z',
        coordinatesMm: { x: 3, y: 2 }, argonFlow: null, nitrogenFlow: null, flowUnit: '',
        techniqueConfig: null, activeTechnique: '', sources: { spotDevice: positionDevice, gasDevice: '', potentiostatDevice: '' },
      })
      await page.route('**/c/device_params.json', (route) => route.fulfill({ json: devices }))
      await page.route('http://127.0.0.1:5174/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname
        await route.fulfill({ json: path === '/api/latest_values' ? values
          : path === '/api/plot_updates' ? { status: 'ok', mode: 'history', samples: {}, server_time_ms: Date.now() }
          : { status: 'ok', names: [], files: [], data: null } })
      })
      await page.routeWebSocket('**/ws', (socket) => socket.send(JSON.stringify({ type: 'snapshot', values })))
      const layout = { devices: [], valveIcons: [], plots: [], connections: [], decorations: [{
        id: 'wafer', type: 'wafer_measurement_tab', left: '20px', top: '20px', width: '800px', height: '650px',
        waferMeasurement: { sessions: livePosition ? {} : { first: session('wafer_001'), second: session('wafer_002') } },
      }] }
      await page.addInitScript(({ layout, mode }) => {
        sessionStorage.setItem('selectedLayout', 'Wafer demo')
        sessionStorage.setItem('pendingLayoutRenderMode', mode)
        localStorage.setItem('gas_system_layouts', JSON.stringify({ 'Wafer demo': layout }))
      }, { layout, mode })
      await page.goto('/system')
      const tab = page.getByLabel('Wafer measurement tab', { exact: true })
      const graphic = tab.getByRole('group', { name: 'Wafer measurement spots', exact: true })
      await expect(tab.getByRole('combobox', { name: 'Wafer ID', exact: true })).toHaveValue('wafer_001')
      const before = await tab.boundingBox()
      const box = await graphic.boundingBox()
      if (!box || !before) throw new Error('Wafer picture is missing')
      // Click a blank point inside the wafer, including slight mouse movement.
      await page.mouse.move(box.x + box.width * .4, box.y + box.height * .35)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * .4 + 2, box.y + box.height * .35 + 2)
      await page.mouse.up()
      const dialog = page.getByRole('dialog', { name: 'Add spot to measurement session', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('textbox', { name: 'Spot name' })).toBeEditable()
      await expect(dialog.getByLabel('Spot X (mm)')).not.toHaveText('0')
      expect((await tab.boundingBox())?.x).toBeCloseTo(before.x)
      expect((await tab.boundingBox())?.y).toBeCloseTo(before.y)
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      if (!livePosition) {
        await tab.getByRole('combobox', { name: 'Wafer ID', exact: true }).selectOption('wafer_002')
        await graphic.click({ position: { x: box.width / 2, y: box.height / 2 } })
        await expect(dialog).toContainText('wafer_002')
      }
    })
  }
}
