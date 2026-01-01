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
  // --- Layout save/load infrastructure ---

  const layoutDropdown = document.getElementById('plot-layout-dropdown');

  const saveBtn = document.getElementById('save-layout');

  function getCurrentLayout() {
    // Collect all plot configs: title, parameters, position, size

    return Object.values(plotsMap).map(p => {

      const rect = p.containerDiv.getBoundingClientRect();

      return {

        title: p.containerDiv.querySelector('.plot-title-label')?.innerText || '',

        params: Object.keys(p.traces),

        x: p.containerDiv.getAttribute('data-x') || 0,

        y: p.containerDiv.getAttribute('data-y') || 0,

        width: p.containerDiv.style.width || rect.width,

        height: p.containerDiv.style.height || rect.height

      };

    });

  }

  function saveLayout() {

    const name = prompt('Enter a name for this layout:');

    if (!name) return;

    const layouts = JSON.parse(localStorage.getItem('plotLayouts') || '{}');

    layouts[name] = getCurrentLayout();

    localStorage.setItem('plotLayouts', JSON.stringify(layouts));

    updateLayoutDropdown();

    alert('Layout saved!');

  }

  function updateLayoutDropdown() {

    const layouts = JSON.parse(localStorage.getItem('plotLayouts') || '{}');

    layoutDropdown.innerHTML = '<option value="">-- Select Layout --</option>';

    Object.keys(layouts).forEach(name => {

      const opt = document.createElement('option');

      opt.value = name;

      opt.innerText = name;

      layoutDropdown.appendChild(opt);

    });

  }

  function restoreLayout(name) {

    const layouts = JSON.parse(localStorage.getItem('plotLayouts') || '{}');

    const layout = layouts[name];

    if (!layout) return;

    // Remove existing plots

    Object.values(plotsMap).forEach(p => p.containerDiv.remove());

    Object.keys(plotsMap).forEach(k => delete plotsMap[k]);

    plotCounter = 0;
    // Recreate plots from layout

    layout.forEach(cfg => {
      // Stage parameters

      Object.keys(staged).forEach(k=> delete staged[k]);

      cfg.params.forEach(param => staged[param] = { suffix: param });
      // Create plot
      createBtn.click();
      // Set title, position, size
      const lastPlot = Object.values(plotsMap)[Object.values(plotsMap).length-1];

      if (lastPlot) {

        lastPlot.containerDiv.querySelector('.plot-title-label').innerText = cfg.title;

        lastPlot.containerDiv.style.width = typeof cfg.width === 'number' ? cfg.width + 'px' : cfg.width;

        lastPlot.containerDiv.style.height = typeof cfg.height === 'number' ? cfg.height + 'px' : cfg.height;

        lastPlot.containerDiv.setAttribute('data-x', cfg.x);

        lastPlot.containerDiv.setAttribute('data-y', cfg.y);

        lastPlot.containerDiv.style.transform = `translate(${cfg.x}px, ${cfg.y}px)`;
      }
    });
  }

  saveBtn.addEventListener('click', saveLayout);

  layoutDropdown.addEventListener('change', function(){
    if (layoutDropdown.value) restoreLayout(layoutDropdown.value);
  });

  updateLayoutDropdown();

  const plotArea = document.getElementById('plot-area');

  const plotTypeSelect = document.getElementById('plot-type');

  const deviceParamsSelect = document.getElementById('curve-key');

  const addBtn = document.getElementById('add-curve');

  const addedLinesSelect = document.getElementById('added-lines');

  const deleteBtn = document.getElementById('delete-line');

  const createBtn = document.getElementById('create-plot');


  // staged lines (added via Add Line before creating a plot)
  const staged = {}; // key -> { suffix }

  // created plots: id -> { id, containerDiv, plotDiv, traces: { key -> {x,y,traceObj,suffix} } }
  const plotsMap = {};
  let plotCounter = 0;

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

  function ensurePlot(){
    // noop: plots are created by Create Plot which appends panels under plotArea
    return;
  }

  function layoutForType(){

    const type = plotTypeSelect ? plotTypeSelect.value : 'line';

    const layout = { title: '', xaxis:{type:'date'}, margin:{t:30} };

    if(type === 'xy') layout.xaxis = { title: 'X' };

    return layout;

  }

  function refreshPlot(){
    // refresh all created plots
    Object.values(plotsMap).forEach(p => {

      const traces = Object.values(p.traces);
      
      const data = traces.map(t => t.traceObj);
      
  // debug: refreshPlot calling Plotly.react for plot (removed console output)
      
      Plotly.react(p.plotDiv, data, layoutForType(), {responsive:true}).then(()=>{
      
        traces.forEach((t,i)=> t._traceIndex = i);
        
      }).catch(e=>{ });
  
    });
  
  }

  function addLine(){
  
    const key = deviceParamsSelect && deviceParamsSelect.value ? deviceParamsSelect.value.trim() : '';
  
    if(!key) return alert('Select a device parameter to add');
  
    if(staged[key]) return alert('Parameter already staged');
    // store full device.param as the suffix so we can match host-prefixed emitted keys
    // e.g. emitted key might be "host_123_sim_gas_dosing_massflow_contr1.target"
    // and endsWith('sim_gas_dosing_massflow_contr1.target') will match.
    const suffix = key;
  
    staged[key] = { suffix };
  
    const opt = document.createElement('option'); opt.value = key; opt.text = key;
  
    addedLinesSelect.add(opt);
  }

  function deleteLine(){
  
    const sel = addedLinesSelect; if(!sel || !sel.value) return alert('Select a staged line to delete');
  
    const key = sel.value;
  
    if(!staged[key]) return alert('Selected staged line not found');
  
    delete staged[key];
  
    [...sel.options].forEach(o=>{ if(o.value===key) o.remove(); });
  
  }

  // Trim old points to keep plot lightweight (last 1000 points)
  function trimTraces(){
  
    Object.values(plotsMap).forEach(p=>{
  
      Object.values(p.traces).forEach(t=>{
  
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
        // Only append new points since last flush
  
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
  
          const data = traces.map(tt=>tt.traceObj);
  
          Plotly.react(p.plotDiv, data, layoutForType(), {responsive:true}).then(()=>{
  
            traces.forEach((tt,i)=> tt._traceIndex = i);
  
            traces.forEach(tt=> tt._lastSent = tt.traceObj.x.length);
  
          }).catch(e=>{ console.error('Plotly.react failed during flush', e); });
  
        }catch(e){ console.error('Full react failed during flush', e); }
      }
    });
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
  
      el.style.right = '16px';
  
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
              // Always append a new point, even if value is unchanged
   
              let yval;
   
              if(Array.isArray(val)){
   
                yval = JSON.stringify(val);
   
              } else {
   
                yval = (typeof val === 'number') ? val : (parseFloat(val) || null);
   
              }
   
              meta.traceObj.x.push(now);
   
              meta.traceObj.y.push(yval);
              // Always extend trace with the new point
   
              if(typeof meta._traceIndex === 'number'){
   
                Plotly.extendTraces(p.plotDiv, { x: [[now]], y: [[yval]] }, [meta._traceIndex]);
   
              }
   
              updatedPlots.add(p.id);
   
            }
   
          }catch(_e){ console.error(_e); }
   
        });
   
      });
      // if(!matched){
      //   console.warn(`[plots.js] spinupdate for key '${emittedKey}' did not match any staged trace. No plot will update.`);
      // }
      // For each updated plot, append the latest value only to the matching trace (like test stream)
      updatedPlots.forEach(id => {
   
        const p = plotsMap[id];
   
        if(p) {
   
          try{
   
            Object.keys(p.traces).forEach(k => {
   
              const meta = p.traces[k];
   
              if(emittedKey === k || (meta && meta.suffix && emittedKey.endsWith(meta.suffix))){
   
                if(typeof meta._traceIndex === 'number'){
   
                  try{
                    // If this is the first point, use restyle to update the plot
   
                    if (meta.traceObj.x.length === 1) {
   
                      const update = { x: [meta.traceObj.x], y: [meta.traceObj.y] };
   
                      Plotly.restyle(p.plotDiv, update, [meta._traceIndex]);
   
                    
   
                    } else {
   
                      Plotly.extendTraces(p.plotDiv, { x: [[meta.traceObj.x[meta.traceObj.x.length-1]]], y: [[meta.traceObj.y[meta.traceObj.y.length-1]]] }, [meta._traceIndex]);
   
                     
   
                    }
   
                  }catch(e){
   
                   
                    // fallback: full redraw
                    const traces = Object.values(p.traces);
              
                    const data = traces.map(tt => tt.traceObj);
              
                    Plotly.react(p.plotDiv, data, layoutForType(), {responsive:true});
              
                    traces.forEach((tt,i)=> tt._traceIndex = i);
                  }
                } else {
                  // fallback: full redraw
                  const traces = Object.values(p.traces);
              
                  const data = traces.map(tt => tt.traceObj);
              
                  Plotly.react(p.plotDiv, data, layoutForType(), {responsive:true});
              
                  traces.forEach((tt,i)=> tt._traceIndex = i);
                }
              }
            });
          }catch(e){ console.error('Plot redraw error for', id, e); }
        }
      });
    }catch(e){ console.error('plot update error', e); }
  });

  // wire UI
  addBtn && addBtn.addEventListener('click', addLine);
  
  deleteBtn && deleteBtn.addEventListener('click', deleteLine);
  
  plotTypeSelect && plotTypeSelect.addEventListener('change', refreshPlot);
  
  createBtn && createBtn.addEventListener('click', ()=>{
    // Create a new plot panel below using all currently staged lines.
  
    if(!plotArea) return alert('Plot area not available');
    // if there are no staged lines, but a device param is selected, stage it automatically
  
    const preselected = deviceParamsSelect && deviceParamsSelect.value ? deviceParamsSelect.value.trim() : '';
  
    if(Object.keys(staged).length === 0 && preselected){
      // store full key as suffix (see addLine comments)
  
      staged[preselected] = { suffix: preselected };
  
    }

  
    const keys = Object.keys(staged);
  
    if(keys.length === 0) return alert('No lines staged. Use Add Line to stage parameters before creating a plot.');

  
    const id = 'plot_' + (++plotCounter);
  
    const container = document.createElement('div'); container.className = 'plot-panel'; container.id = id + '_panel';
    // Editable plot title above the plot
  
    const titleDiv = document.createElement('div');
  
    titleDiv.className = 'plot-title-label';
  
    titleDiv.contentEditable = true;
  
    titleDiv.innerText = `Plot ${plotCounter}`;
  
    titleDiv.title = 'Click to edit plot title';
  
    titleDiv.style.fontWeight = 'bold';
  
    titleDiv.style.fontSize = '18px';
  
    titleDiv.style.textAlign = 'center';
  
    titleDiv.style.margin = '8px 0 4px 0';
  
    titleDiv.style.outline = 'none';
  
    // On blur or enter, update plot title (but keep Plotly layout title empty)
    titleDiv.addEventListener('blur', function(){
      // Always clear Plotly layout title so only the custom title is visible
  
      Plotly.relayout(plotDiv, { title: '' });
    });
  
    titleDiv.addEventListener('keydown', function(e){
  
      if(e.key === 'Enter'){
  
        e.preventDefault();
  
        titleDiv.blur();
      }
    });
  
    container.insertBefore(titleDiv, container.firstChild);

  // (Ensure no subtitle/label is inserted below the title)
  
    const plotDiv = document.createElement('div'); plotDiv.id = id + '_plot'; plotDiv.style.width = '100%'; plotDiv.style.height = '360px';
    
    container.appendChild(plotDiv);
    
    plotArea.appendChild(container);

    const plotEntry = { id, containerDiv: container, plotDiv: plotDiv, traces: {} };
    // transfer staged lines into this new plot
    keys.forEach(k => {
    const s = staged[k];
  // Use a more descriptive name for the trace (device.param)
    
    const traceLabel = k || s.suffix || 'trace';
  
    const trace = { x: [], y: [], mode: 'lines+markers', name: traceLabel };
  
    plotEntry.traces[k] = { x: trace.x, y: trace.y, traceObj: trace, name: traceLabel, suffix: s.suffix, _traceIndex: undefined, _lastSent: 0 };
  
  
    });

    plotsMap[id] = plotEntry;
    // initialize plotly and capture trace indices so we can extend traces incrementally
    Plotly.newPlot(plotDiv, Object.values(plotEntry.traces).map(t=>t.traceObj), layoutForType()).then(()=>{
      Object.values(plotEntry.traces).forEach((t,i)=>{ t._traceIndex = i; t._lastSent = t.x.length; });
      // Remove Plotly layout title so only the editable title above is visible
      Plotly.relayout(plotDiv, { title: '' });
      // Ensure titleDiv is always visible after plotly redraws
      if (titleDiv.parentNode !== container) {
        container.insertBefore(titleDiv, container.firstChild);
      }
      // (Ensure no subtitle/label is inserted below the title)
      // Remove any subtitle/label below the title if it exists
      const next = titleDiv.nextSibling;
   
      if (next && next.className && (next.className.includes('plot-param-labels') || next.className.includes('plot-legend-labels'))) {
   
        container.removeChild(next);
   
      }
   
    }).catch(e=>{ console.warn('Plotly.newPlot failed', e); });

    // Make plot panel resizable and draggable using interact.js
    function makePanelDraggableResizable(container, plotDiv) {
    
      if (window.interact) {
    
        interact(container)
    
        .draggable({
    
          inertia: true,
            // Removed restrictRect modifier so plot can move anywhere in window
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
                Plotly.Plots.resize(plotDiv);
              }
            },
            inertia: true
          });
      } else {
        // If interact.js is not loaded yet, try again later
        setTimeout(()=>makePanelDraggableResizable(container, plotDiv), 500);
      }
    }
    makePanelDraggableResizable(container, plotDiv);

    // clear staged and UI staged list
    Object.keys(staged).forEach(k=> delete staged[k]);
    if(addedLinesSelect){
      for(let i = addedLinesSelect.options.length - 1; i >= 1; i--){ addedLinesSelect.remove(i); }
      addedLinesSelect.value = '';
    }

    // refresh to reflect any existing buffered data
    refreshPlot();
  });

  // start
  loadDeviceParams();
  ensurePlot();
  // Periodically trim old points only. Avoid forcing full redraws here because
  // they can replace the Plotly state and clear trace indices used for extendTraces.
  setInterval(()=>{ trimTraces(); flushBufferedPoints(); }, 2000);

  // --- Auto-plot creation from data-spin-plot attributes / SVG inkscape:label ---
  function parseDataSpinPlot(spec){
    // returns { title, globals: {}, curves: [{name,param,label,mods}] }
    const res = { title: '', globals: {}, curves: [] };
    
    if(!spec || !spec.trim()) return res;
    
    container = hostEl; 
    
    container.classList.add('plot-panel');
    
    plotDiv = document.createElement('div'); 
    
    plotDiv.style.width='100%'; 
    
    plotDiv.style.height='360px';
    
    container.appendChild(plotDiv);
    
    while((m = re.exec(spec))){
    
      if(m[1]) tokens.push({type:'string', val:m[1]});
    
      else if(m[2]) tokens.push({type:'string', val:m[2]});
    
      else if(m[3]) tokens.push({type:'at', val:m[3].substr(1)});
    
      else if(m[4]) tokens.push({type:'kv', val:m[4]});
    
      else if(m[5]) tokens.push({type:'token', val:m[5]});
    
    }
    
    let i = 0;
    
    if(tokens[i] && tokens[i].type === 'string'){ res.title = tokens[i].val; i++; }
    
    while(tokens[i] && tokens[i].type !== 'at'){
    
      if(tokens[i].type === 'kv'){
    
        const kv = tokens[i].val.split('='); res.globals[kv[0]] = kv[1];
    
      }
    
      i++;
    
    }
    
    while(i < tokens.length){
    
      if(tokens[i].type === 'at'){
    
        const nameParam = tokens[i].val;
    
        let name = nameParam; let param = null;
    
        if(nameParam.indexOf('.') !== -1){ const parts = nameParam.split('.'); name = parts.slice(0,-1).join('.'); param = parts.slice(-1)[0]; }
    
        i++;
    
        let label = null;
    
        if(tokens[i] && tokens[i].type === 'string'){ label = tokens[i].val; i++; }
    
        const mods = {};
        // Parse mods for this curve
    
        while(tokens[i] && (tokens[i].type === 'kv' || tokens[i].type === 'token')) {
    
          if(tokens[i].type === 'kv'){ const kv = tokens[i].val.split('='); mods[kv[0]] = kv[1]; }
    
          else if(tokens[i].type === 'token'){ mods[tokens[i].val] = true; }
    
          i++;
    
        }
    
        res.curves.push({ name, param, label, mods });
    
      } else { i++; }
    
    }
   
    return res;
  
  }

  function createPlotFromSpec(spec, hostEl){
    
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
    
      container.appendChild(header); container.appendChild(plotDiv); plotArea.appendChild(container);
    }

    const plotEntry = { id, containerDiv: container, plotDiv: plotDiv, traces: {} };
    
    const layout = { title: parsed.title || '', xaxis:{type:'date'}, margin:{t:30} };
    
    if(parsed.globals.fontsize) layout.font = { size: parseInt(parsed.globals.fontsize,10) };
    
    if(parsed.globals.legend === 'right'){ layout.legend = { orientation:'v', x:1.02, y:1 }; }
    
    else if(parsed.globals.legend === 'none'){ layout.showlegend = false; }
              meta.traceObj.x.push(now); meta.traceObj.y.push(JSON.stringify(val));
    
            
    if(parsed.curves.some(c=> c.mods && c.mods.y2)){ layout.yaxis2 = { overlaying: 'y', side: 'right' }; }

    parsed.curves.forEach((c, idx)=>{
              meta.traceObj.x.push(now); meta.traceObj.y.push(y);
      
              const fullKey = (c.name && c.param) ? (c.name + '.' + c.param) : (c.name || param);
      
              const trace = { x: [], y: [], mode: 'lines+markers', name: c.label || fullKey };
      
      if(c.mods && c.mods.color){ trace.marker = trace.marker || {}; trace.marker.color = c.mods.color; }
      
      if(c.mods && c.mods.symbol){ trace.marker = trace.marker || {}; trace.marker.symbol = c.mods.symbol; }
      
      if(c.mods && c.mods.line){ trace.line = { width: parseFloat(c.mods.line) || 0 }; if(c.mods.line === '0') trace.mode = 'markers'; }
      
      if(c.mods && c.mods.y2) trace.yaxis = 'y2';
     
      plotEntry.traces[fullKey] = { traceObj: trace, suffix: fullKey, _traceIndex: undefined };
    
    });

    plotsMap[id] = plotEntry;
    
    Plotly.newPlot(plotDiv, Object.values(plotEntry.traces).map(t=>t.traceObj), layout).then(()=>{
      Object.values(plotEntry.traces).forEach((t,i)=> t._traceIndex = i);
    }).catch(e=>{ console.warn('Plotly.newPlot auto plot failed', e); });
  
  }

  function scanDataSpinPlots(){
    try
    {
      document.querySelectorAll('div[data-spin-plot]').forEach(d => {
        const spec = d.getAttribute('data-spin-plot'); if(spec) createPlotFromSpec(spec, d);
      });
      document.querySelectorAll('rect').forEach(r => {
        const lbl = r.getAttribute('inkscape:label') || r.getAttribute('data-inkscape-label');
        if(lbl && lbl.trim().startsWith('!plot '))
            {
          const spec = lbl.trim().substr(6); createPlotFromSpec(spec, null);
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
  window._plots = { plotsMap: plotsMap, staged: staged };


})();

/**
 * Parse a data-spin-plot attribute string into a config object.
 * Supports: title, global modifiers, and curve definitions with @name.param and label/modifiers.
 */
function parseSpinPlotAttribute(attr) {
  // Simple parser for demonstration; extend as needed for full syntax

  const config = { title: '', modifiers: {}, curves: [] };

  if (!attr) return config;
  // Split by @ for curves

  const parts = attr.split('@');
  // First part: title and global modifiers

  const global = parts.shift();

  const globalTokens = global.match(/"([^"]+)"|\S+/g) || [];

  globalTokens.forEach(token => {

    if (token.startsWith('"') && token.endsWith('"')) config.title = token.replace(/"/g, '');

    else if (token.includes('=')) {

      const [k, v] = token.split('=');

      config.modifiers[k] = v;

    } 
    
    else if (token === 'logscale') 
      
      config.modifiers.logscale = true;
    
    else if (token === 'legend=right' || token === 'legend=bottom' || token === 'legend=none') 
      
      config.modifiers.legend = token.split('=')[1];

    else if (token.startsWith('fontsize=')) 
      
      config.modifiers.fontsize = token.split('=')[1];
    
      else if (token.startsWith('interval=')) 
      
      config.modifiers.interval = token.split('=')[1];
  });
  // Remaining parts: curves
  parts.forEach(curveStr => {
    const curve = { label: '', key: '', modifiers: {} };
    const tokens = curveStr.match(/"([^"]+)"|\S+/g) || [];
    tokens.forEach(token => {
      if (token.startsWith('"') && token.endsWith('"')) curve.label = token.replace(/"/g, '');
      else if (token.startsWith('color=')) curve.modifiers.color = token.split('=')[1];
      else if (token.startsWith('symbol=')) curve.modifiers.symbol = token.split('=')[1];
      else if (token.startsWith('line=')) curve.modifiers.line = token.split('=')[1];
      else if (token === 'y2') curve.modifiers.y2 = true;
      else if (token.includes('.')) curve.key = token;
    });
    config.curves.push(curve);
  });
  return config;
}

// Example usage in plot creation:
function createPlotFromSpinPlot(div) 

{

  const attr = div.getAttribute('data-spin-plot');

  const config = parseSpinPlotAttribute(attr);
} 

// Make sure interact.js is loaded
(function ensureInteractLoaded(){

  if (!window.interact) {

    const script = document.createElement('script');

    script.src = 'https://cdn.jsdelivr.net/npm/interactjs/dist/interact.min.js';

    script.onload = function(){};

    document.head.appendChild(script);

  }

})();
