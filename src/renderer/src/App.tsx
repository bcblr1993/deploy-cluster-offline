import { useEffect, type CSSProperties } from 'react'
import { useWizard } from './store/wizard'
import { ipc } from './ipc/client'
import Step1Hosts from './pages/Step1Hosts'
import Step2Hostname from './pages/Step2Hostname'
import Step3Time from './pages/Step3Time'
import Step4Disk from './pages/Step4Disk'
import Step5Docker from './pages/Step5Docker'
import Step6Services from './pages/Step6Services'
import Overview from './pages/Overview'
import ClusterList from './pages/ClusterList'
import RunConsole from './components/RunConsole'
import ClusterMark from './components/ClusterMark'
import { btnGhost, btnPrimary } from './styles/cd'

const STAGES = [
  { title: '主机接入', sub: '连接检测', desc: '录入现场所有节点的连接信息，并发检测连通性与运行环境（架构 / systemd / 权限 / docker / 联网）。' },
  { title: '主机名 & hosts', sub: '映射', desc: '统一设置各节点主机名，并写入全集群一致的 /etc/hosts 解析表。' },
  { title: '时间对齐', sub: 'chrony', desc: '校验节点间时钟偏差，按联网情况自动选时间源，用 chrony 对齐全集群时间。' },
  { title: '磁盘预览', sub: 'SSD/HDD', desc: '扫描并预览各节点磁盘与挂载点（SSD/HDD、容量、使用率），规划数据落盘位置。' },
  { title: '安装 Docker', sub: '离线', desc: '从离线包加载并安装 Docker 引擎与 compose，启用 systemd 守护与开机自启。' },
  { title: '服务编排', sub: '按节点部署', desc: '把服务编排到节点：数据层 / 应用层 / 运维层按依赖与分层规则放置后一键部署。' }
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

const display = { fontFamily: 'var(--display)' } as const
function chip(kind: 'ok' | 'neutral' | 'accent' | 'err'): CSSProperties {
  const m: Record<string, CSSProperties> = {
    ok: { background: 'var(--ok-soft)', color: 'var(--ok)' },
    accent: { background: 'var(--accent-soft)', color: 'var(--accent-ink)' },
    err: { background: 'var(--err-soft)', color: 'var(--err)' },
    neutral: { background: 'var(--surface-2)', color: 'var(--dim)', border: '1px solid var(--border)' }
  }
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 9px',
    borderRadius: 6,
    fontSize: 11.5,
    fontWeight: 600,
    fontFamily: 'var(--mono)',
    ...m[kind]
  }
}

export default function App() {
  const {
    step,
    setStep,
    view,
    setView,
    deployed,
    canLeaveStep1,
    canLeaveStep5,
    applyRunEvent,
    busy,
    appView,
    closeCluster,
    clusterName,
    clusterRemark,
    theme,
    toggleTheme,
    nodes,
    probes,
    runOpen
  } = useWizard()

  useEffect(() => {
    const off = ipc.onRunEvent(applyRunEvent)
    return off
  }, [applyRunEvent])

  if (appView === 'clusters') return <ClusterList />

  async function backToClusters() {
    const c = useWizard.getState().toCluster()
    if (c.id) await ipc.clusterSave(c)
    closeCluster()
  }

  const gateOpen = canLeaveStep1()
  const online = nodes.filter((n) => probes[n.id]?.reachable).length
  const stageStatus = (i: number): 'done' | 'current' | 'ready' | 'blocked' => {
    if (i > 0 && !gateOpen) return 'blocked'
    if (view === 'wizard' && step === i) return 'current'
    if (i === 0 && gateOpen) return 'done'
    return 'ready'
  }
  const deployDone = STAGES.filter((_, i) => stageStatus(i) === 'done').length
  // 进入下一阶段的闸门：step0 需连接检测通过；step4(安装Docker) 需装好 Docker；其余沿用主机接入闸门
  const canNext = step === 4 ? canLeaveStep5() : gateOpen

  const cur = STAGES[step]
  const stHead = stageStatus(step)
  const stHeadChip = stHead === 'done' ? 'ok' : stHead === 'current' ? 'accent' : stHead === 'blocked' ? 'err' : 'neutral'
  const stHeadLabel = { done: '已完成', current: '进行中', ready: '待运行', blocked: '受阻' }[stHead]

  return (
    <div
      style={{
        height: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--body)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* health header */}
      <header
        style={{
          height: 60,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 22px 0 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <button title="返回集群列表" disabled={busy} onClick={backToClusters} style={backBtn(busy)}>
            ←
          </button>
          <ClusterMark size={26} variant="brand" radiusRatio={0.26} style={{ flexShrink: 0 }} title="离线集群部署" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: deployDone > 0 ? 'var(--ok)' : 'var(--faint)', flexShrink: 0 }} />
            <span style={{ ...display, fontWeight: 600, fontSize: 16, letterSpacing: '-.01em', whiteSpace: 'nowrap' }}>{clusterName || '集群'}</span>
            <span style={chip(deployDone > 0 ? 'ok' : 'neutral')}>{deployDone > 0 ? '运行中' : '未部署'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 6, paddingLeft: 14, borderLeft: '1px solid var(--border)' }}>
            <Kpi label="节点在线">{online}/{nodes.length}</Kpi>
            <Kpi label="部署阶段">{deployDone}/6</Kpi>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={themeBtn} title="切换主题" onClick={toggleTheme}>
            <span style={{ fontSize: 15 }}>{theme === 'dark' ? '☀' : '☾'}</span>
          </button>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* sidebar */}
        <aside
          style={{
            width: 248,
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            background: 'var(--surface)',
            overflow: 'auto',
            padding: '16px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 3
          }}
        >
          <button
            onClick={() => deployed && setView('overview')}
            disabled={!deployed}
            title={deployed ? undefined : '需先完成服务部署，才能进入集群详情'}
            style={{ ...navItem(view === 'overview'), opacity: deployed ? 1 : 0.5, cursor: deployed ? 'pointer' : 'not-allowed' }}
          >
            <span style={{ width: 18, textAlign: 'center', fontSize: 14, opacity: 0.8 }}>◎</span>集群详情
          </button>
          <div style={sidebarLabel}>
            <span>部署流程</span>
            <span style={{ fontFamily: 'var(--mono)' }}>{deployDone}/6</span>
          </div>
          {STAGES.map((st, i) => {
            const status = stageStatus(i)
            const active = view === 'wizard' && step === i
            const locked = status === 'blocked'
            return (
              <button
                key={i}
                onClick={() => {
                  if (busy) return
                  setView('wizard')
                  setStep(locked ? 0 : i)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  width: '100%',
                  padding: '8px 10px',
                  border: 'none',
                  borderRadius: 9,
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  cursor: locked ? 'not-allowed' : 'pointer',
                  opacity: locked ? 0.55 : 1,
                  background: active ? 'var(--accent-soft)' : 'transparent'
                }}
              >
                <span style={stageBadge(status)}>{{ done: '✓', current: '◐', ready: '○', blocked: '🔒' }[status]}</span>
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{st.title}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--faint)', fontFamily: 'var(--mono)' }}>{st.sub}</span>
                </span>
                {status === 'current' && <span style={chip('accent')}>进行中</span>}
                {status === 'blocked' && <span style={chip('err')}>受阻</span>}
              </button>
            )
          })}
        </aside>

        {/* content */}
        <main style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ maxWidth: 1080, margin: '0 auto', padding: `30px 32px ${runOpen ? 360 : 40}px` }}>
            {view === 'overview' ? (
              <Overview />
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, marginBottom: 22 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                      <h1 style={{ ...display, fontWeight: 600, fontSize: 23, margin: 0, letterSpacing: '-.02em' }}>{cur.title}</h1>
                      <span style={chip(stHeadChip as 'ok')}>{stHeadLabel}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 13.5, color: 'var(--dim)', maxWidth: 560, lineHeight: 1.55 }}>{cur.desc}</p>
                  </div>
                  <div style={statPill}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />
                    <span style={{ fontSize: 12.5, color: 'var(--dim)' }}>阶段 {step + 1} / 6</span>
                  </div>
                </div>
                <StepBody step={step} />
                {!gateOpen && step > 0 && (
                  <p style={{ marginTop: 16, fontSize: 12.5, color: 'var(--err)' }}>
                    需先在「主机接入」让至少一个节点通过连接检测，才能执行后续阶段。
                  </p>
                )}
                {step === 4 && !canLeaveStep5() && (
                  <p style={{ marginTop: 10, fontSize: 12.5, color: 'var(--warn)' }}>
                    提示：进入「服务编排」前需登记安装包并在所有节点装好 Docker。
                  </p>
                )}

                {/* 统一阶段导航：每个流程都有上一步 / 下一步 */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginTop: 28,
                    paddingTop: 20,
                    borderTop: '1px solid var(--border)'
                  }}
                >
                  <button
                    onClick={() => step > 0 && setStep(step - 1)}
                    disabled={step === 0}
                    style={{ ...btnGhost, opacity: step === 0 ? 0.45 : 1, cursor: step === 0 ? 'not-allowed' : 'pointer' }}
                  >
                    ← 上一步
                  </button>
                  {step < STAGES.length - 1 ? (
                    <button
                      onClick={() => canNext && setStep(step + 1)}
                      disabled={!canNext}
                      title={
                        canNext ? undefined : step === 4 ? '需登记安装包并在所有节点装好 Docker' : '需先让至少一个节点通过连接检测'
                      }
                      style={{ ...btnPrimary, opacity: canNext ? 1 : 0.5, cursor: canNext ? 'pointer' : 'not-allowed' }}
                    >
                      下一阶段：{STAGES[step + 1].title} →
                    </button>
                  ) : (
                    <button
                      onClick={() => deployed && setView('overview')}
                      disabled={!deployed}
                      title={deployed ? undefined : '需先完成服务部署，才能进入集群详情'}
                      style={{ ...btnPrimary, opacity: deployed ? 1 : 0.5, cursor: deployed ? 'pointer' : 'not-allowed' }}
                    >
                      完成 · 进入集群详情 →
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      <RunConsole />
    </div>
  )
}

function Kpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--dim)' }}>
      <b style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>{children}</b>
      {label}
    </span>
  )
}

function navItem(on: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    width: '100%',
    padding: '10px 12px',
    border: 'none',
    borderRadius: 9,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13.5,
    fontWeight: 600,
    textAlign: 'left',
    background: on ? 'var(--accent-soft)' : 'transparent',
    color: on ? 'var(--accent-ink)' : 'var(--text)'
  }
}
function stageBadge(status: 'done' | 'current' | 'ready' | 'blocked'): CSSProperties {
  const base: CSSProperties = {
    width: 24,
    height: 24,
    borderRadius: 7,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
    fontFamily: 'var(--mono)',
    flexShrink: 0
  }
  if (status === 'done') return { ...base, background: 'var(--ok-soft)', color: 'var(--ok)' }
  if (status === 'current') return { ...base, background: 'var(--accent)', color: '#fff' }
  return { ...base, background: 'var(--surface-2)', color: 'var(--faint)', border: '1px solid var(--border)' }
}
const sidebarLabel: CSSProperties = {
  marginTop: 6,
  padding: '8px 12px 5px',
  fontSize: 10.5,
  letterSpacing: '.1em',
  color: 'var(--faint)',
  fontFamily: 'var(--mono)',
  textTransform: 'uppercase',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between'
}
const statPill: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 9,
  padding: '9px 14px',
  flexShrink: 0
}
const themeBtn: CSSProperties = {
  width: 38,
  height: 36,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  borderRadius: 9,
  color: 'var(--dim)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
}
function backBtn(busy: boolean): CSSProperties {
  return {
    width: 36,
    height: 36,
    border: '1px solid var(--border)',
    borderRadius: 9,
    background: 'var(--surface-2)',
    color: 'var(--dim)',
    fontSize: 16,
    cursor: busy ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    opacity: busy ? 0.5 : 1
  }
}
