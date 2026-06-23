// 节点配置导入导出（密码口令加密，设计 docs/05）。
// scrypt 派生密钥 + AES-256-GCM，可移植到其它机器（导入输入同口令即可解密）。

import { dialog } from 'electron'
import { promises as fs } from 'fs'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import type { NodeConfig } from '@shared/types'

const FORMAT = 'deploy-cluster-offline/nodes'

function encryptPassword(plain: string, passphrase: string): string {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(passphrase, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    'v1',
    salt.toString('base64'),
    iv.toString('base64'),
    tag.toString('base64'),
    enc.toString('base64')
  ].join(':')
}

function decryptPassword(token: string, passphrase: string): string {
  const [v, s, i, t, e] = token.split(':')
  if (v !== 'v1') throw new Error('密码密文格式不支持')
  const key = scryptSync(passphrase, Buffer.from(s, 'base64'), 32)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(i, 'base64'))
  decipher.setAuthTag(Buffer.from(t, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(e, 'base64')), decipher.final()]).toString(
    'utf8'
  )
}

/** 导出：保存对话框 + 加密写文件，返回路径或 null（取消） */
export async function exportNodes(nodes: NodeConfig[], passphrase: string): Promise<string | null> {
  const r = await dialog.showSaveDialog({
    title: '导出节点配置',
    defaultPath: 'nodes-export.json',
    filters: [{ name: '节点配置', extensions: ['json'] }]
  })
  if (r.canceled || !r.filePath) return null
  const data = {
    format: FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    enc: 'scrypt-aes-256-gcm',
    nodes: nodes.map((n) => ({
      ip: n.ip,
      port: n.port,
      username: n.username,
      hostname: n.hostname,
      remark: n.remark,
      password: n.password ? encryptPassword(n.password, passphrase) : ''
    }))
  }
  await fs.writeFile(r.filePath, JSON.stringify(data, null, 2), 'utf8')
  return r.filePath
}

/** 导入第一步：选文件，返回路径或 null */
export async function importPick(): Promise<string | null> {
  const r = await dialog.showOpenDialog({
    title: '导入节点配置',
    properties: ['openFile'],
    filters: [{ name: '节点配置', extensions: ['json'] }]
  })
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
}

/** 导入第二步：读取+校验+解密，返回 NodeConfig[]（口令错/格式错抛错） */
export async function importDecrypt(path: string, passphrase: string): Promise<NodeConfig[]> {
  const raw = await fs.readFile(path, 'utf8')
  let data: { format?: string; nodes?: unknown[] }
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  if (data.format !== FORMAT || !Array.isArray(data.nodes)) {
    throw new Error('不是有效的节点配置文件')
  }
  try {
    return (data.nodes as Record<string, unknown>[]).map((n, i) => ({
      id: `imp${Date.now()}-${i}`,
      ip: String(n.ip ?? ''),
      port: Number(n.port ?? 22),
      username: String(n.username ?? 'root'),
      hostname: n.hostname ? String(n.hostname) : undefined,
      remark: n.remark ? String(n.remark) : undefined,
      password: n.password ? decryptPassword(String(n.password), passphrase) : ''
    }))
  } catch {
    throw new Error('口令错误或文件已损坏')
  }
}
