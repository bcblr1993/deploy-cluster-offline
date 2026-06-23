// 步骤5：离线安装 Docker / docker-compose 页。

import { useEffect, useState } from 'react'
import { Alert, App, Button, Radio, Space, Tag, Typography } from 'antd'
import { FileZipOutlined } from '@ant-design/icons'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import StepRunner from '../components/StepRunner'
import type { InstallerPackage, Step5Params } from '@shared/types'

const { Text } = Typography

export default function Step5Docker() {
  const { message } = App.useApp()
  const { nodes } = useWizard()
  const [packages, setPackages] = useState<InstallerPackage[]>([])
  const [mode, setMode] = useState<Step5Params['mode']>('reuse')
  const [registering, setRegistering] = useState(false)

  useEffect(() => {
    ipc.listPackages().then(setPackages).catch(() => undefined)
  }, [])

  async function pickAndRegister() {
    const path = await ipc.pickInstaller()
    if (!path) return
    setRegistering(true)
    try {
      const pkg = await ipc.registerPackage(path)
      setPackages(await ipc.listPackages())
      message.success(`已登记安装包：${pkg.arch}`)
    } catch (e) {
      message.error(`解析安装包失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRegistering(false)
    }
  }

  const params: Step5Params = { mode }
  const hasPackage = packages.length > 0

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Text type="secondary">
        从安装包抽取 Docker 二进制并下发到各节点离线安装（幂等校验）。安装包只抽取 docker/ 子树，不传 1.5G 镜像。
      </Text>

      <Space wrap>
        <Button icon={<FileZipOutlined />} loading={registering} onClick={pickAndRegister}>
          登记安装包
        </Button>
        {packages.map((p) => (
          <Tag key={p.arch} color="blue">
            {p.arch}
          </Tag>
        ))}
        {!hasPackage && <Text type="warning">尚未登记安装包</Text>}
      </Space>

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
      />
    </Space>
  )
}
