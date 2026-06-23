// SSH 连接池：按 nodeId 复用连接，供编排引擎并发调度（设计文档 §4.2）。

import { SshClient } from './SshClient'
import type { NodeConfig } from '@shared/types'

export class SshPool {
  private clients = new Map<string, SshClient>()

  /** 获取（或新建并连接）某节点的连接 */
  async acquire(node: NodeConfig): Promise<SshClient> {
    const existing = this.clients.get(node.id)
    if (existing && existing.isConnected) return existing

    const client = new SshClient(node)
    await client.connect()
    this.clients.set(node.id, client)
    return client
  }

  /** 一次性连接测试，立即释放（步骤1 检测用） */
  async testConnect(node: NodeConfig): Promise<void> {
    const client = new SshClient(node)
    try {
      await client.connect()
    } finally {
      client.dispose()
    }
  }

  release(nodeId: string): void {
    const c = this.clients.get(nodeId)
    if (c) {
      c.dispose()
      this.clients.delete(nodeId)
    }
  }

  disposeAll(): void {
    for (const c of this.clients.values()) c.dispose()
    this.clients.clear()
  }
}

export const sshPool = new SshPool()
