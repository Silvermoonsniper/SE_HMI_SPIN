// ===== Status Badge Updates =====
var AppState = window.SEAppState;
var AppUi = window.SEAppUi;
let pendingBackendRestartReload = false;
const BACKEND_RESTART_RECOVERY_KEY = 'pending_backend_restart_recovery';
const BACKEND_RESTART_ADDR_KEY = 'pending_backend_restart_addr';

function readPendingBackendRestartTimestamp() {
  try {
    const raw = sessionStorage.getItem(BACKEND_RESTART_RECOVERY_KEY);
    const parsed = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch (e) {
    return 0;
  }
}

function writePendingBackendRestartTimestamp(timestampMs) {
  try {
    sessionStorage.setItem(BACKEND_RESTART_RECOVERY_KEY, String(timestampMs));
  } catch (e) {
    // ignore storage failures
  }
}

function clearPendingBackendRestartTimestamp() {
  try {
    sessionStorage.removeItem(BACKEND_RESTART_RECOVERY_KEY);
  } catch (e) {
    // ignore storage failures
  }
}

function readPendingBackendRestartAddr() {
  try {
    return sessionStorage.getItem(BACKEND_RESTART_ADDR_KEY) || '';
  } catch (e) {
    return '';
  }
}

function writePendingBackendRestartAddr(addr) {
  try {
    if (addr) {
      sessionStorage.setItem(BACKEND_RESTART_ADDR_KEY, addr);
    } else {
      sessionStorage.removeItem(BACKEND_RESTART_ADDR_KEY);
    }
  } catch (e) {
    // ignore storage failures
  }
}

function scheduleBackendRestartReload(startedAtOverride, expectedAddrOverride) {
  if (pendingBackendRestartReload) return;
  pendingBackendRestartReload = true;

  const startedAt = startedAtOverride || Date.now();
  const expectedAddr = expectedAddrOverride || readPendingBackendRestartAddr();
  const maxWaitMs = 60000;
  const minWaitMs = 4000;
  const retryDelayMs = 1000;
  writePendingBackendRestartTimestamp(startedAt);
  writePendingBackendRestartAddr(expectedAddr);

  const tryReload = async () => {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > maxWaitMs) {
      clearPendingBackendRestartTimestamp();
      writePendingBackendRestartAddr('');
      pendingBackendRestartReload = false;
      return;
    }

    let backendReady = false;
    try {
      const url = expectedAddr
        ? API_BASE + `/api/runtime_node_ready?addr=${encodeURIComponent(expectedAddr)}&_restart_probe=${Date.now()}`
        : API_BASE + `/api/latest_values?_restart_probe=${Date.now()}`;
      const resp = await fetch(url, { method: 'GET', cache: 'no-store' });
      if (resp.ok) {
        if (expectedAddr) {
          const payload = await resp.json();
          backendReady = !!(payload && payload.status === 'ok' && payload.ready);
        } else {
          backendReady = true;
        }
      }
    } catch (e) {
      backendReady = false;
    }

    if (backendReady && elapsedMs >= minWaitMs) {
      clearPendingBackendRestartTimestamp();
      writePendingBackendRestartAddr('');
      try {
        if (window.Spin && typeof window.Spin.reload === 'function') {
          window.Spin.reload();
        }
      } catch (e) {
        // ignore and fall back to full page reload below
      }

      window.setTimeout(() => {
        window.location.reload();
      }, 250);
      return;
    }

    window.setTimeout(tryReload, retryDelayMs);
  };

  window.setTimeout(tryReload, Math.max(250, minWaitMs - (Date.now() - startedAt)));
}

window.scheduleBackendRestartReload = scheduleBackendRestartReload;

const pendingBackendRestartTimestamp = readPendingBackendRestartTimestamp();
const pendingBackendRestartAddr = readPendingBackendRestartAddr();
if (pendingBackendRestartTimestamp && (Date.now() - pendingBackendRestartTimestamp) < 60000) {
  scheduleBackendRestartReload(pendingBackendRestartTimestamp, pendingBackendRestartAddr);
} else if (pendingBackendRestartTimestamp) {
  clearPendingBackendRestartTimestamp();
  writePendingBackendRestartAddr('');
}

window.addEventListener('spinupdate', function(event) 
{
  try {
    if (typeof window.isConfigurationModeActive === 'function' && window.isConfigurationModeActive()) {
      return;
    }
    var key = event.detail.key || '';

    if (key === 'nodemanager.nodes') {
        var nodes = event.detail.value;
        if (nodes && Array.isArray(nodes)) {
            displayNodesInfo(nodes);
        }
        AppUi.fetchNodesList();
        AppUi.loadNodesInfo();
        return;
    }

    if (key === 'nodemanager.status') {
        var msg = event.detail.value;
        if (msg) {
      if (msg === 'Node added successfully' || msg === 'Node already present in runtime') {
        AppUi.fetchNodesList();
        AppUi.loadNodesInfo();
        fetchDeviceParams();
        fetchAndMergeLatestValuesOnce()
          .then(() => refreshVisibleDeviceBoxes())
          .catch(() => {});
      }
      if (typeof msg === 'string' && msg.includes('Restarting server')) {
        scheduleBackendRestartReload();
      }
        AppUi.showAppAlert(msg, 'Node Manager');
        }
        return;
    }

    if (key === 'nodemanager.device_params') {
        var data = event.detail.value;
      
        if (data) {
          const previousParams = AppState.getDeviceParams();
          const previousKeys = previousParams ? new Set(Object.keys(previousParams)) : new Set();
          AppState.setDeviceParams(data);
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
        // Merge server-discovered layouts with local browser-stored layouts so the
        // dropdown stays complete even if one source is temporarily missing entries.
        let localNames = [];
        try 
        {
          const raw = localStorage.getItem(typeof STORAGE_KEY !== 'undefined' ? STORAGE_KEY : 'gas_system_layouts');
          const localLayouts = raw ? JSON.parse(raw) : {};
          localNames = Object.keys(localLayouts || {});
        } 
        catch (storageError)
        {
          console.error('Failed to read local layout names', storageError);
        }

        const mergedList = Array.from(new Set([...(localNames || []), ...list])).sort();

        // Remove existing options (keep first placeholder) and replace with merged list.
        while (select.options.length > 1) select.remove(1);
        mergedList.forEach(name => {
          const option = document.createElement('option');
          option.value = name;
          option.text = name;
          select.add(option);
        });
        // If a previously selected layout no longer exists on server, clear it
        const sel = sessionStorage.getItem('selectedLayout');
        if (sel && !mergedList.includes(sel)) {
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
        if (typeof renderServerLayout === 'function') {
          renderServerLayout(layout).catch((error) => {
            console.error('renderServerLayout failed', error);
          });
        } else {
          applyLayout(layout);
        }
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

async function sendSelectedParam(device, domId) {
  try {
    const paramSelect = document.getElementById('param-select-' + domId);
    const valueInput = document.getElementById('param-value-' + domId);
    if (!paramSelect || !valueInput) return;
    
    const param = paramSelect.value;
    const value = valueInput.value.trim();
    
    if (!param) {
      await AppUi.showAppAlert('Please select a parameter first.', 'Set Parameter');
      return;
    }
    if (!value) {
      await AppUi.showAppAlert('Please enter a value.', 'Set Parameter');
      return;
    }
    
    let finalValue = isNaN(value) ? value : parseFloat(value);
    const key = device + '.' + param;

    Spin.send_request(key, "", "input", "", finalValue);

    fetchAndMergeLatestValuesOnce()
      .then(() => applyCachedDeviceState(device, domId))
      .catch(() => {});
   
    valueInput.value = '';
  } catch(e) 
  {
    console.error('sendSelectedParam failed', e);
  }
}

function getParamInfoMap(deviceInfo) {
  if (!deviceInfo || !deviceInfo.param_info) return {};

  if (Array.isArray(deviceInfo.param_info)) {
    const merged = {};
    deviceInfo.param_info.forEach((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        Object.assign(merged, entry);
      }
    });
    return merged;
  }

  if (typeof deviceInfo.param_info === 'object') {
    return deviceInfo.param_info;
  }

  return {};
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
  
  // Check if parameter has enum values in runtime metadata
  const deviceParams = AppState.getDeviceParams();
  const deviceInfo = deviceParams && deviceParams[device] ? deviceParams[device] : null;
  const paramInfo = getParamInfoMap(deviceInfo);
  const found = paramInfo[param] || null;
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
  const deviceParams = AppState.getDeviceParams();
  const deviceInfo = deviceParams && deviceParams[device] ? deviceParams[device] : null;
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
    if (v === null || v === undefined || v === 'None')
    {
      displayValue = '—';
    }
    else if (Array.isArray(v)) 
    
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
    if (!box || !box.parentElement) return;

    const newHeight = box.offsetHeight;
    const heightIncrease = newHeight - originalHeight;
    if (heightIncrease <= 0) return;

    const boxTop = parseFloat(box.style.top || '') || box.offsetTop || 0;
    const boxLeft = parseFloat(box.style.left || '') || box.offsetLeft || 0;
    const boxWidth = box.offsetWidth || 0;
    const originalBottom = boxTop + originalHeight;

    document.querySelectorAll('.device-box, .deco-box').forEach((otherEl) => {
      if (otherEl.id === box.id) return;

      const otherTop = parseFloat(otherEl.style.top || '') || otherEl.offsetTop || 0;
      const otherLeft = parseFloat(otherEl.style.left || '') || otherEl.offsetLeft || 0;
      const otherWidth = otherEl.offsetWidth || 0;
      const isBelowOriginalBottom = otherTop >= (originalBottom - 1);
      const isHorizontallyOverlapping = boxLeft < (otherLeft + otherWidth) && (boxLeft + boxWidth) > otherLeft;
      if (!isBelowOriginalBottom || !isHorizontallyOverlapping) return;

      const currentTop = parseFloat(otherEl.style.top || '') || otherEl.offsetTop || 0;
      otherEl.style.transition = 'top 0.2s ease-out';
      otherEl.style.top = `${currentTop + heightIncrease}px`;
      setTimeout(() => { otherEl.style.transition = ''; }, 200);
    });
  });
}

function handleCollapse(box, originalHeight) {
  requestAnimationFrame(() => {
    if (!box || !box.parentElement) return;

    const newHeight = box.offsetHeight;
    const heightReduction = originalHeight - newHeight;
    if (heightReduction <= 0) return;

    const boxTop = parseFloat(box.style.top || '') || box.offsetTop || 0;
    const boxLeft = parseFloat(box.style.left || '') || box.offsetLeft || 0;
    const boxWidth = box.offsetWidth || 0;
    const previousBottom = boxTop + originalHeight;

    document.querySelectorAll('.device-box, .deco-box').forEach((otherEl) => {
      if (otherEl.id === box.id) return;

      const otherTop = parseFloat(otherEl.style.top || '') || otherEl.offsetTop || 0;
      const otherLeft = parseFloat(otherEl.style.left || '') || otherEl.offsetLeft || 0;
      const otherWidth = otherEl.offsetWidth || 0;
      const isBelowPreviousBottom = otherTop >= (previousBottom - 1);
      const isHorizontallyOverlapping = boxLeft < (otherLeft + otherWidth) && (boxLeft + boxWidth) > otherLeft;
      if (!isBelowPreviousBottom || !isHorizontallyOverlapping) return;

      const currentTop = parseFloat(otherEl.style.top || '') || otherEl.offsetTop || 0;
      otherEl.style.transition = 'top 0.2s ease-out';
      otherEl.style.top = `${currentTop - heightReduction}px`;
      setTimeout(() => { otherEl.style.transition = ''; }, 200);
    });
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
    panel.dataset.loading = 'true';
    panel.innerHTML = '<div class="extra-row"><em>Refreshing parameters...</em></div>';
    Promise.resolve()
      .then(() => fetchAndMergeLatestValuesOnce())
      .then(() => {
        if (typeof hydrateDeviceFromNode === 'function') {
          return hydrateDeviceFromNode(device);
        }
        return null;
      })
      .catch(() => {})
      .finally(() => {
        delete panel.dataset.loading;
        if (panel.classList.contains('open')) {
          renderExtra(device);
        }
      });
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

