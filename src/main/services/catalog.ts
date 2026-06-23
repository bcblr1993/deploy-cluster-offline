// 服务目录（设计文档 §16.2）：驱动放置规则、渲染、镜像匹配、启动分层。

import type { ServiceId, ServiceMeta } from '@shared/types'

export const CATALOG: Record<ServiceId, ServiceMeta> = {
  postgres: {
    id: 'postgres',
    name: 'PostgreSQL',
    image: 'postgres:15.4',
    role: '关系库',
    clusterable: false,
    singleton: true,
    ports: ['5432'],
    dataMount: '/var/lib/postgresql/data',
    imageTarPrefix: 'postgres',
    tier: 1
  },
  redis: {
    id: 'redis',
    name: 'Redis',
    image: 'redis:7.2',
    role: '缓存',
    clusterable: false,
    singleton: true,
    ports: ['6379'],
    dataMount: '/data',
    imageTarPrefix: 'redis',
    tier: 1
  },
  kafka: {
    id: 'kafka',
    name: 'Kafka',
    image: 'bitnami/kafka:3.9',
    role: '消息队列',
    clusterable: true,
    singleton: false,
    ports: ['9092', '9093'],
    dataMount: '/bitnami/kafka',
    imageTarPrefix: 'kafka',
    tier: 1
  },
  cassandra: {
    id: 'cassandra',
    name: 'Cassandra',
    image: 'cassandra:4.1.3',
    role: '时序库',
    clusterable: true,
    singleton: false,
    ports: ['9042', '7000'],
    dataMount: '/var/lib/cassandra',
    imageTarPrefix: 'cassandra',
    tier: 1
  },
  iotcloud: {
    id: 'iotcloud',
    name: 'iotcloud',
    image: 'iotcloud',
    role: '应用',
    clusterable: false,
    singleton: true,
    ports: ['1883', '8080', '7070', '7071', '5683-5688/udp'],
    deps: ['postgres', 'redis', 'kafka', 'cassandra'],
    imageTarPrefix: 'iotcloud',
    tier: 2
  },
  netdata: {
    id: 'netdata',
    name: 'Netdata',
    image: 'netdata/netdata:v2.5.3',
    role: '监控',
    clusterable: false,
    singleton: false,
    perNode: true,
    ports: ['19999'],
    imageTarPrefix: 'netdata',
    tier: 3
  },
  'wechat-messenger': {
    id: 'wechat-messenger',
    name: '企业微信告警',
    image: 'wechat-messenger:v2.1.0',
    role: '告警',
    clusterable: false,
    singleton: true,
    manual: true, // §14-14：现场手动配置启动，工具不自动编排
    ports: [],
    imageTarPrefix: 'wechat-messenger',
    tier: 3
  }
}

export function meta(id: ServiceId): ServiceMeta {
  return CATALOG[id]
}
