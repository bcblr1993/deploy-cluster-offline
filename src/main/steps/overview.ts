// 运维总览 + 一键全卸载（设计 docs/01-20260623-…）。
// 状态探测以真实 docker ps 为准；一键全卸载只动本工具管理的服务，外部容器只读。

import { runStep, execLogged } from '../orchestrator/runStep'
import { sshPool } from '../ssh/SshPool'
import { CATALOG } from '../services/catalog'
import type {
  ActionPlan,
  ContainerInfo,
  NodeConfig,
  NodeStatus,
  NodeTaskResult,
  ServiceId,
  ServiceMeta,
  UninstallAllParams
} from '@shared/types'

// 容器名 → 服务（本工具部署的容器命名约定）
const CONTAINER_TO_SERVICE: Record<string, ServiceId> = {
  postgres: 'postgres',
  redis: 'redis',
  kafka: 'kafka',
  cassandra: 'cassandra',
  iotcloud: 'iotcloud',
  netdata: 'netdata',
  'wechat-messenger-container': 'wechat-messenger'
}

// 卸载顺序：按 tier 倒序（应用层先停，存储层后停）
const SERVICES_REVERSED: ServiceId[] = (Object.values(CATALOG) as ServiceMeta[])
  .sort((a, b) => b.tier - a.tier)
  .map((m) => m.id)

const META_SCRIPT = [
  'echo "HOST=$(hostname)"',
  '. /etc/os-release 2>/dev/null; echo "OS=${PRETTY_NAME}"',
  'echo "ARCH=$(uname -m)"',
  'echo "DOCKER=$(systemctl is-active docker 2>/dev/null)"',
  'echo "LOAD=$(cat /proc/loadavg 2>/dev/null | awk \'{print $1}\')"',
  'echo "ROOT=$(df -P / 2>/dev/null | tail -1 | awk \'{print $5}\')"'
].join('; ')

function parseState(status: string): ContainerInfo['state'] {
  if (status.startsWith('Up')) return 'running'
  if (status.startsWith('Exited')) return 'exited'
  if (status.startsWith('Restarting')) return 'restarting'
  return 'unknown'
}

function parseContainers(out: string): ContainerInfo[] {
  const list: ContainerInfo[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [name, status = '', ports = ''] = line.split('|')
    if (!name) continue
    list.push({
      name,
      service: CONTAINER_TO_SERVICE[name],
      status,
      state: parseState(status),
      ports: ports.trim() || undefined
    })
  }
  return list
}

async function probeOneNode(node: NodeConfig): Promise<NodeStatus> {
  try {
    const client = await sshPool.acquire(node)
    const meta = await client.exec(META_SCRIPT, { timeoutMs: 12000 })
    const kv = new Map<string, string>()
    for (const l of meta.stdout.split('\n')) {
      const i = l.indexOf('=')
      if (i > 0) kv.set(l.slice(0, i).trim(), l.slice(i + 1).trim())
    }
    const dockerActive = kv.get('DOCKER') === 'active'

    let containers: ContainerInfo[] = []
    if (dockerActive) {
      const ps = await client.execSudo(
        "docker ps -a --format '{{.Names}}|{{.Status}}|{{.Ports}}'",
        { timeoutMs: 15000 }
      )
      containers = parseContainers(ps.stdout)
    }

    const load1 = parseFloat(kv.get('LOAD') ?? '')
    const root = parseInt((kv.get('ROOT') ?? '').replace('%', ''), 10)
    return {
      reachable: true,
      hostname: kv.get('HOST') || undefined,
      osPretty: kv.get('OS') || undefined,
      arch: kv.get('ARCH') || undefined,
      dockerActive,
      load1: Number.isNaN(load1) ? undefined : load1,
      rootUsedPercent: Number.isNaN(root) ? undefined : root,
      containers
    }
  } catch (e) {
    return {
      reachable: false,
      dockerActive: false,
      containers: [],
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

export async function probeOverview(nodes: NodeConfig[]): Promise<Record<string, NodeStatus>> {
  const out: Record<string, NodeStatus> = {}
  await Promise.all(
    nodes.map(async (n) => {
      out[n.id] = await probeOneNode(n)
    })
  )
  return out
}

/** §15 危险计划：列出每节点将卸载的「本工具」服务（外部容器不计） */
export async function planUninstallAll(
  nodes: NodeConfig[],
  params: UninstallAllParams
): Promise<ActionPlan> {
  const status = await probeOverview(nodes)
  const items = nodes
    .map((n) => {
      const st = status[n.id]
      if (!st?.reachable) {
        return { nodeId: n.id, summary: `${n.ip}：不可连，将跳过`, affects: ['(跳过)'] }
      }
      const managed = st.containers.filter((c) => c.service).map((c) => c.name)
      return {
        nodeId: n.id,
        summary: `${n.ip}：卸载 ${managed.length ? managed.join(', ') : '(无本工具服务)'}`,
        affects: ['docker-compose down', params.deleteData ? '删除数据目录' : '保留数据'],
        destructive: params.deleteData ? managed.map((m) => `${m} 的数据`) : undefined
      }
    })
  return {
    stepId: 'overview-uninstall',
    level: 'danger',
    items,
    requireKeyword: 'UNINSTALL-ALL',
    preview: params.deleteData
      ? '将停止并移除所有本工具部署的服务，并删除其数据目录（不可恢复）。外部容器不受影响。'
      : '将停止并移除所有本工具部署的服务，保留数据目录。外部容器不受影响。'
  }
}

export async function uninstallAll(
  runId: string,
  nodes: NodeConfig[],
  params: UninstallAllParams
): Promise<NodeTaskResult[]> {
  const flag = params.deleteData ? '-v' : ''

  return runStep(runId, nodes, async (ctx) => {
    const home = (await ctx.client.exec('echo $HOME', { timeoutMs: 8000 })).stdout.trim() || '/root'
    let any = false
    for (const svc of SERVICES_REVERSED) {
      const dir = `${home}/sprixin-iotcloud/services/${svc}`
      const rm = params.deleteData ? `rm -rf '${dir}';` : ''
      const script = `if [ -d '${dir}' ]; then echo '__HIT__'; cd '${dir}' && docker-compose down ${flag} 2>&1 | tail -3; ${rm} fi`
      const r = await execLogged(ctx, script, { sudo: true, timeoutMs: 120000 })
      if (r.stdout.includes('__HIT__')) {
        any = true
        ctx.log(`[${svc}] 已卸载${params.deleteData ? '（含数据）' : ''}`)
      }
    }
    if (!any) ctx.log('该节点无本工具部署的服务，跳过')
    ctx.log('✓ 完成')
  })
}
