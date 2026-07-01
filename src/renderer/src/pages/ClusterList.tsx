// 集群列表页（落地页）— 按 ClusterDeploy 设计稿重绘（自绘风格 + 双主题）。

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { App } from 'antd'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import ClusterMark from '../components/ClusterMark'
import type { ClusterSummary } from '@shared/types'

type Filter = 'all' | 'deployed' | 'undeployed'

const btnPrimary: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  padding: '9px 17px',
  border: 'none',
  borderRadius: 9,
  background: 'var(--accent)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap'
}
const btnGhost: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 15px',
  border: '1px solid var(--border)',
  borderRadius: 9,
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit'
}
const themeBtn: CSSProperties = {
  width: 38,
  height: 36,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  borderRadius: 9,
  color: 'var(--dim)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
}
const iconBtn: CSSProperties = {
  width: 30,
  height: 30,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface-2)',
  color: 'var(--dim)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
}
const display = { fontFamily: 'var(--display)' } as const
const ipChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 9px',
  borderRadius: 7,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--dim)',
  fontFamily: 'var(--mono)',
  fontSize: 12,
  fontWeight: 500
}
const ipMore: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 9px',
  borderRadius: 7,
  border: '1px dashed var(--border-2)',
  background: 'transparent',
  color: 'var(--faint)',
  fontFamily: 'var(--mono)',
  fontSize: 12
}

function chip(kind: 'ok' | 'neutral'): CSSProperties {
  const m: Record<string, CSSProperties> = {
    ok: { background: 'var(--ok-soft)', color: 'var(--ok)' },
    neutral: { background: 'var(--surface-2)', color: 'var(--dim)', border: '1px solid var(--border)' }
  }
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 9px',
    borderRadius: 6,
    fontSize: 11.5,
    fontWeight: 600,
    fontFamily: 'var(--mono)',
    ...m[kind]
  }
}

export default function ClusterList() {
  const { message } = App.useApp()
  const { theme, toggleTheme, openCluster } = useWizard()
  const [clusters, setClusters] = useState<ClusterSummary[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [edit, setEdit] = useState<{ id?: string; name: string; remark: string } | null>(null)
  const [del, setDel] = useState<ClusterSummary | null>(null)

  const refresh = useCallback(async () => {
    setClusters(await ipc.clustersList())
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])

  async function enter(id: string) {
    const c = await ipc.clusterLoad(id)
    if (c) openCluster(c)
    else message.error('集群不存在')
  }
  async function submitEdit() {
    if (!edit || !edit.name.trim()) {
      message.warning('请输入集群名称')
      return
    }
    if (edit.id) {
      await ipc.clusterRename(edit.id, edit.name.trim(), edit.remark || undefined)
      setEdit(null)
      refresh()
    } else {
      const c = await ipc.clusterCreate(edit.name.trim(), edit.remark || undefined)
      setEdit(null)
      openCluster(c)
    }
  }
  async function confirmDelete() {
    if (!del) return
    await ipc.clusterDelete(del.id)
    setDel(null)
    refresh()
  }

  const counts = {
    all: clusters.length,
    deployed: clusters.filter((c) => c.deployed).length,
    undeployed: clusters.filter((c) => !c.deployed).length
  }
  const q = query.trim().toLowerCase()
  const filtered = clusters.filter((c) => {
    if (filter === 'deployed' && !c.deployed) return false
    if (filter === 'undeployed' && c.deployed) return false
    if (q && !(c.name.toLowerCase().includes(q) || (c.remark || '').toLowerCase().includes(q)))
      return false
    return true
  })
  const filterDefs: { k: Filter; label: string }[] = [
    { k: 'all', label: '全部' },
    { k: 'deployed', label: '已部署' },
    { k: 'undeployed', label: '未部署' }
  ]

  return (
    <div
      style={{
        height: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--body)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* header */}
      <header
        style={{
          height: 60,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 26px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <ClusterMark size={32} variant="brand" pip pulse radiusRatio={0.26} style={{ flexShrink: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{ ...display, fontWeight: 600, fontSize: 15, letterSpacing: '-.01em' }}>
              离线集群部署
            </span>
            <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--mono)' }}>
              cluster-deploy · offline
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={btnPrimary} onClick={() => setEdit({ name: '', remark: '' })}>
            <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>新建集群
          </button>
          <button style={themeBtn} title="切换主题" onClick={toggleTheme}>
            <span style={{ fontSize: 15 }}>{theme === 'dark' ? '☀' : '☾'}</span>
          </button>
        </div>
      </header>

      <main style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '34px 30px 50px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 24,
              marginBottom: 24
            }}
          >
            <div style={{ maxWidth: 560 }}>
              <h1 style={{ ...display, fontWeight: 600, fontSize: 26, margin: '0 0 7px', letterSpacing: '-.02em' }}>
                集群管理
              </h1>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--dim)' }}>
                管理已部署的现场集群，或部署一套新的。每个集群的节点与服务配置独立保存。
              </p>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 9,
                padding: '9px 14px',
                flexShrink: 0
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />
              <span style={{ fontSize: 12.5, color: 'var(--dim)' }}>
                共 {counts.all} 个 · 已部署 {counts.deployed}
              </span>
            </div>
          </div>

          {/* search + filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 240, maxWidth: 360 }}>
              <span
                style={{
                  position: 'absolute',
                  left: 13,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--faint)',
                  fontSize: 13
                }}
              >
                ⌕
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索集群名称 / 备注"
                className="cd-input"
                style={{ padding: '9px 13px 9px 32px', background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 13 }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 9,
                padding: 3,
                gap: 2
              }}
            >
              {filterDefs.map((f) => {
                const on = filter === f.k
                return (
                  <button
                    key={f.k}
                    onClick={() => setFilter(f.k)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 13px',
                      border: 'none',
                      borderRadius: 7,
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      background: on ? 'var(--accent)' : 'transparent',
                      color: on ? '#fff' : 'var(--dim)'
                    }}
                  >
                    {f.label}
                    <span
                      style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '0 5px',
                        borderRadius: 5,
                        background: on ? 'rgba(255,255,255,.22)' : 'var(--surface)',
                        color: on ? '#fff' : 'var(--faint)'
                      }}
                    >
                      {counts[f.k]}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* cards grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: 16 }}>
            {filtered.map((c) => (
              <div
                key={c.id}
                onClick={() => enter(c.id)}
                style={{
                  position: 'relative',
                  textAlign: 'left',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  background: 'var(--surface)',
                  boxShadow: 'var(--card-shadow)',
                  padding: '18px 20px 16px',
                  cursor: 'pointer',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 3,
                    background: c.deployed ? 'var(--ok)' : 'var(--faint)'
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 13
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        background: c.deployed ? 'var(--ok)' : 'var(--faint)',
                        flexShrink: 0
                      }}
                    />
                    <span
                      style={{
                        ...display,
                        fontWeight: 600,
                        fontSize: 16,
                        letterSpacing: '-.01em',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {c.name}
                    </span>
                  </div>
                  <span style={chip(c.deployed ? 'ok' : 'neutral')}>{c.deployed ? '已部署' : '未部署'}</span>
                </div>
                {c.remark && c.remark.trim() && (
                  <p style={{ margin: '0 0 12px', fontSize: 12, lineHeight: 1.5, color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.remark}
                  </p>
                )}
                <div style={{ marginBottom: 15 }}>
                  <div style={{ fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '.1em', color: 'var(--faint)', textTransform: 'uppercase', marginBottom: 8 }}>
                    节点 IP
                  </div>
                  {c.ips.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {c.ips.slice(0, 4).map((ip) => (
                        <span key={ip} style={ipChip}>
                          {ip}
                        </span>
                      ))}
                      {c.ips.length > 4 && <span style={ipMore}>+{c.ips.length - 4}</span>}
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--faint)', fontStyle: 'italic' }}>尚未接入节点</span>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    paddingTop: 14,
                    borderTop: '1px solid var(--border)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--dim)' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>
                        {c.nodeCount}
                      </span>
                      节点
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--faint)', fontFamily: 'var(--mono)' }}>
                      {c.deployed ? '进入 → 运维' : '进入 → 部署'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      title="重命名"
                      style={iconBtn}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEdit({ id: c.id, name: c.name, remark: c.remark ?? '' })
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                    <button
                      title="删除"
                      style={iconBtn}
                      onClick={(e) => {
                        e.stopPropagation()
                        setDel(c)
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={() => setEdit({ name: '', remark: '' })}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                minHeight: 148,
                border: '1.5px dashed var(--border-2)',
                borderRadius: 14,
                background: 'transparent',
                color: 'var(--dim)',
                cursor: 'pointer',
                fontFamily: 'inherit'
              }}
            >
              <span style={{ fontSize: 26, lineHeight: 1, fontWeight: 300 }}>+</span>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>新建集群</span>
              <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>如：日新鸿晟 / 一汽现场</span>
            </button>
          </div>

          {filtered.length === 0 && (query !== '' || filter !== 'all') && (
            <div style={{ textAlign: 'center', padding: '70px 20px', color: 'var(--faint)' }}>
              <div style={{ fontSize: 34, marginBottom: 14, opacity: 0.5 }}>⬡</div>
              <p style={{ margin: 0, fontSize: 13.5 }}>没有匹配的集群，换个关键词或新建一个。</p>
            </div>
          )}
          {clusters.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--faint)' }}>
              <p style={{ margin: 0, fontSize: 13.5 }}>还没有集群，点「新建集群」开始。</p>
            </div>
          )}
        </div>
      </main>

      {/* create / edit modal */}
      {edit && (
        <Overlay onClose={() => setEdit(null)}>
          <div style={{ padding: '20px 22px 0' }}>
            <h3 style={{ ...display, fontWeight: 600, fontSize: 18, margin: '0 0 5px' }}>
              {edit.id ? '重命名集群' : '新建集群'}
            </h3>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--dim)' }}>
              {edit.id ? '仅修改本地集群名称与备注，不影响已部署的节点。' : '创建后直接进入部署向导，录入节点信息。'}
            </p>
          </div>
          <div style={{ padding: '18px 22px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="集群名称">
              <input
                autoFocus
                className="cd-input"
                style={{ padding: '10px 13px', fontSize: 13.5 }}
                placeholder="如：日新鸿晟 / 一汽现场"
                value={edit.name}
                onChange={(e) => setEdit((s) => (s ? { ...s, name: e.target.value } : s))}
                onKeyDown={(e) => e.key === 'Enter' && submitEdit()}
              />
            </Field>
            <Field label="备注（可选）">
              <input
                className="cd-input"
                style={{ padding: '10px 13px', fontSize: 13.5 }}
                placeholder="现场位置、负责人、用途…"
                value={edit.remark}
                onChange={(e) => setEdit((s) => (s ? { ...s, remark: e.target.value } : s))}
              />
            </Field>
          </div>
          <div style={{ padding: '14px 22px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button style={btnGhost} onClick={() => setEdit(null)}>
              取消
            </button>
            <button style={btnPrimary} onClick={submitEdit}>
              {edit.id ? '保存' : '创建并进入'}
            </button>
          </div>
        </Overlay>
      )}

      {/* delete confirm */}
      {del && (
        <Overlay onClose={() => setDel(null)}>
          <div style={{ padding: '20px 22px 0' }}>
            <h3 style={{ ...display, fontWeight: 600, fontSize: 18, margin: '0 0 5px' }}>
              删除集群「{del.name}」？
            </h3>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--dim)', lineHeight: 1.6 }}>
              仅删除本地集群配置，不会影响远程物理节点或其上运行的服务。
            </p>
          </div>
          <div style={{ padding: '18px 22px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button style={btnGhost} onClick={() => setDel(null)}>
              取消
            </button>
            <button
              style={{
                ...btnPrimary,
                background: 'var(--err)'
              }}
              onClick={confirmDelete}
            >
              删除
            </button>
          </div>
        </Overlay>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: 24
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,.4)',
          overflow: 'hidden'
        }}
      >
        {children}
      </div>
    </div>
  )
}
