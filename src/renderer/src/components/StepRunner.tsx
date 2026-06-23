// 通用步骤执行器（UI）：点击→生成 ActionPlan→§15 确认→执行+实时日志/状态。
// 运行状态存于全局 store（按 runKey），切换步骤再回来不丢；执行期间置全局 busy 锁。

import { useEffect, useMemo, useState } from 'react'
import { Button, Collapse, Progress, Space, Tag, Typography } from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  MinusCircleOutlined,
  PlayCircleOutlined
} from '@ant-design/icons'
import ConfirmActionModal from './ConfirmActionModal'
import { useWizard } from '../store/wizard'
import type { ActionPlan, NodeConfig, NodeTaskResult, TaskStatus } from '@shared/types'

const { Text } = Typography

function StatusIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'success':
      return <CheckCircleFilled style={{ color: '#52c41a' }} />
    case 'failed':
      return <CloseCircleFilled style={{ color: '#ff4d4f' }} />
    case 'running':
      return <LoadingOutlined spin style={{ color: '#1677ff' }} />
    default:
      return <MinusCircleOutlined style={{ color: '#bfbfbf' }} />
  }
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
  const [activeKeys, setActiveKeys] = useState<string[]>([])

  // 受控展开态：节点列表变化时默认全部展开（避免非受控被进度刷新顶开）
  useEffect(() => {
    setActiveKeys(nodes.map((n) => n.id))
  }, [nodes])

  const rs = runs[runKey]
  const running = rs?.running ?? false
  const status = rs?.status ?? {}
  const logs = rs?.logs ?? {}
  const progress = rs?.progress ?? {}

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
      nodes.map((n) => {
        const st = status[n.id] ?? 'pending'
        const pct = progress[n.id]
        return {
          key: n.id,
          label: (
            <Space>
              <StatusIcon status={st} />
              <Text strong>{n.ip || n.id}</Text>
              <Tag color={st === 'success' ? 'success' : st === 'failed' ? 'error' : undefined}>
                {STATUS_TEXT[st]}
              </Tag>
            </Space>
          ),
          extra:
            st === 'running' && typeof pct === 'number' ? (
              <Progress
                percent={pct}
                size="small"
                status="active"
                style={{ width: 160 }}
              />
            ) : null,
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
        }
      }),
    [nodes, status, logs, progress]
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
      {nodes.length > 0 && (
        <Collapse
          activeKey={activeKeys}
          onChange={(keys) => setActiveKeys(keys as string[])}
          items={items}
        />
      )}
      <ConfirmActionModal
        plan={plan}
        nodes={nodes}
        onOk={onConfirm}
        onCancel={() => setPlan(null)}
      />
    </Space>
  )
}
