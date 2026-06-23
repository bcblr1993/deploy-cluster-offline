# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

一个跨平台（Win/Mac/Linux）的 Electron 桌面工具，用于在**离线现场**把 iotcloud（基于 ThingsBoard）平台通过 SSH 部署到**多台 x86_64 Linux 物理机**。向导分 6 步：主机接入检测 → 主机名/hosts → 时间对齐 → 磁盘预览 → 离线装 Docker → 按节点编排服务（含 kafka/cassandra 跨节点集群）。完整设计见 `docs/设计文档.md`，它是需求与实现的权威来源，改动前先读相关章节（§号在代码注释中常被引用）。

## 环境与命令

- **Node 必须用 20.19.0**（见 `.nvmrc`）。每个 shell 先 `source ~/.nvm/nvm.sh && nvm use 20.19.0`，否则系统默认 Node 14 会让所有命令失败。
- `.npmrc` 已配置 npmmirror 的 npm registry + `electron_mirror` + `electron_builder_binaries_mirror`（国内直连 GitHub 下载 Electron 会中断）。安装时还需 `export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"`。

```bash
npm install          # 安装依赖（首次 ~3min，含 Electron 二进制下载）
npm run dev          # 开发模式（electron-vite，渲染进程热更新）
npm run typecheck    # tsc 双工程检查（main + renderer），改完必跑
npm run build        # 构建 out/（main/preload/renderer 三 bundle）
npm run pack:dir     # 打当前平台免安装包，验证 electron-builder 配置
npm run dist:mac|dist:win|dist:linux   # 产出三端安装包
```

无测试框架。验证手段：`npm run typecheck` + `npm run build` + 启动冒烟（`npm run start` 后日志里出现 `start electron app...` 且无 preload/模块加载错误）。**主进程逻辑改动 dev 下不热更新，必须重启 `npm run dev`**。

## 架构大图

三进程，严格分层：

- **renderer**（`src/renderer/`，React+AntD+Zustand）：纯 UI，绝不直接碰网络/SSH/文件，所有能力经 IPC 委托主进程。
- **preload**（`src/preload/index.ts`）：唯一的 IPC 白名单出口，`contextBridge` 暴露 `window.deployApi`。新增主进程能力必须在这里登记，渲染侧才能调用。
- **main**（`src/main/`）：承载全部副作用——SSH/SFTP、文件、加密、安装包解压、编排。

跨进程契约集中在 `src/shared/`（`@shared/*` 别名，main 与 renderer 共用）。`types.ts` 是 IPC 与数据模型的单一事实源；`hosts.ts` 是主/渲染共用的 /etc/hosts 合并逻辑（预览与实际写入同源，避免不一致）。

### 步骤执行的统一模式（理解这个就理解了大半）

每个会改远端状态的步骤都走 **plan → §15 确认 → run（流式）** 三段：

1. `stepN:plan` 返回 `ActionPlan`（列出每节点将做什么、受影响项、`danger` 级需输入确认词）。确认内容与实际执行命令**同源**。
2. 用户在 `ConfirmActionModal` 确认后调 `stepN:run`。
3. run 用 `src/main/orchestrator/runStep.ts` 的 `runStep()` 对节点并发执行、失败隔离，通过 `emitRunEvent` 把 `RunEvent`（log/status/progress）广播到渲染进程。

渲染侧：`App.tsx` 在**顶层**订阅 `onRunEvent` 并写入 Zustand store 的 `runs[runKey]`（与页面挂载解耦，切步骤不丢日志）；执行期间 store 的 `busy` 锁会禁用所有导航。复用组件是 `components/StepRunner.tsx`（按 `runKey` 读 store）。新增"执行型"步骤照搬此模式即可。

### 关键子系统

- **SSH**：`ssh/SshClient.ts`（`exec`/`execSudo`/`putDir`/`putFile`）+ `ssh/SshPool.ts`（按 nodeId 复用连接）。`execSudo`：root 直连裸跑，普通用户 `sudo -S` 喂密码。
- **发行版适配层** `os/OsAdapter.ts`：业务步骤不写死发行版命令；本期仅 `DebianAdapter`（Ubuntu/Debian），非 Debian 系在步骤1 拦截提示"待扩展"。
- **安装包** `package/PackageManager.ts`：用系统 `tar` 从 1.5G 包里**按需抽取** docker 子树 / 单个镜像 tar / iotcloud conf，按 ELF 头判架构。
- **服务编排引擎（§17）** `services/render.ts` + `services/catalog.ts`：核心是 `renderDeployment()`——按放置矩阵算集群拓扑，渲染每实例的 compose/.env。
- **凭据/工程持久化** `store/ConfigStore.ts`：密码用 Electron `safeStorage` 加密（`enc:` 前缀）落盘到 userData，明文绝不落盘；其余存普通 JSON。

## 不变量 / 易踩的坑

- **绝不修改 `thingsboard.yml`**：iotcloud 全部差异化只通过生成 `.env` 覆盖 `${VAR:default}`（§17.6/§17.10）。conf 目录从安装包原样下发。
- **跨节点网络靠真实 IP，不靠容器名**：现有 compose 的 `cassandra:9042`/`redis`/`postgres:5432`/`kafka:9092` 是单机同网络假设，跨机不可用。集群类服务用 `network_mode: host` + 真实 IP 装配（kafka 的 advertised/quorum-voters、cassandra 的 seeds/listen-address）。
- **SFTP 不保留可执行位**：上传二进制后必须显式 `chmod +x`，且 `chmod +x docker*` 通配漏掉 `containerd`/`runc`/`ctr`——必须逐个加，否则 dockerd 起不来（见 `steps/step5Docker.ts`）。
- **联网探测不能用 NTP 123**：`/dev/tcp` 只能测 TCP，NTP 是 UDP。用公网 DNS 的 TCP/53（`steps/connectivity.ts`），step1 与 step3 共用。
- **目标约束**：docker 二进制是 x86_64 + systemd。ARM 仅"预留接口"（暂无 arm64 包）。需要 root/sudo。
- **远程命令幂等**：/etc/hosts 用标记块替换 + 去重；docker 安装前探测复用。重复执行不应报错或污染。

## Git 提交

提交信息用中文 + emoji（如 `✨ 新增…` / `🐛 修复…` / `♻️ 重构…`），并按 system prompt 要求附 `Co-Authored-By` 行。
