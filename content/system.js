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
    submitBtn.onclick = () => {
      const ip = document.getElementById('conn-ip').value.trim();
      const port = document.getElementById('conn-port').value.trim();
      if (!ip || !port) { alert('Please enter IP and Port.'); return; }
      if (window.Spin && typeof window.Spin.send_request === 'function') {
        window.Spin.send_request('nodemanager.add_node', '', 'input', 'set', {host: ip, port: port});
        modal.style.display = 'none';
      } else {
        alert('Not connected to Spin server.');
      }
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

// Helper to coerce different incoming shapes into numeric 0/1
function toNumeric(v) {
  if (v && typeof v.value !== 'undefined') v = v.value;
  if (v === true) return 1;
  if (v === false) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

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

  if (raw) {

    const urls = raw.split(',').map(u => u.trim()).filter(u => u);

    const imgs = document.querySelectorAll('.bg-img');

    imgs.forEach((img, i) => {

      let url = urls[i % urls.length];

      img.style.backgroundImage = `url('${url}')`;

    });

    const input = document.getElementById('conn-bg-url');

    if (input) input.value = raw;

  }
}

//function to add node connection
function addNodeConnection() {
  
  const ip = document.getElementById('conn-ip').value;
  
  const port = document.getElementById('conn-port').value;
  
  if (!ip || !port) {
    alert('Please enter both IP and Port.');
    return;
  }
  
  if (window.Spin) {
      Spin.send_request('nodemanager.add_node', "", "input", "set", {host: ip, port: port});
      // Alert will be handled by nodemanager.status update
      document.getElementById('conn-ip').value = '';
  } 
  else 
  {
      alert('Not connected to Spin server.');
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
    // If a layout was previously selected, apply it
    const selectedLayout = sessionStorage.getItem('selectedLayout');
  
    if (selectedLayout) {
  
      const layouts = getStoredLayouts();
  
      if (layouts[selectedLayout]) {
  
        applyLayout(layouts[selectedLayout]);
  
        document.getElementById('layout-select').value = selectedLayout;
  
      }
    }
  });
});

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
      <strong>Node ${index + 1}:</strong> ${nodeName} (${node.equipment_id || 'Unknown Device'})
    </li>`;
  });
  html += '</ul>';
  infoContent.innerHTML = html;
}

function connectToGUI() {
  // Check if Spin is ready before connecting
  if (!window.Spin || !window.Spin.current_socket || window.Spin.current_socket.readyState !== WebSocket.OPEN) {
    alert('Connection to server not ready. Please wait a moment and try again.');
    return;
  }
  // Switch to main panel first
  enterSystem();
  // Then load selected layout
  const select = document.getElementById('layout-select');
  const name = select.value;
  if (name) {
    const layouts = getStoredLayouts();
    if (layouts[name]) {
      applyLayout(layouts[name]);
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

function addNodeConnectionAuto(host, port) {
  // Automated version of addNodeConnection without prompts
  if (window.Spin && window.Spin.send_request) {
      const data = { host: host, port: port.toString() };
      window.Spin.send_request('nodemanager.add_node', '', 'input', 'set', data);
      // Optionally provide feedback to the user
      const btn = event.target;
      if(btn) {
        btn.textContent = 'Added!';
        btn.disabled = true;
        btn.style.background = '#6c757d';
      }
  }
}

function enterSystem() {
  // This function is now only for switching views.
  // The button is always visible.
  document.getElementById('connection-panel').style.display = 'none';
  document.getElementById('main-panel').style.display = 'block';
  
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
window.addEventListener('spinupdate', function(event) {
  try {
    var key = event.detail.key || '';
    
    

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
            alert(msg);
        }
        return;
    }

    if (key === 'nodemanager.device_params') {
        var data = event.detail.value;
        if (data) {
            WRITABLE_PARAMS = data;
            populateDeviceList(data);
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

  if (key === 'nodemanager.save_layout') {
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
    } else {
    
    }

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
    
  } catch(e) { 
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

function updateParamDisplay(device, domId, param) {
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
    // Keep text input
    inputContainer.innerHTML = '<input type="text" id="param-value-' + domId + '" class="control-input" placeholder="val" style="flex: 1;" />';
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
  
   
  const paramInfo = deviceInfo && deviceInfo.param_info && deviceInfo.param_info[param] ? deviceInfo.param_info[param] : null;
  
  // If parameter has enum members, show dropdown instead of text input
  if (paramInfo && paramInfo.type === 'enum' && paramInfo.members) {
    // members is an object with enum_name: value pairs
    const enumNames = Object.keys(paramInfo.members);
   
    let selectHtml = '<select id="param-value-' + domId + '" class="control-input" style="flex: 1;">';
    selectHtml += '<option value="">-- Select --</option>';
    enumNames.forEach(enumName => {
      const selected = enumName === String(value) ? ' selected' : '';
      selectHtml += `<option value="${enumName}"${selected}>${enumName}</option>`;
    });
    selectHtml += '</select>';
    inputContainer.innerHTML = selectHtml;
  } else {
    // Use text input for other types
    inputContainer.innerHTML = '<input type="text" id="param-value-' + domId + '" class="control-input" placeholder="val" style="flex: 1;" />';
  }
}

// ===== Extra Parameters Panel =====
const latestValues = {};

// device name to sanitized DOM ID
function deviceDomId(device) {
  // Use the full device name, just sanitized for DOM ID safety
  // This ensures consistency regardless of the naming convention
  return device.replace(/[^a-zA-Z0-9_-]/g, '_');
}



function renderExtra(device) {
  const id = deviceDomId(device);
  const panel = document.getElementById('extra-' + id);
  if (!panel) return;
  
  const data = latestValues[device] || {};
  const keys = Object.keys(data).sort();
  const filteredKeys = keys.filter(k => k !== 'value' && k !== 'target');
  
  if (filteredKeys.length === 0) {
    panel.innerHTML = '<div class="extra-row"><em>No additional parameters</em></div>';
    return;
  }
  
  // Get parameter metadata if available
  const deviceInfo = WRITABLE_PARAMS && WRITABLE_PARAMS[device] ? WRITABLE_PARAMS[device] : null;
  
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

function handleExpansion(box, originalHeight) {
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
  const btn = document.getElementById('toggle-' + domId);
  const box = document.getElementById('box-' + domId);
  if (!panel || !btn || !box) return;

  const isOpening = !panel.classList.contains('open');
  const originalHeight = box.offsetHeight;
  
  if (isOpening) {
    renderExtra(device);
  }
  
  panel.classList.toggle('open');
  panel.setAttribute('aria-hidden', isOpening ? 'false' : 'true');
  btn.textContent = isOpening ? 'Close ▴' : 'More ▾';
  
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
  
  if (!body || !btn || !box) return;
  
  const isExpanding = body.style.display === 'none';
  const originalHeight = box.offsetHeight;

  if (isExpanding) {
    body.style.display = 'block';
    btn.textContent = '▲';
    box.style.height = 'auto';
    
    // Wait for DOM to update
    requestAnimationFrame(() => {
      handleExpansion(box, originalHeight);
    });
  } else {
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

function fetchDeviceParams() {
    if (window.Spin) {
        Spin.send_request('nodemanager.get_device_params', "", "read", "read", null);
    }
}

function populateDeviceList(data) {
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

function createDeviceDisplay(deviceNameOverride) 

{
  const select = document.getElementById('device-select');
  const device = deviceNameOverride || select.value;
  
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
  
  const templateId = isValveController ? 'valve-controller-template' : 'device-template';
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
  const sep1 = newBox.querySelector('.sep-1');
  const sep2 = newBox.querySelector('.sep-2');

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
      if (gasSpan) gasSpan.style.display = 'none';
      if (sep2) sep2.style.display = 'none';
  }

  // Initialize draggable & resizable
  makeDraggable(newBox);
  makeResizable(newBox);
  
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
      setTimeout(() => setupValveController(device, domId), 1000);
  }
}

async function setupValveController(device, domId) {
   
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
      valveIcon.style.width = '80px';
      valveIcon.style.height = '100px';
      valveIcon.style.top = (20 + index * 120) + 'px';
      valveIcon.style.left = '20px';
      valveIcon.style.cursor = 'pointer';
      valveIcon.style.userSelect = 'none';
      
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
      
      // Add to grid
      const grid = document.getElementById('device-grid');
     
      if (grid) 
      {
        grid.appendChild(valveIcon);
      } else {
        console.error('device-grid not found!');
      }
      
      // Make it draggable (simple drag without device-box features)
      makeValveIconDraggable(valveIcon);
      makeValveIconResizable(valveIcon, imgContainer);

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

function getValveIconState(valveIcon, device, fieldName) {
  // Prefer DOM dataset state if present (optimistic), otherwise read latestValues
  if (valveIcon && valveIcon.dataset && valveIcon.dataset.open !== undefined) {
    return parseInt(valveIcon.dataset.open, 10) || 0;
  }
  const data = latestValues[device];
  if (!data) return 0;
  // Prefer the live `value` struct (actual states) over `target` when available
  if (data.value && data.value.value && data.value.value[fieldName] !== undefined) return toNumeric(data.value.value[fieldName]);
  if (data.target && data.target.value && data.target.value[fieldName] !== undefined) return toNumeric(data.target.value[fieldName]);
  return 0;
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
}

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

  // show small on-screen toast to help debug whether UI sent the command
  try { showActionToast(`Cmd: ${device}.${fieldName} = ${value}`, (window.Spin && window.Spin.current_socket && window.Spin.current_socket.readyState === WebSocket.OPEN) ? 'ok' : 'warn'); } catch (e) {}
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
          } catch (e) { /* ignore focus errors */ }
        }, 0);
      }
    } catch (e) { /* ignore */ }
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
    // Debug: log the click target for diagnosing drag-blocks
    try { console.debug('makeDraggable mousedown', { tag: e.target.tagName, cls: e.target.className, isContentEditable: !!e.target.isContentEditable }); } catch (err) {}

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
      if (e.target.isContentEditable) return;
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

function createDecoration() {
  const select = document.getElementById('deco-select');
  const colorInput = document.getElementById('deco-color');
  const type = select.value;
  const color = colorInput ? colorInput.value : '#cccccc';
  
  if (!type) {
    alert('Please select a decoration type.');
    return;
  }

  const id = 'deco-' + Date.now();
  const wrapper = document.createElement('div');
  wrapper.className = 'deco-box';
  wrapper.id = id;
  wrapper.dataset.type = type;
  
  // Selection logic
  wrapper.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      selectDeco(wrapper);
  });
  
  if (type === 'gas-line') 
  
  {
    wrapper.classList.add('deco-type-line');
    wrapper.style.width = '100px';
    wrapper.style.height = '20px';
    const visual = document.createElement('div');
    visual.className = 'deco-visual';
    visual.style.backgroundColor = color;
    visual.style.border = '1px solid #999';
    wrapper.appendChild(visual);
  }
   else if (type === 'gas-line-v') 
    
  {
    wrapper.classList.add('deco-type-line-v');
    wrapper.style.width = '20px';
    wrapper.style.height = '100px';
    const visual = document.createElement('div');
    visual.className = 'deco-visual';
    visual.style.backgroundColor = color;
    visual.style.border = '1px solid #999';
    wrapper.appendChild(visual);
  } else if (type === 'label') 
    
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
  // Position the handle at the top-left outside the label so it doesn't block text clicks
    dragHandle.style.cssText = 'position:absolute; top:-6px; left:-6px; width:12px; height:12px; background:rgba(0,0,0,0.22); border-radius:50%; cursor:move;';
  // allow events to bubble so makeDraggable can handle mousedown on the handle
    dragHandle.style.pointerEvents = 'auto';
    wrapper.appendChild(dragHandle);
  } 
  
  else if (type === 'control-panel') 
    
  {
  wrapper.classList.add('control-panel-box');
  wrapper.style.width = '400px';
  wrapper.style.height = '300px';
  wrapper.style.background = '#f8f9fa';
  wrapper.style.border = '2px solid #007bff';
  wrapper.style.borderRadius = '18px';
  wrapper.style.boxShadow = '0 4px 16px rgba(0,0,0,0.10)';
  wrapper.style.overflow = 'visible';
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.zIndex = 5;
  wrapper.style.position = 'absolute';
    // Page bar
    const pageBar = document.createElement('div');
    pageBar.className = 'control-panel-pagebar';
    pageBar.style.display = 'flex';
    pageBar.style.alignItems = 'center';
    pageBar.style.background = '#e3eafc';
    pageBar.style.borderBottom = '1px solid #b6d4fe';
    pageBar.style.borderRadius = '16px 16px 0 0';
    pageBar.style.padding = '4px 8px';
    pageBar.style.userSelect = 'none';
    // Page list
    const pageList = document.createElement('div');
    pageList.className = 'control-panel-pages';
    pageList.style.display = 'flex';
    pageList.style.gap = '8px';
    pageBar.appendChild(pageList);
    // Add page button
    const addBtn = document.createElement('button');
    addBtn.textContent = '+';
    addBtn.title = 'Add Page';
    addBtn.style.marginLeft = '8px';
    addBtn.style.border = 'none';
    addBtn.style.background = '#b6d4fe';
    addBtn.style.borderRadius = '8px';
    addBtn.style.cursor = 'pointer';
    addBtn.style.fontWeight = 'bold';
    addBtn.onclick = (e) => {
      e.stopPropagation();
      addControlPanelPage(wrapper, pageList, wrapper._panelPagesContent);
    };
    pageBar.appendChild(addBtn);
    wrapper.appendChild(pageBar);
    // Panel pages content containers (store on wrapper for access everywhere)
    wrapper._panelPagesContent = [];
    wrapper._pageList = pageList;
    wrapper._activePageIdx = 0;
    // Add first page
    addControlPanelPage(wrapper, pageList, wrapper._panelPagesContent);
    wrapper.appendChild(wrapper._panelPagesContent[0]);
    // Right-click for page management
    pageBar.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showControlPanelContextMenu(e, wrapper);
    });
    // Drag/drop for device-boxes: always use the active page
    wrapper.ondragover = (e) => {
      const activeIdx = wrapper._activePageIdx;
      if (wrapper._panelPagesContent[activeIdx]) wrapper._panelPagesContent[activeIdx].ondragover(e);
    };
    wrapper.ondrop = (e) => {
      const activeIdx = wrapper._activePageIdx;
      if (wrapper._panelPagesContent[activeIdx]) wrapper._panelPagesContent[activeIdx].ondrop(e);
    };
  }

  // Remove button
  const removeBtn = document.createElement('div');
  removeBtn.className = 'deco-remove';
  removeBtn.innerHTML = '&times;';
  removeBtn.onclick = function(e) {
    e.stopPropagation(); // Prevent bubbling
    wrapper.remove();
  };
  wrapper.appendChild(removeBtn);
  
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
  
  // Make it draggable and resizable
  makeDraggable(wrapper);
  makeResizable(wrapper);

  // For control panel, allow device-box drag into panel
  if (type === 'control-panel') {
    wrapper.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('control-panel-pagebar') || e.target.closest('.control-panel-pagebar')) {
        // Don't drag panel when interacting with page bar
        e.stopPropagation();
      }
    });
  }
// --- Control Panel Page Management ---
function addControlPanelPage(panel, pageList, panelPagesContent) {
  const pageName = prompt('Enter page name:', 'Page ' + (pageList.children.length + 1));
  if (!pageName) return;
  const pageBtn = document.createElement('button');
  pageBtn.textContent = pageName;
  pageBtn.className = 'control-panel-page-btn';
  pageBtn.style.border = 'none';
  pageBtn.style.background = '#fff';
  pageBtn.style.borderRadius = '8px';
  pageBtn.style.padding = '2px 8px';
  pageBtn.style.marginRight = '4px';
  pageBtn.style.cursor = 'pointer';
  // Create a content container for this page
  const pageContent = document.createElement('div');
  pageContent.className = 'control-panel-content';
  pageContent.style.flex = '1';
  pageContent.style.position = 'relative';
  pageContent.style.overflow = 'auto';
  pageContent.style.padding = '12px';
  pageContent.style.display = 'none';
  // Drag/drop for device-boxes
  pageContent.ondragover = (e) => {
    e.preventDefault();
    pageContent.style.boxShadow = '0 0 0 3px #007bff inset';
  };
  pageContent.ondragleave = (e) => {
    pageContent.style.boxShadow = '';
  };
  pageContent.ondrop = (e) => {
    const boxId = e.dataTransfer.getData('text/plain');
    const box = document.getElementById(boxId);
    if (box && box.classList.contains('device-box')) {
      pageContent.appendChild(box);
      // Position relative to panel
      const rect = pageContent.getBoundingClientRect();
      box.style.left = (e.clientX - rect.left - 20) + 'px';
      box.style.top = (e.clientY - rect.top - 20) + 'px';
      // Ensure box is above the panel
      box.style.zIndex = '10';
      // Track which page this box belongs to (find actual index)
      const pageIdx = panelPagesContent.indexOf(pageContent);
      if (pageIdx !== -1) {
        box.dataset.controlPanelPage = pageIdx;
  // [DROP] Assigned box to page
      } else {
  // [DROP] Could not assign box to a page (not found)
      }
      pageContent.style.boxShadow = '';
      // Update visibility after drop
      setActiveControlPanelPage(panel, pageList, pageBtn, panelPagesContent);
    } else {
      pageContent.style.boxShadow = '';
  // [DROP] Drop event fired but no valid device box found
    }
  };
  panelPagesContent.push(pageContent);
  // Add page button and set active
  pageBtn.onclick = (e) => {
    e.stopPropagation();
    setActiveControlPanelPage(panel, pageList, pageBtn, panelPagesContent);
  };
  pageList.appendChild(pageBtn);
  setActiveControlPanelPage(panel, pageList, pageBtn, panelPagesContent);
}

function setActiveControlPanelPage(panel, pageList, pageBtn, panelPagesContent) {
  
  Array.from(pageList.children).forEach(btn => btn.style.background = '#fff');
  pageBtn.style.background = '#b6d4fe';
  // Hide all page contents, show only the selected one
  panelPagesContent.forEach((content, idx) => {
    content.style.display = (pageList.children[idx] === pageBtn) ? 'block' : 'none';
  });
  // Remove all page contents from panel, then append the active one
  panelPagesContent.forEach(content => { if (content.parentNode === panel) panel.removeChild(content); });
  const idx = Array.from(pageList.children).indexOf(pageBtn);
  if (panelPagesContent[idx]) panel.appendChild(panelPagesContent[idx]);
  // Track active page index on the panel
  panel._activePageIdx = idx;
  // Debug output for device box assignment and parent
  // --- Device Box State on Page Switch ---
  document.querySelectorAll('.device-box').forEach(box => {
    const pageAssign = box.dataset.controlPanelPage;
    const parentClass = box.parentNode && box.parentNode.className;
  // Box debug: id, assigned page, parent
  });
  // Move device-boxes to the correct page content and update visibility
  document.querySelectorAll('.device-box').forEach(box => {
    if (box.dataset.controlPanelPage !== undefined) {
      const pageIdx = parseInt(box.dataset.controlPanelPage, 10);
      if (!isNaN(pageIdx) && panelPagesContent[pageIdx]) {
        // Always append to the correct page content if not already
        if (box.parentNode !== panelPagesContent[pageIdx]) {
          panelPagesContent[pageIdx].appendChild(box);
        }
        if (pageIdx === idx) {
          box.style.display = 'block';
          box.style.pointerEvents = 'auto';
        } else {
          box.style.display = 'none';
          box.style.pointerEvents = 'none';
        }
      }
    } else {
      // Boxes not assigned to a control panel page are always visible
      box.style.display = 'block';
      box.style.pointerEvents = 'auto';
    }
  });
}

function showControlPanelContextMenu(e, panel) {
  // Always get up-to-date references
  const pageList = panel._pageList;
  const panelPagesContent = panel._panelPagesContent;
  // Simple context menu for page actions
  let menu = document.getElementById('control-panel-context-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'control-panel-context-menu';
    menu.style.position = 'absolute';
    menu.style.zIndex = 3000;
    menu.style.background = '#fff';
    menu.style.border = '1px solid #ccc';
    menu.style.boxShadow = '2px 2px 8px rgba(0,0,0,0.15)';
    menu.style.padding = '6px 0';
    menu.style.borderRadius = '6px';
    document.body.appendChild(menu);
  }
  menu.innerHTML = '';
  // Rename page
  const rename = document.createElement('div');
  rename.textContent = 'Rename Page';
  rename.style.padding = '4px 16px';
  rename.style.cursor = 'pointer';
  rename.onclick = () => {
    const idx = Array.from(pageList.children).findIndex(btn => btn.style.background === 'rgb(182, 212, 254)' || btn.style.background === '#b6d4fe');
    const active = pageList.children[idx] || pageList.lastChild;
    if (active) {
      const newName = prompt('New page name:', active.textContent);
      if (newName) active.textContent = newName;
    }
    menu.style.display = 'none';
  };
  menu.appendChild(rename);
  // Add page
  const add = document.createElement('div');
  add.textContent = 'Add Page';
  add.style.padding = '4px 16px';
  add.style.cursor = 'pointer';
  add.onclick = () => {
    addControlPanelPage(panel, pageList, panelPagesContent);
    menu.style.display = 'none';
  };
  menu.appendChild(add);
  // Delete page
  const del = document.createElement('div');
  del.textContent = 'Delete Page';
  del.style.padding = '4px 16px';
  del.style.cursor = 'pointer';
  del.onclick = () => {
    const idx = Array.from(pageList.children).findIndex(btn => btn.style.background === 'rgb(182, 212, 254)' || btn.style.background === '#b6d4fe');
    const active = pageList.children[idx] || pageList.lastChild;
    if (active && pageList.children.length > 1) {
      // Remove content for this page
      if (panelPagesContent[idx]) {
        panelPagesContent[idx].remove();
        panelPagesContent.splice(idx, 1);
      }
      active.remove();
      setActiveControlPanelPage(panel, pageList, pageList.lastChild, panelPagesContent);
    } else {
      alert('At least one page required.');
    }
    menu.style.display = 'none';
  };
  menu.appendChild(del);
  // Show menu
  menu.style.left = e.pageX + 'px';
  menu.style.top = e.pageY + 'px';
  menu.style.display = 'block';
  // Hide on click elsewhere
  document.addEventListener('mousedown', function hideMenu(ev) {
    if (!menu.contains(ev.target)) {
      menu.style.display = 'none';
      document.removeEventListener('mousedown', hideMenu);
    }
  });
}
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

function sendCommand(device, cmd) {
  if (confirm(`Execute command '${cmd}' on ${device}?`)) {
      const key = device + '.' + cmd;
      Spin.send_request(key, "", "input", "", null);
  // Sent command logged
  }
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

// ===== Debug Logging (Removed) =====
function debug(msg) {
  // console.log(msg);
}

// Small on-page toast to show last valve action (non-console) for debugging
function showActionToast(msg, type) 

{
  try {
    let el = document.getElementById('action-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'action-toast';
      el.style.position = 'fixed';
      el.style.right = '12px';
      el.style.top = '12px';
      el.style.zIndex = 99999;
      el.style.padding = '8px 12px';
      el.style.borderRadius = '6px';
      el.style.fontFamily = 'Arial, sans-serif';
      el.style.fontSize = '12px';
      el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = type === 'error' ? 'rgba(220,53,69,0.95)' : (type === 'ok' ? 'rgba(40,167,69,0.95)' : 'rgba(0,123,255,0.9)');
    el.style.color = 'white';
    el.style.opacity = '1';
    clearTimeout(el._timeout);
    el._timeout = setTimeout(() => { el.style.opacity = '0'; }, 1400);
  } catch (e) { /* ignore */ }
}


updateLayoutList();
loadSavedBackground();
fetchNodesList();
fetchDeviceParams();

// Listen for Spin lifecycle events
window.addEventListener('spinstartup', function() { debug('✓ Spin startup event fired'); });
window.addEventListener('spinconnect', function() { 
   
    fetchNodesList();
    // Also request server-side saved layouts when connection opens
    if (window.Spin && window.Spin.send_request) {
      try {
        window.Spin.send_request('nodemanager.list_layouts', '', 'read', 'read', null);
      } catch (e) {
        console.error('list_layouts request failed', e);
      }
    }
    
});

window.addEventListener('spindisconnect', function() { debug('⚠ WebSocket disconnected from backend'); });
window.addEventListener('spinupdate', function(event) {
  var val = event.detail.value;
 
});

// ===== Context Menu Logic =====
let contextMenuTarget = null;
let ctxMenu = null;
let ctxColor = null;

// Initialize context menu elements after DOM loads
document.addEventListener('DOMContentLoaded', () => {
  ctxMenu = document.getElementById('context-menu');
  ctxColor = document.getElementById('ctx-color-picker');
  
  // Set up color picker listener
  if (ctxColor) {
    ctxColor.addEventListener('input', (e) => {
      if (contextMenuTarget) {
        const color = e.target.value;
        if (contextMenuTarget.dataset.type === 'label') {
          contextMenuTarget.style.color = color;
        } else {
          const visual = contextMenuTarget.querySelector('.deco-visual');
          if (visual) visual.style.backgroundColor = color;
        }
      }
    });
  }
  
  // Set up remove button listener
  const ctxRemoveBtn = document.getElementById('ctx-remove-btn');
  if (ctxRemoveBtn) {
    ctxRemoveBtn.addEventListener('click', () => {
      if (contextMenuTarget) {
        contextMenuTarget.remove();
        contextMenuTarget = null;
        if (ctxMenu) ctxMenu.style.display = 'none';
      }
    });
  }
});

// Hide menu on left click elsewhere
document.addEventListener('mousedown', (e) => {
  // Only handle left clicks for closing
  if (e.button !== 0) return;
  
  if (ctxMenu && ctxMenu.style.display === 'block' && !ctxMenu.contains(e.target)) {
    ctxMenu.style.display = 'none';
  }
});

// Delegate contextmenu event
document.addEventListener('contextmenu', (e) => {
  const box = e.target.closest('.deco-box');
  if (box && ctxMenu && ctxColor) {
    e.preventDefault();
    contextMenuTarget = box;
    
    // Set current color in picker
    let currentColor = '#cccccc';
    
    if (box.dataset.type === 'label') {
        // Try to get color from style
        if (box.style.color) currentColor = rgbToHex(box.style.color) || box.style.color;
    } else {
        const visual = box.querySelector('.deco-visual');
        if (visual && visual.style.backgroundColor) {
             currentColor = rgbToHex(visual.style.backgroundColor) || visual.style.backgroundColor;
        }
    }
    // Ensure it's a valid hex for input type=color
    if (currentColor.startsWith('rgb')) currentColor = rgbToHex(currentColor);
    if (!currentColor.startsWith('#')) currentColor = '#cccccc'; // Fallback
    
    ctxColor.value = currentColor;

    ctxMenu.style.left = e.pageX + 'px';
    ctxMenu.style.top = e.pageY + 'px';
    ctxMenu.style.display = 'block';
  }
});

// Removed duplicate listeners - now in DOMContentLoaded above

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

// ===== Pan & Zoom Logic =====
// Variables moved to top of script
// let scale = 1;
// let panX = 0;
// let panY = 0;

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
}

function toggleAnimation() {
  // Animation feature removed
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
}

// Pan Event Listeners
let isPanning = false;
let startPanX, startPanY;

// Initialize listeners when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // No pan/zoom listeners
});



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
}
  // Also request server-side layouts (if Spin available)
  if (window.Spin && window.Spin.send_request) {
    try {
      window.Spin.send_request('nodemanager.list_layouts', '', 'read', 'read', null);
    } catch (e) {
      console.error('list_layouts request failed', e);
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

function getCurrentLayoutData() {
  const layout = {
    devices: [],
    valveIcons: [],
    decorations: []
  };
  
  // Save Devices (regular device boxes) with full device info
  document.querySelectorAll('.device-box').forEach(box => {
    const title = box.querySelector('.device-title').textContent;
    // Try to get logical device name from box id
    const logicalName = box.id.replace(/^box-/, '');
    // Get device info from WRITABLE_PARAMS if available
    let deviceInfo = {};
    if (window.WRITABLE_PARAMS && window.WRITABLE_PARAMS[logicalName]) {
      deviceInfo = window.WRITABLE_PARAMS[logicalName];
    }
    layout.devices.push({
      id: box.id,
      device: title,
      logicalName: logicalName,
      left: box.style.left,
      top: box.style.top,
      width: box.style.width,
      height: box.style.height,
      info: deviceInfo
    });
  });
  
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
      type: type,
      left: box.style.left,
      top: box.style.top,
      width: box.style.width,
      height: box.style.height,
      color: color,
      text: text
    });
  });
  return layout;
}


function applyLayout(layout) {
  // Clear current
  document.getElementById('device-grid').innerHTML = '';
  
  // Restore Devices with robust matching to current SEC node configuration
  if (layout.devices) {
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
      if (match) {
        select.value = match;
        createDeviceDisplay(); // This creates it at default pos
        // Find the newly created box (last one)
        const boxes = document.querySelectorAll('.device-box');
        const newBox = boxes[boxes.length - 1];
        if (newBox) {
          newBox.style.left = d.left;
          newBox.style.top = d.top;
          if(d.width) newBox.style.width = d.width;
          if(d.height) newBox.style.height = d.height;
        }
      } else {
            }
    });
  }
  
  // Restore Decorations
  if (layout.decorations) {
      layout.decorations.forEach(d => {
          const select = document.getElementById('deco-select');
          const colorInput = document.getElementById('deco-color');
          
          select.value = d.type;
          if (d.color) colorInput.value = rgbToHex(d.color) || d.color;
          
          createDecoration();
          
          const boxes = document.querySelectorAll('.deco-box');
          const newBox = boxes[boxes.length - 1];
          if (newBox) {
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
      });
  }
  
  // Restore Valve Icons (individual valve/switch icons) if present in layout
  if (layout.valveIcons && Array.isArray(layout.valveIcons)) {
    const select = document.getElementById('device-select');
    const availableDevices = select ? Array.from(select.options).map(opt => opt.value) : [];

    layout.valveIcons.forEach(iconDef => {
      try {
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

        // Image container
        const imgContainer = document.createElement('div');
        imgContainer.id = `img-${valveDomId}`;
        imgContainer.style.cssText = 'width: 80px; height: 80px; position: relative;';

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
        try {
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
        } catch (e) { /* ignore init errors */ }

        valveIcon.appendChild(imgContainer);
        valveIcon.appendChild(label);
        valveIcon.appendChild(resizeHandle);
        valveIcon.appendChild(valueDisplay);

        const grid = document.getElementById('device-grid');
        if (grid) {
          grid.appendChild(valveIcon);
        }
        makeValveIconDraggable(valveIcon);
        makeValveIconResizable(valveIcon, imgContainer);

        // Ensure we have image listeners for this device (safe to call multiple times)
        try { setupValveImageListeners(realDevice, deviceDomId(realDevice)); } catch (e) { /* ignore */ }
      } catch (e) {
        // swallow individual icon errors
      }
    });
  }

  // After restoring valve icons, reload Spin to bind new data-spin attributes
  if (window.Spin && window.Spin.reload) {
    window.Spin.reload();
  }
}

