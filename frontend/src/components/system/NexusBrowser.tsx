/**
 * NeXus Export Browser modal — React port of ensureNexusBrowserModal /
 * refreshNexusBrowserFiles / loadNexusBrowserNode / renderNexusBrowserNode
 * from system-core.js (3-pane: files / node tree / details).
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { NexusFileEntry, NexusNodeInfo } from '../../api/types'

function formatSize(bytes: number): string {
  const value = Number(bytes || 0)
  if (!Number.isFinite(value) || value < 1024) return `${value || 0} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatPreview(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function nodeLabel(path: string): string {
  const text = String(path || '/').trim()
  if (!text || text === '/') return '/'
  return text.replace(/^\//, '')
}

export function NexusBrowser({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [files, setFiles] = useState<NexusFileEntry[]>([])
  const [fileName, setFileName] = useState('')
  const [path, setPath] = useState('/')
  const [node, setNode] = useState<NexusNodeInfo | null>(null)
  const [filesMessage, setFilesMessage] = useState('')
  const [detailMessage, setDetailMessage] = useState('')

  const loadNode = useCallback(async (file: string, objectPath: string) => {
    setFileName(file)
    setPath(objectPath || '/')
    setDetailMessage('Loading details...')
    setNode(null)
    try {
      const payload = await api.nexusInspect(file, objectPath || '/')
      setNode(payload.node)
      setDetailMessage('')
    } catch (e) {
      setDetailMessage(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const refreshFiles = useCallback(
    async (preferredFileName?: string) => {
      setFilesMessage('Loading export files...')
      try {
        const payload = await api.nexusFiles()
        const list = Array.isArray(payload.files) ? payload.files : []
        setFiles(list)
        setFilesMessage(list.length ? '' : 'No export files available.')
        if (!list.length) {
          setDetailMessage('No NeXus export files found yet.')
          return
        }
        const target =
          preferredFileName && list.some((f) => f.name === preferredFileName) ? preferredFileName : list[0].name
        await loadNode(target, '/')
      } catch (e) {
        setFilesMessage('Failed to load export files.')
        setDetailMessage(e instanceof Error ? e.message : String(e))
      }
    },
    [loadNode],
  )

  useEffect(() => {
    if (open) void refreshFiles(fileName || undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const parentPath = (() => {
    if (path === '/') return '/'
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    return parts.length ? `/${parts.join('/')}` : '/'
  })()

  return (
    <div
      id="nexus-browser-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.38)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100001,
        padding: 16,
        boxSizing: 'border-box',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: 'min(1100px, 100%)',
          maxHeight: '88vh',
          background: '#ffffff',
          borderRadius: 10,
          boxShadow: '0 18px 40px rgba(15, 23, 42, 0.24)',
          border: '1px solid rgba(148, 163, 184, 0.35)',
          color: '#0f172a',
          fontFamily: 'Arial, sans-serif',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px',
            borderBottom: '1px solid #e2e8f0',
            background: '#f8fafc',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>NeXus Export Browser</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Browse exported .nxs files directly in the app.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => void refreshFiles(fileName || undefined)}
              style={{ padding: '6px 10px', border: 'none', borderRadius: 6, background: '#e2e8f0', cursor: 'pointer' }}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: '6px 10px', border: 'none', borderRadius: 6, background: '#0f172a', color: 'white', cursor: 'pointer' }}
            >
              Close
            </button>
          </div>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '260px minmax(280px, 1fr) minmax(300px, 1fr)',
            gap: 0,
            minHeight: 0,
            flex: 1,
          }}
        >
          {/* Files column */}
          <div style={{ borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              Export Files
            </div>
            <div style={{ padding: 10, overflow: 'auto', minHeight: 0 }}>
              {filesMessage && <div style={{ fontSize: 12, color: '#64748b' }}>{filesMessage}</div>}
              {files.map((fileInfo) => (
                <button
                  key={fileInfo.name}
                  type="button"
                  onClick={() => void loadNode(fileInfo.name, '/')}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: 10,
                    borderRadius: 8,
                    border: fileInfo.name === fileName ? '1px solid #0f766e' : '1px solid #cbd5e1',
                    background: fileInfo.name === fileName ? '#ecfdf5' : '#ffffff',
                    cursor: 'pointer',
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{fileInfo.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{formatSize(fileInfo.size)}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Node tree column */}
          <div style={{ borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{fileName || 'No file selected'}</div>
              <div style={{ fontSize: 13, fontWeight: 700, wordBreak: 'break-all' }}>{path}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  disabled={!fileName}
                  onClick={() => fileName && void loadNode(fileName, '/')}
                  style={{ padding: '5px 8px', border: 'none', borderRadius: 6, background: '#e2e8f0', cursor: 'pointer' }}
                >
                  Root
                </button>
                <button
                  type="button"
                  disabled={!fileName || path === '/'}
                  onClick={() => fileName && path !== '/' && void loadNode(fileName, parentPath)}
                  style={{
                    padding: '5px 8px',
                    border: 'none',
                    borderRadius: 6,
                    background: '#e2e8f0',
                    cursor: path === '/' ? 'default' : 'pointer',
                    opacity: path === '/' ? 0.5 : 1,
                  }}
                >
                  Up
                </button>
              </div>
            </div>
            <div style={{ padding: 10, overflow: 'auto', minHeight: 0 }}>
              {!node && <div style={{ fontSize: 12, color: '#64748b' }}>Loading node...</div>}
              {node?.kind === 'group' &&
                (node.children?.length ? (
                  node.children.map((child) => (
                    <button
                      key={child.path}
                      type="button"
                      title={child.path || child.name}
                      onClick={() => void loadNode(node.file_name, child.path)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        cursor: 'pointer',
                        marginBottom: 8,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', wordBreak: 'break-word' }}>
                        {nodeLabel(child.path)}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                        {child.kind === 'group' ? 'Folder' : 'Dataset'}
                      </div>
                    </button>
                  ))
                ) : (
                  <div style={{ fontSize: 12, color: '#64748b' }}>This group has no children.</div>
                ))}
              {node?.kind === 'dataset' && (
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: 10,
                    margin: 0,
                    fontSize: 12,
                  }}
                >
                  {formatPreview(node.preview)}
                </pre>
              )}
            </div>
          </div>

          {/* Details column */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              Details
            </div>
            <div style={{ padding: 14, overflow: 'auto', minHeight: 0, fontSize: 12, lineHeight: 1.5 }}>
              {detailMessage && <div style={{ color: '#64748b' }}>{detailMessage}</div>}
              {node && (
                <>
                  {(
                    [
                      ['Path', node.path],
                      ['Attributes', formatPreview(node.attrs || {})],
                      ...(node.kind === 'dataset'
                        ? ([
                            ['Shape', formatPreview(node.shape || [])],
                            ['DType', node.dtype || ''],
                            ['Entries', String(node.size || 0)],
                            ['Preview', formatPreview(node.preview)],
                          ] as Array<[string, string]>)
                        : ([['Children', String((node.children || []).length)]] as Array<[string, string]>)),
                    ] as Array<[string, string]>
                  ).map(([label, value]) => (
                    <div key={label} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                        {label}
                      </div>
                      <pre
                        style={{
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: 8,
                          padding: 10,
                          margin: 0,
                          fontSize: 12,
                        }}
                      >
                        {value}
                      </pre>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
