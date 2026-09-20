/**
 * The shared validator — the one implementation the Editor API, the CLI and the
 * AI tools all call, so "valid" means the same thing in all three.
 *
 * Each case names the real failure it prevents; several are defects found in
 * Nova and in the AI generator during the contract audit.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FIELD_TYPES,
  FIELD_TYPE_ALIASES,
  canonicalFieldType,
  validateDocument,
  validateSectionContract,
  formatIssues,
} from '../dist/contract.js'

const CATALOG = {
  hero: {
    name: 'hero',
    title: 'Hero',
    attributes: {
      heading: { type: 'text', default: 'Hello' },
      image: { type: 'image', label: 'Background' },
      align: { type: 'select', options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }] },
      columns: { type: 'range', min: 2, max: 4, step: 1 },
    },
    allowedBlocks: ['button'],
  },
  button: { name: 'button', title: 'Button', attributes: { label: { type: 'text' } } },
  'product-details': {
    name: 'product-details',
    title: 'Product details',
    attributes: {},
    requiresContext: ['product'],
  },
}

const doc = (sections) => ({ sections })
const codes = (r) => r.issues.map((i) => i.code)

test('every field type resolves, and every alias resolves to a core id', () => {
  for (const t of FIELD_TYPES) assert.equal(canonicalFieldType(t.id), t.id)
  for (const [alias, target] of Object.entries(FIELD_TYPE_ALIASES)) {
    assert.equal(canonicalFieldType(alias), target, `${alias} → ${target}`)
  }
  assert.equal(canonicalFieldType('definitely_not_a_type'), null)
})

test('image_picker is accepted as an alias but reported — the AI generator defect', () => {
  // ai-api's section prompt teaches `type: 'image_picker'`; studio-api rewrites
  // anything outside its vocabulary to 'text', so the merchant got a free-text
  // box instead of the media picker. Accept-and-report is what fixes it.
  const r = validateSectionContract({
    name: 'hero', title: 'Hero',
    attributes: { image: { type: 'image_picker', label: 'Background image' } },
  })
  assert.equal(r.ok, true, 'an alias is not fatal')
  const issue = r.issues.find((i) => i.code === 'alias_field_type')
  assert.ok(issue)
  assert.equal(issue.suggestion, 'image')
  assert.match(issue.message, /use "image"/)
})

test('an unknown field type is an error that names the consequence', () => {
  const r = validateSectionContract({
    name: 'hero', title: 'Hero',
    attributes: { thing: { type: 'colour_picker' } },
  })
  assert.equal(r.ok, false)
  assert.equal(codes(r)[0], 'unknown_field_type')
  assert.match(r.issues[0].message, /downgraded to a plain text box/)
})

test('an editor-only type is distinguished from a typo', () => {
  const r = validateSectionContract({
    name: 'hero', title: 'Hero',
    attributes: { scheme: { type: 'color_scheme' } },
  })
  assert.equal(codes(r)[0], 'editor_only_field_type')
})

test('select without options is rejected — an empty dropdown ships otherwise', () => {
  const r = validateSectionContract({
    name: 'x', title: 'X', attributes: { mode: { type: 'select' } },
  })
  assert.equal(r.ok, false)
  assert.ok(codes(r).includes('missing_required_constraint'))
})

test('a constraint that does nothing on its type is flagged — the `columns` class', () => {
  // Nova shipped eight templates setting `columns` on sections that never
  // declared it; the value was dropped at render and invisible in the editor.
  const r = validateSectionContract({
    name: 'x', title: 'X', attributes: { heading: { type: 'text', min: 2, max: 4 } },
  })
  const bad = r.issues.filter((i) => i.code === 'invalid_value')
  assert.equal(bad.length, 2)
  assert.match(bad[0].message, /no meaning for field type "text"/)
})

test('binding a non-bindable type is rejected', () => {
  const r = validateSectionContract({
    name: 'x', title: 'X', attributes: { on: { type: 'boolean', dynamic: true } },
  })
  assert.equal(r.ok, false)
  assert.ok(codes(r).includes('invalid_binding'))
})

test('a preset that nests a disallowed block is rejected', () => {
  const r = validateSectionContract({
    name: 'faq', title: 'FAQ',
    attributes: {},
    allowedBlocks: ['faq-item'],
    presets: [{ blocks: [{ type: 'button', settings: {} }] }],
  })
  assert.equal(r.ok, false)
  assert.equal(codes(r)[0], 'disallowed_nesting')
})

test('unknown component is an error with a usable path', () => {
  const r = validateDocument(doc([{ type: 'nope', id: 'a', settings: {} }]), CATALOG)
  assert.equal(r.ok, false)
  assert.equal(r.issues[0].code, 'unknown_component')
  assert.equal(r.issues[0].path, 'sections[0].type')
  assert.equal(r.issues[0].nodeId, 'a')
})

test('unknown setting is an error and suggests the near miss', () => {
  const r = validateDocument(
    doc([{ type: 'hero', id: 'h1', settings: { headng: 'typo' } }]),
    CATALOG,
  )
  assert.equal(r.ok, false)
  const i = r.issues[0]
  assert.equal(i.code, 'unknown_setting')
  assert.equal(i.path, 'sections[0].settings.headng')
  assert.equal(i.suggestion, 'heading')
  assert.match(i.message, /Did you mean "heading"\?/)
})

test('unknown setting can be downgraded to a warning for tolerant reads', () => {
  const r = validateDocument(
    doc([{ type: 'hero', id: 'h1', settings: { headng: 'typo' } }]),
    CATALOG,
    { lenientSettings: true },
  )
  assert.equal(r.ok, true)
  assert.equal(r.issues[0].severity, 'warning')
})

test('a value outside the declared options is rejected', () => {
  const r = validateDocument(
    doc([{ type: 'hero', id: 'h1', settings: { align: 'centre' } }]),
    CATALOG,
  )
  assert.equal(r.ok, false)
  assert.equal(r.issues[0].code, 'invalid_value')
  assert.equal(r.issues[0].suggestion, 'center')
})

test('a number outside min/max is rejected', () => {
  const r = validateDocument(
    doc([{ type: 'hero', id: 'h1', settings: { columns: 9 } }]),
    CATALOG,
  )
  assert.equal(r.ok, false)
  assert.match(r.issues[0].message, /above the maximum 4/)
})

test('a wrong value type is rejected', () => {
  const r = validateDocument(
    doc([{ type: 'hero', id: 'h1', settings: { heading: 42 } }]),
    CATALOG,
  )
  assert.equal(r.ok, false)
  assert.match(r.issues[0].message, /Expected string .* got number/)
})

test('nesting into a leaf section is rejected', () => {
  const r = validateDocument(
    doc([{ type: 'button', id: 'b1', settings: {}, blocks: [{ type: 'button', id: 'b2', settings: {} }] }]),
    CATALOG,
  )
  assert.equal(r.ok, false)
  assert.equal(r.issues[0].code, 'leaf_cannot_nest')
})

test('nesting a block the parent does not allow is rejected', () => {
  const r = validateDocument(
    doc([{ type: 'hero', id: 'h1', settings: {}, blocks: [{ type: 'hero', id: 'h2', settings: {} }] }]),
    CATALOG,
  )
  assert.equal(r.ok, false)
  assert.equal(r.issues[0].code, 'disallowed_nesting')
  assert.match(r.issues[0].message, /Allowed: button/)
})

test('a missing node id is an error that explains the positional hazard', () => {
  const r = validateDocument(doc([{ type: 'hero', settings: {} }]), CATALOG)
  assert.equal(r.ok, false)
  const i = r.issues.find((x) => x.code === 'missing_node_id')
  assert.ok(i)
  assert.match(i.message, /POSITION/)
  assert.match(i.suggestion, /^hero_/)
})

test('an invalid area is rejected against the declared three', () => {
  const r = validateDocument(
    doc([{ type: 'hero', id: 'h1', settings: {}, area: 'sidebar' }]),
    CATALOG,
  )
  assert.equal(r.ok, false)
  assert.equal(r.issues[0].code, 'invalid_area')
  assert.match(r.issues[0].message, /header, template, footer/)
})

test('missing route context: an ERROR when the caller knows the context, a warning when it does not', () => {
  // The caller names the context the template provides — a product block on
  // the cart page renders a not-found state on every visit, so it is refused.
  const known = validateDocument(
    doc([{ type: 'product-details', id: 'pd', settings: {} }]),
    CATALOG,
    { context: [] },
  )
  assert.equal(known.ok, false, 'rejected where the context is known to be absent')
  assert.equal(known.issues[0].code, 'missing_context')
  assert.equal(known.issues[0].severity, 'error')

  // No context named at all → surfaced, not fatal: the caller has not said
  // where this will render.
  const unknown = validateDocument(doc([{ type: 'product-details', id: 'pd', settings: {} }]), CATALOG)
  assert.equal(unknown.ok, true)
  assert.equal(unknown.issues[0].code, 'missing_context')
  assert.equal(unknown.issues[0].severity, 'warning')

  const satisfied = validateDocument(
    doc([{ type: 'product-details', id: 'pd', settings: {} }]),
    CATALOG,
    { context: ['product'] },
  )
  assert.equal(satisfied.ok, true)
  assert.deepEqual(satisfied.issues, [])
})

test('the editor object-map shape is rejected at the disk boundary', () => {
  // Writing the editor's map to disk crashed every render with
  // "o.map is not a function" — SectionTree does node.blocks?.map.
  const r = validateDocument({ sections: { h1: { type: 'hero' } } }, CATALOG)
  assert.equal(r.ok, false)
  assert.match(r.issues[0].message, /must have a `sections` array/)
})

test('formatIssues renders something a human or a repair loop can act on', () => {
  const r = validateDocument(
    doc([{ type: 'hero', id: 'h1', settings: { headng: 'x' } }]),
    CATALOG,
  )
  const out = formatIssues(r.issues)
  assert.match(out, /^✗ \[unknown_setting\] sections\[0\]\.settings\.headng:/)
})
