import { useEffect, useState } from 'react'
import { Button, Layout, Space, Steps, Typography, theme } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { useWizard } from './store/wizard'
import { ipc } from './ipc/client'
import Step1Hosts from './pages/Step1Hosts'
import Step2Hostname from './pages/Step2Hostname'
import Step3Time from './pages/Step3Time'
import Step4Disk from './pages/Step4Disk'
import Step5Docker from './pages/Step5Docker'
import Step6Services from './pages/Step6Services'
import type { AppInfo } from '@shared/types'

const { Header, Content, Footer } = Layout
const { Text } = Typography

const STEPS = [
  { title: '主机配置', desc: '连接检测' },
  { title: '主机名/hosts', desc: '映射' },
  { title: '时间对齐', desc: 'chrony' },
  { title: '磁盘预览', desc: 'SSD/HDD' },
  { title: '安装 Docker', desc: '离线' },
  { title: '服务编排', desc: '按节点部署' }
]

function StepBody({ step }: { step: number }) {
  switch (step) {
    case 0:
      return <Step1Hosts />
    case 1:
      return <Step2Hostname />
    case 2:
      return <Step3Time />
    case 3:
      return <Step4Disk />
    case 4:
      return <Step5Docker />
    case 5:
      return <Step6Services />
    default:
      return null
  }
}

export default function App() {
  const { step, setStep, hydrate, canLeaveStep1, applyRunEvent, busy } = useWizard()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const { token } = theme.useToken()

  useEffect(() => {
    ipc.getAppInfo().then(setInfo).catch(() => undefined)
    ipc.loadProject().then(hydrate).catch(() => hydrate(null))
    // 全局订阅运行事件 → 落到 store（与页面挂载解耦，切换步骤不丢日志）
    const off = ipc.onRunEvent(applyRunEvent)
    return off
  }, [hydrate, applyRunEvent])

  // 步骤门禁：步骤1 未全部检测通过时，禁止进入后续步骤
  const blockedByStep1 = step === 0 && !canLeaveStep1()

  return (
    <Layout style={{ height: '100vh' }}>
      <Header
        style={{
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingInline: 24
        }}
      >
        <Text strong style={{ fontSize: 16 }}>
          离线集群部署工具
        </Text>
        {info && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            v{info.appVersion} · Electron {info.electronVersion} · {info.platform}
          </Text>
        )}
      </Header>

      <Content style={{ padding: 24, overflow: 'auto' }}>
        <Steps
          current={step}
          onChange={busy ? undefined : setStep}
          items={STEPS.map((s) => ({
            title: s.title,
            description: s.desc,
            disabled: busy
          }))}
          style={{ marginBottom: 24 }}
        />
        <div
          style={{
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            padding: 24,
            minHeight: 360
          }}
        >
          <StepBody step={step} />
        </div>
      </Content>

      <Footer
        style={{
          background: token.colorBgContainer,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          justifyContent: 'space-between',
          paddingBlock: 12
        }}
      >
        <Button
          icon={<LeftOutlined />}
          disabled={step === 0 || busy}
          onClick={() => setStep(step - 1)}
        >
          上一步
        </Button>
        <Space>
          {busy && (
            <Text type="warning" style={{ fontSize: 12 }}>
              正在执行操作，导航已锁定…
            </Text>
          )}
          {!busy && blockedByStep1 && (
            <Text type="warning" style={{ fontSize: 12 }}>
              需所有主机检测「可用」后才能继续
            </Text>
          )}
          <Button
            type="primary"
            disabled={step === STEPS.length - 1 || blockedByStep1 || busy}
            onClick={() => setStep(step + 1)}
          >
            下一步 <RightOutlined />
          </Button>
        </Space>
      </Footer>
    </Layout>
  )
}
