// 步骤4：磁盘分区预览（只读，设计文档 §7 步骤4）。
// 用 lsblk -P（KEY="value"）解析，对空字段健壮，能正确显示未挂载磁盘/分区。

import { sshPool } from '../ssh/SshPool'
import type { DiskInfo, DiskPartition, NodeConfig } from '@shared/types'

// 整盘 + 分区一次列出；-b 字节，-P 键值对（空字段也保留）
const LSBLK_CMD =
  'lsblk -b -P -o NAME,SIZE,ROTA,TYPE,FSTYPE,MOUNTPOINT,MODEL'
// 挂载点使用率
const DF_CMD = 'df -B1 --output=target,pcent 2>/dev/null | tail -n +2'

function parseKv(line: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([A-Z][A-Z%_]*)="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) out[m[1]] = m[2]
  return out
}

function parseDfUsage(out: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const line of out.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 2) {
      const pct = parseInt(parts[parts.length - 1].replace('%', ''), 10)
      const target = parts.slice(0, parts.length - 1).join(' ')
      if (!Number.isNaN(pct)) m.set(target, pct)
    }
  }
  return m
}

export async function probeDisks(node: NodeConfig): Promise<DiskInfo[]> {
  const client = await sshPool.acquire(node)
  const [lsblkOut, dfOut] = await Promise.all([
    client.exec(LSBLK_CMD, { timeoutMs: 15000 }).then((r) => r.stdout),
    client.exec(DF_CMD, { timeoutMs: 15000 }).then((r) => r.stdout)
  ])
  const usage = parseDfUsage(dfOut)

  const disks: DiskInfo[] = []
  const pending: { parentHint: string; part: DiskPartition }[] = []

  for (const line of lsblkOut.split('\n')) {
    if (!line.trim()) continue
    const kv = parseKv(line)
    const name = kv.NAME
    const type = kv.TYPE
    if (!name) continue

    if (type === 'disk') {
      disks.push({
        name,
        sizeBytes: parseInt(kv.SIZE, 10) || 0,
        type: kv.ROTA === '0' ? 'SSD' : 'HDD',
        model: kv.MODEL?.trim() || undefined,
        partitions: []
      })
    } else if (type === 'part' || type === 'lvm' || type === 'crypt') {
      const mountpoint = kv.MOUNTPOINT || undefined
      pending.push({
        parentHint: name,
        part: {
          name,
          sizeBytes: parseInt(kv.SIZE, 10) || 0,
          fsType: kv.FSTYPE || undefined,
          mountpoint,
          usedPercent: mountpoint ? usage.get(mountpoint) : undefined
        }
      })
    }
  }

  // 分区归属到整盘（按名字前缀，如 sda1→sda、nvme0n1p2→nvme0n1）
  for (const { parentHint, part } of pending) {
    const parent =
      disks.find((d) => parentHint.startsWith(d.name)) ??
      // lvm/crypt 等无法前缀匹配的，挂到第一块盘下兜底展示，避免“消失”
      disks[0]
    if (parent) parent.partitions.push(part)
  }

  return disks
}
