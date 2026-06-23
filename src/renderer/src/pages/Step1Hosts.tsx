// 步骤1：主机配置 + 连接检测（设计文档 §7 步骤1）。

import { App, Button, Input, InputNumber, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { DeleteOutlined, PlusOutlined, SaveOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import type { NodeConfig, NodeProbe } from '@shared/types'

const { Text } = Typography

function ProbeCell({ probe, loading }: { probe?: NodeProbe; loading?: boolean }) {
  if (loading) return <Tag color="processing">检测中…</Tag>
  if (!probe) return <Tag>未检测</Tag>
  if (!probe.reachable) {
    return (
      <Tooltip title={probe.error}>
        <Tag color="error">连不通</Tag>
      </Tooltip>
    )
  }
  if (!probe.supported) {
    const reasons: string[] = []
    if (probe.arch !== 'x86_64') reasons.push(`架构 ${probe.arch}（本期仅 x86_64）`)
    if (!probe.hasSystemd) reasons.push('非 systemd')
    if (!probe.adapterId) reasons.push(`发行版 ${probe.osId ?? '未知'} 暂不支持`)
    if (probe.privilege === 'none') reasons.push('无 root/sudo 权限')
    return (
      <Tooltip title={reasons.join('；')}>
        <Tag color="warning">不满足</Tag>
      </Tooltip>
    )
  }
  return (
    <Space size={4} wrap>
      <Tag color="success">可用</Tag>
      <Tag>{probe.osPretty ?? probe.osId}</Tag>
      <Tag color={probe.privilege === 'root' ? 'blue' : 'geekblue'}>{probe.privilege}</Tag>
      {probe.dockerInstalled && <Tag color="gold">已装 docker</Tag>}
      <Tag color={probe.online ? 'cyan' : 'default'}>{probe.online ? '可联网' : '离线'}</Tag>
    </Space>
  )
}

export default function Step1Hosts() {
  const { message } = App.useApp()
  const { nodes, probes, probing, addNode, removeNode, updateNode, setProbe, setProbing } =
    useWizard()

  async function save(silent = false) {
    const project = useWizard.getState().toProject()
    const res = await ipc.saveProject(project)
    if (!silent) {
      if (res.encryptionAvailable) message.success('配置已保存（密码已加密）')
      else message.warning('配置已保存，但系统钥匙串不可用，密码仅做了 base64 混淆')
    }
  }

  async function probeOne(node: NodeConfig) {
    if (!node.ip) return
    setProbing(node.id, true)
    try {
      const result = await ipc.probeNode(node)
      setProbe(node.id, result)
    } catch (e) {
      setProbe(node.id, {
        reachable: false,
        arch: 'unknown',
        hasSystemd: false,
        privilege: 'none',
        dockerInstalled: false,
        online: false,
        supported: false,
        error: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setProbing(node.id, false)
    }
  }

  async function probeAll() {
    await Promise.all(nodes.map((n) => probeOne(n)))
    // 检测后自动保存一次（静默）
    void save(true)
  }

  const columns: ColumnsType<NodeConfig> = [
    {
      title: 'IP 地址',
      dataIndex: 'ip',
      width: 160,
      render: (_, r) => (
        <Input
          placeholder="10.0.0.11"
          value={r.ip}
          onChange={(e) => updateNode(r.id, { ip: e.target.value.trim() })}
        />
      )
    },
    {
      title: '端口',
      dataIndex: 'port',
      width: 90,
      render: (_, r) => (
        <InputNumber
          min={1}
          max={65535}
          value={r.port}
          onChange={(v) => updateNode(r.id, { port: v ?? 22 })}
          style={{ width: '100%' }}
        />
      )
    },
    {
      title: '用户名',
      dataIndex: 'username',
      width: 130,
      render: (_, r) => (
        <Input
          value={r.username}
          onChange={(e) => updateNode(r.id, { username: e.target.value.trim() })}
        />
      )
    },
    {
      title: '密码',
      dataIndex: 'password',
      width: 150,
      render: (_, r) => (
        <Input.Password
          value={r.password}
          onChange={(e) => updateNode(r.id, { password: e.target.value })}
        />
      )
    },
    {
      title: '检测结果',
      width: 280,
      render: (_, r) => <ProbeCell probe={probes[r.id]} loading={probing[r.id]} />
    },
    {
      title: '操作',
      width: 150,
      render: (_, r) => (
        <Space>
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            loading={probing[r.id]}
            onClick={() => probeOne(r)}
          >
            检测
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={nodes.length <= 1}
            onClick={() => removeNode(r.id)}
          />
        </Space>
      )
    }
  ]

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Text type="secondary">
        录入现场所有节点的连接信息，点「检测全部」并发校验连通性与环境（架构 / systemd / 权限 /
        docker / 联网）。全部「可用」后方可进入下一步。
      </Text>
      <Space>
        <Button icon={<PlusOutlined />} onClick={addNode}>
          添加主机
        </Button>
        <Button type="primary" icon={<ThunderboltOutlined />} onClick={probeAll}>
          检测全部
        </Button>
        <Button icon={<SaveOutlined />} onClick={() => save()}>
          保存配置
        </Button>
      </Space>
      <Table
        rowKey="id"
        size="middle"
        pagination={false}
        columns={columns}
        dataSource={nodes}
      />
    </Space>
  )
}
