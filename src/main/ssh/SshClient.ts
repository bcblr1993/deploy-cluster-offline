// 单台主机的 SSH 连接封装（基于 ssh2）。
// 提供 connect / exec / execSudo；M2 起承载步骤1 探测与后续编排。

import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { promises as fs } from 'fs'
import { join, relative, sep } from 'path'
import type { NodeConfig } from '@shared/types'

export interface ExecResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface ExecOptions {
  /** 申请伪终端（sudo requiretty 场景需要） */
  pty?: boolean
  /** 实时输出回调（编排日志流用） */
  onData?: (chunk: string, stream: 'stdout' | 'stderr') => void
  /** 超时毫秒 */
  timeoutMs?: number
}

export class SshClient {
  private conn: Client | null = null
  private connected = false

  constructor(private readonly node: NodeConfig) {}

  get isConnected(): boolean {
    return this.connected
  }

  connect(timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const conn = new Client()
      const cfg: ConnectConfig = {
        host: this.node.ip,
        port: this.node.port,
        username: this.node.username,
        password: this.node.password,
        readyTimeout: timeoutMs,
        // 离线现场常见老旧设备，放宽算法兼容性
        algorithms: undefined
      }
      conn
        .on('ready', () => {
          this.conn = conn
          this.connected = true
          resolve()
        })
        .on('error', (err) => {
          this.connected = false
          reject(err)
        })
        .on('close', () => {
          this.connected = false
        })
        .connect(cfg)
    })
  }

  exec(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (!this.conn || !this.connected) {
      return Promise.reject(new Error('SSH 未连接'))
    }
    const conn = this.conn
    return new Promise((resolve, reject) => {
      conn.exec(command, { pty: opts.pty ?? false }, (err, stream) => {
        if (err) return reject(err)
        let stdout = ''
        let stderr = ''
        let timer: NodeJS.Timeout | undefined
        if (opts.timeoutMs) {
          timer = setTimeout(() => {
            stream.close()
            reject(new Error(`命令超时(${opts.timeoutMs}ms): ${command}`))
          }, opts.timeoutMs)
        }
        stream
          .on('close', (code: number | null) => {
            if (timer) clearTimeout(timer)
            resolve({ code, stdout, stderr })
          })
          .on('data', (data: Buffer) => {
            const s = data.toString()
            stdout += s
            opts.onData?.(s, 'stdout')
          })
        stream.stderr.on('data', (data: Buffer) => {
          const s = data.toString()
          stderr += s
          opts.onData?.(s, 'stderr')
        })
      })
    })
  }

  /**
   * 以 root 权限执行：root 直连则裸跑；普通用户用 `sudo -S` 喂密码。
   * 需要 pty 以兼容 requiretty 配置。
   */
  execSudo(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (this.node.username === 'root') {
      return this.exec(command, opts)
    }
    const pwd = (this.node.password ?? '').replace(/'/g, `'\\''`)
    // -S 从 stdin 读密码；-p '' 去掉提示语避免污染输出
    const wrapped = `echo '${pwd}' | sudo -S -p '' bash -c ${shellQuote(command)}`
    return this.exec(wrapped, { ...opts, pty: true })
  }

  private sftp(): Promise<SFTPWrapper> {
    if (!this.conn || !this.connected) return Promise.reject(new Error('SSH 未连接'))
    const conn = this.conn
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)))
    })
  }

  private async listFiles(dir: string): Promise<string[]> {
    const out: string[] = []
    const walk = async (d: string): Promise<void> => {
      for (const ent of await fs.readdir(d, { withFileTypes: true })) {
        const p = join(d, ent.name)
        if (ent.isDirectory()) await walk(p)
        else if (ent.isFile()) out.push(p)
      }
    }
    await walk(dir)
    return out
  }

  /**
   * 递归上传本地目录到远端（SFTP）。
   * 先 mkdir -p 远端子目录，再逐文件 fastPut；onProgress 回调已传/总文件数。
   */
  async putDir(
    localDir: string,
    remoteDir: string,
    onProgress?: (done: number, total: number, current: string) => void
  ): Promise<void> {
    const files = await this.listFiles(localDir)
    // 远端需要的子目录集合
    const remoteDirs = new Set<string>([remoteDir])
    for (const f of files) {
      const rel = relative(localDir, f).split(sep).slice(0, -1).join('/')
      if (rel) remoteDirs.add(`${remoteDir}/${rel}`)
    }
    await this.exec(`mkdir -p ${[...remoteDirs].map((d) => `'${d}'`).join(' ')}`)

    const sftp = await this.sftp()
    let done = 0
    for (const f of files) {
      const rel = relative(localDir, f).split(sep).join('/')
      const remotePath = `${remoteDir}/${rel}`
      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(f, remotePath, (err) => (err ? reject(err) : resolve()))
      })
      done++
      onProgress?.(done, files.length, rel)
    }
  }

  /** 上传单个文件（带进度），remoteDir 会自动 mkdir -p */
  async putFile(
    localFile: string,
    remotePath: string,
    onProgress?: (transferred: number, total: number) => void
  ): Promise<void> {
    const remoteDir = remotePath.split('/').slice(0, -1).join('/')
    if (remoteDir) await this.exec(`mkdir -p '${remoteDir}'`)
    const sftp = await this.sftp()
    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(
        localFile,
        remotePath,
        { step: (transferred, _c, total) => onProgress?.(transferred, total) },
        (err) => (err ? reject(err) : resolve())
      )
    })
  }

  dispose(): void {
    if (this.conn) {
      this.conn.end()
      this.conn = null
    }
    this.connected = false
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
