// 发行版适配层（设计文档 §19）。
// 业务步骤只调用 OsAdapter 抽象方法，不写死发行版命令；
// 本期只实现 DebianAdapter（Ubuntu/Debian），其他系统后续扩展。

import type { NodeProbe } from '@shared/types'

export interface OsAdapter {
  readonly id: string
  /** 由 /etc/os-release 的 ID / ID_LIKE 判定是否适配该发行版 */
  match(probe: Pick<NodeProbe, 'osId'>): boolean
  /** 本地安装离线包（deb: dpkg -i / rpm: rpm -ivh） */
  installLocalPackageCmd(files: string[]): string
  /** 返回该发行版用的 chrony 离线包文件名（相对物料目录） */
  chronyPackageName(arch: string): string
  /** 设置主机名 */
  setHostnameCmd(hostname: string): string
  /** 设置时区 */
  setTimezoneCmd(tz: string): string
}

const adapters: OsAdapter[] = []

export function registerAdapter(adapter: OsAdapter): void {
  adapters.push(adapter)
}

/** 根据探测结果选择适配器；无匹配返回 undefined（步骤1 据此提示“暂不支持”） */
export function resolveAdapter(probe: Pick<NodeProbe, 'osId'>): OsAdapter | undefined {
  return adapters.find((a) => a.match(probe))
}
