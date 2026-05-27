import type { FC, ReactNode } from 'react'

/** A single editor-facing setting (= a section attribute). */
export interface AttrSpec {
  type: 'text' | 'textarea' | 'color' | 'number' | 'url' | 'boolean'
  default?: unknown
  label?: string
}

/** Props every section component receives. `attributes` are resolved (defaults applied). */
export interface SectionProps {
  attributes: Record<string, any>
  children?: ReactNode
}

/**
 * One section definition — serves all three consumers from a single source:
 *   - dev:        write `component` (React, logic allowed)
 *   - editor:     `attributes` → auto settings UI, `allowedBlocks` → nesting
 *   - storefront: `component` renders the node
 */
export interface SectionDef {
  name: string
  title: string
  category?: string
  icon?: string
  attributes?: Record<string, AttrSpec>
  allowedBlocks?: string[]
  component: FC<SectionProps>
}

/** A node in the content tree (what the editor stores as JSON, never HTML). */
export interface ContentNode {
  type: string
  id?: string
  settings?: Record<string, unknown>
  /** Nested child instances. */
  blocks?: ContentNode[]
}

/** A page = a route + its tree of section instances. */
export interface PageDoc {
  sections: ContentNode[]
}
