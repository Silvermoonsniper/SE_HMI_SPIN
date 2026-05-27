(function initializeSEAppState(global) {
  const sharedState = {
    layoutStorageKey: 'gas_system_layouts',
    deviceParams: null,
    plots: {
      plotsMap: {},
      staged: {},
      restorePlotPanelFromLayout: null,
      capturePlotPanelGeometry: null,
      applyPlotPanelGeometry: null,
      _restoreCounter: 0,
    },
  };

  const api = {
    getLayoutStorageKey() {
      return sharedState.layoutStorageKey;
    },
    getDeviceParams() {
      return sharedState.deviceParams;
    },
    setDeviceParams(deviceParams) {
      sharedState.deviceParams = deviceParams || null;
      return sharedState.deviceParams;
    },
    getPlots() {
      return sharedState.plots;
    },
    ensurePlots() {
      if (!sharedState.plots || typeof sharedState.plots !== 'object') {
        sharedState.plots = {
          plotsMap: {},
          staged: {},
          restorePlotPanelFromLayout: null,
          capturePlotPanelGeometry: null,
          applyPlotPanelGeometry: null,
          _restoreCounter: 0,
        };
      }
      return sharedState.plots;
    },
    setPlots(nextPlots) {
      const plots = api.ensurePlots();
      Object.keys(plots).forEach((key) => {
        if (!(key in nextPlots)) {
          delete plots[key];
        }
      });
      Object.assign(plots, nextPlots || {});
      return plots;
    },
    nextPlotRestoreCounter() {
      const plots = api.ensurePlots();
      plots._restoreCounter = Number.isFinite(plots._restoreCounter) ? plots._restoreCounter + 1 : 1;
      return plots._restoreCounter;
    },
  };

  global.SEAppState = api;

  Object.defineProperty(global, 'WRITABLE_PARAMS', {
    configurable: true,
    get() {
      return api.getDeviceParams();
    },
    set(value) {
      api.setDeviceParams(value);
    },
  });

  Object.defineProperty(global, '_plots', {
    configurable: true,
    get() {
      return api.ensurePlots();
    },
    set(value) {
      api.setPlots(value || {});
    },
  });
})(window);