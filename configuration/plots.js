// --- Polling API for live updates ---
// Polls /api/plot_updates every 10s so the frontend can replay samples missed
// while the screen or browser was asleep.

let latestValuesPollCursorMs = 0;
let latestValuesPollInFlight = false;

function dispatchSpinUpdateFromPolling(key, meta) {
  const evDetail = {
    key: key,
    value: meta && (meta.value !== undefined ? meta.value : meta),
    unit: meta && meta.unit,
    state: meta && meta.state,
    state_str: meta && meta.state_str,
    timestamp_ms: meta && meta.timestamp_ms ? meta.timestamp_ms : Date.now()
  };
  const ev = new CustomEvent('plotupdate', { detail: evDetail });
  window.dispatchEvent(ev);
}

function processLatestValuesPollingPayload(payload) {
  if (!payload || payload.status !== 'ok') return;

  let maxTimestampMs = 0;

  if (payload.mode === 'history') {
    const pendingEvents = [];
    Object.entries(payload.samples || {}).forEach(([key, samples]) => {
      (samples || []).forEach((sample) => {
        pendingEvents.push({ key, sample });
        maxTimestampMs = Math.max(maxTimestampMs, Number(sample && sample.timestamp_ms) || 0);
      });
    });

    pendingEvents
      .sort((left, right) => (left.sample.timestamp_ms || 0) - (right.sample.timestamp_ms || 0))
      .forEach(({ key, sample }) => dispatchSpinUpdateFromPolling(key, sample));
    return maxTimestampMs;
  }

  Object.entries(payload.values || {}).forEach(([key, meta]) => {
    maxTimestampMs = Math.max(maxTimestampMs, Number(meta && meta.timestamp_ms) || 0);
    dispatchSpinUpdateFromPolling(key, meta);
  });

  return maxTimestampMs;
}

async function pollLatestValuesOnce() {
  if (latestValuesPollInFlight) return;
  if (typeof window.isConfigurationModeActive === 'function' && window.isConfigurationModeActive()) {
    return;
  }

  latestValuesPollInFlight = true;
  try {
    const host = window.location.hostname || 'localhost';
    const baseUrl = `${window.location.protocol}//${host}:8001/api/plot_updates`;
    const url = latestValuesPollCursorMs > 0
      ? `${baseUrl}?since=${encodeURIComponent(latestValuesPollCursorMs)}`
      : baseUrl;

    const response = await fetch(url);
    const payload = await response.json();
    if (!response.ok || payload.status !== 'ok') {
      throw new Error((payload && payload.error) || `HTTP ${response.status}`);
    }

    const latestDeliveredTimestampMs = processLatestValuesPollingPayload(payload);
    latestValuesPollCursorMs = Math.max(
      latestValuesPollCursorMs,
      Number(latestDeliveredTimestampMs || 0),
      Number(payload.server_time_ms || Date.now())
    );
  } catch (e) {
    console.warn('[Polling] Failed to fetch plot updates', e);
  } finally {
    latestValuesPollInFlight = false;
  }
}

function startPollingLatestValues() {
  pollLatestValuesOnce();
  setInterval(pollLatestValuesOnce, 10000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      pollLatestValuesOnce();
    }
  });

  window.addEventListener('focus', () => {
    pollLatestValuesOnce();
  });
}

// Start polling for live updates from polling API

startPollingLatestValues();

// Simplified plots manager: single plot with add/delete lines driven by device parameter dropdown

(function(){
  // Layout/save UI removed: plots will use the device grid workspace and
  // rely on the main system layout persistence. (Layout save/load code removed.)

  // Use device-grid as the primary plot container (no fallback).
  const plotArea = document.getElementById('device-grid');

  const plotTypeSelect = document.getElementById('plot-type');

  const deviceParamsSelect = document.getElementById('curve-key');
  const xyCurveKeyGroup = document.getElementById('xy-curve-key-group');
  const xyAxisTitleGroup = document.getElementById('xy-axis-title-group');
  const arrayElementStyleGroup = document.getElementById('array-element-style-group');
  const arrayElementStyleToggle = document.getElementById('array-element-style-toggle');
  const arrayElementStyleList = document.getElementById('array-element-style-list');
  const xyCurveXSelect = document.getElementById('curve-key-x');
  const xyCurveYSelect = document.getElementById('curve-key-y');
  const xyAxisTitleXInput = document.getElementById('xy-axis-title-x');
  const xyAxisTitleYInput = document.getElementById('xy-axis-title-y');
  const xyChartTypeSelect = document.getElementById('xy-chart-type');
  const curveLineTypeSelect = document.getElementById('curve-line-type');
  const curveLineWidthSelect = document.getElementById('curve-line-width');
  const curveLineColorInput = document.getElementById('curve-line-color');

  const addBtn = document.getElementById('add-curve');

  const addedLinesSelect = document.getElementById('added-lines');
  const addedLinesList = document.getElementById('added-lines-list');

  const deleteBtn = document.getElementById('delete-line');

  const plotConfigSelect = document.getElementById('plot-config-select');
  const deletePlotConfigBtn = document.getElementById('delete-plot-config');

  const createBtn = document.getElementById('create-plot');

  const PLOT_CONFIG_STORAGE_KEY = 'plot_configurations';
  let activeSavedPlotName = '';

  function getApiBase(){
    const host = window.location.hostname || 'localhost';
    return `${window.location.protocol}//${host}:8001`;
  }


  // staged lines (added via Add Line before creating a plot)
  const staged = {}; // key -> { suffix }

  // created plots: id -> { id, containerDiv, plotDiv, traces: { key -> {x,y,traceObj,suffix} } }
  const plotsMap = {};
  const plotHistoryCache = {};
  const storedLinePlotHistories = {};
  const warmingPlotConfigNames = new Set();
  const latestPlotValues = {};
  const MAX_STORED_PLOT_HISTORY_POINTS = Number.POSITIVE_INFINITY;
  const MAX_RENDERED_PLOT_POINTS = 2000;
  let currentDeviceParamsData = {};
  let plotCounter = 0;
  let pendingPlotPanelPosition = null;
  let plotConfigWindowBackdrop = null;

  function isXYPlotType(typeOverride){
    const type = typeOverride || (plotTypeSelect && plotTypeSelect.value ? plotTypeSelect.value : 'line');
    return type === 'xy';
  }

  function createXYLineKey(xKey, yKey){
    return `xy:${xKey}::${yKey}`;
  }

  function isXYLineMeta(meta){
    return !!(meta && meta.xKey && meta.yKey);
  }

  function updatePlotTypeControls(options){
    const settings = Object.assign({ clearIncompatibleStaged: true }, options || {});
    const isXY = isXYPlotType();
    const isArray = !isXY && (plotTypeSelect && plotTypeSelect.value === 'array');
    if(deviceParamsSelect) deviceParamsSelect.style.display = isXY ? 'none' : '';
    if(xyCurveKeyGroup) xyCurveKeyGroup.style.display = isXY ? 'inline-flex' : 'none';
    if(xyAxisTitleGroup) xyAxisTitleGroup.style.display = isXY ? 'flex' : 'none';
    if(xyChartTypeSelect) xyChartTypeSelect.style.display = isXY ? '' : 'none';
    if(arrayElementStyleGroup) arrayElementStyleGroup.style.display = isArray ? 'block' : 'none';

    if(!settings.clearIncompatibleStaged || !Object.keys(staged).length) {
      return;
    }

    const hasIncompatible = Object.values(staged).some((meta) => isXY ? !isXYLineMeta(meta) : isXYLineMeta(meta));
    if(hasIncompatible) {
      clearStagedLines();
    }
  }

  function getStoredPlotConfigs(){
    try 
    {
      const raw = localStorage.getItem(PLOT_CONFIG_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } 
    catch (e) 
    {
      console.error('Error reading plot configs from localStorage', e);
      return {};
    }
  }

  function storePlotConfigLocally(name, config){
    if(!name || !config) return;
    const configs = getStoredPlotConfigs();
    configs[name] = config;
    localStorage.setItem(PLOT_CONFIG_STORAGE_KEY, JSON.stringify(configs));
    ensureStoredLinePlotHistory(config);
  }

  function removeStoredPlotConfig(name){
    if(!name) return;
    const configs = getStoredPlotConfigs();
    if(!(name in configs)) return;
    delete configs[name];
    localStorage.setItem(PLOT_CONFIG_STORAGE_KEY, JSON.stringify(configs));
  }

  function getDisplayLabelForLine(line){
    if(!line || !line.key) return '';
    const style = line.style || {};
    const type = style.lineType || 'solid';
    const width = style.lineWidth || 2;
    const label = line.xKey && line.yKey ? `${line.yKey} vs ${line.xKey}` : line.key;
    return `■ ${label} (${type}, ${width}px)`;
  }

  function clearStagedLines(){
    Object.keys(staged).forEach(key => delete staged[key]);
    if(!addedLinesSelect) return;
    addedLinesSelect.innerHTML = '<option value="">-- added lines --</option>';
    addedLinesSelect.size = 1;
    addedLinesSelect.value = '';
    rebuildStagedLinesList();
  }

  function setSelectedStagedLine(key){
    if(!addedLinesSelect) return;
    addedLinesSelect.value = key || '';
    rebuildStagedLinesList();
  }

  function getSelectedStagedLineKey(){
    return addedLinesSelect && addedLinesSelect.value ? addedLinesSelect.value : '';
  }

  function rebuildStagedLinesList(){
    if(!addedLinesList) return;
    const keys = Object.keys(staged);
    addedLinesList.innerHTML = '';

    if(keys.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'staged-lines-empty';
      empty.textContent = '-- added lines --';
      addedLinesList.appendChild(empty);
      return;
    }

    const selectedKey = getSelectedStagedLineKey();
    keys.forEach((key) => {
      const meta = staged[key] || {};
      const style = meta.style || {};
      const color = style.lineColor || '#007bff';
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'staged-line-item';
      if(key === selectedKey) item.classList.add('is-selected');
      item.dataset.value = key;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', key === selectedKey ? 'true' : 'false');

      const swatch = document.createElement('span');
      swatch.className = 'staged-line-swatch';
      swatch.style.backgroundColor = color;

      const label = document.createElement('span');
      label.className = 'staged-line-label';
      label.textContent = meta.xKey && meta.yKey
        ? `${meta.yKey} vs ${meta.xKey} (${style.lineType || 'solid'}, ${(style.lineWidth || 2)}px)`
        : `${key} (${style.lineType || 'solid'}, ${(style.lineWidth || 2)}px)`;

      item.appendChild(swatch);
      item.appendChild(label);
      item.addEventListener('click', () => {
        setSelectedStagedLine(key);
      });

      addedLinesList.appendChild(item);
    });
  }

  function rebuildStagedLinesSelect(){
    if(!addedLinesSelect) return;
    const keys = Object.keys(staged);
    addedLinesSelect.innerHTML = '';
    if(keys.length === 0) {
      addedLinesSelect.innerHTML = '<option value="">-- added lines --</option>';
      addedLinesSelect.size = 1;
      addedLinesSelect.value = '';
      rebuildStagedLinesList();
      return;
    }
    addedLinesSelect.size = Math.min(Math.max(keys.length, 2), 6);
    keys.forEach((key) => {
      const meta = staged[key] || {};
      const style = meta.style || {};
      const color = style.lineColor || '#007bff';
      const option = document.createElement('option');
      option.value = key;
      option.textContent = getDisplayLabelForLine({ key, style });
      option.style.color = color;
      addedLinesSelect.add(option);
    });
    addedLinesSelect.selectedIndex = 0;
    rebuildStagedLinesList();
  }

  function getPreparedStagedLine(key, style, suffix, extra){
    return Object.assign({
      suffix: suffix || key,
      style: Object.assign({
        lineType: 'solid',
        lineWidth: 2,
        lineColor: '#007bff'
      }, style || {})
    }, extra || {});
  }

  function splitPlotKey(key){
    const rawKey = String(key || '').trim();
    const dotIndex = rawKey.lastIndexOf('.');
    if(dotIndex === -1) {
      return { device: rawKey, param: '' };
    }

    return {
      device: rawKey.slice(0, dotIndex),
      param: rawKey.slice(dotIndex + 1)
    };
  }

  function getModuleIdentityForDevice(deviceName){
    const rawName = String(deviceName || '').trim();
    if(!rawName) return '';

    const directInfo = currentDeviceParamsData[rawName] || {};
    if(directInfo.module_name) return directInfo.module_name;
    if(directInfo.original_name) return directInfo.original_name;

    const knownDevices = Object.keys(currentDeviceParamsData || {});
    for(const device of knownDevices) {
      const info = currentDeviceParamsData[device] || {};
      const moduleName = info.module_name || info.original_name || '';
      if(!moduleName) continue;
      if(rawName === device || rawName === moduleName || rawName.endsWith(`_${moduleName}`)) {
        return moduleName;
      }
    }

    return rawName;
  }

  function getCanonicalPlotKey(key){
    const parts = splitPlotKey(key);
    if(!parts.device || !parts.param) return String(key || '').trim();
    const moduleIdentity = getModuleIdentityForDevice(parts.device);
    return moduleIdentity ? `${moduleIdentity}.${parts.param}` : `${parts.device}.${parts.param}`;
  }

  function plotKeyMatches(emittedKey, candidateKey){
    const rawEmittedKey = String(emittedKey || '').trim();
    const rawCandidateKey = String(candidateKey || '').trim();
    if(!rawEmittedKey || !rawCandidateKey) return false;
    if(rawEmittedKey === rawCandidateKey || rawEmittedKey.endsWith(rawCandidateKey)) return true;

    const canonicalEmittedKey = getCanonicalPlotKey(rawEmittedKey);
    const canonicalCandidateKey = getCanonicalPlotKey(rawCandidateKey);
    return !!canonicalEmittedKey && canonicalEmittedKey === canonicalCandidateKey;
  }

  function getDeviceInfoForPlotDevice(deviceName){
    const rawName = String(deviceName || '').trim();
    if(!rawName) return null;

    if(currentDeviceParamsData[rawName]) return currentDeviceParamsData[rawName];

    const knownDevices = Object.keys(currentDeviceParamsData || {});
    for(const device of knownDevices) {
      const info = currentDeviceParamsData[device] || {};
      const moduleName = info.module_name || '';
      const originalName = info.original_name || '';
      if(rawName === device || rawName === moduleName || rawName === originalName || rawName.endsWith(`_${moduleName}`) || rawName.endsWith(`_${originalName}`)) {
        return info;
      }
    }

    return null;
  }

  function getParamInfoMap(deviceInfo){
    if(!deviceInfo || !deviceInfo.param_info) return {};

    if(Array.isArray(deviceInfo.param_info)) {
      const merged = {};
      deviceInfo.param_info.forEach((entry) => {
        if(entry && typeof entry === 'object' && !Array.isArray(entry)) {
          Object.assign(merged, entry);
        }
      });
      return merged;
    }

    if(typeof deviceInfo.param_info === 'object') {
      return deviceInfo.param_info;
    }

    return {};
  }

  function getUnitForPlotKey(key){
    const parts = splitPlotKey(key);
    if(!parts.device || !parts.param) return '';

    const deviceInfo = getDeviceInfoForPlotDevice(parts.device);
    const paramMeta = getParamInfoMap(deviceInfo)[parts.param] || null;
    const datainfo = paramMeta && paramMeta.datainfo ? paramMeta.datainfo : {};
    if(typeof datainfo.unit === 'string' && datainfo.unit.trim()) {
      return datainfo.unit.trim();
    }

    return '';
  }

  function formatLegendLabelForKey(key, baseLabel){
    const label = String(baseLabel || key || '').trim();
    if(!label) return '';
    const unit = getUnitForPlotKey(key);
    return unit ? `${label} [${unit}]` : label;
  }

  function formatXYLegendLabel(xKey, yKey){
    const yLabel = formatLegendLabelForKey(yKey, yKey || 'Y');
    const xLabel = formatLegendLabelForKey(xKey, xKey || 'X');
    return `${yLabel} vs ${xLabel}`;
  }

  function getParamMetaForPlotKey(key){
    const parts = splitPlotKey(key);
    if(!parts.device || !parts.param) return null;

    const deviceInfo = getDeviceInfoForPlotDevice(parts.device);
    return getParamInfoMap(deviceInfo)[parts.param] || null;
  }

  function getLatestArrayValueForPlotKey(key){
    if(Array.isArray(latestPlotValues[key])) return latestPlotValues[key];

    const knownKeys = Object.keys(latestPlotValues);
    for(const candidateKey of knownKeys) {
      if(plotKeyMatches(candidateKey, key) && Array.isArray(latestPlotValues[candidateKey])) {
        return latestPlotValues[candidateKey];
      }
    }

    return null;
  }

  function getArrayElementCountForPlotKey(key){
    const latestValue = getLatestArrayValueForPlotKey(key);
    if(Array.isArray(latestValue) && latestValue.length) return latestValue.length;

    const paramMeta = getParamMetaForPlotKey(key);
    const datainfo = paramMeta && paramMeta.datainfo ? paramMeta.datainfo : {};
    if(datainfo.type !== 'array') return 0;
    if(Number.isFinite(datainfo.maxlen) && datainfo.maxlen > 0) return datainfo.maxlen;
    if(Number.isFinite(datainfo.minlen) && datainfo.minlen > 0) return datainfo.minlen;
    return 0;
  }

  function getBaseCurveStyleFromControls(){
    return {
      lineType: curveLineTypeSelect && curveLineTypeSelect.value ? curveLineTypeSelect.value : 'solid',
      lineWidth: curveLineWidthSelect && curveLineWidthSelect.value ? parseInt(curveLineWidthSelect.value, 10) : 2,
      lineColor: curveLineColorInput && curveLineColorInput.value ? curveLineColorInput.value : '#007bff'
    };
  }

  function getArrayElementStylesFromPanel(){
    if(!arrayElementStyleList) return [];
    return Array.from(arrayElementStyleList.querySelectorAll('.array-element-style-row')).map((row) => ({
      name: row.querySelector('[data-style-field="name"]') ? row.querySelector('[data-style-field="name"]').value.trim() : '',
      lineType: row.querySelector('[data-style-field="lineType"]') ? row.querySelector('[data-style-field="lineType"]').value : 'solid',
      lineWidth: row.querySelector('[data-style-field="lineWidth"]') ? parseInt(row.querySelector('[data-style-field="lineWidth"]').value, 10) : 2,
      lineColor: row.querySelector('[data-style-field="lineColor"]') ? row.querySelector('[data-style-field="lineColor"]').value : '#007bff'
    }));
  }

  function renderArrayElementStyleRows(count, presetStyles){
    if(!arrayElementStyleList) return;
    arrayElementStyleList.innerHTML = '';

    if(!count) {
      const empty = document.createElement('div');
      empty.className = 'array-element-style-empty';
      empty.textContent = 'Waiting for array size information for this parameter.';
      arrayElementStyleList.appendChild(empty);
      return;
    }

    for(let index = 0; index < count; index += 1) {
      const baseStyle = getBaseCurveStyleFromControls();
      const style = Array.isArray(presetStyles) && presetStyles[index]
        ? Object.assign({}, baseStyle, presetStyles[index])
        : baseStyle;
      const row = document.createElement('div');
      row.className = 'array-element-style-row';
      row.dataset.index = String(index);
      row.innerHTML = `
        <span class="array-element-style-index">[${index}]</span>
        <input class="ctrl array-element-style-name" data-style-field="name" type="text" placeholder="Line name">
        <select class="ctrl" data-style-field="lineType">
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
        <select class="ctrl" data-style-field="lineWidth">
          <option value="1">1 px</option>
          <option value="2">2 px</option>
          <option value="4">4 px</option>
          <option value="6">6 px</option>
        </select>
        <input class="ctrl" data-style-field="lineColor" type="color" value="#007bff" title="Line color">
      `;
      const nameInput = row.querySelector('[data-style-field="name"]');
      const typeSelect = row.querySelector('[data-style-field="lineType"]');
      const widthSelect = row.querySelector('[data-style-field="lineWidth"]');
      const colorInput = row.querySelector('[data-style-field="lineColor"]');
      if(nameInput) nameInput.value = style.name || '';
      if(typeSelect) typeSelect.value = style.lineType || 'solid';
      if(widthSelect) widthSelect.value = String(style.lineWidth || 2);
      if(colorInput) colorInput.value = style.lineColor || '#007bff';
      arrayElementStyleList.appendChild(row);
    }
  }

  function refreshArrayElementStylePanel(presetStyles){
    if(!arrayElementStyleGroup || !arrayElementStyleList) return;

    const isArrayPlot = plotTypeSelect && plotTypeSelect.value === 'array';
    const selectedKey = deviceParamsSelect && deviceParamsSelect.value ? deviceParamsSelect.value.trim() : '';
    const paramMeta = getParamMetaForPlotKey(selectedKey);
    const isArrayParam = !!(isArrayPlot && paramMeta && paramMeta.datainfo && paramMeta.datainfo.type === 'array');
    arrayElementStyleGroup.style.display = isArrayPlot ? 'block' : 'none';

    if(!isArrayPlot) {
      arrayElementStyleList.innerHTML = '';
      return;
    }

    if(!selectedKey) {
      arrayElementStyleList.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'array-element-style-empty';
      empty.textContent = 'Select an array parameter to configure per-element styles.';
      arrayElementStyleList.appendChild(empty);
      return;
    }

    if(!isArrayParam) {
      arrayElementStyleList.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'array-element-style-empty';
      empty.textContent = 'The selected parameter is not an array parameter.';
      arrayElementStyleList.appendChild(empty);
      return;
    }

    const currentStyles = Array.isArray(presetStyles) ? presetStyles : getArrayElementStylesFromPanel();
    renderArrayElementStyleRows(getArrayElementCountForPlotKey(selectedKey), currentStyles);
  }

  function setArrayElementStyleDropdownOpen(isOpen){
    if(!arrayElementStyleGroup) return;
    arrayElementStyleGroup.classList.toggle('is-open', !!isOpen);
    if(arrayElementStyleToggle) {
      arrayElementStyleToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
  }

  function getArrayChildStyle(parentStyle, index){
    const style = parentStyle || {};
    const perElementStyle = Array.isArray(style.arrayElementStyles) ? style.arrayElementStyles[index] : null;
    return Object.assign({}, style, perElementStyle || {});
  }

  function getArrayChildTraceLabel(parentKey, index, parentStyle){
    const childStyle = getArrayChildStyle(parentStyle, index);
    const baseLabel = childStyle && childStyle.name ? childStyle.name.trim() : `${parentKey}[${index}]`;
    return formatLegendLabelForKey(parentKey, baseLabel);
  }

  function getAutoPreparedLinesForCurrentType(){
    if(isXYPlotType()) {
      const xKey = xyCurveXSelect && xyCurveXSelect.value ? xyCurveXSelect.value.trim() : '';
      const yKey = xyCurveYSelect && xyCurveYSelect.value ? xyCurveYSelect.value.trim() : '';
      if(!xKey || !yKey) return {};
      const key = createXYLineKey(xKey, yKey);
      return {
        [key]: getPreparedStagedLine(key, getSelectedCurveStyle(), key, {
          xKey,
          yKey,
          xSuffix: xKey,
          ySuffix: yKey,
          label: `${yKey} vs ${xKey}`
        })
      };
    }

    const preselected = deviceParamsSelect && deviceParamsSelect.value ? deviceParamsSelect.value.trim() : '';
    if(!preselected) return {};
    return { [preselected]: getPreparedStagedLine(preselected, getSelectedCurveStyle(), preselected) };
  }

  function getCurrentPlotConfig(nameOverride){
    const nextStaged = Object.keys(staged).length ? staged : getAutoPreparedLinesForCurrentType();
    const activePlotType = plotTypeSelect && plotTypeSelect.value ? plotTypeSelect.value : 'line';
    const activeXYChartType = xyChartTypeSelect && xyChartTypeSelect.value ? xyChartTypeSelect.value : 'area';
    const firstKey = Object.keys(nextStaged)[0] || '';
    const firstMeta = firstKey ? (nextStaged[firstKey] || {}) : {};
    const fallbackXAxisTitle = firstMeta.xKey || 'X';
    const fallbackYAxisTitle = firstMeta.yKey || 'Y';
    const xAxisTitle = xyAxisTitleXInput && xyAxisTitleXInput.value ? xyAxisTitleXInput.value.trim() : '';
    const yAxisTitle = xyAxisTitleYInput && xyAxisTitleYInput.value ? xyAxisTitleYInput.value.trim() : '';
    const lines = Object.keys(nextStaged).map((key) => {
      const meta = nextStaged[key] || {};
      const style = Object.assign({
        lineType: 'solid',
        lineWidth: 2,
        lineColor: '#007bff'
      }, meta.style || {});

      if(activePlotType === 'xy') {
        style.xyChartType = activeXYChartType;
      }

      return {
        key,
        suffix: meta.suffix || key,
        xKey: meta.xKey || '',
        yKey: meta.yKey || '',
        xSuffix: meta.xSuffix || '',
        ySuffix: meta.ySuffix || '',
        label: meta.label || '',
        style
      };
    });
    return {
      name: nameOverride || '',
      plotType: activePlotType,
      xAxisTitle: activePlotType === 'xy' ? (xAxisTitle || fallbackXAxisTitle) : '',
      yAxisTitle: activePlotType === 'xy' ? (yAxisTitle || fallbackYAxisTitle) : '',
      lines,
      savedAt: new Date().toISOString()
    };
  }

  function applyPlotConfig(config){
    if(!config) return;
    if(plotTypeSelect && config.plotType) plotTypeSelect.value = config.plotType;
    updatePlotTypeControls({ clearIncompatibleStaged: false });
    clearStagedLines();
    (config.lines || []).forEach((line) => {
      if(!line || !line.key) return;
      staged[line.key] = getPreparedStagedLine(line.key, line.style, line.suffix || line.key, {
        xKey: line.xKey || '',
        yKey: line.yKey || '',
        xSuffix: line.xSuffix || '',
        ySuffix: line.ySuffix || '',
        label: line.label || ''
      });
    });
    rebuildStagedLinesSelect();
    const firstLine = (config.lines || [])[0];
    if(firstLine){
      if(isXYPlotType(config.plotType)) {
        if(xyCurveXSelect) xyCurveXSelect.value = firstLine.xKey || '';
        if(xyCurveYSelect) xyCurveYSelect.value = firstLine.yKey || '';
        if(xyAxisTitleXInput) xyAxisTitleXInput.value = config.xAxisTitle || firstLine.xKey || '';
        if(xyAxisTitleYInput) xyAxisTitleYInput.value = config.yAxisTitle || firstLine.yKey || '';
      } else if(deviceParamsSelect) {
        deviceParamsSelect.value = firstLine.key;
      }
      if(curveLineTypeSelect && firstLine.style && firstLine.style.lineType) curveLineTypeSelect.value = firstLine.style.lineType;
      if(curveLineWidthSelect && firstLine.style && firstLine.style.lineWidth) curveLineWidthSelect.value = String(firstLine.style.lineWidth);
      if(curveLineColorInput && firstLine.style && firstLine.style.lineColor) curveLineColorInput.value = firstLine.style.lineColor;
      if(xyChartTypeSelect && firstLine.style && firstLine.style.xyChartType) xyChartTypeSelect.value = firstLine.style.xyChartType;
      refreshArrayElementStylePanel(firstLine.style && firstLine.style.arrayElementStyles ? firstLine.style.arrayElementStyles : undefined);
    } else {
      if(xyAxisTitleXInput) xyAxisTitleXInput.value = config.xAxisTitle || '';
      if(xyAxisTitleYInput) xyAxisTitleYInput.value = config.yAxisTitle || '';
      refreshArrayElementStylePanel();
    }
    refreshPlot();
  }

  function populatePlotConfigSelect(selectEl, selectedName){
    if(!selectEl) return;
    const names = Object.keys(getStoredPlotConfigs()).sort();
    selectEl.innerHTML = '<option value="">Plot selection</option>';
    names.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      selectEl.add(option);
    });
    if(selectedName && names.includes(selectedName)) {
      selectEl.value = selectedName;
    } else {
      selectEl.value = '';
    }
  }

  function refreshPlotConfigSelectors(){
    if(plotConfigSelect) populatePlotConfigSelect(plotConfigSelect, activeSavedPlotName);
    Object.values(plotsMap).forEach((entry) => {
      if(entry && entry.plotConfigSelect) {
        populatePlotConfigSelect(entry.plotConfigSelect, entry.configName || activeSavedPlotName);
      }
    });
  }

  function setPlotConfigSelection(name){
    activeSavedPlotName = name || '';
    refreshPlotConfigSelectors();
  }

  function normalizeRequestedPanelPosition(position){
    if(!position || typeof position !== 'object') 
      return null;
    const normalized = {};
    if(position.left) 
      normalized.left = position.left;
    if(position.top) 
      normalized.top = position.top;
      return (normalized.left || normalized.top) ? normalized : null;
  }

  function resetPlotConfigurationEditor(){
    clearStagedLines();
    setPlotConfigSelection('');
    if(plotConfigSelect) plotConfigSelect.value = '';
    if(plotTypeSelect) plotTypeSelect.value = 'line';
    if(deviceParamsSelect) deviceParamsSelect.value = '';
    if(xyCurveXSelect) xyCurveXSelect.value = '';
    if(xyCurveYSelect) xyCurveYSelect.value = '';
    if(xyAxisTitleXInput) xyAxisTitleXInput.value = '';
    if(xyAxisTitleYInput) xyAxisTitleYInput.value = '';
    if(xyChartTypeSelect) xyChartTypeSelect.value = 'area';
    if(curveLineTypeSelect) curveLineTypeSelect.value = 'solid';
    if(curveLineWidthSelect) curveLineWidthSelect.value = '2';
    if(curveLineColorInput) curveLineColorInput.value = '#007bff';
    updatePlotTypeControls({ clearIncompatibleStaged: false });
    setArrayElementStyleDropdownOpen(true);
    refreshArrayElementStylePanel();
    refreshPlot();
  }

  function ensurePlotConfigurationWindowShell(){
    const panel = document.getElementById('plots-panel');
    if(!panel) return null;

    panel.classList.add('plot-config-window-hidden');

    if(panel.dataset.plotWindowReady === 'true') {
      return panel;
    }

    panel.dataset.plotWindowReady = 'true';
    panel.classList.add('plot-config-window-shell');

    const header = document.createElement('div');
    header.className = 'plot-config-window-header';

    const title = document.createElement('div');
    title.className = 'plot-config-window-title';
    title.textContent = 'Plot configuration';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'plot-config-window-close';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () => {
      closePlotConfigurationWindow();
    });

    header.appendChild(title);
    header.appendChild(closeButton);
    panel.insertBefore(header, panel.firstChild);

    plotConfigWindowBackdrop = document.createElement('div');
    plotConfigWindowBackdrop.className = 'plot-config-window-backdrop';
    plotConfigWindowBackdrop.addEventListener('click', () => {
      closePlotConfigurationWindow();
    });
    document.body.appendChild(plotConfigWindowBackdrop);

    return panel;
  }

  function openPlotConfigurationWindow(options){
    const panel = ensurePlotConfigurationWindowShell();
    if(!panel) return;

    const settings = options || {};
    pendingPlotPanelPosition = normalizeRequestedPanelPosition(settings.position);
    if(settings.reset !== false) {
      resetPlotConfigurationEditor();
    }

    panel.classList.remove('plot-config-window-hidden');
    panel.classList.add('plot-config-window-open');
    if(plotConfigWindowBackdrop) {
      plotConfigWindowBackdrop.classList.add('is-open');
    }
  }

  function closePlotConfigurationWindow(){
    const panel = document.getElementById('plots-panel');
    if(!panel) return;
    panel.classList.remove('plot-config-window-open');
    panel.classList.add('plot-config-window-hidden');
    if(plotConfigWindowBackdrop) {
      plotConfigWindowBackdrop.classList.remove('is-open');
    }
    pendingPlotPanelPosition = null;
  }

  function getSavedPlotNames(){
    return Object.keys(getStoredPlotConfigs()).sort();
  }

  function createSavedPlotByName(name, options){
    return new Promise((resolve) => {
      if(!name) {
        resolve(null);
        return;
      }

      loadPlotConfigByName(name, (config) => {
        if(!config) {
          resolve(null);
          return;
        }

        const plotEntry = createPlotPanelFromConfig(config, options);
        if(plotEntry) {
          setPlotConfigSelection(name);
          focusExistingPlot(plotEntry);
        }
        resolve(plotEntry);
      });
    });
  }

  function updatePlotConfigList(selectedName){
    if(typeof selectedName === 'string') activeSavedPlotName = selectedName;
    refreshPlotConfigSelectors();
    warmStoredLinePlotHistories();

    fetch(`${getApiBase()}/api/plot_configs`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if(payload && payload.status === 'ok') {
          mergePlotConfigNames(payload.names);
        }
      })
      .catch((e) => {
        console.debug('plot config API fallback failed', e);
      });

    if(window.Spin && window.Spin.send_request){
      try {
        window.Spin.send_request('nodemanager.list_plot_configs', '', 'read', 'read', null, function(names){
          mergePlotConfigNames(names);
        });
      } catch (e) {
        console.error('list_plot_configs request failed', e);
      }
    }
  }

  function normalizePlotConfigNames(payload){
    if(Array.isArray(payload)) return payload.filter((name) => typeof name === 'string' && name.trim());

    if(payload && typeof payload === 'object') {
      if(Array.isArray(payload.value)) return payload.value.filter((name) => typeof name === 'string' && name.trim());
      if(Array.isArray(payload.names)) return payload.names.filter((name) => typeof name === 'string' && name.trim());
    }

    if(typeof payload === 'string') {
      const trimmed = payload.trim();
      if(!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        return normalizePlotConfigNames(parsed);
      } catch (e) {
        return trimmed.split(',').map((name) => name.trim()).filter(Boolean);
      }
    }

    return [];
  }

  function mergePlotConfigNames(names){
    const normalizedNames = normalizePlotConfigNames(names);
    if(!normalizedNames.length) return;
    const merged = getStoredPlotConfigs();
    normalizedNames.forEach((name) => {
      if(!(name in merged)) merged[name] = { name: name };
    });
    localStorage.setItem(PLOT_CONFIG_STORAGE_KEY, JSON.stringify(merged));
    refreshPlotConfigSelectors();
    warmStoredLinePlotHistories();
  }

  function ensureStoredLinePlotHistory(config){
    if(!config || !config.name) return null;
    const plotType = config.plotType || 'line';
    if(plotType !== 'line' || !Array.isArray(config.lines) || !config.lines.length) return null;

    const name = config.name;
    const existing = storedLinePlotHistories[name] || { plotType: 'line', traces: {} };
    existing.plotType = 'line';
    existing.name = name;
    existing.configName = name;

    const nextTraces = {};
    config.lines.forEach((line) => {
      if(!line || !line.key) return;
      const prepared = getPreparedStagedLine(line.key, line.style, line.suffix || line.key);
      const traceKey = line.key;
      const prior = existing.traces[traceKey] || {};
      nextTraces[traceKey] = {
        key: traceKey,
        suffix: prepared.suffix || line.suffix || traceKey,
        name: prior.name || traceKey,
        style: prepared.style,
        x: Array.isArray(prior.x) ? prior.x : [],
        y: Array.isArray(prior.y) ? prior.y : []
      };
    });

    existing.traces = nextTraces;
    storedLinePlotHistories[name] = existing;
    return existing;
  }

  function warmStoredLinePlotHistories(){
    const configs = getStoredPlotConfigs();
    Object.keys(configs).forEach((name) => {
      const config = configs[name];
      if(config && Array.isArray(config.lines) && config.lines.length) {
        if(!config.name) config.name = name;
        ensureStoredLinePlotHistory(config);
        return;
      }

      if(warmingPlotConfigNames.has(name)) return;
      warmingPlotConfigNames.add(name);
      loadPlotConfigByName(name, (loadedConfig) => {
        warmingPlotConfigNames.delete(name);
        if(loadedConfig && !loadedConfig.name) loadedConfig.name = name;
        ensureStoredLinePlotHistory(loadedConfig);
      });
    });
  }

  function normalizeTimeSeriesValue(value){
    if(Array.isArray(value)) return JSON.stringify(value);
    if(typeof value === 'number') return value;
    const numericValue = parseFloat(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  const MAX_FUTURE_PLOT_SKEW_MS = 5 * 60 * 1000;

  function coercePlotTimestamp(value){
    if(value instanceof Date) {
      const timestampMs = value.getTime();
      return Number.isFinite(timestampMs) ? new Date(timestampMs) : null;
    }

    if(typeof value === 'number') {
      return Number.isFinite(value) ? new Date(value) : null;
    }

    if(typeof value === 'string') {
      const parsedMs = Date.parse(value);
      return Number.isFinite(parsedMs) ? new Date(parsedMs) : null;
    }

    return null;
  }

  function sanitizeTimeSeriesPoints(xValues, yValues){
    const safeX = [];
    const safeY = [];
    const nowMs = Date.now();
    const maxAllowedTimestampMs = nowMs + MAX_FUTURE_PLOT_SKEW_MS;

    for(let index = 0; index < Math.min(Array.isArray(xValues) ? xValues.length : 0, Array.isArray(yValues) ? yValues.length : 0); index += 1) {
      const normalizedDate = coercePlotTimestamp(xValues[index]);
      if(!normalizedDate) continue;

      const timestampMs = normalizedDate.getTime();
      if(timestampMs > maxAllowedTimestampMs) continue;

      safeX.push(normalizedDate);
      safeY.push(yValues[index]);
    }

    return { x: safeX, y: safeY };
  }

  function normalizePlotEventTimestamp(timestampMs, eventType){
    const numericTimestampMs = Number(timestampMs);
    const nowMs = Date.now();
    const minAllowedTimestampMs = nowMs - (30 * 24 * 60 * 60 * 1000);
    const maxAllowedTimestampMs = nowMs + MAX_FUTURE_PLOT_SKEW_MS;

    if(eventType === 'spinupdate') {
      return nowMs;
    }

    if(!Number.isFinite(numericTimestampMs)) {
      return nowMs;
    }

    if(numericTimestampMs < minAllowedTimestampMs || numericTimestampMs > maxAllowedTimestampMs) {
      return nowMs;
    }

    return numericTimestampMs;
  }

  function sampleTracePoints(xValues, yValues, maxPoints){
    const xSource = Array.isArray(xValues) ? xValues : [];
    const ySource = Array.isArray(yValues) ? yValues : [];
    const totalPoints = Math.min(xSource.length, ySource.length);
    const safeMaxPoints = Math.max(2, Number(maxPoints) || MAX_RENDERED_PLOT_POINTS);

    if(totalPoints <= safeMaxPoints) {
      return {
        x: xSource.slice(0, totalPoints),
        y: ySource.slice(0, totalPoints)
      };
    }

    const nextX = [];
    const nextY = [];
    const maxIndex = totalPoints - 1;
    for(let index = 0; index < safeMaxPoints; index += 1) {
      const sampleIndex = Math.min(maxIndex, Math.round((index * maxIndex) / (safeMaxPoints - 1)));
      if(nextX.length && nextX[nextX.length - 1] === xSource[sampleIndex] && nextY[nextY.length - 1] === ySource[sampleIndex]) {
        continue;
      }
      nextX.push(xSource[sampleIndex]);
      nextY.push(ySource[sampleIndex]);
    }

    if(nextX[nextX.length - 1] !== xSource[maxIndex] || nextY[nextY.length - 1] !== ySource[maxIndex]) {
      nextX.push(xSource[maxIndex]);
      nextY.push(ySource[maxIndex]);
    }

    return { x: nextX, y: nextY };
  }

  function syncRenderedLineTrace(meta){
    if(!meta || !meta.traceObj) return;
    const sanitized = sanitizeTimeSeriesPoints(meta.rawX, meta.rawY);
    meta.rawX = sanitized.x;
    meta.rawY = sanitized.y;
    const sampled = sampleTracePoints(meta.rawX, meta.rawY, MAX_RENDERED_PLOT_POINTS);
    meta.traceObj.x = sampled.x;
    meta.traceObj.y = sampled.y;
    meta.x = meta.traceObj.x;
    meta.y = meta.traceObj.y;
  }

  function mergeOrderedTimeSeries(baseX, baseY, tailX, tailY){
    const sanitizedBase = sanitizeTimeSeriesPoints(baseX, baseY);
    const sanitizedTail = sanitizeTimeSeriesPoints(tailX, tailY);
    const mergedX = sanitizedBase.x;
    const mergedY = sanitizedBase.y;
    const sourceX = sanitizedTail.x;
    const sourceY = sanitizedTail.y;

    let lastTimestamp = mergedX.length ? Number(mergedX[mergedX.length - 1]) : Number.NEGATIVE_INFINITY;
    let lastValue = mergedY.length ? mergedY[mergedY.length - 1] : undefined;

    for(let index = 0; index < Math.min(sourceX.length, sourceY.length); index += 1) {
      const nextX = sourceX[index];
      const nextY = sourceY[index];
      const nextTimestamp = Number(nextX);
      if(!Number.isFinite(nextTimestamp)) continue;
      if(nextTimestamp < lastTimestamp) continue;
      if(nextTimestamp === lastTimestamp && nextY === lastValue) continue;
      mergedX.push(nextX);
      mergedY.push(nextY);
      lastTimestamp = nextTimestamp;
      lastValue = nextY;
    }

    return { x: mergedX, y: mergedY };
  }

  async function fetchDeviceHistoryForKeys(keys){
    const normalizedKeys = Array.from(new Set((keys || []).map((key) => String(key || '').trim()).filter(Boolean)));
    if(!normalizedKeys.length) return {};

    const host = window.location.hostname || 'localhost';
    const baseUrl = `${window.location.protocol}//${host}:8001/api/device_history`;
    const allSamples = {};
    let cursorTimestampMs = null;
    let cursorId = null;
    let hasMore = true;

    while(hasMore) {
      const params = new URLSearchParams();
      params.set('keys', normalizedKeys.join(','));
      params.set('limit', '50000');
      if(cursorTimestampMs !== null) params.set('cursor_timestamp_ms', String(cursorTimestampMs));
      if(cursorId !== null) params.set('cursor_id', String(cursorId));

      const response = await fetch(`${baseUrl}?${params.toString()}`);
      const payload = await response.json();
      if(!response.ok || payload.status !== 'ok') {
        throw new Error((payload && payload.error) || `HTTP ${response.status}`);
      }

      Object.entries((payload.samples || {})).forEach(([key, samples]) => {
        if(!allSamples[key]) allSamples[key] = [];
        allSamples[key].push(...(samples || []));
      });

      hasMore = !!payload.has_more;
      cursorTimestampMs = payload.next_cursor && payload.next_cursor.timestamp_ms !== undefined ? payload.next_cursor.timestamp_ms : null;
      cursorId = payload.next_cursor && payload.next_cursor.id !== undefined ? payload.next_cursor.id : null;
    }

    return allSamples;
  }

  async function hydrateLinePlotHistory(plotEntry){
    if(!plotEntry || plotEntry.plotType !== 'line' || plotEntry._historyHydrated || plotEntry._historyHydrating) return;

    const traceEntries = Object.entries(plotEntry.traces || {}).filter(([, meta]) => meta && meta.traceObj);
    const historyKeys = traceEntries.map(([key, meta]) => meta.suffix || key);
    if(!historyKeys.length) return;

    plotEntry._historyHydrating = true;
    try {
      const samplesByKey = await fetchDeviceHistoryForKeys(historyKeys);
      traceEntries.forEach(([key, meta]) => {
        const matchedSamples = [];
        Object.entries(samplesByKey).forEach(([sampleKey, samples]) => {
          if(plotKeyMatches(sampleKey, key) || (meta.suffix && plotKeyMatches(sampleKey, meta.suffix))) {
            matchedSamples.push(...(samples || []));
          }
        });

        if(!matchedSamples.length) return;

        const dbX = [];
        const dbY = [];
        matchedSamples.forEach((sample) => {
          const timestampMs = Number(sample && sample.timestamp_ms);
          if(!Number.isFinite(timestampMs)) return;
          dbX.push(new Date(timestampMs));
          dbY.push(normalizeTimeSeriesValue(sample.value));
        });

        const merged = mergeOrderedTimeSeries(dbX, dbY, meta.rawX, meta.rawY);
        meta.rawX = merged.x;
        meta.rawY = merged.y;
        syncRenderedLineTrace(meta);
      });

      plotEntry._dirty = true;
      refreshPlot();
      plotEntry._historyHydrated = true;
    } catch (e) {
      console.warn('Failed to hydrate line plot history', e);
    } finally {
      plotEntry._historyHydrating = false;
    }
  }

  function appendToStoredLinePlotHistories(emittedKey, value, now){
    const normalizedNow = coercePlotTimestamp(now);
    if(!normalizedNow) return;

    Object.values(storedLinePlotHistories).forEach((history) => {
      if(!history || history.plotType !== 'line' || !history.traces) return;

      Object.values(history.traces).forEach((trace) => {
        if(!trace) return;
        if(!(plotKeyMatches(emittedKey, trace.key) || plotKeyMatches(emittedKey, trace.suffix))) return;

        const yValue = normalizeTimeSeriesValue(value);
        trace.x.push(normalizedNow);
        trace.y.push(yValue);
        while(trace.x.length > MAX_STORED_PLOT_HISTORY_POINTS) {
          trace.x.shift();
          trace.y.shift();
        }
      });
    });
  }

  function findExistingPlotByName(name){
    if(!name) return null;
    return Object.values(plotsMap).find((entry) => entry && entry.containerDiv && entry.containerDiv.dataset && entry.containerDiv.dataset.plotName === name) || null;
  }

  function focusExistingPlot(entry){
    if(!entry || !entry.containerDiv) return;
    entry.containerDiv.style.display = 'block';
    entry.containerDiv.style.zIndex = String((parseInt(entry.containerDiv.style.zIndex || '5', 10) || 5) + 1);
    if(typeof entry.containerDiv.scrollIntoView === 'function') {
      entry.containerDiv.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function snapshotPlotEntryHistory(entry){
    if(!entry || !entry.configName) return;

    const history = {
      plotType: entry.plotType || 'line',
      xAxisTitle: entry.xAxisTitle || '',
      yAxisTitle: entry.yAxisTitle || '',
      traces: {}
    };

    Object.keys(entry.traces || {}).forEach((key) => {
      const meta = entry.traces[key];
      if(!meta) return;

      if(meta.isArrayParent) {
        history.traces[key] = {
          isArrayParent: true,
          suffix: meta.suffix || key,
          name: meta.name || key,
          style: meta.style || {}
        };
        return;
      }

      if(!meta.traceObj) return;

      history.traces[key] = {
        x: Array.isArray(meta.rawX) ? meta.rawX.slice() : (Array.isArray(meta.traceObj.x) ? meta.traceObj.x.slice() : []),
        y: Array.isArray(meta.rawY) ? meta.rawY.slice() : (Array.isArray(meta.traceObj.y) ? meta.traceObj.y.slice() : []),
        name: meta.traceObj.name || meta.name || key,
        suffix: meta.suffix || key,
        style: meta.style || {},
        parent: meta.parent || '',
        xKey: meta.xKey || '',
        yKey: meta.yKey || '',
        xSuffix: meta.xSuffix || '',
        ySuffix: meta.ySuffix || '',
        latestX: meta.latestX,
        latestY: meta.latestY,
        latestXSeries: Array.isArray(meta.latestXSeries) ? meta.latestXSeries.slice() : undefined,
        latestYSeries: Array.isArray(meta.latestYSeries) ? meta.latestYSeries.slice() : undefined,
        lastPushedX: meta.lastPushedX,
        lastPushedY: meta.lastPushedY,
        lastPushedSignature: meta.lastPushedSignature
      };
    });

    plotHistoryCache[entry.configName] = history;
  }

  function removePlotEntryByName(name){
    if(!name) return;
    Object.keys(plotsMap).forEach((id) => {
      const entry = plotsMap[id];
      if(entry && entry.containerDiv && entry.containerDiv.dataset && entry.containerDiv.dataset.plotName === name){
        snapshotPlotEntryHistory(entry);
        try {
          if(entry.plotDiv) Plotly.purge(entry.plotDiv);
        } catch (e) {}
        if(entry.containerDiv && entry.containerDiv.parentNode) entry.containerDiv.parentNode.removeChild(entry.containerDiv);
        delete plotsMap[id];
      }
    });
  }

  function deleteSelectedPlotConfig(){
    const name = plotConfigSelect && plotConfigSelect.value ? plotConfigSelect.value.trim() : '';
    if(!name) {
      alert('Select a saved plot first.');
      return;
    }
    if(!confirm(`Delete plot configuration "${name}"?`)) return;

    removeStoredPlotConfig(name);
    removePlotEntryByName(name);
    if(activeSavedPlotName === name) {
      setPlotConfigSelection('');
    } else {
      refreshPlotConfigSelectors();
    }

    const finishDelete = () => {
      updatePlotConfigList('');
      if(plotConfigSelect) plotConfigSelect.value = '';
    };

    if(window.Spin && window.Spin.send_request) {
      try {
        window.Spin.send_request('nodemanager.delete_plot_config', '', 'input', 'set', {name: name}, function(){
          try {
            window.Spin.send_request('nodemanager.list_plot_configs', '', 'read', 'read', null);
          } catch (e) {
            console.error('list_plot_configs request failed after delete', e);
          }
          finishDelete();
        });
        return;
      } catch (e) {
        console.error('delete_plot_config request failed', e);
      }
    }

    finishDelete();
  }

  function requestPlotConfigFromServer(name, callback){
    if(!(window.Spin && window.Spin.send_request)) return false;
    try {
      window.Spin.send_request('nodemanager.get_plot_config', '', 'read', 'read', {name: name}, function(config){
        if(config && typeof config === 'object') {
          if(!config.name) config.name = name;
          storePlotConfigLocally(name, config);
          updatePlotConfigList(name);
          if(typeof callback === 'function') callback(config);
        }
      });
      return true;
    } catch (e) {
      console.error('get_plot_config request failed', e);
      return false;
    }
  }

  function requestPlotConfigFromApi(name, callback){
    fetch(`${getApiBase()}/api/plot_configs/${encodeURIComponent(name)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const config = payload && payload.status === 'ok' ? payload.config : null;
        if(config && typeof config === 'object') {
          if(!config.name) config.name = name;
          storePlotConfigLocally(name, config);
          updatePlotConfigList(name);
          if(typeof callback === 'function') callback(config);
          return;
        }
        if(!requestPlotConfigFromServer(name, callback)) {
          alert('Plot configuration not found.');
        }
      })
      .catch((e) => {
        console.error('get_plot_config API fallback failed', e);
        if(!requestPlotConfigFromServer(name, callback)) {
          alert('Plot configuration not found.');
        }
      });
  }

  function removePlotEntryById(id){
    const entry = plotsMap[id];
    if(!entry) return;
    snapshotPlotEntryHistory(entry);
    try {
      if(entry.plotDiv) Plotly.purge(entry.plotDiv);
    } catch (e) {}
    if(entry.containerDiv && entry.containerDiv.parentNode) entry.containerDiv.parentNode.removeChild(entry.containerDiv);
    delete plotsMap[id];
  }

  function capturePlotPanelGeometry(entry){
    if(!entry || !entry.containerDiv) return null;
    return {
      left: entry.containerDiv.style.left,
      top: entry.containerDiv.style.top,
      width: entry.containerDiv.style.width,
      height: entry.containerDiv.style.height,
      transform: entry.containerDiv.style.transform,
      zIndex: entry.containerDiv.style.zIndex,
      dataX: entry.containerDiv.getAttribute('data-x') || '',
      dataY: entry.containerDiv.getAttribute('data-y') || ''
    };
  }

  function applyPlotPanelGeometry(entry, geometry){
    if(!entry || !entry.containerDiv || !geometry) return;
    entry.containerDiv.style.left = geometry.left || entry.containerDiv.style.left;
    entry.containerDiv.style.top = geometry.top || entry.containerDiv.style.top;
    entry.containerDiv.style.width = geometry.width || entry.containerDiv.style.width;
    entry.containerDiv.style.height = geometry.height || entry.containerDiv.style.height;
    entry.containerDiv.style.transform = geometry.transform || '';
    entry.containerDiv.style.zIndex = geometry.zIndex || entry.containerDiv.style.zIndex;
    if(geometry.dataX) entry.containerDiv.setAttribute('data-x', geometry.dataX); else entry.containerDiv.removeAttribute('data-x');
    if(geometry.dataY) entry.containerDiv.setAttribute('data-y', geometry.dataY); else entry.containerDiv.removeAttribute('data-y');
    try { Plotly.Plots.resize(entry.plotDiv); } catch (e) {}
  }

  function arePlotPanelsMovable() {
    return !(typeof window.isConfigurationModeActive === 'function' && !window.isConfigurationModeActive());
  }

  function getPlotlyRenderConfig() {
    return {
      responsive: true,
      scrollZoom: false,
      doubleClick: false,
      displayModeBar: arePlotPanelsMovable()
    };
  }

  function loadPlotConfigByName(name, callback){
    const configs = getStoredPlotConfigs();
    const cachedConfig = configs[name];
    if(cachedConfig && Array.isArray(cachedConfig.lines) && cachedConfig.lines.length) {
      callback(cachedConfig);
      return;
    }
    requestPlotConfigFromApi(name, callback);
  }

  function getCurrentPlotEntry(){
    if(activeSavedPlotName) {
      const namedEntry = findExistingPlotByName(activeSavedPlotName);
      if(namedEntry) return namedEntry;
    }

    const entries = Object.values(plotsMap).filter((entry) => entry && entry.containerDiv);
    if(entries.length === 1) return entries[0];

    return null;
  }

  function handleTopLevelPlotConfigSelection(){
    if(!plotConfigSelect) return;
    const name = plotConfigSelect.value;
    if(!name) {
      setPlotConfigSelection('');
      clearStagedLines();
      refreshPlot();
      return;
    }

    loadPlotConfigByName(name, (config) => {
      if(!config) return;
      applyPlotConfig(config);
      setPlotConfigSelection(name);
    });
  }

  function switchPlotPanelToConfig(currentEntry, name){
    if(!currentEntry || !name || currentEntry.configName === name) return;
    const geometry = capturePlotPanelGeometry(currentEntry);
    loadPlotConfigByName(name, (config) => {
      if(!config) return;
      removePlotEntryById(currentEntry.id);
      const nextEntry = createPlotPanelFromConfig(config);
      applyPlotPanelGeometry(nextEntry, geometry);
      applyPlotConfig(config);
      setPlotConfigSelection(name);
      focusExistingPlot(nextEntry);
    });
  }

  function restorePlotPanelFromLayout(savedPlot, isConfigureLayout){
    if(!savedPlot) return null;
    const layoutConfig = {
      name: savedPlot.configName || savedPlot.title || `Plot ${plotCounter + 1}`,
      plotType: savedPlot.plotType || 'line',
      xAxisTitle: savedPlot.xAxisTitle || '',
      yAxisTitle: savedPlot.yAxisTitle || '',
      lines: Array.isArray(savedPlot.traces)
        ? savedPlot.traces.map((key) => ({
            key,
            suffix: key,
            style: {
              lineType: 'solid',
              lineWidth: 2,
              lineColor: '#007bff'
            }
          }))
        : []
    };
    const plotEntry = createPlotPanelFromConfig(layoutConfig);
    if(!plotEntry) return null;
    if(savedPlot.id) {
      plotEntry.containerDiv.id = savedPlot.id;
      plotEntry.plotDiv.id = savedPlot.id + '_plot';
    }
    plotEntry.configName = savedPlot.configName || layoutConfig.name;
    if(savedPlot.title) {
      const titleDiv = plotEntry.containerDiv.querySelector('.plot-title-label');
      if(titleDiv) titleDiv.innerText = savedPlot.title;
    }
    if(savedPlot.left) plotEntry.containerDiv.style.left = savedPlot.left;
    if(savedPlot.top) plotEntry.containerDiv.style.top = savedPlot.top;
    if(savedPlot.width) plotEntry.containerDiv.style.width = savedPlot.width;
    if(savedPlot.height) {
      plotEntry.containerDiv.style.height = savedPlot.height;
      plotEntry.plotDiv.style.height = savedPlot.height;
    }
    applyPlotPanelGeometry(plotEntry, {
      left: savedPlot.left || '',
      top: savedPlot.top || '',
      width: savedPlot.width || '',
      height: savedPlot.height || '',
      transform: savedPlot.transform || '',
      zIndex: savedPlot.zIndex || plotEntry.containerDiv.style.zIndex || '5',
      dataX: savedPlot.dataX || '',
      dataY: savedPlot.dataY || ''
    });
    if(isConfigureLayout){
      try { makeDraggable(plotEntry.containerDiv); } catch (e) {}
      try { makeResizable(plotEntry.containerDiv); } catch (e) {}
    }
    setPlotConfigSelection(plotEntry.configName || '');
    return plotEntry;
  }

  function createPlotPanelFromConfig(config, panelOptions){
    if(!config || !Array.isArray(config.lines) || config.lines.length === 0) {
      alert('No lines staged. Use Add Line to stage parameters before creating a plot.');
      return null;
    }

    const plotName = config.name && config.name.trim() ? config.name.trim() : `Plot ${plotCounter + 1}`;
    removePlotEntryByName(plotName);

    const id = 'plot_' + (++plotCounter);
    const requestedPosition = normalizeRequestedPanelPosition(panelOptions && panelOptions.position ? panelOptions.position : panelOptions) || pendingPlotPanelPosition;

    const container = document.createElement('div'); container.className = 'plot-panel'; container.id = id + '_panel';
    container.dataset.plotName = plotName;
    const titleDiv = document.createElement('div');
    titleDiv.className = 'plot-title-label';
    titleDiv.contentEditable = true;
    titleDiv.innerText = plotName;
    titleDiv.title = 'Click to edit plot title';
    titleDiv.style.fontWeight = 'bold';
    titleDiv.style.fontSize = '18px';
    titleDiv.style.textAlign = 'center';
    titleDiv.style.margin = '8px 0 4px 0';
    titleDiv.style.outline = 'none';
    titleDiv.addEventListener('blur', function(){
      Plotly.relayout(plotDiv, { title: '' });
    });
    titleDiv.addEventListener('keydown', function(e){
      if(e.key === 'Enter'){
        e.preventDefault();
        titleDiv.blur();
      }
    });
    container.insertBefore(titleDiv, container.firstChild);

    const plotDiv = document.createElement('div'); plotDiv.id = id + '_plot'; plotDiv.style.width = '100%'; plotDiv.style.height = '360px';

    container.appendChild(plotDiv);
    const grid = document.getElementById('device-grid');
    container.style.position = 'absolute';
    container.style.left = requestedPosition && requestedPosition.left ? requestedPosition.left : '200px';
    container.style.top = requestedPosition && requestedPosition.top ? requestedPosition.top : '80px';
    container.style.width = '700px';
    container.style.maxWidth = 'none';
    container.style.zIndex = '5';
    container.classList.add('device-box', 'plot-panel');
    grid.appendChild(container);

    try {
      makeDraggable(container);
    } catch (e) {
      console.debug('plot is not draggable');
    }
    try {
      makeResizable(container);
    } catch (e) {
      console.debug('plot is not moveable');
    }

    const plotEntry = {
      id,
      containerDiv: container,
      plotDiv: plotDiv,
      traces: {},
      plotType: config.plotType || 'line',
      configName: plotName,
      xAxisTitle: config.xAxisTitle || '',
      yAxisTitle: config.yAxisTitle || ''
    };
    const cachedHistory = plotHistoryCache[plotName] || null;
    const storedLineHistory = plotEntry.plotType === 'line' ? ensureStoredLinePlotHistory(Object.assign({ name: plotName }, config)) : null;
    const savedPlotControl = document.createElement('div');
    savedPlotControl.className = 'plot-saved-control';
    const savedPlotSelect = document.createElement('select');
    savedPlotSelect.className = 'plot-saved-select';
    ['pointerdown', 'mousedown', 'click', 'dblclick'].forEach((eventName) => {
      savedPlotControl.addEventListener(eventName, (event) => {
        event.stopPropagation();
      });
      savedPlotSelect.addEventListener(eventName, (event) => {
        event.stopPropagation();
      });
    });
    savedPlotControl.appendChild(savedPlotSelect);
    container.appendChild(savedPlotControl);
    plotEntry.plotConfigSelect = savedPlotSelect;
    populatePlotConfigSelect(savedPlotSelect, plotName);
    savedPlotSelect.addEventListener('change', () => {
      const nextName = savedPlotSelect.value;
      if(!nextName) return;
      switchPlotPanelToConfig(plotEntry, nextName);
    });
    config.lines.forEach((line) => {
      const key = line.key;
      const prepared = getPreparedStagedLine(line.key, line.style, line.suffix || line.key);
      if(plotEntry.plotType === 'array') {
        plotEntry.traces[key] = { isArrayParent: true, suffix: prepared.suffix, children: {}, name: key, style: prepared.style };
      } else if(plotEntry.plotType === 'xy') {
        const traceLabel = line.label || formatXYLegendLabel(prepared.xKey || line.xKey || '', prepared.yKey || line.yKey || key);
        const trace = { x: [], y: [], name: traceLabel };
        applyTraceStyle(trace, prepared.style);
        plotEntry.traces[key] = {
          x: trace.x,
          y: trace.y,
          traceObj: trace,
          name: traceLabel,
          xKey: prepared.xKey || line.xKey || '',
          yKey: prepared.yKey || line.yKey || '',
          xSuffix: prepared.xSuffix || line.xSuffix || prepared.xKey || line.xKey || '',
          ySuffix: prepared.ySuffix || line.ySuffix || prepared.yKey || line.yKey || '',
          latestX: undefined,
          latestY: undefined,
          latestXSeries: undefined,
          latestYSeries: undefined,
          lastPushedX: undefined,
          lastPushedY: undefined,
          lastPushedSignature: undefined,
          _traceIndex: undefined,
          _lastSent: 0,
          style: prepared.style
        };
      } else {
        const traceLabel = formatLegendLabelForKey(key, key || prepared.suffix || 'trace');
        const trace = { x: [], y: [], mode: 'lines+markers', name: traceLabel };
        applyTraceStyle(trace, prepared.style);
        plotEntry.traces[key] = { x: trace.x, y: trace.y, rawX: [], rawY: [], traceObj: trace, name: traceLabel, suffix: prepared.suffix, _traceIndex: undefined, _lastSent: 0, style: prepared.style };
      }
    });

    if(cachedHistory && cachedHistory.plotType === plotEntry.plotType) {
      if(cachedHistory.xAxisTitle && !plotEntry.xAxisTitle) plotEntry.xAxisTitle = cachedHistory.xAxisTitle;
      if(cachedHistory.yAxisTitle && !plotEntry.yAxisTitle) plotEntry.yAxisTitle = cachedHistory.yAxisTitle;

      Object.keys(cachedHistory.traces || {}).forEach((key) => {
        const cachedTrace = cachedHistory.traces[key];
        if(!cachedTrace || cachedTrace.isArrayParent) return;

        if(plotEntry.traces[key] && plotEntry.traces[key].traceObj) {
          const meta = plotEntry.traces[key];
          meta.rawX = Array.isArray(cachedTrace.x) ? cachedTrace.x.slice() : [];
          meta.rawY = Array.isArray(cachedTrace.y) ? cachedTrace.y.slice() : [];
          syncRenderedLineTrace(meta);
          meta.latestX = cachedTrace.latestX;
          meta.latestY = cachedTrace.latestY;
          meta.latestXSeries = Array.isArray(cachedTrace.latestXSeries) ? cachedTrace.latestXSeries.slice() : undefined;
          meta.latestYSeries = Array.isArray(cachedTrace.latestYSeries) ? cachedTrace.latestYSeries.slice() : undefined;
          meta.lastPushedX = cachedTrace.lastPushedX;
          meta.lastPushedY = cachedTrace.lastPushedY;
          meta.lastPushedSignature = cachedTrace.lastPushedSignature;
          return;
        }

        if(plotEntry.plotType === 'array' && cachedTrace.parent && plotEntry.traces[cachedTrace.parent]) {
          const traceObj = {
            x: Array.isArray(cachedTrace.x) ? cachedTrace.x.slice() : [],
            y: Array.isArray(cachedTrace.y) ? cachedTrace.y.slice() : [],
            mode: 'lines+markers',
            name: cachedTrace.name || key
          };
          applyTraceStyle(traceObj, cachedTrace.style || plotEntry.traces[cachedTrace.parent].style || {});
          plotEntry.traces[key] = {
            traceObj,
            suffix: cachedTrace.suffix || key,
            _traceIndex: undefined,
            _lastSent: 0,
            parent: cachedTrace.parent,
            style: cachedTrace.style || plotEntry.traces[cachedTrace.parent].style || {}
          };
        }
      });
    }

    if(storedLineHistory && storedLineHistory.traces) {
      Object.keys(storedLineHistory.traces).forEach((key) => {
        const storedTrace = storedLineHistory.traces[key];
        const meta = plotEntry.traces[key];
        if(!storedTrace || !meta || !meta.traceObj) return;
        meta.rawX = Array.isArray(storedTrace.x) ? storedTrace.x.slice() : [];
        meta.rawY = Array.isArray(storedTrace.y) ? storedTrace.y.slice() : [];
        syncRenderedLineTrace(meta);
      });
    }

    plotsMap[id] = plotEntry;
    const initTraceMetas = Object.values(plotEntry.traces).filter(t => t && t.traceObj);
    Plotly.newPlot(plotDiv, initTraceMetas.map(t=>t.traceObj), layoutForType(plotEntry.plotType, plotEntry), getPlotlyRenderConfig()).then(()=>{
      initTraceMetas.forEach((t,i)=>{ t._traceIndex = i; if (Array.isArray(t.x)) t._lastSent = t.x.length; });
      Plotly.relayout(plotDiv, { title: '' });
      if (titleDiv.parentNode !== container) {
        container.insertBefore(titleDiv, container.firstChild);
      }
      const next = titleDiv.nextSibling;
      if (next && next.className && (next.className.includes('plot-param-labels') || next.className.includes('plot-legend-labels'))) {
        container.removeChild(next);
      }
      if(plotEntry.plotType === 'line') {
        hydrateLinePlotHistory(plotEntry).catch(() => {});
      }
    }).catch(e=>{ console.warn('Plotly.newPlot failed', e); });

    function makePanelDraggableResizable(container, plotDiv) {
      if (window.interact) {
        interact(container)
        .draggable({
          inertia: true,
          listeners: {
            move (event) {
              if (!arePlotPanelsMovable()) return;
              const x = (parseFloat(container.getAttribute('data-x')) || 0) + event.dx;
              const y = (parseFloat(container.getAttribute('data-y')) || 0) + event.dy;
              container.style.transform = `translate(${x}px, ${y}px)`;
              container.setAttribute('data-x', x);
              container.setAttribute('data-y', y);
            }
          }
        })
        .resizable({
          edges: { left: true, right: true, bottom: true, top: true },
          listeners: {
            move (event) {
              if (!arePlotPanelsMovable()) return;
              let { x, y } = event.target.dataset;
              x = (parseFloat(x) || 0) + event.deltaRect.left;
              y = (parseFloat(y) || 0) + event.deltaRect.top;
              Object.assign(event.target.style, {
                width: `${event.rect.width}px`,
                height: `${event.rect.height}px`,
                transform: `translate(${x}px, ${y}px)`
              });
              event.target.dataset.x = x;
              event.target.dataset.y = y;
              try { Plotly.Plots.resize(plotDiv); } catch(e) {}
            }
          },
          inertia: true
        });
      } else {
        setTimeout(()=>makePanelDraggableResizable(container, plotDiv), 500);
      }
    }

    makePanelDraggableResizable(container, plotDiv);
    pendingPlotPanelPosition = null;
    return plotEntry;
  }

  function dashForLineType(lineType){
    if(lineType === 'dashed') return 'dash';
    if(lineType === 'dotted') return 'dot';
    return 'solid';
  }

  function getSelectedCurveStyle(){
    const style = getBaseCurveStyleFromControls();
    if(isXYPlotType()) {
      style.xyChartType = xyChartTypeSelect && xyChartTypeSelect.value ? xyChartTypeSelect.value : 'area';
    }
    if(plotTypeSelect && plotTypeSelect.value === 'array') {
      style.arrayElementStyles = getArrayElementStylesFromPanel();
    }
    return style;
  }

  function applyTraceStyle(traceObj, style){
    if(!traceObj) return;
    const nextStyle = style || {};
    const xyChartType = nextStyle.xyChartType;

    if(xyChartType === 'bar') {
      traceObj.type = 'bar';
      traceObj.orientation = 'v';
      delete traceObj.mode;
      delete traceObj.fill;
      delete traceObj.line;
      traceObj.marker = Object.assign({}, traceObj.marker || {}, {
        color: nextStyle.lineColor || '#007bff',
        line: {
          width: nextStyle.lineWidth || 1,
          color: nextStyle.lineColor || '#007bff'
        }
      });
      return;
    }

    if(xyChartType === 'area') {
      traceObj.type = 'scatter';
      delete traceObj.orientation;
      traceObj.mode = 'lines';
      traceObj.fill = 'tozeroy';
    }
    traceObj.line = Object.assign({}, traceObj.line || {}, {
      width: nextStyle.lineWidth || 2,
      color: nextStyle.lineColor || '#007bff',
      dash: dashForLineType(nextStyle.lineType || 'solid')
    });
    traceObj.marker = Object.assign({}, traceObj.marker || {}, {
      color: nextStyle.lineColor || '#007bff'
    });
  }

  function withTimeRangeControls(layout){
    const nextLayout = Object.assign({}, layout || {});
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

  function loadDeviceParams(){
    // try common static locations first, then absolute on localhost:8080 (user's server port)
    const candidates = [
      '/c/device_params.json','/s/device_params.json','/device_params.json','/configuration/device_params.json','/content/device_params.json','./device_params.json',
      'http://localhost:8080/c/device_params.json','http://localhost:8080/s/device_params.json','http://localhost:8080/device_params.json','http://localhost:8080/configuration/device_params.json','http://localhost:8080/content/device_params.json'
    ];
    let i = 0;

    function tryNext(){

      if(i>=candidates.length){

        const deviceParams = window.SEAppState.getDeviceParams();
        if(deviceParams) return populateDeviceParams(deviceParams);

    
        // As a last resort, try fetching a nodes list which may contain descriptive params
        fetch('/configuration/nodes.json').then(r=>{ if(!r.ok) throw new Error('not ok'); return r.json(); }).then(nodes=>{
          // try to build a minimal params structure by querying each node's descriptive endpoint

          const pending = [];

          const built = {};

          nodes.forEach(n=>{

            const base = `http://${n.host}:${n.port}`;

            const url = base + '/describe';

            const p = fetch(url).then(r=> r.ok ? r.json() : null).then(desc => {

              if(desc && desc.params){

                built[desc.name || (n.host + '_' + n.port)] = { params: desc.params, original_name: desc.original_name || desc.name };
              }

            }).catch(()=>{});

            pending.push(p);

          });

          Promise.all(pending).then(()=>{

            if(Object.keys(built).length) return populateDeviceParams(built);

          

          });

        }).catch(()=>{

      

        });
        return;
      }

      const url = candidates[i++];

      

      fetch(url).then(r=>{ if(!r.ok) throw new Error('not ok'); return r.json(); }).then(data=>{

        populateDeviceParams(data);

      }).catch((e)=>{ 
         tryNext(); });

    }

    tryNext();

  }

  function populateParamSelect(selectEl, data, placeholder){
    if(!selectEl) return;
    selectEl.innerHTML = `<option value="">${placeholder}</option>`;
    if(!data) return;

    Object.keys(data).sort().forEach(device => {
      const info = data[device] || {};
      const params = info.all_params || info.params || info.param_list || [];
      const displayDevice = info.original_name || device;

      params.forEach(p => {
        const opt = document.createElement('option');
        opt.value = device + '.' + p;
        opt.text = displayDevice + '.' + p;
        opt.title = device + '.' + p;
        selectEl.add(opt);
      });
    });
  }

  function populateDeviceParams(data){
    currentDeviceParamsData = data || {};
    populateParamSelect(deviceParamsSelect, data, '-- select device.param --');
    populateParamSelect(xyCurveXSelect, data, '-- select x device.param --');
    populateParamSelect(xyCurveYSelect, data, '-- select y device.param --');
    refreshArrayElementStylePanel();
  }

 

  function layoutForType(typeOverride, plotMeta){

    const type = typeOverride || (plotTypeSelect ? plotTypeSelect.value : 'line');

    const layout = { title: '', xaxis:{type:'date'}, margin:{t:30}, uirevision: (plotMeta && (plotMeta.id || plotMeta.configName)) ? `${plotMeta.id || plotMeta.configName}:yaxis` : 'plot-yaxis' };

    if(type === 'xy') {
      layout.xaxis = { title: (plotMeta && plotMeta.xAxisTitle) ? plotMeta.xAxisTitle : 'X', type: 'linear' };
      layout.yaxis = { title: (plotMeta && plotMeta.yAxisTitle) ? plotMeta.yAxisTitle : 'Y', type: 'linear' };
    } else {
      layout.yaxis = { title: (plotMeta && plotMeta.yAxisTitle) ? plotMeta.yAxisTitle : '', type: 'linear' };
    }

    layout.yaxis = Object.assign({}, layout.yaxis || {}, {
      autorange: true
    });

    if (!arePlotPanelsMovable()) {
      layout.dragmode = false;
      layout.xaxis = Object.assign({}, layout.xaxis || {}, { fixedrange: true });
      layout.yaxis = Object.assign({}, layout.yaxis || {}, { fixedrange: true });
    }

    return withTimeRangeControls(layout);

  }

  function refreshPlot(){
    // refresh all created plots
    Object.values(plotsMap).forEach(p => {

      if(p.plotType === 'line') {
        Object.values(p.traces).forEach((meta) => {
          if(meta && meta.traceObj) syncRenderedLineTrace(meta);
        });
      }

      // Only include traces that have an actual Plotly trace object (skip placeholders)
      const traceMetas = Object.values(p.traces).filter(t => t && t.traceObj);
      const data = traceMetas.map(t => t.traceObj);

      // update the whole plot with only the real traces
      Plotly.react(p.plotDiv, data, layoutForType(p.plotType, p), getPlotlyRenderConfig()).then(()=>{
        traceMetas.forEach((t,i)=> t._traceIndex = i);
        Plotly.relayout(p.plotDiv, { 'yaxis.autorange': true }).catch(() => {});
      }).catch(e=>{ });
  
    });
  
  }

  // Enable draggable/resizable behavior for a plot panel using interact.js if available.
  function enablePlotPanelDragResize(container, plotDiv) {
    if (window.interact) {
      try {
        interact(container)
        .draggable({
          inertia: true,
          listeners: {
            move (event) {
              if (!arePlotPanelsMovable()) return;
              const x = (parseFloat(container.getAttribute('data-x')) || 0) + event.dx;
              const y = (parseFloat(container.getAttribute('data-y')) || 0) + event.dy;
              container.style.transform = `translate(${x}px, ${y}px)`;
              container.setAttribute('data-x', x);
              container.setAttribute('data-y', y);
            }
          }
        })
        .resizable({
          edges: { left: true, right: true, bottom: true, top: true },
          listeners: {
            move (event) {
              if (!arePlotPanelsMovable()) return;
              let { x, y } = event.target.dataset;
              x = (parseFloat(x) || 0) + event.deltaRect.left;
              y = (parseFloat(y) || 0) + event.deltaRect.top;
              Object.assign(event.target.style, {
                width: `${event.rect.width}px`,
                height: `${event.rect.height}px`,
                transform: `translate(${x}px, ${y}px)`
              });
              event.target.dataset.x = x;
              event.target.dataset.y = y;
              // Resize plotly plot
              try { Plotly.Plots.resize(plotDiv); } catch(e) {}
            }
          },
          inertia: true
        });
      } catch(e) { console.debug('enablePlotPanelDragResize failed', e); }
    } else {
      setTimeout(()=>enablePlotPanelDragResize(container, plotDiv), 500);
    }
  }

  function addLine(){
    let key = '';
    let preparedLine = null;
    const style = getSelectedCurveStyle();

    if(isXYPlotType()) {
      const xKey = xyCurveXSelect && xyCurveXSelect.value ? xyCurveXSelect.value.trim() : '';
      const yKey = xyCurveYSelect && xyCurveYSelect.value ? xyCurveYSelect.value.trim() : '';
      if(!xKey || !yKey) return alert('Select both X and Y device parameters to add an XY curve');
      key = createXYLineKey(xKey, yKey);
      preparedLine = getPreparedStagedLine(key, style, key, {
        xKey,
        yKey,
        xSuffix: xKey,
        ySuffix: yKey,
        label: `${yKey} vs ${xKey}`
      });
    } 
    else 
    {
      key = deviceParamsSelect && deviceParamsSelect.value ? deviceParamsSelect.value.trim() : '';
      if(!key) return alert('Select a device parameter to add');
      preparedLine = getPreparedStagedLine(key, style, key);
    }

    if(staged[key]) return alert('Parameter already staged');

    staged[key] = preparedLine;
  
    rebuildStagedLinesSelect();
    setSelectedStagedLine(key);
  }

  function deleteLine(){
  
    const key = getSelectedStagedLineKey();
    if(!key) return alert('Select a staged line to delete');
  
    if(!staged[key]) return alert('Selected staged line not found');
  
    delete staged[key];
    rebuildStagedLinesSelect();
  
  }

  // Keep all points for the current browser session.
  function trimTraces(){
  
    Object.values(plotsMap).forEach(p=>{

      Object.values(p.traces).forEach(t=>{
        // skip placeholder/parent entries that don't have a traceObj
        if(!t || !t.traceObj) return;
        let removed = 0;
        while(t.traceObj.x.length > MAX_STORED_PLOT_HISTORY_POINTS){ t.traceObj.x.shift(); t.traceObj.y.shift(); removed++; }
        if(removed && typeof t._lastSent === 'number'){
  
          t._lastSent = Math.max(0, t._lastSent - removed);
  
        }
  
      });
  
    });
  
  }

  function normalizeXYSeriesValues(value){
    if (Array.isArray(value)) {
      return value.map((item) => (typeof item === 'number' ? item : parseFloat(item)));
    }

    const numericValue = (typeof value === 'number') ? value : parseFloat(value);
    return Number.isFinite(numericValue) ? [numericValue] : [];
  }

  function appendXYSeriesPoints(plotEntry, meta){
    if (!meta || !meta.traceObj) return false;

    const xValues = Array.isArray(meta.latestXSeries) ? meta.latestXSeries : [];
    const yValues = Array.isArray(meta.latestYSeries) ? meta.latestYSeries : [];
    const pairCount = Math.min(xValues.length, yValues.length);
    if (!pairCount) return false;

    const nextX = [];
    const nextY = [];
    for (let i = 0; i < pairCount; i += 1) {
      const xValue = xValues[i];
      const yValue = yValues[i];
      if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue;
      nextX.push(xValue);
      nextY.push(yValue);
    }

    if (!nextX.length || !nextY.length) return false;

    const batchSignature = JSON.stringify({ x: nextX, y: nextY });
    if (meta.lastPushedSignature === batchSignature) return false;

    meta.traceObj.x.push(...nextX);
    meta.traceObj.y.push(...nextY);
    meta.lastPushedX = nextX[nextX.length - 1];
    meta.lastPushedY = nextY[nextY.length - 1];
    meta.lastPushedSignature = batchSignature;

    return true;
  }

  // Flush buffered points to the visible Plotly plots every interval (append new points)
  function flushBufferedPoints(){
  
    Object.values(plotsMap).forEach(p => {

      if(p.plotType === 'line') {
        if(!p._dirty) return;

        try {
          const traceMetas = Object.values(p.traces).filter(tt => tt && tt.traceObj);
          traceMetas.forEach((tt) => syncRenderedLineTrace(tt));
          const data = traceMetas.map(tt => tt.traceObj);
          Plotly.react(p.plotDiv, data, layoutForType(p.plotType, p), getPlotlyRenderConfig()).then(()=>{
            traceMetas.forEach((tt, i) => {
              tt._traceIndex = i;
              tt._lastSent = Array.isArray(tt.rawX) ? tt.rawX.length : tt.traceObj.x.length;
            });
            p._dirty = false;
            Plotly.relayout(p.plotDiv, { 'yaxis.autorange': true }).catch(() => {});
          }).catch(e=>{ console.error('Plotly.react failed during line flush', e); });
        } catch (e) {
          console.error('Line plot flush failed', e);
        }
        return;
      }
  
      const traces = Object.values(p.traces);
  
      let needFullReact = false;
  
      traces.forEach((t, idx) => {
        // Only append new points since last flush. Skip parents without traceObj.
        if (!t || !t.traceObj) return;
        const last = t._lastSent || 0;
  
        const newX = t.traceObj.x.slice(last);
  
        const newY = t.traceObj.y.slice(last);
  
        if(newX.length > 0 && newY.length > 0 && typeof t._traceIndex === 'number'){
  
          try {
  
            Plotly.extendTraces(p.plotDiv, { x: [newX], y: [newY] }, [t._traceIndex]);
            Plotly.relayout(p.plotDiv, { 'yaxis.autorange': true }).catch(() => {});
  
          } catch(e) {
  
           
  
            needFullReact = true;
  
          }
  
          t._lastSent = t.traceObj.x.length;
  
        }
  
      });
  
      if(needFullReact){
  
        try{

          // Only include real trace objects in full react
          const traceMetas = traces.filter(tt => tt && tt.traceObj);
          const data = traceMetas.map(tt=>tt.traceObj);
          Plotly.react(p.plotDiv, data, layoutForType(p.plotType, p), getPlotlyRenderConfig()).then(()=>{
            traceMetas.forEach((tt,i)=> tt._traceIndex = i);
            traceMetas.forEach(tt=> tt._lastSent = tt.traceObj.x.length);
            Plotly.relayout(p.plotDiv, { 'yaxis.autorange': true }).catch(() => {});
          }).catch(e=>{ console.error('Plotly.react failed during flush', e); });

        }
        catch(e)
        { 
          console.error('Full react failed during flush', e);
        }
      }
    });
}

  // Ensure child traces exist for an array-valued parent. Creates traces and legend inputs
  function ensureArrayChildTraces(plotEntry, parentKey, length)
  {
  

    if (!plotEntry || !parentKey || length <= 0) return;
      const toAdd = [];
    for (let i = 0; i < length; i++) 
    {
      const childKey = `${parentKey}::${i}`;
      if (!plotEntry.traces[childKey]) 
      {
        const name = getArrayChildTraceLabel(parentKey, i, (plotEntry.traces[parentKey] || {}).style);
        const traceObj = { x: [], y: [], mode: 'lines+markers', name: name };
        const parentMeta = plotEntry.traces[parentKey] || {};
        const childStyle = getArrayChildStyle(parentMeta.style, i);
        applyTraceStyle(traceObj, childStyle);
        plotEntry.traces[childKey] = { traceObj: traceObj, suffix: childKey, _traceIndex: undefined, _lastSent: 0, parent: parentKey, style: childStyle };
        toAdd.push({ traceObj: traceObj, childKey: childKey });
      }
    }
    if (toAdd.length && plotEntry.plotDiv) 
      {
      // add traces to plotly; this appends to the end
      const traceObjs = toAdd.map(t => t.traceObj);
      try {
        Plotly.addTraces(plotEntry.plotDiv, traceObjs).then(() => {
          // assign indices for newly added traces by matching names from the end
          const dataLen = plotEntry.plotDiv.data.length;
          for (let j = 0; j < toAdd.length; j++) {
            const idx = dataLen - toAdd.length + j;
            const childKey = toAdd[j].childKey;
            if (plotEntry.traces[childKey]) plotEntry.traces[childKey]._traceIndex = idx;
          }
        }).catch(e => { console.warn('addTraces failed', e); });
      } catch (e) { console.warn('Plotly.addTraces failed', e); }
    } else {
      // nothing else to do for traces not yet added
      toAdd.forEach(t => {});
    }
  }

  function handlePlotUpdateEvent(ev){
  
    try
    {
      if (typeof window.isConfigurationModeActive === 'function' && window.isConfigurationModeActive()) {
        return;
      }
   
      const emittedKey = ev.detail.key || '';

      if(emittedKey === 'nodemanager.list_plot_configs') {
        mergePlotConfigNames(ev.detail.value);
        return;
      }

      // Use ev.detail.value.value if present, else fallback
      
      const val = (ev.detail.value && typeof ev.detail.value.value !== 'undefined') ? ev.detail.value.value : ev.detail.value;
      latestPlotValues[emittedKey] = val;

      if (plotTypeSelect && plotTypeSelect.value === 'array' && deviceParamsSelect && deviceParamsSelect.value && plotKeyMatches(emittedKey, deviceParamsSelect.value)) {
        refreshArrayElementStylePanel();
      }
   
      const eventTimestampMs = normalizePlotEventTimestamp(ev.detail && ev.detail.timestamp_ms, ev.type);
      const now = new Date(eventTimestampMs);
      appendToStoredLinePlotHistories(emittedKey, val, now);
      // route update to all created plot traces that match
      // mark plots that received updates so we only redraw those
   
      const updatedPlots = new Set();
   
      let matched = false;
   
      Object.values(plotsMap).forEach(p=>{
   
        Object.keys(p.traces).forEach(k=>{
   
          try{
   
            const meta = p.traces[k];
   
            const xyMatchX = p.plotType === 'xy' && meta && meta.xSuffix && (plotKeyMatches(emittedKey, meta.xKey) || plotKeyMatches(emittedKey, meta.xSuffix));
            const xyMatchY = p.plotType === 'xy' && meta && meta.ySuffix && (plotKeyMatches(emittedKey, meta.yKey) || plotKeyMatches(emittedKey, meta.ySuffix));

            if(xyMatchX || xyMatchY || plotKeyMatches(emittedKey, k) || (meta && plotKeyMatches(emittedKey, meta.suffix))){
   
              matched = true;
    
              // Array-typed parent: create child traces & route each element
              if (meta && meta.isArrayParent && Array.isArray(val)) 
                {
                
                const parentKey = k;
                ensureArrayChildTraces(p, parentKey, val.length);
                val.forEach((elem, idx) => {
                  const childKey = `${parentKey}::${idx}`;
                  const childMeta = p.traces[childKey];
                  if (!childMeta) return;
                  const yval = (typeof elem === 'number') ? elem : (parseFloat(elem) || null);
                  childMeta.traceObj.x.push(now);
                  childMeta.traceObj.y.push(yval);
                });
                updatedPlots.add(p.id);
              } else if (p.plotType === 'xy' && meta && meta.traceObj && (xyMatchX || xyMatchY)) {
                const numericSeries = normalizeXYSeriesValues(val);
                if(numericSeries.length) {
                  if(xyMatchX) {
                    meta.latestXSeries = numericSeries;
                    meta.latestX = numericSeries[numericSeries.length - 1];
                  }
                  if(xyMatchY) {
                    meta.latestYSeries = numericSeries;
                    meta.latestY = numericSeries[numericSeries.length - 1];
                  }

                  if(appendXYSeriesPoints(p, meta)) {
                    updatedPlots.add(p.id);
                  }
                }
              } else {
                // scalar handling
                let yval;
                if(Array.isArray(val))
                {
                  yval = JSON.stringify(val);
                } else {
                  yval = (typeof val === 'number') ? val : (parseFloat(val) || null);
                }
                if (meta && meta.traceObj) 
                {
                  if(Array.isArray(meta.rawX) && Array.isArray(meta.rawY)) {
                    meta.rawX.push(now);
                    meta.rawY.push(yval);
                  } else {
                    meta.traceObj.x.push(now);
                    meta.traceObj.y.push(yval);
                  }
                  // skip parent placeholders during per-trace restyle/extend; they don't have traceObj
                  if (meta && meta.isArrayParent) return;
                  p._dirty = true;
                  updatedPlots.add(p.id);
                }
              }
            }
   
          } 
          catch(_e)
          { 
            console.error(_e); 
          }
   
        });
   
      });
    }
    catch(e)
    {
      console.error('plot update error', e);
    }
  }

  // Handle live Spin updates and polled plot-history updates separately so
  // non-plot UI listeners do not rerun for the polling path.
  window.addEventListener('spinupdate', handlePlotUpdateEvent);
  window.addEventListener('plotupdate', handlePlotUpdateEvent);

      addBtn && addBtn.addEventListener('click', addLine);

      deleteBtn && deleteBtn.addEventListener('click', deleteLine);

      plotConfigSelect && plotConfigSelect.addEventListener('change', handleTopLevelPlotConfigSelection);
      deletePlotConfigBtn && deletePlotConfigBtn.addEventListener('click', deleteSelectedPlotConfig);

      plotTypeSelect && plotTypeSelect.addEventListener('change', () => {
        updatePlotTypeControls();
        refreshArrayElementStylePanel();
        refreshPlot();
      });

      deviceParamsSelect && deviceParamsSelect.addEventListener('change', () => {
        refreshArrayElementStylePanel();
      });

      arrayElementStyleToggle && arrayElementStyleToggle.addEventListener('click', () => {
        const isOpen = arrayElementStyleGroup && arrayElementStyleGroup.classList.contains('is-open');
        setArrayElementStyleDropdownOpen(!isOpen);
      });

      xyChartTypeSelect && xyChartTypeSelect.addEventListener('change', refreshPlot);

      createBtn && createBtn.addEventListener('click', ()=>{
        const enteredName = prompt('Enter a name for this plot:', activeSavedPlotName || `Plot ${plotCounter + 1}`);
        if(!enteredName) return;
        const plotName = enteredName.trim();
        if(!plotName) return;
        const config = getCurrentPlotConfig(plotName);
        if(!config.lines.length) return alert('No lines staged. Use Add Line to stage parameters before creating a plot.');
        storePlotConfigLocally(plotName, config);
        updatePlotConfigList(plotName);
        setPlotConfigSelection(plotName);
        const createdPlot = createPlotPanelFromConfig(config, { position: pendingPlotPanelPosition });
        if(!createdPlot) return;
        if(window.Spin && window.Spin.send_request){
          try {
            window.Spin.send_request('nodemanager.save_plot_config', '', 'input', 'set', {name: plotName, config: config});
            window.Spin.send_request('nodemanager.list_plot_configs', '', 'read', 'read', null);
          } catch (e) {
            console.error('save_plot_config request failed', e);
          }
        }
        closePlotConfigurationWindow();
      });

  // start
  ensurePlotConfigurationWindowShell();
  closePlotConfigurationWindow();
  updatePlotTypeControls({ clearIncompatibleStaged: false });
  setArrayElementStyleDropdownOpen(true);
  refreshArrayElementStylePanel();
  loadDeviceParams();
  updatePlotConfigList();
  if(typeof waitForSpin === 'function') {
    waitForSpin(updatePlotConfigList);
  }
  // Periodically trim old points only. Avoid forcing full redraws here because
  // they can replace the Plotly state and clear trace indices used for extendTraces.
  setInterval(()=>{
    if (typeof window.isConfigurationModeActive === 'function' && window.isConfigurationModeActive()) {
      return;
    }
    trimTraces();
    flushBufferedPoints();
  }, 2000);

  // --- Auto-plot creation from data-spin-plot attributes / SVG inkscape:label ---
  // Lightweight parser for `data-spin-plot` specs. Syntax supported:
  //   Title @device.param 'Label' key=val token
  // Returns { title, globals: {}, curves: [{ name, param, label, mods }] }
  function parseDataSpinPlot(spec){
    const res = { title: '', globals: {}, curves: [] };
    if(!spec || !spec.trim()) return res;

    // Title is the prefix before the first '@'
    const parts = spec.split('@');
    res.title = parts[0].trim();

    for(let i = 1; i < parts.length; i++){
      let seg = parts[i].trim();
      if(!seg) continue;

      // First token is the device[.param]
      const mName = seg.match(/^([^\s'\"]+)/);
      if(!mName) continue;
      const nameParam = mName[1];
      seg = seg.slice(nameParam.length).trim();

      // Optional label in single or double quotes
      let label = null;
      const mLabel = seg.match(/^(['"])(.*?)\1/);
      if(mLabel){ label = mLabel[2]; seg = seg.slice(mLabel[0].length).trim(); }

      // Mods: key=val pairs and standalone tokens
      const mods = {};
      const modRegex = /(\w+)=('.*?'|".*?"|[^\s]+)/g;
      let mm;
      while((mm = modRegex.exec(seg)) !== null){
        let val = mm[2];
        if((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))){
          val = val.slice(1,-1);
        }
        mods[mm[1]] = val;
      }
      // standalone tokens (e.g., flags)
      seg.replace(/(^|\s)([a-zA-Z_][\w-]*)/g, (all, sp, tok) => { if(!(tok in mods)) mods[tok] = true; return ''; });

      let name = nameParam; let param = null;
      if(nameParam.indexOf('.') !== -1){ const ps = nameParam.split('.'); name = ps.slice(0,-1).join('.'); param = ps[ps.length-1]; }

      res.curves.push({ name, param, label, mods });
    }

    return res;
  }

  // create plot from spec
  function createPlotFromSpec(spec, hostEl)
  {
    const parsed = parseDataSpinPlot(spec);
    const id = 'plot_auto_' + (++plotCounter);
    let container, plotDiv;

    if(hostEl && hostEl.tagName === 'DIV'){
      container = hostEl; container.classList.add('plot-panel');
      plotDiv = document.createElement('div'); plotDiv.style.width='100%'; plotDiv.style.height='360px';
      container.appendChild(plotDiv);
    } 
    else 
    {
      container = document.createElement('div'); container.className = 'plot-panel';
  
      const header = document.createElement('div'); header.className = 'plot-header';
  
      header.innerHTML = `<div><strong>${parsed.title || 'Plot'}</strong></div>`;
  
      plotDiv = document.createElement('div'); plotDiv.style.width='100%'; plotDiv.style.height='360px';
  
      container.appendChild(header); container.appendChild(plotDiv);
  
      const grid2 = document.getElementById('device-grid');
  
      container.style.position = 'absolute'; container.style.left = '220px'; container.style.top = '120px';
  
      container.style.width = '700px'; container.style.maxWidth = 'none'; container.style.zIndex = '5';
  
      container.classList.add('device-box', 'plot-panel');
  
      grid2.appendChild(container);
  
      try 
      {
         makeDraggable(container); 
      } 
      catch 
      (e) 
      {
          console.debug("plot is not draggable"); 
      }
  
      try 
      {
         makeResizable(container);
      } 
      catch 
      (e) 
      {
          console.debug("plot is not resizable"); 
      }
    }

    const plotEntry = { id, containerDiv: container, plotDiv: plotDiv, traces: {} };
   
    const layout = withTimeRangeControls({ title: parsed.title || '', xaxis:{type:'date'}, margin:{t:30} });
   
    if(parsed.globals && parsed.globals.fontsize) 
    
      layout.font = { size: parseInt(parsed.globals.fontsize,10) };
    
    if(parsed.globals && parsed.globals.legend === 'right')
      
    {
       layout.legend = { orientation:'v', x:1.02, y:1 };
    }
    
    else if(parsed.globals && parsed.globals.legend === 'none')
      
    { 
        layout.showlegend = false; 
    }
    
    if(parsed.curves.some(c=> c.mods && c.mods.y2)){ layout.yaxis2 = { overlaying: 'y', side: 'right' }; }

    parsed.curves.forEach((c)=>{
      const fullKey = (c.name && c.param) ? (c.name + '.' + c.param) : (c.name || '');
      const trace = { x: [], y: [], mode: 'lines+markers', name: c.label || fullKey };
      if(c.mods && c.mods.color){ trace.marker = trace.marker || {}; trace.marker.color = c.mods.color; }
      if(c.mods && c.mods.symbol){ trace.marker = trace.marker || {}; trace.marker.symbol = c.mods.symbol; }
      if(c.mods && c.mods.line){ trace.line = { width: parseFloat(c.mods.line) || 0 }; if(c.mods.line === '0') trace.mode = 'markers'; }
      if(c.mods && c.mods.y2) trace.yaxis = 'y2';
      plotEntry.traces[fullKey] = { traceObj: trace, suffix: fullKey, _traceIndex: undefined, _lastSent: 0 };
    });

    plotsMap[id] = plotEntry;
    const initTraceMetasAuto = Object.values(plotEntry.traces).filter(t => t && t.traceObj);
    Plotly.newPlot(plotDiv, initTraceMetasAuto.map(t=>t.traceObj), layout, getPlotlyRenderConfig()).then(()=>{
      initTraceMetasAuto.forEach((t,i)=> t._traceIndex = i);
      try { enablePlotPanelDragResize(container, plotDiv); } catch(e) {}
      // (legend editor removed)
    }).catch(e=>{ console.warn('Plotly.newPlot auto plot failed', e); });
  }

  function scanDataSpinPlots(){
    try
    {
      document.querySelectorAll('div[data-spin-plot]').forEach(d => 
      {
        const spec = d.getAttribute('data-spin-plot'); if(spec) createPlotFromSpec(spec, d);
      });
      document.querySelectorAll('rect').forEach(r => 
      {
        const lbl = r.getAttribute('inkscape:label') || r.getAttribute('data-inkscape-label');
        if(lbl && lbl.trim().startsWith('!plot '))
            {
    // remove the leading '!plot ' prefix in a safe, modern way
        const spec = lbl.trim().replace(/^!plot\s+/i, '').trim();
        if (spec) createPlotFromSpec(spec, null);
            }
     });
    }
    catch(e)
    {
         console.error('scanDataSpinPlots failed', e);
    }
  }

  setTimeout(scanDataSpinPlots, 500);

  window.SEPlotUi = {
    openConfigurationWindow: openPlotConfigurationWindow,
    closeConfigurationWindow: closePlotConfigurationWindow,
    resetConfigurationEditor: resetPlotConfigurationEditor,
    getSavedPlotNames: getSavedPlotNames,
    createSavedPlotByName: createSavedPlotByName,
    refreshSavedPlotNames: updatePlotConfigList
  };

  // expose minimal API for debugging
  window.SEAppState.setPlots({ plotsMap: plotsMap, staged: staged, restorePlotPanelFromLayout: restorePlotPanelFromLayout, capturePlotPanelGeometry: capturePlotPanelGeometry, applyPlotPanelGeometry: applyPlotPanelGeometry, _restoreCounter: window.SEAppState.getPlots()._restoreCounter || 0 });


})();
// Make sure interact.js is loaded
(function ensureInteractLoaded(){

  if (!window.interact) {

    const script = document.createElement('script');

    script.src = 'https://cdn.jsdelivr.net/npm/interactjs/dist/interact.min.js';

    script.onload = function(){};

    document.head.appendChild(script);

  }

})();
