// 步骤4：磁盘分区预览（只读，设计文档 §7 步骤4）。

import { sshPool } from '../ssh/SshPool'
import type { DiskInfo, DiskPartition, NodeConfig } from '@shared/types'

// 整盘：NAME SIZE(bytes) ROTA TYPE MODEL；ROTA=0→SSD,1→HDD
const DISK_CMD = 'lsblk -dbno NAME,SIZE,ROTA,TYPE,MODEL'
// 分区树：NAME SIZE(bytes) FSTYPE MOUNTPOINT TYPE
const PART_CMD = 'lsblk -bno NAME,SIZE,FSTYPE,MOUNTPOINT,TYPE'
// 挂载点使用率
const DF_CMD = 'df -B1 --output=target,pcent 2>/dev/null | tail -n +2'

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
  const [disksOut, partsOut, dfOut] = await Promise.all([
    client.exec(DISK_CMD, { timeoutMs: 15000 }).then((r) => r.stdout),
    client.exec(PART_CMD, { timeoutMs: 15000 }).then((r) => r.stdout),
    client.exec(DF_CMD, { timeoutMs: 15000 }).then((r) => r.stdout)
  ])

  const usage = parseDfUsage(dfOut)

  // 整盘
  const disks: DiskInfo[] = []
  for (const line of disksOut.split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 4) continue
    const [name, size, rota, type, ...model] = cols
    if (type !== 'disk') continue
    disks.push({
      name,
      sizeBytes: parseInt(size, 10) || 0,
      type: rota === '0' ? 'SSD' : 'HDD',
      model: model.join(' ') || undefined,
      partitions: []
    })
  }

  // 分区归属到对应整盘（按名字前缀匹配，如 sda1→sda, nvme0n1p1→nvme0n1）
  for (const line of partsOut.split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 2) continue
    const name = cols[0].replace(/^[├└─|`\s]+/, '')
    const type = cols[cols.length - 1]
    if (type !== 'part' && type !== 'lvm') continue
    const sizeBytes = parseInt(cols[1], 10) || 0
    // FSTYPE 与 MOUNTPOINT 在中间，可能缺列
    const mid = cols.slice(2, cols.length - 1)
    const fsType = mid[0] && mid[0] !== '/' && !mid[0].startsWith('/') ? mid[0] : undefined
    const mountpoint = mid.find((c) => c.startsWith('/'))
    const part: DiskPartition = {
      name,
      sizeBytes,
      fsType,
      mountpoint,
      usedPercent: mountpoint ? usage.get(mountpoint) : undefined
    }
    const parent = disks.find((d) => name.startsWith(d.name))
    if (parent) parent.partitions.push(part)
  }

  return disks
}
