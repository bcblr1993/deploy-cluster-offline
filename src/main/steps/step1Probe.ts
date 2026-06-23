// 步骤1：连接检测 + 环境探测（设计文档 §7 步骤1）。
// M1 即落地，作为打通 SSH↔IPC↔UI 的端到端验证。

import { SshClient } from '../ssh/SshClient'
import { resolveAdapter } from '../os/OsAdapter'
import { CONNECTIVITY_SNIPPET } from './connectivity'
import type { Arch, NodeConfig, NodeProbe, Privilege } from '@shared/types'

const PROBE_SCRIPT = [
  'echo "ARCH=$(uname -m)"',
  '. /etc/os-release 2>/dev/null; echo "OSID=${ID}"; echo "OSPRETTY=${PRETTY_NAME}"',
  '[ -d /run/systemd/system ] && echo "SYSTEMD=1" || echo "SYSTEMD=0"',
  'echo "UID=$(id -u)"',
  '(sudo -n true 2>/dev/null && echo "SUDO=1") || echo "SUDO=0"',
  '(command -v docker >/dev/null 2>&1 && echo "DOCKER=1") || echo "DOCKER=0"',
  // 外网连通性：公网 DNS TCP/53 + 域名 TCP/443（修正：不能用 UDP 的 NTP 123 走 /dev/tcp）
  CONNECTIVITY_SNIPPET
].join('; ')

function parseArch(raw: string): Arch {
  if (raw === 'x86_64') return 'x86_64'
  if (raw === 'aarch64' || raw === 'arm64') return 'aarch64'
  return 'unknown'
}

export async function probeNode(node: NodeConfig): Promise<NodeProbe> {
  const client = new SshClient(node)
  try {
    await client.connect()
  } catch (e) {
    return {
      reachable: false,
      arch: 'unknown',
      hasSystemd: false,
      privilege: 'none',
      dockerInstalled: false,
      online: false,
      supported: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }

  try {
    const { stdout } = await client.exec(PROBE_SCRIPT, { timeoutMs: 15000 })
    const kv = new Map<string, string>()
    for (const line of stdout.split('\n')) {
      const idx = line.indexOf('=')
      if (idx > 0) kv.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim())
    }

    const arch = parseArch(kv.get('ARCH') ?? '')
    const uid = kv.get('UID')
    const privilege: Privilege =
      uid === '0' ? 'root' : kv.get('SUDO') === '1' ? 'sudo' : 'none'
    const osId = kv.get('OSID') || undefined
    const adapter = resolveAdapter({ osId })

    const hasSystemd = kv.get('SYSTEMD') === '1'
    // 本期支持判定：x86_64 + systemd + 有适配器 + 有权限
    const supported =
      arch === 'x86_64' && hasSystemd && !!adapter && privilege !== 'none'

    return {
      reachable: true,
      arch,
      osId,
      osPretty: kv.get('OSPRETTY') || undefined,
      hasSystemd,
      privilege,
      dockerInstalled: kv.get('DOCKER') === '1',
      online: kv.get('ONLINE') === 'OK',
      adapterId: adapter?.id,
      supported
    }
  } finally {
    client.dispose()
  }
}
