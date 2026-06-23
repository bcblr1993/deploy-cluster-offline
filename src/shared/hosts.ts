// /etc/hosts 合并逻辑（主进程写入 + 渲染进程预览共用，保证一致）。
// 规则：保留机器原有内容；集群映射写入托管标记块；与原有内容重复的 (ip hostname) 不重复添加。

export interface HostEntry {
  ip: string
  hostname: string
}

export const HOSTS_BEGIN = '# === deploy-tool BEGIN ==='
export const HOSTS_END = '# === deploy-tool END ==='

/** 去掉旧的托管块，保留其余原始内容 */
export function stripManagedBlock(hosts: string): string {
  const out: string[] = []
  let inBlock = false
  for (const line of hosts.split('\n')) {
    const t = line.trim()
    if (t === HOSTS_BEGIN) {
      inBlock = true
      continue
    }
    if (t === HOSTS_END) {
      inBlock = false
      continue
    }
    if (!inBlock) out.push(line)
  }
  return out.join('\n')
}

export interface MergedHosts {
  /** 托管块内容 */
  block: string
  /** 合并后的完整 /etc/hosts */
  merged: string
  /** 新增条目数 */
  added: number
  /** 被强制覆盖（移除）的旧冲突条目数 */
  overridden: number
}

/**
 * 把集群映射合并进现有 hosts（强制覆盖、只保留一条）：
 * - 先剥离旧托管块；
 * - 从原文件里移除所有「同 IP 或同主机名」的旧映射行（视为被覆盖，保证每个主机/IP 仅一条）；
 * - 集群条目全部写入新的托管块（权威映射）。
 * 注释与无关条目（如 localhost）保留不动。
 */
export function buildManagedHosts(existing: string, entries: HostEntry[]): MergedHosts {
  const base = stripManagedBlock(existing).replace(/\n+$/, '')
  const valid = entries.filter((e) => e.ip && e.hostname)
  const ips = new Set(valid.map((e) => e.ip))
  const names = new Set(valid.map((e) => e.hostname))

  let overridden = 0
  const kept = base.split('\n').filter((line) => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return true // 保留空行/注释
    const toks = t.split(/\s+/)
    const ip = toks[0]
    const hostnames = toks.slice(1)
    // 命中同 IP 或同主机名 → 旧冲突映射，强制移除
    if (ips.has(ip) || hostnames.some((h) => names.has(h))) {
      overridden++
      return false
    }
    return true
  })

  const baseKept = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')
  const block = [HOSTS_BEGIN, ...valid.map((e) => `${e.ip} ${e.hostname}`), HOSTS_END].join('\n')
  const merged = baseKept ? `${baseKept}\n\n${block}\n` : `${block}\n`
  return { block, merged, added: valid.length, overridden }
}
