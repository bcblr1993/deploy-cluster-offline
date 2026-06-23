// §15 危险操作确认弹窗：列出每节点将做什么、受影响项；danger 级需输入确认词。

import { useEffect, useState } from 'react'
import { Alert, Input, List, Modal, Tag, Typography } from 'antd'
import type { ActionLevel, ActionPlan, NodeConfig } from '@shared/types'

const { Text, Paragraph } = Typography

const LEVEL_COLOR: Record<ActionLevel, string> = {
  info: 'blue',
  warning: 'orange',
  danger: 'red'
}
const LEVEL_LABEL: Record<ActionLevel, string> = {
  info: '常规变更',
  warning: '覆盖确认',
  danger: '危险操作'
}

export default function ConfirmActionModal({
  plan,
  nodes,
  onOk,
  onCancel
}: {
  plan: ActionPlan | null
  nodes: NodeConfig[]
  onOk: () => void
  onCancel: () => void
}) {
  const [keyword, setKeyword] = useState('')
  useEffect(() => setKeyword(''), [plan])

  if (!plan) return null
  const ipOf = (id: string): string => nodes.find((n) => n.id === id)?.ip ?? id
  const needKeyword = plan.level === 'danger' && !!plan.requireKeyword
  const okDisabled = needKeyword && keyword !== plan.requireKeyword

  return (
    <Modal
      open={!!plan}
      title={
        <>
          <Tag color={LEVEL_COLOR[plan.level]}>{LEVEL_LABEL[plan.level]}</Tag> 执行前确认
        </>
      }
      okText="确认执行"
      okButtonProps={{ danger: plan.level === 'danger', disabled: okDisabled }}
      cancelText="取消"
      onOk={onOk}
      onCancel={onCancel}
      width={680}
    >
      {plan.level === 'danger' && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="此操作会删除数据/卸载组件，且不可恢复，请仔细核对受影响节点。"
        />
      )}
      <List
        size="small"
        bordered
        dataSource={plan.items}
        style={{ marginBottom: 12, maxHeight: 260, overflow: 'auto' }}
        renderItem={(it) => (
          <List.Item>
            <div style={{ width: '100%' }}>
              <Text strong>{ipOf(it.nodeId)}</Text> — {it.summary}
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  影响：{it.affects.join('；')}
                </Text>
              </div>
              {it.destructive && it.destructive.length > 0 && (
                <div>
                  <Text type="danger" style={{ fontSize: 12 }}>
                    将删除：{it.destructive.join('；')}
                  </Text>
                </div>
              )}
            </div>
          </List.Item>
        )}
      />
      {plan.preview && (
        <Paragraph>
          <Text type="secondary">预览：</Text>
          <pre
            style={{
              background: '#f5f5f5',
              padding: 10,
              borderRadius: 6,
              maxHeight: 180,
              overflow: 'auto',
              fontSize: 12,
              margin: '6px 0 0'
            }}
          >
            {plan.preview}
          </pre>
        </Paragraph>
      )}
      {needKeyword && (
        <div>
          <Text type="danger">
            请输入 <Text code>{plan.requireKeyword}</Text> 以确认：
          </Text>
          <Input
            style={{ marginTop: 6 }}
            value={keyword}
            placeholder={plan.requireKeyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
      )}
    </Modal>
  )
}
