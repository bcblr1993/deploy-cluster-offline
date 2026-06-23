// 步骤1：主机配置 + 连接检测（设计文档 §7 步骤1）。

import { useState } from 'react'
import { App, Button, Input, InputNumber, Modal, Space, Table, Tag, Tooltip, Typography } from 'antd'
import {
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  UploadOutlined
} from '@ant-design/icons'
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
  const { nodes, probes, probing, addNode, removeNode, updateNode, setProbe, setProbing, setNodes } =
    useWizard()

  // 导入导出口令弹窗
  const [io, setIo] = useState<{ mode: 'export' | 'import'; path?: string } | null>(null)
  const [pass, setPass] = useState('')

  async function startImport() {
    const path = await ipc.importNodesPick()
    if (!path) return
    setPass('')
    setIo({ mode: 'import', path })
  }

  async function confirmIo() {
    if (!io) return
    if (!pass) {
      message.warning('请输入口令')
      return
    }
    try {
      if (io.mode === 'export') {
        const p = await ipc.exportNodes(nodes, pass)
        if (p) message.success(`已导出到 ${p}`)
      } else if (io.path) {
        const imported = await ipc.importNodesDecrypt(io.path, pass)
        setNodes(imported)
        message.success(`已导入 ${imported.length} 台主机`)
      }
      setIo(null)
      setPass('')
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    }
  }

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
        <Button
          icon={<DownloadOutlined />}
          onClick={() => {
            setPass('')
            setIo({ mode: 'export' })
          }}
        >
          导出配置
        </Button>
        <Button icon={<UploadOutlined />} onClick={startImport}>
          导入配置
        </Button>
      </Space>
      <Table
        rowKey="id"
        size="middle"
        pagination={false}
        columns={columns}
        dataSource={nodes}
      />

      <Modal
        open={!!io}
        title={io?.mode === 'export' ? '导出节点配置' : '导入节点配置'}
        okText={io?.mode === 'export' ? '导出' : '导入'}
        cancelText="取消"
        onOk={confirmIo}
        onCancel={() => setIo(null)}
        destroyOnClose
      >
        <Text type="secondary">
          {io?.mode === 'export'
            ? '设置一个口令用于加密密码字段。导入时需输入同一口令解密。'
            : '输入导出时设置的口令以解密密码。'}
        </Text>
        <Input.Password
          autoFocus
          style={{ marginTop: 12 }}
          placeholder="口令"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onPressEnter={confirmIo}
        />
      </Modal>
    </Space>
  )
}
