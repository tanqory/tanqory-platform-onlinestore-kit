import type { FC, ReactNode } from 'react'
import type { SectionDef } from './types'

/**
 * A section used inside a *page composition* takes `settings` (literal) + nested
 * children — never `attributes`. `tag(SectionDef)` returns it typed for that
 * composition use. The element is only ever walked by jsxToJSON (never rendered
 * directly), which is what keeps page files pure data.
 */
export type Tag = FC<{ settings?: Record<string, unknown>; children?: ReactNode }>

export function tag(def: SectionDef): Tag {
  return def.component as unknown as Tag
}
