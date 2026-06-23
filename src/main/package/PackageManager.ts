// 安装包管理（设计文档 §6、§18）：解析安装包、抽取 docker/ 子树、按 ELF 头判定架构。
// 本机用系统 tar 解压（macOS/Linux 自带，Windows 10+ 自带 tar.exe）。

import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Arch, InstallerPackage } from '@shared/types'

const pexec = promisify(execFile)
const PKG_ROOT = 'sprixin-iotcloud'

function workDir(): string {
  return join(app.getPath('userData'), 'work')
}
function extractRoot(): string {
  return join(workDir(), 'extract')
}

/** 已登记的安装包（本期单包，按架构扩展时改为数组） */
const registered = new Map<Arch, InstallerPackage>()

export function listPackages(): InstallerPackage[] {
  return [...registered.values()]
}

/** ELF e_machine（偏移 18，小端 2 字节）：0x3E=x86_64，0xB7=aarch64 */
async function detectArchFromElf(file: string): Promise<Arch> {
  const fh = await fs.open(file, 'r')
  try {
    const buf = Buffer.alloc(20)
    await fh.read(buf, 0, 20, 0)
    if (buf.toString('binary', 0, 4) !== '\x7fELF') return 'unknown'
    const machine = buf.readUInt16LE(18)
    if (machine === 0x3e) return 'x86_64'
    if (machine === 0xb7) return 'aarch64'
    return 'unknown'
  } finally {
    await fh.close()
  }
}

/** docker 子树本地路径（抽取后） */
export function dockerLocalDir(arch: Arch): string {
  return join(extractRoot(), arch, PKG_ROOT, 'docker')
}

/** 登记并解析安装包：抽取 docker/ 子树并判定架构 */
export async function registerPackage(pkgPath: string): Promise<InstallerPackage> {
  await fs.access(pkgPath) // 不存在则抛错
  const tmp = join(extractRoot(), 'pending')
  await fs.rm(tmp, { recursive: true, force: true })
  await fs.mkdir(tmp, { recursive: true })

  // 只抽取 docker 子树（几百 MB，不动 images 的 1.5G）
  await pexec('tar', ['-xzf', pkgPath, '-C', tmp, `${PKG_ROOT}/docker`], {
    maxBuffer: 1024 * 1024 * 64
  })

  const dockerDir = join(tmp, PKG_ROOT, 'docker')
  const arch = await detectArchFromElf(join(dockerDir, 'bin', 'dockerd'))

  // 归位到 extract/<arch>
  const finalDir = join(extractRoot(), arch)
  await fs.rm(finalDir, { recursive: true, force: true })
  await fs.mkdir(finalDir, { recursive: true })
  await fs.rename(join(tmp, PKG_ROOT), join(finalDir, PKG_ROOT))

  const pkg: InstallerPackage = { arch, path: pkgPath }
  registered.set(arch, pkg)
  return pkg
}

/** 取某架构对应的已登记包 */
export function getPackage(arch: Arch): InstallerPackage | undefined {
  return registered.get(arch)
}

/** 按前缀在包内 images/ 查找镜像 tar 文件名 */
export async function findImageTar(arch: Arch, prefix: string): Promise<string | undefined> {
  const pkg = registered.get(arch)
  if (!pkg) return undefined
  const { stdout } = await pexec('tar', ['-tzf', pkg.path], { maxBuffer: 1024 * 1024 * 64 })
  const re = new RegExp(`${PKG_ROOT}/images/(${prefix}[^/]*\\.tar)$`)
  for (const line of stdout.split('\n')) {
    const m = re.exec(line.trim())
    if (m) return m[1]
  }
  return undefined
}

/** 抽取单个镜像 tar 到本地，返回本地路径 */
export async function extractImage(arch: Arch, tarName: string): Promise<string> {
  const pkg = registered.get(arch)
  if (!pkg) throw new Error(`未登记 ${arch} 安装包`)
  const dest = join(extractRoot(), arch)
  await pexec('tar', ['-xzf', pkg.path, '-C', dest, `${PKG_ROOT}/images/${tarName}`], {
    maxBuffer: 1024 * 1024 * 64
  })
  return join(dest, PKG_ROOT, 'images', tarName)
}

/** 抽取 iotcloud 的 conf/.env 等（用于下发，conf 原样不改 §17.10） */
export async function extractIotcloudConf(arch: Arch): Promise<string> {
  const pkg = registered.get(arch)
  if (!pkg) throw new Error(`未登记 ${arch} 安装包`)
  const dest = join(extractRoot(), arch)
  await pexec('tar', ['-xzf', pkg.path, '-C', dest, `${PKG_ROOT}/services/iotcloud`], {
    maxBuffer: 1024 * 1024 * 64
  })
  return join(dest, PKG_ROOT, 'services', 'iotcloud')
}
