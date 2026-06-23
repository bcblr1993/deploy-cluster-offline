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

/** 原始内容里已存在的 `ip hostname` 组合 */
function existingPairs(hosts: string): Set<string> {
  const set = new Set<string>()
  for (const raw of hosts.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const toks = line.split(/\s+/)
    const ip = toks[0]
    for (const name of toks.slice(1)) set.add(`${ip} ${name}`)
  }
  return set
}

export interface MergedHosts {
  /** 托管块内容（可能为空字符串） */
  block: string
  /** 合并后的完整 /etc/hosts */
  merged: string
  /** 新增条目数 */
  added: number
  /** 因重复被跳过的条目数 */
  skipped: number
}

/**
 * 把集群映射合并进现有 hosts：
 * - 先剥离旧托管块；
 * - 集群条目里凡是原文件已有相同 `ip hostname` 的，跳过不重复加入；
 * - 其余写入新的托管块。
 */
export function buildManagedHosts(existing: string, entries: HostEntry[]): MergedHosts {
  const base = stripManagedBlock(existing).replace(/\n+$/, '')
  const pairs = existingPairs(base)
  const valid = entries.filter((e) => e.ip && e.hostname)
  const filtered = valid.filter((e) => !pairs.has(`${e.ip} ${e.hostname}`))
  const skipped = valid.length - filtered.length
  const block = filtered.length
    ? [HOSTS_BEGIN, ...filtered.map((e) => `${e.ip} ${e.hostname}`), HOSTS_END].join('\n')
    : ''
  const merged = block ? `${base}\n\n${block}\n` : `${base}\n`
  return { block, merged, added: filtered.length, skipped }
}
