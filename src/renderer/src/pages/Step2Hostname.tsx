// 步骤2：主机名 & hosts — 设计稿重绘（表 + /etc/hosts 预览）。

import { useEffect, useState } from 'react'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import StepRunner from '../components/StepRunner'
import { buildManagedHosts } from '@shared/hosts'
import { card, chip, inputStyle, th } from '../styles/cd'
import type { Step2Params, Step2Read } from '@shared/types'

export default function Step2Hostname() {
  const { nodes, hostnames, setHostname, initHostnames } = useWizard()
  const [reads, setReads] = useState<Record<string, Step2Read>>({})

  useEffect(() => {
    ipc
      .step2Read(nodes)
      .then((r) => {
        setReads(r)
        for (const n of nodes) if (r[n.id]?.hostname) setHostname(n.id, r[n.id].hostname)
        initHostnames()
      })
      .catch(() => initHostnames())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const params: Step2Params = { hostnames }
  const entries = nodes.map((n) => ({ ip: n.ip, hostname: hostnames[n.id] ?? '' }))
  // 以第一个节点的现有 hosts 作为预览基准
  const merged = buildManagedHosts(reads[nodes[0]?.id]?.hosts ?? '', entries)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' }}>
        <div style={card}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
            <div style={th}>IP 地址</div>
            <div style={th}>主机名</div>
          </div>
          {nodes.map((n, i) => (
            <div key={n.id} style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr', borderBottom: i < nodes.length - 1 ? '1px solid var(--border)' : undefined }}>
              <div style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)', flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13.5, fontWeight: 500 }}>{n.ip}</span>
              </div>
              <div style={{ padding: '9px 16px', display: 'flex', alignItems: 'center' }}>
                <input
                  style={{ ...inputStyle, fontFamily: 'var(--mono)' }}
                  placeholder="node-1"
                  value={hostnames[n.id] ?? ''}
                  onChange={(e) => setHostname(n.id, e.target.value.trim())}
                />
              </div>
            </div>
          ))}
        </div>
        <div style={card}>
          <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.06em', color: 'var(--faint)', textTransform: 'uppercase' }}>
              /etc/hosts 预览
            </span>
            <span style={{ fontSize: 11, color: 'var(--faint)' }}>全集群一致</span>
            <span style={{ marginLeft: 'auto', ...chip('ok') }}>新增 {merged.added}</span>
          </div>
          <pre style={{ margin: 0, padding: '14px 16px', fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.9, color: 'var(--dim)', whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>
            {merged.merged}
          </pre>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <StepRunner
          runKey="step2"
          nodes={nodes}
          actionLabel={`写入主机名与 hosts 到 ${nodes.length} 个节点`}
          buildPlan={() => ipc.step2Plan(nodes, params)}
          run={(runId) => ipc.step2Run(runId, nodes, params)}
        />
      </div>
    </div>
  )
}
