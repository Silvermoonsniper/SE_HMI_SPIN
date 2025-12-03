/**
 * Gas Dosing System - JavaScript Logic
 * Handles device status updates, value sending, and extra parameters panel
 */

// ===== Status Badge Updates =====
// Update status badges when Spin sends updates
window.addEventListener('spinupdate', function(event) {
  try {
    var key = event.detail.key || '';
    var state = event.detail.state || '';
    var state_str = event.detail.state_str || '';
    
    if (key.startsWith('massflow_contr1')) {
      var el = document.getElementById('status-mfc1');
      if (el) {
        el.textContent = state_str || state || 'unknown';
        el.className = 'status-badge ' + (state ? ('state-' + state) : 'state-warn');
      }
    } else if (key.startsWith('massflow_contr2')) {
      var el = document.getElementById('status-mfc2');
      if (el) {
        el.textContent = state_str || state || 'unknown';
        el.className = 'status-badge ' + (state ? ('state-' + state) : 'state-warn');
      }
    }
  } catch(e) { 
    console.error('status update error', e); 
  }
});

// ===== Send Values to Backend =====
// Send value from inline input field to the server
function sendValue(key, inputElementId) {
  try {
    const inputEl = document.getElementById(inputElementId);
    if (!inputEl) {
      console.error('Input element not found:', inputElementId);
      return;
    }
    const value = inputEl.value.trim();
    if (!value) {
      console.warn('Input is empty');
      return;
    }
    // Convert to number if numeric field, otherwise keep as string
    let finalValue = isNaN(value) ? value : parseFloat(value);
    Spin.send_request(key, "", "input", "", finalValue);
    console.log('Sent', key, '=', finalValue);
    inputEl.value = ''; // Clear input after sending
  } catch(e) { 
    console.error('sendValue failed', e); 
  }
}

// Send selected parameter value to backend
function sendSelectedParam(device, domId) {
  try {
    const paramSelect = document.getElementById('param-select-' + domId);
    const valueInput = document.getElementById('param-value-' + domId);
    
    if (!paramSelect || !valueInput) {
      console.error('Parameter controls not found for', domId);
      return;
    }
    
    const param = paramSelect.value;
    const value = valueInput.value.trim();
    
    if (!param) {
      console.warn('No parameter selected');
      alert('Please select a parameter first');
      return;
    }
    
    if (!value) {
      console.warn('No value entered');
      alert('Please enter a value');
      return;
    }
    
    // Convert to number if it's numeric, otherwise keep as string
    let finalValue = isNaN(value) ? value : parseFloat(value);
    
    const key = device + '.' + param;
    Spin.send_request(key, "", "input", "", finalValue);
    console.log('Set parameter:', key, '=', finalValue);
    
    // Clear the value input after sending
    valueInput.value = '';
  } catch(e) {
    console.error('sendSelectedParam failed', e);
  }
}

// ===== Extra Parameters Panel =====
// Store latest values per device
const latestValues = {};

// Convert device name to DOM ID (e.g., massflow_contr1 -> mfc1)
function deviceDomId(device) {
  return device.replace(/^massflow_contr/, 'mfc');
}

// Render extra parameters in the expandable panel
function renderExtra(device) {
  const id = deviceDomId(device);
  const panel = document.getElementById('extra-' + id);
  if (!panel) return;
  
  const data = latestValues[device] || {};
  const keys = Object.keys(data).sort();
  
  // Exclude 'value' and 'target' since they're already displayed in main fields
  const filteredKeys = keys.filter(k => k !== 'value' && k !== 'target');
  
  if (filteredKeys.length === 0) {
    panel.innerHTML = '<div class="extra-row"><em>No additional parameters</em></div>';
    return;
  }
  
  let html = '';
  for (let k of filteredKeys) {
    const entry = data[k];
    const v = entry && entry.value !== undefined ? entry.value : '—';
    const u = entry && entry.unit ? (' ' + entry.unit) : '';
    html += `<div class="extra-row"><div>${k}</div><div>${String(v)}${u}</div></div>`;
  }
  panel.innerHTML = html;
}

// Toggle the extra parameters panel open/closed
function toggleExtra(device) {
  const id = deviceDomId(device);
  const panel = document.getElementById('extra-' + id);
  const btn = document.getElementById('toggle-' + id);
  if (!panel || !btn) return;
  
  const open = panel.classList.toggle('open');
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  btn.textContent = open ? 'Close ▴' : 'More ▾';
  
  if (open) {
    renderExtra(device);
    // Debug: show what parameters we have
    const cached = Object.keys(latestValues[device] || {}).sort();
    console.log('Parameters for', device, ':', cached);
  }
}

// Listen for updates and cache them
window.addEventListener('spinupdate', function(event) {
  try {
    const key = event.detail.key || '';
    let device, param;
    
    if (key.includes('.')) {
      [device, param] = key.split('.', 2);
    } else {
      device = key;
      param = 'value';
    }
    
    if (!device) return;
    
    if (!latestValues[device]) latestValues[device] = {};
    latestValues[device][param] = { 
      value: event.detail.value, 
      unit: event.detail.unit, 
      state: event.detail.state, 
      state_str: event.detail.state_str 
    };
    
    // If panel open, refresh
    const domId = deviceDomId(device);
    const panel = document.getElementById('extra-' + domId);
    if (panel && panel.classList.contains('open')) {
      renderExtra(device);
    }
  } catch (e) { 
    console.error('cache spinupdate failed', e); 
  }
});

// ===== Debug Logging =====
let debugLines = [];

function debug(msg) {
  debugLines.push('[' + new Date().toLocaleTimeString() + '] ' + msg);
  if (debugLines.length > 30) debugLines.shift();
  var el = document.getElementById('debug-output');
  if (el) el.textContent = debugLines.join('\n');
  console.log(msg);
}

debug('✓ Page initialized');

// Listen for Spin lifecycle events
window.addEventListener('spinstartup', function() {
  debug('✓ Spin startup event fired');
});

window.addEventListener('spinconnect', function() {
  debug('✓ WebSocket connected to Spin backend');
});

window.addEventListener('spindisconnect', function() {
  debug('⚠ WebSocket disconnected from backend');
});

window.addEventListener('spinupdate', function(event) {
  var val = event.detail.value;
  debug('✓ Data update: ' + event.detail.key + ' = ' + JSON.stringify(val));
});
