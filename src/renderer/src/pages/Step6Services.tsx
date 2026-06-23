// 步骤6：按节点选服务部署（放置矩阵 + 配置预览 + 部署）。

import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Collapse, Divider, Space, Table, Tag, Typography } from 'antd'
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

export default function Step6Services() {
  const { nodes, hostnames, placements, togglePlacement } = useWizard()
  const [catalog, setCatalog] = useState<Record<ServiceId, ServiceMeta> | null>(null)
  const [preview, setPreview] = useState<DeploymentPreview | null>(null)

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

      <Divider />
      <UninstallSection />
    </Space>
  )
}

function UninstallSection() {
  const { nodes, placements } = useWizard()
  const [deleteData, setDeleteData] = useState(false)
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Text strong>一键卸载</Text>
      <Text type="secondary">
        按当前放置倒序停止服务（应用层先停）。默认保留数据卷；勾选删除数据卷为危险操作，需输入确认词。
      </Text>
      <Checkbox checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)}>
        <Text type={deleteData ? 'danger' : undefined}>同时删除数据卷（不可恢复）</Text>
      </Checkbox>
      <StepRunner
        runKey="uninstall"
        nodes={nodes.filter((n) => placements.some((p) => p.nodeId === n.id))}
        actionLabel="卸载服务"
        disabled={placements.length === 0}
        buildPlan={() => ipc.uninstallPlan({ placements, deleteData }, nodes)}
        run={(runId) => ipc.uninstallRun(runId, nodes, { placements, deleteData })}
      />
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
