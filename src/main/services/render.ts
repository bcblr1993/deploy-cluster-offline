// 动态配置生成引擎（设计文档 §17）：按放置矩阵计算拓扑，渲染每实例 compose/.env。
// 集群类（kafka/cassandra）注入真实 IP + host 网络；iotcloud 只写 .env 不改 thingsboard.yml。

import { createHash } from 'crypto'
import { meta } from './catalog'
import type {
  DeploymentPreview,
  NodeConfig,
  RenderedInstance,
  ServiceId,
  ServicePlacement
} from '@shared/types'

// 安装包内默认密码（§14-15，沿用不改）
const PG_PASSWORD = 'JvUcMbDxjYY4M8sj'
const REDIS_PASSWORD = 'eRLvW23KYiAakR'
const APP_IMAGE = 'iotcloud:4.1.0-20260530.1'

// 展示用基路径（~ = 当前用户 home）；实际部署按节点 home 解析（§部署目录）
const DISPLAY_BASE = '~/sprixin-iotcloud/services'

interface Member {
  instanceId: string
  nodeId: string
  ip: string
  index: number
}

function ipOf(nodeId: string, nodes: NodeConfig[]): string {
  return nodes.find((n) => n.id === nodeId)?.ip ?? '0.0.0.0'
}

function membersOf(
  placements: ServicePlacement[],
  service: ServiceId,
  nodes: NodeConfig[]
): Member[] {
  return placements
    .filter((p) => p.service === service)
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId, undefined, { numeric: true }))
    .map((p, i) => ({ instanceId: p.instanceId, nodeId: p.nodeId, ip: ipOf(p.nodeId, nodes), index: i }))
}

/** 稳定生成 22 字符 KRaft cluster id（由成员 IP 派生，保证 preview 与 deploy 一致） */
function kafkaClusterId(memberIps: string[]): string {
  const h = createHash('sha256').update(memberIps.join(',')).digest('base64')
  return h.replace(/[^A-Za-z0-9]/g, '').slice(0, 22)
}

function remoteDir(service: ServiceId): string {
  return `${DISPLAY_BASE}/${service}`
}

/** 与安装包逐一对齐的数据目录名（保证家目录结构与包一致） */
function defaultDataDir(service: ServiceId): string {
  switch (service) {
    case 'kafka':
      return './kafka_0_data'
    case 'cassandra':
      return './cassandra_node1_data'
    default:
      return './data'
  }
}

/** 数据卷宿主侧：默认与包一致的相对目录，或用户指定的绝对路径 */
function dataVol(p: ServicePlacement): string {
  return p.dataPath || defaultDataDir(p.service)
}

// ───────── 各服务渲染 ─────────

function renderPostgres(p: ServicePlacement): { compose: string } {
  return {
    compose: `networks:
  proxy:
    external: true
services:
  postgres:
    image: postgres:15.4
    container_name: postgres
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: ${PG_PASSWORD}
      POSTGRES_DB: thingsboard
      TZ: Asia/Shanghai
    networks: [proxy]
    volumes:
      - ${dataVol(p)}:/var/lib/postgresql/data
      - /etc/localtime:/etc/localtime:ro
    restart: always
`
  }
}

function renderRedis(p: ServicePlacement): { compose: string } {
  return {
    compose: `networks:
  proxy:
    external: true
services:
  redis:
    image: redis:7.2
    container_name: redis
    networks: [proxy]
    environment:
      TZ: Asia/Shanghai
    ports:
      - "6379:6379"
    volumes:
      - ${dataVol(p)}:/data
      - /etc/localtime:/etc/localtime:ro
    command: redis-server --requirepass ${REDIS_PASSWORD}
    restart: always
`
  }
}

function renderKafka(p: ServicePlacement, members: Member[]): { compose: string } {
  const cluster = members.length > 1
  const me = members.find((m) => m.instanceId === p.instanceId)!
  if (!cluster) {
    return {
      compose: `networks:
  proxy:
    external: true
services:
  kafka:
    image: bitnami/kafka:3.9
    container_name: kafka
    ports: ["9092:9092", "9093:9093"]
    networks: [proxy]
    environment:
      - KAFKA_ENABLE_KRAFT=yes
      - KAFKA_CFG_NODE_ID=0
      - KAFKA_CFG_PROCESS_ROLES=controller,broker
      - KAFKA_CFG_CONTROLLER_QUORUM_VOTERS=0@kafka:9093
      - KAFKA_KRAFT_CLUSTER_ID=${kafkaClusterId(members.map((m) => m.ip))}
      - KAFKA_CFG_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093
      - KAFKA_CFG_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092
      - KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP=PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT
      - KAFKA_CFG_CONTROLLER_LISTENER_NAMES=CONTROLLER
      - KAFKA_CFG_INTER_BROKER_LISTENER_NAME=PLAINTEXT
    volumes:
      - ${dataVol(p)}:/bitnami/kafka
      - /etc/localtime:/etc/localtime:ro
    restart: always
`
    }
  }
  const rf = Math.min(members.length, 3)
  const voters = members.map((m) => `${m.index}@${m.ip}:9093`).join(',')
  const clusterId = kafkaClusterId(members.map((m) => m.ip))
  return {
    compose: `services:
  kafka:
    image: bitnami/kafka:3.9
    container_name: kafka
    network_mode: host
    environment:
      - KAFKA_ENABLE_KRAFT=yes
      - KAFKA_CFG_PROCESS_ROLES=controller,broker
      - KAFKA_CFG_NODE_ID=${me.index}
      - KAFKA_KRAFT_CLUSTER_ID=${clusterId}
      - KAFKA_CFG_CONTROLLER_QUORUM_VOTERS=${voters}
      - KAFKA_CFG_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093
      - KAFKA_CFG_ADVERTISED_LISTENERS=PLAINTEXT://${me.ip}:9092
      - KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP=PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT
      - KAFKA_CFG_CONTROLLER_LISTENER_NAMES=CONTROLLER
      - KAFKA_CFG_INTER_BROKER_LISTENER_NAME=PLAINTEXT
      - KAFKA_CFG_OFFSETS_TOPIC_REPLICATION_FACTOR=${rf}
      - KAFKA_CFG_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=${rf}
      - KAFKA_CFG_TRANSACTION_STATE_LOG_MIN_ISR=${rf - 1}
      - KAFKA_CFG_DEFAULT_REPLICATION_FACTOR=${rf}
      - KAFKA_CFG_MIN_INSYNC_REPLICAS=${rf - 1}
    volumes:
      - ${dataVol(p)}:/bitnami/kafka
      - /etc/localtime:/etc/localtime:ro
    restart: always
`
  }
}

function renderCassandra(p: ServicePlacement, members: Member[]): { compose: string } {
  const cluster = members.length > 1
  const me = members.find((m) => m.instanceId === p.instanceId)!
  if (!cluster) {
    return {
      compose: `networks:
  proxy:
    external: true
services:
  cassandra:
    image: cassandra:4.1.3
    container_name: cassandra
    ports: ["9042:9042", "7000:7000"]
    networks: [proxy]
    environment:
      - CASSANDRA_CLUSTER_NAME=cassandra
      - CASSANDRA_DC=datacenter1
      - CASSANDRA_RACK=rack1
      - CASSANDRA_ENDPOINT_SNITCH=GossipingPropertyFileSnitch
      - CASSANDRA_NUM_TOKENS=256
    volumes:
      - ${dataVol(p)}:/var/lib/cassandra
      - ./logs:/var/log/cassandra
      - /etc/localtime:/etc/localtime:ro
    restart: unless-stopped
`
    }
  }
  const seeds = members.slice(0, 2).map((m) => m.ip).join(',')
  return {
    compose: `services:
  cassandra:
    image: cassandra:4.1.3
    container_name: cassandra
    network_mode: host
    environment:
      - CASSANDRA_CLUSTER_NAME=cassandra
      - CASSANDRA_DC=datacenter1
      - CASSANDRA_RACK=rack1
      - CASSANDRA_ENDPOINT_SNITCH=GossipingPropertyFileSnitch
      - CASSANDRA_NUM_TOKENS=256
      - CASSANDRA_SEEDS=${seeds}
      - CASSANDRA_LISTEN_ADDRESS=${me.ip}
      - CASSANDRA_BROADCAST_ADDRESS=${me.ip}
      - CASSANDRA_BROADCAST_RPC_ADDRESS=${me.ip}
      - CASSANDRA_RPC_ADDRESS=0.0.0.0
    volumes:
      - ${dataVol(p)}:/var/lib/cassandra
      - ./logs:/var/log/cassandra
      - /etc/localtime:/etc/localtime:ro
    restart: unless-stopped
`
  }
}

function renderIotcloud(
  placements: ServicePlacement[],
  nodes: NodeConfig[]
): { compose: string; env: string } {
  const pg = membersOf(placements, 'postgres', nodes)[0]
  const redis = membersOf(placements, 'redis', nodes)[0]
  const cas = membersOf(placements, 'cassandra', nodes)
  const kfk = membersOf(placements, 'kafka', nodes)
  const casUrl = cas.map((m) => `${m.ip}:9042`).join(',')
  const kfkServers = kfk.map((m) => `${m.ip}:9092`).join(',')
  const rf = Math.min(Math.max(kfk.length, 1), 3)

  const env = `# 自动生成（§17.6）；只覆盖 .env，不改 thingsboard.yml
APP_IMAGE=${APP_IMAGE}
SPRING_DATASOURCE_URL=jdbc:postgresql://${pg?.ip}:5432/thingsboard
SPRING_EVENTS_DATASOURCE_URL=jdbc:postgresql://${pg?.ip}:5432/thingsboard_events
SPRING_DATASOURCE_PASSWORD=${PG_PASSWORD}
REDIS_HOST=${redis?.ip}
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASSWORD}
CASSANDRA_URL=${casUrl}
CASSANDRA_CLUSTER_NAME=cassandra
CASSANDRA_LOCAL_DATACENTER=datacenter1
DATABASE_TS_TYPE=cassandra
TB_QUEUE_TYPE=kafka
ZOOKEEPER_ENABLED=false
TB_KAFKA_SERVERS=${kfkServers}
TB_QUEUE_KAFKA_REPLICATION_FACTOR=${rf}
`
  const compose = `networks:
  proxy:
    external: true
services:
  iotcloud:
    image: \${APP_IMAGE}
    container_name: iotcloud
    networks: [proxy]
    environment:
      TZ: Asia/Shanghai
    ports:
      - "1883:1883"
      - "7070:7070"
      - "7071:7071"
      - "5683-5688:5683-5688/udp"
      - "8080:8080"
    env_file: [./.env]
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - ./logs:/home/sprixin/logs
      - ./conf:/home/sprixin/conf
      - ./conf/logback.xml:/home/sprixin/logback.xml
    restart: always
`
  return { compose, env }
}

function renderNetdata(): { compose: string } {
  return {
    compose: `services:
  netdata:
    image: netdata/netdata:v2.5.3
    container_name: netdata
    ports: ["19999:19999"]
    cap_add: [SYS_PTRACE]
    security_opt: ["apparmor=unconfined"]
    volumes:
      - netdataconfig:/etc/netdata
      - netdatalib:/var/lib/netdata
      - netdatacache:/var/cache/netdata
      - /etc/passwd:/host/etc/passwd:ro
      - /etc/group:/host/etc/group:ro
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /etc/os-release:/host/etc/os-release:ro
      - /etc/localtime:/etc/localtime:ro
    restart: unless-stopped
volumes:
  netdataconfig:
  netdatalib:
  netdatacache:
`
  }
}

/** 渲染整套部署：每实例 compose/.env + 分层启动顺序 + 告警 */
export function renderDeployment(
  placements: ServicePlacement[],
  nodes: NodeConfig[]
): DeploymentPreview {
  const instances: RenderedInstance[] = []
  const warnings: string[] = []

  for (const p of placements) {
    const m = meta(p.service)
    if (m.manual) continue // wechat 不自动编排
    const nodeIp = ipOf(p.nodeId, nodes)
    let compose = ''
    let env: string | undefined
    let cluster = false

    switch (p.service) {
      case 'postgres':
        compose = renderPostgres(p).compose
        break
      case 'redis':
        compose = renderRedis(p).compose
        break
      case 'kafka': {
        const members = membersOf(placements, 'kafka', nodes)
        cluster = members.length > 1
        compose = renderKafka(p, members).compose
        break
      }
      case 'cassandra': {
        const members = membersOf(placements, 'cassandra', nodes)
        cluster = members.length > 1
        compose = renderCassandra(p, members).compose
        break
      }
      case 'iotcloud': {
        const r = renderIotcloud(placements, nodes)
        compose = r.compose
        env = r.env
        break
      }
      case 'netdata':
        compose = renderNetdata().compose
        break
      default:
        continue
    }

    // 需要 mkdir -p + chmod 777 的目录：有状态服务的数据卷（kafka 等容器非 root，否则写不进）
    const chmodDirs: string[] = []
    if (m.dataMount) chmodDirs.push(dataVol(p))
    if (p.service === 'cassandra') chmodDirs.push('./logs')
    if (p.service === 'iotcloud') chmodDirs.push('./logs')

    instances.push({
      instanceId: p.instanceId,
      service: p.service,
      nodeId: p.nodeId,
      nodeIp,
      remoteDir: remoteDir(p.service),
      compose,
      env,
      cluster,
      chmodDirs
    })
  }

  // 依赖校验：iotcloud 需 pg/redis/kafka/cassandra 齐全
  const has = (s: ServiceId): boolean => placements.some((p) => p.service === s)
  if (has('iotcloud')) {
    for (const dep of ['postgres', 'redis', 'kafka', 'cassandra'] as ServiceId[]) {
      if (!has(dep)) warnings.push(`iotcloud 依赖 ${dep}，但未放置`)
    }
  }
  // 集群规模建议
  for (const svc of ['kafka', 'cassandra'] as ServiceId[]) {
    const n = placements.filter((p) => p.service === svc).length
    if (n === 2) warnings.push(`${svc} 集群建议 ≥3 节点（当前 2），可用性不足`)
  }

  // 分层启动顺序（按 catalog.tier）
  const tiers = new Map<number, string[]>()
  for (const inst of instances) {
    const t = meta(inst.service).tier
    if (!tiers.has(t)) tiers.set(t, [])
    tiers.get(t)!.push(inst.instanceId)
  }
  const order = [...tiers.keys()].sort((a, b) => a - b).map((t) => tiers.get(t)!)

  return { instances, order, warnings }
}
