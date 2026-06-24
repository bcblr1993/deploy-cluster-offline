// 工程持久化 + 凭据加密（设计文档 §8、§12）。
// 非敏感数据（拓扑/主机名/进度）存普通 JSON；密码经 safeStorage 加密后单独存，
// 明文绝不落盘。safeStorage 底层走 macOS Keychain / Win DPAPI / Linux libsecret。

import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import type { Cluster, ClusterProject, ClusterSummary, NodeConfig } from '@shared/types'

interface PersistedNode extends Omit<NodeConfig, 'password'> {
  /** 加密后的密码，带算法前缀：`enc:`(safeStorage) 或 `b64:`(不可用时的兜底混淆) */
  encPassword?: string
}
interface PersistedProject {
  name: string
  nodes: PersistedNode[]
  packages: ClusterProject['packages']
  stepState: ClusterProject['stepState']
}

export interface SaveResult {
  ok: boolean
  encryptionAvailable: boolean
}

function projectsDir(): string {
  return join(app.getPath('userData'), 'projects')
}
function projectFile(name = 'default'): string {
  return join(projectsDir(), `${name}.json`)
}

function encryptPassword(pwd?: string): string | undefined {
  if (!pwd) return undefined
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(pwd).toString('base64')
  }
  // 兜底：仅 base64 混淆（不安全），用于无 keyring 的极端环境，UI 会提示
  return 'b64:' + Buffer.from(pwd, 'utf8').toString('base64')
}

function decryptPassword(s?: string): string | undefined {
  if (!s) return undefined
  if (s.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'))
    } catch {
      return undefined
    }
  }
  if (s.startsWith('b64:')) {
    return Buffer.from(s.slice(4), 'base64').toString('utf8')
  }
  return undefined
}

export async function loadProject(name = 'default'): Promise<ClusterProject | null> {
  try {
    const raw = await fs.readFile(projectFile(name), 'utf8')
    const p = JSON.parse(raw) as PersistedProject
    const nodes: NodeConfig[] = p.nodes.map(({ encPassword, ...rest }) => ({
      ...rest,
      password: decryptPassword(encPassword)
    }))
    return { name: p.name, nodes, packages: p.packages ?? [], stepState: p.stepState ?? {} }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

export async function saveProject(project: ClusterProject): Promise<SaveResult> {
  await fs.mkdir(projectsDir(), { recursive: true })
  const persisted: PersistedProject = {
    name: project.name,
    nodes: project.nodes.map(({ password, ...rest }) => ({
      ...rest,
      encPassword: encryptPassword(password)
    })),
    packages: project.packages,
    stepState: project.stepState
  }
  await fs.writeFile(projectFile(project.name), JSON.stringify(persisted, null, 2), 'utf8')
  return { ok: true, encryptionAvailable: safeStorage.isEncryptionAvailable() }
}

// ───────── 多集群（docs/06） ─────────

interface PersistedCluster {
  id: string
  name: string
  remark?: string
  createdAt: string
  updatedAt: string
  nodes: PersistedNode[]
  packages: Cluster['packages']
  stepState: Cluster['stepState']
}

function clustersDir(): string {
  return join(app.getPath('userData'), 'clusters')
}
function clusterFile(id: string): string {
  return join(clustersDir(), `${id}.json`)
}

function toCluster(p: PersistedCluster): Cluster {
  return {
    id: p.id,
    name: p.name,
    remark: p.remark,
    nodes: p.nodes.map(({ encPassword, ...rest }) => ({
      ...rest,
      password: decryptPassword(encPassword)
    })),
    packages: p.packages ?? [],
    stepState: p.stepState ?? {},
    createdAt: p.createdAt,
    updatedAt: p.updatedAt
  }
}

function toPersisted(c: Cluster): PersistedCluster {
  return {
    id: c.id,
    name: c.name,
    remark: c.remark,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    nodes: c.nodes.map(({ password, ...rest }) => ({
      ...rest,
      encPassword: encryptPassword(password)
    })),
    packages: c.packages,
    stepState: c.stepState
  }
}

async function readAllClusters(): Promise<PersistedCluster[]> {
  let files: string[]
  try {
    files = await fs.readdir(clustersDir())
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
  const out: PersistedCluster[] = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      out.push(JSON.parse(await fs.readFile(join(clustersDir(), f), 'utf8')))
    } catch {
      /* 跳过损坏文件 */
    }
  }
  return out
}

export async function listClusters(): Promise<ClusterSummary[]> {
  await migrateLegacyIfNeeded()
  const all = await readAllClusters()
  return all
    .map((p) => ({
      id: p.id,
      name: p.name,
      remark: p.remark,
      nodeCount: p.nodes?.length ?? 0,
      ips: (p.nodes ?? []).map((n) => n.ip).filter(Boolean),
      deployed: Array.isArray((p.stepState as { placements?: unknown[] })?.placements)
        ? ((p.stepState as { placements?: unknown[] }).placements?.length ?? 0) > 0
        : false,
      updatedAt: p.updatedAt
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function loadCluster(id: string): Promise<Cluster | null> {
  try {
    const raw = await fs.readFile(clusterFile(id), 'utf8')
    return toCluster(JSON.parse(raw) as PersistedCluster)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

export async function saveCluster(cluster: Cluster): Promise<SaveResult> {
  await fs.mkdir(clustersDir(), { recursive: true })
  const persisted = toPersisted({ ...cluster, updatedAt: new Date().toISOString() })
  await fs.writeFile(clusterFile(cluster.id), JSON.stringify(persisted, null, 2), 'utf8')
  return { ok: true, encryptionAvailable: safeStorage.isEncryptionAvailable() }
}

export async function createCluster(name: string, remark?: string): Promise<Cluster> {
  const now = new Date().toISOString()
  const cluster: Cluster = {
    id: randomUUID(),
    name,
    remark,
    nodes: [],
    packages: [],
    stepState: {},
    createdAt: now,
    updatedAt: now
  }
  await saveCluster(cluster)
  return cluster
}

export async function renameCluster(id: string, name: string, remark?: string): Promise<void> {
  const c = await loadCluster(id)
  if (!c) throw new Error('集群不存在')
  await saveCluster({ ...c, name, remark })
}

export async function deleteCluster(id: string): Promise<void> {
  // 仅删本地配置文件，不触碰远端（docs/06 §14-3）
  await fs.rm(clusterFile(id), { force: true })
}

/** 旧 projects/default.json 迁移为一个「默认集群」（仅当 clusters/ 为空时，幂等） */
async function migrateLegacyIfNeeded(): Promise<void> {
  const existing = await readAllClusters()
  if (existing.length > 0) return
  const legacy = await loadProject('default')
  if (!legacy || legacy.nodes.length === 0) return
  const now = new Date().toISOString()
  await saveCluster({
    id: randomUUID(),
    name: legacy.name && legacy.name !== 'default' ? legacy.name : '默认集群',
    nodes: legacy.nodes,
    packages: legacy.packages,
    stepState: legacy.stepState,
    createdAt: now,
    updatedAt: now
  })
}
