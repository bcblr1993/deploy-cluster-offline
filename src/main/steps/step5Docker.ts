// 步骤5：上传完整安装包到 ~/sprixin-iotcloud（完全复刻），并从中离线安装 Docker。
// 设计 docs/02-…：整包一次上传，docker 物料与镜像都在其中，步骤6 直接复用。

import { basename } from 'path'
import { runStep, execLogged, type NodeRunCtx } from '../orchestrator/runStep'
import { getPackage } from '../package/PackageManager'
import type { Arch, ActionPlan, NodeConfig, NodeTaskResult, Step5Params } from '@shared/types'

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
      summary: `${n.ip}：上传完整安装包到 ~/sprixin-iotcloud 并${force ? '强制重装' : '离线安装'} Docker`,
      affects: ['~/sprixin-iotcloud（完整包结构）', '/usr/bin/docker*', 'docker.service', 'proxy 网络'],
      destructive: force
        ? ['现有 docker 二进制与服务', '/root/.docker 数据目录（容器/镜像/卷将被删除）']
        : undefined
    })),
    requireKeyword: force ? 'REINSTALL' : undefined,
    preview: force
      ? '强制重装会停止并删除现有 Docker 及其 data-root 数据，再从 ~/sprixin-iotcloud/docker 重装。'
      : '上传完整安装包并解压到 ~/sprixin-iotcloud；已装 Docker 将复用，仅补齐 compose/proxy/组。'
  }
}

function installScript(dockerDir: string): string {
  return `
REMOTE='${dockerDir}'
chmod +x "$REMOTE"/bin/* 2>/dev/null || true
cp -f "$REMOTE"/bin/* /usr/bin/
chmod +x /usr/bin/docker /usr/bin/dockerd /usr/bin/containerd /usr/bin/containerd-shim-runc-v2 /usr/bin/runc /usr/bin/ctr /usr/bin/docker-init /usr/bin/docker-proxy /usr/bin/docker-compose 2>/dev/null || true
cp -f "$REMOTE"/service/docker.service /etc/systemd/system/
chmod 644 /etc/systemd/system/docker.service
mkdir -p /etc/docker
cp -f "$REMOTE"/daemon.json /etc/docker/
systemctl daemon-reload
systemctl enable docker >/dev/null 2>&1 || true
systemctl restart docker
`
}

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
    // 0) 必须 root
    const root = await ctx.client.execSudo('id -u', { timeoutMs: 12000 })
    if (root.stdout.trim() !== '0') {
      throw new Error('安装 Docker 需要 root 权限（当前用户既非 root、也无可用 sudo）')
    }

    // 1) 解析 home + 选包
    const home = (await ctx.client.exec('echo $HOME', { timeoutMs: 8000 })).stdout.trim() || '/root'
    const pkgHome = `${home}/sprixin-iotcloud`
    const dockerDir = `${pkgHome}/docker`

    const um = await ctx.client.exec('uname -m', { timeoutMs: 8000 })
    const arch = archOf(um.stdout.trim())
    const pkg = getPackage(arch)
    if (!pkg) throw new Error(`缺少 ${arch} 架构的安装包，请先在「安装包」处登记`)

    // 2) 整包上传 + 解压到 ~/（完全复刻；已存在则跳过，force 则重传）
    const exists = (
      await ctx.client.exec(`test -d '${pkgHome}/services' && echo Y || echo N`, { timeoutMs: 8000 })
    ).stdout.includes('Y')
    if (force || !exists) {
      const tarName = basename(pkg.path)
      const remoteTar = `${home}/${tarName}`
      ctx.log(`上传完整安装包 → ${remoteTar}（约 1.5G，请耐心等待）`)
      let last = -1
      await ctx.client.putFile(pkg.path, remoteTar, (t, total) => {
        const pct = Math.round((t / total) * 100)
        ctx.progress(pct)
        if (pct !== last && pct % 5 === 0) {
          ctx.log(`上传进度 ${pct}%`)
          last = pct
        }
      })
      ctx.log('解压到 ~/sprixin-iotcloud …')
      const ex = await execLogged(
        ctx,
        `tar xzf '${remoteTar}' -C '${home}' && rm -f '${remoteTar}'`,
        { sudo: true, timeoutMs: 600000 }
      )
      if (ex.code !== 0) throw new Error(`解压失败 (code=${ex.code})`)
    } else {
      ctx.log('检测到 ~/sprixin-iotcloud 已存在，跳过上传（如需更新请用强制重装）')
    }

    // 3) Docker 安装
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
        `cp -f '${dockerDir}/bin/docker-compose' /usr/bin/ 2>/dev/null; chmod +x /usr/bin/docker-compose 2>/dev/null; getent group docker >/dev/null || groupadd docker; docker network inspect proxy >/dev/null 2>&1 || docker network create proxy`,
        { sudo: true, timeoutMs: 30000 }
      )
      await verify(ctx)
      ctx.log('✓ 完成（复用）')
      return
    }

    ctx.log('从 ~/sprixin-iotcloud/docker 离线安装 Docker / docker-compose')
    await execLogged(ctx, installScript(dockerDir), { sudo: true, timeoutMs: 180000 })

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
