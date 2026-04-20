// --- Polling API for live updates ---
//Polls /api/latest_values every 2s and dispatches spinupdate events for each key/value

function startPollingLatestValues() {

  setInterval(() => {
    // Use the current page host so requests work when UI is served from a different host
    // (e.g. container/host mappings). Port 8001 is where the backend Flask API serves latest values.

    const host = window.location.hostname || 'localhost';

    const url = `${window.location.protocol}//${host}:8001/api/latest_values`;

    fetch(url)

    .then(r => r.json())

    .then(data => {
        Object.entries(data).forEach(([key, meta]) => {
          // `meta` is expected to be an object like { value, unit, state, state_str }
          const evDetail = {
            key: key,
            value: meta && (meta.value !== undefined ? meta.value : meta),
            unit: meta && meta.unit,
            state: meta && meta.state,
            state_str: meta && meta.state_str
          };
          const ev = new CustomEvent('spinupdate', { detail: evDetail });
          window.dispatchEvent(ev);
        });
      })
      .catch(e => console.warn('[Polling] Failed to fetch latest values from', url, e));
  }, 2000);
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
  const curveLineTypeSelect = document.getElementById('curve-line-type');
  const curveLineWidthSelect = document.getElementById('curve-line-width');
  const curveLineColorInput = document.getElementById('curve-line-color');

  const addBtn = document.getElementById('add-curve');

  const addedLinesSelect = document.getElementById('added-lines');

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
  let plotCounter = 0;

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
    return `${line.key} (${type}, ${width}px)`;
  }

  function clearStagedLines(){
    Object.keys(staged).forEach(key => delete staged[key]);
    if(!addedLinesSelect) return;
    addedLinesSelect.innerHTML = '<option value="">-- added lines --</option>';
    addedLinesSelect.size = 1;
    addedLinesSelect.value = '';
  }

  function rebuildStagedLinesSelect(){
    if(!addedLinesSelect) return;
    const keys = Object.keys(staged);
    addedLinesSelect.innerHTML = '';
    if(keys.length === 0) {
      addedLinesSelect.innerHTML = '<option value="">-- added lines --</option>';
      addedLinesSelect.size = 1;
      addedLinesSelect.value = '';
      return;
    }
    addedLinesSelect.size = Math.min(Math.max(keys.length, 2), 6);
    keys.forEach((key) => {
      const meta = staged[key] || {};
      const option = document.createElement('option');
      option.value = key;
      option.textContent = getDisplayLabelForLine({ key, style: meta.style });
      addedLinesSelect.add(option);
    });
    addedLinesSelect.selectedIndex = 0;
  }

  function getPreparedStagedLine(key, style, suffix){
    return {
      suffix: suffix || key,
      style: Object.assign({
        lineType: 'solid',
        lineWidth: 2,
        lineColor: '#007bff'
      }, style || {})
    };
  }

  function getCurrentPlotConfig(nameOverride){
    const preselected = deviceParamsSelect && deviceParamsSelect.value ? deviceParamsSelect.value.trim() : '';
    const nextStaged = Object.keys(staged).length ? staged : (preselected ? { [preselected]: getPreparedStagedLine(preselected, getSelectedCurveStyle(), preselected) } : {});
    const lines = Object.keys(nextStaged).map((key) => {
      const meta = nextStaged[key] || {};
      return {
        key,
        suffix: meta.suffix || key,
        style: Object.assign({
          lineType: 'solid',
          lineWidth: 2,
          lineColor: '#007bff'
        }, meta.style || {})
      };
    });
    return {
      name: nameOverride || '',
      plotType: plotTypeSelect && plotTypeSelect.value ? plotTypeSelect.value : 'line',
      lines,
      savedAt: new Date().toISOString()
    };
  }

  function applyPlotConfig(config){
    if(!config) return;
    if(plotTypeSelect && config.plotType) plotTypeSelect.value = config.plotType;
    clearStagedLines();
    (config.lines || []).forEach((line) => {
      if(!line || !line.key) return;
      staged[line.key] = getPreparedStagedLine(line.key, line.style, line.suffix || line.key);
    });
    rebuildStagedLinesSelect();
    const firstLine = (config.lines || [])[0];
    if(firstLine){
      if(deviceParamsSelect) deviceParamsSelect.value = firstLine.key;
      if(curveLineTypeSelect && firstLine.style && firstLine.style.lineType) curveLineTypeSelect.value = firstLine.style.lineType;
      if(curveLineWidthSelect && firstLine.style && firstLine.style.lineWidth) curveLineWidthSelect.value = String(firstLine.style.lineWidth);
      if(curveLineColorInput && firstLine.style && firstLine.style.lineColor) curveLineColorInput.value = firstLine.style.lineColor;
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

  function updatePlotConfigList(selectedName){
    if(typeof selectedName === 'string') activeSavedPlotName = selectedName;
    refreshPlotConfigSelectors();

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

  function removePlotEntryByName(name){
    if(!name) return;
    Object.keys(plotsMap).forEach((id) => {
      const entry = plotsMap[id];
      if(entry && entry.containerDiv && entry.containerDiv.dataset && entry.containerDiv.dataset.plotName === name){
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

    const currentEntry = getCurrentPlotEntry();
    if(currentEntry) {
      switchPlotPanelToConfig(currentEntry, name);
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
    plotEntry.containerDiv.style.transform = '';
    plotEntry.containerDiv.removeAttribute('data-x');
    plotEntry.containerDiv.removeAttribute('data-y');
    if(isConfigureLayout){
      try { makeDraggable(plotEntry.containerDiv); } catch (e) {}
      try { makeResizable(plotEntry.containerDiv); } catch (e) {}
    }
    try { Plotly.Plots.resize(plotEntry.plotDiv); } catch (e) {}
    setPlotConfigSelection(plotEntry.configName || '');
    return plotEntry;
  }

  function createPlotPanelFromConfig(config){
    if(!config || !Array.isArray(config.lines) || config.lines.length === 0) {
      alert('No lines staged. Use Add Line to stage parameters before creating a plot.');
      return null;
    }

    const plotName = config.name && config.name.trim() ? config.name.trim() : `Plot ${plotCounter + 1}`;
    removePlotEntryByName(plotName);

    const id = 'plot_' + (++plotCounter);

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
    container.style.left = '200px';
    container.style.top = '80px';
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

    const plotEntry = { id, containerDiv: container, plotDiv: plotDiv, traces: {}, plotType: config.plotType || 'line', configName: plotName };
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
      } else {
        const traceLabel = key || prepared.suffix || 'trace';
        const trace = { x: [], y: [], mode: 'lines+markers', name: traceLabel };
        applyTraceStyle(trace, prepared.style);
        plotEntry.traces[key] = { x: trace.x, y: trace.y, traceObj: trace, name: traceLabel, suffix: prepared.suffix, _traceIndex: undefined, _lastSent: 0, style: prepared.style };
      }
    });

    plotsMap[id] = plotEntry;
    const initTraceMetas = Object.values(plotEntry.traces).filter(t => t && t.traceObj);
    Plotly.newPlot(plotDiv, initTraceMetas.map(t=>t.traceObj), layoutForType(plotEntry.plotType)).then(()=>{
      initTraceMetas.forEach((t,i)=>{ t._traceIndex = i; if (Array.isArray(t.x)) t._lastSent = t.x.length; });
      Plotly.relayout(plotDiv, { title: '' });
      if (titleDiv.parentNode !== container) {
        container.insertBefore(titleDiv, container.firstChild);
      }
      const next = titleDiv.nextSibling;
      if (next && next.className && (next.className.includes('plot-param-labels') || next.className.includes('plot-legend-labels'))) {
        container.removeChild(next);
      }
    }).catch(e=>{ console.warn('Plotly.newPlot failed', e); });

    function makePanelDraggableResizable(container, plotDiv) {
      if (window.interact) {
        interact(container)
        .draggable({
          inertia: true,
          listeners: {
            move (event) {
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
    return plotEntry;
  }

  function dashForLineType(lineType){
    if(lineType === 'dashed') return 'dash';
    if(lineType === 'dotted') return 'dot';
    return 'solid';
  }

  function getSelectedCurveStyle(){
    return {
      lineType: curveLineTypeSelect && curveLineTypeSelect.value ? curveLineTypeSelect.value : 'solid',
      lineWidth: curveLineWidthSelect && curveLineWidthSelect.value ? parseInt(curveLineWidthSelect.value, 10) : 2,
      lineColor: curveLineColorInput && curveLineColorInput.value ? curveLineColorInput.value : '#007bff'
    };
  }

  function applyTraceStyle(traceObj, style){
    if(!traceObj) return;
    const nextStyle = style || {};
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

        if(window.WRITABLE_PARAMS) return populateDeviceParams(window.WRITABLE_PARAMS);

    
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

  function populateDeviceParams(data){

    if(!deviceParamsSelect) return;

    deviceParamsSelect.innerHTML = '<option value="">-- select device.param --</option>';

    if(!data) return;

    Object.keys(data).sort().forEach(device => {

      const info = data[device] || {};
      // Use all_params if available, else fallback to params

      const params = info.all_params || info.params || info.param_list || [];

      const displayDevice = info.original_name || device;

      params.forEach(p => {

        const opt = document.createElement('option');
        // keep the real key (device as in JSON) as the value so spinupdate keys will match
        opt.value = device + '.' + p;

        // display a friendly label: original_name.param (host-prefixed device kept in title attr)
        opt.text = (displayDevice + '.' + p);

        opt.title = device + '.' + p;

        deviceParamsSelect.add(opt);

      });
    });
   
  }

 

  function layoutForType(typeOverride){

    const type = typeOverride || (plotTypeSelect ? plotTypeSelect.value : 'line');

    const layout = { title: '', xaxis:{type:'date'}, margin:{t:30} };

    if(type === 'xy') layout.xaxis = { title: 'X' };

    return withTimeRangeControls(layout);

  }

  function refreshPlot(){
    // refresh all created plots
    Object.values(plotsMap).forEach(p => {

      // Only include traces that have an actual Plotly trace object (skip placeholders)
      const traceMetas = Object.values(p.traces).filter(t => t && t.traceObj);
      const data = traceMetas.map(t => t.traceObj);

      // update the whole plot with only the real traces
      Plotly.react(p.plotDiv, data, layoutForType(p.plotType), {responsive:true}).then(()=>{
        traceMetas.forEach((t,i)=> t._traceIndex = i);
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
  
    const key = deviceParamsSelect && deviceParamsSelect.value ? deviceParamsSelect.value.trim() : '';
  
    if(!key) return alert('Select a device parameter to add');
  
    if(staged[key]) return alert('Parameter already staged');
    // store full device.param as the suffix so we can match host-prefixed emitted keys
    // e.g. emitted key might be "host_123_sim_gas_dosing_massflow_contr1.target"
    // and endsWith('sim_gas_dosing_massflow_contr1.target') will match.
    const suffix = key;
    const style = getSelectedCurveStyle();

    staged[key] = getPreparedStagedLine(key, style, suffix);
  
    rebuildStagedLinesSelect();
    if (addedLinesSelect) addedLinesSelect.value = key;
  }

  function deleteLine(){
  
    const sel = addedLinesSelect; if(!sel || !sel.value) return alert('Select a staged line to delete');
  
    const key = sel.value;
  
    if(!staged[key]) return alert('Selected staged line not found');
  
    delete staged[key];
    rebuildStagedLinesSelect();
  
  }

  // Trim old points to keep plot lightweight (last 1000 points)
  function trimTraces(){
  
    Object.values(plotsMap).forEach(p=>{

      Object.values(p.traces).forEach(t=>{
        // skip placeholder/parent entries that don't have a traceObj
        if(!t || !t.traceObj) return;
        let removed = 0;
        while(t.traceObj.x.length > 1000){ t.traceObj.x.shift(); t.traceObj.y.shift(); removed++; }
        if(removed && typeof t._lastSent === 'number'){
  
          t._lastSent = Math.max(0, t._lastSent - removed);
  
        }
  
      });
  
    });
  
  }

  // Flush buffered points to the visible Plotly plots every interval (append new points)
  function flushBufferedPoints(){
  
    Object.values(plotsMap).forEach(p => {
  
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
          Plotly.react(p.plotDiv, data, layoutForType(p.plotType), {responsive:true}).then(()=>{
            traceMetas.forEach((tt,i)=> tt._traceIndex = i);
            traceMetas.forEach(tt=> tt._lastSent = tt.traceObj.x.length);
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
        const name = `${parentKey}[${i}]`;
        const traceObj = { x: [], y: [], mode: 'lines+markers', name: name };
        const parentMeta = plotEntry.traces[parentKey] || {};
        applyTraceStyle(traceObj, parentMeta.style);
        plotEntry.traces[childKey] = { traceObj: traceObj, suffix: childKey, _traceIndex: undefined, _lastSent: 0, parent: parentKey, style: parentMeta.style };
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

  // Add a visible indicator for last spinupdate event
  let lastSpinupdateTime = null;
  
  function updateSpinupdateIndicator(){
  
    let el = document.getElementById('spinupdate-indicator');
  
    if(!el){
  
      el = document.createElement('div');
  
      el.id = 'spinupdate-indicator';
  
      el.style.position = 'fixed';
      
      el.style.top = '8px';
      
  // center the indicator horizontally
      el.style.left = '50%';
      el.style.transform = 'translateX(-50%)';
  
      el.style.background = '#e0ffe0';
  
      el.style.color = '#222';
  
      el.style.fontSize = '14px';
  
      el.style.padding = '4px 10px';
  
      el.style.borderRadius = '6px';
  
      el.style.zIndex = '1000';
  
      document.body.appendChild(el);
  
    }
  
    el.textContent = lastSpinupdateTime ? `Last update: ${lastSpinupdateTime.toLocaleTimeString()}` : 'No spinupdate yet';
  
  }

  // Handle incoming Spin updates
  window.addEventListener('spinupdate', function(ev){
  
    try{
   
      lastSpinupdateTime = new Date();
   
      updateSpinupdateIndicator();
   
      const emittedKey = ev.detail.key || '';

      if(emittedKey === 'nodemanager.list_plot_configs') {
        mergePlotConfigNames(ev.detail.value);
        return;
      }

      // Use ev.detail.value.value if present, else fallback
   
      const val = (ev.detail.value && typeof ev.detail.value.value !== 'undefined') ? ev.detail.value.value : ev.detail.value;
   
      const now = new Date();
      // route update to all created plot traces that match
      // mark plots that received updates so we only redraw those
   
      const updatedPlots = new Set();
   
      let matched = false;
   
      Object.values(plotsMap).forEach(p=>{
   
        Object.keys(p.traces).forEach(k=>{
   
          try{
   
            const meta = p.traces[k];
   
            if(emittedKey === k || (meta && meta.suffix && emittedKey.endsWith(meta.suffix))){
   
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
                  if (typeof childMeta._traceIndex === 'number') {
                    try { Plotly.extendTraces(p.plotDiv, { x: [[now]], y: [[yval]] }, [childMeta._traceIndex]); } catch(e) { }
                  }
                });
                updatedPlots.add(p.id);
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
                  meta.traceObj.x.push(now);
                  meta.traceObj.y.push(yval);
                  // skip parent placeholders during per-trace restyle/extend; they don't have traceObj
                  if (meta && meta.isArrayParent) return;
                  if(typeof meta._traceIndex === 'number')
                  {
                    try 
                    {
                       Plotly.extendTraces(p.plotDiv, { x: [[now]], y: [[yval]] }, [meta._traceIndex]); 
                    }
                    catch(e) 
                    {

                    }
                  }
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
  });

      addBtn && addBtn.addEventListener('click', addLine);

      deleteBtn && deleteBtn.addEventListener('click', deleteLine);

      plotConfigSelect && plotConfigSelect.addEventListener('change', handleTopLevelPlotConfigSelection);
      deletePlotConfigBtn && deletePlotConfigBtn.addEventListener('click', deleteSelectedPlotConfig);

      plotTypeSelect && plotTypeSelect.addEventListener('change', refreshPlot);

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
        createPlotPanelFromConfig(config);
        if(window.Spin && window.Spin.send_request){
          try {
            window.Spin.send_request('nodemanager.save_plot_config', '', 'input', 'set', {name: plotName, config: config});
            window.Spin.send_request('nodemanager.list_plot_configs', '', 'read', 'read', null);
          } catch (e) {
            console.error('save_plot_config request failed', e);
          }
        }
      });

  // start
  loadDeviceParams();
  updatePlotConfigList();
  if(typeof waitForSpin === 'function') {
    waitForSpin(updatePlotConfigList);
  }
  // Periodically trim old points only. Avoid forcing full redraws here because
  // they can replace the Plotly state and clear trace indices used for extendTraces.
  setInterval(()=>{ trimTraces(); flushBufferedPoints(); }, 2000);

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
    Plotly.newPlot(plotDiv, initTraceMetasAuto.map(t=>t.traceObj), layout).then(()=>{
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

  // expose minimal API for debugging
  window._plots = { plotsMap: plotsMap, staged: staged, restorePlotPanelFromLayout: restorePlotPanelFromLayout };


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
