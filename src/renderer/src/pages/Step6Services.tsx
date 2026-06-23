// 步骤6：按节点选服务部署（放置矩阵 + 配置预览 + 部署）。

import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Collapse, Input, Select, Space, Table, Tag, Typography } from 'antd'
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

interface MountInfo {
  mp: string
  used?: number
  type: 'SSD' | 'HDD'
  sizeBytes: number
}

// 各服务推荐落盘：redis 默认；pg/kafka 用 SSD；cassandra 用最大机械盘
const RECO: Partial<Record<ServiceId, 'default' | 'ssd' | 'hdd'>> = {
  redis: 'default',
  postgres: 'ssd',
  kafka: 'ssd',
  cassandra: 'hdd'
}
const RECO_TEXT: Record<'default' | 'ssd' | 'hdd', string> = {
  default: '默认位置',
  ssd: '固态盘(SSD)',
  hdd: '最大机械盘(HDD)'
}

function recommendMp(service: ServiceId, mps: MountInfo[]): string | undefined {
  const kind = RECO[service]
  if (kind === 'ssd') {
    return mps.filter((m) => m.type === 'SSD').sort((a, b) => b.sizeBytes - a.sizeBytes)[0]?.mp
  }
  if (kind === 'hdd') {
    return mps.filter((m) => m.type === 'HDD').sort((a, b) => b.sizeBytes - a.sizeBytes)[0]?.mp
  }
  return undefined
}

const CUSTOM = '__custom__'

export default function Step6Services() {
  const { nodes, hostnames, placements, togglePlacement, disks, setPlacementDataPath, setView } =
    useWizard()
  const [catalog, setCatalog] = useState<Record<ServiceId, ServiceMeta> | null>(null)
  const [preview, setPreview] = useState<DeploymentPreview | null>(null)
  const [customIds, setCustomIds] = useState<Record<string, boolean>>({})
  const [deployed, setDeployed] = useState(false)

  // 该节点可用挂载点（来自步骤4 扫描），带磁盘类型/容量
  const mountpointsOf = (nodeId: string): MountInfo[] => {
    const out: MountInfo[] = []
    const seen = new Set<string>()
    for (const d of disks[nodeId] ?? []) {
      for (const part of d.partitions) {
        if (part.mountpoint && !seen.has(part.mountpoint)) {
          seen.add(part.mountpoint)
          out.push({
            mp: part.mountpoint,
            used: part.usedPercent,
            type: d.type,
            sizeBytes: part.sizeBytes
          })
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
              const recoKind = RECO[p.service] ?? 'default'
              const recoMp = recommendMp(p.service, mps)
              const options = [
                { value: '', label: '默认（~/sprixin-iotcloud）' },
                ...mps.map((m) => ({
                  value: dataPathFor(m.mp, p.instanceId),
                  label: `${m.mp} · ${m.type}${m.used != null ? ` · 已用 ${m.used}%` : ''}${
                    m.mp === recoMp ? ' · 推荐' : ''
                  }`
                })),
                { value: CUSTOM, label: '手动指定路径…' }
              ]
              const optionValues = mps.map((m) => dataPathFor(m.mp, p.instanceId))
              const isCustom =
                !!customIds[p.instanceId] || (!!p.dataPath && !optionValues.includes(p.dataPath))
              const selectValue = isCustom ? CUSTOM : p.dataPath ?? ''
              const recoPath = recoMp ? dataPathFor(recoMp, p.instanceId) : ''
              const recoApplied = recoKind === 'default' ? !p.dataPath : p.dataPath === recoPath
              return (
                <Space key={p.instanceId} wrap>
                  <Tag color="blue" style={{ width: 92, textAlign: 'center' }}>
                    {p.instanceId}
                  </Tag>
                  <Text type="secondary" style={{ width: 64 }}>
                    {hostnames[p.nodeId] || node?.ip}
                  </Text>
                  <Tag color="gold">推荐: {RECO_TEXT[recoKind]}</Tag>
                  <Select
                    style={{ width: 360 }}
                    value={selectValue}
                    options={options}
                    onChange={(v) => {
                      if (v === CUSTOM) {
                        setCustomIds((s) => ({ ...s, [p.instanceId]: true }))
                      } else {
                        setCustomIds((s) => ({ ...s, [p.instanceId]: false }))
                        setPlacementDataPath(p.instanceId, v || undefined)
                      }
                    }}
                  />
                  {isCustom && (
                    <Input
                      style={{ width: 280 }}
                      placeholder="/data/xxx 绝对路径"
                      value={p.dataPath ?? ''}
                      onChange={(e) =>
                        setPlacementDataPath(p.instanceId, e.target.value || undefined)
                      }
                    />
                  )}
                  {!recoApplied && (recoKind === 'default' || recoMp) && (
                    <Typography.Link
                      onClick={() => {
                        setCustomIds((s) => ({ ...s, [p.instanceId]: false }))
                        setPlacementDataPath(p.instanceId, recoKind === 'default' ? undefined : recoPath)
                      }}
                    >
                      用推荐
                    </Typography.Link>
                  )}
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
        onDone={(results) => setDeployed(results.every((r) => r.status === 'success'))}
      />

      {deployed && (
        <Alert
          type="success"
          showIcon
          message="部署完成"
          description="可进入「运维总览」查看各节点服务运行状态。"
          action={
            <Button type="primary" onClick={() => setView('overview')}>
              进入运维总览
            </Button>
          }
        />
      )}

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
