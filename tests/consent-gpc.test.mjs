/**
 * Global Privacy Control (GPC) — matrix 0.5, kit side.
 *
 * `hasConsent` returned TRUE for everything whenever the merchant's banner was off, so a
 * shopper whose browser sends the legally-binding opt-out signal (Sec-GPC / navigator.globalPrivacyControl,
 * CPRA/CCPA §7025, Colorado, Connecticut…) was still tracked by every marketing pixel. GPC must
 * force the MARKETING purpose (sale/share of data = ads) off regardless of the banner or a stored
 * "accepted". Analytics is not sale/share, so it keeps its own gate.
 *
 * Runs on Node 20 (CI): the TS source is transpiled with the repo's own `typescript`.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const src = readFileSync(new URL('../src/consent.ts', import.meta.url), 'utf8')
const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const dir = mkdtempSync(join(tmpdir(), 'kit-consent-'))
const file = join(dir, 'consent.mjs')
writeFileSync(file, out)

const store = new Map()
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) }
globalThis.window = new EventTarget()
globalThis.CustomEvent = class extends Event { constructor(t, i) { super(t); this.detail = i?.detail } }
const setGpc = (v) => Object.defineProperty(globalThis, 'navigator', { value: { globalPrivacyControl: v }, configurable: true })

const consent = await import(pathToFileURL(file).href)

test('no GPC, banner not required: everything allowed (unchanged behaviour)', () => {
  setGpc(undefined); consent.setBannerRequired(false)
  assert.equal(consent.hasConsent('marketing'), true)
  assert.equal(consent.hasConsent('analytics'), true)
})

test('GPC on + banner NOT required: marketing is denied, analytics untouched', () => {
  setGpc(true); consent.setBannerRequired(false)
  assert.equal(consent.hasConsent('marketing'), false)
  assert.equal(consent.hasConsent('analytics'), true)
})

test('GPC on + banner required + shopper accepted all: marketing STILL denied', () => {
  setGpc(true); consent.setBannerRequired(true)
  consent.setConsent({ analytics: true, marketing: true })
  assert.equal(consent.hasConsent('marketing'), false)
  assert.equal(consent.hasConsent('analytics'), true)
})

test('GPC off + banner required: the stored choice decides, undecided denies (unchanged)', () => {
  setGpc(false); consent.setBannerRequired(true)
  consent.setConsent({ analytics: false, marketing: true })
  assert.equal(consent.hasConsent('marketing'), true)
  assert.equal(consent.hasConsent('analytics'), false)
  store.clear()
  assert.equal(consent.hasConsent('marketing'), false)
})

test('a missing navigator (SSR) never throws and never counts as GPC', () => {
  delete globalThis.navigator
  consent.setBannerRequired(false)
  assert.equal(consent.hasConsent('marketing'), true)
})
