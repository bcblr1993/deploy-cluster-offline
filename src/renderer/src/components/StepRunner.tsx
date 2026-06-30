// 步骤执行触发器：点击→§15 确认→执行。日志/进度由全局 RunConsole 展示。

import { useState, type CSSProperties } from 'react'
import ConfirmActionModal from './ConfirmActionModal'
import { useWizard } from '../store/wizard'
import type { ActionPlan, NodeConfig, NodeTaskResult } from '@shared/types'

export interface StepRunnerProps {
  runKey: string
  nodes: NodeConfig[]
  actionLabel: string
  disabled?: boolean
  /** 触发按钮样式：primary | danger | ghost */
  variant?: 'primary' | 'danger' | 'ghost'
  icon?: string
  buildPlan: () => Promise<ActionPlan>
  run: (runId: string) => Promise<NodeTaskResult[]>
  onDone?: (results: NodeTaskResult[]) => void
}

export default function StepRunner({
  runKey,
  nodes,
  actionLabel,
  disabled,
  variant = 'primary',
  icon = '⚡',
  buildPlan,
  run,
  onDone
}: StepRunnerProps) {
  const { runs, startRun, endRun } = useWizard()
  const [plan, setPlan] = useState<ActionPlan | null>(null)
  const running = runs[runKey]?.running ?? false

  async function onClickRun() {
    setPlan(await buildPlan())
  }
  async function onConfirm() {
    const p = plan
    setPlan(null)
    if (!p) return
    const runId = crypto.randomUUID()
    startRun(runKey, runId, nodes.map((n) => n.id))
    try {
      const results = await run(runId)
      onDone?.(results)
    } finally {
      endRun(runKey)
    }
  }

  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '9px 17px',
    borderRadius: 9,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled || running ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    opacity: disabled ? 0.55 : 1
  }
  const variants: Record<string, CSSProperties> = {
    primary: { border: 'none', background: 'var(--accent)', color: '#fff' },
    danger: { border: '1px solid var(--err)', background: 'var(--err)', color: '#fff' },
    ghost: { border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }
  }

  return (
    <>
      <button style={{ ...base, ...variants[variant] }} disabled={disabled || running} onClick={onClickRun}>
        <span style={{ fontSize: 13 }}>{running ? '⏳' : icon}</span>
        {actionLabel}
      </button>
      <ConfirmActionModal plan={plan} nodes={nodes} onOk={onConfirm} onCancel={() => setPlan(null)} />
    </>
  )
}
