// 外网连通性探测（步骤1/3 共用）。
// 注意：不能用 NTP 123 端口测 —— /dev/tcp 只能测 TCP，而 NTP 是 UDP。
// 改用公网 DNS 的 TCP/53（公共解析器均支持 TCP 53）+ 一个域名 TCP/443 兼测 DNS。

import { sshPool } from '../ssh/SshPool'
import type { NodeConfig } from '@shared/types'

/** 在远端 shell 内执行并输出 `ONLINE=OK` / `ONLINE=NO`（自包含、可与其它命令用 ; 串联） */
export const CONNECTIVITY_SNIPPET =
  'ONLINE=NO; for t in 223.5.5.5/53 114.114.114.114/53 119.29.29.29/53 www.baidu.com/443; do ' +
  'timeout 2 bash -c "exec 3<>/dev/tcp/$t" 2>/dev/null && { ONLINE=OK; break; }; done; ' +
  'echo "ONLINE=$ONLINE"'

export async function checkOnline(node: NodeConfig): Promise<boolean> {
  try {
    const client = await sshPool.acquire(node)
    const { stdout } = await client.exec(CONNECTIVITY_SNIPPET, { timeoutMs: 15000 })
    return /ONLINE=OK/.test(stdout)
  } catch {
    return false
  }
}
