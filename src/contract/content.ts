/**
 * The content-tree contract: what a `templates/<slug>.json` may contain, and
 * the node-identity rules every producer (Editor, AI, theme author) must follow.
 *
 * Node identity is the part that was never written down, and it is the part the
 * round trip depends on. Today:
 *
 *   - The Editor mints `${type}_${uuid8}` (`tanqory-template-context.tsx:379`)
 *     — stable and unique. Correct.
 *   - `blocksToStudio` (`editor-routes.mjs:49-62`) falls back to
 *     `` `${b.type}-${i}` `` for a block with no id — a POSITIONAL identity.
 *     Reorder the array on disk and `faq-item-0` now means a different question.
 *   - `themekitToStudio` falls back to `s.id ?? s.type` for a section — so two
 *     sections of the same type with no id COLLIDE in the `sections` map and the
 *     second silently overwrites the first.
 *
 * Both fallbacks are silent. Neither is safe for "AI edits one answer without
 * clobbering the others", which is exactly what this contract has to make true.
 * The rule below is therefore: **every node carries an explicit, stable id.**
 */

/** A node in the content tree — a section instance or a child block. */
export interface ContractNode {
  /** The section/block definition name this instantiates. */
  type: string
  /** Stable identity. Required by this contract; see `mintNodeId`. */
  id: string
  settings?: Record<string, unknown>
  blocks?: ContractNode[]
  /**
   * Layout slot. Nova's templates use this 43 times; nothing in the kit or the
   * theme reads it, and the Editor's save round-trip currently DROPS it
   * (neither `themekitToStudio` nor `studioToThemekit` mentions it).
   * Declared here so it is a known key with known values — a converter that
   * preserves the contract's keys preserves this one.
   */
  area?: TemplateArea
}

export type TemplateArea = 'header' | 'template' | 'footer'
export const TEMPLATE_AREAS: readonly TemplateArea[] = ['header', 'template', 'footer']

/** A template document as stored at `templates/<slug>.json`. */
export interface ContractPageDoc {
  sections: ContractNode[]
  /**
   * Content-format version.
   *   absent / 1 — inline header + footer sections in every template (legacy;
   *                still fully supported, resolved as an implicit per-page copy)
   *   2          — `groups` bindings: header/footer come from a shared
   *                `groups/<name>.json` unless the page overrides them.
   * A future shape change bumps this and gets a migration, instead of silently
   * orphaning a merchant's customisation the way a path-prefix merge does.
   */
  contentVersion?: number
  /**
   * Shared-slot bindings (content version 2). See `groups.ts` for the shape.
   * Declared here as `unknown` so the base document type stays independent of
   * the group module; `GroupedPageDoc` narrows it.
   */
  groups?: unknown
}

export const CURRENT_CONTENT_VERSION = 2

/**
 * Node ids must be URL-safe, stable across saves, and unique within their
 * parent. Readable prefixes are deliberate: `faq-item_a1b2c3d4` is greppable in
 * a diff, which matters when the thing being diffed is a merchant's content.
 */
export const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Mint a stable node id. Matches the Editor's own scheme
 * (`tanqory-template-context.tsx:379`) so a node authored by AI and a node
 * authored by a human are indistinguishable downstream.
 */
export function mintNodeId(type: string, rand: () => string = defaultRand): string {
  const base = String(type).replace(/[^a-z0-9]/gi, '-').replace(/^-+|-+$/g, '') || 'node'
  return `${base}_${rand()}`
}

function defaultRand(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0')
}

/**
 * What a section definition promises. This is `SectionDef` minus `component` —
 * the serialisable half — plus the two things the platform needs and no
 * existing artifact carries: the context a section requires, and which runtimes
 * it works against.
 */
export interface SectionContract {
  name: string
  title: string
  category?: string
  icon?: string
  attributes: Record<string, AttrContract>
  /** Block types that may nest inside. Empty/absent = a leaf section. */
  allowedBlocks?: string[]
  /** Starting compositions. `presets[0]` is what the inserter should seed. */
  presets?: SectionPresetContract[]
  /**
   * Route context the section needs to render meaningfully — e.g. a PDP section
   * needs `product`. When the validator is told which context the template
   * provides, placing a section outside its context is an ERROR (the section
   * would render a not-found state on every visit); with no context supplied
   * it degrades to a warning, since the caller has not said where this is.
   */
  requiresContext?: readonly ContextKind[]
  /**
   * What kind of unit this is. Explicit, because `category` is a DISPLAY
   * grouping for the inserter and was being read as a placement rule
   * (`category === 'block'` decided which picker offered it).
   *   section — a top-level page unit
   *   block   — only nests inside a parent that lists it in `allowedBlocks`
   *   layout  — chrome: header/footer/announcement; lives in a shared group
   * Absent = derived: `category: 'block'` → block; `area` declared → layout;
   * otherwise section.
   */
  role?: SectionRole
  /**
   * Default slot for a layout section — where the editor files it when added
   * without one, and where the AI should place it. Also the only slot it may
   * be placed in unless `placement.areas` widens that.
   */
  area?: TemplateArea
  /** Where this unit may be placed. Every list is an allowlist; absent = anywhere of its role. */
  placement?: PlacementContract
}

export type SectionRole = 'section' | 'block' | 'layout'
export const SECTION_ROLES: readonly SectionRole[] = ['section', 'block', 'layout']

export interface PlacementContract {
  /** Slots this unit may occupy. A block ignores this (its parent decides). */
  areas?: readonly TemplateArea[]
  /** Base template slugs (`product`, `collection`, …) it may appear on. */
  templates?: readonly string[]
  /** For a block: the parent types that may host it (mirrors the parents' `allowedBlocks`). */
  parents?: readonly string[]
}

/** The effective role, applying the documented fallbacks for definitions that predate `role`. */
export function roleOf(def: Pick<SectionContract, 'role' | 'category' | 'area' | 'name'>): SectionRole {
  if (def.role) return def.role
  if (def.category === 'block') return 'block'
  if (def.area === 'header' || def.area === 'footer') return 'layout'
  if (def.name === 'header' || def.name === 'footer') return 'layout'
  return 'section'
}

/**
 * The route context a template provides, from its base slug. `product.bundle`
 * is still a product page. Used as the validator's default `context` when a
 * caller names the template rather than listing kinds by hand.
 */
export function templateContext(slug: string): ContextKind[] {
  const base = String(slug ?? '').split('.')[0] ?? ''
  switch (base) {
    case 'product': return ['product']
    case 'collection': return ['collection']
    case 'page': return ['page']
    case 'blog': return ['blog']
    case 'article': return ['article', 'blog']
    case 'cart': return ['cart']
    case 'search': return ['search']
    default: return []
  }
}

export type ContextKind = 'product' | 'collection' | 'page' | 'blog' | 'article' | 'cart' | 'search'
export const CONTEXT_KINDS: readonly ContextKind[] = [
  'product', 'collection', 'page', 'blog', 'article', 'cart', 'search',
]

export interface SectionPresetContract {
  name?: string
  settings?: Record<string, unknown>
  blocks?: Array<Omit<ContractNode, 'id'> & { id?: string }>
}

/** One editor-facing setting. Mirrors `AttrSpec`, stated structurally. */
export interface AttrContract {
  type: string
  default?: unknown
  label?: string
  info?: string
  placeholder?: string
  group?: string
  dynamic?: boolean
  visible_if?: string | Record<string, unknown>
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: Array<{ value: string; label: string }>
}
