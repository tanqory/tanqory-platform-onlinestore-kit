import type { FC, ReactNode } from 'react'

/** A single editor-facing setting (= a section attribute). */
export interface AttrSpec {
  type:
    | 'text'
    | 'textarea'
    | 'color'
    | 'number'
    | 'url'
    | 'boolean'
    | 'select'
    | 'radio'
    | 'richtext'
    | 'html'
    // A left/center/right choice (Shopify `text_alignment`).
    | 'text_alignment'
    // A range slider (min/max/step).
    | 'range'
    // A hosted or external video URL.
    | 'video'
    // Catalogue pickers — the editor renders these as dropdowns fed by the
    // storefront API (value = the entity's handle).
    | 'collection'
    | 'product'
    | 'page'
    | 'blog'
    | 'article'
    // A store menu / link list (value = menu handle).
    | 'menu'
    // Media-library picker — the editor opens the store's central media
    // library (browse or upload). Value is a plain URL string, so section
    // components consume it exactly like 'url'.
    | 'image'
  default?: unknown
  label?: string
  /** Slider bounds — for type 'range'. */
  min?: number
  max?: number
  step?: number
  unit?: string
  /** Placeholder / helper text shown in the editor control. */
  placeholder?: string
  info?: string
  /** Conditional visibility (Shopify-style), e.g. `"{{ section.settings.x == 'y' }}"`. */
  visible_if?: string
  /** For type 'select'/'radio' — the editor renders these as options. */
  options?: { value: string; label: string }[]
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
