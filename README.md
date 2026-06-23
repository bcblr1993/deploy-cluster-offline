# 离线集群部署工具

跨多台物理机离线部署 iotcloud 平台的桌面应用（Windows / macOS / Linux）。
完整设计见 [docs/设计文档.md](docs/设计文档.md)。

## 技术栈

- Electron + electron-vite + electron-builder
- React 18 + TypeScript + Ant Design 5 + Zustand
- ssh2（纯 JS SSH/SFTP，不依赖系统 ssh 客户端）

## 环境要求

- Node.js **20.19.0**（见 `.nvmrc`）：`nvm use`
- 国内网络：`.npmrc` 已配置 npmmirror 的 npm registry 与 Electron/builder 镜像

## 常用命令

```bash
nvm use              # 切到 Node 20.19.0
npm install          # 安装依赖
npm run dev          # 开发模式（热更新）
npm run typecheck    # 类型检查（main + renderer）
npm run build        # 构建 out/（main/preload/renderer）
npm run pack:dir     # 打当前平台免安装包（验证打包）
npm run dist:mac     # 产出 macOS dmg
npm run dist:win     # 产出 Windows nsis exe（需在 Windows 或配置交叉构建）
npm run dist:linux   # 产出 Linux AppImage/deb
```

## 目录结构

```
src/
├─ main/                  主进程
│  ├─ index.ts            窗口创建 + 生命周期
│  ├─ ipc/                IPC 注册中心
│  ├─ ssh/                SshClient / SshPool（ssh2 封装）
│  ├─ os/                 发行版适配层 OsAdapter + DebianAdapter（§19）
│  ├─ orchestrator/       并发任务编排引擎骨架（§4.3）
│  └─ steps/              各步骤远程编排逻辑（step1Probe 已实现）
├─ preload/               contextBridge 暴露受控 API（§12）
├─ renderer/              React 渲染进程
│  └─ src/
│     ├─ App.tsx          6 步向导骨架（Steps）
│     ├─ pages/           Step1Hosts（已实现）+ 其余占位
│     ├─ store/           Zustand 向导状态
│     └─ ipc/             渲染侧 IPC 封装
└─ shared/types.ts        主/渲染共享类型 + IPC 契约
```

## 进度

- [x] **M1 脚手架**：工程/依赖、主进程骨架（IPC/SSH/OsAdapter）、向导 UI、三端打包配置；
  步骤1「主机配置 + 连接检测」已可真实 SSH 探测（架构/systemd/权限/docker/联网）。
- [x] **M2 凭据加密 + 工程持久化**：safeStorage 加密密码落盘、工程保存/加载、检测后自动保存、步骤1「全部可用」门禁。
- [x] **M3 步骤2/3/4**：主机名&hosts（标记块幂等）、时间对齐（chrony 三分支 + date 兜底）、磁盘预览（SSD/HDD）。含 §15 危险操作确认机制 + 实时日志/状态流。
- [x] **M4 步骤5**：离线装 Docker（PackageManager 抽取 docker/、SFTP 上传带进度、幂等安装+校验、复用/强制重装 danger）。
- [x] **M5 步骤6**：服务编排（服务目录、放置矩阵、§17 拓扑渲染引擎生成 kafka/cassandra 集群 compose、iotcloud 纯 .env 注入、镜像按需分发、分层启动 + cassandra 串行/keyspace 预建、配置预览）。
- [x] **M6 一键卸载**：按放置倒序停止、默认保留卷、删卷为 danger（§20）。

> 注：步骤2-6 的远程行为（SSH 改配置、装 docker、起集群）需连真机验证；本机已通过 typecheck + build + 启动冒烟。集群编排的健康等待等细节建议现场联调。
