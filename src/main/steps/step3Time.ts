// 步骤3：时间对齐（设计文档 §7 步骤3）。
// 统一 chrony；按联网情况自动选源；chrony 不可用时退化为 date 同步。

import { runStep, execLogged, type NodeRunCtx } from '../orchestrator/runStep'
import { sshPool } from '../ssh/SshPool'
import { checkOnline } from './connectivity'
import type {
  ActionPlan,
  NodeConfig,
  NodeTaskResult,
  Step3Params,
  TimePlan
} from '@shared/types'

const PUBLIC_NTP = ['ntp.aliyun.com', 'ntp1.aliyun.com', 'cn.pool.ntp.org']

/** 计算时间源策略（§7 步骤3 三分支） */
export async function planTimeStrategy(nodes: NodeConfig[]): Promise<TimePlan> {
  const online: string[] = []
  await Promise.all(
    nodes.map(async (n) => {
      if (await checkOnline(n)) online.push(n.id)
    })
  )
  if (online.length === nodes.length) {
    return { strategy: 'all-online', onlineNodeIds: online }
  }
  if (online.length > 0) {
    return { strategy: 'partial-online', sourceNodeId: online[0], onlineNodeIds: online }
  }
  return { strategy: 'all-offline', sourceNodeId: nodes[0]?.id, onlineNodeIds: [] }
}

export function planStep3(nodes: NodeConfig[], plan: TimePlan, params: Step3Params): ActionPlan {
  const sourceNode = nodes.find((n) => n.id === plan.sourceNodeId)
  const desc: Record<TimePlan['strategy'], string> = {
    'all-online': '所有节点均可联网 → 各自对公网 NTP 同步',
    'partial-online': `部分联网 → 以 ${sourceNode?.ip ?? '?'} 为时间源，其余对齐它`,
    'all-offline': `全部离线 → 以 ${sourceNode?.ip ?? '?'} 为基准源，其余对齐它（保证内部一致）`
  }
  return {
    stepId: 'step3',
    level: 'warning',
    items: nodes.map((n) => ({
      nodeId: n.id,
      summary: `${n.ip}：时区→${params.timezone}，时间将被步进对齐`,
      affects: ['timedatectl set-timezone', 'chrony 配置/服务', '系统时间步进']
    })),
    preview: `策略：${desc[plan.strategy]}`
  }
}

/** chrony 是否可用 + 配置文件路径 + 服务名 */
const DETECT_CHRONY = [
  'CONF=""',
  '[ -f /etc/chrony/chrony.conf ] && CONF=/etc/chrony/chrony.conf',
  '[ -z "$CONF" ] && [ -f /etc/chrony.conf ] && CONF=/etc/chrony.conf',
  'command -v chronyd >/dev/null 2>&1 && HASBIN=1 || HASBIN=0',
  'echo "CONF=$CONF"; echo "HASBIN=$HASBIN"'
].join('; ')

function buildChronyConf(role: 'public' | 'source' | 'client', sourceIp?: string): string {
  if (role === 'public') {
    return PUBLIC_NTP.map((s) => `server ${s} iburst`).join('\n') + '\ndriftfile /var/lib/chrony/drift\nmakestep 1.0 3\nrtcsync\n'
  }
  if (role === 'source') {
    // 源机：对上游公网（如有）+ 允许内网客户端 + 本地基准
    return (
      PUBLIC_NTP.map((s) => `server ${s} iburst`).join('\n') +
      '\nlocal stratum 10\nallow all\ndriftfile /var/lib/chrony/drift\nmakestep 1.0 3\nrtcsync\n'
    )
  }
  // 客户端：指向源机
  return `server ${sourceIp} iburst prefer\ndriftfile /var/lib/chrony/drift\nmakestep 1.0 3\nrtcsync\n`
}

async function startChronyService(ctx: NodeRunCtx): Promise<void> {
  // Ubuntu 服务名 chrony；RHEL 为 chronyd —— 都试一遍
  await execLogged(ctx, 'systemctl enable --now chrony 2>/dev/null || systemctl enable --now chronyd 2>/dev/null || true', { sudo: true })
  await execLogged(ctx, 'systemctl restart chrony 2>/dev/null || systemctl restart chronyd 2>/dev/null || true', { sudo: true })
}

export async function runStep3(
  runId: string,
  nodes: NodeConfig[],
  plan: TimePlan,
  params: Step3Params
): Promise<NodeTaskResult[]> {
  const sourceNode = nodes.find((n) => n.id === plan.sourceNodeId)

  return runStep(runId, nodes, async (ctx) => {
    // 1) 时区
    ctx.log(`设置时区: ${params.timezone}`)
    await execLogged(ctx, `timedatectl set-timezone '${params.timezone}'`, { sudo: true })

    // 2) 探测 chrony
    const det = await ctx.client.exec(DETECT_CHRONY, { timeoutMs: 10000 })
    const conf = /CONF=(.*)/.exec(det.stdout)?.[1]?.trim() || ''
    const hasBin = /HASBIN=(\d)/.exec(det.stdout)?.[1] === '1'

    if (hasBin && conf) {
      // 决定本节点角色
      let role: 'public' | 'source' | 'client'
      if (plan.strategy === 'all-online') role = 'public'
      else if (ctx.node.id === plan.sourceNodeId) role = 'source'
      else role = 'client'

      const content = buildChronyConf(role, sourceNode?.ip)
      ctx.log(`配置 chrony (${role}) → ${conf}`)
      const write = [
        `cp ${conf} ${conf}.deploytool.bak 2>/dev/null || true`,
        `cat > ${conf} <<'DEPLOYEOF'`,
        content,
        `DEPLOYEOF`
      ].join('\n')
      await execLogged(ctx, write, { sudo: true })
      await startChronyService(ctx)
      await execLogged(ctx, 'chronyc makestep 2>/dev/null || true', { sudo: true })
      const tr = await execLogged(ctx, 'chronyc tracking 2>/dev/null | head -5 || true', { sudo: true })
      ctx.log('chrony 状态已回读')
      void tr
    } else {
      // 退化方案：以源机时间对齐（§7 步骤3 兜底）
      ctx.log('未检测到 chrony，使用 date 退化对齐')
      if (ctx.node.id !== plan.sourceNodeId && sourceNode) {
        const src = await sshPool.acquire(sourceNode)
        const { stdout } = await src.exec('date +%s', { timeoutMs: 8000 })
        const epoch = parseInt(stdout.trim(), 10)
        if (epoch > 0) {
          await execLogged(ctx, `date -s '@${epoch}' && hwclock -w 2>/dev/null || true`, { sudo: true })
        }
      } else {
        await execLogged(ctx, 'hwclock -w 2>/dev/null || true', { sudo: true })
      }
    }

    const now = await ctx.client.exec('date "+%Y-%m-%d %H:%M:%S %z"', { timeoutMs: 8000 })
    ctx.log(`当前时间: ${now.stdout.trim()}`)
    ctx.log('✓ 完成')
  })
}
