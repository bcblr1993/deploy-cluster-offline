// 步骤4：磁盘分区预览（只读）。

import { useCallback, useEffect, useState } from 'react'
import { Button, Collapse, Empty, Space, Table, Tag, Typography } from 'antd'
import { ColumnHeightOutlined, ReloadOutlined, VerticalAlignMiddleOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import type { DiskInfo, DiskPartition } from '@shared/types'

const { Text } = Typography

function fmtBytes(n: number): string {
  if (!n) return '-'
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`
}

const partCols: ColumnsType<DiskPartition> = [
  { title: '分区', dataIndex: 'name', width: 140 },
  { title: '文件系统', dataIndex: 'fsType', width: 120, render: (v) => v ?? '-' },
  { title: '容量', dataIndex: 'sizeBytes', width: 110, render: fmtBytes },
  { title: '挂载点', dataIndex: 'mountpoint', render: (v) => v ?? '-' },
  {
    title: '使用率',
    dataIndex: 'usedPercent',
    width: 100,
    render: (v?: number) =>
      v == null ? '-' : <Tag color={v > 85 ? 'red' : v > 70 ? 'orange' : 'green'}>{v}%</Tag>
  }
]

function DiskBody({ ds, loading }: { ds?: DiskInfo[]; loading: boolean }) {
  if (!ds) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? '扫描中…' : '未扫描'} />
  if (ds.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无数据或扫描失败" />
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {ds.map((d) => (
        <div key={d.name}>
          <Space style={{ marginBottom: 6 }}>
            <Text strong>/dev/{d.name}</Text>
            <Tag color={d.type === 'SSD' ? 'geekblue' : 'default'}>{d.type}</Tag>
            <Text>{fmtBytes(d.sizeBytes)}</Text>
            {d.model && <Text type="secondary">{d.model}</Text>}
          </Space>
          <Table
            rowKey="name"
            size="small"
            pagination={false}
            columns={partCols}
            dataSource={d.partitions}
            locale={{ emptyText: '无分区' }}
          />
        </div>
      ))}
    </Space>
  )
}

export default function Step4Disk() {
  const { nodes, disks, setDisks } = useWizard()
  const [loading, setLoading] = useState(false)
  const [activeKeys, setActiveKeys] = useState<string[]>([])

  const scan = useCallback(async () => {
    setLoading(true)
    try {
      setDisks(await ipc.step4Probe(nodes))
    } finally {
      setLoading(false)
    }
  }, [nodes, setDisks])

  // 进入磁盘预览即自动扫描，无需手动点击
  useEffect(() => {
    scan()
  }, [scan])

  // 默认全部展开
  useEffect(() => {
    setActiveKeys(nodes.map((n) => n.id))
  }, [nodes])

  const allOpen = activeKeys.length >= nodes.length && nodes.length > 0
  const toggleAll = (): void => setActiveKeys(allOpen ? [] : nodes.map((n) => n.id))

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Text type="secondary">
        进入即自动扫描每台机的磁盘类型（固态 SSD / 机械 HDD，按 ROTA 判定）、容量、分区、挂载与使用率（含未挂载磁盘/分区）。此步只读、不改动任何配置。
      </Text>
      <Space>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={scan}>
          重新扫描
        </Button>
        <Button
          icon={allOpen ? <VerticalAlignMiddleOutlined /> : <ColumnHeightOutlined />}
          onClick={toggleAll}
        >
          {allOpen ? '折叠全部' : '展开全部'}
        </Button>
      </Space>

      <Collapse
        activeKey={activeKeys}
        onChange={(keys) => setActiveKeys(keys as string[])}
        items={nodes.map((n) => {
          const ds = disks[n.id]
          return {
            key: n.id,
            label: (
              <Space>
                <Text strong>{n.ip}</Text>
                <Text type="secondary">（{n.username}）</Text>
              </Space>
            ),
            extra: ds ? <Text type="secondary" style={{ fontSize: 12 }}>{ds.length} 块盘</Text> : null,
            children: <DiskBody ds={ds} loading={loading} />
          }
        })}
      />
    </Space>
  )
}
