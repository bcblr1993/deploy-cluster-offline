// 步骤 2~6 的占位页（M2+ 逐步实现）。

import { Empty, Typography } from 'antd'

const { Paragraph, Text } = Typography

export default function Placeholder({
  title,
  desc
}: {
  title: string
  desc: string
}) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <Typography style={{ maxWidth: 560, margin: '0 auto' }}>
          <Text strong>{title}</Text>
          <Paragraph type="secondary" style={{ marginTop: 8 }}>
            {desc}
          </Paragraph>
        </Typography>
      }
    />
  )
}
