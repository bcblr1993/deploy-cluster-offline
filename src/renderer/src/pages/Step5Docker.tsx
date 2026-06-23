// 步骤5：离线安装 Docker / docker-compose 页。

import { useCallback, useEffect, useState } from 'react'
import { Alert, App, Button, Radio, Space, Table, Tag, Typography } from 'antd'
import { FileZipOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import StepRunner from '../components/StepRunner'
import type { InstallerPackage, NodeConfig, NodeDockerInfo, Step5Params } from '@shared/types'

const { Text } = Typography

export default function Step5Docker() {
  const { message } = App.useApp()
  const { nodes } = useWizard()
  const [packages, setPackages] = useState<InstallerPackage[]>([])
  const [mode, setMode] = useState<Step5Params['mode']>('reuse')
  const [registering, setRegistering] = useState(false)
  const [docker, setDocker] = useState<Record<string, NodeDockerInfo>>({})
  const [probing, setProbing] = useState(false)

  const pkgVersion = packages.find((p) => p.dockerVersion)?.dockerVersion

  const probe = useCallback(async () => {
    setProbing(true)
    try {
      setDocker(await ipc.step5ProbeDocker(nodes))
    } finally {
      setProbing(false)
    }
  }, [nodes])

  useEffect(() => {
    ipc.listPackages().then(setPackages).catch(() => undefined)
    probe()
  }, [probe])

  async function pickAndRegister() {
    const path = await ipc.pickInstaller()
    if (!path) return
    setRegistering(true)
    try {
      const pkg = await ipc.registerPackage(path)
      setPackages(await ipc.listPackages())
      message.success(`已登记安装包：${pkg.arch}${pkg.dockerVersion ? ` · docker ${pkg.dockerVersion}` : ''}`)
    } catch (e) {
      message.error(`解析安装包失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRegistering(false)
    }
  }

  const params: Step5Params = { mode }
  const hasPackage = packages.length > 0

  const dockerCols: ColumnsType<NodeConfig> = [
    {
      title: '节点',
      width: 180,
      render: (_, n) => (
        <Text style={{ fontFamily: 'monospace' }}>{n.ip}</Text>
      )
    },
    {
      title: '当前 Docker',
      render: (_, n) => {
        const d = docker[n.id]
        if (!d) return <Text type="secondary">{probing ? '检测中…' : '-'}</Text>
        return d.installed ? (
          <Text style={{ fontFamily: 'monospace' }}>{d.version ?? '已安装'}</Text>
        ) : (
          <Text type="secondary">未安装</Text>
        )
      }
    },
    {
      title: `与安装包${pkgVersion ? `（${pkgVersion}）` : ''}`,
      render: (_, n) => {
        const d = docker[n.id]
        if (!d || !d.installed) return <Tag>—</Tag>
        if (!pkgVersion || !d.version) return <Tag>未知</Tag>
        return d.version === pkgVersion ? (
          <Tag color="success">一致</Tag>
        ) : (
          <Tag color="warning">不一致 · 建议强制重装</Tag>
        )
      }
    }
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Text type="secondary">
        从安装包抽取 Docker 二进制并下发到各节点离线安装（幂等校验）。下方显示各节点当前 Docker 版本与安装包是否一致。
      </Text>

      <Space wrap>
        <Button icon={<FileZipOutlined />} loading={registering} onClick={pickAndRegister}>
          登记安装包
        </Button>
        {packages.map((p) => (
          <Tag key={p.arch} color="blue">
            {p.arch}
            {p.dockerVersion ? ` · docker ${p.dockerVersion}` : ''}
          </Tag>
        ))}
        {!hasPackage && <Text type="warning">尚未登记安装包</Text>}
      </Space>

      <div>
        <Space style={{ marginBottom: 8 }}>
          <Text strong>各节点 Docker 现状</Text>
          <Button size="small" icon={<ReloadOutlined />} loading={probing} onClick={probe}>
            重新检测
          </Button>
        </Space>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          columns={dockerCols}
          dataSource={nodes}
        />
      </div>

      <div>
        <Text>安装模式：</Text>
        <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)} style={{ marginLeft: 8 }}>
          <Radio value="reuse">复用（已装则跳过，幂等）</Radio>
          <Radio value="force-reinstall">
            <Text type="danger">强制重装（清除现有 Docker 与数据）</Text>
          </Radio>
        </Radio.Group>
      </div>

      {mode === 'force-reinstall' && (
        <Alert
          type="error"
          showIcon
          message="强制重装会停止并删除现有 Docker、容器、镜像、卷及 /root/.docker 数据，执行前需输入确认词。"
        />
      )}

      <StepRunner
        runKey="step5"
        nodes={nodes}
        actionLabel="安装 Docker"
        disabled={!hasPackage}
        buildPlan={() => ipc.step5Plan(nodes, params)}
        run={(runId) => ipc.step5Run(runId, nodes, params)}
        onDone={() => probe()}
      />
    </Space>
  )
}
