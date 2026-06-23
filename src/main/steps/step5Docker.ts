// 步骤5：离线安装 Docker / docker-compose（设计文档 §7 步骤5）。

import { runStep, execLogged, type NodeRunCtx } from '../orchestrator/runStep'
import { dockerLocalDir, getPackage } from '../package/PackageManager'
import type { Arch, ActionPlan, NodeConfig, NodeTaskResult, Step5Params } from '@shared/types'

const REMOTE_DOCKER = '/opt/deploy-tool/docker'

function archOf(raw: string): Arch {
  if (raw === 'x86_64') return 'x86_64'
  if (raw === 'aarch64' || raw === 'arm64') return 'aarch64'
  return 'unknown'
}

export function planStep5(nodes: NodeConfig[], params: Step5Params): ActionPlan {
  const force = params.mode === 'force-reinstall'
  return {
    stepId: 'step5',
    level: force ? 'danger' : 'warning',
    items: nodes.map((n) => ({
      nodeId: n.id,
      summary: `${n.ip}：${force ? '强制重装 Docker（先清除现有）' : '离线安装 Docker'}`,
      affects: ['/usr/bin/docker*', '/etc/systemd/system/docker.service', '/etc/docker/daemon.json', 'proxy 网络'],
      destructive: force
        ? ['现有 docker 二进制与服务', '/root/.docker 数据目录（容器/镜像/卷将被删除）']
        : undefined
    })),
    requireKeyword: force ? 'REINSTALL' : undefined,
    preview: force
      ? '强制重装会停止并删除现有 Docker 及其 data-root 数据，再离线重装。'
      : '幂等安装：已装 Docker 将复用，仅补齐 compose / proxy 网络 / docker 组。'
  }
}

const installScript = `
REMOTE=${REMOTE_DOCKER}
# SFTP 传输不保留执行位：必须给「全部」二进制加 +x（containerd/runc/ctr 不匹配 docker* 通配）
chmod +x $REMOTE/bin/* 2>/dev/null || true
cp -f $REMOTE/bin/* /usr/bin/
chmod +x /usr/bin/docker /usr/bin/dockerd /usr/bin/containerd /usr/bin/containerd-shim-runc-v2 /usr/bin/runc /usr/bin/ctr /usr/bin/docker-init /usr/bin/docker-proxy /usr/bin/docker-compose 2>/dev/null || true
cp -f $REMOTE/service/docker.service /etc/systemd/system/
chmod 644 /etc/systemd/system/docker.service
mkdir -p /etc/docker
cp -f $REMOTE/daemon.json /etc/docker/
systemctl daemon-reload
systemctl enable docker >/dev/null 2>&1 || true
systemctl restart docker
`

const forceCleanScript = `
systemctl stop docker 2>/dev/null || true
systemctl disable docker 2>/dev/null || true
rm -f /usr/bin/docker /usr/bin/dockerd /usr/bin/docker-compose /usr/bin/containerd /usr/bin/containerd-shim-runc-v2 /usr/bin/runc /usr/bin/ctr /usr/bin/docker-proxy /usr/bin/docker-init
rm -f /etc/systemd/system/docker.service
rm -rf /root/.docker
systemctl daemon-reload || true
`

export async function runStep5(
  runId: string,
  nodes: NodeConfig[],
  params: Step5Params
): Promise<NodeTaskResult[]> {
  const force = params.mode === 'force-reinstall'

  return runStep(runId, nodes, async (ctx) => {
    // 0) 必须 root（root 直连或 sudo 提权）
    const root = await ctx.client.execSudo('id -u', { timeoutMs: 12000 })
    if (root.stdout.trim() !== '0') {
      throw new Error('安装 Docker 需要 root 权限（当前用户既非 root、也无可用 sudo）')
    }

    // 1) 探测架构 + 选包
    const um = await ctx.client.exec('uname -m', { timeoutMs: 8000 })
    const arch = archOf(um.stdout.trim())
    const pkg = getPackage(arch)
    if (!pkg) throw new Error(`缺少 ${arch} 架构的安装包，请先在「安装包」处登记`)

    // 2) 幂等：复用模式且已装则跳过二进制安装
    const has = await ctx.client.exec('command -v docker >/dev/null 2>&1 && echo Y || echo N', {
      timeoutMs: 8000
    })
    const installed = has.stdout.includes('Y')

    if (force) {
      ctx.log('强制重装：清除现有 Docker 与 data-root 数据')
      await execLogged(ctx, forceCleanScript, { sudo: true, timeoutMs: 120000 })
    } else if (installed) {
      ctx.log('检测到已安装 Docker，复用现有，仅补齐 compose/proxy/docker 组')
      await execLogged(
        ctx,
        `cp ${REMOTE_DOCKER}/bin/docker-compose /usr/bin/ 2>/dev/null; getent group docker >/dev/null || groupadd docker; docker network inspect proxy >/dev/null 2>&1 || docker network create proxy`,
        { sudo: true, timeoutMs: 30000 }
      )
      await verify(ctx)
      ctx.log('✓ 完成（复用）')
      return
    }

    // 3) 上传 docker 物料
    const localDir = dockerLocalDir(arch)
    ctx.log(`上传 Docker 物料 → ${REMOTE_DOCKER}`)
    await ctx.client.putDir(localDir, REMOTE_DOCKER, (done, total, cur) => {
      ctx.progress(Math.round((done / total) * 100))
      if (done === total || done % 10 === 0) ctx.log(`传输 ${done}/${total}: ${cur}`)
    })

    // 4) 安装
    ctx.log('离线安装 Docker / docker-compose')
    await execLogged(ctx, installScript, { sudo: true, timeoutMs: 180000 })

    // 4.1) 校验服务是否真起来；失败抓 journal 真实错误
    const act = await ctx.client.execSudo('systemctl is-active docker 2>/dev/null || true', {
      timeoutMs: 15000
    })
    if (!act.stdout.includes('active')) {
      ctx.log('docker.service 未处于 active，抓取诊断日志：', 'stderr')
      await execLogged(
        ctx,
        'systemctl status docker.service --no-pager -l 2>&1 | tail -25; echo "----- journalctl -----"; journalctl -xeu docker.service --no-pager 2>&1 | tail -40',
        { sudo: true, timeoutMs: 30000 }
      )
      throw new Error('docker 服务启动失败，请查看上方 journalctl 日志定位原因')
    }

    // 4.2) 服务已起：建 docker 组 + proxy 网络
    await execLogged(
      ctx,
      'getent group docker >/dev/null || groupadd docker; docker network inspect proxy >/dev/null 2>&1 || docker network create proxy',
      { sudo: true, timeoutMs: 30000 }
    )

    await verify(ctx)
    ctx.log('✓ 完成')
  })
}

async function verify(ctx: NodeRunCtx): Promise<void> {
  const dv = await ctx.client.execSudo(
    'docker version --format "{{.Server.Version}}" 2>/dev/null || docker --version',
    { timeoutMs: 15000 }
  )
  const cv = await ctx.client.execSudo(
    'docker-compose version --short 2>/dev/null || docker-compose version',
    { timeoutMs: 15000 }
  )
  ctx.log(`docker: ${dv.stdout.trim() || '未知'}`)
  ctx.log(`docker-compose: ${cv.stdout.trim() || '未知'}`)
  if (!dv.stdout.trim()) throw new Error('docker 校验失败')
}
