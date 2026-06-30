// 全局运行控制台（底部滑出）— 按 ClusterDeploy 设计稿。
// 读取 store 的 activeRunKey 对应运行状态，展示节点列表 + 日志 + 进度。

import { useEffect, useState, type CSSProperties } from 'react'
import { useWizard } from '../store/wizard'
import type { TaskStatus } from '@shared/types'

const TITLES: Record<string, string> = {
  step2: '主机名 & hosts',
  step3: '时间对齐 · chrony',
  step5: '安装 Docker · 离线包',
  'step6-deploy': '部署服务 · 全集群',
  'overview-uninstall': '卸载集群服务'
}

const sColor: Record<TaskStatus, string> = {
  pending: 'var(--faint)',
  running: 'var(--accent)',
  success: 'var(--ok)',
  failed: 'var(--err)'
}
const sLabel: Record<TaskStatus, string> = {
  pending: '等待',
  running: '运行',
  success: '成功',
  failed: '失败'
}
const sIcon: Record<TaskStatus, string> = { pending: '○', running: '◐', success: '✓', failed: '✕' }

export default function RunConsole() {
  const { runs, activeRunKey, runOpen, setRunOpen, closeRun, nodes } = useWizard()
  const rs = activeRunKey ? runs[activeRunKey] : null
  const ids = rs ? Object.keys(rs.status) : []
  const [sel, setSel] = useState<string | null>(null)

  useEffect(() => {
    if (ids.length && (!sel || !ids.includes(sel))) setSel(ids[0])
  }, [ids, sel])

  if (!rs) return null

  const ipOf = (id: string): string => nodes.find((n) => n.id === id)?.ip ?? id
  const progOf = (id: string): number =>
    rs.progress[id] ?? (rs.status[id] === 'success' ? 100 : rs.status[id] === 'failed' ? 100 : 0)
  const done = ids.every((id) => rs.status[id] === 'success' || rs.status[id] === 'failed')
  const failc = ids.filter((id) => rs.status[id] === 'failed').length
  const succ = ids.filter((id) => rs.status[id] === 'success').length
  const runc = ids.filter((id) => rs.status[id] === 'running' || rs.status[id] === 'pending').length
  const overall = ids.length ? Math.round(ids.reduce((a, id) => a + progOf(id), 0) / ids.length) : 0
  const barColor = failc > 0 ? 'var(--err)' : done ? 'var(--ok)' : 'var(--accent)'
  const selStatus = sel ? rs.status[sel] : 'pending'
  const logs = sel ? rs.logs[sel] ?? [] : []
  const title = (activeRunKey && TITLES[activeRunKey]) || '执行中'
  const summary = `${succ} 成功 · ${runc} 进行 · ${failc} 失败`

  // 收起态：右下角悬浮角标，任务继续运行，点击重新展开
  if (!runOpen) {
    return (
      <button
        onClick={() => setRunOpen(true)}
        title="展开运行控制台"
        style={{
          position: 'fixed',
          right: 22,
          bottom: 22,
          zIndex: 42,
          display: 'flex',
          alignItems: 'center',
          gap: 13,
          padding: '11px 16px 11px 14px',
          border: '1px solid var(--border-2)',
          borderRadius: 13,
          background: 'var(--surface)',
          boxShadow: '0 10px 34px rgba(0,0,0,.26)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          animation: 'cdSlideUp .26s cubic-bezier(.2,.8,.2,1)'
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            flexShrink: 0,
            background: barColor,
            animation: done ? undefined : 'cdSpin 1.4s linear infinite'
          }}
        />
        <div style={{ textAlign: 'left', lineHeight: 1.35, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)', whiteSpace: 'nowrap' }}>{summary}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: barColor }}>{overall}%</span>
          <div style={{ width: 74, height: 5, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${overall}%`, background: barColor, borderRadius: 3, transition: 'width .25s' }} />
          </div>
        </div>
        <span style={{ fontSize: 13, color: 'var(--faint)', flexShrink: 0 }}>▴</span>
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: 336,
        background: 'var(--surface)',
        borderTop: '1px solid var(--border-2)',
        boxShadow: '0 -12px 44px rgba(0,0,0,.34)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        animation: 'cdSlideUp .26s cubic-bezier(.2,.8,.2,1)'
      }}
    >
      <div
        style={{
          height: 50,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '0 18px',
          borderBottom: '1px solid var(--border)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              flexShrink: 0,
              background: barColor,
              animation: done ? undefined : 'cdSpin 1.4s linear infinite'
            }}
          />
          <span style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' }}>
            {title}
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--dim)', whiteSpace: 'nowrap' }}>
            {summary}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 140, height: 6, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${overall}%`, background: barColor, borderRadius: 4, transition: 'width .25s' }} />
          </div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--dim)', width: 38, textAlign: 'right' }}>
            {overall}%
          </span>
          <button style={tinyBtn} title="收起到角标，任务继续运行" onClick={() => setRunOpen(false)}>
            收起 ▾
          </button>
          {done && (
            <button style={tinyBtn} onClick={closeRun}>
              关闭
            </button>
          )}
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ width: 262, flexShrink: 0, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 8 }}>
          {ids.map((id) => {
            const st = rs.status[id]
            const on = sel === id
            return (
              <button
                key={id}
                onClick={() => setSel(id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '9px 10px',
                  border: 'none',
                  borderRadius: 9,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  marginBottom: 2,
                  background: on ? 'var(--surface-2)' : 'transparent'
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0,
                    background: `color-mix(in srgb, ${sColor[st]} 14%, transparent)`,
                    color: sColor[st],
                    animation: st === 'running' ? 'cdSpin 1.4s linear infinite' : undefined
                  }}
                >
                  {sIcon[st]}
                </span>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
                    {ipOf(id)}
                  </div>
                  <div style={{ height: 3, borderRadius: 2, background: 'var(--surface-2)', marginTop: 5, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${progOf(id)}%`, background: sColor[st], borderRadius: 2, transition: 'width .25s' }} />
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    fontFamily: 'var(--mono)',
                    padding: '2px 7px',
                    borderRadius: 5,
                    flexShrink: 0,
                    background: `color-mix(in srgb, ${sColor[st]} 14%, transparent)`,
                    color: sColor[st]
                  }}
                >
                  {sLabel[st]}
                </span>
              </button>
            )
          })}
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            background: '#0b0c0e',
            overflow: 'auto',
            padding: '14px 18px',
            fontFamily: 'var(--mono)',
            fontSize: 12.5,
            lineHeight: 1.85
          }}
        >
          <div style={{ color: 'var(--faint)', marginBottom: 6 }}>
            — {sel ? ipOf(sel) : ''}{selStatus === 'running' ? ' · 运行中' : ''} —
          </div>
          {logs.map((t, i) => {
            let color = '#a0a4ad'
            if (t.startsWith('✓')) color = '#34c77b'
            else if (t.startsWith('✗')) color = '#ff5a4d'
            else if (t.startsWith('$')) color = '#676c76'
            return (
              <div key={i} style={{ color, whiteSpace: 'pre-wrap' }}>
                {t}
              </div>
            )
          })}
          {selStatus === 'running' && <div style={{ color: 'var(--accent)' }}>▍</div>}
        </div>
      </div>
    </div>
  )
}

const tinyBtn: CSSProperties = {
  padding: '5px 12px',
  border: '1px solid var(--border-2)',
  borderRadius: 7,
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap'
}
