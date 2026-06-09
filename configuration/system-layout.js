// ===== Decoration Logic =====
var AppState = window.SEAppState;
var AppUi = window.SEAppUi;
let selectedDeco = null;
let selectedTextDeco = null;
let selectedDecorationLine = null;
let selectedCanvasElement = null;
let canvasClipboard = null;
let lastCanvasPointer = { left: 200, top: 80 };
const DECORATION_LINE_MIN_LENGTH_PX = 38;
const SWITCH_SVG_DATA_URI = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI0IiBoZWlnaHQ9IjEwNiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTI0IiBoZWlnaHQ9IjEwNiIgZmlsbD0id2hpdGUiLz48ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSg2Miw1MykiPjxjaXJjbGUgY3g9IjAiIGN5PSIwIiByPSI0NSIgZmlsbD0id2hpdGUiIHN0cm9rZT0iIzMzMyIgc3Ryb2tlLXdpZHRoPSIzIi8+PHBhdGggZD0iTSAtNDQuMyA2LjcgQSA0NSA0NSAwIDAgMSAtNi43IDQ0LjMiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzMzMyIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48cGF0aCBkPSJNIDQ0LjMgLTYuNyBBIDQ1IDQ1IDAgMCAxIDYuNyAtNDQuMyIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMzMzIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvZz48L3N2Zz4=';

function areDecorationEditsEnabled() {
  return typeof window.isConfigurationModeActive === 'function'
    ? window.isConfigurationModeActive()
    : document.body.dataset.configurationMode === 'true';
}

function getSelectableCanvasElement(target) {
  if (!target || !target.closest) return null;
  const match = target.closest('.plot-panel, .deco-box, .valve-icon, .device-box');
  return match instanceof HTMLElement ? match : null;
}

function clearCanvasElementSelectionState(element) {
  if (!element) return;
  element.classList.remove('selected');
  if (selectedDeco === element) {
    selectedDeco = null;
  }
}

function setSelectedCanvasElement(element) {
  if (element && !areDecorationEditsEnabled()) {
    return;
  }

  if (selectedCanvasElement && selectedCanvasElement !== element) {
    if (selectedCanvasElement.classList.contains('deco-box')) {
      selectDeco(null);
    } else {
      clearCanvasElementSelectionState(selectedCanvasElement);
    }
  }

  selectedCanvasElement = element || null;

  if (!element) {
    if (selectedDeco) {
      selectDeco(null);
    }
    return;
  }

  if (typeof clearConnectionLineSelection === 'function') {
    clearConnectionLineSelection();
  }

  if (element.classList.contains('deco-box')) {
    selectDeco(element);
    return;
  }

  if (selectedDeco) {
    selectDeco(null);
  }
  element.classList.add('selected');
}

function updateLastCanvasPointer(event) {
  const grid = document.getElementById('device-grid');
  if (!grid || typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return;
  const rect = grid.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
    return;
  }
  const zoom = (typeof currentZoom === 'number' && isFinite(currentZoom) && currentZoom > 0) ? currentZoom : 1;
  lastCanvasPointer = {
    left: Math.max(0, Math.round((event.clientX - rect.left) / zoom)),
    top: Math.max(0, Math.round((event.clientY - rect.top) / zoom))
  };
}

function isShortcutInputTarget(target) {
  if (!target) return false;
  const tagName = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }
  return !!(target.closest && target.closest('input, textarea, select'));
}

function cloneClipboardNode(node) {
  return node && typeof node.cloneNode === 'function' ? node.cloneNode(true) : null;
}

function buildCanvasClipboard() {
  if (!selectedCanvasElement) return null;

  if (
    selectedCanvasElement.classList.contains('device-box') &&
    !selectedCanvasElement.classList.contains('plot-panel') &&
    selectedCanvasElement.dataset &&
    selectedCanvasElement.dataset.device
  ) {
    return {
      kind: 'device',
      device: selectedCanvasElement.dataset.device || '',
      width: selectedCanvasElement.style.width || '',
      height: selectedCanvasElement.style.height || '',
      bodyOpen: (() => {
        const rawId = typeof selectedCanvasElement.id === 'string' ? selectedCanvasElement.id : '';
        const domId = rawId.startsWith('box-') ? rawId.slice(4) : '';
        if (!domId) return false;
        const body = selectedCanvasElement.querySelector('#body-' + domId);
        return !!(body && body.style.display !== 'none');
      })()
    };
  }

  if (selectedCanvasElement.classList.contains('plot-panel')) {
    const layout = getCurrentLayoutData();
    const plotEntry = Array.isArray(layout.plots)
      ? layout.plots.find((plot) => plot && plot.id === selectedCanvasElement.id)
      : null;
    if (!plotEntry) return null;
    return {
      kind: 'plot',
      plot: JSON.parse(JSON.stringify(plotEntry))
    };
  }

  return {
    kind: 'dom',
    elementType: selectedCanvasElement.classList.contains('valve-icon')
      ? 'valve-icon'
      : selectedCanvasElement.classList.contains('deco-box')
        ? 'deco-box'
        : 'device-box',
    node: cloneClipboardNode(selectedCanvasElement)
  };
}

function remapElementAttributeValue(value, fromToken, toToken) {
  if (typeof value !== 'string' || !fromToken) return value;
  return value.split(fromToken).join(toToken);
}

function remapElementIdentifiers(root, fromToken, toToken) {
  if (!root || !fromToken || !toToken || fromToken === toToken) return;
  const attributesToPatch = ['id', 'for', 'list', 'aria-controls', 'aria-labelledby', 'onclick', 'onchange'];
  const elements = [root, ...root.querySelectorAll('*')];
  elements.forEach((element) => {
    attributesToPatch.forEach((attributeName) => {
      if (!element.hasAttribute || !element.hasAttribute(attributeName)) return;
      const currentValue = element.getAttribute(attributeName);
      const nextValue = remapElementAttributeValue(currentValue, fromToken, toToken);
      if (nextValue !== currentValue) {
        element.setAttribute(attributeName, nextValue);
      }
    });
  });
}

function makeUniqueClipboardToken(prefix) {
  const safePrefix = String(prefix || 'item').replace(/[^a-zA-Z0-9_-]+/g, '_');
  return `${safePrefix}_copy_${Date.now()}`;
}

function bindCloneRemoveButtons(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('.deco-remove').forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      const owner = button.closest('.device-box, .deco-box, .valve-icon');
      if (owner === selectedCanvasElement) {
        setSelectedCanvasElement(null);
      }
      if (owner) owner.remove();
      if (typeof refreshConnectionLines === 'function') {
        refreshConnectionLines();
      }
    };
  });
}

function prepareClonedCanvasElement(element) {
  if (!element) return null;

  element.classList.remove('selected');
  element.querySelectorAll('.selected').forEach((selectedNode) => {
    selectedNode.classList.remove('selected');
  });

  if (element.classList.contains('valve-icon')) {
    const oldToken = (element.id || 'icon').replace(/^icon-/, '');
    const newToken = makeUniqueClipboardToken(oldToken || 'valve');
    remapElementIdentifiers(element, oldToken, newToken);
    element.id = `icon-${newToken}`;
    return element;
  }

  if (element.classList.contains('device-box')) {
    const rawId = element.id || 'device';
    if (rawId.startsWith('box-')) {
      const oldToken = rawId.replace(/^box-/, '');
      const newToken = makeUniqueClipboardToken(oldToken || 'device');
      remapElementIdentifiers(element, oldToken, newToken);
      element.id = `box-${newToken}`;
    } else {
      element.id = makeUniqueClipboardToken(rawId);
    }
    return element;
  }

  if (element.classList.contains('deco-box')) {
    element.id = makeUniqueClipboardToken(element.id || 'deco');
  }

  return element;
}

function bindClonedCanvasElement(element) {
  if (!element) return;

  if (element.classList.contains('valve-icon')) {
    const imageContainer = element.querySelector('[id^="img-"]');
    if (typeof makeValveIconDraggable === 'function') {
      makeValveIconDraggable(element);
    }
    if (typeof makeValveIconResizable === 'function') {
      makeValveIconResizable(element, imageContainer);
    }
  } else {
    makeDraggable(element);
    makeResizable(element);
  }

  bindCloneRemoveButtons(element);

  if ((element.classList.contains('device-box') || element.classList.contains('valve-icon')) && window.Spin && typeof window.Spin.reload === 'function') {
    window.Spin.reload();
  }
}

function removeSelectedPlotPanel(element) {
  const plotsState = AppState && typeof AppState.ensurePlots === 'function'
    ? AppState.ensurePlots()
    : (AppState && typeof AppState.getPlots === 'function' ? AppState.getPlots() : null);
  const plotsMap = plotsState && plotsState.plotsMap ? plotsState.plotsMap : null;

  if (plotsMap) {
    Object.keys(plotsMap).forEach((key) => {
      const entry = plotsMap[key];
      if (!entry || entry.containerDiv !== element) return;
      try {
        if (entry.plotDiv) Plotly.purge(entry.plotDiv);
      } catch (e) {}
      delete plotsMap[key];
    });
  }

  if (element && element.parentNode) {
    element.parentNode.removeChild(element);
  }
}

function removeSelectedCanvasElement() {
  if (!selectedCanvasElement) return;
  if (selectedCanvasElement.classList.contains('plot-panel')) {
    removeSelectedPlotPanel(selectedCanvasElement);
  } else {
    selectedCanvasElement.remove();
  }
  setSelectedCanvasElement(null);
  if (typeof refreshConnectionLines === 'function') {
    refreshConnectionLines();
  }
}

function pasteCanvasClipboard() {
  if (!canvasClipboard || !areDecorationEditsEnabled()) return null;
  const grid = document.getElementById('device-grid');
  if (!grid) return null;

  if (canvasClipboard.kind === 'device') {
    const device = canvasClipboard.device;
    if (!device || typeof createDeviceDisplay !== 'function') return null;
    const pastedBox = createDeviceDisplay(true, {
      device,
      allowDuplicate: true,
      instanceDomId: makeUniqueClipboardToken(deviceDomId(device || 'device'))
    });
    if (!pastedBox) return null;
    pastedBox.style.left = `${lastCanvasPointer.left}px`;
    pastedBox.style.top = `${lastCanvasPointer.top}px`;
    if (canvasClipboard.width) pastedBox.style.width = canvasClipboard.width;
    if (canvasClipboard.height) pastedBox.style.height = canvasClipboard.height;
    if (canvasClipboard.bodyOpen) {
      const rawId = typeof pastedBox.id === 'string' ? pastedBox.id : '';
      const domId = rawId.startsWith('box-') ? rawId.slice(4) : '';
      if (domId && typeof toggleDeviceBody === 'function') {
        toggleDeviceBody(domId);
      }
    }
    setSelectedCanvasElement(pastedBox);
    if (typeof refreshConnectionLines === 'function') {
      refreshConnectionLines();
    }
    return pastedBox;
  }

  if (canvasClipboard.kind === 'plot') {
    const plotDef = JSON.parse(JSON.stringify(canvasClipboard.plot));
    plotDef.id = '';
    plotDef.left = `${lastCanvasPointer.left}px`;
    plotDef.top = `${lastCanvasPointer.top}px`;
    create_plot({ plots: [plotDef] }, true);
    const plots = grid.querySelectorAll('.plot-panel');
    const pastedPlot = plots.length ? plots[plots.length - 1] : null;
    if (pastedPlot) {
      pastedPlot.style.left = plotDef.left;
      pastedPlot.style.top = plotDef.top;
      setSelectedCanvasElement(pastedPlot);
    }
    if (typeof refreshConnectionLines === 'function') {
      refreshConnectionLines();
    }
    return pastedPlot;
  }

  const snapshot = cloneClipboardNode(canvasClipboard.node);
  if (!snapshot) return null;

  prepareClonedCanvasElement(snapshot);
  snapshot.style.left = `${lastCanvasPointer.left}px`;
  snapshot.style.top = `${lastCanvasPointer.top}px`;
  grid.appendChild(snapshot);
  bindClonedCanvasElement(snapshot);
  setSelectedCanvasElement(snapshot);
  if (typeof refreshConnectionLines === 'function') {
    refreshConnectionLines();
  }
  return snapshot;
}

function getDecorationLineType(box) {
  return (box && box.dataset && box.dataset.lineType) || 'solid';
}

function getDecorationLineWidth(box) {
  const value = parseFloat((box && box.dataset && box.dataset.lineWidth) || '2');
  return Number.isFinite(value) ? value : 2;
}

function getDecorationLineColor(box) {
  return (box && box.dataset && box.dataset.lineColor) || '#007bff';
}

function getDecorationLineRotationDegrees(box) {
  const value = parseFloat((box && box.dataset && box.dataset.rotationDegrees) || '0');
  return Number.isFinite(value) ? value : 0;
}

function getDecorationSwitchRotationDegrees(box) {
  const value = parseFloat((box && box.dataset && box.dataset.rotationDegrees) || '0');
  return Number.isFinite(value) ? value : 0;
}

function applyDecorationSwitchRotation(box, degrees) {
  if (!box) return;
  const img = box.querySelector('.deco-visual img');
  if (!img) return;

  const parsedDegrees = parseFloat(degrees);
  const rotationDegrees = Number.isFinite(parsedDegrees) ? parsedDegrees : 0;
  box.dataset.rotationDegrees = String(rotationDegrees);
  img.style.transform = `rotate(${rotationDegrees}deg)`;
}

function rotateDecorationSwitch(box, deltaDegrees) {
  applyDecorationSwitchRotation(box, getDecorationSwitchRotationDegrees(box) + deltaDegrees);
}

function applyDecorationLineRotation(box, degrees) {
  if (!box) return;
  const visual = box.querySelector('.deco-visual');
  if (!visual) return;

  const parsedDegrees = parseFloat(degrees);
  const rotationDegrees = Number.isFinite(parsedDegrees) ? parsedDegrees : 0;
  box.dataset.rotationDegrees = String(rotationDegrees);
  visual.style.transform = `translateY(-50%) rotate(${rotationDegrees}deg)`;
}

function applyDecorationLineStyle(box, style = {}) {
  if (!box) return;
  const visual = box.querySelector('.deco-visual');
  if (!visual) return;

  const lineColor = style.lineColor || getDecorationLineColor(box);
  const lineWidth = style.lineWidth || getDecorationLineWidth(box);
  const lineType = style.lineType || getDecorationLineType(box);

  box.dataset.lineColor = lineColor;
  box.dataset.lineWidth = String(lineWidth);
  box.dataset.lineType = lineType;

  visual.style.height = '0';
  visual.style.backgroundColor = 'transparent';
  visual.style.borderTop = `${lineWidth}px ${lineType} ${lineColor}`;
  visual.style.top = '50%';
  visual.style.width = '100%';
  visual.style.left = '0';
  visual.style.borderRadius = `${Math.max(1, Number(lineWidth))}px`;

  applyDecorationLineRotation(box, getDecorationLineRotationDegrees(box));
}

function clearDecorationLineSelection() {
  selectedDecorationLine = null;
}

function showDecorationLineContextMenu(box, clientX, clientY) {
  const menu = document.getElementById('context-menu');
  const colorPicker = document.getElementById('line-color-picker');
  if (!menu || !box) return;

  selectedDecorationLine = box;
  selectDeco(box);
  menu.style.display = 'block';
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;

  if (typeof hideLineSubmenus === 'function') {
    hideLineSubmenus();
  }
  if (colorPicker) {
    colorPicker.value = getDecorationLineColor(box);
  }
}

function hideDecorationLineContextMenu() {
  const menu = document.getElementById('context-menu');
  if (!menu) return;
  menu.style.display = 'none';
  if (typeof hideLineSubmenus === 'function') {
    hideLineSubmenus();
  }
}

function setupDecorationLineContextMenu() {
  const menu = document.getElementById('context-menu');
  if (!menu || menu.dataset.decorationLineMenuReady === 'true') return;

  menu.dataset.decorationLineMenuReady = 'true';

  document.addEventListener('mousedown', (event) => {
    const lineBox = event.target && event.target.closest ? event.target.closest('.deco-type-line') : null;
    if (lineBox) {
      selectedDecorationLine = lineBox;
      return;
    }

    if (!menu.contains(event.target)) {
      clearDecorationLineSelection();
    }
  });

  document.addEventListener('contextmenu', (event) => {
    const lineBox = event.target && event.target.closest ? event.target.closest('.deco-type-line') : null;
    if (!lineBox) {
      return;
    }

    event.preventDefault();
    showDecorationLineContextMenu(lineBox, event.clientX, event.clientY);
  });

  menu.querySelectorAll('.line-width-option').forEach((button) => {
    if (button.dataset.decorationLineReady === 'true') return;
    button.dataset.decorationLineReady = 'true';
    button.addEventListener('click', () => {
      if (!selectedDecorationLine) return;
      applyDecorationLineStyle(selectedDecorationLine, { lineWidth: button.dataset.lineWidth });
      hideDecorationLineContextMenu();
    });
  });

  menu.querySelectorAll('.line-type-option').forEach((button) => {
    if (button.dataset.decorationLineReady === 'true') return;
    button.dataset.decorationLineReady = 'true';
    button.addEventListener('click', () => {
      if (!selectedDecorationLine) return;
      applyDecorationLineStyle(selectedDecorationLine, { lineType: button.dataset.lineType });
      hideDecorationLineContextMenu();
    });
  });

  const colorPicker = document.getElementById('line-color-picker');
  if (colorPicker && colorPicker.dataset.decorationLineReady !== 'true') {
    colorPicker.dataset.decorationLineReady = 'true';
    colorPicker.addEventListener('input', () => {
      if (!selectedDecorationLine) return;
      applyDecorationLineStyle(selectedDecorationLine, { lineColor: colorPicker.value });
    });
    colorPicker.addEventListener('change', () => {
      if (!selectedDecorationLine) return;
      hideDecorationLineContextMenu();
    });
  }

  const rotationAction = document.getElementById('line-rotation-action');
  if (rotationAction && rotationAction.dataset.decorationLineRotationReady !== 'true') {
    rotationAction.dataset.decorationLineRotationReady = 'true';
    rotationAction.addEventListener('click', async () => {
      const targetLine = selectedDecorationLine;
      if (!targetLine) return;

      hideDecorationLineContextMenu();
      const response = await AppUi.showAppPrompt('Enter line rotation in degrees', String(getDecorationLineRotationDegrees(targetLine)), 'Rotate Line');
      if (response === null) return;

      const nextDegrees = parseFloat(String(response).trim());
      if (!Number.isFinite(nextDegrees)) {
        await AppUi.showAppAlert('Please enter a valid number of degrees.', 'Rotate Line');
        return;
      }

      applyDecorationLineRotation(targetLine, nextDegrees);
    });
  }
}

function getLabelTextNode(el) {
  return Array.from(el.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
}

function hideTextContextMenu() {
  const menu = document.getElementById('text-context-menu');
  if (!menu) return;
  menu.style.display = 'none';
  selectedTextDeco = null;
}

function syncTextContextMenuInputs(el) {
  const fontFamilySelect = document.getElementById('text-font-family');
  const fontSizeSelect = document.getElementById('text-font-size');
  const colorInput = document.getElementById('text-font-color');
  if (!el || !fontFamilySelect || !fontSizeSelect || !colorInput) {
    return;
  }

  const style = window.getComputedStyle(el);
  const fontFamily = el.style.fontFamily || style.fontFamily;
  const fontSize = el.style.fontSize || style.fontSize;
  const color = rgbToHex(el.style.color || style.color) || '#333333';

  fontFamilySelect.value = fontFamilySelect.querySelector(`option[value="${fontFamily}"]`) ? fontFamily : 'Arial, sans-serif';
  fontSizeSelect.value = fontSizeSelect.querySelector(`option[value="${fontSize}"]`) ? fontSize : '16px';
  colorInput.value = color;
}

function applyTextStyleToSelectedDeco(styleUpdates) {
  if (!selectedTextDeco) return;
  if (styleUpdates.fontFamily) selectedTextDeco.style.fontFamily = styleUpdates.fontFamily;
  if (styleUpdates.fontSize) selectedTextDeco.style.fontSize = styleUpdates.fontSize;
  if (styleUpdates.color) selectedTextDeco.style.color = styleUpdates.color;
}

function showTextContextMenu(el, clientX, clientY) {
  const menu = document.getElementById('text-context-menu');
  if (!menu || !el) return;

  selectedTextDeco = el;
  syncTextContextMenuInputs(el);
  menu.style.display = 'block';
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;
}

function setupTextContextMenu() {
  const menu = document.getElementById('text-context-menu');
  if (!menu || menu.dataset.textMenuReady === 'true') return;

  menu.dataset.textMenuReady = 'true';

  document.addEventListener('contextmenu', (event) => {
    const label = event.target && event.target.closest ? event.target.closest('.deco-label') : null;
    if (!label) {
      hideTextContextMenu();
      return;
    }

    event.preventDefault();
    selectDeco(label);
    showTextContextMenu(label, event.clientX, event.clientY);
  });

  document.addEventListener('mousedown', (event) => {
    if (menu.contains(event.target)) return;
    hideTextContextMenu();
  });

  const fontFamilySelect = document.getElementById('text-font-family');
  const fontSizeSelect = document.getElementById('text-font-size');
  const colorInput = document.getElementById('text-font-color');

  if (fontFamilySelect) {
    fontFamilySelect.addEventListener('change', () => {
      applyTextStyleToSelectedDeco({ fontFamily: fontFamilySelect.value });
    });
  }

  if (fontSizeSelect) {
    fontSizeSelect.addEventListener('change', () => {
      applyTextStyleToSelectedDeco({ fontSize: fontSizeSelect.value });
    });
  }

  if (colorInput) {
    colorInput.addEventListener('input', () => {
      applyTextStyleToSelectedDeco({ color: colorInput.value });
    });
  }
}

function selectDeco(el) {
  if (el && !areDecorationEditsEnabled()) {
    return;
  }
  if (selectedDeco) selectedDeco.classList.remove('selected');
  selectedDeco = el;
  if (el) {
    // mark selected visually
    el.classList.add('selected');
    // Sync color picker
    const picker = document.getElementById('deco-color');
    if (picker) {
      let color;
      if (el.dataset.type === 'label') 
      {
        color = el.style.color;
      } 
      else if (el.dataset.type === 'line') 
      {
        color = getDecorationLineColor(el);
      } 
      else 
      {
        const visual = el.querySelector('.deco-visual');
        if (visual) color = visual.style.backgroundColor;
      }
      if (color) 
        {
        if (color.startsWith('#')) 
          {
          picker.value = color;
          } 
        else 
        {
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
      updateLastCanvasPointer(e);
      const selectedElement = getSelectableCanvasElement(e.target);
      if (selectedElement) {
        setSelectedCanvasElement(selectedElement);
      } else if (e.target === grid) {
        setSelectedCanvasElement(null);
      }
    });
    grid.addEventListener('mousemove', updateLastCanvasPointer);
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
        setSelectedCanvasElement(box);
      }
    };
  }
    
    const picker = document.getElementById('deco-color');
    if (picker) {
        picker.addEventListener('input', (e) => {
            if (selectedDeco) {
                const color = e.target.value;
                if (selectedDeco.dataset.type === 'label') {
                    selectedDeco.style.color = color;
               } 
                else if (selectedDeco.dataset.type === 'line') 
                {
                applyDecorationLineStyle(selectedDeco, { lineColor: color });
                } else {
                    const visual = selectedDeco.querySelector('.deco-visual');
                    if (visual) visual.style.backgroundColor = color;
                }
            }
        });
    }

    document.addEventListener('keydown', (event) => {
      if (!areDecorationEditsEnabled()) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isShortcutInputTarget(event.target)) return;

      const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
      if (key === 'c') {
        const clipboard = buildCanvasClipboard();
        if (!clipboard) return;
        canvasClipboard = clipboard;
        event.preventDefault();
        return;
      }

      if (key === 'x') {
        const clipboard = buildCanvasClipboard();
        if (!clipboard) return;
        canvasClipboard = clipboard;
        removeSelectedCanvasElement();
        event.preventDefault();
        return;
      }

      if (key === 'v') {
        if (!canvasClipboard) return;
        pasteCanvasClipboard();
        event.preventDefault();
      }
    });
});

  document.addEventListener('DOMContentLoaded', () => {
    setupTextContextMenu();
    setupDecorationLineContextMenu();
  }, { once: true });

function makeDraggable(el) 
{

  let isDragging = false;
  let isResizing = false;
  let startX, startY, initialLeft, initialTop, initialWidth, initialHeight;

  // Make the whole element draggable on mousedown (simple, immediate behavior)
  el.addEventListener('mousedown', (e) => {
    if (el.classList && el.classList.contains('plot-panel') && typeof window.isConfigurationModeActive === 'function' && !window.isConfigurationModeActive()) {
      return;
    }
    
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
    } 
    catch (err) 
    { /* ignore */ }

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
      if (el.classList && el.classList.contains('plot-panel') && typeof window.isConfigurationModeActive === 'function' && !window.isConfigurationModeActive()) {
        return;
      }
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
      if (el.classList && el.classList.contains('plot-panel') && typeof window.isConfigurationModeActive === 'function' && !window.isConfigurationModeActive()) {
        isResizing = false;
        return;
      }
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

  const isLineDecoration = el.dataset.type === 'line';
  if (isLineDecoration) {
    resizeHandle.style.right = '-6px';
    resizeHandle.style.bottom = '50%';
    resizeHandle.style.transform = 'translateY(50%)';
    resizeHandle.style.cursor = 'ew-resize';
  }
  
  let isResizing = false;
  let startX, startY, initialWidth, initialHeight;
  
  resizeHandle.addEventListener('mousedown', (e) => {
    if (el.classList && el.classList.contains('plot-panel') && typeof window.isConfigurationModeActive === 'function' && !window.isConfigurationModeActive()) {
      return;
    }
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
    if (el.classList && el.classList.contains('plot-panel') && typeof window.isConfigurationModeActive === 'function' && !window.isConfigurationModeActive()) {
      isResizing = false;
      return;
    }
    e.preventDefault();
    
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (isLineDecoration) {
      el.style.width = `${Math.max(DECORATION_LINE_MIN_LENGTH_PX, initialWidth + dx)}px`;
      el.style.height = `${Math.max(12, initialHeight + dy)}px`;
      return;
    }

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
      if (!areDecorationEditsEnabled()) return;
      e.stopPropagation();
      selectDeco(wrapper);
  });

  wrapper.addEventListener('click', (e) => {
    if (wrapper.dataset.type !== 'switch') return;
    e.preventDefault();
    e.stopPropagation();
    rotateDecorationSwitch(wrapper, 90);
  });

  if (type === 'line')
  {
    wrapper.classList.add('deco-type-line');
    wrapper.style.width = '120px';
    wrapper.style.height = '12px';
    wrapper.style.minWidth = '1cm';
    wrapper.style.minHeight = '12px';

    const visual = document.createElement('div');
    visual.className = 'deco-visual';
    wrapper.appendChild(visual);
    applyDecorationLineStyle(wrapper, {
      lineColor: color,
      lineWidth: 2,
      lineType: 'solid'
    });
  }

  else if (type === 'switch')
  {
    wrapper.classList.add('deco-type-switch');
    wrapper.style.width = '80px';
    wrapper.style.height = '80px';
    wrapper.style.minWidth = '40px';
    wrapper.style.minHeight = '40px';

    const visual = document.createElement('div');
    visual.className = 'deco-visual';
    const img = document.createElement('img');
    img.src = SWITCH_SVG_DATA_URI;
    img.alt = 'Valve switch';
    visual.appendChild(img);
    wrapper.appendChild(visual);
    applyDecorationSwitchRotation(wrapper, 0);
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
    wrapper.style.fontFamily = 'Arial, sans-serif';
    wrapper.style.fontSize = '16px';
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
  const deviceParams = AppState.getDeviceParams();
  const runtimeInfo = deviceParams && deviceParams[device] ? deviceParams[device] : null;
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
      const confirmed = await AppUi.showAppConfirm(`Execute command '${cmd}' on ${device}?`, 'Execute Command');
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
        const manual = await AppUi.showAppPrompt(
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
            await AppUi.showAppAlert('Command sent via proxy. Response: ' + (sr.response || ''), 'Command Sent');
            return;
          }

          // If backend reports an error (e.g., ProtocolError or error__scan), retry
          const textBody = JSON.stringify(sr || '');
          const isProtocolError = textBody.includes('ProtocolError') || textBody.includes('error__scan') || (sr && sr.status === 'error');
          if (!isProtocolError) {
            // Unknown non-retryable response — show it and stop
            await AppUi.showAppAlert('Proxy response: ' + textBody, 'Command Response');
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
      await AppUi.showAppAlert('Failed to send command after ' + maxRetries + ' attempts. Last response: ' + JSON.stringify(lastResp), 'Command Failed');

    } catch (e) {
      console.error('sendCommand failed', e);
      await AppUi.showAppAlert('Failed to send command: ' + e, 'Command Failed');
    }
  })();
}


// Cache values for extra panel
window.addEventListener('spinupdate', function(event) {
  try {
    if (typeof window.isConfigurationModeActive === 'function' && window.isConfigurationModeActive()) {
      return;
    }
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

function focusViewportOnLayoutContent() {
  const viewport = document.getElementById('viewport');
  const grid = document.getElementById('device-grid');
  if (!viewport || !grid) return;

  const elements = Array.from(grid.querySelectorAll('.device-box, .deco-box, .valve-icon, .plot-panel'));
  if (!elements.length) return;

  let minLeft = Number.POSITIVE_INFINITY;
  let minTop = Number.POSITIVE_INFINITY;

  elements.forEach((element) => {
    if (!(element instanceof HTMLElement)) return;
    const left = Number.isFinite(element.offsetLeft) ? element.offsetLeft : parseFloat(element.style.left || '0');
    const top = Number.isFinite(element.offsetTop) ? element.offsetTop : parseFloat(element.style.top || '0');
    if (Number.isFinite(left)) minLeft = Math.min(minLeft, left);
    if (Number.isFinite(top)) minTop = Math.min(minTop, top);
  });

  if (!Number.isFinite(minLeft) || !Number.isFinite(minTop)) return;

  viewport.scrollLeft = Math.max(0, minLeft - 40);
  viewport.scrollTop = Math.max(0, minTop - 40);
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

function getLayoutApiBase() {
  return typeof API_BASE !== 'undefined'
    ? API_BASE
    : `${window.location.protocol}//${window.location.hostname}:8001`;
}

async function waitForLayoutDeviceOptions(timeoutMs = 5000) {
  const startedAt = Date.now();

  try {
    if (typeof fetchDeviceParams === 'function') {
      fetchDeviceParams();
    }
  } catch (e) {
    console.error('Failed to request device params before layout render', e);
  }

  while ((Date.now() - startedAt) < timeoutMs) {
    const select = document.getElementById('device-select');
    const deviceParams = AppState && typeof AppState.getDeviceParams === 'function'
      ? AppState.getDeviceParams()
      : null;
    const hasOptions = !!(select && select.options && select.options.length > 1);
    const hasParams = !!(deviceParams && Object.keys(deviceParams).length > 0);

    if (hasOptions || hasParams) {
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return false;
}

async function hydrateDeviceMetadataFromStaticFile() {
  try {
    const response = await fetch('./c/device_params.json', { method: 'GET', cache: 'no-store' });
    if (!response.ok) return false;
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0) {
      return false;
    }
    if (AppState && typeof AppState.setDeviceParams === 'function') {
      AppState.setDeviceParams(data);
    }
    if (typeof populateDeviceList === 'function') {
      populateDeviceList(data);
    }
    return true;
  } catch (e) {
    console.error('Failed to hydrate device metadata from static file', e);
    return false;
  }
}

function hydrateDeviceMetadataFromLayout(layout) {
  if (!layout || !Array.isArray(layout.devices) || layout.devices.length === 0) {
    return false;
  }

  const currentParams = AppState && typeof AppState.getDeviceParams === 'function'
    ? (AppState.getDeviceParams() || {})
    : {};
  const mergedParams = Object.assign({}, currentParams);
  let addedCount = 0;

  layout.devices.forEach((deviceEntry) => {
    const key = deviceEntry && (deviceEntry.logicalName || deviceEntry.device);
    if (!key || mergedParams[key]) return;

    const info = Object.assign({}, deviceEntry.info || {});
    if (!info.original_name && deviceEntry.device) info.original_name = deviceEntry.device;
    if (!info.module_name && deviceEntry.device) info.module_name = deviceEntry.device;
    if (!Array.isArray(info.interface_classes)) info.interface_classes = [];
    if (!Array.isArray(info.params)) info.params = [];
    if (!Array.isArray(info.all_params)) info.all_params = info.params.slice();
    if (!Array.isArray(info.commands)) info.commands = [];
    if (!Array.isArray(info.param_info)) info.param_info = [];
    mergedParams[key] = info;
    addedCount += 1;
  });

  if (!addedCount) return false;

  if (AppState && typeof AppState.setDeviceParams === 'function') {
    AppState.setDeviceParams(mergedParams);
  }
  if (typeof populateDeviceList === 'function') {
    populateDeviceList(mergedParams);
  }
  return true;
}

function getPendingLayoutRenderMode() {
  try {
    return sessionStorage.getItem('pendingLayoutRenderMode') || 'configure';
  } catch (e) {
    return 'configure';
  }
}

function setPendingLayoutRenderMode(isConfigure) {
  try {
    sessionStorage.setItem('pendingLayoutRenderMode', isConfigure ? 'configure' : 'connect');
  } catch (e) {
    console.error('Failed to store pending layout mode', e);
  }
}

async function renderServerLayout(layout) {
  if (!layout) return;
  hydrateDeviceMetadataFromLayout(layout);
  const hasInitialOptions = (() => {
    const select = document.getElementById('device-select');
    return !!(select && select.options && select.options.length > 1);
  })();
  const hasInitialParams = !!(AppState && typeof AppState.getDeviceParams === 'function' && AppState.getDeviceParams() && Object.keys(AppState.getDeviceParams()).length > 0);
  if (!hasInitialOptions && !hasInitialParams) {
    await hydrateDeviceMetadataFromStaticFile();
  }
  try {
    if (typeof fetchDeviceParams === 'function') {
      fetchDeviceParams();
    }
  } catch (e) {
    console.error('Failed to refresh device params during layout render', e);
  }
  hydrateDeviceMetadataFromLayout(layout);
  if (getPendingLayoutRenderMode() === 'connect') {
    connect_to_system(layout);
  } else {
    applyLayout(layout);
  }
}

function populateLayoutSelectWithNames(names) {
  const select = document.getElementById('layout-select');
  if (!select) return;

  while (select.options.length > 1) select.remove(1);

  Array.from(new Set(names || [])).sort().forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.text = name;
    select.add(option);
  });
}

async function fetchServerLayoutNamesHttp() {
  const resp = await fetch(`${getLayoutApiBase()}/api/layouts`, {
    method: 'GET',
    cache: 'no-store'
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const payload = await resp.json();
  if (!payload || payload.status !== 'ok' || !Array.isArray(payload.names)) {
    throw new Error('Invalid layout list response');
  }
  return payload.names;
}

async function fetchServerLayoutHttp(name) {
  const resp = await fetch(`${getLayoutApiBase()}/api/layouts/${encodeURIComponent(name)}`, {
    method: 'GET',
    cache: 'no-store'
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const payload = await resp.json();
  if (!payload || payload.status !== 'ok') {
    throw new Error('Invalid layout payload');
  }
  return payload.layout || null;
}

async function updateLayoutList() {
  const select = document.getElementById('layout-select');
  if (!select) return;

  const layouts = getStoredLayouts();
  populateLayoutSelectWithNames(Object.keys(layouts));

  // Request server-side layouts via Spin when available.
  if (window.Spin && window.Spin.send_request) {
    try {
      window.Spin.send_request('nodemanager.list_layouts', '', 'read', 'read', null);
    } catch (e) {
      console.error('list_layouts request failed', e);
    }
  }

  // Also fetch the list over HTTP so fresh remote browsers can populate the dropdown
  // even when they have no local cache or the Spin response arrives late.
  try {
    const serverNames = await fetchServerLayoutNamesHttp();
    populateLayoutSelectWithNames([...Object.keys(layouts), ...serverNames]);
  } catch (e) {
    console.error('HTTP layout list request failed', e);
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

async function loadSelectedLayout() {
  const select = document.getElementById('layout-select');
  const name = select.value;
  if (!name) {
    alert('Please select a layout preset.');
    return;
  }
  
  const layouts = getStoredLayouts();
  if (layouts[name]) {
    sessionStorage.setItem('selectedLayout', name);
    setPendingLayoutRenderMode(true);
    await renderServerLayout(layouts[name]);
  } else {
    try {
      const layout = await fetchServerLayoutHttp(name);
      if (!layout) {
        alert('Layout not found.');
        return;
      }
      sessionStorage.setItem('selectedLayout', name);
      setPendingLayoutRenderMode(true);
      await renderServerLayout(layout);
    } catch (e) {
      alert('Failed to load layout from server.');
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
  const deviceKey = box.dataset && box.dataset.device
    ? box.dataset.device
    : box.id.replace(/^box-/, '');
  const logicalName = deviceKey;
    const deviceParams = AppState.getDeviceParams();
    // Get device info from runtime metadata if available
    let deviceInfo = {};
    if (deviceParams && deviceParams[deviceKey]) {
      deviceInfo = deviceParams[deviceKey];
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
      deviceKey: deviceKey,
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
    const plotsState = AppState.getPlots();
    const plotsMap = plotsState && plotsState.plotsMap ? plotsState.plotsMap : null;
    document.querySelectorAll('.plot-panel').forEach(box => {
      const plotId = box.id || null; // e.g., 'plot_1_panel'
      const titleEl = box.querySelector('.plot-title-label');
      const title = titleEl ? titleEl.textContent : (box.querySelector('.plot-header strong') ? box.querySelector('.plot-header strong').textContent : '');
      // find traces from plotsMap if available
      let traces = [];
      let configName = '';
      let xAxisTitle = '';
      let yAxisTitle = '';
      let geometry = null;
      if (plotsMap) {
        Object.keys(plotsMap).forEach(pid => {
          const p = plotsMap[pid];
          try {
            if (p && p.containerDiv && p.containerDiv.id === plotId) {
              traces = Object.keys(p.traces || {}).map(k => k);
              configName = p.configName || '';
              xAxisTitle = p.xAxisTitle || '';
              yAxisTitle = p.yAxisTitle || '';
              if (typeof plotsState.capturePlotPanelGeometry === 'function') {
                geometry = plotsState.capturePlotPanelGeometry(p);
              }
            }
          } catch (e) { }
        });
      }
      // compute fallback from bounding rect relative to device-grid
      const rect = box.getBoundingClientRect();
      const leftVal = geometry && geometry.left ? geometry.left : (box.style.left && box.style.left.trim() ? box.style.left : Math.round(rect.left - gridRect.left) + 'px');
      const topVal = geometry && geometry.top ? geometry.top : (box.style.top && box.style.top.trim() ? box.style.top : Math.round(rect.top - gridRect.top) + 'px');
      const widthVal = geometry && geometry.width ? geometry.width : (box.style.width && box.style.width.trim() ? box.style.width : Math.round(rect.width) + 'px');
      const heightVal = geometry && geometry.height ? geometry.height : (box.style.height && box.style.height.trim() ? box.style.height : Math.round(rect.height) + 'px');

      layout.plots.push({
        id: plotId,
        title: title,
        configName: configName,
        xAxisTitle: xAxisTitle,
        yAxisTitle: yAxisTitle,
        left: leftVal,
        top: topVal,
        width: widthVal,
        height: heightVal,
        transform: geometry && geometry.transform ? geometry.transform : (box.style.transform || ''),
        zIndex: geometry && geometry.zIndex ? geometry.zIndex : (box.style.zIndex || ''),
        dataX: geometry && geometry.dataX ? geometry.dataX : (box.getAttribute('data-x') || ''),
        dataY: geometry && geometry.dataY ? geometry.dataY : (box.getAttribute('data-y') || ''),
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
        height: icon.style.height,
        rotationDegrees: icon.dataset.rotationDegrees || '0',
        closedSvg: icon.dataset.closedSvg || '',
        openSvg: icon.dataset.openSvg || '',
        switchSvg: icon.dataset.switchSvg || '',
        switchClosedSvg: icon.dataset.switchClosedSvg || '',
        switchOpenSvg: icon.dataset.switchOpenSvg || ''
      });
    }
  });
  // Saved valveIcons information
  
  // Save Decorations
  document.querySelectorAll('.deco-box').forEach(box => {
    const type = box.dataset.type;
    let color = '';
    let text = '';
    let fontFamily = '';
    let fontSize = '';
    
    if (type === 'label') {
      const computed = window.getComputedStyle(box);
      color = box.style.color || computed.color;
      fontFamily = box.style.fontFamily || computed.fontFamily;
      fontSize = box.style.fontSize || computed.fontSize;
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
      text: text,
      fontFamily: fontFamily,
      fontSize: fontSize,
      lineColor: type === 'line' ? getDecorationLineColor(box) : '',
      lineWidth: type === 'line' ? String(getDecorationLineWidth(box)) : '',
      lineType: type === 'line' ? getDecorationLineType(box) : '',
      rotationDegrees: (type === 'line' || type === 'switch') ? String(box.dataset.rotationDegrees || '0') : ''
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
      const savedDeviceKey = d.deviceKey || d.logicalName;
      // Try to match by logicalName first
      let match = availableDevices.find(dev => dev === savedDeviceKey);
      if (!match) match = availableDevices.find(dev => dev === d.logicalName);
      // If not found, try by device title
      if (!match) match = availableDevices.find(dev => dev === d.device);
      const deviceParams = AppState.getDeviceParams();
      // If still not found, try by original_name in runtime metadata
      if (!match && deviceParams) {
        match = availableDevices.find(dev => {
          const info = deviceParams[dev];
          return info && info.original_name === d.device;
        });
      }
      if (match) 
        {
        const savedDomId = d.id && d.id.startsWith('box-') ? d.id.slice(4) : (d.id || deviceDomId(match));
        dev_box = createDeviceDisplay(false, {
          device: match,
          allowDuplicate: true,
          instanceDomId: savedDomId
        });
         
        // This creates it at default pos
        const newBox = dev_box || document.getElementById(d.id || `box-${savedDomId}`);
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
  requestAnimationFrame(focusViewportOnLayoutContent);
  requestAnimationFrame(focusViewportOnLayoutContent);
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
      const savedDeviceKey = d.deviceKey || d.logicalName;
      // Try to match by logicalName first
      let match = availableDevices.find(dev => dev === savedDeviceKey);
      if (!match) match = availableDevices.find(dev => dev === d.logicalName);
      // If not found, try by device title
      if (!match) match = availableDevices.find(dev => dev === d.device);
      const deviceParams = AppState.getDeviceParams();
      // If still not found, try by original_name in runtime metadata
      if (!match && deviceParams) {
        match = availableDevices.find(dev => {
          const info = deviceParams[dev];
          return info && info.original_name === d.device;
        });
      }
      if (match) 
        {
        const savedDomId = d.id && d.id.startsWith('box-') ? d.id.slice(4) : (d.id || deviceDomId(match));
        dev_block = createDeviceDisplay(isConfigurelayout, {
          device: match,
          allowDuplicate: true,
          instanceDomId: savedDomId
        });
        // This creates it at default pos
        const newBox = dev_block || document.getElementById(d.id || `box-${savedDomId}`);
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
      const plotsState = AppState.ensurePlots();
      layout.plots.forEach(p => {
      try {
          if (typeof plotsState.restorePlotPanelFromLayout === 'function') {
            plotsState.restorePlotPanelFromLayout(p, isconfigure_layout);
            return;
          }

          const grid = document.getElementById('device-grid');
          if (!grid) return;
          const container = document.createElement('div');
          container.className = 'device-box plot-panel';
          container.id = p.id || ('restored_plot_' + AppState.nextPlotRestoreCounter() + '_panel');
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
          plotDiv.id = (container.id ? container.id + '_plot' : ('restored_plot_' + plotsState._restoreCounter + '_plot'));
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

          const newKey = 'restored_plot_' + AppState.nextPlotRestoreCounter();
          const plotEntry = { id: newKey, containerDiv: container, plotDiv: plotDiv, traces: {}, configName: p.configName || p.title || '' };
          if (Array.isArray(p.traces)) {
            p.traces.forEach(tkey => {
              const trace = { x: [], y: [], mode: 'lines+markers', name: tkey };
              plotEntry.traces[tkey] = { traceObj: trace, suffix: tkey, _traceIndex: undefined, _lastSent: 0 };
            });
          }
          plotsState.plotsMap[newKey] = plotEntry;

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
              if (d.type === 'label') {
                if (d.color) newBox.style.color = d.color;
                if (d.fontFamily) newBox.style.fontFamily = d.fontFamily;
                if (d.fontSize) newBox.style.fontSize = d.fontSize;
              } else if (d.type === 'line') {
                applyDecorationLineStyle(newBox, {
                  lineColor: d.lineColor || d.color || '#007bff',
                  lineWidth: d.lineWidth || '2',
                  lineType: d.lineType || 'solid'
                });
                applyDecorationLineRotation(newBox, d.rotationDegrees || '0');
              } else if (d.type === 'switch') {
                applyDecorationSwitchRotation(newBox, d.rotationDegrees || '0');
              }
              
              if (d.type === 'label' && d.text) {
                const textNode = getLabelTextNode(newBox);
                if (textNode) {
                  textNode.textContent = d.text;
                }
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
          const deviceParams = AppState.getDeviceParams();
          // 2) try matching by original_name in runtime metadata
          if (!found && deviceParams) {
            found = availableDevices.find(dev => {
              const info = deviceParams[dev];
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
        valveIcon.style.zIndex = '20';
        if (isconfigure_layout) valveIcon.classList.add('configure-layout');
       
        
        // Image container
        const imgContainer = document.createElement('div');
        imgContainer.id = `img-${valveDomId}`;
        
        imgContainer.style.width = iconDef.width;
        imgContainer.style.height = iconDef.height;

        const lowerField = (fieldName || '').toLowerCase();
        const isSwitch = lowerField.includes('switch');
        const isValve = lowerField.includes('valve') || (fieldName && fieldName.startsWith('V'));

        if (isValve) {
          initializeValveSvgChoices(valveIcon, {
            closedSvg: iconDef.closedSvg,
            openSvg: iconDef.openSvg,
          });
        } else if (isSwitch) {
          initializeSwitchSvgChoice(valveIcon, {
            switchSvg: iconDef.switchSvg,
            closedSvg: iconDef.switchClosedSvg,
            openSvg: iconDef.switchOpenSvg,
          });
        }

        // Create img element similar to setupValveController
        const img = document.createElement('img');
        img.style.cssText = 'width: 100%; height: 100%; object-fit: contain;';
        if (isSwitch) img.style.transform = 'rotate(0deg)';
        // Default to closed appearance
        img.src = isValve ? getValveSvgForState(valveIcon, false) : getSwitchSvgForState(valveIcon, false);
        // ensure valve image id matches expected lookup used by updateValveImage
        if (isValve) img.id = `valve-img-${valveDomId}`;
        imgContainer.appendChild(img);
        attachValveSvgPicker(valveIcon, isValve || isSwitch);

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
        if (typeof applyValveIconRotation === 'function') 
        {
          applyValveIconRotation(valveIcon, iconDef.rotationDegrees || '0');
        }
        
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
