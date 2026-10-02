/** Open synchronously from a click so the browser permits the plot pop-up. */
export function openPlotWindow(configName: string): boolean {
  const url = new URL('/plot', window.location.href)
  url.searchParams.set('config', configName)
  const popup = window.open(url.href, '_blank', 'popup=yes,width=960,height=680,resizable=yes,scrollbars=yes')
  if (!popup) return false
  popup.focus()
  return true
}
