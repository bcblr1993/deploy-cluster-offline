// 步骤4：磁盘分区预览（只读）。

import { useState } from 'react'
import { Button, Card, Empty, Space, Table, Tag, Typography } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
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

export default function Step4Disk() {
  const { nodes } = useWizard()
  const [disks, setDisks] = useState<Record<string, DiskInfo[]>>({})
  const [loading, setLoading] = useState(false)

  async function scan() {
    setLoading(true)
    try {
      setDisks(await ipc.step4Probe(nodes))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Text type="secondary">
        扫描每台机的磁盘类型（固态 SSD / 机械 HDD，按 ROTA 判定）、容量、分区、挂载与使用率。此步只读、不改动任何配置。
      </Text>
      <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={scan}>
        扫描磁盘
      </Button>

      {nodes.map((n) => {
        const ds = disks[n.id]
        return (
          <Card key={n.id} size="small" title={`${n.ip}（${n.username}）`}>
            {!ds ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未扫描" />
            ) : ds.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无数据或扫描失败" />
            ) : (
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
            )}
          </Card>
        )
      })}
    </Space>
  )
}
