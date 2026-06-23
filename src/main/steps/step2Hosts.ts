// 步骤2：主机名 & hosts 映射（设计文档 §7 步骤2）。
// 先读取机器现有主机名与 /etc/hosts，再合并集群映射（重复不重复加入）。

import { runStep, execLogged } from '../orchestrator/runStep'
import { sshPool } from '../ssh/SshPool'
import { buildManagedHosts, type HostEntry } from '@shared/hosts'
import type {
  ActionPlan,
  NodeConfig,
  NodeTaskResult,
  Step2Params,
  Step2Read
} from '@shared/types'

function clusterEntries(nodes: NodeConfig[], hostnames: Record<string, string>): HostEntry[] {
  return nodes.map((n) => ({ ip: n.ip, hostname: hostnames[n.id] ?? '' }))
}

/** 读取各节点当前主机名与 /etc/hosts（用于预填与预览） */
export async function readStep2(nodes: NodeConfig[]): Promise<Record<string, Step2Read>> {
  const out: Record<string, Step2Read> = {}
  await Promise.all(
    nodes.map(async (n) => {
      try {
        const c = await sshPool.acquire(n)
        const hn = await c.exec('hostname', { timeoutMs: 8000 })
        const hosts = await c.exec('cat /etc/hosts 2>/dev/null', { timeoutMs: 8000 })
        out[n.id] = { hostname: hn.stdout.trim(), hosts: hosts.stdout }
      } catch {
        out[n.id] = { hostname: '', hosts: '' }
      }
    })
  )
  return out
}

/** §15 确认计划：读取现有 hosts，按节点展示「合并后」预览（含去重统计） */
export async function planStep2(nodes: NodeConfig[], params: Step2Params): Promise<ActionPlan> {
  const reads = await readStep2(nodes)
  const entries = clusterEntries(nodes, params.hostnames)
  const previews = nodes.map((n) => {
    const r = buildManagedHosts(reads[n.id]?.hosts ?? '', entries)
    const cur = reads[n.id]?.hostname || '(未知)'
    return `# ${n.ip}  主机名 ${cur} → ${params.hostnames[n.id]}  | 新增 ${r.added} 跳过重复 ${r.skipped}\n${r.block || '(无新增映射)'}`
  })
  return {
    stepId: 'step2',
    level: 'warning',
    items: nodes.map((n) => ({
      nodeId: n.id,
      summary: `${n.ip}：主机名 ${reads[n.id]?.hostname || '?'} → ${params.hostnames[n.id] ?? '(未设置)'}`,
      affects: ['hostnamectl set-hostname', '/etc/hosts 托管块（保留原内容、去重合并）']
    })),
    preview: previews.join('\n\n')
  }
}

export async function runStep2(
  runId: string,
  nodes: NodeConfig[],
  params: Step2Params
): Promise<NodeTaskResult[]> {
  const entries = clusterEntries(nodes, params.hostnames)

  return runStep(runId, nodes, async (ctx) => {
    const hostname = params.hostnames[ctx.node.id]
    if (!hostname) throw new Error('未分配主机名')

    // 1) 读取现有主机名 + hosts
    const curHn = (await ctx.client.exec('hostname', { timeoutMs: 8000 })).stdout.trim()
    ctx.log(`当前主机名: ${curHn || '(未知)'}`)
    if (curHn === hostname) {
      ctx.log('主机名无需修改')
    } else {
      ctx.log(`设置主机名: ${hostname}`)
      const r1 = await execLogged(ctx, `hostnamectl set-hostname '${hostname}'`, { sudo: true })
      if (r1.code !== 0) throw new Error(`设置主机名失败 (code=${r1.code})`)
    }

    // 2) 合并 hosts（保留原内容，去重）
    const curHosts = (await ctx.client.exec('cat /etc/hosts 2>/dev/null', { timeoutMs: 8000 })).stdout
    const { merged, added, skipped } = buildManagedHosts(curHosts, entries)
    ctx.log(`hosts 合并：新增 ${added} 条，跳过重复 ${skipped} 条`)

    const write = [
      `cp /etc/hosts /etc/hosts.deploytool.bak 2>/dev/null || true`,
      `cat > /etc/hosts <<'DEPLOYEOF'`,
      merged.replace(/\n+$/, ''),
      `DEPLOYEOF`
    ].join('\n')
    const r2 = await execLogged(ctx, write, { sudo: true })
    if (r2.code !== 0) throw new Error(`写入 hosts 失败 (code=${r2.code})`)

    ctx.log('✓ 完成')
  })
}
