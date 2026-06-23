// 步骤2：主机名 & hosts 映射页。
// 先读取机器现有主机名/hosts → 预填主机名 → 合并预览（重复不重复加入）。

import { useEffect, useState } from 'react'
import { Button, Collapse, Input, Space, Table, Tag, Typography } from 'antd'
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import StepRunner from '../components/StepRunner'
import { buildManagedHosts } from '@shared/hosts'
import type { NodeConfig, Step2Params, Step2Read } from '@shared/types'

const { Text } = Typography

export default function Step2Hostname() {
  const { nodes, hostnames, setHostname, initHostnames } = useWizard()
  const [reads, setReads] = useState<Record<string, Step2Read>>({})
  const [loading, setLoading] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  async function readCurrent() {
    setLoading(true)
    try {
      const r = await ipc.step2Read(nodes)
      setReads(r)
      // 用机器现有主机名预填（仅对空/默认值的字段）
      for (const n of nodes) {
        const cur = r[n.id]?.hostname
        if (cur) setHostname(n.id, cur)
      }
      initHostnames() // 仍为空的填 node-N 兜底
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    readCurrent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const params: Step2Params = { hostnames }
  const entries = nodes.map((n) => ({ ip: n.ip, hostname: hostnames[n.id] ?? '' }))

  const columns: ColumnsType<NodeConfig> = [
    { title: 'IP', dataIndex: 'ip', width: 150 },
    { title: '用户名', dataIndex: 'username', width: 110 },
    {
      title: '当前主机名',
      width: 160,
      render: (_, r) => <Text type="secondary">{reads[r.id]?.hostname || '—'}</Text>
    },
    {
      title: '新主机名',
      width: 220,
      render: (_, r) => (
        <Input
          value={hostnames[r.id] ?? ''}
          placeholder="node-1"
          onChange={(e) => setHostname(r.id, e.target.value.trim())}
        />
      )
    }
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Text type="secondary">
        先读取机器现有主机名与 /etc/hosts；应用时会保留原有内容，仅把集群映射写入托管块，
        已存在的相同条目不会重复添加。
      </Text>

      <Space>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={readCurrent}>
          重新读取现状
        </Button>
        <Button icon={<EyeOutlined />} onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? '收起预览' : '预览合并后的 hosts'}
        </Button>
      </Space>

      <Table rowKey="id" size="middle" pagination={false} columns={columns} dataSource={nodes} />

      {showPreview && (
        <Collapse
          items={nodes.map((n) => {
            const r = buildManagedHosts(reads[n.id]?.hosts ?? '', entries)
            return {
              key: n.id,
              label: (
                <Space>
                  <Text strong>{n.ip}</Text>
                  <Tag color="green">新增 {r.added}</Tag>
                  <Tag>跳过重复 {r.skipped}</Tag>
                </Space>
              ),
              children: (
                <pre
                  style={{
                    margin: 0,
                    maxHeight: 240,
                    overflow: 'auto',
                    fontSize: 12,
                    background: '#f5f5f5',
                    padding: 10,
                    borderRadius: 6
                  }}
                >
                  {r.merged}
                </pre>
              )
            }
          })}
        />
      )}

      <StepRunner
        runKey="step2"
        nodes={nodes}
        actionLabel="应用主机名 & hosts"
        buildPlan={() => ipc.step2Plan(nodes, params)}
        run={(runId) => ipc.step2Run(runId, nodes, params)}
      />
    </Space>
  )
}
