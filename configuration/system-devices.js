// ===== Device Management =====
var AppState = window.SEAppState;
var AppUi = window.SEAppUi || {};

const DEFAULT_VALVE_CLOSED_SVG = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9Ijk0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iOTQiIGZpbGw9IiNmZmYiLz48cG9seWdvbiBwb2ludHM9IjEwLDIwIDEwLDc0IDYwLDQ3IiBmaWxsPSIjMDAwMDAwIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMiIvPjxwb2x5Z29uIHBvaW50cz0iMTEwLDIwIDExMCw3NCA2MCw0NyIgZmlsbD0iIzAwMDAwMCIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjIiLz48L3N2Zz4=';
const DEFAULT_VALVE_OPEN_SVG = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9Ijk0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iOTQiIGZpbGw9IiNmZmYiLz48IS0tIExlZnQgdHJpYW5nbGUgcG9pbnRpbmcgcmlnaHQgLS0+PHBvbHlnb24gcG9pbnRzPSIxMCwyMCAxMCw3NCA2MCw0NyIgZmlsbD0iIzI4YTc0NSIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjIiLz48IS0tIFJpZ2h0IHRyaWFuZ2xlIHBvaW50aW5nIGxlZnQgLS0+PHBvbHlnb24gcG9pbnRzPSIxMTAsMjAgMTEwLDc0IDYwLDQ3IiBmaWxsPSIjMjhhNzQ1IiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==';
const DEFAULT_SWITCH_SVG = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI0IiBoZWlnaHQ9IjEwNiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTI0IiBoZWlnaHQ9IjEwNiIgZmlsbD0id2hpdGUiLz48ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSg2Miw1MykiPjxjaXJjbGUgY3g9IjAiIGN5PSIwIiByPSI0NSIgZmlsbD0id2hpdGUiIHN0cm9rZT0iIzMzMyIgc3Ryb2tlLXdpZHRoPSIzIi8+PHBhdGggZD0iTSAtNDQuMyA2LjcgQSA0NSA0NSAwIDAgMSAtNi43IDQ0LjMiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzMzMyIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48cGF0aCBkPSJNIDQ0LjMgLTYuNyBBIDQ1IDQ1IDAgMCAxIDYuNyAtNDQuMyIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMzMzIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvZz48L3N2Zz4=';
const DEFAULT_SWITCH_CLOSED_SVG = DEFAULT_SWITCH_SVG;
const DEFAULT_SWITCH_OPEN_SVG = DEFAULT_SWITCH_SVG;
let valveSvgAssetsPromise = null;
let valveSvgPickerRefs = null;
let valveSvgPickerGlobalListenerReady = false;
let valveIconActionMenuRefs = null;

function getValveIconRotationDegrees(valveIcon) {
  const value = parseFloat((valveIcon && valveIcon.dataset && valveIcon.dataset.rotationDegrees) || '0');
  return Number.isFinite(value) ? value : 0;
}

function getSwitchStateRotationDegrees(imgContainer, valveIcon) {
  const closedSvg = valveIcon && valveIcon.dataset ? (valveIcon.dataset.switchClosedSvg || '') : '';
  const openSvg = valveIcon && valveIcon.dataset ? (valveIcon.dataset.switchOpenSvg || '') : '';
  const usesDistinctStateArtwork = !!closedSvg && !!openSvg && closedSvg !== openSvg;
  if (usesDistinctStateArtwork) {
    return 0;
  }

  const positionValue = valveIcon && valveIcon.dataset
    ? valveIcon.dataset.open
    : imgContainer && imgContainer.dataset
      ? imgContainer.dataset.switchPosition
      : '0';
  return String(positionValue) === '1' ? 90 : 0;

  
}

function syncValveIconTransform(valveIcon) {
  if (!valveIcon) return;
  const imgContainer = valveIcon.querySelector('div[id^="img-"]');
  if (!imgContainer) return;

  const lowerField = String(valveIcon.dataset.field || '').toLowerCase();
  const isSwitch = lowerField.includes('switch');
  const baseRotationDegrees = getValveIconRotationDegrees(valveIcon);
  const effectiveRotation = isSwitch
    ? baseRotationDegrees + getSwitchStateRotationDegrees(imgContainer, valveIcon)
    : baseRotationDegrees;

  imgContainer.style.transform = `rotate(${effectiveRotation}deg)`;
  imgContainer.style.transformOrigin = 'center center';
}

function applyValveIconRotation(valveIcon, degrees) {
  if (!valveIcon) return;
  const parsedDegrees = parseFloat(degrees);
  const rotationDegrees = Number.isFinite(parsedDegrees) ? parsedDegrees : 0;

  valveIcon.dataset.rotationDegrees = String(rotationDegrees);
  syncValveIconTransform(valveIcon);
}

function syncValveRotationToStoredLayout(valveIcon) {
  if (!valveIcon) return;
  try {
    const selected = sessionStorage.getItem('selectedLayout');
    if (!selected) return;
    const layouts = getStoredLayouts();
    const layout = layouts && layouts[selected];
    if (!layout || !Array.isArray(layout.valveIcons)) return;
    const entry = layout.valveIcons.find((item) => item && item.id === valveIcon.id);
    if (!entry) return;
    entry.rotationDegrees = valveIcon.dataset.rotationDegrees || '0';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
  } catch (e) {
    console.error('Failed to update stored valve icon rotation', e);
  }
}

async function promptValveIconRotation(valveIcon) {
  if (!valveIcon) return;

  const field = String(valveIcon.dataset.field || '');
  const title = field ? `Rotate ${field}` : 'Rotate Valve Icon';
  const currentValue = String(getValveIconRotationDegrees(valveIcon));
  let response = null;

  if (AppUi.showAppPrompt) {
    response = await AppUi.showAppPrompt('Enter icon rotation in degrees', currentValue, title);
  } else {
    response = window.prompt('Enter icon rotation in degrees', currentValue);
  }

  if (response === null) return;

  const nextDegrees = parseFloat(String(response).trim());
  if (!Number.isFinite(nextDegrees)) 
    {
    if (AppUi.showAppAlert) {
      await AppUi.showAppAlert('Please enter a valid number of degrees.', title);
    } else 
      {
      window.alert('Please enter a valid number of degrees.');
    }
    return;
  }

  applyValveIconRotation(valveIcon, nextDegrees);
  syncValveRotationToStoredLayout(valveIcon);
}

function ensureValveIconActionMenu() {
  if (valveIconActionMenuRefs) return valveIconActionMenuRefs;

  const menu = document.createElement('div');
  menu.className = 'valve-icon-action-menu';
  menu.style.display = 'none';
  menu.innerHTML = [
    '<button type="button" data-action="rotate">Rotate Icon</button>',
    '<button type="button" data-action="svg">Change SVG</button>',
    '<button type="button" data-action="cancel">Cancel</button>'
  ].join('');
  document.body.appendChild(menu);

  valveIconActionMenuRefs = {
    menu,
    targetValve: null,
  };

  function hideValveIconActionMenu() {
    valveIconActionMenuRefs.targetValve = null;
    menu.style.display = 'none';
  }

  menu.querySelector('[data-action="rotate"]').addEventListener('click', () => {
    const targetValve = valveIconActionMenuRefs.targetValve;
    hideValveIconActionMenu();
    if (!targetValve) return;
    promptValveIconRotation(targetValve).catch((error) => {
      console.error('Failed to rotate valve icon', error);
    });
  });

  menu.querySelector('[data-action="svg"]').addEventListener('click', () => {
    const targetValve = valveIconActionMenuRefs.targetValve;
    const rect = menu.getBoundingClientRect();
    hideValveIconActionMenu();
    if (!targetValve) return;
    showValveSvgPicker(targetValve, rect.left, rect.top).catch((error) => {
      console.error('Failed to show valve SVG picker', error);
    });
  });

  menu.querySelector('[data-action="cancel"]').addEventListener('click', hideValveIconActionMenu);

  document.addEventListener('mousedown', (event) => {
    if (menu.style.display === 'none') return;
    if (!menu.contains(event.target)) hideValveIconActionMenu();
  });

  return valveIconActionMenuRefs;
}

function showValveIconActionMenu(valveIcon, clientX, clientY) {
  if (!valveIcon) return;
  const menuRefs = ensureValveIconActionMenu();
  menuRefs.targetValve = valveIcon;
  menuRefs.menu.style.display = 'block';
  menuRefs.menu.style.left = `${Math.min(clientX, window.innerWidth - 180)}px`;
  menuRefs.menu.style.top = `${Math.min(clientY, window.innerHeight - 140)}px`;
}

function getDeviceParamsState() {
  return AppState.getDeviceParams();
}

function getValveAssetApiBase() {
  try {
    return typeof API_BASE !== 'undefined'
      ? API_BASE
      : `${window.location.protocol}//${window.location.hostname}:8001`;
  } catch (e) {
    return 'http://127.0.0.1:8001';
  }
}

function getValveSvgStorageKey(device, field, state) {
  return `valve-svg:${device}:${field}:${state}`;
}

function getSwitchSvgStorageKey(device, field, state) {
  return `switch-svg:${device}:${field}:${state}`;
}

function readValveSvgPreference(device, field, state) {
  try {
    return localStorage.getItem(getValveSvgStorageKey(device, field, state)) || '';
  } catch (e) {
    return '';
  }
}

function writeValveSvgPreference(device, field, state, value) {
  try {
    const storageKey = getValveSvgStorageKey(device, field, state);
    if (value) localStorage.setItem(storageKey, value);
    else localStorage.removeItem(storageKey);
  } catch (e) {
    // ignore storage failures
  }
}

function readLegacySwitchSvgPreference(device, field) {
  try {
    return localStorage.getItem(`switch-svg:${device}:${field}`) || '';
  } catch (e) {
    return '';
  }
}

function readSwitchSvgPreference(device, field, state) {
  try {
    return localStorage.getItem(getSwitchSvgStorageKey(device, field, state)) || '';
  } catch (e) {
    return '';
  }
}

function writeSwitchSvgPreference(device, field, state, value) {
  try {
    const storageKey = getSwitchSvgStorageKey(device, field, state);
    if (value) localStorage.setItem(storageKey, value);
    else localStorage.removeItem(storageKey);
  } catch (e) {
    // ignore storage failures
  }
}

function getDefaultValveSvgForState(isOpen) {
  return isOpen ? DEFAULT_VALVE_OPEN_SVG : DEFAULT_VALVE_CLOSED_SVG;
}

function initializeValveSvgChoices(valveIcon, options) {
  if (!valveIcon) return;
  const device = valveIcon.dataset.device || '';
  const field = valveIcon.dataset.field || '';
  const choices = options || {};
  const closedSvg = choices.closedSvg || readValveSvgPreference(device, field, 'closed') || DEFAULT_VALVE_CLOSED_SVG;
  const openSvg = choices.openSvg || readValveSvgPreference(device, field, 'open') || DEFAULT_VALVE_OPEN_SVG;
  valveIcon.dataset.closedSvg = closedSvg;
  valveIcon.dataset.openSvg = openSvg;
}

function initializeSwitchSvgChoice(valveIcon, options) {
  if (!valveIcon) return;
  const device = valveIcon.dataset.device || '';
  const field = valveIcon.dataset.field || '';
  const choices = options || {};
  const legacySvg = choices.switchSvg || readLegacySwitchSvgPreference(device, field) || DEFAULT_SWITCH_SVG;
  const closedSvg = choices.closedSvg || choices.switchClosedSvg || readSwitchSvgPreference(device, field, 'closed') || legacySvg || DEFAULT_SWITCH_CLOSED_SVG;
  const openSvg = choices.openSvg || choices.switchOpenSvg || readSwitchSvgPreference(device, field, 'open') || legacySvg || DEFAULT_SWITCH_OPEN_SVG;
  valveIcon.dataset.switchClosedSvg = closedSvg;
  valveIcon.dataset.switchOpenSvg = openSvg;
  valveIcon.dataset.switchSvg = openSvg;
}

function setValveSvgChoices(valveIcon, choices, persist) {
  if (!valveIcon) return;
  const device = valveIcon.dataset.device || '';
  const field = valveIcon.dataset.field || '';
  const closedSvg = choices && choices.closedSvg ? choices.closedSvg : DEFAULT_VALVE_CLOSED_SVG;
  const openSvg = choices && choices.openSvg ? choices.openSvg : DEFAULT_VALVE_OPEN_SVG;
  valveIcon.dataset.closedSvg = closedSvg;
  valveIcon.dataset.openSvg = openSvg;
  if (persist) {
    writeValveSvgPreference(device, field, 'closed', closedSvg === DEFAULT_VALVE_CLOSED_SVG ? '' : closedSvg);
    writeValveSvgPreference(device, field, 'open', openSvg === DEFAULT_VALVE_OPEN_SVG ? '' : openSvg);
  }
}

function getValveSvgForState(valveIcon, isOpen) {
  if (!valveIcon) return getDefaultValveSvgForState(isOpen);
  const configured = isOpen ? valveIcon.dataset.openSvg : valveIcon.dataset.closedSvg;
  return configured || getDefaultValveSvgForState(isOpen);
}

function getDefaultSwitchSvgForState(isOpen) 
{
  return isOpen ? DEFAULT_SWITCH_OPEN_SVG : DEFAULT_SWITCH_CLOSED_SVG;
}

function getSwitchSvgForState(valveIcon, isOpen) {
  if (!valveIcon) return getDefaultSwitchSvgForState(isOpen);
  const configured = isOpen ? valveIcon.dataset.switchOpenSvg : valveIcon.dataset.switchClosedSvg;
  return configured || getDefaultSwitchSvgForState(isOpen);
}

function setSwitchSvgChoice(valveIcon, choices, persist) 
{
  if (!valveIcon) return;
  const device = valveIcon.dataset.device || '';
  const field = valveIcon.dataset.field || '';
  const closedSvg = choices && choices.closedSvg ? choices.closedSvg : DEFAULT_SWITCH_CLOSED_SVG;
  const openSvg = choices && choices.openSvg ? choices.openSvg : DEFAULT_SWITCH_OPEN_SVG;
  valveIcon.dataset.switchClosedSvg = closedSvg;
  valveIcon.dataset.switchOpenSvg = openSvg;
  valveIcon.dataset.switchSvg = openSvg;
  if (persist) {
    writeSwitchSvgPreference(device, field, 'closed', closedSvg === DEFAULT_SWITCH_CLOSED_SVG ? '' : closedSvg);
    writeSwitchSvgPreference(device, field, 'open', openSvg === DEFAULT_SWITCH_OPEN_SVG ? '' : openSvg);
  }
}

function syncValveSvgSelectionToStoredLayout(valveIcon) {
  if (!valveIcon) return;
  try {
    const selected = sessionStorage.getItem('selectedLayout');
    if (!selected) return;
    const layouts = getStoredLayouts();
    const layout = layouts && layouts[selected];
    if (!layout || !Array.isArray(layout.valveIcons)) return;
    const entry = layout.valveIcons.find((item) => item && item.id === valveIcon.id);
    if (!entry) return;
    entry.closedSvg = valveIcon.dataset.closedSvg || '';
    entry.openSvg = valveIcon.dataset.openSvg || '';
    entry.switchSvg = valveIcon.dataset.switchSvg || '';
    entry.switchClosedSvg = valveIcon.dataset.switchClosedSvg || '';
    entry.switchOpenSvg = valveIcon.dataset.switchOpenSvg || '';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
  } catch (e) {
    console.error('Failed to update stored valve SVG selection', e);
  }
}

function refreshValveIconImage(valveIcon) {
  if (!valveIcon) return;
  const field = String(valveIcon.dataset.field || '');
  if (field.toLowerCase().includes('switch')) {
    const img = valveIcon.querySelector('img');
    if (img) img.src = getSwitchSvgForState(valveIcon, valveIcon.dataset.open === '1');
    return;
  }
  const valveDomId = valveIcon.id.replace(/^icon-/, '');
  updateValveImage(valveDomId, valveIcon.dataset.open === '1');
}

function fetchValveSvgAssets() {
  if (!valveSvgAssetsPromise) {
    valveSvgAssetsPromise = fetch(getValveAssetApiBase() + '/api/assets/svg', { method: 'GET' })
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .then((payload) => Array.isArray(payload && payload.files) ? payload.files : [])
      .catch((error) => {
        valveSvgAssetsPromise = null;
        throw error;
      });
  }
  return valveSvgAssetsPromise;
}

function ensureValveSvgPicker() {
  if (valveSvgPickerRefs) return valveSvgPickerRefs;

  const menu = document.createElement('div');
  menu.className = 'valve-svg-picker-menu';
  menu.style.display = 'none';
  menu.innerHTML = [
    '<div class="valve-svg-picker-title">Valve SVG</div>',
    '<label class="valve-svg-picker-label" for="valve-svg-switch-select">Switch</label>',
    '<select id="valve-svg-switch-select" class="valve-svg-picker-select"></select>',
    '<label class="valve-svg-picker-label" for="valve-svg-closed-select">Closed (0)</label>',
    '<select id="valve-svg-closed-select" class="valve-svg-picker-select"></select>',
    '<label class="valve-svg-picker-label" for="valve-svg-open-select">Open (1)</label>',
    '<select id="valve-svg-open-select" class="valve-svg-picker-select"></select>',
    '<div class="valve-svg-picker-actions">',
    '  <button type="button" data-action="apply">Apply</button>',
    '  <button type="button" data-action="reset">Reset</button>',
    '  <button type="button" data-action="cancel">Cancel</button>',
    '</div>'
  ].join('');
  document.body.appendChild(menu);

  valveSvgPickerRefs = {
    menu,
    title: menu.querySelector('.valve-svg-picker-title'),
    switchLabel: menu.querySelector('label[for="valve-svg-switch-select"]'),
    switchSelect: menu.querySelector('#valve-svg-switch-select'),
    closedLabel: menu.querySelector('label[for="valve-svg-closed-select"]'),
    closedSelect: menu.querySelector('#valve-svg-closed-select'),
    openLabel: menu.querySelector('label[for="valve-svg-open-select"]'),
    openSelect: menu.querySelector('#valve-svg-open-select'),
    targetValve: null,
    mode: 'valve',
  };

  function hideValveSvgPicker() {
    valveSvgPickerRefs.targetValve = null;
    menu.style.display = 'none';
  }

  menu.querySelector('[data-action="cancel"]').addEventListener('click', hideValveSvgPicker);
  menu.querySelector('[data-action="reset"]').addEventListener('click', () => {
    if (!valveSvgPickerRefs.targetValve) return;
    if (valveSvgPickerRefs.mode === 'switch') {
      setSwitchSvgChoice(valveSvgPickerRefs.targetValve, {
        closedSvg: DEFAULT_SWITCH_CLOSED_SVG,
        openSvg: DEFAULT_SWITCH_OPEN_SVG,
      }, true);
    } else {
      setValveSvgChoices(valveSvgPickerRefs.targetValve, {
        closedSvg: DEFAULT_VALVE_CLOSED_SVG,
        openSvg: DEFAULT_VALVE_OPEN_SVG,
      }, true);
    }
    refreshValveIconImage(valveSvgPickerRefs.targetValve);
    syncValveSvgSelectionToStoredLayout(valveSvgPickerRefs.targetValve);
    hideValveSvgPicker();
  });
  menu.querySelector('[data-action="apply"]').addEventListener('click', () => {
    if (!valveSvgPickerRefs.targetValve) return;
    if (valveSvgPickerRefs.mode === 'switch') {
      setSwitchSvgChoice(valveSvgPickerRefs.targetValve, {
        closedSvg: valveSvgPickerRefs.closedSelect.value,
        openSvg: valveSvgPickerRefs.openSelect.value,
      }, true);
    } else {
      setValveSvgChoices(valveSvgPickerRefs.targetValve, {
        closedSvg: valveSvgPickerRefs.closedSelect.value,
        openSvg: valveSvgPickerRefs.openSelect.value,
      }, true);
    }
    refreshValveIconImage(valveSvgPickerRefs.targetValve);
    syncValveSvgSelectionToStoredLayout(valveSvgPickerRefs.targetValve);
    hideValveSvgPicker();
  });

  document.addEventListener('mousedown', (event) => {
    if (menu.style.display === 'none') return;
    if (!menu.contains(event.target)) hideValveSvgPicker();
  });

  return valveSvgPickerRefs;
}

function populateValveSvgSelect(select, assets, selectedValue, defaultValue) {
  if (!select) return;
  select.innerHTML = '';
  const options = [{ name: 'Built-in', url: defaultValue }, ...(assets || [])];
  const hasSelected = options.some((option) => option.url === selectedValue);
  if (!hasSelected && selectedValue) {
    options.push({ name: 'Current custom', url: selectedValue });
  }
  options.forEach((option) => {
    const el = document.createElement('option');
    el.value = option.url;
    el.textContent = option.name;
    if (option.url === selectedValue) el.selected = true;
    select.appendChild(el);
  });
}

async function showValveSvgPicker(valveIcon, clientX, clientY) {
  const picker = ensureValveSvgPicker();
  picker.targetValve = valveIcon;
  const field = String(valveIcon.dataset.field || '');
  const isSwitch = field.toLowerCase().includes('switch');
  picker.mode = isSwitch ? 'switch' : 'valve';
  picker.title.textContent = `${field || (isSwitch ? 'Switch' : 'Valve')} SVG`;

  let assets = [];
  try {
    assets = await fetchValveSvgAssets();
  } catch (error) {
    if (AppUi.showAppAlert) {
      await AppUi.showAppAlert(`Failed to load SVG assets.\n${error.message || error}`, 'Valve SVG');
    }
    return;
  }

  picker.switchLabel.style.display = isSwitch ? 'block' : 'none';
  picker.switchSelect.style.display = isSwitch ? 'block' : 'none';
  picker.closedLabel.style.display = 'block';
  picker.closedSelect.style.display = 'block';
  picker.openLabel.style.display = 'block';
  picker.openSelect.style.display = 'block';

  if (isSwitch) {
    picker.switchLabel.textContent = 'Switch presets';
    picker.switchSelect.style.display = 'none';
    picker.closedLabel.textContent = 'State 0';
    picker.openLabel.textContent = 'State 1';
    populateValveSvgSelect(picker.closedSelect, assets, getSwitchSvgForState(valveIcon, false), DEFAULT_SWITCH_CLOSED_SVG);
    populateValveSvgSelect(picker.openSelect, assets, getSwitchSvgForState(valveIcon, true), DEFAULT_SWITCH_OPEN_SVG);
  } else {
    picker.switchSelect.style.display = 'none';
    picker.closedLabel.textContent = 'Closed (0)';
    picker.openLabel.textContent = 'Open (1)';
    populateValveSvgSelect(picker.closedSelect, assets, getValveSvgForState(valveIcon, false), DEFAULT_VALVE_CLOSED_SVG);
    populateValveSvgSelect(picker.openSelect, assets, getValveSvgForState(valveIcon, true), DEFAULT_VALVE_OPEN_SVG);
  }
  picker.menu.style.display = 'block';
  picker.menu.style.left = `${Math.min(clientX, window.innerWidth - 260)}px`;
  picker.menu.style.top = `${Math.min(clientY, window.innerHeight - 220)}px`;
}

function findValveIconAtPoint(clientX, clientY) {
  if (typeof document.elementsFromPoint !== 'function') {
    return null;
  }
  const stack = document.elementsFromPoint(clientX, clientY) || [];
  for (const element of stack) {
    if (!element || !element.closest) continue;
    const valveIcon = element.closest('.valve-icon');
    if (!valveIcon) continue;
    const field = String(valveIcon.dataset.field || '');
    const lowerField = field.toLowerCase();
    const isSwitch = lowerField.includes('switch');
    const isValve = lowerField.includes('valve') || field.startsWith('V');
    if (isValve || isSwitch) {
      return valveIcon;
    }
  }
  return null;
}

function ensureGlobalValveSvgPickerListener() {
  if (valveSvgPickerGlobalListenerReady) return;
  valveSvgPickerGlobalListenerReady = true;

  document.addEventListener('contextmenu', (event) => {
    const valveIcon = findValveIconAtPoint(event.clientX, event.clientY);
    if (!valveIcon) return;

    event.preventDefault();
    event.stopPropagation();

    if (valveIcon.classList.contains('configure-layout')) {
      showValveIconActionMenu(valveIcon, event.clientX, event.clientY);
      return;
    }

    showValveSvgPicker(valveIcon, event.clientX, event.clientY).catch((error) => {
      console.error('Failed to show valve SVG picker', error);
    });
  }, true);
}

function attachValveSvgPicker(valveIcon, isConfigurableIcon) {
  if (!valveIcon || !isConfigurableIcon || valveIcon.dataset.svgPickerReady === 'true') return;
  ensureGlobalValveSvgPickerListener();
  valveIcon.dataset.svgPickerReady = 'true';
  valveIcon.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (valveIcon.classList.contains('configure-layout')) {
      showValveIconActionMenu(valveIcon, event.clientX, event.clientY);
      return;
    }

    showValveSvgPicker(valveIcon, event.clientX, event.clientY).catch((error) => {
      console.error('Failed to show valve SVG picker', error);
    });
  });
}

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

function createDeviceDisplay(isConfigurelayout, options = {}) 

{
  const select = document.getElementById('device-select');
  const device = options.device || (select ? select.value : '');
  
  if (!device)  
  
    {
    alert('Please select a device first.');
    return;
  }
  
  const domId = options.instanceDomId || deviceDomId(device);
  if (!options.allowDuplicate && document.getElementById('box-' + domId)) 
  {
    // alert('Display for ' + device + ' already exists.');
    return;
  }
  
  // Get original device name from WRITABLE_PARAMS when available
  const deviceParams = getDeviceParamsState();
  const deviceData = deviceParams ? deviceParams[device] : null;
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
  
  // Position it intelligently unless a caller provides an explicit placement.
  const count = document.querySelectorAll('.device-box').length;
  newBox.style.top = options.top || ((20 + count * 110) + 'px');
  newBox.style.left = options.left || '20px';
  
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
  
  if (isConfigurelayout)
  {
   makeDraggable(newBox);
   makeResizable(newBox);  
  }
  
  
  const interfaceClasses = deviceParams && deviceParams[device] && Array.isArray(deviceParams[device].interface_classes)
    ? deviceParams[device].interface_classes
    : [];
  const isDrivable = interfaceClasses.includes('Drivable');

  if (isSample_position_device) {
    if (labelDiv) labelDiv.textContent = 'current sample';
  } else if (labelDiv) {
    labelDiv.textContent = 'Val';
  }

  if (targetSpan) targetSpan.style.display = 'none';
  if (gasSpan) gasSpan.style.display = 'none';
  if (sep1) sep1.style.display = 'none';
  if (sep2) sep2.style.display = 'none';

  if (isDrivable && lowerDev.includes('massflow')) {
    if (labelDiv) labelDiv.textContent = 'Val / Target / Gas';
    if (targetSpan) targetSpan.style.display = 'inline';
    if (gasSpan) gasSpan.style.display = 'inline';
    if (sep1) sep1.style.display = 'inline';
    if (sep2) sep2.style.display = 'inline';
  } else if (isDrivable && (lowerDev.includes('backpress') || lowerDev.includes('temp'))) {
    if (labelDiv) labelDiv.textContent = 'Val / Target';
    if (targetSpan) targetSpan.style.display = 'inline';
    if (sep1) sep1.style.display = 'inline';
  }
  
  // Populate params/commands
  if (deviceParams && deviceParams[device]) {
    populateParamsForDevice(device, deviceParams[device], domId);
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
  console.log(valueData)
  // Create a separate draggable SVG icon for each valve (no box)
  Object.keys(valueData).forEach((fieldName, index) => {
       
      const lowerField = fieldName.toLowerCase();
      const isSwitch = lowerField.includes('switch');
      const isValve = lowerField.includes('valve') || fieldName.startsWith('V')|| fieldName.startsWith('C')|| fieldName.startsWith('H');
      
      
      
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
      valveIcon.style.zIndex = '20';
      if (isConfigurelayout) valveIcon.classList.add('configure-layout');
      
      // Image Container
      const imgContainer = document.createElement('div');
      imgContainer.id = `img-${valveDomId}`;
      imgContainer.style.cssText = 'width: 80px; height: 80px; position: relative;';
      
      if (isSwitch) {
        // Switch image - rotates based on position (circle with two separate arcs)
        const img = document.createElement('img');
        initializeSwitchSvgChoice(valveIcon);
        img.src = getSwitchSvgForState(valveIcon, false);

        img.style.cssText = 'width: 100%; height: 100%; object-fit: contain; transform: rotate(0deg); transition: transform 0.3s ease;';
        imgContainer.appendChild(img);
        
        // Click to toggle between position 0 and 1
        imgContainer.onclick = async () => {
          const data = latestValues[device];
          let currentValue = 0;
          if (data && data[paramName] && data[paramName].value && data[paramName].value[fieldName] !== undefined) {
            currentValue = data[paramName].value[fieldName];
          }
          currentValue = toNumeric(currentValue);
          const newValue = currentValue === 0 ? 1 : 0;
          if (!await confirmValveStateChange(device, fieldName, newValue, true)) {
            return;
          }
          setValveField(device, fieldName, newValue);
          updateSwitchRotation(imgContainer, newValue);
        };
      } else if (isValve) {
        initializeValveSvgChoices(valveIcon);
        // Valve image - SVG with two triangles pointing toward each other (touching at tips)
        const img = document.createElement('img');
        img.id = `valve-img-${valveDomId}`;
        img.src = getValveSvgForState(valveIcon, false);

        img.style.cssText = 'width: 100%; height: 100%; object-fit: contain;';
        imgContainer.appendChild(img);
        
        // Click to toggle valve ON/OFF
        imgContainer.onclick = async () => {
          const data = latestValues[device];
          let currentValue = 0;
          if (data && data[paramName] && data[paramName].value && data[paramName].value[fieldName] !== undefined) {
            currentValue = data[paramName].value[fieldName];
          }
          currentValue = toNumeric(currentValue);
          const newValue = currentValue === 1 ? 0 : 1;
          if (!await confirmValveStateChange(device, fieldName, newValue, false)) {
            return;
          }
          setValveField(device, fieldName, newValue);
          // Immediately update the visual
          updateValveImage(valveDomId, newValue);
        };
      }
      attachValveSvgPicker(valveIcon, isValve || isSwitch);
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
        if (isSwitch) {
          const switchImg = imgContainer.querySelector('img');
          if (switchImg) switchImg.style.transform = '';
          syncValveIconTransform(valveIcon);
        }
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

async function confirmValveStateChange(device, fieldName, newValue, isSwitch = false) {
  const action = Number(newValue) === 1 ? 'on' : 'off';
  const subject = isSwitch ? 'switch' : 'valve';
  const message = `Do you want to switch ${subject} ${fieldName} for ${device} ${action}?`;
  if (typeof AppUi !== 'undefined' && AppUi && typeof AppUi.showAppConfirm === 'function') {
    return !!(await AppUi.showAppConfirm(message, 'Confirm Valve Change'));
  }
  return window.confirm(message);
}

// update image after switch rotation
function updateSwitchRotation(imgContainer, position) {
  const img = imgContainer.querySelector('img');
  if (img) {
    imgContainer.dataset.switchPosition = String(position === 1 ? 1 : 0);
    try {
      const valveEl = img.closest('.valve-icon');
      if (valveEl) {
        img.src = getSwitchSvgForState(valveEl, position === 1);
        valveEl.dataset.open = position === 1 ? '1' : '0';
        img.style.transform = '';
        syncValveIconTransform(valveEl);
        return;
      }
    } catch (e) { /* ignore */ }
    const rotation = position * 90; // 0 or 90 degrees
    img.style.transform = `rotate(${rotation}deg)`;
  }
}

function updateValveImage(valveDomId, isOpen) {
  const img = document.querySelector(`#valve-img-${valveDomId}`);
  if (img) {
    try {
      const valveEl = img.closest('.valve-icon');
      if (valveEl) {
        img.src = getValveSvgForState(valveEl, !!isOpen);
        valveEl.dataset.open = isOpen ? '1' : '0';
      }
    } catch (e) { /* ignore */ }
  }
}

function hydrateValveIconState(valveIcon) {
  if (!valveIcon) return;

  const device = valveIcon.dataset.device || '';
  const fieldName = valveIcon.dataset.field || '';
  if (!device || !fieldName) return;

  const deviceEntry = latestValues && latestValues[device] ? latestValues[device] : null;
  let rawValue;
  if (deviceEntry && deviceEntry.value && deviceEntry.value.value && typeof deviceEntry.value.value[fieldName] !== 'undefined') {
    rawValue = deviceEntry.value.value[fieldName];
  } else if (deviceEntry && deviceEntry.target && deviceEntry.target.value && typeof deviceEntry.target.value[fieldName] !== 'undefined') {
    rawValue = deviceEntry.target.value[fieldName];
  }
  if (typeof rawValue === 'undefined') return;

  const normalizedValue = toNumeric(rawValue);
  const lowerField = fieldName.toLowerCase();
  const domId = `${deviceDomId(device)}_${fieldName}`;
  const imgContainer = document.getElementById(`img-${domId}`);

  if (lowerField.includes('switch')) {
    if (imgContainer) {
      updateSwitchRotation(imgContainer, normalizedValue);
    }
  } else {
    updateValveImage(domId, normalizedValue === 1);
  }

  valveIcon.dataset.open = normalizedValue === 1 ? '1' : '0';
}

function setupValveImageListeners(device, domId) {
  // Listen for updates and update image states
  window.addEventListener('spinupdate', function(event) {
    try {
      if (typeof window.isConfigurationModeActive === 'function' && window.isConfigurationModeActive()) {
        return;
      }
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

