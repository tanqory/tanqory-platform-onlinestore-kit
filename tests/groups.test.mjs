/**
 * Shared section groups — the contract every consumer resolves through.
 *
 * Each test names the acceptance criterion it backs:
 *   A  one shared header, three pages, one edit → all three change
 *   B  a page-specific override survives save/reload
 *   D  a block that needs product context is rejected off a product template
 *   F  migration keeps ids/settings/blocks/order/area, and re-running is a no-op
 *   G  targeted edits key by stable id; a retried insert does not duplicate
 *
 * Runs against `dist/contract.js` — the single file studio-api vendors — so
 * what is proven here is what the Editor API executes.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolvePage,
  resolvePageFrom,
  splitPage,
  extractGroups,
  groupImpact,
  slotSignature,
  validatePage,
  validateGroup,
  validateDocument,
  templateContext,
  roleOf,
  CURRENT_CONTENT_VERSION,
} from '../dist/contract.js'

/** A catalogue with the three roles and a context-bound block. */
const CATALOG = {
  header: { name: 'header', title: 'Header', role: 'layout', area: 'header',
    attributes: { sticky: { type: 'select', default: 'always', options: [{ value: 'always', label: 'Always' }, { value: 'none', label: 'Never' }] } } },
  'announcement-bar': { name: 'announcement-bar', title: 'Announcement', role: 'layout', area: 'header',
    attributes: { text: { type: 'text' } } },
  footer: { name: 'footer', title: 'Footer', role: 'layout', area: 'footer', attributes: {}, allowedBlocks: ['footer-menu'] },
  'footer-menu': { name: 'footer-menu', title: 'Menu', role: 'block', attributes: { menu: { type: 'menu' } } },
  hero: { name: 'hero', title: 'Hero', role: 'section', attributes: { heading: { type: 'text' } } },
  faq: { name: 'faq', title: 'FAQ', attributes: { heading: { type: 'text' } }, allowedBlocks: ['faq-item'] },
  'faq-item': { name: 'faq-item', title: 'Question', category: 'block',
    attributes: { question: { type: 'text' }, answer: { type: 'textarea' } } },
  'product-details': { name: 'product-details', title: 'Product', attributes: {}, requiresContext: ['product'],
    allowedBlocks: ['add-to-cart'] },
  'add-to-cart': { name: 'add-to-cart', title: 'Add to cart', role: 'block', attributes: {}, requiresContext: ['product'] },
}

const header = () => ({ type: 'header', id: 'header', settings: {}, area: 'header' })
const footer = () => ({ type: 'footer', id: 'footer', settings: {}, area: 'footer',
  blocks: [{ type: 'footer-menu', id: 'footer-menu_shop', settings: { menu: 'footer-shop' } }] })

const GROUPS = {
  header: { type: 'header', sections: [{ type: 'header', id: 'header', settings: { sticky: 'always' } }] },
  footer: { type: 'footer', sections: [footer()] },
}

// ── resolution ───────────────────────────────────────────────────────────

test('a legacy template (inline header/footer, no groups key) resolves exactly as before', () => {
  const tpl = { sections: [header(), { type: 'hero', id: 'hero_1', settings: {} }, footer()] }
  const r = resolvePage(tpl, GROUPS)
  assert.deepEqual(r.sections.map((s) => s.id), ['header', 'hero_1', 'footer'])
  assert.equal(r.slots.header.mode, 'inline')
  assert.equal(r.slots.footer.mode, 'inline')
  assert.deepEqual(r.provenance.header, { kind: 'inline', slot: 'header' })
  assert.deepEqual(r.provenance.hero_1, { kind: 'template' })
  assert.deepEqual(r.missingGroups, [])
})

test('A — a template bound to a group renders the group; the group node carries its slot as `area`', () => {
  const tpl = { contentVersion: 2, groups: { header: 'header', footer: 'footer' },
    sections: [{ type: 'hero', id: 'hero_1', settings: {} }] }
  const r = resolvePage(tpl, GROUPS)
  assert.deepEqual(r.sections.map((s) => s.id), ['header', 'hero_1', 'footer'])
  assert.equal(r.sections[0].area, 'header')
  assert.equal(r.sections[0].settings.sticky, 'always')
  assert.deepEqual(r.provenance.header, { kind: 'group', slot: 'header', group: 'header' })
  assert.equal(r.slots.footer.mode, 'ref')
  assert.equal(r.slots.footer.group, 'footer')
})

test('A — one edit to the group changes every page that binds it', () => {
  const pages = {
    index: { groups: { header: 'header' }, sections: [{ type: 'hero', id: 'h', settings: {} }] },
    product: { groups: { header: 'header' }, sections: [{ type: 'product-details', id: 'pd', settings: {} }] },
    collection: { groups: { header: 'header' }, sections: [] },
  }
  const edited = { header: { type: 'header', sections: [{ type: 'header', id: 'header', settings: { sticky: 'none' } }] } }
  for (const doc of Object.values(pages)) {
    assert.equal(resolvePage(doc, edited).sections[0].settings.sticky, 'none')
  }
  assert.deepEqual(groupImpact('header', pages), ['collection', 'index', 'product'])
})

test('B — an override is rendered instead of the group and reported as such', () => {
  const tpl = {
    groups: {
      header: { override: [{ type: 'announcement-bar', id: 'ab', settings: { text: 'Sale' } }, header()] },
      footer: 'footer',
    },
    sections: [],
  }
  const r = resolvePage(tpl, GROUPS)
  assert.deepEqual(r.sections.map((s) => s.id), ['ab', 'header', 'footer'])
  assert.equal(r.slots.header.mode, 'override')
  assert.deepEqual(r.provenance.ab, { kind: 'override', slot: 'header' })
  assert.deepEqual(r.provenance.footer, { kind: 'group', slot: 'footer', group: 'footer' })
})

test('a binding wins over inline nodes for the same slot — no double header', () => {
  const tpl = { groups: { header: 'header' }, sections: [header(), { type: 'hero', id: 'h', settings: {} }] }
  const r = resolvePage(tpl, GROUPS)
  assert.equal(r.sections.filter((s) => s.type === 'header').length, 1)
  assert.equal(r.provenance.header.kind, 'group')
})

test('a missing group renders an empty slot and is reported, never thrown', () => {
  const r = resolvePage({ groups: { header: 'nope' }, sections: [] }, GROUPS)
  assert.deepEqual(r.sections, [])
  assert.deepEqual(r.missingGroups, ['nope'])
})

// ── split (the inverse, what a save does) ───────────────────────────────

test('B — save/reload: an edited page splits back into template + group, override intact', () => {
  const tpl = {
    contentVersion: 2,
    groups: { header: { override: [{ type: 'announcement-bar', id: 'ab', settings: { text: 'Sale' } }] }, footer: 'footer' },
    sections: [{ type: 'hero', id: 'h', settings: { heading: 'Hi' } }],
  }
  const resolved = resolvePageFrom(tpl, GROUPS)
  // The merchant edits the override's text, the body heading, and the shared footer's menu.
  const edited = resolved.sections.map((n) => {
    if (n.id === 'ab') return { ...n, settings: { text: 'Big sale' } }
    if (n.id === 'h') return { ...n, settings: { heading: 'Hello' } }
    if (n.id === 'footer') return { ...n, blocks: [{ ...n.blocks[0], settings: { menu: 'footer-help' } }] }
    return n
  })
  const out = splitPage(edited, resolved)

  assert.equal(out.template.contentVersion, 2, 'top-level keys survive')
  assert.deepEqual(out.template.groups.header, { override: [{ type: 'announcement-bar', id: 'ab', settings: { text: 'Big sale' }, area: 'header' }] })
  assert.equal(out.template.groups.footer, 'footer', 'the footer stays bound to the shared group')
  assert.deepEqual(out.template.sections, [{ type: 'hero', id: 'h', settings: { heading: 'Hello' } }], 'body has no area added')
  assert.equal(out.groups.footer.name, 'footer')
  assert.equal(out.groups.footer.doc.sections[0].blocks[0].settings.menu, 'footer-help', 'the shared footer received the edit')
  assert.equal(out.groups.header, undefined, 'an override never writes to the shared group')

  // Reload = resolve what was written: identical to what was edited.
  const again = resolvePage(out.template, { ...GROUPS, footer: out.groups.footer.doc })
  assert.deepEqual(again.sections.map((s) => s.id), ['ab', 'h', 'footer'])
  assert.equal(again.sections[0].settings.text, 'Big sale')
})

test('a legacy template saves back byte-identical through resolve → split', () => {
  const tpl = { sections: [header(), { type: 'hero', id: 'h', settings: {} }, footer()] }
  const out = splitPage(resolvePageFrom(tpl, {}).sections, resolvePageFrom(tpl, {}))
  assert.deepEqual(out.template, tpl)
  assert.deepEqual(out.groups, {})
})

test('B — "customize for this page": switching a slot from ref to override freezes the group nodes into the template', () => {
  const tpl = { groups: { header: 'header', footer: 'footer' }, sections: [] }
  const resolved = resolvePageFrom(tpl, GROUPS)
  const out = splitPage(resolved.sections, resolved, { slots: { header: { mode: 'override' } } })
  assert.deepEqual(out.template.groups.header, { override: [{ type: 'header', id: 'header', settings: { sticky: 'always' }, area: 'header' }] })
  assert.equal(out.template.groups.footer, 'footer')
  assert.equal(out.groups.header, undefined, 'the shared header is untouched')
})

test('"use shared header": switching back to ref drops the override and does not write the group', () => {
  const tpl = { groups: { header: { override: [{ type: 'header', id: 'header', settings: { sticky: 'none' } }] } }, sections: [] }
  const resolved = resolvePageFrom(tpl, GROUPS)
  // The editor re-resolves with the shared nodes when the merchant resets, so the
  // nodes handed to split are the GROUP's — the override's own nodes are dropped.
  const shared = resolvePageFrom({ groups: { header: 'header' }, sections: [] }, GROUPS)
  const out = splitPage(shared.sections, { ...resolved, provenance: shared.provenance, slots: shared.slots }, { slots: { header: { mode: 'ref', group: 'header' } } })
  assert.equal(out.template.groups.header, 'header')
  assert.deepEqual(out.groups.header.doc.sections, GROUPS.header.sections, 'written back unchanged')
})

// ── validation ───────────────────────────────────────────────────────────

test('validatePage: an unknown group ref is an error that names the file', () => {
  const r = validatePage({ groups: { header: 'ghost' }, sections: [] }, GROUPS, CATALOG)
  assert.equal(r.ok, false)
  const i = r.issues.find((x) => x.code === 'unknown_group')
  assert.match(i.message, /groups\/ghost\.json/)
  assert.equal(i.suggestion, 'header', 'the existing header group is suggested')
})

test('validatePage: a footer group cannot fill the header slot', () => {
  const r = validatePage({ groups: { header: 'footer' }, sections: [] }, GROUPS, CATALOG)
  assert.ok(r.issues.some((x) => x.code === 'invalid_group' && /footer group/.test(x.message)))
})

test('validatePage: ids must be unique across the page INCLUDING its groups', () => {
  const r = validatePage({ groups: { header: 'header' }, sections: [{ type: 'hero', id: 'header', settings: {} }] }, GROUPS, CATALOG)
  assert.ok(r.issues.some((x) => x.code === 'duplicate_node_id' && /group header/.test(x.message)))
})

test('validateGroup: a block cannot sit directly in a group; a layout section can', () => {
  const bad = validateGroup('footer', { type: 'footer', sections: [{ type: 'footer-menu', id: 'm', settings: {} }] }, CATALOG)
  assert.equal(bad.ok, false)
  assert.equal(bad.issues[0].code, 'invalid_placement')
  const good = validateGroup('footer', GROUPS.footer, CATALOG)
  assert.equal(good.ok, true, JSON.stringify(good.issues))
})

test('placement: a layout section declared for the header is rejected in the body', () => {
  const r = validateDocument({ sections: [{ type: 'announcement-bar', id: 'ab', settings: {}, area: 'template' }] }, CATALOG)
  assert.equal(r.ok, false)
  assert.equal(r.issues[0].code, 'invalid_placement')
  assert.equal(r.issues[0].suggestion, 'header')
})

test('placement: role is explicit, not read off category', () => {
  assert.equal(roleOf(CATALOG['faq-item']), 'block', 'category:block still derives, for definitions that predate role')
  assert.equal(roleOf(CATALOG['add-to-cart']), 'block')
  assert.equal(roleOf(CATALOG.header), 'layout')
  assert.equal(roleOf({ name: 'footer' }), 'layout', 'name fallback for legacy defs')
  assert.equal(roleOf(CATALOG.hero), 'section')
  // A block at the top level is a placement error regardless of category.
  const r = validateDocument({ sections: [{ type: 'faq-item', id: 'q', settings: {} }] }, CATALOG)
  assert.equal(r.issues[0].code, 'invalid_placement')
})

test('D — a product-context block is REJECTED on a template that provides no product', () => {
  const doc = { sections: [{ type: 'product-details', id: 'pd', settings: {}, blocks: [{ type: 'add-to-cart', id: 'atc', settings: {} }] }] }
  const onCart = validateDocument(doc, CATALOG, { context: templateContext('cart') })
  assert.equal(onCart.ok, false)
  const codes = onCart.issues.map((i) => `${i.severity}:${i.code}:${i.nodeId}`)
  assert.ok(codes.includes('error:missing_context:pd'))
  assert.ok(codes.includes('error:missing_context:atc'))

  const onProduct = validateDocument(doc, CATALOG, { context: templateContext('product.bundle') })
  assert.equal(onProduct.ok, true, JSON.stringify(onProduct.issues))

  // No context named → still surfaced, as a warning.
  const bare = validateDocument(doc, CATALOG)
  assert.equal(bare.ok, true)
  assert.equal(bare.issues[0].severity, 'warning')
})

test('templateContext follows the base slug', () => {
  assert.deepEqual(templateContext('product'), ['product'])
  assert.deepEqual(templateContext('product.bundle'), ['product'])
  assert.deepEqual(templateContext('article'), ['article', 'blog'])
  assert.deepEqual(templateContext('index'), [])
})

// ── migration ────────────────────────────────────────────────────────────

const DEFAULTS = { header: { sticky: 'always' } }

function novaLike() {
  const std = () => [header(), footer()]
  return {
    index: { sections: [
      { type: 'announcement-bar', id: 's-announcement', settings: { text: 'Hi' }, area: 'header' },
      { type: 'header', id: 's-header', settings: { sticky: 'always' }, area: 'header' },
      { type: 'hero', id: 'hero', settings: {} },
      { type: 'footer', id: 's-footer', settings: {}, area: 'footer', blocks: [{ type: 'footer-menu', id: 'b-menu', settings: { menu: 'footer-shop' } }] },
    ] },
    product: { sections: [std()[0], { type: 'product-details', id: 'main', settings: {} }, std()[1]] },
    collection: { sections: [std()[0], std()[1]] },
    page: { sections: [std()[0], std()[1]] },
    // Differs: footer menu points elsewhere.
    account: { sections: [header(), { type: 'footer', id: 'footer', settings: {}, area: 'footer',
      blocks: [{ type: 'footer-menu', id: 'footer-menu_shop', settings: { menu: 'main-menu' } }] }] },
    // No chrome at all.
    'page.contact': { sections: [{ type: 'hero', id: 'x', settings: {} }] },
  }
}

test('F — the majority copy becomes the group; identical-after-defaults copies bind it; the rest are explicit overrides, reported', () => {
  const { groups, templates, report, noop } = extractGroups(novaLike(), { defaults: DEFAULTS })
  assert.equal(noop, false)

  const h = report.find((r) => r.slot === 'header')
  assert.deepEqual(h.canonical.templates, ['account', 'collection', 'page', 'product'])
  assert.deepEqual(h.overrides.map((o) => o.template), ['index'], 'index has an announcement bar — kept as an override')
  assert.match(h.overrides[0].differences[0], /announcement-bar/)
  assert.deepEqual(h.empty, ['page.contact'])

  const f = report.find((r) => r.slot === 'footer')
  // index's footer has the SAME content under different ids (`s-footer`,
  // `b-menu`) — content is what is compared, so it binds the group and the id
  // change is reported rather than silently applied.
  assert.deepEqual(f.canonical.templates, ['collection', 'index', 'page', 'product'])
  assert.deepEqual(f.overrides.map((o) => o.template), ['account'])
  assert.match(f.overrides[0].differences[0], /menu: "main-menu" vs canonical "footer-shop"/)
  assert.deepEqual(f.idRemaps, [
    { template: 'index', from: 's-footer', to: 'footer' },
    { template: 'index', from: 'b-menu', to: 'footer-menu_shop' },
  ])
  assert.deepEqual(h.idRemaps, [], 'an override keeps every id verbatim')

  // The group carries the canonical nodes verbatim (ids, blocks, order) minus `area`.
  assert.deepEqual(groups.footer.doc, { type: 'footer', sections: [{ type: 'footer', id: 'footer', settings: {},
    blocks: [{ type: 'footer-menu', id: 'footer-menu_shop', settings: { menu: 'footer-shop' } }] }] })

  // Bound templates reference; overriding templates keep their own nodes untouched.
  assert.equal(templates.product.groups.header, 'header')
  assert.equal(templates.product.groups.footer, 'footer')
  assert.deepEqual(templates.product.sections, [{ type: 'product-details', id: 'main', settings: {} }])
  assert.equal(templates.index.groups.header.override[0].id, 's-announcement')
  assert.equal(templates.index.groups.header.override[1].settings.sticky, 'always')
  assert.equal(templates.index.groups.footer, 'footer')
  assert.equal(templates.account.groups.footer.override[0].blocks[0].settings.menu, 'main-menu')
  assert.equal(templates['page.contact'].groups, undefined, 'nothing to bind')
})

test('F — `sticky: always` written out and `{}` (the default) are the SAME header', () => {
  const a = [{ type: 'header', id: 'a', settings: { sticky: 'always' } }]
  const b = [{ type: 'header', id: 'b', settings: {} }]
  assert.equal(slotSignature(a, DEFAULTS), slotSignature(b, DEFAULTS))
  assert.notEqual(slotSignature(a, DEFAULTS), slotSignature([{ type: 'header', id: 'c', settings: { sticky: 'none' } }], DEFAULTS))
})

test('F — every page resolves to the same sections before and after migration', () => {
  const before = novaLike()
  const { groups, templates } = extractGroups(before, { defaults: DEFAULTS })
  const gm = Object.fromEntries(Object.values(groups).map((g) => [g.name, g.doc]))
  for (const slug of Object.keys(before)) {
    const was = resolvePage(before[slug], {}).sections
    const now = resolvePage(templates[slug], gm).sections
    // Same types, settings and blocks in the same order, with defaults applied.
    // Ids are compared separately: a template that binds the group takes the
    // group's ids, and `idRemaps` above is where that is made visible.
    const norm = (nodes) => nodes.map((n) => ({
      type: n.type,
      settings: { ...(DEFAULTS[n.type] ?? {}), ...(n.settings ?? {}) },
      blocks: (n.blocks ?? []).map((b) => ({ type: b.type, settings: b.settings ?? {} })),
    }))
    assert.deepEqual(norm(now), norm(was), slug)
  }
})

test('F — running the migration a second time changes nothing', () => {
  const first = extractGroups(novaLike(), { defaults: DEFAULTS })
  const second = extractGroups(first.templates, { defaults: DEFAULTS })
  assert.equal(second.noop, true)
  assert.deepEqual(second.templates, first.templates)
  assert.deepEqual(second.groups, {})
  assert.deepEqual(second.report.find((r) => r.slot === 'header').alreadyBound.sort(),
    ['account', 'collection', 'index', 'page', 'product'])
})

// ── targeted edits (G) ──────────────────────────────────────────────────

test('G — an insert keyed by id is idempotent: the retry finds the node and does not add a second', () => {
  const tpl = { groups: { header: 'header' }, sections: [{ type: 'hero', id: 'h', settings: {} }] }
  const resolved = resolvePageFrom(tpl, GROUPS)
  const insert = (sections, node, after) => {
    if (sections.some((n) => n.id === node.id)) return sections.map((n) => (n.id === node.id ? node : n))
    const i = sections.findIndex((n) => n.id === after)
    const next = [...sections]
    next.splice(i + 1, 0, node)
    return next
  }
  const faq = { type: 'faq', id: 'faq_ai1', settings: { heading: 'Help' }, blocks: [{ type: 'faq-item', id: 'faq-item_1', settings: { question: 'Q', answer: 'A' } }] }
  const once = insert(resolved.sections, faq, 'h')
  const twice = insert(once, faq, 'h')
  assert.deepEqual(twice.map((n) => n.id), ['header', 'h', 'faq_ai1'])
  const out = splitPage(twice, resolved)
  assert.deepEqual(out.template.sections.map((n) => n.id), ['h', 'faq_ai1'])
  assert.equal(out.template.sections[1].area, undefined, 'a body insert carries no area')
})

test('content version is 2 with groups', () => {
  assert.equal(CURRENT_CONTENT_VERSION, 2)
})
