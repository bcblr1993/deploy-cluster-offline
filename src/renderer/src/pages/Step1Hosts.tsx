// 步骤1：主机接入 — 按 ClusterDeploy 设计稿重绘（闸门横幅 + 自绘主机表）。

import { useEffect, useState, type CSSProperties } from 'react'
import { App } from 'antd'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import { btnGhost, btnPrimary, btnTiny, btnTinyDanger, card, chip, th, type ChipKind } from '../styles/cd'
import type { NodeConfig, NodeProbe } from '@shared/types'

const inline: CSSProperties = {
  width: '100%',
  padding: '5px 7px',
  borderRadius: 6,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'var(--mono)',
  outline: 'none',
  boxSizing: 'border-box'
}

function statusOf(p?: NodeProbe): { kind: ChipKind; label: string; dot: string } {
  if (!p) return { kind: 'neutral', label: '未检测', dot: 'var(--faint)' }
  if (!p.reachable) return { kind: 'err', label: '连不通', dot: 'var(--err)' }
  if (!p.supported) return { kind: 'warn', label: '不满足', dot: 'var(--warn)' }
  return { kind: 'ok', label: '就绪', dot: 'var(--ok)' }
}

export default function Step1Hosts() {
  const { message } = App.useApp()
  const {
    nodes,
    probes,
    probing,
    clusterId,
    addNode,
    removeNode,
    updateNode,
    setProbe,
    setProbing,
    setNodes
  } = useWizard()

  const [io, setIo] = useState<{ mode: 'export' | 'import'; path?: string } | null>(null)
  const [pass, setPass] = useState('')
  const [otherIps, setOtherIps] = useState<Record<string, string[]>>({})

  useEffect(() => {
    ipc
      .clustersList()
      .then((list) => {
        const m: Record<string, string[]> = {}
        for (const c of list) {
          if (c.id === clusterId) continue
          for (const ip of c.ips) (m[ip] ??= []).push(c.name)
        }
        setOtherIps(m)
      })
      .catch(() => undefined)
  }, [clusterId])

  async function probeOne(node: NodeConfig) {
    if (!node.ip) return
    setProbing(node.id, true)
    try {
      setProbe(node.id, await ipc.probeNode(node))
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
    void save(true)
  }
  async function save(silent = false) {
    const cluster = useWizard.getState().toCluster()
    if (!cluster.id) return
    const res = await ipc.clusterSave(cluster)
    if (!silent) {
      if (res.encryptionAvailable) message.success('配置已保存（密码已加密）')
      else message.warning('配置已保存，但系统钥匙串不可用，密码仅 base64 混淆')
    }
  }
  async function startImport() {
    const path = await ipc.importNodesPick()
    if (!path) return
    setPass('')
    setIo({ mode: 'import', path })
  }
  async function confirmIo() {
    if (!io) return
    if (!pass) return message.warning('请输入口令')
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

  const ready = nodes.filter((n) => probes[n.id]?.supported).length
  const gateOpen = ready >= 1
  const grid = '1.3fr .55fr 1.5fr 2.1fr 96px'

  return (
    <div>
      {/* gate banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 13,
          padding: '13px 16px',
          borderRadius: 13,
          marginBottom: 16,
          border: `1px solid ${gateOpen ? 'var(--ok-soft)' : 'var(--err-border)'}`,
          background: gateOpen ? 'var(--ok-soft)' : 'var(--err-soft)'
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: gateOpen ? 'rgba(52,199,123,.18)' : 'rgba(255,90,77,.18)',
            color: gateOpen ? 'var(--ok)' : 'var(--err)',
            fontSize: 16
          }}
        >
          {gateOpen ? '✓' : '⚠'}
        </div>
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.45 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>
              {gateOpen ? '连接检测已通过' : '尚无节点通过连接检测'}
            </span>
            <span style={chip(gateOpen ? 'ok' : 'err')}>{ready} 节点就绪</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>
            {gateOpen
              ? '已有就绪节点，可继续后续阶段。不满足/连不通的节点会被自动跳过。'
              : '部署流程与集群管理都依赖于此 —— 至少一个节点「就绪」后才能继续。'}
          </span>
        </div>
      </div>

      {/* actions */}
      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginBottom: 16 }}>
        <button style={btnGhost} onClick={addNode}>
          <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>添加主机
        </button>
        <button style={btnPrimary} onClick={probeAll}>
          <span style={{ fontSize: 13 }}>⚡</span>检测全部
        </button>
        <button style={btnGhost} onClick={startImport}>
          导入
        </button>
        <button
          style={btnGhost}
          onClick={() => {
            setPass('')
            setIo({ mode: 'export' })
          }}
        >
          导出
        </button>
        <button style={btnGhost} onClick={() => save()}>
          保存
        </button>
      </div>

      {/* table */}
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: grid, background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
          <div style={th}>IP 地址</div>
          <div style={th}>端口</div>
          <div style={th}>用户名 / 密码</div>
          <div style={th}>检测结果</div>
          <div style={th}>操作</div>
        </div>
        {nodes.map((n, i) => {
          const p = probes[n.id]
          const st = statusOf(p)
          return (
            <div
              key={n.id}
              style={{ display: 'grid', gridTemplateColumns: grid, borderBottom: i < nodes.length - 1 ? '1px solid var(--border)' : undefined }}
            >
              <div style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: st.dot, flexShrink: 0 }} />
                <input style={inline} placeholder="10.0.0.11" value={n.ip} onChange={(e) => updateNode(n.id, { ip: e.target.value.trim() })} />
              </div>
              <div style={{ padding: '9px 8px', display: 'flex', alignItems: 'center' }}>
                <input
                  style={inline}
                  value={n.port}
                  onChange={(e) => updateNode(n.id, { port: Number(e.target.value) || 22 })}
                />
              </div>
              <div style={{ padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center' }}>
                <input style={inline} value={n.username} onChange={(e) => updateNode(n.id, { username: e.target.value.trim() })} />
                <input
                  style={{ ...inline, fontSize: 11.5, color: 'var(--faint)' }}
                  type="password"
                  placeholder="密码"
                  value={n.password ?? ''}
                  onChange={(e) => updateNode(n.id, { password: e.target.value })}
                />
              </div>
              <div style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {probing[n.id] ? (
                  <span style={chip('accent')}>检测中…</span>
                ) : (
                  <>
                    <span style={chip(st.kind)}>{st.label}</span>
                    {p?.reachable && p.supported && (
                      <>
                        {p.osPretty && <span style={chip('neutral')}>{p.osPretty}</span>}
                        <span style={chip('accent')}>{p.privilege}</span>
                        {p.dockerInstalled && <span style={chip('warn')}>已装 docker</span>}
                        <span style={chip(p.online ? 'ok' : 'neutral')}>{p.online ? '可联网' : '离线'}</span>
                      </>
                    )}
                    {p && !p.supported && p.reachable && (
                      <span style={chip('warn')}>
                        {p.arch !== 'x86_64' ? `架构 ${p.arch}` : ''}
                        {!p.hasSystemd ? ' 非systemd' : ''}
                        {p.privilege === 'none' ? ' 无root/sudo' : ''}
                        {!p.adapterId ? ' 发行版待扩展' : ''}
                      </span>
                    )}
                    {p && !p.reachable && <span style={chip('err')}>{p.error}</span>}
                    {n.ip && otherIps[n.ip] && (
                      <span style={chip('warn')} title={`也在：${otherIps[n.ip].join('、')}`}>
                        也在其它集群
                      </span>
                    )}
                  </>
                )}
              </div>
              <div style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 7 }}>
                <button style={btnTiny} onClick={() => probeOne(n)}>
                  检测
                </button>
                <button style={btnTinyDanger} disabled={nodes.length <= 1} onClick={() => removeNode(n.id)}>
                  ✕
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <p style={{ margin: '14px 2px 0', fontSize: 12.5, color: 'var(--faint)', lineHeight: 1.6 }}>
        连接检测是整条部署流程的闸门：并发校验连通性与环境（架构 · systemd · 权限 · docker · 联网）。至少一个节点「就绪」才能进入后续阶段与集群管理。
      </p>

      {/* import/export passphrase modal */}
      {io && (
        <div
          onClick={() => setIo(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 24 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 440, ...card, borderColor: 'var(--border-2)', boxShadow: '0 24px 60px rgba(0,0,0,.4)' }}
          >
            <div style={{ padding: '20px 22px 0' }}>
              <h3 style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 18, margin: '0 0 5px' }}>
                {io.mode === 'export' ? '导出节点配置' : '导入节点配置'}
              </h3>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--dim)' }}>
                {io.mode === 'export' ? '设置一个口令用于加密密码字段，导入时需输入同一口令。' : '输入导出时设置的口令以解密密码。'}
              </p>
            </div>
            <div style={{ padding: '18px 22px 8px' }}>
              <input
                autoFocus
                className="cd-input"
                style={{ padding: '10px 13px', fontSize: 13.5 }}
                type="password"
                placeholder="口令"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmIo()}
              />
            </div>
            <div style={{ padding: '14px 22px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button style={btnGhost} onClick={() => setIo(null)}>
                取消
              </button>
              <button style={btnPrimary} onClick={confirmIo}>
                {io.mode === 'export' ? '导出' : '导入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
