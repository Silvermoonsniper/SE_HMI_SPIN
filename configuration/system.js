// --- Connect to Node Modal Logic ---
document.addEventListener('DOMContentLoaded', function() 

{
 
  const connectBtn = document.getElementById('connect-node-btn');
  const modal = document.getElementById('connect-node-modal');
  const submitBtn = document.getElementById('conn-node-submit');
  const cancelBtn = document.getElementById('conn-node-cancel');


  if (connectBtn && modal && submitBtn && cancelBtn) {
    connectBtn.onclick = () => {
      modal.style.display = 'flex';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      // Clear manual fields
      document.getElementById('conn-ip').value = '';
      document.getElementById('conn-port').value = '';
    };
    cancelBtn.onclick = () => { modal.style.display = 'none'; };
    submitBtn.onclick = async () => {
      await addNodeConnection();
      modal.style.display = 'none';
    };
  } else {
    // Show a visible error if modal logic cannot attach
    const err = document.createElement('div');
    err.textContent = 'ERROR: Connect Node modal logic failed to attach. Check console for details.';
    err.style.background = '#dc3545';
    err.style.color = 'white';
    err.style.padding = '12px';
    err.style.fontWeight = 'bold';
    err.style.textAlign = 'center';
    err.style.margin = '12px';
    err.style.zIndex = 99999;
    document.body.prepend(err);
  }
});
// function to delete selected layout

function deleteSelectedLayout() {
 
  const select = document.getElementById('layout-select');
 
  const name = select.value;
 
  if (!name) 
  
  {
 
    alert('Please select a layout to delete.');
 
    return;
  }
 
  if (!confirm('Delete layout "' + name + '"? This cannot be undone.')) return;

  // Remove from localStorage (client-side copy)
  const layouts = getStoredLayouts();
 
  delete layouts[name];
 
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
 
  updateLayoutList();
 
  select.value = '';

  // If Spin is connected, request server to delete the saved layout file as well.
  if (window.Spin && typeof window.Spin.send_request === 'function') 
    {
    try 
    {
      window.Spin.send_request('nodemanager.delete_layout', '', 'input', 'set', { name: name });
      
      // Refresh server-side list so dropdown reflects the deletion

      try 
      { 
        window.Spin.send_request('nodemanager.list_layouts', '', 'read', 'read', null); } catch (e) { /* ignore */ 

      }
      alert('Layout deleted (locally and server request sent).');
    } 
    catch (e) 
    {
      try 
      
      { 
        
        alert('Layout deleted locally, but could not contact server to remove file.'); 
      } 
      catch (e2) 
      {}
    }
  } 
  else 
  {
    try 
    { 
      alert('Layout deleted locally. Not connected to server, so server file (if any) was not removed.'); 
    } 
    catch (e) 
    {}
  }
}



// ===== Connection Panel Logic =====
// global variablex declaration for pan and scale
let scale = 1;
let panX = 0;
let panY = 0;
const STORAGE_KEY = 'gas_system_layouts';

// Backend API base used for HTTP fallbacks (Flask API runs on port 8001)
const API_BASE = (function(){
  try { return `${location.protocol}//${location.hostname}:8001`; } catch (e) { return 'http://127.0.0.1:8001'; }
})();

// Optionally request backend restart when the page loads. This is controlled
// by a localStorage flag 'restart_on_refresh'. To enable, run in browser console:
//   localStorage.setItem('restart_on_refresh', 'true')
try {

  if (localStorage.getItem('restart_on_refresh') === 'true') 
    {
    // avoid spamming restarts: if a restart was requested very recently, skip
    const last = parseInt(localStorage.getItem('restart_last_requested') || '0', 10);
    const now = Date.now();
    if (!last || (now - last) > 15000) { // 15s cooldown
      localStorage.setItem('restart_last_requested', String(now));
      fetch(API_BASE + '/api/restart', { method: 'POST', mode: 'cors' })
        .catch(e => console.warn('Restart request failed', e));
    }
  }
} 
catch (e) 
{ 
  console.debug('restart on refresh check failed', e); 
}

// Helper to coerce different incoming shapes into numeric 0/1
function toNumeric(v) {
  if (v && typeof v.value !== 'undefined') v = v.value;
  if (v === true) return 1;
  if (v === false) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

let activeConnectionStart = null;
let temporaryConnectionLine = null;
let selectedConnectionLine = null;
let guiModeActive = false;
const RUNTIME_NODE_ADDRS_KEY = 'runtime_node_addrs';
let pendingAddedNodeAddr = null;
const deviceHydrationRequests = new Map();

function loadRuntimeDeviceNodeAddrs() {
  try {
    const raw = localStorage.getItem(RUNTIME_NODE_ADDRS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.debug('Failed to load runtime node addr map', e);
    return {};
  }
}

let runtimeDeviceNodeAddrs = loadRuntimeDeviceNodeAddrs();

function saveRuntimeDeviceNodeAddrs() {
  try {
    localStorage.setItem(RUNTIME_NODE_ADDRS_KEY, JSON.stringify(runtimeDeviceNodeAddrs));
  } catch (e) {
    console.debug('Failed to save runtime node addr map', e);
  }
}

function getKnownNodeAddrForDevice(device) {
  return runtimeDeviceNodeAddrs[device] || null;
}

function secopStatusToUi(statusValue) {
  if (!Array.isArray(statusValue) || statusValue.length < 2) {
    return { state: 'State.UNKNOWN', state_str: '' };
  }

  const code = Number(statusValue[0]);
  const stateStr = String(statusValue[1] || '');
  let state = 'State.UNKNOWN';
  if (code < 0) state = 'State.UNKNOWN';
  else if (code < 100) state = 'State.DISABLED';
  else if (code < 200) state = 'State.OK';
  else if (code < 300) state = 'State.WARN';
  else if (code < 400) state = 'State.BUSY';
  else if (code < 500) state = 'State.ERROR';
  return { state, state_str: stateStr };
}

function parseSecopReply(responseText) {
  if (!responseText) return null;
  const trimmed = String(responseText).trim();
  const match = trimmed.match(/^reply\s+\S+\s+(.+)$/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    console.debug('Failed to parse SECoP reply', trimmed, e);
    return null;
  }
}

async function hydrateDeviceFromNode(device) {
  if (deviceHydrationRequests.has(device)) {
    return deviceHydrationRequests.get(device);
  }

  const requestPromise = (async () => {
    const addr = getKnownNodeAddrForDevice(device);
    const deviceInfo = WRITABLE_PARAMS && WRITABLE_PARAMS[device] ? WRITABLE_PARAMS[device] : null;
    const moduleName = deviceInfo && deviceInfo.original_name ? deviceInfo.original_name : null;
    if (!addr || !deviceInfo || !moduleName) return;

    const commands = new Set(deviceInfo.commands || []);
    const params = Array.from(new Set(['status', 'value', 'target', ...(deviceInfo.all_params || [])]))
      .filter(param => !commands.has(param));

    if (!latestValues[device]) latestValues[device] = {};

    for (const param of params) {
      try {
        const resp = await fetch(API_BASE + '/api/send_request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addr: addr, command: `read ${moduleName}:${param}` })
        });
        if (!resp.ok) continue;
        const payload = await resp.json();
        const parsed = parseSecopReply(payload.response);
        if (!parsed || !Array.isArray(parsed) || parsed.length === 0) continue;

        const value = parsed[0];
        let state = 'State.OK';
        let stateStr = '';
        if (param === 'status') {
          const statusInfo = secopStatusToUi(value);
          state = statusInfo.state;
          stateStr = statusInfo.state_str;
        } else if (latestValues[device].status && Array.isArray(latestValues[device].status.value)) {
          const statusInfo = secopStatusToUi(latestValues[device].status.value);
          state = statusInfo.state;
          stateStr = statusInfo.state_str;
        }

        const unit = ((deviceInfo.accessibles || {})[param] || {}).datainfo?.unit || '';
        latestValues[device][param] = {
          value: value,
          unit: unit,
          state: state,
          state_str: stateStr
        };
      } catch (e) {
        console.debug('Direct device hydration failed for', device, param, e);
      }
    }

    applyCachedDeviceState(device, deviceDomId(device));
  })().finally(() => {
    deviceHydrationRequests.delete(device);
  });

  deviceHydrationRequests.set(device, requestPromise);
  return requestPromise;
}

function showAppDialog(options = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById('app-dialog-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'app-dialog-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(15, 23, 42, 0.38)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '100000',
      padding: '16px',
      boxSizing: 'border-box'
    });

    const dialog = document.createElement('div');
    Object.assign(dialog.style, {
      width: 'min(460px, 100%)',
      background: '#ffffff',
      borderRadius: '10px',
      boxShadow: '0 18px 40px rgba(15, 23, 42, 0.24)',
      border: '1px solid rgba(148, 163, 184, 0.35)',
      padding: '18px',
      color: '#0f172a',
      fontFamily: 'Arial, sans-serif'
    });

    const title = document.createElement('div');
    title.textContent = options.title || 'Message';
    Object.assign(title.style, {
      fontSize: '16px',
      fontWeight: '700',
      marginBottom: '10px'
    });

    const message = document.createElement('div');
    message.textContent = options.message || '';
    Object.assign(message.style, {
      fontSize: '13px',
      lineHeight: '1.5',
      whiteSpace: 'pre-wrap',
      marginBottom: options.type === 'prompt' ? '10px' : '16px'
    });

    dialog.appendChild(title);
    dialog.appendChild(message);

    let input = null;
    if (options.type === 'prompt') {
      input = document.createElement('input');
      input.type = 'text';
      input.value = options.defaultValue || '';
      Object.assign(input.style, {
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: '6px',
        border: '1px solid #cbd5e1',
        marginBottom: '16px',
        fontSize: '13px'
      });
      dialog.appendChild(input);
    }

    const buttonRow = document.createElement('div');
    Object.assign(buttonRow.style, {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '8px'
    });

    const finish = (value) => {
      document.removeEventListener('keydown', handleKeydown, true);
      overlay.remove();
      resolve(value);
    };

    const handleKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(options.type === 'alert' ? true : null);
      }
      if (event.key === 'Enter' && options.type !== 'alert') {
        event.preventDefault();
        finish(options.type === 'prompt' ? input.value : true);
      }
    };

    if (options.type !== 'alert') {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = options.cancelText || 'Cancel';
      Object.assign(cancelBtn.style, {
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid #cbd5e1',
        background: '#ffffff',
        color: '#0f172a',
        cursor: 'pointer'
      });
      cancelBtn.addEventListener('click', () => finish(options.type === 'confirm' ? false : null));
      buttonRow.appendChild(cancelBtn);
    }

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.textContent = options.okText || 'OK';
    Object.assign(okBtn.style, {
      padding: '8px 12px',
      borderRadius: '6px',
      border: '1px solid #2563eb',
      background: '#2563eb',
      color: '#ffffff',
      cursor: 'pointer'
    });
    okBtn.addEventListener('click', () => finish(options.type === 'prompt' ? input.value : true));
    buttonRow.appendChild(okBtn);

    dialog.appendChild(buttonRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', handleKeydown, true);

    if (input) {
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    } else {
      requestAnimationFrame(() => okBtn.focus());
    }
  });
}

function showAppAlert(message, title) {
  return showAppDialog({ type: 'alert', message: message, title: title || 'Message' });
}

function showAppConfirm(message, title) {
  return showAppDialog({ type: 'confirm', message: message, title: title || 'Confirm', okText: 'Continue' });
}

function showAppPrompt(message, defaultValue, title) {
  return showAppDialog({ type: 'prompt', message: message, defaultValue: defaultValue || '', title: title || 'Input', okText: 'Submit' });
}

function getLineDashArray(lineType) {
  if (lineType === 'dashed') return '8 4';
  if (lineType === 'dotted') return '2 4';
  return '';
}

function applyConnectionLineStyle(line, style = {}) {
  if (!line) return;

  const strokeColor = style.strokeColor || line.dataset.strokeColor || '#007bff';
  const strokeWidth = String(style.strokeWidth || line.dataset.strokeWidth || '2');
  const lineType = style.lineType || line.dataset.lineType || 'solid';
  const dashArray = getLineDashArray(lineType);

  line.dataset.strokeColor = strokeColor;
  line.dataset.strokeWidth = strokeWidth;
  line.dataset.lineType = lineType;

  line.style.stroke = strokeColor;
  line.style.strokeWidth = strokeWidth;
  if (dashArray) {
    line.style.strokeDasharray = dashArray;
  } else {
    line.style.strokeDasharray = '';
  }
}

function hideLineSubmenus() {
  document.querySelectorAll('.line-context-submenu').forEach(menu => {
    menu.style.display = 'none';
  });
}

function hideLineContextMenu() {
  const menu = document.getElementById('context-menu');
  if (!menu) return;

  menu.style.display = 'none';
  hideLineSubmenus();
  selectedConnectionLine = null;
}

function showLineContextMenu(line, clientX, clientY) {
  const menu = document.getElementById('context-menu');
  const colorPicker = document.getElementById('line-color-picker');
  if (!menu || !line) return;

  selectedConnectionLine = line;
  menu.style.display = 'block';
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;
  hideLineSubmenus();

  if (colorPicker) {
    colorPicker.value = line.dataset.strokeColor || '#007bff';
  }
}

function setupLineContextMenu() {
  const menu = document.getElementById('context-menu');
  if (!menu || menu.dataset.lineMenuReady === 'true') return;

  menu.dataset.lineMenuReady = 'true';

  document.addEventListener('contextmenu', (event) => {
    const line = event.target && event.target.closest ? event.target.closest('.device-connection-line:not(.is-temporary)') : null;
    if (!line) {
      hideLineContextMenu();
      return;
    }

    event.preventDefault();
    showLineContextMenu(line, event.clientX, event.clientY);
  });

  document.addEventListener('mousedown', (event) => {
    if (menu.contains(event.target)) return;
    hideLineContextMenu();
  });

  menu.querySelectorAll('.line-context-item').forEach(button => {
    button.addEventListener('click', () => {
      const submenuName = button.dataset.lineSubmenu;
      const submenu = document.getElementById(`line-submenu-${submenuName}`);
      if (!submenu) return;

      const willOpen = submenu.style.display !== 'block';
      hideLineSubmenus();
      if (willOpen) {
        submenu.style.display = 'block';
        submenu.style.left = `${button.offsetWidth + 10}px`;
        submenu.style.top = `${button.offsetTop}px`;
      } else {
        submenu.style.display = 'none';
      }
    });
  });

  menu.querySelectorAll('.line-width-option').forEach(button => {
    button.addEventListener('click', () => {
      if (!selectedConnectionLine) return;
      applyConnectionLineStyle(selectedConnectionLine, { strokeWidth: button.dataset.lineWidth });
      hideLineContextMenu();
    });
  });

  menu.querySelectorAll('.line-type-option').forEach(button => {
    button.addEventListener('click', () => {
      if (!selectedConnectionLine) return;
      applyConnectionLineStyle(selectedConnectionLine, { lineType: button.dataset.lineType });
      hideLineContextMenu();
    });
  });

  const colorPicker = document.getElementById('line-color-picker');
  if (colorPicker) {
    colorPicker.addEventListener('input', () => {
      if (!selectedConnectionLine) return;
      applyConnectionLineStyle(selectedConnectionLine, { strokeColor: colorPicker.value });
    });
    colorPicker.addEventListener('change', () => {
      hideLineContextMenu();
    });
  }
}

function setConfigurationMode(enabled) {
  const mainPanel = document.getElementById('main-panel');
  if (mainPanel) {
    mainPanel.classList.toggle('config-mode', !!enabled);
  }
}

function getConnectionSvg() {
  const grid = document.getElementById('device-grid');
  if (!grid) return null;

  let svg = document.getElementById('connection-svg');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'connection-svg';
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    grid.insertBefore(svg, grid.firstChild);
  }

  return svg;
}

function getSvgPointFromClient(clientX, clientY) {
  const svg = getConnectionSvg();
  if (!svg) return { x: 0, y: 0 };

  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;

  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };

  return point.matrixTransform(matrix.inverse());
}

function getContactDescriptor(point) {
  if (!point) return null;

  const box = point.closest('.device-box, .valve-icon, .deco-box');
  if (!box) return null;

  const side = ['top', 'bottom', 'left', 'right', 'center'].find(cls => point.classList.contains(cls));
  if (!side) return null;

  return {
    boxId: box.id,
    side: side,
    element: point
  };
}

function appendContactPoints(container) {
  if (!container || container.querySelector('.contact-point')) return;

  ['top', 'bottom', 'left', 'right'].forEach(side => {
    const point = document.createElement('div');
    point.className = `contact-point ${side}`;
    container.appendChild(point);
  });
}

function appendSingleContactPoint(container) {
  if (!container || container.querySelector('.contact-point')) return;

  const point = document.createElement('div');
  point.className = 'contact-point center';
  container.appendChild(point);
}

function getContactAnchor(point) {
  if (!point) return null;

  const rect = point.getBoundingClientRect();
  return getSvgPointFromClient(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function setConnectionLinePosition(line, startPoint, endPoint) {
  line.setAttribute('x1', startPoint.x);
  line.setAttribute('y1', startPoint.y);
  line.setAttribute('x2', endPoint.x);
  line.setAttribute('y2', endPoint.y);
}

function getTimeRangePlotLayout(baseLayout) {
  const nextLayout = Object.assign({}, baseLayout || {});
  const xaxis = Object.assign({}, nextLayout.xaxis || {});

  if (xaxis.type && xaxis.type !== 'date') {
    nextLayout.xaxis = xaxis;
    return nextLayout;
  }

  xaxis.type = 'date';
  xaxis.rangeselector = {
    buttons: [
      { count: 1, step: 'hour', stepmode: 'backward', label: '1h' },
      { count: 3, step: 'hour', stepmode: 'backward', label: '3h' },
      { count: 12, step: 'hour', stepmode: 'backward', label: '12h' },
      { count: 1, step: 'day', stepmode: 'backward', label: '1d' },
      { step: 'all', label: 'All' }
    ]
  };
  xaxis.rangeslider = { visible: true };
  nextLayout.xaxis = xaxis;
  return nextLayout;
}

function refreshConnectionLines() {
  document.querySelectorAll('.device-connection-line:not(.is-temporary)').forEach(line => {
    const startBox = document.getElementById(line.dataset.startBoxId);
    const endBox = document.getElementById(line.dataset.endBoxId);
    const startPoint = startBox && startBox.querySelector(`.contact-point.${line.dataset.startSide}`);
    const endPoint = endBox && endBox.querySelector(`.contact-point.${line.dataset.endSide}`);

    if (!startPoint || !endPoint) {
      line.remove();
      return;
    }

    setConnectionLinePosition(line, getContactAnchor(startPoint), getContactAnchor(endPoint));
  });
}

function clearTemporaryConnection() {
  if (temporaryConnectionLine) {
    temporaryConnectionLine.remove();
    temporaryConnectionLine = null;
  }

  activeConnectionStart = null;
}

function startTemporaryConnection(point, event) {
  const startDescriptor = getContactDescriptor(point);
  if (!startDescriptor) return;

  clearTemporaryConnection();

  activeConnectionStart = startDescriptor;
  temporaryConnectionLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  temporaryConnectionLine.classList.add('device-connection-line', 'is-temporary');
  getConnectionSvg().appendChild(temporaryConnectionLine);

  setConnectionLinePosition(
    temporaryConnectionLine,
    getContactAnchor(point),
    getSvgPointFromClient(event.clientX, event.clientY)
  );
}

function finalizeConnection(point) {
  const endDescriptor = getContactDescriptor(point);
  if (!activeConnectionStart || !endDescriptor) {
    clearTemporaryConnection();
    return;
  }

  if (
    activeConnectionStart.boxId === endDescriptor.boxId &&
    activeConnectionStart.side === endDescriptor.side
  ) {
    clearTemporaryConnection();
    return;
  }

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.classList.add('device-connection-line');
  line.dataset.startBoxId = activeConnectionStart.boxId;
  line.dataset.startSide = activeConnectionStart.side;
  line.dataset.endBoxId = endDescriptor.boxId;
  line.dataset.endSide = endDescriptor.side;
  getConnectionSvg().appendChild(line);
  applyConnectionLineStyle(line);

  setConnectionLinePosition(
    line,
    getContactAnchor(activeConnectionStart.element),
    getContactAnchor(endDescriptor.element)
  );

  clearTemporaryConnection();
}

function getCurrentConnectionsData() {
  return Array.from(document.querySelectorAll('.device-connection-line:not(.is-temporary)')).map(line => ({
    startBoxId: line.dataset.startBoxId,
    startSide: line.dataset.startSide,
    endBoxId: line.dataset.endBoxId,
    endSide: line.dataset.endSide,
    strokeColor: line.dataset.strokeColor || '#007bff',
    strokeWidth: line.dataset.strokeWidth || '2',
    lineType: line.dataset.lineType || 'solid'
  })).filter(line => line.startBoxId && line.startSide && line.endBoxId && line.endSide);
}

function restoreConnectionLines(connections) {
  if (!Array.isArray(connections) || connections.length === 0) {
    refreshConnectionLines();
    return;
  }

  const svg = getConnectionSvg();
  if (!svg) return;

  connections.forEach(connection => {
    const startBox = document.getElementById(connection.startBoxId);
    const endBox = document.getElementById(connection.endBoxId);
    const startPoint = startBox && startBox.querySelector(`.contact-point.${connection.startSide}`);
    const endPoint = endBox && endBox.querySelector(`.contact-point.${connection.endSide}`);

    if (!startPoint || !endPoint) return;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.classList.add('device-connection-line');
    line.dataset.startBoxId = connection.startBoxId;
    line.dataset.startSide = connection.startSide;
    line.dataset.endBoxId = connection.endBoxId;
    line.dataset.endSide = connection.endSide;
    svg.appendChild(line);
    applyConnectionLineStyle(line, connection);
    setConnectionLinePosition(line, getContactAnchor(startPoint), getContactAnchor(endPoint));
  });

  refreshConnectionLines();
}

function setupConnectionDrawing() {
  const grid = document.getElementById('device-grid');
  if (!grid || grid.dataset.connectionDrawingReady === 'true') return;

  grid.dataset.connectionDrawingReady = 'true';
  getConnectionSvg();

  grid.addEventListener('mousedown', (event) => {
    const point = event.target.closest('.contact-point');
    if (!point || !grid.contains(point)) return;

    event.preventDefault();
    event.stopPropagation();
    startTemporaryConnection(point, event);
  }, true);

  document.addEventListener('mousemove', (event) => {
    refreshConnectionLines();

    if (!activeConnectionStart || !temporaryConnectionLine) return;

    setConnectionLinePosition(
      temporaryConnectionLine,
      getContactAnchor(activeConnectionStart.element),
      getSvgPointFromClient(event.clientX, event.clientY)
    );
  });

  document.addEventListener('mouseup', (event) => {
    if (!activeConnectionStart) {
      refreshConnectionLines();
      return;
    }

    const point = event.target && event.target.closest ? event.target.closest('.contact-point') : null;
    if (point) {
      finalizeConnection(point);
    } else {
      clearTemporaryConnection();
    }

    refreshConnectionLines();
  });

  window.addEventListener('resize', refreshConnectionLines);
}

async function setGuiFullscreen(enabled) {
  try {
    if (enabled) {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch (error) {
    console.debug('Fullscreen toggle failed', error);
  }
}

function setPlotsTopHeight() {
  try {
    const plotsTop = document.querySelector('.plots-top');
    const deviceMgr = document.getElementById('device-manager');
    const decoMgr = document.getElementById('decoration-manager');
    if (!plotsTop || !deviceMgr || !decoMgr) return;
    const style = window.getComputedStyle(deviceMgr);
    const marginBottom = parseFloat(style.marginBottom || 0) || 0;
    const total = deviceMgr.offsetHeight + decoMgr.offsetHeight + marginBottom + 8;
    plotsTop.style.minHeight = total + 'px';
  } catch (error) {
    console.debug('setPlotsTopHeight error', error);
  }
}

function toggleConfigView() {
  const btn = document.getElementById('toggle-gui-btn');
  const mainPanel = document.getElementById('main-panel');
  const mainPanelHeader = document.getElementById('main-panel-header');
  const mainPanelTitle = document.getElementById('main-panel-title');
  const mainPanelTitleWrap = document.getElementById('main-panel-title-wrap');
  const configParts = [
    document.getElementById('device-manager'),
    document.getElementById('decoration-manager')
  ];
  const plotsPanel = document.getElementById('plots-panel');
  const editorTopRow = document.getElementById('editor-top-row');
  const viewport = document.getElementById('viewport');
  const btnRow = document.getElementById('main-config-btns');

  if (guiModeActive) {
    configParts.forEach(el => { if (el) el.style.display = ''; });
    if (plotsPanel) plotsPanel.style.display = '';
    if (editorTopRow) editorTopRow.style.display = 'flex';
    if (viewport) viewport.style.height = '75vh';
    if (btn) btn.textContent = 'Show GUI';
    if (btnRow) btnRow.style.display = 'flex';
    if (mainPanel) mainPanel.classList.remove('gui-fullscreen');
    if (mainPanelHeader) mainPanelHeader.style.justifyContent = 'space-between';
    if (mainPanelTitleWrap) mainPanelTitleWrap.style.display = 'flex';
    if (mainPanelTitle) {
      if (!mainPanelTitle.dataset.originalTitle) {
        mainPanelTitle.dataset.originalTitle = 'Configure your system layout';
      }
      mainPanelTitle.textContent = mainPanelTitle.dataset.originalTitle;
      mainPanelTitle.style.display = '';
    }
    guiModeActive = false;
    setConfigurationMode(true);
    setGuiFullscreen(false);
    setPlotsTopHeight();
  } else {
    configParts.forEach(el => { if (el) el.style.display = 'none'; });
    if (plotsPanel) plotsPanel.style.display = 'none';
    if (editorTopRow) editorTopRow.style.display = 'none';
    if (viewport) viewport.style.height = 'calc(100vh - 110px)';
    if (btn) btn.textContent = 'Configure GUI';
    if (btnRow) btnRow.style.display = 'flex';
    if (mainPanel) mainPanel.classList.add('gui-fullscreen');
    if (mainPanelHeader) mainPanelHeader.style.justifyContent = 'flex-end';
    if (mainPanelTitleWrap) mainPanelTitleWrap.style.display = 'none';
    if (mainPanelTitle) {
      if (!mainPanelTitle.dataset.originalTitle) {
        mainPanelTitle.dataset.originalTitle = mainPanelTitle.textContent || 'Configure your system layout';
      }
      mainPanelTitle.textContent = '';
      mainPanelTitle.style.display = 'none';
    }
    guiModeActive = true;
    setConfigurationMode(false);
    setGuiFullscreen(true);
  }
}

document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) return;
  if (!guiModeActive) return;
  console.debug('Fullscreen exited while GUI mode remains active');
});

if (document.readyState === 'loading') 
{
  document.addEventListener('DOMContentLoaded', setupConnectionDrawing, { once: true });
  document.addEventListener('DOMContentLoaded', setupLineContextMenu, { once: true });
  document.addEventListener('DOMContentLoaded', () => { setTimeout(setPlotsTopHeight, 200); }, { once: true });
} 
else 
{
  setupConnectionDrawing();
  setupLineContextMenu();
  setTimeout(setPlotsTopHeight, 200);
}

window.addEventListener('load', setPlotsTopHeight);
window.addEventListener('resize', setPlotsTopHeight);

// function to set background image(s)
function setBackgroundImage() {
  const input = document.getElementById('conn-bg-url');
  const raw = input.value.trim();
  const urls = raw.split(',').map(u => u.trim()).filter(u => u);
  
  const imgs = document.querySelectorAll('.bg-img');
  
  if (urls.length > 0) {
    imgs.forEach((img, i) => {
      // Cycle through URLs if fewer than 5
      let url = urls[i % urls.length];
      img.style.backgroundImage = `url('${url}')`;
    });
    localStorage.setItem('system_bg', raw);
  } else {
    imgs.forEach(img => img.style.backgroundImage = '');
    localStorage.removeItem('system_bg');
  }
}


// function to load saved background image
function loadSavedBackground() {

  const raw = localStorage.getItem('system_bg');

      if (match) {
        select.value = match;
        dev_box = createDeviceDisplay(true); // This creates it at default pos
        // Find the newly created box (last one)
        const boxes = document.querySelectorAll('.device-box');
        const newBox = boxes[boxes.length - 1];
        if (newBox) {
          newBox.style.left = d.left;
          newBox.style.top = d.top;
          if(d.width) newBox.style.width = d.width;
          if(d.height) newBox.style.height = d.height;
          // clear transform/data attributes so absolute left/top apply correctly
          try { newBox.style.transform = ''; newBox.removeAttribute('data-x'); newBox.removeAttribute('data-y'); } catch(e){}
        }
      } else {
        // If this device wasn't matched to an available device, it may be
        // a synthetic element such as a sample magazine slot (id starts with
        // 'mag-'). Restore a placeholder slot so saved positions are kept.
        try {
          const isMag = (d.logicalName && d.logicalName.startsWith && d.logicalName.startsWith('mag-')) || (d.id && d.id.startsWith && d.id.startsWith('mag-'));
          if (isMag) {
            const grid = document.getElementById('device-grid');
            if (grid) {
              const slot = document.createElement('div');
              slot.className = 'sample-slot device-box';
              slot.id = d.id || ('mag-' + Date.now());
              slot.style.position = 'absolute';
              slot.style.left = d.left || '200px';
              slot.style.top = d.top || '50px';
              if (d.width) slot.style.width = d.width; else slot.style.width = '120px';
              if (d.height) slot.style.height = d.height; else slot.style.height = '120px';
              slot.style.padding = '6px';
              slot.style.boxSizing = 'border-box';
              slot.style.cursor = 'move';
              slot.style.zIndex = '5';

              // Header with title and remove button
              const header = document.createElement('div');
              header.className = 'device-header';
              header.style.height = '20px';
              header.style.display = 'flex';
              header.style.alignItems = 'center';
              header.style.justifyContent = 'space-between';

              const title = document.createElement('div');
              title.className = 'device-title';
              title.textContent = d.device || slot.id;
              title.style.fontSize = '12px';
              title.style.paddingRight = '6px';
              header.appendChild(title);

              const removeBtn = document.createElement('div');
              removeBtn.className = 'deco-remove';
              removeBtn.innerHTML = '&times;';
              removeBtn.style.cursor = 'pointer';
              removeBtn.onclick = (e) => { e.stopPropagation(); slot.remove(); };
              header.appendChild(removeBtn);
              slot.appendChild(header);

              // image placeholder
              const imgHolder = document.createElement('div');
              imgHolder.style.width = '100%';
              imgHolder.style.height = '86px';
              imgHolder.style.display = 'flex';
              imgHolder.style.alignItems = 'center';
              imgHolder.style.justifyContent = 'center';
              imgHolder.style.overflow = 'hidden';

              const img = document.createElement('img');
              img.style.maxWidth = '100%';
              img.style.maxHeight = '100%';
              img.style.objectFit = 'contain';
              img.src = '/c/assets/sample_holder.svg';
              // If layout provided an image URL for this saved slot, use it
              try { if (d && d.image) img.src = d.image; } catch (e) { /* ignore */ }
              imgHolder.appendChild(img);
              slot.appendChild(imgHolder);

              const resizeHandle = document.createElement('div');
              resizeHandle.className = 'resize-handle';
              slot.appendChild(resizeHandle);

              grid.appendChild(slot);
              makeDraggable(slot);
              makeResizable(slot);
            }
          }
        } catch (err) {
          console.error('applyLayout: failed to restore synthetic device', err);
        }
      }
    const input = document.getElementById('conn-bg-url');

    if (input) input.value = raw;

  }


//function to add node connection
async function addNodeConnection() {
  
  const ip = document.getElementById('conn-ip').value;
  
  const port = document.getElementById('conn-port').value;
  
  if (!ip || !port) {
    await showAppAlert('Please enter both IP and Port.', 'Add Node');
    return;
  }
  
  if (window.Spin) {
      pendingAddedNodeAddr = `${ip.trim()}:${port.trim()}`;
      Spin.send_request('nodemanager.add_node', "", "input", "set", {host: ip, port: port});
      // Alert will be handled by nodemanager.status update
      document.getElementById('conn-ip').value = '';
      document.getElementById('conn-port').value = '';
  } 
  else 
  {
      await showAppAlert('Not connected to Spin server.', 'Add Node');
  }
}

function fetchNodesList() 

{
    if (window.Spin) {
        Spin.send_request('nodemanager.list_nodes', "", "read", "read", null);
    }
}

// Call fetchNodesList on load and display nodes info
document.addEventListener('DOMContentLoaded', () => {
  // Wait for Spin to initialize before fetching nodes
  waitForSpin(() => {
    
    loadNodesInfo();
    // Populate dropdown from localStorage immediately and request server list
    try 
    
    { 
      updateLayoutList(); 
    } 

    catch (e) 
    
    { 
      console.error('updateLayoutList error', e); 
    }

     apply_previous_layout();
   
  });
});

function apply_previous_layout()
{
   //If a layout was previously selected, apply it
    const selectedLayout = sessionStorage.getItem('selectedLayout');
  
    if (selectedLayout)
    {
  
      const layouts = getStoredLayouts();
  
      if (layouts[selectedLayout]) {
  
        applyLayout(layouts[selectedLayout]);
  
        document.getElementById('layout-select').value = selectedLayout;
  
      }
    }
}

function waitForSpin(callback) {
  // Wait for Spin to be ready and connected
  const checkSpin = () => {
    if (window.Spin && window.Spin.current_socket && window.Spin.current_socket.readyState === WebSocket.OPEN && typeof window.Spin.send_request === 'function') {
      callback();
    } else {
      setTimeout(checkSpin, 200);
    }
  };
  checkSpin();
}




function loadNodesInfo() {
  // Use Spin API to get the list of nodes and populate dropdown
  const dropdown = document.getElementById('nodes-info-dropdown');
 
  if (!dropdown) return;
 
  dropdown.innerHTML = '<option value="">Loading...</option>';
 
  if (window.Spin && window.Spin.send_request) {
 
    window.Spin.send_request('nodemanager.list_nodes', '', 'read', 'read', null, function(nodesList) {
 
      dropdown.innerHTML = '';
 
      if (Array.isArray(nodesList) && nodesList.length > 0) {
 
        nodesList.forEach(node => {
 
          const label = node.equipment_id ? `${node.host}:${node.port} (${node.equipment_id})` : `${node.host}:${node.port}`;
 
          dropdown.innerHTML += `<option value="${node.host}:${node.port}">${label}</option>`;
 
        });
 
      } else {
 
        dropdown.innerHTML = '<option value="">No nodes available</option>';
 
      }
 
    });
 
  } else {
 
    dropdown.innerHTML = '<option value="">Connecting to server...</option>';
 
  }

}

function displayNodesInfo(nodesList) {
  const infoContent = document.getElementById('nodes-info-content');
  if (!infoContent) return;
  if (!nodesList || nodesList.length === 0) {
    infoContent.textContent = 'No nodes configured';
    return;
  }
  let html = '<ul style="list-style: none; padding: 0; margin: 0;">';
  nodesList.forEach((node, index) => {
    const nodeName = `${node.host}:${node.port}`;
    html += `<li style="padding: 4px 0; border-bottom: 1px solid #e9ecef;">
      <strong>Node ${index + 1}:</strong> ${nodeName} (${node.equipment_id})
    </li>`;
  });
  html += '</ul>';
  infoContent.innerHTML = html;
}

function connectToGUI(is_configure) {
  // Check if Spin is ready before connecting
  if (!window.Spin || !window.Spin.current_socket || window.Spin.current_socket.readyState !== WebSocket.OPEN) {
    alert('Connection to server not ready. Please wait a moment and try again.');
    return;
  }
  
  // Switch to main panel
  enterSystem(is_configure);
  // Then load selected layout
  const select = document.getElementById('layout-select');
  const name = select.value;

  if (name) 
    {
    const layouts = getStoredLayouts();
    
    if (layouts[name]) 
      {
      if (is_configure)
      {
       applyLayout(layouts[name]);
      }
      else
        {
       connect_to_system(layouts[name]);
        }
      sessionStorage.setItem('selectedLayout', name);
    }
    // If this decoration is editable text, focus it so the user can start typing
    try {
      if (el.contentEditable === 'true' || el.isContentEditable) {
        setTimeout(() => {
          try {
            el.focus();
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (e) { /* ignore focus errors */ }
        }, 0);
      }
    } catch (e) { /* ignore */ }

  }

  
}



function enterSystem(isConfigure = true) {
  // This function is now only for switching views.
  // The button is always visible.
  document.getElementById('connection-panel').style.display = 'none';
  document.getElementById('main-panel').style.display = 'block';
  setConfigurationMode(isConfigure);

  if (isConfigure && guiModeActive) {
    toggleConfigView();
  } else if (!isConfigure && !guiModeActive) {
    toggleConfigView();
  }
  
  // Fetch device params when entering the system to ensure dropdown is populated
  fetchDeviceParams();
}

function connectToNode() {
    // Legacy function kept if needed, but redirected to addNodeConnection logic if called
    addNodeConnection();
}

function disconnectNode() {
  document.getElementById('main-panel').style.display = 'none';
  document.getElementById('connection-panel').style.display = 'flex';
 
}

// ===== Status Badge Updates =====
window.addEventListener('spinupdate', function(event) 
{
  try {
    var key = event.detail.key || '';
    
       fetchNodesList(); 
       loadNodesInfo();
       
     

    if (key === 'nodemanager.nodes') {
        var nodes = event.detail.value;
        if (nodes && Array.isArray(nodes)) {
            displayNodesInfo(nodes);
        }
        return;
    }

    if (key === 'nodemanager.status') {
        var msg = event.detail.value;
        if (msg) {
      if (msg === 'Node added successfully' || msg === 'Node already present in runtime') {
        fetchNodesList();
        loadNodesInfo();
        fetchDeviceParams();
        fetchAndMergeLatestValuesOnce()
          .then(() => refreshVisibleDeviceBoxes())
          .catch(() => {});
      }
        showAppAlert(msg, 'Node Manager');
        }
        return;
    }

    if (key === 'nodemanager.device_params') {
        var data = event.detail.value;
      
        if (data) {
            const previousKeys = WRITABLE_PARAMS ? new Set(Object.keys(WRITABLE_PARAMS)) : new Set();
            WRITABLE_PARAMS = data;
            populateDeviceList(data);
            if (pendingAddedNodeAddr) {
              let mappedCount = 0;
              Object.keys(data).forEach((deviceName) => {
                if (!previousKeys.has(deviceName)) {
                  runtimeDeviceNodeAddrs[deviceName] = pendingAddedNodeAddr;
                  mappedCount += 1;
                }
              });
              if (mappedCount > 0) {
                saveRuntimeDeviceNodeAddrs();
                pendingAddedNodeAddr = null;
              }
            }
            fetchAndMergeLatestValuesOnce()
              .then(() => refreshVisibleDeviceBoxes())
              .catch(() => {});
        }
       
        return;
    }

  if (key === 'nodemanager.list_layouts') {
    try {
      const list = (event.detail.value || []).slice().sort();
      const select = document.getElementById('layout-select');
      if (select) {
        // Remove existing options (keep first placeholder) and replace with server list
        while (select.options.length > 1) select.remove(1);
        list.forEach(name => {
          const option = document.createElement('option');
          option.value = name;
          option.text = name;
          select.add(option);
        });
        // If a previously selected layout no longer exists on server, clear it
        const sel = sessionStorage.getItem('selectedLayout');
        if (sel && !list.includes(sel)) {
          sessionStorage.removeItem('selectedLayout');
          if (select.value === sel) select.value = '';
        }
      }
    } catch (e) { console.error('list_layouts spinupdate error', e); }
    return;
  }

  if (key === 'nodemanager.get_layout') {
    try {
      const layout = event.detail.value;
      if (layout) {
        applyLayout(layout);
      }
    } catch (e) { console.error('get_layout spinupdate error', e); }
    return;
  }

  if (key === 'nodemanager.save_layout') 
  {
    try {
      
      const resp = event.detail.value;

      if (resp && resp.name) {
   
        // Refresh server list so dropdown shows the new file
        if (window.Spin && window.Spin.send_request) {  
          try 
          { 
            window.Spin.send_request('nodemanager.list_layouts', '', 'read', 'read', null); 
          } 
          
          catch 
          (
            e
          ) 
          { 
            console.error('list_layouts request failed', e); 
          }
        }
          try { alert('Layout saved on server as "' + resp.name + '"' + (resp.path ? (' at ' + resp.path) : '')); }
          catch (e) { /* alert suppressed */ }
      }
    } 
    catch 
    (
      e
    ) 
    { 
      console.error('save_layout spinupdate error', e); 
    }
    return;
  }
    
    var state = event.detail.state || '';
    var state_str = event.detail.state_str || '';
    
    // Extract device name (everything before the first dot)
    var device = key.split('.')[0];
    var param = key.includes('.') ? key.split('.').slice(1).join('.') : '';
    var domId = deviceDomId(device);
    
    // 1. Update Status Badge
    var statusEl = document.getElementById('status-' + domId);
    if (statusEl && (state || state_str)) {
      statusEl.textContent = state_str || state || 'unknown';
      statusEl.className = 'status-badge ' + (state ? ('state-' + state) : 'state-warn');
    } else {}

    // 2. Update Value/Target Fields (Manual update for dynamic elements)
    var val = event.detail.value;
    var unit = event.detail.unit || '';
    var formatted = (val !== undefined && val !== null) ? (val + (unit ? ' ' + unit : '')) : '--';

    if (param === '' || param === 'value') {
        // Main value update
        var valEl = document.getElementById('val-' + domId);
        if (valEl) valEl.textContent = formatted;
    } else if (param === 'target') {
        // Target update
        var targetEl = document.getElementById('target-' + domId);
        if (targetEl) targetEl.textContent = formatted;
    } else if (param === '_gastype') {
        // Gas type update
        var gasEl = document.getElementById('gas-' + domId);
        if (gasEl) gasEl.textContent = formatted;
    }
   
    // If this is a sample-magazine-like device, update the slot images.
    if (device.includes('storage')) 
    { 
      
    
      try {
        // Safely retrieve the array from latestValues. The backend cache
        // may not have populated latestValues[device] yet, so guard access
        // and fall back to 'target' if 'value' is missing.
        let arr = [""];
    
        const devEntry = latestValues[device];
        if (devEntry && devEntry['value']) 
        {
          const v = devEntry['value'];
          arr = (v && typeof v.value !== 'undefined') ? v.value : v;
        } 
        
        else 
        {
          // no data yet — try to merge from backend once then bail; the
          // fetch will call updateSampleSlotImages again after merging.
          try { fetchAndMergeLatestValuesOnce(); } catch (e) {}
          return;
        }
        
      
        if (Array.isArray(arr)) {
        
          updateSampleSlotImages(device, arr);
        
        } 
        else 
        {
          console.debug('sample slot update: expected array but got', typeof arr, arr);
        }
      } 
      catch (e) 
      {
        console.error('sample slot update error', e);
      }
    }

    
    if (device.includes("sample_at_measurement"))
    {   
        
        const devEntry = latestValues[device];
        if (devEntry && devEntry['target']) 
        {
          const v = devEntry['target'];
          presence_val = (v && typeof v.value !== 'undefined') ? v.value : v;
        } 
       
        else 
        {
          
          return;
        }
      
      //try to merge from backend once then bail; the
      // fetch will call updateSampleSlotImages again after merging.
        fetchAndMergeLatestValuesOnce(); 
      
        updateSamplepresence(device, presence_val); 
    
    }
  } catch(e) 
  { 
    console.error('status update error', e);
  }
});


// ===== Send Values to Backend =====
function sendValue(key, inputElementId) {
  try {
    const inputEl = document.getElementById(inputElementId);
    if (!inputEl) return;
    const value = inputEl.value.trim();
    if (!value) return;
    let finalValue = isNaN(value) ? value : parseFloat(value);
    Spin.send_request(key, "", "input", "", finalValue);
  
    inputEl.value = '';
  } catch(e) { 
    console.error('sendValue failed', e); 
  }
}

function sendSelectedParam(device, domId) {
  try {
    const paramSelect = document.getElementById('param-select-' + domId);
    const valueInput = document.getElementById('param-value-' + domId);
    if (!paramSelect || !valueInput) return;
    
    const param = paramSelect.value;
    const value = valueInput.value.trim();
    
    if (!param) { alert('Please select a parameter first'); return; }
    if (!value) { alert('Please enter a value'); return; }
    
    let finalValue = isNaN(value) ? value : parseFloat(value);
    const key = device + '.' + param;
    Spin.send_request(key, "", "input", "", finalValue);
   
    valueInput.value = '';
  } catch(e) {
    console.error('sendSelectedParam failed', e);
  }
}

function onParamSelectChange(device, domId) {
  const paramSelect = document.getElementById('param-select-' + domId);
  const param = paramSelect.value;
  
  if (!param) {
    updateParamDisplay(device, domId, null);
    return;
  }
  
  // Update display with current value
  updateParamDisplay(device, domId, param);
}

function updateParamDisplay(device, domId, param) 
{
  const currentValueDiv = document.getElementById('param-current-value-' + domId);
  const inputContainer = document.getElementById('param-input-container-' + domId);
  
  if (!param || !currentValueDiv || !inputContainer) {
    if (currentValueDiv) currentValueDiv.innerHTML = '';
    return;
  }
  
  // Get current value from latestValues
  const data = latestValues[device] || {};
  const entry = data[param];
  
  if (!entry || entry.value === undefined) {
    currentValueDiv.innerHTML = `<em>Current: (no data)</em>`;
    // Ensure a text input exists, but don't replace it if the user is interacting
    let existing = inputContainer.querySelector('#param-value-' + domId);
    if (!existing || existing.tagName.toLowerCase() !== 'input') {
      // remove children and add input
      inputContainer.innerHTML = '';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.id = 'param-value-' + domId;
      inp.className = 'control-input';
      inp.placeholder = 'val';
      inp.style.flex = '1';
      inputContainer.appendChild(inp);
    }
    return;
  }
  
  const value = entry.value;
  const unit = entry.unit || '';
  
  // Format current value display
  let displayValue;
  if (Array.isArray(value)) {
    displayValue = '[' + value.join(', ') + ']';
  } else if (typeof value === 'object' && value !== null) {
    displayValue = JSON.stringify(value);
  } else {
    displayValue = String(value);
  }
  
  currentValueDiv.innerHTML = `Current: <strong>${displayValue}</strong>${unit ? ' ' + unit : ''}`;
  
  // Check if parameter has enum values in WRITABLE_PARAMS
  const deviceInfo = WRITABLE_PARAMS && WRITABLE_PARAMS[device] ? WRITABLE_PARAMS[device] : null;
  if (!deviceInfo || !deviceInfo.param_info) return;

  const paramInfo = deviceInfo.param_info;

  // Find the param definition
  let found = null;
  for (let i = 0; i < paramInfo.length; i++) {
    const item = paramInfo[i];
    if (item[param]) { found = item[param]; break; }
  }
  if (!found) {
    // default to text input if we don't know the type
    let existing = inputContainer.querySelector('#param-value-' + domId);
    if (!existing || existing.tagName.toLowerCase() !== 'input') {
      inputContainer.innerHTML = '';
      const inp = document.createElement('input');
      inp.type = 'text'; inp.id = 'param-value-' + domId; inp.className = 'control-input'; inp.placeholder = 'val'; inp.style.flex = '1';
      inputContainer.appendChild(inp);
    }
    return;
  }

  // If enum type, ensure a select exists and update its options without clobbering user's interaction
  if (found.datainfo && found.datainfo.type === 'enum') 
    {
    const enumNames = found.datainfo.members || {};
    const keys = Object.keys(enumNames);
    let sel = inputContainer.querySelector('#param-value-' + domId);
    if (!sel || sel.tagName.toLowerCase() !== 'select') {
      // create select
      inputContainer.innerHTML = '';
      sel = document.createElement('select');
      sel.id = 'param-value-' + domId;
      sel.className = 'control-input';
      sel.style.flex = '1';
      const opt = document.createElement('option'); opt.value = ''; opt.text = '-- Select --'; sel.appendChild(opt);
      keys.forEach(name => {
        const o = document.createElement('option'); o.value = name; o.text = name;
        if (String(name) === String(value)) o.selected = true;
        sel.appendChild(o);
      });
      inputContainer.appendChild(sel);
    } 
    else 
    {
      // update options only if user isn't interacting with the control
      if (document.activeElement === sel) return;
      sel.innerHTML = '';
      const opt = document.createElement('option'); opt.value = ''; opt.text = '-- Select --'; sel.appendChild(opt);
      keys.forEach(name => {
        const o = document.createElement('option'); o.value = name; o.text = name;
        if (String(name) === String(value)) o.selected = true;
        sel.appendChild(o);
      });
    }
  } 
  else 
  {
    // Use text input for other types. Preserve existing input value if user is typing.
    let existing = inputContainer.querySelector('#param-value-' + domId);
    if (!existing || existing.tagName.toLowerCase() !== 'input') {
      inputContainer.innerHTML = '';
      const inp = document.createElement('input');
      inp.type = 'text'; inp.id = 'param-value-' + domId; inp.className = 'control-input'; inp.placeholder = 'val'; inp.style.flex = '1';
      inputContainer.appendChild(inp);
    }
    // don't overwrite existing.value here; leave user input intact
  }
}

function applyCachedDeviceState(device, domId) {
  const data = latestValues[device];
  if (!data) return;

  const statusEntry = data.status;
  const valueEntry = data.value;
  const targetEntry = data.target;
  const gasEntry = data._gastype;

  const formatEntry = (entry) => {
    if (!entry || entry.value === undefined || entry.value === null) return '--';
    const value = entry.value;
    const unit = entry.unit || '';
    let displayValue;
    if (Array.isArray(value)) {
      displayValue = '[' + value.join(', ') + ']';
    } else if (typeof value === 'object') {
      displayValue = JSON.stringify(value);
    } else {
      displayValue = String(value);
    }
    return displayValue + (unit ? ' ' + unit : '');
  };

  if (statusEntry) {
    const statusEl = document.getElementById('status-' + domId);
    if (statusEl) {
      const state = statusEntry.state || '';
      const stateStr = statusEntry.state_str || '';
      statusEl.textContent = stateStr || state || 'unknown';
      statusEl.className = 'status-badge ' + (state ? ('state-' + state) : 'state-warn');
    }
  }

  const valEl = document.getElementById('val-' + domId);
  if (valEl && valueEntry) valEl.textContent = formatEntry(valueEntry);

  const targetEl = document.getElementById('target-' + domId);
  if (targetEl && targetEntry) targetEl.textContent = formatEntry(targetEntry);

  const gasEl = document.getElementById('gas-' + domId);
  if (gasEl && gasEntry) gasEl.textContent = formatEntry(gasEntry);

  if (device.includes('storage') && valueEntry) {
    const storageValue = valueEntry.value;
    if (Array.isArray(storageValue)) {
      updateSampleSlotImages(device, storageValue);
    }
  }

  if (device.includes('sample_at_measurement') && targetEntry) {
    updateSamplepresence(device, targetEntry.value);
  }

  const paramSelect = document.getElementById('param-select-' + domId);
  if (paramSelect && paramSelect.value) {
    updateParamDisplay(device, domId, paramSelect.value);
  }

  const panel = document.getElementById('extra-' + domId);
  if (panel && panel.classList.contains('open')) {
    renderExtra(device);
  }
}

function refreshVisibleDeviceBoxes() {
  document.querySelectorAll('.device-box[data-device]').forEach((box) => {
    const device = box.dataset.device;
    if (!device) return;
    applyCachedDeviceState(device, deviceDomId(device));
    if (!latestValues[device] || Object.keys(latestValues[device]).length === 0) {
      hydrateDeviceFromNode(device).catch(() => {});
    }
  });
}

// ===== Extra Parameters Panel =====
const latestValues = {};

// Try to fetch latest values from the extended backend API and merge them
// into the frontend `latestValues` cache. This helps when websocket/spin
// updates arrive late or the UI loads before the cached values are populated.
async function fetchAndMergeLatestValuesOnce() {
  try {
    let res = null;
   
    // Fallback to direct backend port (CORS is enabled on the backend)
    if (!res || !res.ok)
       {
      // relative failed or returned non-ok; try absolute backend URL
      try 
      {
        res = await fetch('http://127.0.0.1:8001/api/latest_values');
  
      } catch (e) {
        console.debug('fetchLatestValues: both relative and absolute fetch failed', e);
        return;
      }
    }
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    for (const k of Object.keys(data)) {
      try {
        const entry = data[k];
        const parts = k.split('.');
        if (parts.length < 2) continue;
        const device = parts[0];
        const param = parts.slice(1).join('.');
        if (!latestValues[device]) latestValues[device] = {};
        latestValues[device][param] = {
          value: entry.value,
          unit: entry.unit,
          state: entry.state,
          state_str: entry.state_str
        };
       
      } catch (e) {
        console.debug('fetchLatestValues: failed to merge key', k, e);
      }
    }

   
  } catch (e) {
    console.debug('fetchLatestValues: error', e);
  }
}



// device name to sanitized DOM ID
function deviceDomId(device) 
{
  // Use the full device name, just sanitized for DOM ID safety
  // This ensures consistency regardless of the naming convention
  return device.replace(/[^a-zA-Z0-9_-]/g, '_');
}



function renderExtra(device) 
{
  const id = deviceDomId(device);
  const panel = document.getElementById('extra-' + id);
  if (!panel) return;
  
  const data = latestValues[device] || {};
  const deviceInfo = WRITABLE_PARAMS && WRITABLE_PARAMS[device] ? WRITABLE_PARAMS[device] : null;
  const liveKeys = Object.keys(data);
  const metadataKeys = deviceInfo && Array.isArray(deviceInfo.all_params) ? deviceInfo.all_params : [];
  const keys = Array.from(new Set([...liveKeys, ...metadataKeys])).sort();
  const filteredKeys = keys.filter(k => k !== 'value' && k !== 'target');
  
  if (filteredKeys.length === 0) {
    panel.innerHTML = '<div class="extra-row"><em>No additional parameters</em></div>';
    return;
  }
  
   
  let html = '';
  
  for (let k of filteredKeys) {
    const entry = data[k];
    let v = entry && entry.value !== undefined ? entry.value : '—';
    const u = entry && entry.unit ? (' ' + entry.unit) : '';
    
    // Format value based on type
    let displayValue;
    if (Array.isArray(v)) 
    
    {
      displayValue = '[' + v.join(', ') + ']';
    } 
    else if (typeof v === 'object' && v !== null) 
      
    {
      displayValue = JSON.stringify(v);
    } else 
      
    {
      displayValue = String(v);
    }
    
    html += `<div class="extra-row"><div>${k}</div><div>${displayValue}${u}</div></div>`;
  }
  panel.innerHTML = html;
}

function handleExpansion(box, originalHeight) 
{
    requestAnimationFrame(() => {
        const newHeight = box.offsetHeight;
        const heightIncrease = newHeight - originalHeight;

        if (heightIncrease > 0) {
            const boxRect = box.getBoundingClientRect();
            const containerRect = box.parentElement.getBoundingClientRect();

            document.querySelectorAll('.device-box, .deco-box').forEach(otherEl => {
                if (otherEl.id === box.id) return;

                const otherRect = otherEl.getBoundingClientRect();

                // Check if other display is below the expanding box and horizontally overlapping
                const isBelow = otherRect.top > boxRect.top;
                
                const isHorizontallyOverlapping = (boxRect.left < otherRect.right && boxRect.right > otherRect.left);

                if (isBelow && isHorizontallyOverlapping) {
                    const currentTop = otherRect.top - containerRect.top;
                    const newTop = currentTop + heightIncrease;

                    otherEl.style.transition = 'top 0.2s ease-out';
                    otherEl.style.top = newTop + 'px';
                    
                    setTimeout(() => { otherEl.style.transition = ''; }, 200);
                }
            });
        }
    });
}

function handleCollapse(box, originalHeight) {
    requestAnimationFrame(() => {
        const newHeight = box.offsetHeight;
        const heightReduction = originalHeight - newHeight;

        if (heightReduction > 0) {
            const boxRect = box.getBoundingClientRect();
            const containerRect = box.parentElement.getBoundingClientRect();

            document.querySelectorAll('.device-box, .deco-box').forEach(otherEl => {
                if (otherEl.id === box.id) return;

                const otherRect = otherEl.getBoundingClientRect();

                // Check if otherEl is below the collapsing box and horizontally overlapping
                const isBelow = otherRect.top > boxRect.top;
                const isHorizontallyOverlapping = (boxRect.left < otherRect.right && boxRect.right > otherRect.left);

                if (isBelow && isHorizontallyOverlapping) {
                    const currentTop = otherRect.top - containerRect.top;
                    const newTop = currentTop - heightReduction;

                    otherEl.style.transition = 'top 0.2s ease-out';
                    otherEl.style.top = newTop + 'px';
                    
                    setTimeout(() => { otherEl.style.transition = ''; }, 200);
                }
            });
        }
    });
}

function toggleExtra(device) {
  const domId = deviceDomId(device);
  const panel = document.getElementById('extra-' + domId);
  const box = document.getElementById('box-' + domId);
  if (!panel || !box) return;

  const isOpening = !panel.classList.contains('open');
  const originalHeight = box.offsetHeight;
  
  if (isOpening) {
    renderExtra(device);
  }
  
  panel.classList.toggle('open');
  panel.setAttribute('aria-hidden', isOpening ? 'false' : 'true');
  
  // Force reflow
  box.offsetHeight;
  
  // Wait for DOM to update
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (isOpening) {
        handleExpansion(box, originalHeight);
      } else {
        handleCollapse(box, originalHeight);
      }
    });
  });
}

function toggleDeviceBody(domId) {
  const body = document.getElementById('body-' + domId);
  const btn = document.getElementById('expand-btn-' + domId);
  const box = document.getElementById('box-' + domId);
  const extraPanel = document.getElementById('extra-' + domId);
  const device = box ? box.dataset.device : null;
  
  if (!body || !btn || !box) return;
  
  const isExpanding = body.style.display === 'none';
  const originalHeight = box.offsetHeight;

  if (isExpanding) {
    body.style.display = 'block';
    btn.textContent = '▲';
    box.style.height = 'auto';

    if (extraPanel && device) {
      renderExtra(device);
      extraPanel.classList.add('open');
      extraPanel.setAttribute('aria-hidden', 'false');
    }
    
    // Wait for DOM to update
    requestAnimationFrame(() => {
      handleExpansion(box, originalHeight);
    });
  } else {
    if (extraPanel) {
      extraPanel.classList.remove('open');
      extraPanel.setAttribute('aria-hidden', 'true');
    }

    body.style.display = 'none';
    btn.textContent = '▼';
    box.style.height = 'auto';
    
    requestAnimationFrame(() => {
      handleCollapse(box, originalHeight);
    });
  }
}

// ===== Device Management =====
var WRITABLE_PARAMS = null; 

function fetchDeviceParams()
{
    
    if (window.Spin) {
        Spin.send_request('nodemanager.get_device_params', "", "read", "read", null);
    }
}

function populateDeviceList(data) 
{
  const select = document.getElementById('device-select');
  if (!select) return;
  
  // Clear existing (except first)
  while (select.options.length > 1) select.remove(1);
  
  Object.keys(data).sort().forEach(device => {
    const option = document.createElement('option');
    option.value = device;
    const devInfo = data[device] || {};
    option.text = device;
    select.add(option);
  });
}

function createDeviceDisplay(isConfigurelayout) 

{
  const select = document.getElementById('device-select');
  const device = select.value;
  
  if (!device)  
  
    {
    alert('Please select a device first.');
    return;
  }
  
  const domId = deviceDomId(device);
  if (document.getElementById('box-' + domId)) 
  {
    // alert('Display for ' + device + ' already exists.');
    return;
  }
  
  // Get original device name from WRITABLE_PARAMS when available
  const deviceData = WRITABLE_PARAMS ? WRITABLE_PARAMS[device] : null;
  const displayName = deviceData && deviceData.original_name ? deviceData.original_name : device;
  // Check if this is a valve_controller device - check both original_name and full device name
  const isValveController = (displayName && displayName.toLowerCase().includes('valve_controller')) || 
                            device.toLowerCase().includes('valve_controller');
  
  // check if this is a sample_magazine device
  const isSample_magazine_device = (displayName && displayName.toLowerCase().includes('storage')) || 
                            device.toLowerCase().includes('storage');
  // check if this is a sample position device
  const isSample_position_device = (displayName && displayName.toLowerCase().includes('sample_at_measurement')) || 
                            device.toLowerCase().includes('sample_at_measurement');
  // If isSample_magazine_device is true, choose  drivable device template, Default to device-template if both conditions are false
  const templateId = isSample_magazine_device ? 'drivable_device-template': isValveController ? 'valve-controller-template' : 'device-template';  // 

  
  const template = document.getElementById(templateId);
  
  const clone = template.content.cloneNode(true);
  
  // Replace placeholders in HTML
  const tempDiv = document.createElement('div');
  tempDiv.appendChild(clone);
  let html = tempDiv.innerHTML;
  
  html = html.replace(/{{DOM_ID}}/g, domId)
             .replace(/{{DEVICE}}/g, device)
             .replace(/{{TITLE}}/g, displayName);
             
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  const newBox = wrapper.firstElementChild;
  newBox.dataset.device = device;

  if (isConfigurelayout) {
    newBox.classList.add('configure-layout');
  } else {
    newBox.classList.remove('configure-layout');
  }
  
  // Position it intelligently
  const count = document.querySelectorAll('.device-box').length;
  newBox.style.top = (20 + count * 110) + 'px'; // Stack vertically
  newBox.style.left = '20px';
  
  newBox.style.zIndex = '10';
  document.getElementById('device-grid').appendChild(newBox);
  // Ensure the title element reflects the canonical display name (protect against stale template or saved layout values)
  const titleEl = newBox.querySelector('.device-title');
  if (titleEl) 
  
    titleEl.textContent = displayName;
  
  // Collapse device body by default so loaded layouts don't open every box
  const bodyEl = newBox.querySelector('#body-' + domId);
  const expandBtn = newBox.querySelector('#expand-btn-' + domId);
  if (bodyEl) bodyEl.style.display = 'none';
  if (expandBtn) expandBtn.textContent = '▼';
  
  // Custom display logic based on device type
  const lowerDev = device.toLowerCase();
  const labelDiv = newBox.querySelector('.device-field > div:first-child');
  const targetSpan = newBox.querySelector(`#target-${domId}`);
  const gasSpan = newBox.querySelector(`#gas-${domId}`);
  if (device.toLowerCase().includes('massflow'))
    {
     targetSpan.style.display = 'inline';     
     gasSpan.style.display = 'inline';     
    } 
  else 
    {
        if (isSample_position_device)
      {
       labelDiv.textContent = 'current sample';    
      }       

    } 
  const sep1 = newBox.querySelector('.sep-1');
  const sep2 = newBox.querySelector('.sep-2');
  
  if (isConfigurelayout)
  {
   makeDraggable(newBox);
   makeResizable(newBox);  
  }
  
  
  let isReadable = false;
  if (WRITABLE_PARAMS && WRITABLE_PARAMS[device] && WRITABLE_PARAMS[device].interface_classes) {
      if (WRITABLE_PARAMS[device].interface_classes.includes('Readable')) {
          isReadable = true;
      }
  }

  if (isReadable) 
  {
      // Show only Value
      if (labelDiv) labelDiv.textContent = 'Val';
      if (targetSpan) targetSpan.style.display = 'none';
      if (gasSpan) gasSpan.style.display = 'none';
      if (sep1) sep1.style.display = 'none';
      if (sep2) sep2.style.display = 'none';
  }
  else if (lowerDev.includes('backpress') || lowerDev.includes('temp')) 
  {   
     
      // Show only Value and Target
      if (labelDiv) labelDiv.textContent = 'Val / Target';
      if (targetSpan) targetSpan.style.display = 'inline';
      if (gasSpan) gasSpan.style.display = 'none';
      if (sep2) sep2.style.display = 'none';
  }
  
  // Populate params/commands
  if (WRITABLE_PARAMS && WRITABLE_PARAMS[device]) {
    populateParamsForDevice(device, WRITABLE_PARAMS[device], domId);
  }
  
  // Trigger Spin to bind new data-spin elements if possible
  if (window.Spin) {
      if (window.Spin.reload) {
         
          window.Spin.reload();
      } else {
         
          // Fallback: Try to manually trigger a scan if we can guess the method
          // or maybe we need to re-init?
          if (window.Spin.init) {
            
             window.Spin.init();
          }
      }
  } else {
      debug('Error: window.Spin not found');
  }
 
  // For valve_controller, setup valve displays after Spin connects
  if (isValveController) {
      setTimeout(() => setupValveController(device, domId,isConfigurelayout), 1000);
  }

  // for sample magazine, create slots display for all samples
  if (isSample_magazine_device) {
   
    setTimeout(() => {
      setupSampleMagazine(device, domId,isConfigurelayout);
      applyCachedDeviceState(device, domId);
    }, 1000);
  }

  // create a slot block to indicate sample presence at measurement location
  if (isSample_position_device) {
   
    setTimeout(() => {
      setupSample_presence(device,isConfigurelayout);
      applyCachedDeviceState(device, domId);
    }, 1000);
  }

  applyCachedDeviceState(device, domId);
  fetchAndMergeLatestValuesOnce()
    .then(() => {
      applyCachedDeviceState(device, domId);
      if (!latestValues[device] || Object.keys(latestValues[device]).length === 0) {
        return hydrateDeviceFromNode(device);
      }
    })
    .then(() => applyCachedDeviceState(device, domId))
    .catch(() => {});

  return newBox;
}


// make sample magazine display: create independent slot elements appended
// directly to #device-grid so each slot can be moved/resized independently.
async function setupSample_presence(device,isConfigurelayout) 
{
  // Be tolerant: ensure data exists
  const data = latestValues[device];
  if (!data) return;

  // get value
  let valueEntry = data.value; 
  const sample_ID = valueEntry.value;

  const grid = document.getElementById('device-grid');
  if (!grid) return;
  
  const placeholder = '/c/assets/sample_holder.svg';
  
  const Id = `sample_presence`;

    // If an element with the same id already exists (for example restored from a saved
    // layout), keep it and only refresh its image/handlers. 
  const prev = document.getElementById(Id);
  if (prev) {
      try {
        const storageKey = `sample_presence`;
        const override = (localStorage && localStorage.getItem) ? localStorage.getItem(storageKey) : null;
        const imgEl = prev.querySelector && prev.querySelector('img');
        if (imgEl) {
          if (override) imgEl.src = override;
          else if (!imgEl.src) imgEl.src = placeholder;
        }
      } catch (err) {
        // ignore localStorage errors
      }
      // Re-apply draggable/resizable in case handlers are missing
      if (isConfigurelayout)
      {

      try { makeDraggable(prev); } catch (e) {}
      try { makeResizable(prev); } catch (e) {}
      }
    
      // Existing slot preserved — skip creating a new one
    return;

}
   slot = make_slot(Id,0,"sample presence");

  // check presence, shows sample image if presents
   if (sample_ID != "") 
    {
    const imgHolder = document.createElement('div');
    imgHolder.style.width = '100%';
    imgHolder.style.height = '86px';
    imgHolder.style.display = 'flex';
    imgHolder.style.alignItems = 'center';
    imgHolder.style.justifyContent = 'center';
    imgHolder.style.overflow = 'hidden';

    const img = document.createElement('img');
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100%';
    img.style.objectFit = 'contain';
    img.src = placeholder;
    img.style.cursor = 'pointer';
    imgHolder.appendChild(img);
    slot.appendChild(imgHolder);
    }

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    
    slot.appendChild(resizeHandle);

    grid.appendChild(slot);

    // Make each slot individually draggable/resizable
     if (isConfigurelayout)
     {
       makeDraggable(slot);
       makeResizable(slot); 
     }

}

function make_slot(slotId,idx,slot_label)
{
    const slot = document.createElement('div');
    slot.className = 'sample-slot device-box';
    slot.id = slotId;
    slot.style.position = 'absolute';
    // Position slots in a row starting at x=200, y=50 (similar spacing as before)
    slot.style.left = (200 + idx * 130) + 'px';
    slot.style.top = '50px';
    slot.style.width = '120px';
    slot.style.height = '120px';
    slot.style.padding = '6px';
    slot.style.boxSizing = 'border-box';
    slot.style.cursor = 'move';
    slot.style.zIndex = '5';

    const header = document.createElement('div');
    header.className = 'device-header';
    header.style.height = '20px';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';

    const title = document.createElement('div');
    title.className = 'device-title';
    title.textContent = slot_label;
    title.style.fontSize = '12px';
    title.style.paddingRight = '6px';
    header.appendChild(title);

    const removeBtn = document.createElement('div');
    removeBtn.className = 'deco-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.style.position = 'absolute'; // or 'relative'
    removeBtn.style.top = '10px'; // adjust as necessary
    removeBtn.style.right = '10px'; // adjust as necessary

    removeBtn.style.cursor = 'pointer';
    removeBtn.onclick = (e) => { e.stopPropagation(); slot.remove(); };
    header.appendChild(removeBtn);

    slot.appendChild(header);

    return slot
}
// make sample magazine display: create independent slot elements appended
// directly to #device-grid so each slot can be moved/resized independently.
async function setupSampleMagazine(device, domId,isConfigurelayout) 
{
  // Be tolerant: ensure data exists
  const data = latestValues[device];
  if (!data) return;

  // Prefer 'value' then 'target'
  let valueEntry = data.value || data.target;
  if (!valueEntry || !valueEntry.value || !Array.isArray(valueEntry.value)) return;
  const arr = valueEntry.value;

  const grid = document.getElementById('device-grid');
  if (!grid) return;

  // We'll create one slot element per entry and append directly to grid.
  // Use placeholder from runtime configuration; allow a per-slot localStorage override.
  const placeholder = '/c/assets/sample_holder.svg';

  arr.forEach((item, idx) => {
    const slotId = `mag-${domId}-slot-${idx}`;
    

    // If a slot with the same id already exists (for example restored from a saved
    // layout), keep it and only refresh its image/handlers. This prevents
    // setupSampleMagazine from overwriting positions that were restored by
    // applyLayout.
    const prev = document.getElementById(slotId);
    if (prev) {
      try {
        const storageKey = `magimg:${device}:${idx}`;
        const override = (localStorage && localStorage.getItem) ? localStorage.getItem(storageKey) : null;
        const imgEl = prev.querySelector && prev.querySelector('img');
        if (imgEl) {
          if (override) imgEl.src = override;
          else if (!imgEl.src) imgEl.src = placeholder;
        }
      } catch (err) {
        // ignore localStorage errors
      }
      // Re-apply draggable/resizable in case handlers are missing
      if (isConfigurelayout)
      {
      try { makeDraggable(prev); } catch (e) {}
      try { makeResizable(prev); } catch (e) {}
      }
      
      // Existing slot preserved — skip creating a new one
      return;
    }
    
    slot = make_slot(slotId, idx, arr[idx]);
    
    
    const imgHolder = document.createElement('div');
    imgHolder.style.width = '100%';
    imgHolder.style.height = '86px';
    imgHolder.style.display = 'flex';
    imgHolder.style.alignItems = 'center';
    imgHolder.style.justifyContent = 'center';
    imgHolder.style.overflow = 'hidden';

    const img = document.createElement('img');
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100%';
    img.style.objectFit = 'contain';

    // For configuration/runtime copy we force the placeholder by default to avoid
    // treating backend sample names as URLs; allow a local override per-slot.
    const storageKey = `magimg:${device}:${idx}`;
    let override = null;
    img.src = placeholder;
    img.style.cursor = 'pointer';
    img.title = 'Click to set image URL (saved locally)';
    img.onclick = (e) => {
      e.stopPropagation();
      const current = img.src && img.src.startsWith('data:') ? '' : (override || '');
      const url = prompt('Enter image URL for this slot (or leave empty to clear):', current);
      try {
        if (url) {
          localStorage.setItem(storageKey, url);
          img.src = url;
          override = url;
        } else {
          localStorage.removeItem(storageKey);
          override = null;
          img.src = placeholder;
        }
      } catch (err) { console.error('Failed to save mag image override', err); }
    };

    imgHolder.appendChild(img);
    slot.appendChild(imgHolder);
  
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    
    slot.appendChild(resizeHandle);

    grid.appendChild(slot);

    // Make each slot individually draggable/resizable
     if (isConfigurelayout)
    {
    makeDraggable(slot);
    makeResizable(slot);
    }
  });
}


// Update sample presence at measurement location
function updateSamplepresence(device, presence_val) 
{
  try {
   
   
    const domId = deviceDomId(device);
    const placeholder = '/c/assets/sample_holder.svg';
    const slotId = `sample_presence`;
   
    
     
  
    const slot = document.getElementById(slotId);
  
    if (!slot) return;
    const imgEl = slot.querySelector && slot.querySelector('img');
 
   
    if (presence_val!="") 
      {
        // item is non-empty → try to map item -> URL when possible
      try 
        {
            
         
            // Fallback to placeholder to indicate presence
            imgEl.src = placeholder;
          
        } 
      catch (e) 
        {
          imgEl.src = placeholder;
        }
    
      imgEl.style.display = '';
        
      } 
      else 
      {
        // empty slot — hide image
        imgEl.src = '';
        imgEl.style.display = 'none';
       
      };
  } catch (e) {
    console.error('update Sample presence failed', e);
  }
}


// Update images for sample magazine slots for a given device.
// arr is the array value coming from the device parameter. If an
// element is falsy, the corresponding slot image is hidden/cleared.
function updateSampleSlotImages(device, arr) {
  try {
    if (!Array.isArray(arr)) {
      
      return;
    }
   
    const domId = deviceDomId(device);
    const placeholder = '/c/assets/sample_holder.svg';
    
    
    
    arr.forEach((item, idx) => {
     
      const slotId = `mag-${domId}-slot-${idx}`;
      const slot = document.getElementById(slotId);
     
      
      if (!slot) return;
      const imgEl = slot.querySelector && slot.querySelector('img');
      
      if (!imgEl) return;

      // local override takes precedence
      const storageKey = `magimg:${device}:${idx}`;
      let override = null;
      try { override = localStorage.getItem(storageKey); } catch (e) { override = null; }
      
      if (override) {
        imgEl.src = override;
        imgEl.style.display = '';
        
      } else if (item) {
        // item is non-empty → try to map item -> URL when possible
        try {
            
            // Fallback to placeholder to indicate presence
            imgEl.src = placeholder;
          
        } catch (e) {
          imgEl.src = placeholder;
        }
        imgEl.style.display = '';
        
      } else {
        // empty slot — hide image
        imgEl.src = '';
        imgEl.style.display = 'none';
       
    
      }
    });
  } catch (e) {
    console.error('updateSampleSlotImages failed', e);
  }
}

async function setupValveController(device, domId,isConfigurelayout) {
   
  // Get the value parameter from latestValues (populated by Spin updates)
  // Wait a bit for Spin to populate the data
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const data = latestValues[device];
 
  
  if (!data) {
    // No data available for device in latestValues
    return;
  }
  
  // Try to find the struct in 'value' or 'target'
  // Prefer 'target' if 'value' is missing or empty, as logs showed target has the data
  let valueEntry = data.value;
 
  let paramName = 'value';
 
  if ((!valueEntry || !valueEntry.value) && data.target) {
    
      valueEntry = data.target;
      paramName = 'target';
  }
  
  if (!valueEntry || !valueEntry.value) {
   
    return;
  }
  
  const valueData = valueEntry.value;

  
   
  if (!valueData || typeof valueData !== 'object') {
   
    return;
  
  }
  
  // Remove the valve controller box itself since we'll create individual valves
  const controllerBox = document.getElementById(`box-${domId}`);
  if (controllerBox) {
    // Remove the controller box when creating individual valve icons
    controllerBox.remove();
  }
  
  // Create a separate draggable SVG icon for each valve (no box)
  Object.keys(valueData).forEach((fieldName, index) => {
       
      const lowerField = fieldName.toLowerCase();
      const isSwitch = lowerField.includes('switch');
      const isValve = lowerField.includes('valve') || fieldName.startsWith('V');
      
      
      
      if (!isSwitch && !isValve) return; // Skip non-valve fields
      
      const valveDomId = `${domId}_${fieldName}`;
      
      // Create a simple draggable SVG container (no device box)
      const valveIcon = document.createElement('div');
      // valve style
      valveIcon.className = 'valve-icon';
      valveIcon.id = `icon-${valveDomId}`;
      valveIcon.dataset.device = device; // Store device name
      valveIcon.dataset.field = fieldName; // Store field name
      valveIcon.style.position = 'absolute';
      valveIcon.style.width = '80px';
      valveIcon.style.height = '100px';
      valveIcon.style.top = (20 + index * 120) + 'px';
      valveIcon.style.left = '20px';
      valveIcon.style.cursor = 'pointer';
      valveIcon.style.userSelect = 'none';
      valveIcon.style.overflow = 'visible';
      if (isConfigurelayout) valveIcon.classList.add('configure-layout');
      appendContactPoints(valveIcon);
      
      // Image Container
      const imgContainer = document.createElement('div');
      imgContainer.id = `img-${valveDomId}`;
      imgContainer.style.cssText = 'width: 80px; height: 80px; position: relative;';
      
      if (isSwitch) {
        // Switch image - rotates based on position (circle with two separate arcs)
        const img = document.createElement('img');
        // Circle with two separate arcs touching the circle edge
        img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI0IiBoZWlnaHQ9IjEwNiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTI0IiBoZWlnaHQ9IjEwNiIgZmlsbD0id2hpdGUiLz48ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSg2Miw1MykiPjxjaXJjbGUgY3g9IjAiIGN5PSIwIiByPSI0NSIgZmlsbD0id2hpdGUiIHN0cm9rZT0iIzMzMyIgc3Ryb2tlLXdpZHRoPSIzIi8+PHBhdGggZD0iTSAtNDQuMyA2LjcgQSA0NSA0NSAwIDAgMSAtNi43IDQ0LjMiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzMzMyIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48cGF0aCBkPSJNIDQ0LjMgLTYuNyBBIDQ1IDQ1IDAgMCAxIDYuNyAtNDQuMyIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMzMzIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvZz48L3N2Zz4=';

        img.style.cssText = 'width: 100%; height: 100%; object-fit: contain; transform: rotate(0deg); transition: transform 0.3s ease;';
        imgContainer.appendChild(img);
        
        // Click to toggle between position 0 and 1
        imgContainer.onclick = () => {
          const data = latestValues[device];
          let currentValue = 0;
          if (data && data[paramName] && data[paramName].value && data[paramName].value[fieldName] !== undefined) {
            currentValue = data[paramName].value[fieldName];
          }
          currentValue = toNumeric(currentValue);
          const newValue = currentValue === 0 ? 1 : 0;
          setValveField(device, fieldName, newValue);
          updateSwitchRotation(imgContainer, newValue);
        };
      } else if (isValve) {
        // Valve image - SVG with two triangles pointing toward each other (touching at tips)
        const img = document.createElement('img');
        img.id = `valve-img-${valveDomId}`;
        // Two triangles with points touching in the center: ◄ ►
        img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9Ijk0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iOTQiIGZpbGw9IiNmZmYiLz48cG9seWdvbiBwb2ludHM9IjEwLDIwIDEwLDc0IDYwLDQ3IiBmaWxsPSIjMjhhNzQ1IiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMiIvPjxwb2x5Z29uIHBvaW50cz0iMTEwLDIwIDExMCw3NCA2MCw0NyIgZmlsbD0iIzI4YTc0NSIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjIiLz48L3N2Zz4=';

        img.style.cssText = 'width: 100%; height: 100%; object-fit: contain;';
        imgContainer.appendChild(img);
        
        // Click to toggle valve ON/OFF
        imgContainer.onclick = () => {
          const data = latestValues[device];
          let currentValue = 0;
          if (data && data[paramName] && data[paramName].value && data[paramName].value[fieldName] !== undefined) {
            currentValue = data[paramName].value[fieldName];
          }
          currentValue = toNumeric(currentValue);
          const newValue = currentValue === 1 ? 0 : 1;
          setValveField(device, fieldName, newValue);
          // Immediately update the visual
          updateValveImage(valveDomId, newValue);
        };
      }
      // Set initial visual state from the live value if available
      try {
        const liveRaw = (valueData && typeof valueData[fieldName] !== 'undefined') ? valueData[fieldName] : undefined;
        if (typeof liveRaw !== 'undefined') {
          const lv = toNumeric(liveRaw);
          if (!isSwitch) {
            updateValveImage(valveDomId, lv);
          } else {
            updateSwitchRotation(imgContainer, lv);
            const valveEl = imgContainer.closest('.valve-icon');
            if (valveEl) valveEl.dataset.open = lv === 1 ? '1' : '0';
          }
        }
      } catch (e) { /* ignore init errors */ }
      
      // Label below the icon
      const label = document.createElement('div');
      label.style.cssText = 'font-size: 10px; color: #333; text-align: center; margin-top: 4px; font-weight: 600;';
      label.textContent = fieldName;
      
      // Resize handle
      const resizeHandle = document.createElement('div');
      resizeHandle.style.cssText = 'position: absolute; bottom: 0; right: 0; width: 12px; height: 12px; background: #007bff; cursor: nwse-resize; border-radius: 2px; opacity: 0.7;';
      resizeHandle.title = 'Resize';
      resizeHandle.style.display = "flex";
      
      // Hidden data-spin element for value updates
      const valueDisplay = document.createElement('div');
      valueDisplay.id = `valve-${valveDomId}`;
      valueDisplay.style.display = 'none';
  // Prefer binding to live value so the icon shows real state immediately.
  // For runtime-created icons we already use paramName, but for restored icons
  // we want `value` explicitly to reflect actual valve states.
      valueDisplay.setAttribute('data-spin', `@${device}.value.${fieldName}`);
      
      valveIcon.appendChild(imgContainer);
      valveIcon.appendChild(label);
      valveIcon.appendChild(resizeHandle);
      valveIcon.appendChild(valueDisplay);
      
       if (isConfigurelayout)
      {
      // Remove button
      const removeBtn = document.createElement('div');
      removeBtn.className = 'deco-remove';
      removeBtn.style.cursor = 'pointer';
      removeBtn.onclick = function(e) {
       e.stopPropagation(); // Prevent bubbling
       valveIcon.remove();
      };
      valveIcon.appendChild(removeBtn);    
      }
      // Add to grid
      const grid = document.getElementById('device-grid');
     
      if (grid) 
      {
        grid.appendChild(valveIcon);
      } else {
        console.error('device-grid not found!');
      }
      
  
  
  
      // Make it draggable (simple drag without device-box features)
      if (isConfigurelayout)
      {
       makeValveIconDraggable(valveIcon);
       makeValveIconResizable(valveIcon, imgContainer);
      }
      
      
      
      // double-click to remove valve icon
      valveIcon.addEventListener('dblclick', (e) => {
        e.stopPropagation();

        if (!confirm('Are you sure you want to remove this valve icon?')) return;

        // Remove from DOM
        valveIcon.remove();

        // If a layout is currently selected (we are editing a preset), remove this
        // icon from the stored layout so subsequent saves or reloads reflect the change.
        try {
          const selected = sessionStorage.getItem('selectedLayout');
          if (selected) {
            const layouts = getStoredLayouts();
            if (layouts && layouts[selected] && Array.isArray(layouts[selected].valveIcons)) {
              layouts[selected].valveIcons = layouts[selected].valveIcons.filter(v => v.id !== valveIcon.id);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
              // Refresh dropdown in case UI needs update
              updateLayoutList();
            }
          }
        } catch (err) {
          console.error('Error updating stored layout after removing valve icon', err);
        }
      });
    });
    
    // Reload Spin to bind the new data-spin attributes
    if (window.Spin && window.Spin.reload) {
      window.Spin.reload();
    }
    
    // Set up listeners for value updates to update images
    setupValveImageListeners(device, domId);
}
// update image after switch rotation
function updateSwitchRotation(imgContainer, position) {
  const img = imgContainer.querySelector('img');
  if (img) {
    const rotation = position * 90; // 0 or 90 degrees
    img.style.transform = `rotate(${rotation}deg)`;
  }
}

function updateValveImage(valveDomId, isOpen) {
  const img = document.querySelector(`#valve-img-${valveDomId}`);
  if (img) {
    // Change to green when open, black when closed
    if (isOpen) {
      // Green triangles for open valve
      img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9Ijk0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iOTQiIGZpbGw9IiNmZmYiLz48IS0tIExlZnQgdHJpYW5nbGUgcG9pbnRpbmcgcmlnaHQgLS0+PHBvbHlnb24gcG9pbnRzPSIxMCwyMCAxMCw3NCA2MCw0NyIgZmlsbD0iIzI4YTc0NSIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjIiLz48IS0tIFJpZ2h0IHRyaWFuZ2xlIHBvaW50aW5nIGxlZnQgLS0+PHBvbHlnb24gcG9pbnRzPSIxMTAsMjAgMTEwLDc0IDYwLDQ3IiBmaWxsPSIjMjhhNzQ1IiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==';
    } else {
      //  triangles for closed valve
      img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9Ijk0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iOTQiIGZpbGw9IiNmZmYiLz48cG9seWdvbiBwb2ludHM9IjEwLDIwIDEwLDc0IDYwLDQ3IiBmaWxsPSIjMDAwMDAwIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMiIvPjxwb2x5Z29uIHBvaW50cz0iMTEwLDIwIDExMCw3NCA2MCw0NyIgZmlsbD0iIzAwMDAwMCIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjIiLz48L3N2Zz4=';

    // reflect optimistic/UI state on the parent valve element so clicks can read it
    try {
      const valveEl = img.closest('.valve-icon');
      if (valveEl) valveEl.dataset.open = isOpen ? '1' : '0';
    } catch (e) { /* ignore */ }
    }
  }
}

function setupValveImageListeners(device, domId) {
  // Listen for updates and update image states
  window.addEventListener('spinupdate', function(event) {
    try {
      const key = event.detail.key || '';
      if (!key.startsWith(device)) return;
      
      const parts = key.split('.');
      if (parts.length < 3) return;
      
      const paramName = parts[1]; // 'value' or 'target'
      const fieldName = parts[2]; // e.g., 'V1_1', 'Switch1'
      
      const valveDomId = `${domId}_${fieldName}`;
      const imgContainer = document.getElementById(`img-${valveDomId}`);
      
      if (!imgContainer) return;
      
      const raw = event.detail.value;
      const valNum = toNumeric(raw);
      const lowerField = fieldName.toLowerCase();

      if (lowerField.includes('switch')) {
        // Update switch rotation
        updateSwitchRotation(imgContainer, valNum);
      } else {
        // Update valve appearance
        updateValveImage(valveDomId, valNum === 1);
      }
    } catch (e) {
      console.error('Image update error', e);
    }
  });
}

function makeValveIconDraggable(el) {
  let isDragging = false;
  let startX, startY, initialLeft, initialTop;
  
  el.addEventListener('mousedown', (e) => {

    
    // Only start drag if clicking on the element itself, not the image
    if (e.target.tagName === 'IMG' || e.target.closest('img')) return;
    
    if (e.button !== 0) return;
    
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
   
    const style = window.getComputedStyle(el);
    initialLeft = parseInt(style.left, 10) || el.offsetLeft;
    initialTop = parseInt(style.top, 10) || el.offsetTop;
    
    el.style.zIndex = 1000;
    e.preventDefault();
  });

 

  // Add resize handle if it doesn't exist (keep previous behavior)
  let resizeHandle = el.querySelector('.resize-handle');
  if (!resizeHandle && el.dataset.type !== 'label') {
    resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    el.appendChild(resizeHandle);

    resizeHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (e.button !== 0) return;

      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;

      const style = window.getComputedStyle(el);
      initialWidth = parseInt(style.width, 10);
      initialHeight = parseInt(style.height, 10);

      e.preventDefault();
    });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault();

  

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.style.left = `${initialLeft + dx}px`;
    el.style.top = `${initialTop + dy}px`;
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      el.style.zIndex = '10';
    }
  });
}}

function makeValveIconResizable(valveIcon, imgContainer) {
  const resizeHandle = valveIcon.querySelector('div[title="Resize"]');
  if (!resizeHandle) return;
  
  let isResizing = false;
  let startX, startY, initialWidth, initialHeight;
  
  resizeHandle.addEventListener('mousedown', (e) => {
    e.stopPropagation(); // Prevent dragging when resizing
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    
    const style = window.getComputedStyle(imgContainer);
    initialWidth = parseInt(style.width, 10);
    initialHeight = parseInt(style.height, 10);
    
    e.preventDefault();
  });
  
  window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    e.preventDefault();
    
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    // Keep aspect ratio approximately square
    const newSize = Math.max(40, initialWidth + dx);
    imgContainer.style.width = `${newSize}px`;
    imgContainer.style.height = `${newSize}px`;
    valveIcon.style.width = `${newSize}px`;
    valveIcon.style.height = `${newSize + 20}px`; // +20 for label

  });
  
  window.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
    }
  });
}

function setValveField(device, fieldName, value) {

  window.lastValveCommand = { device, fieldName, value, ts: Date.now() };

  // Build the merged target struct from latestValues (so we always send the full target object)
  const data = latestValues[device];
  let currentStruct = {};
  // Prefer the live `value` struct (actual valve states) as the baseline so
  // we merge the UI change into the controller's current state. Fallback to
  // `target` if no live `value` is available.
  if (data && data.value && data.value.value) {
    currentStruct = {...data.value.value};
  } else if (data && data.target && data.target.value) {
    currentStruct = {...data.target.value};
  }
  currentStruct[fieldName] = value;

  // Prefer using Spin if the socket is connected; otherwise fall back to HTTP PUT
  const spinSocketOpen = window.Spin && window.Spin.current_socket && window.Spin.current_socket.readyState === WebSocket.OPEN;
  if (spinSocketOpen) {
    Spin.send_request(`${device}.target`, "", "input", "", currentStruct);
  } else {
    // Fallback: send the full struct so the backend receives the complete target object
    fetch(`/api/${device}/target`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(currentStruct)
    }).catch(err => {
      debug(`Error setting valve field: ${err}`);
    });
  }
}

function removeDevice(domId) {
  const el = document.getElementById('box-' + domId);
  if (el) el.remove();
  refreshConnectionLines();
}

// ===== Decoration Logic =====
let selectedDeco = null;

function selectDeco(el) {
  if (selectedDeco) selectedDeco.classList.remove('selected');
  selectedDeco = el;
  if (el) {
    // mark selected visually
    el.classList.add('selected');
    // Sync color picker
    const picker = document.getElementById('deco-color');
    if (picker) {
      let color;
      if (el.dataset.type === 'label') {
        color = el.style.color;
      } else {
        const visual = el.querySelector('.deco-visual');
        if (visual) color = visual.style.backgroundColor;
      }
      if (color) {
        if (color.startsWith('#')) {
          picker.value = color;
        } else {
          // try to convert rgb(...) to hex
          const m = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
          if (m) {
            const hex = '#' + [1,2,3].map(i => ('0' + parseInt(m[i],10).toString(16)).slice(-2)).join('');
            picker.value = hex;
          }
        }
      }
    // If this decoration is editable text, focus it so the user can start typing
    try {
      if (el.contentEditable === 'true' || el.isContentEditable) {
        setTimeout(() => {
          try {
            el.focus();
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (e) { }
        }, 0);
      }
    } catch (e) {  }
    }
  }
}

// Initialize listeners for selection and color
document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('device-grid');
  if (grid) {
    grid.addEventListener('mousedown', (e) => {
      if (e.target === grid) selectDeco(null);
    });
    // Enable dropping device-boxes back onto the grid
    grid.ondragover = (e) => { e.preventDefault(); };
    grid.ondrop = (e) => {
      const boxId = e.dataTransfer.getData('text/plain');
      const box = document.getElementById(boxId);
      if (box && box.classList.contains('device-box')) {
        grid.appendChild(box);
        // Position relative to grid
        const rect = grid.getBoundingClientRect();
        box.style.left = (e.clientX - rect.left - 20) + 'px';
        box.style.top = (e.clientY - rect.top - 20) + 'px';
        // Reset z-index and remove controlPanelPage assignment
        box.style.zIndex = '10';
        delete box.dataset.controlPanelPage;
        // Ensure device box is visible and interactive
        box.style.display = 'block';
        box.style.pointerEvents = 'auto';
      }
    };
    // --- Auto-load selected layout if present ---
    const selectedLayoutName = sessionStorage.getItem('selectedLayout');
    if (selectedLayoutName) {
      const layouts = JSON.parse(localStorage.getItem('gas_system_layouts') || '{}');
      if (layouts[selectedLayoutName]) {
        applyLayout(layouts[selectedLayoutName]);
        // Optionally clear selection after load
        // sessionStorage.removeItem('selectedLayout');
      }
    }
  }
    
    const picker = document.getElementById('deco-color');
    if (picker) {
        picker.addEventListener('input', (e) => {
            if (selectedDeco) {
                const color = e.target.value;
                if (selectedDeco.dataset.type === 'label') {
                    selectedDeco.style.color = color;
                } else {
                    const visual = selectedDeco.querySelector('.deco-visual');
                    if (visual) visual.style.backgroundColor = color;
                }
            }
        });
    }
});

function makeDraggable(el) 
{

  let isDragging = false;
  let isResizing = false;
  let startX, startY, initialLeft, initialTop, initialWidth, initialHeight;

  // Make the whole element draggable on mousedown (simple, immediate behavior)
  el.addEventListener('mousedown', (e) => {
    
    // Ignore non-left clicks
    if (e.button !== 0) return;

    // Don't start dragging when interacting with form controls or control sections
    if (e.target.classList && e.target.classList.contains('deco-remove')) return;
    if (e.target.tagName === 'SELECT') return;
    if (e.target.tagName === 'INPUT') return;
    if (e.target.tagName === 'BUTTON') return;
    if (e.target.tagName === 'TEXTAREA') return;
    if (e.target.closest && e.target.closest('.control-section')) return;

    // If user clicked inside editable text, do not start dragging — allow editing
    try {
      // Allow dragging when the user clicks the dedicated drag handle even
      // if the wrapper is contentEditable. Otherwise, clicks inside the
      // editable text should not start a drag.
      if (e.target.isContentEditable && !(e.target.classList && e.target.classList.contains('deco-drag-handle'))) return;
    } catch (err) { /* ignore */ }

    const style = window.getComputedStyle(el);
    initialLeft = parseInt(style.left, 10) || 0;
    initialTop = parseInt(style.top, 10) || 0;
    startX = e.clientX;
    startY = e.clientY;

    isDragging = true;
    el.style.zIndex = '1000';
    e.preventDefault();

    // Prepare HTML5 drag handlers for non-editable elements only
    try {
      if (!el.isContentEditable && el.dataset.type !== 'label') {
        el.setAttribute('draggable', 'true');
        el.ondragstart = (ev) => {
          ev.dataTransfer.setData('text/plain', el.id);
          setTimeout(() => { el.style.display = 'none'; }, 0);
        };
        el.ondragend = (ev) => { el.style.display = 'block'; };
      } else {
        try { el.removeAttribute('draggable'); } catch (e) {}
      }
    } catch (err) { /* ignore */ }
  });

  // Add resize handle if it doesn't exist (keep previous behavior)
  let resizeHandle = el.querySelector('.resize-handle');
  if (!resizeHandle && el.dataset.type !== 'label') {
    resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    el.appendChild(resizeHandle);

    resizeHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (e.button !== 0) return;

      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;

      const style = window.getComputedStyle(el);
      initialWidth = parseInt(style.width, 10);
      initialHeight = parseInt(style.height, 10);

      e.preventDefault();
    });
  }

  window.addEventListener('mousemove', (e) => {
    if (isDragging) {
      e.preventDefault();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = `${initialLeft + dx}px`;
      el.style.top = `${initialTop + dy}px`;
    } else if (isResizing) {
      e.preventDefault();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.width = `${Math.max(20, initialWidth + dx)}px`;
      el.style.height = `${Math.max(20, initialHeight + dy)}px`;
    }
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      el.style.zIndex = '5';
    }
    if (isResizing) {
      isResizing = false;
    }
  });
}

function makeResizable(el) {
  const resizeHandle = el.querySelector('.resize-handle');
  if (!resizeHandle) return;
  
  let isResizing = false;
  let startX, startY, initialWidth, initialHeight;
  
  resizeHandle.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return; // Only left click
    
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    
    const style = window.getComputedStyle(el);
    initialWidth = parseInt(style.width, 10);
    initialHeight = parseInt(style.height, 10);
  });
  
  const onMouseMove = (e) => {
    if (!isResizing) return;
    e.preventDefault();
    
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    el.style.width = `${Math.max(150, initialWidth + dx)}px`;
    el.style.height = `${Math.max(80, initialHeight + dy)}px`;
  };
  
  const onMouseUp = () => {
    if (isResizing) {
      isResizing = false;
    }
  };
  
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function createDecoration(isConfigurelayout) 
{
  const select = document.getElementById('deco-select');
  const colorInput = document.getElementById('deco-color');
  const type = select.value;
  const color = colorInput ? colorInput.value : '#cccccc';
  
 

  const id = 'deco-' + Date.now();
  const wrapper = document.createElement('div');
  wrapper.className = 'deco-box';
  wrapper.id = id;
  wrapper.dataset.type = type;
  if (isConfigurelayout) wrapper.classList.add('configure-layout');
  
  // Selection logic
  wrapper.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      selectDeco(wrapper);
  });

  if (type === 'contact') 
  {
    wrapper.classList.add('deco-type-contact');
    wrapper.style.width = '20px';
    wrapper.style.height = '20px';
    wrapper.style.minWidth = '20px';
    wrapper.style.minHeight = '20px';
    appendSingleContactPoint(wrapper);
  }
  
  else if (type === 'label') 
    
  {
    
    wrapper.classList.add('deco-label');
    wrapper.contentEditable = true;
  // Ensure the label can receive keyboard focus
    wrapper.setAttribute('tabindex', '0');
  // Allow text selection inside the label
    wrapper.style.userSelect = 'text';
    wrapper.textContent = 'Label';
    wrapper.style.color = color;
    wrapper.style.resize = 'none'; 
    // Add a small drag handle (tiny dot) so labels can be moved without interfering with editing
    const dragHandle = document.createElement('div');
    dragHandle.className = 'deco-drag-handle';
    dragHandle.title = 'Drag to move';
    // Position the handle at the top-left outside the label so it doesn't block text clicks.
    // Use inline styles to override the default centered CSS for labels and make it visible.
    dragHandle.style.position = 'absolute';
    dragHandle.style.top = '-6px';
    dragHandle.style.left = '-6px';
    dragHandle.style.transform = 'none';
    dragHandle.style.width = '12px';
    dragHandle.style.height = '12px';
    dragHandle.style.background = 'rgba(0,0,0,0.22)';
    dragHandle.style.borderRadius = '50%';
    dragHandle.style.cursor = 'move';
    dragHandle.style.pointerEvents = 'auto';
    // Keep handle visible for easy dragging of labels
    dragHandle.style.display = 'block';
    dragHandle.style.zIndex = '20';
    wrapper.appendChild(dragHandle);
    // Ensure wrapper is positioned absolutely so left/top moves apply
    wrapper.style.position = wrapper.style.position || 'absolute';
  } 
  
 

  // Remove button
  if ( isConfigurelayout)
  {
  const removeBtn = document.createElement('div');
  removeBtn.className = 'deco-remove';
  removeBtn.innerHTML = '&times;';
  removeBtn.onclick = function(e) {
    e.stopPropagation(); // Prevent bubbling
    wrapper.remove();
  };
  wrapper.appendChild(removeBtn);
  
  makeDraggable(wrapper);
  makeResizable(wrapper);
  }
  
  
  // Position randomly or in a default location
  wrapper.style.left = '100px';
  wrapper.style.top = '100px';
  
  // Append to device-grid
  const grid = document.getElementById('device-grid');
  if (grid) {
    grid.appendChild(wrapper);
  } else {
    console.error('device-grid element not found!');
    return;
  }
  
  return wrapper;

}

function populateParamsForDevice(device, info, domId) {
    // 1. Populate Parameters
    const select = document.getElementById('param-select-' + domId);
    
    if (select && info.params) {
      // Clear existing (except first)
      while (select.options.length > 1) select.remove(1);
      
      info.params.sort().forEach(param => {
        if (param === 'value') return;
        const option = document.createElement('option');
        option.value = param;
        option.text = param;
        select.add(option);
      });
    }

    // 2. Populate Commands
    const cmdContainer = document.getElementById('commands-' + domId);
    if (cmdContainer && info.commands) {
      cmdContainer.innerHTML = '';
      if (info.commands.length === 0) {
        cmdContainer.style.display = 'none';
      } else {
        cmdContainer.style.display = 'flex';
        info.commands.sort().forEach(cmd => {
          const btn = document.createElement('button');
          btn.className = 'cmd-btn';
          btn.textContent = cmd;
          btn.title = `Execute ${cmd}`;
          btn.onclick = () => sendCommand(device, cmd);
          cmdContainer.appendChild(btn);
        });
      }
    }
}





async function getModuleName(device) {
  const runtimeInfo = WRITABLE_PARAMS && WRITABLE_PARAMS[device] ? WRITABLE_PARAMS[device] : null;
  if (runtimeInfo) {
    return runtimeInfo.module_name || runtimeInfo.original_name || null;
  }

  try {
    const res = await fetch('./c/device_params.json');
    const data = await res.json();
    const info = data && data[device] ? data[device] : null;
    return info ? (info.module_name || info.original_name || null) : null;
  } catch (e) {
    return null;
  }
}

function sendCommand(device, cmd) {
  // Run the send logic as an async task so callers don't need to await
  (async () => {
    try {
      const confirmed = await showAppConfirm(`Execute command '${cmd}' on ${device}?`, 'Execute Command');
      if (!confirmed) return;

      // Resolve module name (if available) so we can build full SECoP line.
      // If moduleName cannot be resolved immediately, retry a few times
      // because device metadata may be populated asynchronously.
      let moduleName = null;
      let resolveAttempts = 0;
      const maxResolveAttempts = 6;
      while (!moduleName && resolveAttempts < maxResolveAttempts) {
        resolveAttempts++;
        try {
          moduleName = await getModuleName(device);
        } catch (e) {
          moduleName = null;
        }
        if (moduleName) break;
        // small backoff before retrying
        await new Promise(r => setTimeout(r, 500));
      }

      const commandToSend = `do ${(moduleName || device)}:${cmd}`;

      // Resolve node address for the device via backend API
      let addr = null;
      try {
        const ndResp = await fetch(API_BASE + '/api/node_for_device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device: device })
        });
        if (ndResp.ok) {
          const j = await ndResp.json();
          if (j && j.status === 'ok' && j.addr) addr = j.addr;
        }
      } catch (e) { /* ignore, we'll prompt */ }

      if (!addr) {
        const manual = await showAppPrompt(
          'Could not auto-resolve node for device "' + device + '". Enter host:port to send command:',
          '127.0.0.1:10803',
          'Manual Node Address'
        );
        if (!manual) return;
        addr = manual.trim();
        if (!addr) return;
      }

      // Try sending via proxy with retry logic when backend returns an error.
      const maxRetries = 5;
      let attempt = 0;
      let lastResp = null;

      while (attempt < maxRetries) {
        attempt++;
        try {
          const sendResp = await fetch(API_BASE + '/api/send_request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ addr: addr, command: commandToSend })
          });

          if (!sendResp.ok) {
            lastResp = `HTTP ${sendResp.status}`;
            // backoff and retry
            await new Promise(r => setTimeout(r, Math.min(2000 * attempt, 10000)));
            continue;
          }

          const sr = await sendResp.json();
          lastResp = sr;

          // Successful send
          if (sr && sr.status === 'sent') {
            await showAppAlert('Command sent via proxy. Response: ' + (sr.response || ''), 'Command Sent');
            return;
          }

          // If backend reports an error (e.g., ProtocolError or error__scan), retry
          const textBody = JSON.stringify(sr || '');
          const isProtocolError = textBody.includes('ProtocolError') || textBody.includes('error__scan') || (sr && sr.status === 'error');
          if (!isProtocolError) {
            // Unknown non-retryable response — show it and stop
            await showAppAlert('Proxy response: ' + textBody, 'Command Response');
            return;
          }

          // retry after backoff
          await new Promise(r => setTimeout(r, Math.min(2000 * attempt, 10000)));
        } catch (e) {
          lastResp = e;
          // network or other error — retry after backoff
          await new Promise(r => setTimeout(r, Math.min(2000 * attempt, 10000)));
        }
      }

      // Exhausted retries
      await showAppAlert('Failed to send command after ' + maxRetries + ' attempts. Last response: ' + JSON.stringify(lastResp), 'Command Failed');

    } catch (e) {
      console.error('sendCommand failed', e);
      await showAppAlert('Failed to send command: ' + e, 'Command Failed');
    }
  })();
}


// Cache values for extra panel
window.addEventListener('spinupdate', function(event) {
  try {
    const key = event.detail.key;
    if (!key) return;
    const parts = key.split('.');
    if (parts.length < 2) return;
    const device = parts[0];
    const param = parts.slice(1).join('.');
    
    if (!latestValues[device]) latestValues[device] = {};
    latestValues[device][param] = { 
      value: event.detail.value, 
      unit: event.detail.unit, 
      state: event.detail.state, 
      state_str: event.detail.state_str 
    };
    
    const domId = deviceDomId(device);
    
    // Update extra panel if open
    const panel = document.getElementById('extra-' + domId);
    if (panel && panel.classList.contains('open')) {
      renderExtra(device);
    }
    
    // Update parameter display if this parameter is currently selected
    const paramSelect = document.getElementById('param-select-' + domId);
    if (paramSelect && paramSelect.value === param) {
      updateParamDisplay(device, domId, param);
    }
    
  
   
    
  } catch (e) { 
    console.error('cache spinupdate failed', e); 
  }
});


function rgbToHex(col) {
    if(!col) return null;
    if(col.startsWith('#')) return col;
    const rgb = col.match(/\d+/g);
    if (!rgb || rgb.length < 3) return null;
    const r = parseInt(rgb[0]).toString(16).padStart(2, '0');
    const g = parseInt(rgb[1]).toString(16).padStart(2, '0');
    const b = parseInt(rgb[2]).toString(16).padStart(2, '0');
    return '#' + r + g + b;
}


function updateTransform() {
  // Disabled
}

var currentZoom = 1.0;

function zoomCanvas(delta) {
  if (typeof currentZoom !== 'number' || isNaN(currentZoom)) {
    currentZoom = 1.0;
  }
  currentZoom = Math.max(0.3, Math.min(3.0, currentZoom + delta));
  const grid = document.getElementById('device-grid');
  if (grid) {
    grid.style.transform = `scale(${currentZoom})`;
    grid.style.transformOrigin = '0 0';
    const baseWidth = 3000;
    const baseHeight = 2000;
    grid.style.width = `${baseWidth}px`;
    grid.style.height = `${baseHeight}px`;
  }
  refreshConnectionLines();
}



function resetView() {
  currentZoom = 1.0;
  const grid = document.getElementById('device-grid');
  if (grid) {
    grid.style.transform = 'scale(1)';
  }
  const viewport = document.getElementById('viewport');
  if (viewport) {
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }
  refreshConnectionLines();
}

// Pan Event Listeners
let isPanning = false;
let startPanX, startPanY;





window.addEventListener('mouseup', () => {
  if (isPanning) {
    isPanning = false;
    const vp = document.getElementById('viewport');
    if (vp) vp.style.cursor = 'grab';
  }
});


// ===== Save/Load Layout =====
// STORAGE_KEY is declared at top of script

function getStoredLayouts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('Error reading localStorage', e);
    return {};
  }
}

function updateLayoutList() {
  const select = document.getElementById('layout-select');
  if (!select) return;
  
  // Keep first option
  while (select.options.length > 1) select.remove(1);
  
  const layouts = getStoredLayouts();
  Object.keys(layouts).sort().forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.text = name;
    select.add(option);
  });

  //Also request server-side layouts (if Spin available)
  if (window.Spin && window.Spin.send_request) {
    try {
      window.Spin.send_request('nodemanager.list_layouts', '', 'read', 'read', null);
    } catch (e) {
      console.error('list_layouts request failed', e);
    }
  }
}

function saveLayoutToStorage() {
  const name = prompt('Enter a name for this layout:');
  if (!name) return;
  const layout = getCurrentLayoutData();
  const layouts = getStoredLayouts();
  layouts[name] = layout;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
  updateLayoutList();
  // Try to save on server as well if Spin is available
  if (window.Spin && window.Spin.send_request) {
    try {
      window.Spin.send_request('nodemanager.save_layout', '', 'input', 'set', {name: name, layout: layout});
      // Ask server for updated list (server will write file into layout/)
      window.Spin.send_request('nodemanager.list_layouts', '', 'read', 'read', null);
    } catch (e) {
      console.error('save_layout request failed', e);
    }
  }
  alert('Layout "' + name + '" saved locally (and requested save on server if available).');
}

function loadLayoutFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const layout = JSON.parse(event.target.result);
        // Prompt for a name to store in localStorage and dropdown
        const name = prompt('Enter a name for this layout:', file.name.replace(/\.json$/i, ''));
        if (!name) return;
        const layouts = getStoredLayouts();
        layouts[name] = layout;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
        updateLayoutList();
        alert('Layout "' + name + '" loaded and saved!');
        applyLayout(layout);
      } catch(err) {
        alert('Error loading layout: ' + err);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function loadSelectedLayout() {
  const select = document.getElementById('layout-select');
  const name = select.value;
  if (!name) {
    alert('Please select a layout preset.');
    return;
  }
  
  const layouts = getStoredLayouts();
  if (layouts[name]) {
    // Store the selected layout name in sessionStorage so the viewer page can load it
    sessionStorage.setItem('selectedLayout', name);
    
    // Navigate to viewer page using the Spin page route
    window.location.href = '/?page=viewer';
  } else {
    // Otherwise request it from the server
    if (window.Spin && window.Spin.send_request) {
      try {
        window.Spin.send_request('nodemanager.get_layout', '', 'read', 'read', {name: name});
      } catch (e) {
       
        alert('Failed to request layout from server.');
      }
    } else {
      alert('Layout not found.');
    }
  }
}


// funtion to get a new empty layout
function create_newLayoutFile()
{
  
   
  // remove all device boxes
  const gridEl = document.getElementById('device-grid');
  document.querySelectorAll('.device-box:not(.plot-panel)').forEach(box => 
  {
  box.remove();
  });

  // remove Valve Icons (individual valve/switch icons)
  document.querySelectorAll('.valve-icon').forEach(icon => {
  icon.remove();
  });

  // remove decorations
  document.querySelectorAll('.deco-box').forEach(box => {
  box.remove();
  });
  // remove plots
  document.querySelectorAll('.plot-panel').forEach(box => {
  box.remove();
  });

  document.querySelectorAll('.device-connection-line').forEach(line => {
  line.remove();
  });
  clearTemporaryConnection();
}

// function to get current layout description

function getCurrentLayoutData() {
  const layout = {
    devices: [],
    valveIcons: [],
    decorations: [],
    plots: [],
    connections: []
  };
  
  // Save Devices (regular device boxes) with full device info
    // Exclude plot panels (they are saved separately below)
  const gridEl = document.getElementById('device-grid');
  const gridRect = gridEl ? gridEl.getBoundingClientRect() : { left:0, top:0 };
  document.querySelectorAll('.device-box:not(.plot-panel)').forEach(box => {
  const titleEl = box.querySelector('.device-title');
  const title = titleEl ? titleEl.textContent : '';
  // Try to get logical device name from box id
  const logicalName = box.id.replace(/^box-/, '');
    // Get device info from WRITABLE_PARAMS if available
    let deviceInfo = {};
    if (window.WRITABLE_PARAMS && window.WRITABLE_PARAMS[logicalName]) {
      deviceInfo = window.WRITABLE_PARAMS[logicalName];
    }
    // If this device-box contains an image (sample slot), record it so layouts
    // can restore per-slot images.
    let imageSrc = null;
    try 
    {
      const imgEl = box.querySelector('img');
      if (imgEl && imgEl.src) imageSrc = imgEl.src;
    } 
    catch 
    (e) 
    {
    imageSrc = null; 
    }
    
    // compute fallback position/size from bounding rect if inline style missing
    const rect = box.getBoundingClientRect();
    const left = box.style.left && box.style.left.trim() ? box.style.left : Math.round(rect.left - gridRect.left) + 'px';
    const top = box.style.top && box.style.top.trim() ? box.style.top : Math.round(rect.top - gridRect.top) + 'px';
    const width = box.style.width && box.style.width.trim() ? box.style.width : Math.round(rect.width) + 'px';
    const height = box.style.height && box.style.height.trim() ? box.style.height : Math.round(rect.height) + 'px';
   
    layout.devices.push({
      id: box.id,
      device: title,
      logicalName: logicalName,
      left: left,
      top: top,
      width: width,
      height: height,
      info: deviceInfo,
      image: imageSrc
    });
  });

  // Save Plot panels (if any) so they are restored with layouts.
  try {
    const plotsMap = window._plots && window._plots.plotsMap ? window._plots.plotsMap : null;
    document.querySelectorAll('.plot-panel').forEach(box => {
      const plotId = box.id || null; // e.g., 'plot_1_panel'
      const titleEl = box.querySelector('.plot-title-label');
      const title = titleEl ? titleEl.textContent : (box.querySelector('.plot-header strong') ? box.querySelector('.plot-header strong').textContent : '');
      // find traces from plotsMap if available
      let traces = [];
      let configName = '';
      if (plotsMap) {
        Object.keys(plotsMap).forEach(pid => {
          const p = plotsMap[pid];
          try {
            if (p && p.containerDiv && p.containerDiv.id === plotId) {
              traces = Object.keys(p.traces || {}).map(k => k);
              configName = p.configName || '';
            }
          } catch (e) { }
        });
      }
      // compute fallback from bounding rect relative to device-grid
      const rect = box.getBoundingClientRect();
      const leftVal = box.style.left && box.style.left.trim() ? box.style.left : Math.round(rect.left - gridRect.left) + 'px';
      const topVal = box.style.top && box.style.top.trim() ? box.style.top : Math.round(rect.top - gridRect.top) + 'px';
      const widthVal = box.style.width && box.style.width.trim() ? box.style.width : Math.round(rect.width) + 'px';
      const heightVal = box.style.height && box.style.height.trim() ? box.style.height : Math.round(rect.height) + 'px';

      layout.plots.push({
        id: plotId,
        title: title,
        configName: configName,
        left: leftVal,
        top: topVal,
        width: widthVal,
        height: heightVal,
        traces: traces
      });
    });
  } 
  catch 
  (e) 
  { 
    console.debug('getCurrentLayoutData: plot save skipped', e); 
  }
  
  // Save Valve Icons (individual valve/switch icons)
  document.querySelectorAll('.valve-icon').forEach(icon => {
    const device = icon.dataset.device;
    const field = icon.dataset.field;
    if (device && field) {
      layout.valveIcons.push({
        id: icon.id,
        device: device, // e.g., "sim_gas_dosing_valve_controller"
        field: field,   // e.g., "V1_1"
        left: icon.style.left,
        top: icon.style.top,
        width: icon.style.width,
        height: icon.style.height
      });
    }
  });
  // Saved valveIcons information
  
  // Save Decorations
  document.querySelectorAll('.deco-box').forEach(box => {
    const type = box.dataset.type;
    let color = '';
    let text = '';
    
    if (type === 'label') {
        color = box.style.color;
        // Clean up text
        const clone = box.cloneNode(true);
        const rm = clone.querySelector('.deco-remove');
        const dh = clone.querySelector('.deco-drag-handle');
        const rh = clone.querySelector('.resize-handle');
        if(rm) rm.remove();
        if(dh) dh.remove();
        if(rh) rh.remove();
        text = clone.textContent;
    } else {
        const visual = box.querySelector('.deco-visual');
        if (visual) color = visual.style.backgroundColor;
    }
    
    layout.decorations.push({
      id: box.id,
      type: type,
      left: box.style.left,
      top: box.style.top,
      width: box.style.width,
      height: box.style.height,
      color: color,
      text: text
    });
  });

  layout.connections = getCurrentConnectionsData();

  return layout;
}


// function to show the system GUI with chosen layout configs, all elements are fixed, not draggable or resizeable or removable

function connect_to_system(layout)
{

  const isconfigure_layout = false; 
  // Clear current
  document.getElementById('device-grid').innerHTML = '';
  getConnectionSvg();
  setConfigurationMode(false);
  
  // Restore Devices with robust matching to current SEC node configuration
  if (layout.devices) 
    {
    const select = document.getElementById('device-select');
    const availableDevices = Array.from(select.options).map(opt => opt.value);
    layout.devices.forEach(d => {
      // Try to match by logicalName first
      let match = availableDevices.find(dev => dev === d.logicalName);
      // If not found, try by device title
      if (!match) match = availableDevices.find(dev => dev === d.device);
      // If still not found, try by original_name in WRITABLE_PARAMS
      if (!match && window.WRITABLE_PARAMS) {
        match = availableDevices.find(dev => {
          const info = window.WRITABLE_PARAMS[dev];
          return info && info.original_name === d.device;
        });
      }
      if (match) 
        {
        select.value = match;
        dev_box = createDeviceDisplay(false);
         
        // This creates it at default pos
        // Find the newly created box (last one)
        const boxes = document.querySelectorAll('.device-box');
        const newBox = boxes[boxes.length - 1];
        if (newBox) {
          newBox.style.left = d.left;
          newBox.style.top = d.top;
          if(d.width) newBox.style.width = d.width;
          if(d.height) newBox.style.height = d.height;
        }
        }
        else 
        {
        // If this device wasn't matched to an available device, it may be
        // a synthetic element such as a sample magazine slot (id starts with
        // 'mag-'). Restore a placeholder slot so saved positions are kept.
        try {
          const isMag = (d.logicalName && d.logicalName.startsWith && d.logicalName.startsWith('mag-')) || (d.id && d.id.startsWith && d.id.startsWith('mag-') || d.logicalName == "sample_presence");
        
          if (isMag) {
            const grid = document.getElementById('device-grid');
            if (grid) {
              
              slot = create_sample_block(d,isconfigure_layout);
              grid.appendChild(slot);
            
            }
          }
        }
        catch (err) 
        {
          console.error('applyLayout: failed to restore synthetic device', err);
        }
      }
    });
  }
  
  // Restore Plots (if any) so saved plot panels reappear in the workspace
  if (layout.plots && Array.isArray(layout.plots)) {
    try 
    {
    create_plot(layout,isconfigure_layout); 
    } 
    catch (err) 
    { 
      console.debug('applyLayout: plots restore skipped', err); 
    }
  }

  // Restore Decorations
  if (layout.decorations) {
      layout.decorations.forEach(d => {
          create_decoration(d,isconfigure_layout);
      });
  }

  // Restore Valve Icons (individual valve/switch icons) if present in layout
  if (layout.valveIcons && Array.isArray(layout.valveIcons)) {
    const select = document.getElementById('device-select');
    const availableDevices = select ? Array.from(select.options).map(opt => opt.value) : [];

    layout.valveIcons.forEach(iconDef => {
      try {
        const isconfigure_layout = false;
        
        valve_element = create_valve_icon(availableDevices,iconDef,isconfigure_layout);
        const grid = document.getElementById('device-grid');
        if (grid) {
          grid.appendChild(valve_element[0]);
        }
       

        // Ensure we have image listeners for this device (safe to call multiple times)
        try 
        {
           setupValveImageListeners(realDevice, deviceDomId(realDevice)); 
        } 
        catch (e) 
        {}
      } 
      catch (e) 
      {}
    });
   
  }

  // After restoring valve icons, reload Spin to bind new data-spin attributes
  if (window.Spin && window.Spin.reload) {
    window.Spin.reload();
  }

  restoreConnectionLines(layout.connections);
}


function applyLayout(layout) {
  // Clear current
  document.getElementById('device-grid').innerHTML = '';
  getConnectionSvg();
  setConfigurationMode(true);
  const isConfigurelayout = true; 
  // Restore Devices with robust matching to current SEC node configuration
  if (layout.devices) 
    {
    const select = document.getElementById('device-select');
    const availableDevices = Array.from(select.options).map(opt => opt.value);
    layout.devices.forEach(d => {
      // Try to match by logicalName first
      let match = availableDevices.find(dev => dev === d.logicalName);
      // If not found, try by device title
      if (!match) match = availableDevices.find(dev => dev === d.device);
      // If still not found, try by original_name in WRITABLE_PARAMS
      if (!match && window.WRITABLE_PARAMS) {
        match = availableDevices.find(dev => {
          const info = window.WRITABLE_PARAMS[dev];
          return info && info.original_name === d.device;
        });
      }
      if (match) 
        {
        select.value = match;
        
        dev_block = createDeviceDisplay(isConfigurelayout);
          // Initialize draggable & resizable
        makeDraggable(dev_block);
        makeResizable(dev_block); 
        // This creates it at default pos
        // Find the newly created box (last one)
        const boxes = document.querySelectorAll('.device-box');
        const newBox = boxes[boxes.length - 1];
        if (newBox) {
          newBox.style.left = d.left;
          newBox.style.top = d.top;
          if(d.width) newBox.style.width = d.width;
          if(d.height) newBox.style.height = d.height;
        }
        }
        else 
        {
        // If this device wasn't matched to an available device, it may be
        // a synthetic element such as a sample magazine slot (id starts with
        // 'mag-'). Restore a placeholder slot so saved positions are kept.
        try {
          const isMag = (d.logicalName && d.logicalName.startsWith && d.logicalName.startsWith('mag-')) || (d.id && d.id.startsWith && d.id.startsWith('mag-') || d.logicalName == "sample_presence");
        
          if (isMag) {
            const grid = document.getElementById('device-grid');
            if (grid) {
              
              slot = create_sample_block(d,isConfigurelayout);
              grid.appendChild(slot);
              makeDraggable(slot);
              makeResizable(slot);
            }
          }
        }
        catch (err) 
        {
          console.error('applyLayout: failed to restore synthetic device', err);
        }
      }
    });
  }
  
  // Restore Plots (if any) so saved plot panels reappear in the workspace
  if (layout.plots && Array.isArray(layout.plots)) {
    try 
    {
    create_plot(layout,isConfigurelayout); 
    } 
    catch (err) 
    { 
      console.debug('applyLayout: plots restore skipped', err); 
    }
  }

  // Restore Decorations
  if (layout.decorations) {
      layout.decorations.forEach(d => {
          create_decoration(d,isConfigurelayout);
      });
  }

  // Restore Valve Icons (individual valve/switch icons) if present in layout
  if (layout.valveIcons && Array.isArray(layout.valveIcons)) {
    const select = document.getElementById('device-select');
    const availableDevices = select ? Array.from(select.options).map(opt => opt.value) : [];

    layout.valveIcons.forEach(iconDef => {
      try {
        const isconfigure_layout = true;
        
        valve_element = create_valve_icon(availableDevices,iconDef,isconfigure_layout);
        const grid = document.getElementById('device-grid');
        if (grid) {
          grid.appendChild(valve_element[0]);
        }
        makeValveIconDraggable(valve_element[0]);
        makeValveIconResizable(valve_element[0], valve_element[1]);

        // Ensure we have image listeners for this device (safe to call multiple times)
        try 
        {
           setupValveImageListeners(realDevice, deviceDomId(realDevice)); 
        } 
        catch (e) 
        {}
      } 
      catch (e) 
      {}
    });
   
  }

  // After restoring valve icons, reload Spin to bind new data-spin attributes
  if (window.Spin && window.Spin.reload) {
    window.Spin.reload();
  }

  restoreConnectionLines(layout.connections);
  refreshConnectionLines();
}

function create_sample_block(d,isconfigure_layout)
{

              const slot = document.createElement('div');
              slot.className = 'sample-slot device-box';
              slot.id = d.id || ('mag-' + Date.now());
              slot.style.position = 'absolute';
              slot.style.left = d.left || '200px';
              slot.style.top = d.top || '50px';
              if (d.width) slot.style.width = d.width; else slot.style.width = '120px';
              if (d.height) slot.style.height = d.height; else slot.style.height = '120px';
              slot.style.padding = '6px';
              slot.style.boxSizing = 'border-box';
              slot.style.cursor = 'move';
              slot.style.zIndex = '5';

              // Header with title and remove button
              const header = document.createElement('div');
              header.className = 'device-header';
              header.style.height = '20px';
              header.style.display = 'flex';
              header.style.alignItems = 'center';
              header.style.justifyContent = 'space-between';

              const title = document.createElement('div');
              title.className = 'device-title';
              title.textContent = d.device || slot.id;
              title.style.fontSize = '12px';
              title.style.paddingRight = '6px';
              header.appendChild(title);
              
              if (isconfigure_layout) 
              {
              const removeBtn = document.createElement('div');
              removeBtn.className = 'deco-remove';
              removeBtn.innerHTML = '&times;';
              removeBtn.style.cursor = 'pointer';
              removeBtn.onclick = (e) => { e.stopPropagation(); slot.remove(); };
              header.appendChild(removeBtn);
              }
              slot.appendChild(header);

              // image placeholder
              const imgHolder = document.createElement('div');
              imgHolder.style.width = '100%';
              imgHolder.style.height = '86px';
              imgHolder.style.display = 'flex';
              imgHolder.style.alignItems = 'center';
              imgHolder.style.justifyContent = 'center';
              imgHolder.style.overflow = 'hidden';
              
             
              
              const img = document.createElement('img');
              img.style.maxWidth = '100%';
              img.style.maxHeight = '100%';
              img.style.objectFit = 'contain';
              img.src = '/c/assets/sample_holder.svg';
              imgHolder.appendChild(img);
              slot.appendChild(imgHolder);
              
              const resizeHandle = document.createElement('div');
              resizeHandle.className = 'resize-handle';
              slot.appendChild(resizeHandle);

              return slot;
}

function create_plot(layout,isconfigure_layout)

{

        // ensure window._plots exists
      window._plots = window._plots || { plotsMap: {}, staged: {} };
      window._plots._restoreCounter = window._plots._restoreCounter || 0;
      layout.plots.forEach(p => {
      try {
          if (window._plots && typeof window._plots.restorePlotPanelFromLayout === 'function') {
            window._plots.restorePlotPanelFromLayout(p, isconfigure_layout);
            return;
          }

          const grid = document.getElementById('device-grid');
          if (!grid) return;
          const container = document.createElement('div');
          container.className = 'device-box plot-panel';
          container.id = p.id || ('restored_plot_' + (++window._plots._restoreCounter) + '_panel');
          container.style.position = 'absolute';
          if (p.left) container.style.left = p.left;
          if (p.top) container.style.top = p.top;
          if (p.width) container.style.width = p.width;
          if (p.height) container.style.height = p.height;
          container.style.maxWidth = 'none';
          container.style.boxSizing = 'border-box';
          container.style.zIndex = '5';

          const titleDiv = document.createElement('div');
          titleDiv.className = 'plot-title-label';
          titleDiv.contentEditable = true;
          titleDiv.innerText = p.title || '';
          titleDiv.style.fontWeight = 'bold';
          titleDiv.style.fontSize = '18px';
          titleDiv.style.textAlign = 'center';
          titleDiv.style.margin = '8px 0 4px 0';
          titleDiv.style.outline = 'none';
          container.appendChild(titleDiv);

          const plotDiv = document.createElement('div');
          plotDiv.id = (container.id ? container.id + '_plot' : ('restored_plot_' + window._plots._restoreCounter + '_plot'));
          plotDiv.style.width = '100%';
          plotDiv.style.height = (p.height || '360px');
          container.appendChild(plotDiv);

          grid.appendChild(container);
          if (isconfigure_layout)
          {
          try { makeDraggable(container); } catch (e) {}
          try { makeResizable(container); } catch (e) {}
          }

          try { container.style.transform = ''; container.removeAttribute('data-x'); container.removeAttribute('data-y'); } catch(e){}

          const newKey = 'restored_plot_' + (++window._plots._restoreCounter);
          const plotEntry = { id: newKey, containerDiv: container, plotDiv: plotDiv, traces: {}, configName: p.configName || p.title || '' };
          if (Array.isArray(p.traces)) {
            p.traces.forEach(tkey => {
              const trace = { x: [], y: [], mode: 'lines+markers', name: tkey };
              plotEntry.traces[tkey] = { traceObj: trace, suffix: tkey, _traceIndex: undefined, _lastSent: 0 };
            });
          }
          window._plots.plotsMap[newKey] = plotEntry;

          try 
          {
            const data = Object.values(plotEntry.traces).map(t => t.traceObj);
            Plotly.newPlot(plotDiv, data, getTimeRangePlotLayout({ margin: { t: 30 } })).then(() => {
              Object.values(plotEntry.traces).forEach((t, i) => { t._traceIndex = i; t._lastSent = t.traceObj.x.length; });
            }).catch(()=>{});
          } 
          catch(e) 
          {}

        } 
        catch (err) 
        { 
          console.debug('applyLayout: failed to restore plot', err); 
        }
      });
}


function create_decoration(d,isConfigurelayout)
{

          const select = document.getElementById('deco-select');
          const colorInput = document.getElementById('deco-color');
          
          select.value = d.type;
          if (d.color && colorInput) colorInput.value = rgbToHex(d.color) || d.color;
          
          wrapper = createDecoration(isConfigurelayout);
          // Make it draggable and resizable
          if (isConfigurelayout)
             {
             makeDraggable(wrapper);
             makeResizable(wrapper);
             }
          
          const boxes = document.querySelectorAll('.deco-box');
          const newBox = boxes[boxes.length - 1];
          if (newBox) {
              if (d.id) newBox.id = d.id;
              newBox.style.left = d.left;
              newBox.style.top = d.top;
              if(d.width) newBox.style.width = d.width;
              if(d.height) newBox.style.height = d.height;
              
              if (d.type === 'label' && d.text) {
                  // Restore text content carefully preserving handle/remove btn
                  // Actually createDecoration adds them, so we just update the text node
                  // But text node is mixed. Simplest is to set textContent then re-add buttons?
                  // Or just find the text node.
                  // Let's just set innerHTML to text + buttons
                  // Re-creating buttons is safer
                  newBox.childNodes.forEach(n => {
                      if (n.nodeType === 3) n.textContent = d.text;
                  });
              }
          }

}


function create_valve_icon(availableDevices,iconDef,isconfigure_layout)

{

  // Saved values may use older/short device names or long field names.
        let realDevice = iconDef.device;
        let fieldName = iconDef.field;

        // If the saved field contains the device prefix (long form), try to extract a short field like V1_1 or Switch1
        if (fieldName && !/^(V|v|Switch|switch)/.test(fieldName)) {
          const m = fieldName.match(/(V\d+(?:_\d+)?|Switch\d+)/i);
          if (m) fieldName = m[1];
        }

        // If the device in layout doesn't match available devices, try heuristics to find the correct device
        if (availableDevices.length && !availableDevices.includes(realDevice)) {
          // 1) find device that contains the saved device string
          let found = availableDevices.find(d => d.includes(realDevice) || realDevice.includes(d));
          // 2) try matching by original_name in WRITABLE_PARAMS
          if (!found && window.WRITABLE_PARAMS) {
            found = availableDevices.find(dev => {
              const info = window.WRITABLE_PARAMS[dev];
              return info && (info.original_name === iconDef.device || (info.original_name && iconDef.device && iconDef.device.includes(info.original_name)));
            });
          }
          // 3) if still not found and iconDef.device is short like 'sim', try any device containing 'sim'
          if (!found && iconDef.device) {
            found = availableDevices.find(d => d.toLowerCase().includes(iconDef.device.toLowerCase()));
          }
          if (found) realDevice = found;
        }

        const valveDomId = `${deviceDomId(realDevice)}_${fieldName}`;

        // If an element with same id already exists, skip
        if (document.getElementById(`icon-${valveDomId}`)) return;

        const valveIcon = document.createElement('div'); 
        valveIcon.className = 'valve-icon';
        valveIcon.id = `icon-${valveDomId}`;
        valveIcon.dataset.device = realDevice; // Store device name
        valveIcon.dataset.field = fieldName; // Store field name
        valveIcon.style.position = 'absolute';
        if (iconDef.left) valveIcon.style.left = iconDef.left;
        if (iconDef.top) valveIcon.style.top = iconDef.top;
        if (iconDef.width) valveIcon.style.width = iconDef.width;
        if (iconDef.height) valveIcon.style.height = iconDef.height;
        valveIcon.style.cursor = 'pointer';
        valveIcon.style.userSelect = 'none';
        valveIcon.style.overflow = 'visible';
        if (isconfigure_layout) valveIcon.classList.add('configure-layout');
        appendContactPoints(valveIcon);
       
        
        // Image container
        const imgContainer = document.createElement('div');
        imgContainer.id = `img-${valveDomId}`;
        
        imgContainer.style.width = iconDef.width;
        imgContainer.style.height = iconDef.height;

        const lowerField = (fieldName || '').toLowerCase();
        const isSwitch = lowerField.includes('switch');
        const isValve = lowerField.includes('valve') || (fieldName && fieldName.startsWith('V'));

        // Create img element similar to setupValveController
        const img = document.createElement('img');
        img.style.cssText = 'width: 100%; height: 100%; object-fit: contain;';
        if (isSwitch) img.style.transform = 'rotate(0deg)';
        // Default to closed appearance
        img.src = isValve ? 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9Ijk0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iOTQiIGZpbGw9IiNmZmYiLz48cG9seWdvbiBwb2ludHM9IjEwLDIwIDEwLDc0IDYwLDQ3IiBmaWxsPSIjMDAwMDAwIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMiIvPjxwb2x5Z29uIHBvaW50cz0iMTEwLDIwIDExMCw3NCA2MCw0NyIgZmlsbD0iIzAwMDAwMCIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjIiLz48L3N2Zz4=' : 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI0IiBoZWlnaHQ9IjEwNiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTI0IiBoZWlnaHQ9IjEwNiIgZmlsbD0id2hpdGUiLz48ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSg2Miw1MykiPjxjaXJjbGUgY3g9IjAiIGN5PSIwIiByPSI0NSIgZmlsbD0id2hpdGUiIHN0cm9rZT0iIzMzMyIgc3Ryb2tlLXdpZHRoPSIzIi8+PHBhdGggZD0iTSAtNDQuMyA2LjcgQSA0NSA0NSAwIDAgMSAtNi43IDQ0LjMiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzMzMyIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48cGF0aCBkPSJNIDQ0LjMgLTYuNyBBIDQ1IDQ1IDAgMCAxIDYuNyAtNDQuMyIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMzMzIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvZz48L3N2Zz4=';
        // ensure valve image id matches expected lookup used by updateValveImage
        if (isValve) img.id = `valve-img-${valveDomId}`;
        imgContainer.appendChild(img);

        // Click handler toggles by reading latestValues and sending setValveField
        imgContainer.onclick = () => {
        
          // If Spin is not connected, do not attempt to send (no persistent red border)
          if (!window.Spin || !window.Spin.current_socket || window.Spin.current_socket.readyState !== WebSocket.OPEN) {
            return;
          }

          const data = latestValues[realDevice];
          let currentValue = 0;
          if (data && data.target && data.target.value && data.target.value[fieldName] !== undefined) {
            currentValue = data.target.value[fieldName];
          } else if (data && data.value && data.value.value && data.value.value[fieldName] !== undefined) {
            currentValue = data.value.value[fieldName];
          }
          // Normalize different shapes ('0'/'1', booleans, {value:'0'}) to numeric
          currentValue = toNumeric(currentValue);
          const newValue = isSwitch ? (currentValue === 0 ? 1 : 0) : (currentValue === 1 ? 0 : 1);
          setValveField(realDevice, fieldName, newValue);
          // optimistic UI update: rotate switches, update valve visuals
          if (isSwitch) {
            try { updateSwitchRotation(imgContainer, newValue); } catch (e) { /* ignore */ }
          } else {
            try { updateValveImage(valveDomId, newValue); } catch (e) { /* ignore */ }
          }
        };

        const label = document.createElement('div');
        label.style.cssText = 'font-size: 10px; color: #333; text-align: center; margin-top: 4px; font-weight: 600;';
        label.textContent = fieldName;

        const resizeHandle = document.createElement('div');
        resizeHandle.style.cssText = 'position: absolute; bottom: 0; right: 0; width: 12px; height: 12px; background: #007bff; cursor: nwse-resize; border-radius: 2px; opacity: 0.7;';
        resizeHandle.title = 'Resize';

        const valueDisplay = document.createElement('div');
        valueDisplay.id = `valve-${valveDomId}`;
        valueDisplay.style.display = 'none';
        // Bind to live value so restored icons reflect actual valve states
        valueDisplay.setAttribute('data-spin', `@${realDevice}.value.${fieldName}`);

        // Initialize visual from latestValues if available (normalize with toNumeric)
        try 
        {
          const d = latestValues[realDevice];
          const liveRaw = d && d.value && d.value.value && typeof d.value.value[fieldName] !== 'undefined' ? d.value.value[fieldName] : undefined;
          if (typeof liveRaw !== 'undefined') {
            const lv = toNumeric(liveRaw);
            if (isSwitch) {
              updateSwitchRotation(imgContainer, lv);
              const valveEl = imgContainer.closest('.valve-icon');
              if (valveEl) valveEl.dataset.open = lv === 1 ? '1' : '0';
            } else {
              updateValveImage(valveDomId, lv === 1);
              // store optimistic/open state so subsequent queries read consistent state
              const valveEl = imgContainer.closest('.valve-icon');
              if (valveEl) valveEl.dataset.open = lv === 1 ? '1' : '0';
            }
            // Add non-intrusive init debug info to the element title (visible on hover)
            try {
              const valveEl = imgContainer.closest('.valve-icon');
              if (valveEl) valveEl.title = `init ${fieldName}: ${String(liveRaw)} -> ${lv}`;
            } catch (e) { /* ignore */ }
          }
        } 
        catch (e) 
        { 
          /* ignore init errors */ 
        }

        valveIcon.appendChild(imgContainer);
        valveIcon.appendChild(label);
        valveIcon.appendChild(resizeHandle);
        valveIcon.appendChild(valueDisplay);
        
        if (isconfigure_layout) 
          {
        // Remove button
        const removeBtn = document.createElement('div');
        removeBtn.className = 'deco-remove';
        removeBtn.style.cursor = 'pointer';
        removeBtn.onclick = function(e) 
        {
        e.stopPropagation(); // Prevent bubbling
        valveIcon.remove();
        };
        
        valveIcon.appendChild(removeBtn);
          }
      
        return [valveIcon, imgContainer];
}     
