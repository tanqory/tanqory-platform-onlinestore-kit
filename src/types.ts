import type { FC, ReactNode } from 'react'
import type { AnyFieldType } from './contract/field-types'
import type { ContextKind, PlacementContract, SectionRole, TemplateArea } from './contract/content'
import type { GroupBinding, SectionGroupDoc } from './contract/groups'

/** A single editor-facing setting (= a section attribute). */
export interface AttrSpec {
  /**
   * The control the editor renders.
   *
   * DERIVED from `contract/field-types.ts` — the union is
   * `FieldTypeId | FieldTypeAlias`, computed from the one table that also feeds
   * the validator, studio-api's gate and the AI generator's allowlist. They
   * cannot drift apart because they are not written down twice.
   *
   * Every id carries its own documentation in that table (what the control is,
   * what the runtime value looks like, whether it can be bound to a dynamic
   * source). Read it there rather than duplicating prose here.
   */
  type: AnyFieldType
  default?: unknown
  label?: string
  /**
   * Editor panel heading this control is filed under (e.g. 'Brand', 'Header').
   * Consumed by the theme-settings panel and by a theme's manifest generator,
   * which groups `defineSettings({...})` entries by this key. Undeclared
   * settings fall into 'General'.
   */
  group?: string
  /**
   * Opt this setting into "Insert dynamic source" (the ⛁ binding UI): the
   * merchant may bind it to a product/collection/shop property or metaobject
   * field instead of typing a literal. See `dynamic-source.tsx`.
   */
  dynamic?: boolean
  /** Slider bounds — for type 'range'. */
  min?: number
  max?: number
  step?: number
  unit?: string
  /** Placeholder / helper text shown in the editor control. */
  placeholder?: string
  info?: string
  /** Conditional visibility (commerce-standard), e.g. `"{{ section.settings.x == 'y' }}"`. */
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
  /**
   * Starting compositions offered when the section is inserted. `presets[0]` is
   * the default: `renderSectionPreviewHTML` seeds the preview with its blocks so
   * a block-composed section doesn't render empty in the inserter.
   *
   * Declared here because the runtime already reads it (`ssg.tsx`) — it was
   * reached through a cast while the type omitted it, so every theme that
   * shipped a preset failed `tsc` on its own section definitions.
   */
  presets?: SectionPreset[]
  /**
   * What kind of unit this is — `section` (page unit), `block` (nests inside a
   * parent's `allowedBlocks`) or `layout` (header/footer chrome, lives in a
   * shared group). Explicit, because `category` is a display grouping and was
   * being read as a placement rule. Absent = derived; see contract `roleOf`.
   */
  role?: SectionRole
  /** Default slot for a layout section (`header` | `footer`). */
  area?: TemplateArea
  /** Allowlists for where this unit may be placed. */
  placement?: PlacementContract
  /** Route context this section needs (`product`, `collection`, …). */
  requiresContext?: readonly ContextKind[]
  component: FC<SectionProps>
}

/** One starting composition for a section (see `SectionDef.presets`). */
export interface SectionPreset {
  /** Optional label shown in the inserter when a section offers several. */
  name?: string
  /** Section settings this preset starts from. */
  settings?: Record<string, unknown>
  /** Child block instances this preset starts from. */
  blocks?: ContentNode[]
}

/** A node in the content tree (what the editor stores as JSON, never HTML). */
export interface ContentNode {
  type: string
  id?: string
  settings?: Record<string, unknown>
  /** Nested child instances. */
  blocks?: ContentNode[]
  /** Layout slot: `header` | `template` | `footer`. */
  area?: TemplateArea
}

/** A node in the content tree — `area` is the layout slot it belongs to. */

/** A page = a route + its tree of section instances. */
export interface PageDoc {
  sections: ContentNode[]
  /**
   * Shared header/footer bindings (content version 2): `"header"` references
   * `groups/header.json`; `{ override: [...] }` is a page-specific composition.
   * Absent → the page's inline header/footer sections are used (version 1).
   */
  groups?: Partial<Record<'header' | 'footer', GroupBinding>>
  contentVersion?: number
}

export type { SectionGroupDoc }
