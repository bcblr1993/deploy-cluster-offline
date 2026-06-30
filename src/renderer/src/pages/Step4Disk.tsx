// 步骤4：磁盘预览 — 设计稿重绘（每节点磁盘卡 + 使用率条）。

import { useCallback, useEffect, useState } from 'react'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import { btnGhost, card, chip } from '../styles/cd'

function fmt(n: number): string {
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

export default function Step4Disk() {
  const { nodes, hostnames, disks, setDisks } = useWizard()
  const [loading, setLoading] = useState(false)

  const scan = useCallback(async () => {
    setLoading(true)
    try {
      setDisks(await ipc.step4Probe(nodes))
    } finally {
      setLoading(false)
    }
  }, [nodes, setDisks])
  useEffect(() => {
    scan()
  }, [scan])

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <button style={btnGhost} onClick={scan}>
          {loading ? '扫描中…' : '⟳ 重新扫描'}
        </button>
      </div>
      {nodes.map((n) => {
        const ds = disks[n.id]
        return (
          <div key={n.id} style={{ ...card, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 18px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600 }}>{n.ip}</span>
                <span style={{ fontSize: 12, color: 'var(--faint)' }}>{hostnames[n.id] || ''}</span>
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--dim)' }}>{ds ? `${ds.length} 块盘` : loading ? '扫描中…' : '未扫描'}</span>
            </div>
            <div style={{ padding: '6px 18px 12px' }}>
              {(ds ?? []).flatMap((d) =>
                (d.partitions.length ? d.partitions : [{ name: '(无分区)', sizeBytes: d.sizeBytes, mountpoint: undefined, usedPercent: undefined }]).map((part, pi) => {
                  const used = part.usedPercent ?? 0
                  const barColor = used > 80 ? 'var(--err)' : used > 60 ? 'var(--warn)' : 'var(--ok)'
                  return (
                    <div key={d.name + pi} style={{ display: 'grid', gridTemplateColumns: '1fr 0.7fr 1fr 2fr', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                        <span style={chip(d.type === 'SSD' ? 'accent' : 'neutral')}>{d.type}</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>/dev/{part.name}</span>
                      </div>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--dim)' }}>{fmt(part.sizeBytes)}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--faint)' }}>{part.mountpoint || '未挂载'}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${used}%`, background: barColor, borderRadius: 4 }} />
                        </div>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--dim)', width: 64, textAlign: 'right' }}>
                          {part.usedPercent != null ? `${used}% 已用` : '—'}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
              {ds && ds.length === 0 && <div style={{ padding: '12px 0', fontSize: 12.5, color: 'var(--faint)' }}>无数据或扫描失败</div>}
            </div>
          </div>
        )
      })}
      <p style={{ margin: '4px 2px 0', fontSize: 12.5, color: 'var(--faint)', lineHeight: 1.6 }}>
        本步骤只读预览，不修改磁盘；含未挂载磁盘/分区。服务部署时会在数据目录创建持久化卷。
      </p>
    </div>
  )
}
