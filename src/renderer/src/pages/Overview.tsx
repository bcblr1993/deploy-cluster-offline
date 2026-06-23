// 运维总览（顶栏独立视图）：节点状态 + 运行容器 + 一键全卸载。
// 设计 docs/01-20260623-…

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Empty,
  Row,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import { ReloadOutlined, ColumnHeightOutlined, VerticalAlignMiddleOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import StepRunner from '../components/StepRunner'
import type { ContainerInfo, NodeStatus } from '@shared/types'

const { Text, Title } = Typography

const STATE_BADGE: Record<ContainerInfo['state'], 'success' | 'error' | 'warning' | 'default'> = {
  running: 'success',
  exited: 'error',
  restarting: 'warning',
  unknown: 'default'
}

function containerColumns(): ColumnsType<ContainerInfo> {
  return [
    {
      title: '',
      width: 28,
      render: (_, c) => <Badge status={STATE_BADGE[c.state]} />
    },
    {
      title: '容器',
      render: (_, c) => (
        <Space size={6}>
          <Text style={{ fontFamily: 'monospace' }}>{c.name}</Text>
          {c.service ? (
            <Tag color="blue">{c.service}</Tag>
          ) : (
            <Tag>外部 · 只读</Tag>
          )}
        </Space>
      )
    },
    { title: '状态', dataIndex: 'status', width: 150 },
    {
      title: '端口',
      dataIndex: 'ports',
      render: (v?: string) =>
        v ? <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Text> : '-'
    }
  ]
}

function NodeHeader({ ip, st }: { ip: string; st?: NodeStatus }) {
  return (
    <Space>
      <Badge status={st?.reachable ? (st.dockerActive ? 'success' : 'warning') : 'error'} />
      <Text strong>{st?.hostname || ip}</Text>
      <Text type="secondary" style={{ fontFamily: 'monospace', fontWeight: 400 }}>
        {ip}
      </Text>
    </Space>
  )
}

function NodeExtra({ st }: { st?: NodeStatus }) {
  if (!st) return null
  if (!st.reachable) return <Tag color="error">不可连</Tag>
  const managed = st.containers.filter((c) => c.service).length
  return (
    <Space size={4}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        服务 {managed} · 容器 {st.containers.length}
      </Text>
      <Tag>{st.arch}</Tag>
      <Tag color={st.dockerActive ? 'green' : 'red'}>docker {st.dockerActive ? 'active' : 'down'}</Tag>
    </Space>
  )
}

function NodeBody({ st }: { st?: NodeStatus }) {
  if (!st) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未刷新" />
  if (!st.reachable) return <Alert type="error" showIcon message={st.error || '连接失败'} />
  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Space size="large" wrap>
        <Text type="secondary">{st.osPretty}</Text>
        {st.load1 != null && <Text type="secondary">load {st.load1}</Text>}
        {st.rootUsedPercent != null && <Text type="secondary">/ 使用 {st.rootUsedPercent}%</Text>}
      </Space>
      {st.containers.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无运行容器" />
      ) : (
        <Table
          rowKey="name"
          size="small"
          pagination={false}
          showHeader={false}
          columns={containerColumns()}
          dataSource={st.containers}
        />
      )}
    </Space>
  )
}

export default function Overview() {
  const { nodes } = useWizard()
  const [status, setStatus] = useState<Record<string, NodeStatus>>({})
  const [loading, setLoading] = useState(false)
  const [auto, setAuto] = useState(false) // 自动刷新默认关闭
  const [deleteData, setDeleteData] = useState(false)
  const [deleteImages, setDeleteImages] = useState(false)
  const [removeInstallDir, setRemoveInstallDir] = useState(false)
  const [removeDocker, setRemoveDocker] = useState(false)
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const timer = useRef<ReturnType<typeof setInterval>>()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await ipc.overviewStatus(nodes))
    } finally {
      setLoading(false)
    }
  }, [nodes])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 默认全部展开（节点列表变化时同步）
  useEffect(() => {
    setActiveKeys(nodes.map((n) => n.id))
  }, [nodes])

  const allOpen = activeKeys.length >= nodes.length && nodes.length > 0
  const toggleAll = () => setActiveKeys(allOpen ? [] : nodes.map((n) => n.id))

  useEffect(() => {
    if (auto) {
      timer.current = setInterval(refresh, 10000)
      return () => clearInterval(timer.current)
    }
    return undefined
  }, [auto, refresh])

  const onlineCount = nodes.filter((n) => status[n.id]?.reachable).length
  const containerCount = Object.values(status).reduce((s, x) => s + (x?.containers.length ?? 0), 0)

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Row align="middle" justify="space-between" gutter={[12, 12]}>
          <Col>
            <Space size="large">
              <Title level={5} style={{ margin: 0 }}>
                运维总览
              </Title>
              <Text type="secondary">
                节点 {nodes.length}（在线 {onlineCount}） · 运行容器 {containerCount}
              </Text>
            </Space>
          </Col>
          <Col>
            <Space>
              <Button
                icon={allOpen ? <VerticalAlignMiddleOutlined /> : <ColumnHeightOutlined />}
                onClick={toggleAll}
              >
                {allOpen ? '折叠全部' : '展开全部'}
              </Button>
              <Tooltip title="每 10s 自动刷新">
                <Space size={4}>
                  <Text type="secondary">自动刷新</Text>
                  <Switch size="small" checked={auto} onChange={setAuto} />
                </Space>
              </Tooltip>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={refresh}>
                刷新
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Collapse
        activeKey={activeKeys}
        onChange={(keys) => setActiveKeys(keys as string[])}
        items={nodes.map((n) => ({
          key: n.id,
          label: <NodeHeader ip={n.ip} st={status[n.id]} />,
          extra: <NodeExtra st={status[n.id]} />,
          children: <NodeBody st={status[n.id]} />
        }))}
      />

      <Card
        size="small"
        title={<Text type="danger">一键全卸载</Text>}
        styles={{ header: { borderColor: 'var(--border, #303030)' } }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Text type="secondary">
            停止并移除所有节点上「本工具部署」的服务（倒序：应用层先停）。外部容器不受影响。
          </Text>
          <Space direction="vertical" size={4}>
            <Checkbox checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)}>
              <Text type={deleteData ? 'danger' : undefined}>同时删除数据目录（不可恢复）</Text>
            </Checkbox>
            <Checkbox checked={deleteImages} onChange={(e) => setDeleteImages(e.target.checked)}>
              <Text type={deleteImages ? 'danger' : undefined}>删除所有服务镜像</Text>
            </Checkbox>
            <Checkbox
              checked={removeInstallDir}
              onChange={(e) => setRemoveInstallDir(e.target.checked)}
            >
              <Text type={removeInstallDir ? 'danger' : undefined}>
                删除安装目录（~/sprixin-iotcloud）
              </Text>
            </Checkbox>
            <Checkbox checked={removeDocker} onChange={(e) => setRemoveDocker(e.target.checked)}>
              <Text type={removeDocker ? 'danger' : undefined}>卸载 Docker 引擎（彻底清理）</Text>
            </Checkbox>
          </Space>
          <StepRunner
            runKey="overview-uninstall"
            nodes={nodes}
            actionLabel="一键全卸载所有节点服务"
            buildPlan={() =>
              ipc.overviewPlanUninstallAll(nodes, {
                deleteData,
                deleteImages,
                removeInstallDir,
                removeDocker
              })
            }
            run={(runId) =>
              ipc.overviewUninstallAll(runId, nodes, {
                deleteData,
                deleteImages,
                removeInstallDir,
                removeDocker
              })
            }
            onDone={() => refresh()}
          />
        </Space>
      </Card>
    </Space>
  )
}
