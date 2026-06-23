// 步骤6：服务编排（设计文档 §16/§17）。
// 预览：渲染每实例 compose/.env；部署：写配置→载镜像→分层启动（含 cassandra 串行 + keyspace 预建）。

import { emitRunEvent } from '../ipc/emit'
import { sshPool } from '../ssh/SshPool'
import { renderDeployment } from '../services/render'
import { meta } from '../services/catalog'
import { findImageTar } from '../package/PackageManager'
import type {
  ActionPlan,
  Arch,
  DeploymentPreview,
  NodeConfig,
  NodeTaskResult,
  RenderedInstance,
  ServicePlacement,
  Step6Params
} from '@shared/types'

export function previewStep6(
  placements: ServicePlacement[],
  nodes: NodeConfig[]
): DeploymentPreview {
  return renderDeployment(placements, nodes)
}

export function planStep6(
  placements: ServicePlacement[],
  nodes: NodeConfig[]
): ActionPlan {
  const preview = renderDeployment(placements, nodes)
  const byNode = new Map<string, RenderedInstance[]>()
  for (const inst of preview.instances) {
    if (!byNode.has(inst.nodeId)) byNode.set(inst.nodeId, [])
    byNode.get(inst.nodeId)!.push(inst)
  }
  return {
    stepId: 'step6',
    level: 'warning',
    items: [...byNode.entries()].map(([nodeId, list]) => ({
      nodeId,
      summary: `部署：${list.map((i) => i.service).join(', ')}`,
      affects: ['docker load 镜像', 'docker-compose up -d', '占用端口/数据卷']
    })),
    preview:
      preview.warnings.length > 0
        ? `注意：\n${preview.warnings.join('\n')}`
        : '将按依赖分层启动（存储/中间件 → iotcloud → 监控）。'
  }
}

function archOf(raw: string): Arch {
  if (raw === 'x86_64') return 'x86_64'
  if (raw === 'aarch64' || raw === 'arm64') return 'aarch64'
  return 'unknown'
}

async function emitLog(runId: string, nodeId: string, line: string): Promise<void> {
  emitRunEvent({ runId, nodeId, kind: 'log', line })
}

export async function deployStep6(
  runId: string,
  nodes: NodeConfig[],
  params: Step6Params
): Promise<NodeTaskResult[]> {
  const preview = renderDeployment(params.placements, nodes)
  const results = new Map<string, NodeTaskResult>()
  for (const n of nodes) results.set(n.id, { nodeId: n.id, status: 'pending', logs: [] })

  const nodeById = (id: string): NodeConfig => nodes.find((n) => n.id === id)!
  const instOnNode = (nodeId: string): RenderedInstance[] =>
    preview.instances.filter((i) => i.nodeId === nodeId)

  const setStatus = (nodeId: string, status: NodeTaskResult['status']): void => {
    const r = results.get(nodeId)
    if (r) r.status = status
    emitRunEvent({ runId, nodeId, kind: 'status', status })
  }

  // 涉及的节点
  const involved = [...new Set(preview.instances.map((i) => i.nodeId))]
  for (const id of involved) setStatus(id, 'running')

  // 解析每个节点的 home（按登录用户，不走 sudo），部署到 ~/sprixin-iotcloud
  const homeByNode: Record<string, string> = {}
  for (const nodeId of involved) {
    const client = await sshPool.acquire(nodeById(nodeId))
    const h = (await client.exec('echo $HOME', { timeoutMs: 8000 })).stdout.trim()
    homeByNode[nodeId] = h || '/root'
  }
  const baseOf = (nodeId: string): string => `${homeByNode[nodeId]}/sprixin-iotcloud`
  const dirOf = (nodeId: string, service: string): string => `${baseOf(nodeId)}/services/${service}`

  // 粗粒度进度：每节点 = 写配置(实例数) + 载镜像(服务数) + 起服务(实例数)
  const total: Record<string, number> = {}
  const doneCnt: Record<string, number> = {}
  for (const nodeId of involved) {
    const insts = instOnNode(nodeId)
    const svcCount = new Set(insts.map((i) => i.service)).size
    total[nodeId] = insts.length * 2 + svcCount
    doneCnt[nodeId] = 0
  }
  const tick = (nodeId: string): void => {
    doneCnt[nodeId] = (doneCnt[nodeId] ?? 0) + 1
    const pct = total[nodeId] ? Math.min(100, Math.round((doneCnt[nodeId] / total[nodeId]) * 100)) : 0
    emitRunEvent({ runId, nodeId, kind: 'progress', percent: pct })
  }

  try {
    // ── Phase 1: 最小覆盖 + 创建数据目录(chmod 777) ──
    // 整包已在步骤5 解压到 ~/sprixin-iotcloud（含原始 compose/conf）。
    // 只对集群化服务覆盖 compose、对 iotcloud 覆盖 .env，其余沿用原包文件（§02 设计）。
    for (const nodeId of involved) {
      const node = nodeById(nodeId)
      const client = await sshPool.acquire(node)
      for (const inst of instOnNode(nodeId)) {
        const dir = dirOf(nodeId, inst.service)
        const overlayCompose =
          (inst.service === 'kafka' || inst.service === 'cassandra') && inst.cluster
        const overlayEnv = inst.service === 'iotcloud' && !!inst.env

        const write = [`mkdir -p '${dir}'`]
        if (overlayCompose) {
          await emitLog(runId, nodeId, `[${inst.service}] 覆盖集群 compose`)
          write.push(`cat > '${dir}/docker-compose.yml' <<'DEPLOYEOF'`, inst.compose, `DEPLOYEOF`)
        }
        if (overlayEnv) {
          await emitLog(runId, nodeId, `[iotcloud] 写入 .env（注入依赖地址）`)
          write.push(`cat > '${dir}/.env' <<'DEPLOYEOF'`, inst.env as string, `DEPLOYEOF`)
        }
        // 数据/日志目录：mkdir + chmod 777（kafka 等容器以非 root 运行，否则写不进卷）
        for (const c of inst.chmodDirs) {
          const resolved = resolveDir(dir, c)
          write.push(`mkdir -p '${resolved}'`, `chmod 777 '${resolved}'`)
        }
        await client.execSudo(write.join('\n'), { timeoutMs: 30000 })
        if (inst.chmodDirs.length) {
          await emitLog(runId, nodeId, `[${inst.service}] 数据目录已建并 chmod 777`)
        }
        if (!overlayCompose && inst.service !== 'iotcloud') {
          await emitLog(runId, nodeId, `[${inst.service}] 使用原包 compose（未改动）`)
        }
        tick(nodeId)
      }
    }

    // ── Phase 2: 载镜像（镜像已随整包在 ~/sprixin-iotcloud/images，直接 docker load） ──
    for (const nodeId of involved) {
      const node = nodeById(nodeId)
      const client = await sshPool.acquire(node)
      const um = await client.exec('uname -m', { timeoutMs: 8000 })
      const arch = archOf(um.stdout.trim())
      const services = [...new Set(instOnNode(nodeId).map((i) => i.service))]
      for (const svc of services) {
        const prefix = meta(svc).imageTarPrefix
        if (!prefix) {
          tick(nodeId)
          continue
        }
        const tar = await findImageTar(arch, prefix)
        if (!tar) {
          await emitLog(runId, nodeId, `[${svc}] ⚠ 包内未找到镜像 tar(${prefix})，跳过`)
          tick(nodeId)
          continue
        }
        await emitLog(runId, nodeId, `[${svc}] docker load ${tar}`)
        await client.execSudo(`docker load -i '${baseOf(nodeId)}/images/${tar}'`, {
          timeoutMs: 300000
        })
        tick(nodeId)
      }
    }

    // ── Phase 3: 分层启动 ──
    for (const tier of preview.order) {
      for (const instId of tier) {
        const inst = preview.instances.find((i) => i.instanceId === instId)!
        const node = nodeById(inst.nodeId)
        const client = await sshPool.acquire(node)
        const dir = dirOf(inst.nodeId, inst.service)

        if (inst.service === 'cassandra' && inst.cluster) {
          // 串行 bootstrap：seed 优先，逐个等待 UN（简化：起后轮询）
          await emitLog(runId, inst.nodeId, `[cassandra] 启动（集群串行）`)
          await client.execSudo(`cd '${dir}' && docker-compose up -d`, {
            timeoutMs: 120000
          })
          await waitCassandraUN(runId, inst, client)
        } else if (inst.service === 'iotcloud') {
          await runIotcloud(runId, inst, client, params, nodes, dir)
        } else {
          await emitLog(runId, inst.nodeId, `[${inst.service}] docker-compose up -d`)
          await client.execSudo(`cd '${dir}' && docker-compose up -d`, {
            timeoutMs: 180000
          })
        }
        tick(inst.nodeId)
      }
    }

    for (const id of involved) {
      setStatus(id, 'success')
      const r = results.get(id)
      if (r) r.status = 'success'
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    for (const id of involved) {
      const r = results.get(id)
      if (r && r.status === 'running') {
        r.status = 'failed'
        r.error = msg
        setStatus(id, 'failed')
        emitRunEvent({ runId, nodeId: id, kind: 'log', line: `✗ ${msg}`, stream: 'stderr' })
      }
    }
  }

  return [...results.values()]
}

async function waitCassandraUN(
  runId: string,
  inst: RenderedInstance,
  client: import('../ssh/SshClient').SshClient
): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 10000))
    const { stdout } = await client.execSudo(
      `docker exec cassandra nodetool status 2>/dev/null | grep -c '^UN' || echo 0`,
      { timeoutMs: 20000 }
    )
    const up = parseInt(stdout.trim(), 10) || 0
    await emitLog(runId, inst.nodeId, `[cassandra] 就绪节点数 UN=${up}`)
    if (up >= 1) return
  }
  await emitLog(runId, inst.nodeId, `[cassandra] ⚠ 等待 UN 超时，请人工检查`)
}

/** 解析 chmod 目录：相对 ./x → ${base}/x；绝对路径原样 */
function resolveDir(base: string, p: string): string {
  return p.startsWith('/') ? p : `${base}/${p.replace(/^\.\//, '')}`
}

async function runIotcloud(
  runId: string,
  inst: RenderedInstance,
  client: import('../ssh/SshClient').SshClient,
  params: Step6Params,
  nodes: NodeConfig[],
  dir: string
): Promise<void> {
  // cassandra 集群 → 先预建 keyspace RF=3（§17.6），避免 TB 以 RF=1 建库
  const cas = params.placements.filter((p) => p.service === 'cassandra')
  if (cas.length > 1) {
    const seedIp = nodes.find((n) => n.id === cas[0].nodeId)?.ip
    await emitLog(runId, inst.nodeId, '[iotcloud] 预建 cassandra keyspace RF=3')
    const cql = `CREATE KEYSPACE IF NOT EXISTS thingsboard WITH replication = {'class':'NetworkTopologyStrategy','datacenter1':3};`
    await client.execSudo(
      `docker exec cassandra cqlsh ${seedIp} -e "${cql}" 2>/dev/null || true`,
      { timeoutMs: 60000 }
    )
  }
  // 两段式：先 install（初始化 DB schema），再正式启动（§16.7）
  // 两段式：先 docker-compose-install.yml 初始化 DB schema（阻塞），再正式 up -d（与原包 start.sh 一致）
  await emitLog(runId, inst.nodeId, '[iotcloud] 初始化（docker-compose-install.yml）…')
  await client.execSudo(
    `cd '${dir}' && docker-compose -f docker-compose-install.yml up 2>&1 | tail -25 || true`,
    { timeoutMs: 600000 }
  )
  await emitLog(runId, inst.nodeId, '[iotcloud] 正式启动 up -d')
  await client.execSudo(`cd '${dir}' && docker-compose up -d`, { timeoutMs: 180000 })
}
