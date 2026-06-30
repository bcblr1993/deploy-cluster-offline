// 步骤5：安装 Docker — 设计稿重绘（架构分组 + 按架构安装包槽 + 闸门）。

import { useCallback, useEffect, useState } from 'react'
import { App } from 'antd'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import StepRunner from '../components/StepRunner'
import { card, chip } from '../styles/cd'
import type { Arch, InstallerPackage, NodeDockerInfo, Step5Params } from '@shared/types'

export default function Step5Docker() {
  const { message } = App.useApp()
  const { nodes, probes, packages, setPackages, dockerInfo, setDockerInfo } = useWizard()
  const [mode, setMode] = useState<Step5Params['mode']>('reuse')
  const [registering, setRegistering] = useState(false)

  const probe = useCallback(async () => {
    setDockerInfo(await ipc.step5ProbeDocker(nodes))
  }, [nodes, setDockerInfo])
  useEffect(() => {
    ipc.listPackages().then(setPackages).catch(() => undefined)
    probe().catch(() => undefined)
  }, [probe, setPackages])

  async function register() {
    const path = await ipc.pickInstaller()
    if (!path) return
    setRegistering(true)
    try {
      const pkg = await ipc.registerPackage(path)
      setPackages(await ipc.listPackages())
      message.success(`已登记 ${pkg.arch}${pkg.dockerVersion ? ` · docker ${pkg.dockerVersion}` : ''}`)
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setRegistering(false)
    }
  }

  const ready = nodes.filter((n) => probes[n.id]?.supported)
  const archMap: Record<string, string[]> = {}
  ready.forEach((n) => {
    const a = probes[n.id]?.arch || 'unknown'
    ;(archMap[a] = archMap[a] || []).push(n.ip)
  })
  const archKeys = Object.keys(archMap)
  const isMixed = archKeys.length > 1
  const allArchs: Arch[] = ['x86_64', 'aarch64']
  const pkgOf = (a: Arch): InstallerPackage | undefined => packages.find((p) => p.arch === a)
  const missingReq = allArchs.filter((a) => archMap[a] && !pkgOf(a))
  const dockerReady = archKeys.length > 0 && missingReq.length === 0
  const dockerInstalledAll = ready.every((n) => (dockerInfo as Record<string, NodeDockerInfo>)[n.id]?.installed)

  return (
    <div>
      {/* arch groups */}
      <div style={{ ...card, padding: '18px 20px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <span style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 14.5 }}>就绪节点架构</span>
          <span style={chip(isMixed ? 'warn' : archKeys.length === 0 ? 'neutral' : 'ok')}>
            {archKeys.length === 0 ? '无就绪节点' : isMixed ? `混合架构 · ${archKeys.length} 种` : `单一架构 · ${archKeys[0]}`}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {archKeys.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--faint)' }}>请先在「主机接入」完成检测。</span>}
          {archKeys.map((a) => (
            <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 11, background: 'var(--surface-2)' }}>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, color: 'var(--accent-ink)' }}>{a}</span>
              <span style={{ fontSize: 12, color: 'var(--dim)' }}>{archMap[a].length} 节点</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>{archMap[a].join(' · ')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* package slots */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 2px 12px' }}>
        <span style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 14 }}>选择安装包</span>
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>按架构提供离线包 · 标「必需」的必须登记才能安装</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {allArchs.map((a) => {
          const required = !!archMap[a]
          const pkg = pkgOf(a)
          const missing = required && !pkg
          return (
            <div key={a} style={{ border: `1px solid ${missing ? 'var(--err-border)' : 'var(--border)'}`, borderRadius: 13, background: 'var(--surface)', boxShadow: 'var(--card-shadow)', padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13.5 }}>{a}</span>
                  <span style={chip(required ? 'accent' : 'neutral')}>{required ? '必需' : '本集群无需'}</span>
                </div>
                <span style={chip(pkg ? 'ok' : required ? 'err' : 'neutral')}>{pkg ? '已登记' : required ? '缺少 · 必需' : '未登记'}</span>
              </div>
              {pkg ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--ok)', flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>iotcloud · docker {pkg.dockerVersion || '?'}</span>
                </div>
              ) : (
                <button
                  onClick={register}
                  disabled={registering}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    width: '100%',
                    padding: 18,
                    border: `1.5px dashed ${missing ? 'var(--err-border)' : 'var(--border-2)'}`,
                    borderRadius: 10,
                    background: 'transparent',
                    color: missing ? 'var(--err)' : 'var(--dim)',
                    cursor: 'pointer',
                    fontFamily: 'inherit'
                  }}
                >
                  <span style={{ fontSize: 18, lineHeight: 1 }}>＋</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{required ? `登记 ${a} 安装包` : `可选登记 ${a}`}</span>
                  <span style={{ fontSize: 11, color: 'var(--faint)' }}>点击选择离线包 (.tar.gz)</span>
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* gate + install */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 13,
          padding: '14px 16px',
          borderRadius: 13,
          marginTop: 18,
          border: `1px solid ${dockerReady ? 'var(--ok-soft)' : 'var(--err-border)'}`,
          background: dockerReady ? 'var(--ok-soft)' : 'var(--err-soft)'
        }}
      >
        <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: dockerReady ? 'rgba(52,199,123,.18)' : 'rgba(255,90,77,.18)', color: dockerReady ? 'var(--ok)' : 'var(--err)', fontSize: 16 }}>
          {dockerReady ? '✓' : '⚠'}
        </div>
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.45 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{dockerReady ? '安装包齐备，可以安装' : '缺少必需架构的安装包'}</div>
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>
            {dockerReady
              ? dockerInstalledAll
                ? '所有就绪节点已安装 Docker，可进入服务编排。'
                : isMixed
                  ? `混合架构 · 已登记 ${archKeys.join(' + ')} 离线包。`
                  : `全部节点为 ${archKeys[0] || ''} · 已登记对应离线包。`
              : `请先登记：${missingReq.join(' + ')} 架构的离线安装包。`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: 12, color: 'var(--dim)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={mode === 'force-reinstall'} onChange={(e) => setMode(e.target.checked ? 'force-reinstall' : 'reuse')} />
            强制重装
          </label>
          <StepRunner
            runKey="step5"
            nodes={nodes}
            actionLabel={`安装 Docker 到 ${ready.length} 个节点`}
            disabled={!dockerReady}
            buildPlan={() => ipc.step5Plan(nodes, { mode })}
            run={(runId) => ipc.step5Run(runId, nodes, { mode })}
            onDone={() => probe()}
          />
        </div>
      </div>
    </div>
  )
}
