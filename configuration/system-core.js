const START_PAGE_MODE_KEY = 'startPageMode';

function getAutomaticStartPageMode() {
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const hour = new Date().getHours();
  return prefersDark || hour < 7 || hour >= 19 ? 'night' : 'day';
}

function applyStartPageMode(mode) {
  const panel = document.getElementById('connection-panel');
  const label = document.getElementById('start-page-mode-label');
  if (!panel || !label) {
    return;
  }

  const normalizedMode = mode === 'night' ? 'night' : 'day';
  panel.dataset.mode = normalizedMode;
  document.body.dataset.startPageMode = normalizedMode;
  label.textContent = normalizedMode === 'night' ? 'Night mode' : 'Day mode';
}

function updateStartPageModeIndicator() {
  const storedMode = localStorage.getItem(START_PAGE_MODE_KEY);
  const mode = storedMode === 'day' || storedMode === 'night'
    ? storedMode
    : getAutomaticStartPageMode();
  applyStartPageMode(mode);
}

function toggleStartPageMode() {
  const panel = document.getElementById('connection-panel');
  if (!panel) {
    return;
  }

  const nextMode = panel.dataset.mode === 'night' ? 'day' : 'night';
  localStorage.setItem(START_PAGE_MODE_KEY, nextMode);
  applyStartPageMode(nextMode);
}

function setupStartPageModeIndicator() {
  updateStartPageModeIndicator();

  const indicator = document.getElementById('start-page-mode-indicator');
  if (indicator) {
    indicator.addEventListener('click', toggleStartPageMode);
  }

  if (!window.matchMedia) {
    return;
  }

  const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  if (typeof colorSchemeQuery.addEventListener === 'function') {
    colorSchemeQuery.addEventListener('change', () => {
      if (!localStorage.getItem(START_PAGE_MODE_KEY)) {
        updateStartPageModeIndicator();
      }
    });
  } else if (typeof colorSchemeQuery.addListener === 'function') {
    colorSchemeQuery.addListener(() => {
      if (!localStorage.getItem(START_PAGE_MODE_KEY)) {
        updateStartPageModeIndicator();
      }
    });
  }
}

// --- Connect to Node Modal Logic ---
document.addEventListener('DOMContentLoaded', function() 

{
  setupStartPageModeIndicator();

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
   // Do not auto-restore any previous layout selection on startup.
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

