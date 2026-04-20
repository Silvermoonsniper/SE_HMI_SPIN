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

