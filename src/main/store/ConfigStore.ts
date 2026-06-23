// 工程持久化 + 凭据加密（设计文档 §8、§12）。
// 非敏感数据（拓扑/主机名/进度）存普通 JSON；密码经 safeStorage 加密后单独存，
// 明文绝不落盘。safeStorage 底层走 macOS Keychain / Win DPAPI / Linux libsecret。

import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { ClusterProject, NodeConfig } from '@shared/types'

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
