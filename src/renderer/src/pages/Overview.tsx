// 集群详情（运维总览）— 按 ClusterDeploy 设计稿重绘。

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { App } from 'antd'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import type { ContainerInfo, NodeStatus, UninstallAllParams } from '@shared/types'

const display = { fontFamily: 'var(--display)' } as const
function chip(kind: 'ok' | 'neutral' | 'accent' | 'err' | 'warn'): CSSProperties {
  const m: Record<string, CSSProperties> = {
    ok: { background: 'var(--ok-soft)', color: 'var(--ok)' },
    accent: { background: 'var(--accent-soft)', color: 'var(--accent-ink)' },
    err: { background: 'var(--err-soft)', color: 'var(--err)' },
    warn: { background: 'var(--warn-soft)', color: 'var(--warn)' },
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
const cDot: Record<string, string> = { running: 'var(--ok)', exited: 'var(--err)', restarting: 'var(--warn)' }

const UN_OPTS: { key: keyof UninstallAllParams; label: string; hint: string; sev: string }[] = [
  { key: 'deleteData', label: '删除数据目录', hint: '各服务持久化卷与挂载数据', sev: '不可恢复' },
  { key: 'deleteImages', label: '删除所有服务镜像', hint: '下次部署需重新从离线包加载', sev: '可重建' },
  { key: 'removeInstallDir', label: '删除安装目录', hint: '~/sprixin-iotcloud 全部文件', sev: '不可恢复' },
  { key: 'removeDocker', label: '卸载 Docker 引擎', hint: '连同 systemd 守护一并清理', sev: '彻底清理' }
]

export default function Overview() {
  const { message } = App.useApp()
  const { nodes, startRun, endRun } = useWizard()
  const [status, setStatus] = useState<Record<string, NodeStatus>>({})
  const [loading, setLoading] = useState(false)
  const [unOpen, setUnOpen] = useState(false)
  const [opts, setOpts] = useState<UninstallAllParams>({
    deleteData: false,
    deleteImages: false,
    removeInstallDir: false,
    removeDocker: false
  })
  const [confirm, setConfirm] = useState('')

  const refresh = useCallback(
    async (notify = false) => {
      setLoading(true)
      try {
        const s = await ipc.overviewStatus(nodes)
        setStatus(s)
        if (notify) {
          const on = nodes.filter((n) => s[n.id]?.reachable).length
          const fail = nodes.length - on
          if (on === 0) message.error(`刷新失败 · ${nodes.length} 个节点均连接失败`)
          else if (fail > 0) message.warning(`刷新完成 · ${on}/${nodes.length} 在线，${fail} 个连接失败`)
          else message.success(`刷新完成 · ${on}/${nodes.length} 节点在线`)
        }
      } catch (e) {
        if (notify) message.error('刷新失败：' + (e instanceof Error ? e.message : String(e)))
      } finally {
        setLoading(false)
      }
    },
    [nodes, message]
  )
  useEffect(() => {
    refresh()
  }, [refresh])

  const list = nodes.map((n) => ({ id: n.id, ip: n.ip, st: status[n.id] }))
  const online = list.filter((x) => x.st?.reachable).length
  const containers = list.reduce((a, x) => a + (x.st?.containers.length ?? 0), 0)
  const alerts =
    list.filter((x) => x.st && !x.st.reachable).length +
    list.reduce((a, x) => a + (x.st?.containers.filter((c) => c.state !== 'running').length ?? 0), 0)

  async function runUninstall() {
    if (confirm.trim() !== '卸载集群') return
    setUnOpen(false)
    const runId = crypto.randomUUID()
    startRun('overview-uninstall', runId, nodes.map((n) => n.id))
    try {
      await ipc.overviewUninstallAll(runId, nodes, opts)
    } finally {
      endRun('overview-uninstall')
      refresh()
    }
  }

  const selCount = Object.values(opts).filter(Boolean).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, marginBottom: 20 }}>
        <div>
          <h1 style={{ ...display, fontWeight: 600, fontSize: 23, margin: '0 0 4px', letterSpacing: '-.02em' }}>集群详情</h1>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--dim)' }}>
            查看在线节点、运行容器与端口分布（只读）。连接失败的节点可重试。
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 9 }}>
            <KpiCard value={`${online}`} suffix={`/${nodes.length}`} label="节点在线" />
            <KpiCard value={`${containers}`} label="运行容器" />
            <KpiCard value={`${alerts}`} label="告警" color={alerts > 0 ? 'var(--warn)' : 'var(--text)'} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={ghostBtn} disabled={loading} onClick={() => refresh(true)}>
              {loading ? '刷新中…' : '⟳ 刷新'}
            </button>
            <button
              disabled={online === 0}
              title={online === 0 ? '没有可连接的节点，无法执行卸载' : undefined}
              style={{
                ...ghostBtn,
                color: online === 0 ? 'var(--faint)' : 'var(--err)',
                opacity: online === 0 ? 0.55 : 1,
                cursor: online === 0 ? 'not-allowed' : 'pointer'
              }}
              onClick={() => {
                if (online === 0) return
                setOpts({ deleteData: false, deleteImages: false, removeInstallDir: false, removeDocker: false })
                setConfirm('')
                setUnOpen(true)
              }}
            >
              ⏻ 一键卸载集群
            </button>
          </div>
        </div>
      </div>

      {list.map(({ id, ip, st }) => (
        <div
          key={id}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 14,
            background: 'var(--surface)',
            boxShadow: 'var(--card-shadow)',
            overflow: 'hidden',
            marginBottom: 14
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              padding: '14px 20px',
              borderBottom: '1px solid var(--border)',
              background: st?.reachable ? 'var(--surface)' : 'var(--err-soft)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: st?.reachable ? (st.dockerActive ? 'var(--ok)' : 'var(--warn)') : 'var(--err)'
                }}
              />
              <span style={{ fontWeight: 600, fontSize: 14.5 }}>{st?.hostname || ip}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--faint)' }}>{ip}</span>
            </div>
            {st?.reachable && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11.5, color: 'var(--dim)' }}>
                  服务 {st.containers.filter((c) => c.service).length} · 容器 {st.containers.length}
                </span>
                {st.arch && <span style={chip('neutral')}>{st.arch}</span>}
                <span style={chip(st.dockerActive ? 'ok' : 'err')}>docker {st.dockerActive ? 'active' : 'down'}</span>
              </div>
            )}
          </div>
          {st?.reachable ? (
            <div style={{ padding: '4px 20px 10px' }}>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: '9px 0 7px', fontSize: 12, color: 'var(--dim)' }}>
                {st.osPretty && <span>{st.osPretty}</span>}
                {st.load1 != null && <span>load {st.load1}</span>}
                {st.rootUsedPercent != null && <span>/ 使用 {st.rootUsedPercent}%</span>}
              </div>
              {st.containers.length === 0 ? (
                <div style={{ padding: '12px 0', fontSize: 12.5, color: 'var(--faint)', borderTop: '1px solid var(--border)' }}>
                  无运行容器
                </div>
              ) : (
                st.containers.map((c: ContainerInfo) => (
                  <div
                    key={c.name}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '16px 1.6fr 1fr 1.3fr',
                      alignItems: 'center',
                      gap: 10,
                      padding: '9px 0',
                      borderTop: '1px solid var(--border)'
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: cDot[c.state] || 'var(--faint)' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.name}
                      </span>
                      <span style={chip(c.service ? 'accent' : 'neutral')}>{c.service || '外部 · 只读'}</span>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--dim)' }}>{c.status}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.ports || '—'}
                    </span>
                  </div>
                ))
              )}
            </div>
          ) : st ? (
            <div style={{ padding: '15px 20px', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--err-soft)' }}>
              <span style={{ color: 'var(--err)', fontSize: 13, fontWeight: 600 }}>连接失败</span>
              <span style={{ fontSize: 12.5, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>{st.error}</span>
            </div>
          ) : (
            <div style={{ padding: '15px 20px', fontSize: 12.5, color: 'var(--faint)' }}>{loading ? '探测中…' : '未刷新'}</div>
          )}
        </div>
      ))}

      {unOpen && (
        <div
          onClick={() => setUnOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 65, padding: 24 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 540,
              maxHeight: '88vh',
              overflow: 'auto',
              background: 'var(--surface)',
              border: '1px solid var(--err-border)',
              borderRadius: 16,
              boxShadow: '0 28px 70px rgba(0,0,0,.5)'
            }}
          >
            <div style={{ padding: '18px 22px 16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--err-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ color: 'var(--err)', fontSize: 17 }}>⚠</span>
              </div>
              <div style={{ lineHeight: 1.3 }}>
                <div style={{ ...display, fontWeight: 600, fontSize: 16 }}>一键全卸载集群服务</div>
                <span style={{ fontSize: 12, color: 'var(--dim)' }}>停止并移除所有节点上「本工具部署」的服务 · 外部容器不受影响</span>
              </div>
            </div>
            <div style={{ padding: '18px 24px 22px' }}>
              <div style={{ fontSize: 11, letterSpacing: '.08em', color: 'var(--faint)', fontFamily: 'var(--mono)', textTransform: 'uppercase', marginBottom: 11 }}>
                附加清理项（按需勾选）
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 20 }}>
                {UN_OPTS.map((o) => {
                  const on = opts[o.key]
                  return (
                    <label
                      key={o.key}
                      onClick={() => setOpts((s) => ({ ...s, [o.key]: !s[o.key] }))}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 13,
                        padding: '12px 14px',
                        borderRadius: 11,
                        cursor: 'pointer',
                        border: `1px solid ${on ? 'var(--err-border)' : 'var(--border)'}`,
                        background: on ? 'var(--err-soft)' : 'transparent'
                      }}
                    >
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 6,
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 12,
                          fontWeight: 700,
                          background: on ? 'var(--err)' : 'var(--surface-2)',
                          border: on ? '1px solid var(--err)' : '1.5px solid var(--border-2)',
                          color: on ? '#fff' : 'transparent'
                        }}
                      >
                        ✓
                      </span>
                      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.45 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{o.label}</span>
                          <span style={chip(o.sev === '可重建' ? 'warn' : 'err')}>{o.sev}</span>
                        </div>
                        <span style={{ fontSize: 11.5, color: 'var(--faint)', fontFamily: 'var(--mono)' }}>{o.hint}</span>
                      </div>
                    </label>
                  )
                })}
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--dim)', marginBottom: 7 }}>
                  输入 <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--err)' }}>卸载集群</span> 以确认此操作
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <input
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="卸载集群"
                    className="cd-input"
                    style={{ padding: '10px 13px', fontSize: 13, fontFamily: 'var(--mono)', borderColor: confirm.trim() === '卸载集群' ? 'var(--err-border)' : undefined }}
                  />
                  <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
                    <button style={ghostBtn} onClick={() => setUnOpen(false)}>
                      取消
                    </button>
                    <button
                      disabled={confirm.trim() !== '卸载集群'}
                      onClick={runUninstall}
                      style={{
                        ...ghostBtn,
                        border: '1px solid var(--err)',
                        background: confirm.trim() === '卸载集群' ? 'var(--err)' : 'var(--surface-2)',
                        color: confirm.trim() === '卸载集群' ? '#fff' : 'var(--faint)',
                        cursor: confirm.trim() === '卸载集群' ? 'pointer' : 'not-allowed',
                        fontWeight: 700
                      }}
                    >
                      ⏻ {selCount > 0 ? `执行卸载 · 含 ${selCount} 项清理` : '执行卸载'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({ value, suffix, label, color }: { value: string; suffix?: string; label: string; color?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        alignItems: 'flex-start',
        padding: '8px 14px',
        border: '1px solid var(--border)',
        borderRadius: 11,
        background: 'var(--surface)',
        minWidth: 78
      }}
    >
      <span style={{ fontFamily: 'var(--display)', fontSize: 19, fontWeight: 600, color: color || 'var(--text)' }}>
        {value}
        {suffix && <span style={{ color: 'var(--faint)', fontSize: 13 }}>{suffix}</span>}
      </span>
      <span style={{ fontSize: 11, color: 'var(--dim)' }}>{label}</span>
    </div>
  )
}

const ghostBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 13px',
  border: '1px solid var(--border-2)',
  borderRadius: 9,
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit'
}
