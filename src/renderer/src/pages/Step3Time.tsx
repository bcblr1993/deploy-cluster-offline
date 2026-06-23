// 步骤3：时间对齐页。

import { useState } from 'react'
import { Alert, Button, Input, Space, Spin, Typography } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import StepRunner from '../components/StepRunner'
import type { Step3Params, TimePlan } from '@shared/types'

const { Text } = Typography

const STRATEGY_TEXT: Record<TimePlan['strategy'], string> = {
  'all-online': '所有节点均可联网 → 各自对公网 NTP 同步',
  'partial-online': '部分节点联网 → 选一台联网机做时间源，其余对齐它',
  'all-offline': '全部离线 → 选一台做基准源，其余对齐它（保证集群内部一致）'
}

export default function Step3Time() {
  const { nodes } = useWizard()
  const [tz, setTz] = useState('Asia/Shanghai')
  const [plan, setPlan] = useState<TimePlan | null>(null)
  const [calc, setCalc] = useState(false)

  const params: Step3Params = { timezone: tz }

  async function computeStrategy() {
    setCalc(true)
    try {
      setPlan(await ipc.step3Strategy(nodes))
    } finally {
      setCalc(false)
    }
  }

  const sourceIp = nodes.find((n) => n.id === plan?.sourceNodeId)?.ip

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Text type="secondary">
        统一时区并用 chrony 对齐时间。先「探测策略」自动判断联网情况，再执行对齐保证全集群时间一致。
      </Text>
      <Space>
        <Text>时区：</Text>
        <Input value={tz} onChange={(e) => setTz(e.target.value)} style={{ width: 200 }} />
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
              ? `时间源节点：${sourceIp}；可联网节点数：${plan.onlineNodeIds.length}/${nodes.length}`
              : `可联网节点数：${plan.onlineNodeIds.length}/${nodes.length}`
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
