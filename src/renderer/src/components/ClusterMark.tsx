// 品牌标志 ClusterMark — 按 Brand.dc.html / ClusterMark.dc.html 像素级复刻。
// 三节点集群拓扑（主节点带环 + 两工作节点 + 连线），承托于圆角「应用容器」，
// 可选右下角绿色「在线」脉冲点。viewBox 固定 96×96，按 size 缩放。

import type { CSSProperties } from 'react'

export type ClusterMarkVariant = 'brand' | 'deep' | 'soft' | 'monoDark' | 'monoLight'

interface VariantSpec {
  bg: string
  node: string
  line: string
  ring: string
  edge: string
  hasBg: boolean
}

const VARIANTS: Record<ClusterMarkVariant, VariantSpec> = {
  brand: { bg: '#1f7bf0', node: '#ffffff', line: 'rgba(255,255,255,.5)', ring: 'rgba(255,255,255,.92)', edge: 'rgba(255,255,255,.16)', hasBg: true },
  deep: { bg: '#0e1320', node: '#5fa8ff', line: 'rgba(95,168,255,.5)', ring: 'rgba(95,168,255,.95)', edge: 'rgba(255,255,255,.08)', hasBg: true },
  soft: { bg: '#e9f1fd', node: '#1f7bf0', line: 'rgba(31,123,240,.4)', ring: 'rgba(31,123,240,.9)', edge: 'rgba(20,50,100,.06)', hasBg: true },
  monoDark: { bg: 'transparent', node: '#15171b', line: 'rgba(21,23,27,.45)', ring: 'rgba(21,23,27,.92)', edge: 'transparent', hasBg: false },
  monoLight: { bg: 'transparent', node: '#ffffff', line: 'rgba(255,255,255,.5)', ring: 'rgba(255,255,255,.95)', edge: 'transparent', hasBg: false }
}

const PIP_COLOR = '#16a35c'

interface ClusterMarkProps {
  /** 渲染像素尺寸（宽=高），默认 96 */
  size?: number
  variant?: ClusterMarkVariant
  /** 是否显示右下角「在线」绿点 */
  pip?: boolean
  /** 圆角比例（相对 96），默认 0.225 */
  radiusRatio?: number
  /** 绿点是否脉冲动画（仅 pip 时生效） */
  pulse?: boolean
  style?: CSSProperties
  className?: string
  title?: string
}

export default function ClusterMark({
  size = 96,
  variant = 'brand',
  pip = false,
  radiusRatio = 0.225,
  pulse = false,
  style,
  className,
  title
}: ClusterMarkProps) {
  const c = VARIANTS[variant] ?? VARIANTS.brand
  const radius = 96 * radiusRatio
  const radiusInner = Math.max(0, radius - 1.1)

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title ?? '离线集群部署'}
      className={className}
      style={{ display: 'block', overflow: 'visible', ...style }}
    >
      {title && <title>{title}</title>}
      {c.hasBg && <rect x={0} y={0} width={96} height={96} rx={radius} ry={radius} fill={c.bg} />}
      {c.edge !== 'transparent' && (
        <rect x={1.1} y={1.1} width={93.8} height={93.8} rx={radiusInner} ry={radiusInner} fill="none" stroke={c.edge} strokeWidth={1.6} />
      )}
      {/* connectors */}
      <g stroke={c.line} strokeWidth={3.1} strokeLinecap="round">
        <line x1={48} y1={33} x2={30} y2={63} />
        <line x1={48} y1={33} x2={66} y2={63} />
        <line x1={30} y1={63} x2={66} y2={63} />
      </g>
      {/* primary node ring */}
      <circle cx={48} cy={32} r={13} fill="none" stroke={c.ring} strokeWidth={2.3} />
      {/* nodes */}
      <circle cx={48} cy={32} r={8.4} fill={c.node} />
      <circle cx={30} cy={64} r={6.7} fill={c.node} />
      <circle cx={66} cy={64} r={6.7} fill={c.node} />
      {/* online pip */}
      {pip && (
        <>
          <circle cx={78} cy={78} r={13.5} fill={c.hasBg ? c.bg : 'var(--surface)'} />
          <circle cx={78} cy={78} r={9.5} fill={PIP_COLOR}>
            {pulse && <animate attributeName="opacity" values="1;.45;1" dur="1.8s" repeatCount="indefinite" />}
          </circle>
        </>
      )}
    </svg>
  )
}
