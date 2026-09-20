/**
 * The acceptance path, end to end at the contract layer:
 *
 *   AI adds a FAQ section with 3 blocks
 *   → a merchant selects / edits / reorders each block in the Editor
 *   → save → reload
 *   → AI reads back and rewrites ONE answer without touching the others
 *
 * These run against `dist/contract.js` — the exact single file studio-api
 * vendors — so what is proven here is what ships, not a parallel TS build.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mintNodeId,
  toEditorShape,
  toRuntimeShape,
  validateDocument,
  ensureNodeIds,
} from '../dist/contract.js'

/** Nova's real FAQ contract, transcribed from sections/FAQ.tsx + FaqItem.tsx. */
const CATALOG = {
  faq: {
    name: 'faq',
    title: 'FAQ',
    category: 'content',
    attributes: {
      eyebrow: { type: 'text', label: 'Eyebrow' },
      heading: { type: 'text', default: 'Frequently asked questions', label: 'Heading' },
    },
    allowedBlocks: ['faq-item'],
  },
  'faq-item': {
    name: 'faq-item',
    title: 'Question',
    category: 'block',
    attributes: {
      question: { type: 'text', default: 'Your question?', label: 'Question' },
      answer: { type: 'textarea', label: 'Answer' },
    },
  },
  header: { name: 'header', title: 'Header', attributes: {} },
  footer: { name: 'footer', title: 'Footer', attributes: {} },
}

/** Deterministic id minting, so a failure is readable. */
function seqMint() {
  let n = 0
  return (type) => mintNodeId(type, () => String(++n).padStart(8, '0'))
}

/** What an AI produces: a FAQ section with three question blocks. */
function aiAuthoredFaq(mint) {
  return {
    type: 'faq',
    id: mint('faq'),
    settings: { heading: 'Shipping & returns' },
    area: 'template',
    blocks: [
      { type: 'faq-item', id: mint('faq-item'), settings: { question: 'How long does shipping take?', answer: '3-5 business days.' } },
      { type: 'faq-item', id: mint('faq-item'), settings: { question: 'Can I return an item?', answer: 'Within 30 days.' } },
      { type: 'faq-item', id: mint('faq-item'), settings: { question: 'Do you ship abroad?', answer: 'Yes, worldwide.' } },
    ],
  }
}

function baseDoc(mint) {
  return {
    contentVersion: 1,
    sections: [
      { type: 'header', id: 'header', settings: {}, area: 'header' },
      aiAuthoredFaq(mint),
      { type: 'footer', id: 'footer', settings: {}, area: 'footer' },
    ],
  }
}

test('AI-authored FAQ with 3 blocks validates against the real Nova catalog', () => {
  const doc = baseDoc(seqMint())
  const { ok, issues } = validateDocument(doc, CATALOG)
  assert.equal(ok, true, issues.map((i) => `${i.code} ${i.path}: ${i.message}`).join('\n'))
  assert.deepEqual(issues, [])
})

test('save → reload preserves data, order and IDs exactly', () => {
  const doc = baseDoc(seqMint())
  const idsBefore = doc.sections[1].blocks.map((b) => b.id)

  // One full editor cycle: load into the panel, save back to disk.
  const { doc: editor } = toEditorShape(doc)
  const saved = toRuntimeShape(editor)

  assert.deepEqual(saved, doc, 'a round trip must be byte-identical')

  const faq = saved.sections.find((s) => s.type === 'faq')
  assert.deepEqual(faq.blocks.map((b) => b.id), idsBefore, 'block ids must survive')
  assert.deepEqual(
    faq.blocks.map((b) => b.settings.question),
    ['How long does shipping take?', 'Can I return an item?', 'Do you ship abroad?'],
  )
})

test('`area` survives the round trip (it is dropped by the current studio-api converter)', () => {
  const doc = baseDoc(seqMint())
  const saved = toRuntimeShape(toEditorShape(doc).doc)
  assert.equal(saved.sections[0].area, 'header')
  assert.equal(saved.sections[1].area, 'template')
  assert.equal(saved.sections[2].area, 'footer')
})

test('unmodelled keys survive, so a future contract addition is not destroyed', () => {
  const mint = seqMint()
  const doc = baseDoc(mint)
  doc.sections[1].blocks[0].__futureKey = { kept: true }
  const saved = toRuntimeShape(toEditorShape(doc).doc)
  assert.deepEqual(saved.sections[1].blocks[0].__futureKey, { kept: true })
})

test('merchant reorders blocks in the Editor — ids follow the content, not the position', () => {
  const doc = baseDoc(seqMint())
  const [a, b, c] = doc.sections[1].blocks.map((x) => x.id)

  const { doc: editor } = toEditorShape(doc)
  const faqId = editor.order[1]
  // Drag the third question to the top.
  editor.sections[faqId].order = [c, a, b]
  const saved = toRuntimeShape(editor)

  const blocks = saved.sections[1].blocks
  assert.deepEqual(blocks.map((x) => x.id), [c, a, b], 'order changes')
  assert.equal(blocks[0].settings.question, 'Do you ship abroad?', 'content moved with its id')
  assert.equal(blocks[1].settings.question, 'How long does shipping take?')
})

test('merchant edits one answer in the Editor; the others are untouched', () => {
  const doc = baseDoc(seqMint())
  const { doc: editor } = toEditorShape(doc)
  const faqId = editor.order[1]
  const secondBlockId = editor.sections[faqId].order[1]

  editor.sections[faqId].blocks[secondBlockId].settings.answer = 'Within 45 days.'
  const saved = toRuntimeShape(editor)

  const blocks = saved.sections[1].blocks
  assert.equal(blocks[1].settings.answer, 'Within 45 days.')
  assert.equal(blocks[0].settings.answer, '3-5 business days.')
  assert.equal(blocks[2].settings.answer, 'Yes, worldwide.')
})

test('AI reads back and rewrites ONE answer by id, after a reorder, without clobbering', () => {
  const doc = baseDoc(seqMint())
  const targetId = doc.sections[1].blocks[1].id

  // The merchant has already reordered in the Editor and saved.
  const { doc: editor } = toEditorShape(doc)
  const faqId = editor.order[1]
  const [x, y, z] = editor.sections[faqId].order
  editor.sections[faqId].order = [z, x, y]
  const afterMerchant = toRuntimeShape(editor)

  // AI now edits the block it remembers by ID — not by index.
  const target = afterMerchant.sections[1].blocks.find((b) => b.id === targetId)
  assert.ok(target, 'the id the AI recorded still resolves after a reorder')
  target.settings.answer = 'Within 60 days, unworn.'

  const { ok } = validateDocument(afterMerchant, CATALOG)
  assert.equal(ok, true)

  const byId = Object.fromEntries(afterMerchant.sections[1].blocks.map((b) => [b.id, b.settings]))
  assert.equal(byId[targetId].answer, 'Within 60 days, unworn.')
  assert.equal(byId[targetId].question, 'Can I return an item?', 'question untouched')
  // Every other block is exactly as the merchant left it.
  const others = afterMerchant.sections[1].blocks.filter((b) => b.id !== targetId)
  assert.deepEqual(others.map((b) => b.settings.answer), ['Yes, worldwide.', '3-5 business days.'])
})

test('positional ids are what make that impossible — the failure being fixed', () => {
  // The current studio-api converter mints `${type}-${index}` for an id-less
  // block. Reordering then reassigns the id to different content.
  const positional = (nodes) => nodes.map((b, i) => ({ ...b, id: `${b.type}-${i}` }))
  const blocks = positional([
    { type: 'faq-item', settings: { answer: 'A' } },
    { type: 'faq-item', settings: { answer: 'B' } },
  ])
  assert.equal(blocks[0].id, 'faq-item-0')

  const reordered = positional([blocks[1], blocks[0]].map(({ type, settings }) => ({ type, settings })))
  assert.equal(reordered[0].id, 'faq-item-0')
  assert.equal(reordered[0].settings.answer, 'B',
    'same id, different content — an AI editing `faq-item-0` would hit the wrong answer')
})

test('ensureNodeIds upgrades a pre-contract template once, and reports what it minted', () => {
  const legacy = {
    sections: [
      { type: 'faq', settings: {}, blocks: [
        { type: 'faq-item', settings: { question: 'Q1' } },
        { type: 'faq-item', settings: { question: 'Q2' } },
      ] },
    ],
  }
  const { doc, report } = ensureNodeIds(legacy, seqMint())

  assert.equal(report.mintedIds.length, 3, 'section + 2 blocks')
  for (const node of [doc.sections[0], ...doc.sections[0].blocks]) {
    assert.match(node.id, /^[a-z-]+_\d{8}$/)
  }
  // Stable from here on.
  const again = toRuntimeShape(toEditorShape(doc).doc)
  assert.deepEqual(again, doc)
})

test('duplicate section ids are reported, not silently collapsed', () => {
  const doc = {
    sections: [
      { type: 'faq', id: 'faq_dup', settings: {} },
      { type: 'faq', id: 'faq_dup', settings: {} },
    ],
  }
  const { ok, issues } = validateDocument(doc, CATALOG)
  assert.equal(ok, false)
  const dup = issues.find((i) => i.code === 'duplicate_node_id')
  assert.ok(dup)
  assert.equal(dup.nodeId, 'faq_dup')
  assert.equal(dup.path, 'sections[1].id')

  // And the transform disambiguates rather than losing the second one.
  const { doc: editor, report } = toEditorShape(doc, seqMint())
  assert.equal(editor.order.length, 2, 'both sections survive')
  assert.equal(report.renamedIds.length, 1)
})
