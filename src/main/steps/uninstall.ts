// 一键卸载（设计文档 §20）：按服务/节点粒度，倒序停止，默认保留数据卷。

import { emitRunEvent } from '../ipc/emit'
import { sshPool } from '../ssh/SshPool'
import { renderDeployment } from '../services/render'
import type {
  ActionPlan,
  NodeConfig,
  NodeTaskResult,
  RenderedInstance,
  UninstallParams
} from '@shared/types'

export function planUninstall(params: UninstallParams, nodes: NodeConfig[]): ActionPlan {
  const preview = renderDeployment(params.placements, nodes)
  const byNode = new Map<string, RenderedInstance[]>()
  for (const inst of preview.instances) {
    if (!byNode.has(inst.nodeId)) byNode.set(inst.nodeId, [])
    byNode.get(inst.nodeId)!.push(inst)
  }
  return {
    stepId: 'uninstall',
    level: 'danger',
    items: [...byNode.entries()].map(([nodeId, list]) => ({
      nodeId,
      summary: `卸载：${list.map((i) => i.service).join(', ')}`,
      affects: ['docker-compose down', params.deleteData ? '删除数据卷' : '保留数据卷'],
      destructive: params.deleteData
        ? list.map((i) => `${i.service} 的数据卷`)
        : undefined
    })),
    requireKeyword: params.deleteData ? 'UNINSTALL' : undefined,
    preview: params.deleteData
      ? '将停止并移除容器，并删除数据卷（不可恢复）。'
      : '将停止并移除容器，保留数据卷。'
  }
}

export async function runUninstall(
  runId: string,
  nodes: NodeConfig[],
  params: UninstallParams
): Promise<NodeTaskResult[]> {
  const preview = renderDeployment(params.placements, nodes)
  const involved = [...new Set(preview.instances.map((i) => i.nodeId))]
  const results = new Map<string, NodeTaskResult>()
  for (const id of involved) {
    results.set(id, { nodeId: id, status: 'running', logs: [] })
    emitRunEvent({ runId, nodeId: id, kind: 'status', status: 'running' })
  }

  const nodeById = (id: string): NodeConfig => nodes.find((n) => n.id === id)!
  const downFlag = params.deleteData ? '-v' : ''

  // 倒序：应用层先停，存储层后停（§20.2）
  const reversed = [...preview.order].reverse()
  try {
    for (const tier of reversed) {
      for (const instId of tier) {
        const inst = preview.instances.find((i) => i.instanceId === instId)!
        const client = await sshPool.acquire(nodeById(inst.nodeId))
        emitRunEvent({
          runId,
          nodeId: inst.nodeId,
          kind: 'log',
          line: `[${inst.service}] docker-compose down ${downFlag}`
        })
        await client.execSudo(
          `cd '${inst.remoteDir}' 2>/dev/null && docker-compose down ${downFlag} || echo '已不存在，跳过'`,
          { timeoutMs: 120000 }
        )
      }
    }
    for (const id of involved) {
      const r = results.get(id)!
      r.status = 'success'
      emitRunEvent({ runId, nodeId: id, kind: 'status', status: 'success' })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    for (const id of involved) {
      const r = results.get(id)!
      if (r.status === 'running') {
        r.status = 'failed'
        r.error = msg
        emitRunEvent({ runId, nodeId: id, kind: 'status', status: 'failed' })
      }
    }
  }
  return [...results.values()]
}
