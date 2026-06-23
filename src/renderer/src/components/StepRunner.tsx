// 通用步骤执行器（UI）：点击→生成 ActionPlan→§15 确认→执行+实时日志/状态。
// 运行状态存于全局 store（按 runKey），切换步骤再回来不丢；执行期间置全局 busy 锁。

import { useMemo, useState } from 'react'
import { Badge, Button, Collapse, Space, Tag, Typography } from 'antd'
import { PlayCircleOutlined } from '@ant-design/icons'
import ConfirmActionModal from './ConfirmActionModal'
import { useWizard } from '../store/wizard'
import type { ActionPlan, NodeConfig, NodeTaskResult, TaskStatus } from '@shared/types'

const { Text } = Typography

const STATUS_BADGE: Record<TaskStatus, 'default' | 'processing' | 'success' | 'error'> = {
  pending: 'default',
  running: 'processing',
  success: 'success',
  failed: 'error'
}
const STATUS_TEXT: Record<TaskStatus, string> = {
  pending: '待执行',
  running: '执行中',
  success: '成功',
  failed: '失败'
}

export interface StepRunnerProps {
  /** 全局运行状态 key，需在各步骤间唯一 */
  runKey: string
  nodes: NodeConfig[]
  actionLabel: string
  disabled?: boolean
  buildPlan: () => Promise<ActionPlan>
  run: (runId: string) => Promise<NodeTaskResult[]>
  onDone?: (results: NodeTaskResult[]) => void
}

export default function StepRunner({
  runKey,
  nodes,
  actionLabel,
  disabled,
  buildPlan,
  run,
  onDone
}: StepRunnerProps) {
  const { runs, startRun, endRun } = useWizard()
  const [plan, setPlan] = useState<ActionPlan | null>(null)

  const rs = runs[runKey]
  const running = rs?.running ?? false
  const status = rs?.status ?? {}
  const logs = rs?.logs ?? {}

  async function onClickRun() {
    const p = await buildPlan()
    setPlan(p)
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

  const items = useMemo(
    () =>
      nodes.map((n) => ({
        key: n.id,
        label: (
          <Space>
            <Badge status={STATUS_BADGE[status[n.id] ?? 'pending']} />
            <Text strong>{n.ip || n.id}</Text>
            <Tag>{STATUS_TEXT[status[n.id] ?? 'pending']}</Tag>
          </Space>
        ),
        children: (
          <pre
            style={{
              margin: 0,
              maxHeight: 240,
              overflow: 'auto',
              fontSize: 12,
              background: '#0b1021',
              color: '#d6e2ff',
              padding: 10,
              borderRadius: 6
            }}
          >
            {(logs[n.id] ?? []).join('\n') || '（暂无输出）'}
          </pre>
        )
      })),
    [nodes, status, logs]
  )

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Button
        type="primary"
        icon={<PlayCircleOutlined />}
        loading={running}
        disabled={disabled}
        onClick={onClickRun}
      >
        {actionLabel}
      </Button>
      {nodes.length > 0 && <Collapse items={items} defaultActiveKey={nodes.map((n) => n.id)} />}
      <ConfirmActionModal
        plan={plan}
        nodes={nodes}
        onOk={onConfirm}
        onCancel={() => setPlan(null)}
      />
    </Space>
  )
}
