// 设计稿共用样式（ClusterDeploy）。配合 design.css 的 CSS 变量使用。

import type { CSSProperties } from 'react'

export const display: CSSProperties = { fontFamily: 'var(--display)' }
export const mono: CSSProperties = { fontFamily: 'var(--mono)' }

export type ChipKind = 'ok' | 'neutral' | 'accent' | 'err' | 'warn'
export function chip(kind: ChipKind): CSSProperties {
  const m: Record<ChipKind, CSSProperties> = {
    ok: { background: 'var(--ok-soft)', color: 'var(--ok)' },
    accent: { background: 'var(--accent-soft)', color: 'var(--accent-ink)' },
    err: { background: 'var(--err-soft)', color: 'var(--err)' },
    warn: { background: 'var(--warn-soft)', color: 'var(--warn)' },
    neutral: { background: 'var(--surface-2)', color: 'var(--dim)', border: '1px solid var(--border)' }
  }
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 9px',
    borderRadius: 6,
    fontSize: 11.5,
    fontWeight: 600,
    fontFamily: 'var(--mono)',
    ...m[kind]
  }
}

export const card: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 14,
  background: 'var(--surface)',
  boxShadow: 'var(--card-shadow)',
  overflow: 'hidden'
}

export const th: CSSProperties = {
  padding: '13px 16px',
  fontSize: 11,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'var(--faint)',
  fontWeight: 600,
  fontFamily: 'var(--mono)'
}

export const btnPrimary: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  padding: '9px 17px',
  border: 'none',
  borderRadius: 9,
  background: 'var(--accent)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap'
}
export const btnGhost: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 15px',
  border: '1px solid var(--border)',
  borderRadius: 9,
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit'
}
export const btnTiny: CSSProperties = {
  padding: '5px 12px',
  border: '1px solid var(--border-2)',
  borderRadius: 7,
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap'
}
export const btnTinyDanger: CSSProperties = {
  width: 28,
  height: 28,
  border: '1px solid var(--border)',
  borderRadius: 7,
  background: 'transparent',
  color: 'var(--err)',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
}
export const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 11px',
  borderRadius: 8,
  border: '1px solid var(--border-2)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box'
}
