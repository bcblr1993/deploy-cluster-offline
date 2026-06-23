// 并发任务编排引擎骨架（设计文档 §4.3）。
// M1 仅占位定义；M2+ 接入各步骤的并发执行、失败隔离、事件流。

import type { NodeConfig, NodeTaskResult } from '@shared/types'

export type NodeTaskFn = (node: NodeConfig) => Promise<void>

export interface RunOptions {
  /** 并发上限，默认全并发 */
  concurrency?: number
}

/** 对一批节点并发执行同一任务，失败隔离，返回每节点结果 */
export async function runOnNodes(
  nodes: NodeConfig[],
  task: NodeTaskFn,
  _opts: RunOptions = {}
): Promise<NodeTaskResult[]> {
  const results = await Promise.all(
    nodes.map(async (node): Promise<NodeTaskResult> => {
      try {
        await task(node)
        return { nodeId: node.id, status: 'success', logs: [] }
      } catch (e) {
        return {
          nodeId: node.id,
          status: 'failed',
          logs: [],
          error: e instanceof Error ? e.message : String(e)
        }
      }
    })
  )
  return results
}
