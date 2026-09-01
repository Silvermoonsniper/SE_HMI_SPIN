/**
 * History Browser page — React port of content/history.html + history.js.
 *
 * Browses paged device history from PostgreSQL: pick a stored key, apply an
 * optional time range, and step through result pages with the cursor returned
 * by the backend.
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { HistorySample } from '../api/types'
import '../styles/history.css'

interface HistoryRow extends HistorySample {
  key: string
}

interface Cursor {
  timestamp_ms: number
  id: number
}

type StatusType = 'ok' | 'warn' | 'error'

function formatTimestamp(timestampMs: number | null | undefined): string {
  if (timestampMs === null || timestampMs === undefined) return '-'
  const date = new Date(Number(timestampMs))
  if (Number.isNaN(date.getTime())) return String(timestampMs)
  return date.toLocaleString()
}

function parseDateTimeLocalToMs(value: string): number | null {
  if (!value) return null
  const date = new Date(value)
  const ms = date.getTime()
  return Number.isNaN(ms) ? null : ms
}

export default function HistoryPage() {
  const [keys, setKeys] = useState<Array<{ key: string; newest_timestamp_ms: number | null }>>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [startValue, setStartValue] = useState('')
  const [endValue, setEndValue] = useState('')
  const [limit, setLimit] = useState('1000')
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null)
  const [returnedRows, setReturnedRows] = useState(0)
  const [status, setStatus] = useState<{ message: string; type: StatusType }>({ message: 'Idle', type: 'ok' })
  const [loading, setLoading] = useState(false)

  const [stats, setStats] = useState<{
    totalRows: string
    oldest: string
    newest: string
    keyCount: string
  }>({ totalRows: '-', oldest: '-', newest: '-', keyCount: '-' })

  const refreshMetadata = useCallback(async () => {
    setStatus({ message: 'Loading stats and keys...', type: 'ok' })
    const [statsPayload, keyPayload] = await Promise.all([api.deviceHistoryStats(), api.deviceHistoryKeys(5000)])

    setStats({
      totalRows: String(statsPayload.total_rows ?? '-'),
      oldest: formatTimestamp(statsPayload.oldest_timestamp_ms),
      newest: formatTimestamp(statsPayload.newest_timestamp_ms),
      keyCount: String(keyPayload.returned_keys ?? 0),
    })

    const keyList = Array.isArray(keyPayload.keys) ? keyPayload.keys : []
    setKeys(keyList)
    if (!selectedKey && keyList.length) {
      setSelectedKey(keyList[0].key)
    }
    setStatus({ message: 'Ready', type: 'ok' })
  }, [selectedKey])

  const loadPage = useCallback(
    async (appendCursor: boolean) => {
      const key = selectedKey.trim()
      if (!key) {
        setStatus({ message: 'Choose a history key first.', type: 'warn' })
        return
      }
      if (appendCursor && !nextCursor) {
        setStatus({ message: 'There is no next page to load.', type: 'warn' })
        return
      }

      setLoading(true)
      setStatus({ message: appendCursor ? 'Loading next page...' : 'Loading first page...', type: 'ok' })

      try {
        const payload = await api.deviceHistory({
          keys: [key],
          limit: Number(limit) || 1000,
          startMs: parseDateTimeLocalToMs(startValue) ?? undefined,
          endMs: parseDateTimeLocalToMs(endValue) ?? undefined,
          cursorTimestampMs: appendCursor && nextCursor ? nextCursor.timestamp_ms : undefined,
          cursorId: appendCursor && nextCursor ? nextCursor.id : undefined,
        })

        const flat: HistoryRow[] = []
        Object.entries(payload.samples || {}).forEach(([sampleKey, samples]) => {
          ;(samples || []).forEach((sample) => flat.push({ key: sampleKey, ...sample }))
        })
        flat.sort((left, right) =>
          left.timestamp_ms !== right.timestamp_ms ? left.timestamp_ms - right.timestamp_ms : left.id - right.id,
        )

        setRows(flat)
        setReturnedRows(payload.returned_rows || 0)
        setNextCursor(payload.has_more ? payload.next_cursor : null)
        setStatus({
          message: payload.returned_rows ? 'Page loaded.' : 'No rows matched this query.',
          type: 'ok',
        })
      } catch (error) {
        setNextCursor(null)
        setStatus({ message: error instanceof Error ? error.message : String(error), type: 'error' })
      } finally {
        setLoading(false)
      }
    },
    [selectedKey, nextCursor, limit, startValue, endValue],
  )

  const resetFilters = useCallback(() => {
    setNextCursor(null)
    setStartValue('')
    setEndValue('')
    setLimit('1000')
    setReturnedRows(0)
    setRows([])
    setStatus({ message: 'Filters reset.', type: 'ok' })
  }, [])

  useEffect(() => {
    resetFilters()
    setLoading(true)
    refreshMetadata()
      .catch((error) => setStatus({ message: error instanceof Error ? error.message : String(error), type: 'error' }))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const buttonsDisabled = loading
  const nextDisabled = loading || !nextCursor

  return (
    <div className="history-page">
      <div className="hero">
        <div>
          <h1>History Browser</h1>
          <p>
            Browse paged device history from PostgreSQL. Pick a stored key, apply an optional time range, and step
            through the result pages with the cursor returned by the backend.
          </p>
        </div>
        <div className="hero-actions">
          <button
            type="button"
            disabled={buttonsDisabled}
            onClick={async () => {
              setLoading(true)
              try {
                await refreshMetadata()
              } catch (error) {
                setStatus({ message: error instanceof Error ? error.message : String(error), type: 'error' })
              } finally {
                setLoading(false)
              }
            }}
          >
            Refresh Stats + Keys
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="panel stat-card">
          <div className="stat-label">Total Rows</div>
          <div className="stat-value">{stats.totalRows}</div>
        </div>
        <div className="panel stat-card">
          <div className="stat-label">Oldest Timestamp</div>
          <div className="stat-value">{stats.oldest}</div>
        </div>
        <div className="panel stat-card">
          <div className="stat-label">Newest Timestamp</div>
          <div className="stat-value">{stats.newest}</div>
        </div>
        <div className="panel stat-card">
          <div className="stat-label">Stored Keys</div>
          <div className="stat-value">{stats.keyCount}</div>
        </div>
      </div>

      <div className="panel controls">
        <div className="control-grid">
          <div className="field">
            <label htmlFor="history-key-select">History Key</label>
            <select id="history-key-select" value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}>
              {!keys.length ? <option value="">No stored keys found</option> : null}
              {keys.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.key}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="history-start">Start Time</label>
            <input
              id="history-start"
              type="datetime-local"
              value={startValue}
              onChange={(e) => setStartValue(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="history-end">End Time</label>
            <input id="history-end" type="datetime-local" value={endValue} onChange={(e) => setEndValue(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="history-limit">Rows Per Page</label>
            <select id="history-limit" value={limit} onChange={(e) => setLimit(e.target.value)}>
              <option value="250">250</option>
              <option value="1000">1000</option>
              <option value="5000">5000</option>
              <option value="10000">10000</option>
            </select>
          </div>
          <div className="field">
            <label>Page Controls</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="button-primary"
                style={{ flex: 1 }}
                disabled={buttonsDisabled}
                onClick={() => {
                  setNextCursor(null)
                  void loadPage(false)
                }}
              >
                Load First Page
              </button>
              <button
                type="button"
                className="button-secondary"
                style={{ flex: 1 }}
                disabled={buttonsDisabled}
                onClick={resetFilters}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="panel meta">
        <div>
          <strong>Query Status</strong>
          <div className={`status ${status.type}`}>{status.message}</div>
        </div>
        <div>
          <strong>Cursor</strong>
          <div className="mono">{nextCursor ? `${nextCursor.timestamp_ms} / ${nextCursor.id}` : 'None'}</div>
        </div>
        <div>
          <strong>Returned Rows</strong>
          <div>{returnedRows}</div>
        </div>
        <div>
          <strong>More Pages</strong>
          <div>{nextCursor ? 'Yes' : 'No'}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="button-primary" disabled={nextDisabled} onClick={() => void loadPage(true)}>
            Load Next Page
          </button>
        </div>
      </div>

      <div className="panel table-panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Key</th>
                <th>Timestamp</th>
                <th>Unit</th>
                <th>State</th>
                <th>State Text</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {!rows.length ? (
                <tr>
                  <td className="empty" colSpan={7}>
                    No history loaded yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={`${row.key}-${row.id}`}>
                    <td className="mono">{row.id}</td>
                    <td>{row.key}</td>
                    <td>{formatTimestamp(row.timestamp_ms)}</td>
                    <td>{row.unit || ''}</td>
                    <td>{row.state || ''}</td>
                    <td>{row.state_str || ''}</td>
                    <td className="mono">
                      {typeof row.value === 'string' ? row.value : row.value == null ? '' : JSON.stringify(row.value)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
