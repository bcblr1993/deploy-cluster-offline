// 步骤3：时间对齐 — 设计稿重绘（策略选择卡 + 节点表）。

import { useState } from 'react'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import StepRunner from '../components/StepRunner'
import { btnGhost, card, chip, inputStyle, th } from '../styles/cd'
import type { Step3Params, TimeMode, TimePlan } from '@shared/types'

const MODES: { k: TimeMode; label: string; sub: string }[] = [
  { k: 'auto', label: '自动（按联网情况）', sub: '全联网→各自公网 · 部分/离线→选源' },
  { k: 'all-internet', label: '全部对公网 NTP', sub: 'ntp.aliyun.com · 需出网' },
  { k: 'source', label: '指定时间源', sub: '选一个节点为基准，其余对齐它' }
]

export default function Step3Time() {
  const { nodes, hostnames } = useWizard()
  const [tz, setTz] = useState('Asia/Shanghai')
  const [mode, setMode] = useState<TimeMode>('auto')
  const [src, setSrc] = useState<string | undefined>(nodes[0]?.id)
  const [plan, setPlan] = useState<TimePlan | null>(null)
  const [calc, setCalc] = useState(false)

  const params: Step3Params = { timezone: tz }
  async function compute() {
    setCalc(true)
    try {
      setPlan(await ipc.step3Strategy(nodes, mode, mode === 'source' ? src : undefined))
    } finally {
      setCalc(false)
    }
  }
  const srcIp = nodes.find((n) => n.id === plan?.sourceNodeId)?.ip

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: 'var(--dim)' }}>时区</span>
        <input style={{ ...inputStyle, width: 180, fontFamily: 'var(--mono)' }} value={tz} onChange={(e) => setTz(e.target.value)} />
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {MODES.map((m) => {
          const on = mode === m.k
          return (
            <button
              key={m.k}
              onClick={() => {
                setMode(m.k)
                setPlan(null)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '13px 16px',
                border: `1px solid ${on ? 'var(--accent-border)' : 'var(--border)'}`,
                borderRadius: 12,
                background: on ? 'var(--accent-soft)' : 'var(--surface)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                flex: 1,
                minWidth: 210,
                boxShadow: 'var(--card-shadow)',
                textAlign: 'left'
              }}
            >
              <span style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: on ? '5px solid var(--accent)' : '2px solid var(--border-2)', background: 'var(--surface)' }} />
              <div style={{ lineHeight: 1.4 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>{m.sub}</div>
              </div>
            </button>
          )
        })}
      </div>

      {mode === 'source' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: 'var(--dim)' }}>时间源节点</span>
          <select
            value={src}
            onChange={(e) => {
              setSrc(e.target.value)
              setPlan(null)
            }}
            style={{ ...inputStyle, width: 260 }}
          >
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {(hostnames[n.id] || n.ip) + ' (' + n.ip + ')'}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button style={btnGhost} onClick={compute}>
          {calc ? '探测中…' : '⟳ 探测策略'}
        </button>
        {plan && (
          <span style={{ fontSize: 12.5, color: 'var(--dim)' }}>
            {plan.sourceNodeId ? `时间源 ${srcIp} · ` : ''}在线 {plan.onlineNodeIds.length}/{nodes.length}
          </span>
        )}
      </div>

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.9fr', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
          <div style={th}>节点</div>
          <div style={th}>主机名</div>
          <div style={th}>角色</div>
        </div>
        {nodes.map((n, i) => {
          const isSrc = plan?.sourceNodeId === n.id
          const online = plan?.onlineNodeIds.includes(n.id)
          return (
            <div key={n.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.9fr', borderBottom: i < nodes.length - 1 ? '1px solid var(--border)' : undefined }}>
              <div style={{ padding: '13px 16px', fontFamily: 'var(--mono)', fontSize: 13, display: 'flex', alignItems: 'center' }}>{n.ip}</div>
              <div style={{ padding: '13px 16px', fontSize: 13, color: 'var(--dim)', display: 'flex', alignItems: 'center' }}>{hostnames[n.id] || '—'}</div>
              <div style={{ padding: '11px 16px', display: 'flex', alignItems: 'center' }}>
                {!plan ? <span style={chip('neutral')}>—</span> : isSrc ? <span style={chip('accent')}>时间源</span> : <span style={chip(online ? 'ok' : 'neutral')}>{online ? '对公网' : '跟随源'}</span>}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <StepRunner
          runKey="step3"
          nodes={nodes}
          actionLabel={`对齐 ${nodes.length} 个节点时间`}
          disabled={!plan}
          buildPlan={() => ipc.step3Plan(nodes, plan!, params)}
          run={(runId) => ipc.step3Run(runId, nodes, plan!, params)}
        />
      </div>
    </div>
  )
}
