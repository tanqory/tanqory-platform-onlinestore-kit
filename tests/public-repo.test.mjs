/**
 * This repository — and the package it publishes — is public. It describes
 * itself in its own words and never names another commerce platform, its themes,
 * its template language or its documentation. The list pins the names that have
 * actually appeared here; it runs over the sources AND the built package, since
 * a comment survives into dist/ and the .d.ts files.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Built from parts so this file does not contain what it forbids.
const FORBIDDEN = new RegExp(
  [['shop', 'ify'], ['\\bliq', 'uid\\b'], ['\\.liq', 'uid\\b'], ['my', 'shop', 'ify'], ['woo', 'commerce'], ['big', 'commerce'], ['\\bmag', 'ento\\b']]
    .map((p) => p.join('')).join('|'),
  'i',
)
const TEXT = /\.(tsx?|mjs|cjs|js|json|md|map|ya?ml)$/
const SKIP = new Set(['node_modules', '.git'])

function scan(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) scan(full, out)
    else if (TEXT.test(e.name) && e.name !== 'pnpm-lock.yaml') out.push(full)
  }
  return out
}
const hitsIn = (files) => files.flatMap((file) =>
  readFileSync(file, 'utf8').split('\n').flatMap((line, i) =>
    FORBIDDEN.test(line) ? [`${file.slice(ROOT.length + 1)}:${i + 1}: ${line.trim().slice(0, 90)}`] : []))

test('the sources name no other platform, theme or template language', () => {
  const files = ['src', 'contract', 'docs', 'scripts', 'tests', '.github'].flatMap((d) => scan(join(ROOT, d)))
    .concat(['README.md', 'package.json'].map((f) => join(ROOT, f)).filter(existsSync))
  assert.ok(files.length > 20, 'the scan found the repository')
  assert.deepEqual(hitsIn(files), [])
})

test('neither does the package that gets published (dist/, when built)', (t) => {
  const files = scan(join(ROOT, 'dist'))
  if (!files.length) return t.skip('dist/ not built')
  assert.deepEqual(hitsIn(files), [])
})
