const HISTORY_API_BASE = (() => {
  try {
    return `${window.location.protocol}//${window.location.hostname}:8001/api`;
  } catch (error) {
    return 'http://127.0.0.1:8001/api';
  }
})();

const historyState = {
  keys: [],
  nextCursor: null,
  activeRequest: null,
};

function historyElement(id) {
  return document.getElementById(id);
}

function formatTimestamp(timestampMs) {
  if (!timestampMs && timestampMs !== 0) {
    return '-';
  }

  const date = new Date(Number(timestampMs));
  if (Number.isNaN(date.getTime())) {
    return String(timestampMs);
  }

  return date.toLocaleString();
}

function formatDateTimeLocalValue(timestampMs) {
  if (!timestampMs && timestampMs !== 0) {
    return '';
  }

  const date = new Date(Number(timestampMs));
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocalToMs(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  const timestampMs = date.getTime();
  return Number.isNaN(timestampMs) ? null : timestampMs;
}

function setHistoryStatus(message, type = 'ok') {
  const status = historyElement('history-query-status');
  if (!status) {
    return;
  }

  status.textContent = message;
  status.className = `status ${type}`;
}

function setButtonsDisabled(isLoading) {
  const loadButton = historyElement('history-load-button');
  const resetButton = historyElement('history-reset-button');
  const nextButton = historyElement('history-next-button');
  if (loadButton) loadButton.disabled = isLoading;
  if (resetButton) resetButton.disabled = isLoading;
  if (nextButton) nextButton.disabled = isLoading || !historyState.nextCursor;
}

function updateCursorStatus() {
  const cursorLabel = historyElement('history-cursor-status');
  const hasMoreLabel = historyElement('history-has-more');
  if (cursorLabel) {
    cursorLabel.textContent = historyState.nextCursor
      ? `${historyState.nextCursor.timestamp_ms} / ${historyState.nextCursor.id}`
      : 'None';
  }
  if (hasMoreLabel) {
    hasMoreLabel.textContent = historyState.nextCursor ? 'Yes' : 'No';
  }
  setButtonsDisabled(false);
}

function updateStats(statsPayload, keyPayload) {
  historyElement('stats-total-rows').textContent = String(statsPayload.total_rows ?? '-');
  historyElement('stats-oldest').textContent = formatTimestamp(statsPayload.oldest_timestamp_ms);
  historyElement('stats-newest').textContent = formatTimestamp(statsPayload.newest_timestamp_ms);
  historyElement('stats-key-count').textContent = String(keyPayload.returned_keys ?? 0);
}

function populateKeyOptions(keys) {
  historyState.keys = Array.isArray(keys) ? keys : [];
  const select = historyElement('history-key-select');
  if (!select) {
    return;
  }

  select.innerHTML = '';
  if (!historyState.keys.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No stored keys found';
    select.appendChild(option);
    return;
  }

  historyState.keys.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.key;
    option.textContent = entry.key;
    select.appendChild(option);
  });
}

function renderRows(samplesByKey) {
  const tableBody = historyElement('history-table-body');
  if (!tableBody) {
    return;
  }

  const rows = [];
  Object.entries(samplesByKey || {}).forEach(([key, samples]) => {
    (samples || []).forEach((sample) => {
      rows.push({ key, ...sample });
    });
  });

  rows.sort((left, right) => {
    if (left.timestamp_ms !== right.timestamp_ms) {
      return left.timestamp_ms - right.timestamp_ms;
    }
    return (left.id || 0) - (right.id || 0);
  });

  tableBody.innerHTML = '';
  if (!rows.length) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 7;
    emptyCell.className = 'empty';
    emptyCell.textContent = 'No rows returned for this query.';
    emptyRow.appendChild(emptyCell);
    tableBody.appendChild(emptyRow);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const cells = [
      row.id,
      row.key,
      formatTimestamp(row.timestamp_ms),
      row.unit || '',
      row.state || '',
      row.state_str || '',
      typeof row.value === 'string' ? row.value : JSON.stringify(row.value),
    ];

    cells.forEach((value, index) => {
      const td = document.createElement('td');
      td.textContent = value == null ? '' : String(value);
      if (index === 0 || index === 6) {
        td.className = 'mono';
      }
      tr.appendChild(td);
    });

    tableBody.appendChild(tr);
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { method: 'GET' });
  const payload = await response.json();
  if (!response.ok || payload.status !== 'ok') {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function refreshHistoryMetadata() {
  setHistoryStatus('Loading stats and keys...');
  const statsUrl = `${HISTORY_API_BASE}/device_history/stats`;
  const keysUrl = `${HISTORY_API_BASE}/device_history/keys?limit=5000`;
  const [statsPayload, keyPayload] = await Promise.all([
    fetchJson(statsUrl),
    fetchJson(keysUrl),
  ]);

  updateStats(statsPayload, keyPayload);
  populateKeyOptions(keyPayload.keys || []);

  const keySelect = historyElement('history-key-select');
  if (keySelect && !keySelect.value && keyPayload.keys && keyPayload.keys.length) {
    keySelect.value = keyPayload.keys[0].key;
  }

  setHistoryStatus('Ready');
}

function buildHistoryUrl({ appendCursor }) {
  const key = (historyElement('history-key-select')?.value || '').trim();
  const limit = historyElement('history-limit')?.value || '1000';
  const startMs = parseDateTimeLocalToMs(historyElement('history-start')?.value || '');
  const endMs = parseDateTimeLocalToMs(historyElement('history-end')?.value || '');

  const url = new URL(`${HISTORY_API_BASE}/device_history`);
  if (key) {
    url.searchParams.set('keys', key);
  }
  url.searchParams.set('limit', limit);
  if (startMs !== null) {
    url.searchParams.set('start_ms', String(startMs));
  }
  if (endMs !== null) {
    url.searchParams.set('end_ms', String(endMs));
  }
  if (appendCursor && historyState.nextCursor) {
    url.searchParams.set('cursor_timestamp_ms', String(historyState.nextCursor.timestamp_ms));
    url.searchParams.set('cursor_id', String(historyState.nextCursor.id));
  }

  return url.toString();
}

async function loadHistoryPage({ appendCursor }) {
  const key = (historyElement('history-key-select')?.value || '').trim();
  if (!key) {
    setHistoryStatus('Choose a history key first.', 'warn');
    return;
  }

  if (appendCursor && !historyState.nextCursor) {
    setHistoryStatus('There is no next page to load.', 'warn');
    return;
  }

  historyState.activeRequest = buildHistoryUrl({ appendCursor });
  setButtonsDisabled(true);
  setHistoryStatus(appendCursor ? 'Loading next page...' : 'Loading first page...');

  try {
    const payload = await fetchJson(historyState.activeRequest);
    historyState.nextCursor = payload.has_more ? payload.next_cursor : null;
    renderRows(payload.samples || {});
    historyElement('history-returned-rows').textContent = String(payload.returned_rows || 0);
    updateCursorStatus();
    setHistoryStatus(payload.returned_rows ? 'Page loaded.' : 'No rows matched this query.');
  } catch (error) {
    historyState.nextCursor = null;
    updateCursorStatus();
    setHistoryStatus(error.message || String(error), 'error');
  }
}

function resetHistoryFilters() {
  historyState.nextCursor = null;
  historyElement('history-start').value = '';
  historyElement('history-end').value = '';
  historyElement('history-limit').value = '1000';
  historyElement('history-returned-rows').textContent = '0';
  renderRows({});
  updateCursorStatus();
  setHistoryStatus('Filters reset.');
}

function attachHistoryEvents() {
  historyElement('refresh-all-button')?.addEventListener('click', async () => {
    setButtonsDisabled(true);
    try {
      await refreshHistoryMetadata();
    } catch (error) {
      setHistoryStatus(error.message || String(error), 'error');
    } finally {
      updateCursorStatus();
    }
  });

  historyElement('history-load-button')?.addEventListener('click', async () => {
    historyState.nextCursor = null;
    updateCursorStatus();
    await loadHistoryPage({ appendCursor: false });
  });

  historyElement('history-next-button')?.addEventListener('click', async () => {
    await loadHistoryPage({ appendCursor: true });
  });

  historyElement('history-reset-button')?.addEventListener('click', () => {
    resetHistoryFilters();
  });
}

async function initializeHistoryBrowser() {
  attachHistoryEvents();
  resetHistoryFilters();

  try {
    await refreshHistoryMetadata();
  } catch (error) {
    setHistoryStatus(error.message || String(error), 'error');
  } finally {
    updateCursorStatus();
  }
}

document.addEventListener('DOMContentLoaded', initializeHistoryBrowser);
