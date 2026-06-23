// 运维总览 + 一键全卸载（设计 docs/01-20260623-…）。
// 状态探测以真实 docker ps 为准；一键全卸载只动本工具管理的服务，外部容器只读。

import { runStep } from '../orchestrator/runStep'
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

// 服务 → 容器名（卸载时按名强删兜底）
const SERVICE_CONTAINER: Record<ServiceId, string> = {
  postgres: 'postgres',
  redis: 'redis',
  kafka: 'kafka',
  cassandra: 'cassandra',
  iotcloud: 'iotcloud',
  netdata: 'netdata',
  'wechat-messenger': 'wechat-messenger-container'
}

// 卸载顺序：按 tier 倒序（应用层先停，存储层后停）
const SERVICES_REVERSED: ServiceId[] = (Object.values(CATALOG) as ServiceMeta[])
  .sort((a, b) => b.tier - a.tier)
  .map((m) => m.id)

// 本工具服务镜像仓库（删镜像用）
const IMAGE_REPOS: string[] = [
  ...new Set((Object.values(CATALOG) as ServiceMeta[]).map((m) => m.image.split(':')[0]))
]

// 彻底卸载 Docker（兼容 apt 预装：含 docker.socket / /lib 下 unit / 启用符号链接）
const REMOVE_DOCKER_SCRIPT = `
systemctl stop docker docker.socket containerd 2>/dev/null || true
systemctl disable docker docker.socket containerd 2>/dev/null || true
if command -v apt-get >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker.io docker-doc docker-compose podman-docker containerd runc 2>/dev/null || true
fi
# 删除各标准位置的 unit 与启用符号链接
rm -f /etc/systemd/system/docker.service /etc/systemd/system/docker.socket
rm -f /lib/systemd/system/docker.service /lib/systemd/system/docker.socket
rm -f /usr/lib/systemd/system/docker.service /usr/lib/systemd/system/docker.socket
rm -f /lib/systemd/system/containerd.service /usr/lib/systemd/system/containerd.service
rm -f /etc/systemd/system/multi-user.target.wants/docker.service
rm -f /etc/systemd/system/sockets.target.wants/docker.socket
# 删除二进制
rm -f /usr/bin/docker /usr/bin/dockerd /usr/bin/docker-compose /usr/bin/containerd /usr/bin/containerd-shim-runc-v2 /usr/bin/runc /usr/bin/ctr /usr/bin/docker-proxy /usr/bin/docker-init /usr/local/bin/docker-compose
# 删除配置与数据（含 apt 默认 /var/lib/docker 与我们的 /root/.docker）
rm -rf /etc/docker /root/.docker /var/lib/docker /var/lib/containerd /run/docker.sock
systemctl daemon-reload 2>/dev/null || true
systemctl reset-failed 2>/dev/null || true
`

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
      const affects = ['docker-compose down', params.deleteData ? '删除数据目录' : '保留数据']
      if (params.deleteImages) affects.push('删除服务镜像')
      if (params.removeInstallDir) affects.push('删除安装目录')
      if (params.removeDocker) affects.push('卸载 Docker 引擎')
      const destructive: string[] = []
      if (params.deleteData) destructive.push(...managed.map((m) => `${m} 的数据`))
      if (params.deleteImages) destructive.push('本工具所有服务镜像')
      if (params.removeInstallDir) destructive.push('安装目录 ~/sprixin-iotcloud')
      if (params.removeDocker) destructive.push('Docker 引擎(二进制/服务/data-root)')
      return {
        nodeId: n.id,
        summary: `${n.ip}：卸载 ${managed.length ? managed.join(', ') : '(无本工具服务)'}`,
        affects,
        destructive: destructive.length ? destructive : undefined
      }
    })
  const extra = [
    params.deleteData ? '删除数据目录' : null,
    params.deleteImages ? '删除服务镜像' : null,
    params.removeInstallDir ? '删除安装目录' : null,
    params.removeDocker ? '卸载 Docker 引擎' : null
  ].filter(Boolean)
  return {
    stepId: 'overview-uninstall',
    level: 'danger',
    items,
    requireKeyword: 'UNINSTALL-ALL',
    preview: `将停止并移除所有本工具部署的服务${
      extra.length ? '，并' + extra.join('、') : '（保留数据/镜像/Docker）'
    }。外部容器不受影响。`
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
      const cname = SERVICE_CONTAINER[svc]

      // 该服务是否存在：有 compose 文件 或 有同名容器
      const hasCompose = (
        await ctx.client.execSudo(`test -f '${dir}/docker-compose.yml' && echo Y || echo N`, {
          timeoutMs: 10000
        })
      ).stdout.includes('Y')
      const hasContainer =
        (
          await ctx.client.execSudo(`docker ps -aq -f 'name=^${cname}$' 2>/dev/null`, {
            timeoutMs: 10000
          })
        ).stdout.trim().length > 0

      if (!hasCompose && !hasContainer) continue
      any = true

      if (hasCompose) {
        ctx.log(`[${svc}] docker-compose down ${flag}`)
        const r = await ctx.client.execSudo(
          `cd '${dir}' && docker-compose down ${flag} 2>&1 | tail -5`,
          { timeoutMs: 120000 }
        )
        for (const line of r.stdout.split('\n')) if (line.trim()) ctx.log(line.trim())
      } else {
        ctx.log(`[${svc}] 容器存在但无 compose，docker rm -f ${cname}`)
        await ctx.client.execSudo(`docker rm -f ${cname} 2>&1 | tail -3`, { timeoutMs: 60000 })
      }

      if (params.deleteData) {
        await ctx.client.execSudo(`rm -rf '${dir}'`, { timeoutMs: 60000 })
      }
      ctx.log(`[${svc}] 已卸载${params.deleteData ? '（含数据）' : ''}`)
    }
    if (!any) ctx.log('该节点无本工具部署的服务')

    // 删除服务镜像（容器已移除后）
    if (params.deleteImages) {
      ctx.log('删除服务镜像 …')
      const script = IMAGE_REPOS.map(
        (r) =>
          `ids=$(docker images -q '${r}' 2>/dev/null); [ -n "$ids" ] && docker rmi -f $ids >/dev/null 2>&1 && echo 'rmi ${r}' || true`
      ).join('; ')
      const r = await ctx.client.execSudo(script, { timeoutMs: 180000 })
      for (const line of r.stdout.split('\n')) if (line.trim()) ctx.log(line.trim())
    }

    // 删除整个安装目录 ~/sprixin-iotcloud
    if (params.removeInstallDir) {
      ctx.log(`删除安装目录 ${home}/sprixin-iotcloud …`)
      await ctx.client.execSudo(`rm -rf '${home}/sprixin-iotcloud'`, { timeoutMs: 120000 })
      ctx.log('安装目录已删除')
    }

    // 卸载 Docker 引擎（最后做，因 rmi 需要 docker 在跑）
    if (params.removeDocker) {
      ctx.log('卸载 Docker 引擎（含 apt 包/socket/数据）…')
      await ctx.client.execSudo(REMOVE_DOCKER_SCRIPT, { timeoutMs: 180000 })
      // 回读验证：systemctl 与 docker 命令都应查不到
      const v = await ctx.client.execSudo(
        'echo -n "unit: "; systemctl list-unit-files 2>/dev/null | grep -c docker; echo -n "bin: "; command -v docker || echo none',
        { timeoutMs: 15000 }
      )
      for (const line of v.stdout.split('\n')) if (line.trim()) ctx.log(line.trim())
      ctx.log('Docker 引擎已卸载')
    }

    ctx.log('✓ 完成')
  })
}
