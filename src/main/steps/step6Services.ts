// 步骤6：服务编排（设计文档 §16/§17）。
// 预览：渲染每实例 compose/.env；部署：写配置→载镜像→分层启动（含 cassandra 串行 + keyspace 预建）。

import { emitRunEvent } from '../ipc/emit'
import { sshPool } from '../ssh/SshPool'
import { renderDeployment } from '../services/render'
import { meta } from '../services/catalog'
import {
  extractIotcloudConf,
  extractImage,
  findImageTar
} from '../package/PackageManager'
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

const REMOTE_SERVICES = '/opt/deploy-tool/services'

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

  try {
    // ── Phase 1: 下发 compose/.env（+ iotcloud conf 原样下发） ──
    for (const nodeId of involved) {
      const node = nodeById(nodeId)
      const client = await sshPool.acquire(node)
      for (const inst of instOnNode(nodeId)) {
        await emitLog(runId, nodeId, `[${inst.service}] 写入 compose`)
        const write = [
          `mkdir -p '${inst.remoteDir}'`,
          `cat > '${inst.remoteDir}/docker-compose.yml' <<'DEPLOYEOF'`,
          inst.compose,
          `DEPLOYEOF`
        ]
        if (inst.env) {
          write.push(`cat > '${inst.remoteDir}/.env' <<'DEPLOYEOF'`, inst.env, `DEPLOYEOF`)
        }
        await client.execSudo(write.join('\n'), { timeoutMs: 30000 })

        // iotcloud: 下发原始 conf（不改 thingsboard.yml）
        if (inst.service === 'iotcloud') {
          const um = await client.exec('uname -m', { timeoutMs: 8000 })
          const confDir = await extractIotcloudConf(archOf(um.stdout.trim()))
          await emitLog(runId, nodeId, '[iotcloud] 上传 conf 目录')
          await client.putDir(`${confDir}/conf`, `${inst.remoteDir}/conf`)
        }
      }
    }

    // ── Phase 2: 载镜像（按节点所需服务，去重） ──
    for (const nodeId of involved) {
      const node = nodeById(nodeId)
      const client = await sshPool.acquire(node)
      const um = await client.exec('uname -m', { timeoutMs: 8000 })
      const arch = archOf(um.stdout.trim())
      const services = [...new Set(instOnNode(nodeId).map((i) => i.service))]
      for (const svc of services) {
        const prefix = meta(svc).imageTarPrefix
        if (!prefix) continue
        const tar = await findImageTar(arch, prefix)
        if (!tar) {
          await emitLog(runId, nodeId, `[${svc}] ⚠ 包内未找到镜像 tar(${prefix})，跳过`)
          continue
        }
        await emitLog(runId, nodeId, `[${svc}] 抽取并上传镜像 ${tar}`)
        const localTar = await extractImage(arch, tar)
        const remoteTar = `/opt/deploy-tool/images/${tar}`
        await client.putFile(localTar, remoteTar)
        await emitLog(runId, nodeId, `[${svc}] docker load`)
        await client.execSudo(`docker load -i '${remoteTar}'`, { timeoutMs: 300000 })
      }
    }

    // ── Phase 3: 分层启动 ──
    for (const tier of preview.order) {
      for (const instId of tier) {
        const inst = preview.instances.find((i) => i.instanceId === instId)!
        const node = nodeById(inst.nodeId)
        const client = await sshPool.acquire(node)

        if (inst.service === 'cassandra' && inst.cluster) {
          // 串行 bootstrap：seed 优先，逐个等待 UN（简化：起后轮询）
          await emitLog(runId, inst.nodeId, `[cassandra] 启动（集群串行）`)
          await client.execSudo(`cd '${inst.remoteDir}' && docker-compose up -d`, {
            timeoutMs: 120000
          })
          await waitCassandraUN(runId, inst, client)
        } else if (inst.service === 'iotcloud') {
          await runIotcloud(runId, inst, client, params, nodes)
        } else {
          await emitLog(runId, inst.nodeId, `[${inst.service}] docker-compose up -d`)
          await client.execSudo(`cd '${inst.remoteDir}' && docker-compose up -d`, {
            timeoutMs: 180000
          })
        }
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

async function runIotcloud(
  runId: string,
  inst: RenderedInstance,
  client: import('../ssh/SshClient').SshClient,
  params: Step6Params,
  nodes: NodeConfig[]
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
  await emitLog(runId, inst.nodeId, '[iotcloud] 初始化（install）…')
  await client.execSudo(
    `cd '${inst.remoteDir}' && docker-compose run --rm iotcloud /bin/bash install.sh 2>&1 | tail -20 || true`,
    { timeoutMs: 600000 }
  )
  await emitLog(runId, inst.nodeId, '[iotcloud] 正式启动 up -d')
  await client.execSudo(`cd '${inst.remoteDir}' && docker-compose up -d`, { timeoutMs: 180000 })
}
