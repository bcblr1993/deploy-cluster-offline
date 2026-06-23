// 步骤3：时间对齐页（策略可选，docs/03）。

import { useState } from 'react'
import { Alert, Button, Input, Radio, Select, Space, Spin, Typography } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import StepRunner from '../components/StepRunner'
import type { Step3Params, TimeMode, TimePlan } from '@shared/types'

const { Text } = Typography

const STRATEGY_TEXT: Record<TimePlan['strategy'], string> = {
  'all-online': '所有节点各自对公网 NTP 同步',
  'partial-online': '以指定/联网节点为时间源，其余对齐它',
  'all-offline': '全部离线 → 选一台做基准源，其余对齐它（保证集群内部一致）'
}

export default function Step3Time() {
  const { nodes, hostnames } = useWizard()
  const [tz, setTz] = useState('Asia/Shanghai')
  const [mode, setMode] = useState<TimeMode>('auto')
  const [sourceNodeId, setSourceNodeId] = useState<string | undefined>(nodes[0]?.id)
  const [plan, setPlan] = useState<TimePlan | null>(null)
  const [calc, setCalc] = useState(false)

  const params: Step3Params = { timezone: tz }

  async function computeStrategy() {
    setCalc(true)
    try {
      setPlan(await ipc.step3Strategy(nodes, mode, mode === 'source' ? sourceNodeId : undefined))
    } finally {
      setCalc(false)
    }
  }

  const sourceIp = nodes.find((n) => n.id === plan?.sourceNodeId)?.ip
  const nodeLabel = (id: string): string => {
    const n = nodes.find((x) => x.id === id)
    return n ? `${hostnames[id] || n.ip}（${n.ip}）` : id
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Text type="secondary">
        统一时区并对齐时间。选择对时策略后「探测策略」生成计划，再执行对齐保证全集群时间一致。
        优先 chrony，无 chrony 时有网用 systemd-timesyncd、跟随源用 date。
      </Text>

      <Space>
        <Text>时区：</Text>
        <Input value={tz} onChange={(e) => setTz(e.target.value)} style={{ width: 180 }} />
      </Space>

      <Space align="start">
        <Text>策略：</Text>
        <Space direction="vertical">
          <Radio.Group value={mode} onChange={(e) => { setMode(e.target.value); setPlan(null) }}>
            <Radio value="auto">自动（按联网情况）</Radio>
            <Radio value="all-internet">全部对公网 NTP</Radio>
            <Radio value="source">指定时间源</Radio>
          </Radio.Group>
          {mode === 'source' && (
            <Space>
              <Text type="secondary">时间源节点：</Text>
              <Select
                style={{ width: 240 }}
                value={sourceNodeId}
                onChange={(v) => { setSourceNodeId(v); setPlan(null) }}
                options={nodes.map((n) => ({ value: n.id, label: nodeLabel(n.id) }))}
              />
            </Space>
          )}
        </Space>
      </Space>

      <Space>
        <Button icon={<SyncOutlined />} loading={calc} onClick={computeStrategy}>
          探测策略
        </Button>
      </Space>

      {calc && <Spin />}
      {plan && (
        <Alert
          type="info"
          showIcon
          message={`时间源策略：${STRATEGY_TEXT[plan.strategy]}`}
          description={
            plan.sourceNodeId
              ? `时间源：${sourceIp} · 在线节点 ${plan.onlineNodeIds.length}/${nodes.length}`
              : `在线节点 ${plan.onlineNodeIds.length}/${nodes.length}`
          }
        />
      )}

      <StepRunner
        runKey="step3"
        nodes={nodes}
        actionLabel="对齐时间"
        disabled={!plan}
        buildPlan={() => ipc.step3Plan(nodes, plan!, params)}
        run={(runId) => ipc.step3Run(runId, nodes, plan!, params)}
      />
    </Space>
  )
}
