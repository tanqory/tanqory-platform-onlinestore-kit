/**
 * THE field-type vocabulary. One hand-edited table; everything else derives.
 *
 * Before this file the vocabulary existed in eight places that disagreed:
 *   kit `AttrSpec['type']` (20) · studio-api `ATTR_TYPES` (20) ·
 *   studio-app `fields.tsx` switch (35) · studio-app `AI_TYPES` (5) ·
 *   ai-api `ALLOWED_FIELD_TYPES` (13) · ai-api section prompt (11) ·
 *   ai-api `extractImageKeys` regex (2) · studio-api dynamic-source `compat` (5)
 *
 * The kit's 20 and studio-api's 20 were set-identical — that pair was already
 * right. The generator was the outlier, and it taught the model `image_picker`,
 * which studio-api rewrites to `'text'`, so every AI section that wanted an
 * image shipped a free-text box instead of the media-library picker.
 *
 * `AttrSpec['type']` is `FieldTypeId | FieldTypeAlias`, derived from this table
 * — so the union and the table cannot disagree. Not "a gate catches it": the
 * disagreement is inexpressible.
 */

/** How the editor renders a control. Consumers assert against this, not the id. */
export type ControlKind =
  | 'text-input'
  | 'textarea'
  | 'rich-text'
  | 'number-input'
  | 'slider'
  | 'color'
  | 'switch'
  | 'segmented'
  | 'select'
  | 'media-picker'
  | 'resource-picker'
  | 'link-picker'

/** The runtime shape a section component receives for this attribute. */
export type ValueKind = 'string' | 'number' | 'boolean' | 'string[]'

export interface FieldTypeDef {
  readonly id: string
  /**
   * `core`     — declarable in `defineSection({ attributes })`.
   * `editorOnly` — the editor can render it from a raw schema block, but the
   *   kit has no concept for it, so a theme cannot declare it. Listed here so
   *   the gap is recorded rather than rediscovered.
   */
  readonly tier: 'core' | 'editorOnly'
  readonly control: ControlKind
  readonly value: ValueKind
  /** Media kind, for `media-picker` controls. */
  readonly media?: 'image' | 'video'
  /** Resource kind, for `resource-picker` controls — what the picker lists. */
  readonly resource?: 'product' | 'collection' | 'page' | 'blog' | 'article' | 'menu'
  /** Constraint keys that are meaningful for THIS type (beyond the universal ones). */
  readonly constraints: readonly string[]
  /** May a merchant bind this to a dynamic source (the ⛁ "Insert dynamic source" UI)? */
  readonly dynamicBindable: boolean
  /** Which metafield/source types the binding picker should offer. */
  readonly dynamicSourceTypes: readonly string[]
  /** May an AI generator emit this type? (policy, not capability) */
  readonly aiGenerate: boolean
  readonly doc: string
}

/**
 * The 20 core types. Set-identical to studio-api's `ATTR_TYPES`, which is the
 * gate that actually decides what reaches the settings panel — anything outside
 * it is silently rewritten to `'text'`.
 */
export const FIELD_TYPES = [
  { id: 'text', tier: 'core', control: 'text-input', value: 'string',
    constraints: [], dynamicBindable: true, dynamicSourceTypes: ['single_line_text_field'],
    aiGenerate: true, doc: 'Single-line text.' },

  { id: 'textarea', tier: 'core', control: 'textarea', value: 'string',
    constraints: [], dynamicBindable: true, dynamicSourceTypes: ['multi_line_text_field'],
    aiGenerate: true, doc: 'Multi-line plain text. No markup.' },

  { id: 'richtext', tier: 'core', control: 'rich-text', value: 'string',
    constraints: [], dynamicBindable: true, dynamicSourceTypes: ['rich_text_field'],
    aiGenerate: true, doc: 'Formatted text. Value is sanitised HTML.' },

  { id: 'html', tier: 'core', control: 'textarea', value: 'string',
    constraints: [], dynamicBindable: false, dynamicSourceTypes: [],
    aiGenerate: false, doc: 'Raw HTML. Author-trusted; never bind to shopper input.' },

  { id: 'number', tier: 'core', control: 'number-input', value: 'number',
    constraints: ['min', 'max', 'step'], dynamicBindable: true, dynamicSourceTypes: ['number_integer', 'number_decimal'],
    aiGenerate: true, doc: 'Numeric input.' },

  { id: 'range', tier: 'core', control: 'slider', value: 'number',
    constraints: ['min', 'max', 'step', 'unit'], dynamicBindable: false, dynamicSourceTypes: [],
    aiGenerate: true, doc: 'Slider. Declare min/max/step or it sits on the 0–100 default.' },

  { id: 'boolean', tier: 'core', control: 'switch', value: 'boolean',
    constraints: [], dynamicBindable: false, dynamicSourceTypes: ['boolean'],
    aiGenerate: true, doc: 'On/off toggle.' },

  { id: 'color', tier: 'core', control: 'color', value: 'string',
    constraints: [], dynamicBindable: false, dynamicSourceTypes: ['color'],
    aiGenerate: true, doc: 'Colour value (hex).' },

  { id: 'select', tier: 'core', control: 'select', value: 'string',
    constraints: ['options'], dynamicBindable: false, dynamicSourceTypes: [],
    aiGenerate: true, doc: 'Dropdown. REQUIRES `options: [{value,label}]`.' },

  { id: 'radio', tier: 'core', control: 'segmented', value: 'string',
    constraints: ['options'], dynamicBindable: false, dynamicSourceTypes: [],
    aiGenerate: true, doc: 'Segmented choice. REQUIRES `options: [{value,label}]`.' },

  { id: 'text_alignment', tier: 'core', control: 'segmented', value: 'string',
    constraints: [], dynamicBindable: false, dynamicSourceTypes: [],
    aiGenerate: true, doc: 'Left/center/right. The editor supplies the three choices.' },

  { id: 'url', tier: 'core', control: 'link-picker', value: 'string',
    constraints: [], dynamicBindable: true, dynamicSourceTypes: ['url'],
    aiGenerate: true, doc: 'A link. The editor offers a link picker, not a raw text box.' },

  { id: 'image', tier: 'core', control: 'media-picker', value: 'string', media: 'image',
    constraints: [], dynamicBindable: true, dynamicSourceTypes: ['file_reference', 'image'],
    aiGenerate: true,
    doc: 'Media-library picker. Value is a plain URL string, consumed exactly like `url`. NOTE: the legacy spelling `image_picker` is an alias — declaring it downgrades the control to a free-text box.' },

  { id: 'video', tier: 'core', control: 'media-picker', value: 'string', media: 'video',
    constraints: [], dynamicBindable: false, dynamicSourceTypes: ['file_reference'],
    aiGenerate: true,
    doc: 'Media-library picker for a hosted video. For an EXTERNAL video URL use `url` — the editor renders this as a library browser, not a URL input.' },

  { id: 'collection', tier: 'core', control: 'resource-picker', value: 'string', resource: 'collection',
    constraints: [], dynamicBindable: false, dynamicSourceTypes: ['collection_reference'],
    aiGenerate: true, doc: 'Collection picker. Value is the collection HANDLE.' },

  { id: 'product', tier: 'core', control: 'resource-picker', value: 'string', resource: 'product',
    constraints: [], dynamicBindable: false, dynamicSourceTypes: ['product_reference'],
    aiGenerate: true, doc: 'Product picker. Value is the product HANDLE.' },

  { id: 'page', tier: 'core', control: 'resource-picker', value: 'string', resource: 'page',
    constraints: [], dynamicBindable: false, dynamicSourceTypes: ['page_reference'],
    aiGenerate: true, doc: 'Page picker. Value is the page HANDLE.' },

  { id: 'blog', tier: 'core', control: 'resource-picker', value: 'string', resource: 'blog',
    constraints: [], dynamicBindable: false, dynamicSourceTypes: [],
    aiGenerate: true, doc: 'Blog picker. Value is the blog HANDLE.' },

  { id: 'article', tier: 'core', control: 'resource-picker', value: 'string', resource: 'article',
    constraints: [], dynamicBindable: false, dynamicSourceTypes: [],
    aiGenerate: true, doc: 'Article picker. Value is the article HANDLE.' },

  { id: 'menu', tier: 'core', control: 'resource-picker', value: 'string', resource: 'menu',
    constraints: [], dynamicBindable: false, dynamicSourceTypes: [],
    aiGenerate: true,
    doc: 'Store menu picker (Dashboard → Navigation). Value is the menu HANDLE. `link_list` is an accepted alias.' },
] as const satisfies readonly FieldTypeDef[]

/**
 * Accepted legacy / alternate spellings, normalised to a core id on input.
 *
 * These are not deprecated typos to reject outright — `fields.tsx` renders
 * several of them identically, and models reach for them from other platforms'
 * vocabularies. Accepting and normalising is what stops a silent downgrade to a
 * text box; the validator still reports them so authored source gets corrected.
 */
export const FIELD_TYPE_ALIASES = {
  image_picker: 'image',
  link_list: 'menu',
  checkbox: 'boolean',
  color_background: 'color',
} as const

/**
 * Types the editor can render but a theme cannot declare, recorded so the gap
 * is visible rather than rediscovered. Promoting one means adding it to
 * FIELD_TYPES *and* to studio-api's gate in the same change.
 */
export const EDITOR_ONLY_TYPES = [
  'inline_richtext', 'color_scheme', 'color_scheme_group',
  'font_picker', 'product_list', 'collection_list', 'metaobject',
  'video_url', 'header', 'paragraph',
] as const

export type FieldTypeId = (typeof FIELD_TYPES)[number]['id']
export type FieldTypeAlias = keyof typeof FIELD_TYPE_ALIASES
export type AnyFieldType = FieldTypeId | FieldTypeAlias

const BY_ID = new Map<string, FieldTypeDef>(FIELD_TYPES.map((t) => [t.id, t]))

/** Resolve an authored type (possibly an alias) to its canonical id, or null. */
export function canonicalFieldType(declared: unknown): FieldTypeId | null {
  if (typeof declared !== 'string') return null
  const alias = (FIELD_TYPE_ALIASES as Record<string, string>)[declared]
  const id = alias ?? declared
  return BY_ID.has(id) ? (id as FieldTypeId) : null
}

/** The definition for a canonical id. */
export function fieldType(id: string): FieldTypeDef | undefined {
  return BY_ID.get(id)
}

/** Universal constraint keys, meaningful for every type. */
export const UNIVERSAL_CONSTRAINTS = [
  'default', 'label', 'info', 'placeholder', 'group', 'dynamic', 'visible_if',
] as const
