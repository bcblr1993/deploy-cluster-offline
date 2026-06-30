// 步骤6：服务编排 — 设计稿重绘（分层放置矩阵 + 数据落盘 + 部署）。

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import StepRunner from '../components/StepRunner'
import { btnGhost, card, chip, inputStyle } from '../styles/cd'
import type { DeploymentPreview, ServiceId, ServiceMeta } from '@shared/types'

const tierColor = (t: number): string => (t === 1 ? 'var(--accent)' : t === 2 ? 'var(--ok)' : 'var(--warn)')
const tierSoft = (t: number): string => (t === 1 ? 'var(--accent-soft)' : t === 2 ? 'var(--ok-soft)' : 'var(--warn-soft)')

function dataPathFor(mp: string, instanceId: string): string {
  return `${mp.replace(/\/+$/, '')}/sprixin-iotcloud-data/${instanceId}`
}
const RECO: Partial<Record<ServiceId, 'ssd' | 'hdd'>> = { postgres: 'ssd', kafka: 'ssd', cassandra: 'hdd' }

export default function Step6Services() {
  const { nodes, hostnames, probes, placements, togglePlacement, disks, setPlacementDataPath, setView } = useWizard()
  const [catalog, setCatalog] = useState<Record<ServiceId, ServiceMeta> | null>(null)
  const [preview, setPreview] = useState<DeploymentPreview | null>(null)
  const [deployed, setDeployed] = useState(false)

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

      {/* data placement */}
      {stateful.length > 0 && (
        <div style={{ ...card, padding: '16px 18px', marginBottom: 16 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 14, marginBottom: 10 }}>数据落盘位置</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stateful.map((p) => {
              const mps = mountsOf(p.nodeId)
              const recoKind = RECO[p.service]
              const recoMp = recoKind
                ? mps.filter((m) => (recoKind === 'ssd' ? m.type === 'SSD' : m.type === 'HDD')).sort((a, b) => b.size - a.size)[0]?.mp
                : undefined
              return (
                <div key={p.instanceId} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ ...chip('accent'), minWidth: 92, justifyContent: 'center' }}>{p.instanceId}</span>
                  <span style={{ fontSize: 12, color: 'var(--faint)', width: 64 }}>{hostnames[p.nodeId] || nodes.find((n) => n.id === p.nodeId)?.ip}</span>
                  <span style={chip('warn')}>推荐: {recoKind === 'ssd' ? 'SSD' : recoKind === 'hdd' ? '最大机械盘' : '默认'}</span>
                  <select
                    value={p.dataPath ?? ''}
                    onChange={(e) => setPlacementDataPath(p.instanceId, e.target.value || undefined)}
                    style={{ ...inputStyle, width: 340 }}
                  >
                    <option value="">默认（~/sprixin-iotcloud）</option>
                    {mps.map((m) => (
                      <option key={m.mp} value={dataPathFor(m.mp, p.instanceId)}>
                        {m.mp} · {m.type}
                        {m.used != null ? ` · 已用 ${m.used}%` : ''}
                        {m.mp === recoMp ? ' · 推荐' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
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
