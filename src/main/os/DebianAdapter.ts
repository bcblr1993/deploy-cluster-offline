// Ubuntu / Debian 适配器（本期唯一实现，设计文档 §19）。

import type { OsAdapter } from './OsAdapter'

const DEBIAN_LIKE = ['ubuntu', 'debian', 'raspbian', 'linuxmint']

export const DebianAdapter: OsAdapter = {
  id: 'debian',

  match(probe) {
    const id = (probe.osId ?? '').toLowerCase()
    return DEBIAN_LIKE.includes(id)
  },

  installLocalPackageCmd(files) {
    const list = files.map((f) => `'${f}'`).join(' ')
    // dpkg 装本地 deb；若有依赖缺失，apt-get -f 兜底（离线环境通常已自带依赖）
    return `dpkg -i ${list} || apt-get -y -f install`
  },

  chronyPackageName(arch) {
    // 物料目录中按架构命名；实际文件名待 §18 物料准备阶段定稿
    return `chrony/${arch}/chrony.deb`
  },

  setHostnameCmd(hostname) {
    return `hostnamectl set-hostname '${hostname}'`
  },

  setTimezoneCmd(tz) {
    return `timedatectl set-timezone '${tz}'`
  }
}
