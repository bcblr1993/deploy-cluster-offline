// 通用步骤执行器（设计文档 §4.3）：对一批节点并发执行，失败隔离，
// 统一发出 status/log/progress 事件，返回每节点结果。

import { emitRunEvent } from '../ipc/emit'
import { sshPool } from '../ssh/SshPool'
import type { SshClient } from '../ssh/SshClient'
import type { NodeConfig, NodeTaskResult, RunEvent, TaskStatus } from '@shared/types'

export interface NodeRunCtx {
  node: NodeConfig
  client: SshClient
  log: (line: string, stream?: 'stdout' | 'stderr') => void
  progress: (percent: number) => void
}

export type PerNodeFn = (ctx: NodeRunCtx) => Promise<void>

export interface RunStepOptions {
  /** 串行执行（cassandra 集群 bootstrap 等需要） */
  serial?: boolean
}

function emit(e: RunEvent): void {
  emitRunEvent(e)
}

async function runOne(
  runId: string,
  node: NodeConfig,
  fn: PerNodeFn
): Promise<NodeTaskResult> {
  const logs: string[] = []
  const setStatus = (status: TaskStatus): void =>
    emit({ runId, nodeId: node.id, kind: 'status', status })

  setStatus('running')
  try {
    const client = await sshPool.acquire(node)
    const ctx: NodeRunCtx = {
      node,
      client,
      log: (line, stream) => {
        logs.push(line)
        emit({ runId, nodeId: node.id, kind: 'log', line, stream })
      },
      progress: (percent) => emit({ runId, nodeId: node.id, kind: 'progress', percent })
    }
    await fn(ctx)
    setStatus('success')
    return { nodeId: node.id, status: 'success', logs }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    emit({ runId, nodeId: node.id, kind: 'log', line: `✗ ${error}`, stream: 'stderr' })
    setStatus('failed')
    return { nodeId: node.id, status: 'failed', logs, error }
  }
}

export async function runStep(
  runId: string,
  nodes: NodeConfig[],
  fn: PerNodeFn,
  opts: RunStepOptions = {}
): Promise<NodeTaskResult[]> {
  if (opts.serial) {
    const results: NodeTaskResult[] = []
    for (const node of nodes) results.push(await runOne(runId, node, fn))
    return results
  }
  return Promise.all(nodes.map((node) => runOne(runId, node, fn)))
}

/** 远程执行一条命令并把输出实时 log 出去；返回退出码与聚合输出 */
export async function execLogged(
  ctx: NodeRunCtx,
  command: string,
  opts: { sudo?: boolean; timeoutMs?: number } = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const runner = opts.sudo ? ctx.client.execSudo.bind(ctx.client) : ctx.client.exec.bind(ctx.client)
  return runner(command, {
    timeoutMs: opts.timeoutMs ?? 60000,
    onData: (chunk, stream) => {
      for (const line of chunk.split('\n')) {
        const t = line.trimEnd()
        if (t) ctx.log(t, stream)
      }
    }
  })
}
