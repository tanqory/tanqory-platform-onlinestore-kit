/**
 * Backward compatibility: the contract must accept the content that already
 * exists, unchanged. A contract that only validates content written for it is
 * not a contract, it is a rewrite.
 *
 * Runs against the real Nova theme when it is checked out as a sibling —
 * the same sibling-resolution + graceful-skip pattern
 * `themes/scripts/check-plumbing-drift.mjs` uses. Set `NOVA_DIR` to override.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateDocument, validateSectionContract, toEditorShape, toRuntimeShape } from '../dist/contract.js'

const here = dirname(fileURLToPath(import.meta.url))
const NOVA =
  process.env.NOVA_DIR ||
  join(here, '..', '..', 'tanqory-platform-onlinestore-theme-nova')

const available = existsSync(join(NOVA, 'theme.manifest.json'))
const opts = available ? {} : { skip: `Nova not found at ${NOVA} — set NOVA_DIR` }

/** Build a SectionCatalog from Nova's generated manifest. */
function novaCatalog() {
  const m = JSON.parse(readFileSync(join(NOVA, 'theme.manifest.json'), 'utf8'))
  const catalog = {}
  for (const s of m.sections) {
    catalog[s.name] = {
      name: s.name,
      title: s.title,
      category: s.category,
      attributes: s.attributes ?? {},
      allowedBlocks: s.allowedBlocks ?? [],
    }
  }
  return catalog
}

function novaTemplates() {
  const dir = join(NOVA, 'templates')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ name: f, doc: JSON.parse(readFileSync(join(dir, f), 'utf8')) }))
}

test('every Nova section definition satisfies the contract', opts, () => {
  const catalog = novaCatalog()
  const failures = []
  for (const def of Object.values(catalog)) {
    const r = validateSectionContract(def)
    for (const i of r.issues.filter((x) => x.severity === 'error')) {
      failures.push(`${def.name}: [${i.code}] ${i.path} — ${i.message}`)
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'))
})

test('every Nova template validates against Nova’s own section catalog', opts, () => {
  const catalog = novaCatalog()
  const failures = []
  for (const { name, doc } of novaTemplates()) {
    const r = validateDocument(doc, catalog)
    for (const i of r.issues.filter((x) => x.severity === 'error')) {
      failures.push(`${name}: [${i.code}] ${i.path} — ${i.message}`)
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'))
})

test('every Nova template survives an Editor round trip byte-identically', opts, () => {
  const failures = []
  for (const { name, doc } of novaTemplates()) {
    const back = toRuntimeShape(toEditorShape(doc).doc)
    try {
      assert.deepEqual(back, doc)
    } catch {
      failures.push(name)
    }
  }
  assert.deepEqual(failures, [],
    `these templates would be altered by a save: ${failures.join(', ')}`)
})

test('Nova templates already carry explicit, unique ids at every level', opts, () => {
  const problems = []
  for (const { name, doc } of novaTemplates()) {
    const walk = (nodes, path) => {
      const seen = new Set()
      for (const [i, n] of (nodes ?? []).entries()) {
        const p = `${path}[${i}]`
        if (!n.id) problems.push(`${name} ${p}: missing id`)
        else if (seen.has(n.id)) problems.push(`${name} ${p}: duplicate id ${n.id}`)
        else seen.add(n.id)
        if (n.blocks) walk(n.blocks, `${p}.blocks`)
      }
    }
    walk(doc.sections, 'sections')
  }
  assert.deepEqual(problems, [], problems.join('\n'))
})

test('the FAQ section in the real theme allows exactly the block the preset uses', opts, () => {
  const catalog = novaCatalog()
  const faq = catalog.faq
  assert.ok(faq, 'nova ships a `faq` section')
  assert.deepEqual(faq.allowedBlocks, ['faq-item'])
  assert.ok(catalog['faq-item'], 'nova ships the `faq-item` block')
  assert.equal(catalog['faq-item'].attributes.question.type, 'text')
  assert.equal(catalog['faq-item'].attributes.answer.type, 'textarea')
})
