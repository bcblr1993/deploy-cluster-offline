// 步骤6：服务编排 — 设计稿重绘（分层放置矩阵 + 数据落盘 + 部署）。

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import StepRunner from '../components/StepRunner'
import { btnGhost, card, chip } from '../styles/cd'
import type { DeploymentPreview, ServiceId, ServiceMeta } from '@shared/types'

const tierColor = (t: number): string => (t === 1 ? 'var(--accent)' : t === 2 ? 'var(--ok)' : 'var(--warn)')
const tierSoft = (t: number): string => (t === 1 ? 'var(--accent-soft)' : t === 2 ? 'var(--ok-soft)' : 'var(--warn-soft)')

function dataPathFor(mp: string, instanceId: string): string {
  return `${mp.replace(/\/+$/, '')}/sprixin-iotcloud-data/${instanceId}`
}
function fmtBytes(n: number): string {
  if (!n) return '-'
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`
}
const RECO: Partial<Record<ServiceId, 'ssd' | 'hdd'>> = { postgres: 'ssd', kafka: 'ssd', cassandra: 'hdd' }
// 数据落盘表格列宽：有状态服务 | 节点 | 推荐介质 | 落盘目标
const DP_GRID = 'minmax(170px,1.2fr) 120px 138px minmax(260px,2fr)'
const dpTh: CSSProperties = {
  padding: '11px 0',
  fontSize: 11,
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  color: 'var(--faint)',
  fontWeight: 600,
  fontFamily: 'var(--mono)'
}
const dpSelect: CSSProperties = {
  width: '100%',
  appearance: 'none',
  WebkitAppearance: 'none',
  padding: '9px 34px 9px 13px',
  borderRadius: 9,
  border: '1px solid var(--border-2)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 12.5,
  fontFamily: 'var(--mono)',
  cursor: 'pointer',
  outline: 'none',
  textOverflow: 'ellipsis',
  boxSizing: 'border-box'
}

export default function Step6Services() {
  const { nodes, hostnames, probes, placements, togglePlacement, disks, setPlacementDataPath, setView, deployed, setDeployed } = useWizard()
  const [catalog, setCatalog] = useState<Record<ServiceId, ServiceMeta> | null>(null)
  const [preview, setPreview] = useState<DeploymentPreview | null>(null)

  useEffect(() => {
    ipc.getCatalog().then(setCatalog).catch(() => undefined)
  }, [])

  const services = useMemo(() => (catalog ? (Object.values(catalog) as ServiceMeta[]).sort((a, b) => a.tier - b.tier) : []), [catalog])
  const mNodes = nodes.filter((n) => probes[n.id]?.supported)
  const placed = (svc: ServiceId, nodeId: string): boolean => placements.some((p) => p.service === svc && p.nodeId === nodeId)
  const stateful = placements.filter((p) => catalog?.[p.service]?.dataMount)

  const cellBase: CSSProperties = {
    width: 30,
    height: 30,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--mono)'
  }

  const mountsOf = (nodeId: string): { mp: string; type: 'SSD' | 'HDD'; size: number; used?: number }[] => {
    const out: { mp: string; type: 'SSD' | 'HDD'; size: number; used?: number }[] = []
    const seen = new Set<string>()
    for (const d of disks[nodeId] ?? [])
      for (const part of d.partitions)
        if (part.mountpoint && !seen.has(part.mountpoint)) {
          seen.add(part.mountpoint)
          out.push({ mp: part.mountpoint, type: d.type, size: part.sizeBytes, used: part.usedPercent })
        }
    return out
  }

  return (
    <div>
      {/* matrix */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `minmax(220px,1.6fr) repeat(${mNodes.length},1fr)`, background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ padding: '14px 18px', fontSize: 11, letterSpacing: '.09em', color: 'var(--faint)', fontFamily: 'var(--mono)', textTransform: 'uppercase' }}>
            服务 / 节点
          </div>
          {mNodes.map((n) => (
            <div key={n.id} style={{ padding: '12px 10px', borderLeft: '1px solid var(--border)', textAlign: 'center' }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{hostnames[n.id] || n.ip.split('.').pop()}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>{n.ip}</div>
            </div>
          ))}
        </div>
        {services.map((c, ri) => {
          const manual = !!c.manual
          return (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: `minmax(220px,1.6fr) repeat(${mNodes.length},1fr)`, borderBottom: ri < services.length - 1 ? '1px solid var(--border)' : undefined }}>
              <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700, fontFamily: 'var(--mono)', flexShrink: 0, background: tierSoft(c.tier), color: tierColor(c.tier) }}>
                  T{c.tier}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                    <span style={chip('neutral')}>{c.role}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.image} · :{c.ports.join(',')}
                  </div>
                </div>
              </div>
              {mNodes.map((n) => {
                const on = placed(c.id, n.id)
                let style: CSSProperties
                let mark = '+'
                if (manual) {
                  style = { ...cellBase, background: 'transparent', border: '1px dashed var(--border-2)', color: 'var(--faint)', cursor: 'not-allowed' }
                  mark = '–'
                } else if (on) {
                  style = { ...cellBase, background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff' }
                  mark = '✓'
                } else {
                  style = { ...cellBase, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'transparent' }
                }
                return (
                  <div key={n.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--border)', padding: 11 }}>
                    <button style={style} onClick={() => !manual && togglePlacement(c.id, n.id, c.singleton)}>
                      {mark}
                    </button>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--faint)', fontFamily: 'var(--mono)' }}>启动分层</span>
          <span style={chip('accent')}>T1 数据层</span>
          <span style={{ color: 'var(--faint)' }}>→</span>
          <span style={chip('ok')}>T2 应用层</span>
          <span style={{ color: 'var(--faint)' }}>→</span>
          <span style={chip('warn')}>T3 运维层</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={btnGhost} onClick={async () => setPreview(await ipc.step6Preview(placements, nodes))} disabled={placements.length === 0}>
            生成预览
          </button>
          <StepRunner
            runKey="step6-deploy"
            nodes={nodes.filter((n) => placements.some((p) => p.nodeId === n.id))}
            actionLabel={`部署到 ${mNodes.length} 个节点`}
            icon="⏵"
            disabled={placements.length === 0}
            buildPlan={() => ipc.step6Plan(placements, nodes)}
            run={(runId) => ipc.step6Deploy(runId, nodes, { placements })}
            onDone={(r) => {
              setDeployed(r.every((x) => x.status === 'success'))
              const cl = useWizard.getState().toCluster()
              if (cl.id) void ipc.clusterSave(cl)
            }}
          />
        </div>
      </div>

      {/* data placement — 对齐网格表格 */}
      {stateful.length > 0 && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ padding: '15px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 14 }}>数据落盘位置</span>
            <span style={{ fontSize: 12, color: 'var(--faint)' }}>
              有状态服务的持久化目录 · 留空即用默认安装目录 <span style={{ fontFamily: 'var(--mono)' }}>~/sprixin-iotcloud</span>
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: DP_GRID, gap: 14, alignItems: 'center', padding: '0 18px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
            <div style={dpTh}>有状态服务</div>
            <div style={dpTh}>节点</div>
            <div style={dpTh}>推荐介质</div>
            <div style={dpTh}>落盘目标</div>
          </div>
          {stateful.map((p) => {
            const meta = catalog?.[p.service]
            const mps = mountsOf(p.nodeId)
            const recoKind = RECO[p.service]
            const recoMp = recoKind
              ? mps.filter((m) => (recoKind === 'ssd' ? m.type === 'SSD' : m.type === 'HDD')).sort((a, b) => b.size - a.size)[0]?.mp
              : undefined
            const same = placements.filter((x) => x.service === p.service)
            const cluster = same.length > 1
            const ordinal = same.findIndex((x) => x.instanceId === p.instanceId) + 1
            const recoLabel = recoKind === 'ssd' ? 'SSD' : recoKind === 'hdd' ? '大容量 HDD' : '默认目录'
            const recoDot = recoKind === 'ssd' ? 'var(--accent)' : recoKind === 'hdd' ? 'var(--warn)' : 'var(--faint)'
            const recoTone: CSSProperties =
              recoKind === 'ssd'
                ? { background: 'var(--accent-soft)', color: 'var(--accent-ink)' }
                : recoKind === 'hdd'
                  ? { background: 'var(--warn-soft)', color: 'var(--warn)' }
                  : { background: 'var(--surface-2)', color: 'var(--dim)', border: '1px solid var(--border)' }
            const node = nodes.find((n) => n.id === p.nodeId)
            return (
              <div key={p.instanceId} style={{ display: 'grid', gridTemplateColumns: DP_GRID, gap: 14, alignItems: 'center', padding: '11px 18px', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                  <span style={chip('accent')}>{meta?.name ?? p.service}</span>
                  {cluster && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>#{ordinal}</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {(hostnames[p.nodeId] || node?.ip) + ' · ' + node?.ip}
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 7, fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--mono)', ...recoTone }}>
                    <span style={{ width: 6, height: 6, borderRadius: 2, background: recoDot, flexShrink: 0 }} />
                    {recoLabel}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ position: 'relative', width: '100%' }}>
                    <select value={p.dataPath ?? ''} onChange={(e) => setPlacementDataPath(p.instanceId, e.target.value || undefined)} style={dpSelect}>
                      <option value="">默认目录  ~/sprixin-iotcloud</option>
                      {mps.map((m) => (
                        <option key={m.mp} value={dataPathFor(m.mp, p.instanceId)}>
                          {`${m.mp}  ·  ${m.type}  ·  ${fmtBytes(m.size)}${m.used != null ? `  ·  已用 ${m.used}%` : ''}${m.mp === recoMp ? '   ★ 推荐' : ''}`}
                        </option>
                      ))}
                    </select>
                    <span style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--faint)', fontSize: 10 }}>▼</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* config preview */}
      {preview && preview.warnings.length > 0 && (
        <div style={{ ...card, borderColor: 'var(--warn)', padding: '12px 16px', marginBottom: 12 }}>
          {preview.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12.5, color: 'var(--warn)' }}>
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
      {preview &&
        preview.instances.map((inst) => (
          <details key={inst.instanceId} style={{ ...card, padding: '10px 14px', marginBottom: 8 }}>
            <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--display)', fontWeight: 600 }}>{inst.instanceId}</span>
              <span style={chip('accent')}>{inst.nodeIp}</span>
              {inst.cluster && <span style={chip('warn')}>集群</span>}
            </summary>
            <pre style={{ margin: '8px 0 0', background: 'var(--surface-2)', padding: 10, borderRadius: 6, fontSize: 11.5, fontFamily: 'var(--mono)', maxHeight: 240, overflow: 'auto' }}>
              {inst.compose}
              {inst.env ? '\n# .env\n' + inst.env : ''}
            </pre>
          </details>
        ))}

      {deployed && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderRadius: 13, border: '1px solid var(--ok-soft)', background: 'var(--ok-soft)', marginTop: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ok)' }}>部署完成 · 可进入「集群详情」查看运行状态</span>
          <button style={btnGhost} onClick={() => setView('overview')}>
            进入集群详情 →
          </button>
        </div>
      )}
    </div>
  )
}
