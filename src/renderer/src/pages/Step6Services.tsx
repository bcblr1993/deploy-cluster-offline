// 步骤6：按节点选服务部署（放置矩阵 + 配置预览 + 部署）。

import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Collapse, Select, Space, Table, Tag, Typography } from 'antd'
import { EyeOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import StepRunner from '../components/StepRunner'
import type {
  DeploymentPreview,
  NodeConfig,
  ServiceId,
  ServiceMeta
} from '@shared/types'

const { Text } = Typography

function dataPathFor(mountpoint: string, instanceId: string): string {
  return `${mountpoint.replace(/\/+$/, '')}/sprixin-iotcloud-data/${instanceId}`
}

export default function Step6Services() {
  const { nodes, hostnames, placements, togglePlacement, disks, setPlacementDataPath } = useWizard()
  const [catalog, setCatalog] = useState<Record<ServiceId, ServiceMeta> | null>(null)
  const [preview, setPreview] = useState<DeploymentPreview | null>(null)

  // 该节点可用挂载点（来自步骤4 扫描）
  const mountpointsOf = (nodeId: string): { mp: string; used?: number }[] => {
    const out: { mp: string; used?: number }[] = []
    const seen = new Set<string>()
    for (const d of disks[nodeId] ?? []) {
      for (const part of d.partitions) {
        if (part.mountpoint && !seen.has(part.mountpoint)) {
          seen.add(part.mountpoint)
          out.push({ mp: part.mountpoint, used: part.usedPercent })
        }
      }
    }
    return out
  }

  // 有数据卷的实例（可选落盘磁盘）
  const statefulPlacements = placements.filter((p) => catalog?.[p.service]?.dataMount)

  useEffect(() => {
    ipc.getCatalog().then(setCatalog).catch(() => undefined)
  }, [])

  const services = useMemo(
    () => (catalog ? (Object.values(catalog) as ServiceMeta[]) : []),
    [catalog]
  )

  async function genPreview() {
    setPreview(await ipc.step6Preview(placements, nodes))
  }

  const placed = (svc: ServiceId, nodeId: string): boolean =>
    placements.some((p) => p.service === svc && p.nodeId === nodeId)

  // 矩阵：行=节点，列=服务
  const columns: ColumnsType<NodeConfig> = [
    {
      title: '节点',
      fixed: 'left',
      width: 150,
      render: (_, n) => (
        <span>
          <Text strong>{hostnames[n.id] || n.ip}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {n.ip}
          </Text>
        </span>
      )
    },
    ...services.map((svc) => ({
      title: (
        <Space direction="vertical" size={0}>
          <Text>{svc.name}</Text>
          {svc.clusterable && <Tag color="purple">可集群</Tag>}
          {svc.singleton && <Tag>单例</Tag>}
          {svc.manual && <Tag color="default">手动</Tag>}
        </Space>
      ),
      width: 110,
      align: 'center' as const,
      render: (_: unknown, n: NodeConfig) =>
        svc.manual ? (
          <Text type="secondary">—</Text>
        ) : (
          <Checkbox
            checked={placed(svc.id, n.id)}
            onChange={() => togglePlacement(svc.id, n.id, svc.singleton)}
          />
        )
    }))
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Text type="secondary">
        勾选「在哪台机上跑哪个服务」。kafka/cassandra 勾多台即自动组成集群（auto 编号 + host 网络 + 真实 IP 装配）；
        pg/redis/iotcloud 为单例。wechat 手动部署，工具不编排。
      </Text>

      <Table
        rowKey="id"
        size="small"
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={columns}
        dataSource={nodes}
      />

      {statefulPlacements.length > 0 && (
        <div>
          <Text strong>数据落盘位置</Text>
          <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            默认在 ~/sprixin-iotcloud；可指定磁盘挂载点（需先在「磁盘预览」扫描该节点）
          </Text>
          <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 8 }}>
            {statefulPlacements.map((p) => {
              const node = nodes.find((n) => n.id === p.nodeId)
              const mps = mountpointsOf(p.nodeId)
              const options = [
                { value: '', label: '默认（~/sprixin-iotcloud）' },
                ...mps.map((m) => ({
                  value: dataPathFor(m.mp, p.instanceId),
                  label: `${m.mp}${m.used != null ? ` · 已用 ${m.used}%` : ''}`
                }))
              ]
              return (
                <Space key={p.instanceId}>
                  <Tag color="blue">{p.instanceId}</Tag>
                  <Text type="secondary">{hostnames[p.nodeId] || node?.ip}</Text>
                  <Select
                    style={{ width: 380 }}
                    value={p.dataPath ?? ''}
                    options={options}
                    onChange={(v) => setPlacementDataPath(p.instanceId, v || undefined)}
                  />
                </Space>
              )
            })}
          </Space>
        </div>
      )}

      <Space>
        <Button icon={<EyeOutlined />} onClick={genPreview} disabled={placements.length === 0}>
          生成配置预览
        </Button>
      </Space>

      {preview && preview.warnings.length > 0 && (
        <Alert type="warning" showIcon message="放置告警" description={
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {preview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        } />
      )}

      {preview && preview.instances.length > 0 && (
        <Collapse
          items={preview.instances.map((inst) => ({
            key: inst.instanceId,
            label: (
              <Space>
                <Text strong>{inst.instanceId}</Text>
                <Tag color="blue">{inst.nodeIp}</Tag>
                {inst.cluster && <Tag color="purple">集群</Tag>}
              </Space>
            ),
            children: (
              <>
                <Text type="secondary">docker-compose.yml</Text>
                <pre style={preStyle}>{inst.compose}</pre>
                {inst.env && (
                  <>
                    <Text type="secondary">.env</Text>
                    <pre style={preStyle}>{inst.env}</pre>
                  </>
                )}
              </>
            )
          }))}
        />
      )}

      <StepRunner
        runKey="step6-deploy"
        nodes={nodes.filter((n) => placements.some((p) => p.nodeId === n.id))}
        actionLabel="部署服务"
        disabled={placements.length === 0}
        buildPlan={() => ipc.step6Plan(placements, nodes)}
        run={(runId) => ipc.step6Deploy(runId, nodes, { placements })}
      />

      <Text type="secondary" style={{ fontSize: 12 }}>
        提示：卸载服务请到顶部「运维总览」使用一键全卸载。
      </Text>
    </Space>
  )
}

const preStyle: React.CSSProperties = {
  background: '#f5f5f5',
  padding: 10,
  borderRadius: 6,
  maxHeight: 260,
  overflow: 'auto',
  fontSize: 12
}
