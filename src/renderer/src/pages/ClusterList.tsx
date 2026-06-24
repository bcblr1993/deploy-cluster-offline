// 集群列表页（启动落地页，docs/06）：按分组管理多个集群。

import { useCallback, useEffect, useState } from 'react'
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Row,
  Space,
  Tag,
  Typography
} from 'antd'
import {
  ClusterOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RightOutlined
} from '@ant-design/icons'
import { useWizard } from '../store/wizard'
import { ipc } from '../ipc/client'
import type { ClusterSummary } from '@shared/types'

const { Text, Title, Paragraph } = Typography

export default function ClusterList() {
  const { message, modal } = App.useApp()
  const { openCluster } = useWizard()
  const [clusters, setClusters] = useState<ClusterSummary[]>([])
  const [edit, setEdit] = useState<{ id?: string; name: string; remark: string } | null>(null)

  const refresh = useCallback(async () => {
    setClusters(await ipc.clustersList())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function enter(id: string) {
    const c = await ipc.clusterLoad(id)
    if (c) openCluster(c)
    else message.error('集群不存在')
  }

  async function submitEdit() {
    if (!edit || !edit.name.trim()) {
      message.warning('请输入集群名称')
      return
    }
    if (edit.id) {
      await ipc.clusterRename(edit.id, edit.name.trim(), edit.remark || undefined)
      setEdit(null)
      refresh()
    } else {
      const c = await ipc.clusterCreate(edit.name.trim(), edit.remark || undefined)
      setEdit(null)
      openCluster(c) // 新建后直接进入（步骤1）
    }
  }

  function confirmDelete(c: ClusterSummary) {
    modal.confirm({
      title: `删除集群「${c.name}」？`,
      content: '仅删除本地集群配置，不会影响远程物理节点或其上运行的服务。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await ipc.clusterDelete(c.id)
        refresh()
      }
    })
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <ClusterOutlined /> 集群管理
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setEdit({ name: '', remark: '' })}
        >
          新建集群
        </Button>
      </Space>

      {clusters.length === 0 ? (
        <Empty description="还没有集群，点「新建集群」开始（如：日新鸿晟 / 一汽现场）" style={{ marginTop: 80 }} />
      ) : (
        <Row gutter={[16, 16]}>
          {clusters.map((c) => (
            <Col key={c.id} xs={24} sm={12} lg={8}>
              <Card
                hoverable
                onClick={() => enter(c.id)}
                title={
                  <Space>
                    <Text strong>{c.name}</Text>
                    {c.deployed ? <Tag color="green">已部署</Tag> : <Tag>未部署</Tag>}
                  </Space>
                }
                extra={<RightOutlined />}
                actions={[
                  <EditOutlined
                    key="edit"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEdit({ id: c.id, name: c.name, remark: c.remark ?? '' })
                    }}
                  />,
                  <DeleteOutlined
                    key="del"
                    onClick={(e) => {
                      e.stopPropagation()
                      confirmDelete(c)
                    }}
                  />
                ]}
              >
                <Paragraph type="secondary" style={{ marginBottom: 8, minHeight: 22 }}>
                  {c.remark || '（无备注）'}
                </Paragraph>
                <Text type="secondary">
                  {c.nodeCount} 个节点 · 进入将{c.deployed ? '直达运维总览' : '进入部署向导'}
                </Text>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        open={!!edit}
        title={edit?.id ? '重命名集群' : '新建集群'}
        okText={edit?.id ? '保存' : '创建并进入'}
        cancelText="取消"
        onOk={submitEdit}
        onCancel={() => setEdit(null)}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            autoFocus
            placeholder="集群名称（如：日新鸿晟 / 一汽现场）"
            value={edit?.name}
            onChange={(e) => setEdit((s) => (s ? { ...s, name: e.target.value } : s))}
            onPressEnter={submitEdit}
          />
          <Input
            placeholder="备注（可选）"
            value={edit?.remark}
            onChange={(e) => setEdit((s) => (s ? { ...s, remark: e.target.value } : s))}
          />
        </Space>
      </Modal>
    </div>
  )
}
