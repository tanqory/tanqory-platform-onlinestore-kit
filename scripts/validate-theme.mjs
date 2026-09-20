#!/usr/bin/env node
/**
 * Validate a theme against Tanqory Theme Contract v1.
 *
 *   node scripts/validate-theme.mjs [themeDir]
 *   node scripts/validate-theme.mjs ../tanqory-platform-onlinestore-theme-nova
 *
 * The THIRD caller of the one validator — the Editor API (`POST /tq/v2/validate`)
 * and the theme's own test suite are the other two. Same implementation, same
 * codes, same messages, so "valid" cannot mean three different things.
 *
 * Reads the theme's generated `theme.manifest.json` for the section catalogue
 * (it is the only artifact that already carries every section's attributes and
 * allowedBlocks) and checks every `templates/*.json` against it.
 *
 * Exit 1 on any error, so it works as a pre-commit or CI gate.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { validateDocument, validateSectionContract, CONTRACT_VERSION } =
  await import(join(here, '..', 'dist', 'contract.js')).catch(() => {
    console.error('✗ dist/contract.js missing — run `pnpm build` in the kit first.')
    process.exit(1)
  })

const themeDir = process.argv[2] || process.cwd()
const manifestPath = join(themeDir, 'theme.manifest.json')
const templatesDir = join(themeDir, 'templates')

if (!existsSync(manifestPath)) {
  console.error(`✗ No theme.manifest.json in ${themeDir}. Run \`pnpm manifest\` in the theme.`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const catalog = Object.fromEntries(
  manifest.sections.map((s) => [s.name, {
    name: s.name,
    title: s.title,
    category: s.category,
    attributes: s.attributes ?? {},
    allowedBlocks: s.allowedBlocks ?? [],
  }]),
)

let errors = 0
let warnings = 0

const report = (label, issues) => {
  for (const i of issues) {
    if (i.severity === 'error') errors++
    else warnings++
    const mark = i.severity === 'error' ? '✗' : '⚠'
    const where = i.nodeId ? ` (#${i.nodeId})` : ''
    console.log(`  ${mark} [${i.code}] ${label} ${i.path}${where}`)
    console.log(`      ${i.message}`)
    if (i.suggestion) console.log(`      → ${i.suggestion}`)
  }
}

console.log(`Tanqory Theme Contract v${CONTRACT_VERSION} — ${themeDir}`)
console.log(`  ${manifest.sections.length} sections · ${manifest.templates?.length ?? 0} templates\n`)

console.log('Section definitions:')
for (const def of Object.values(catalog)) {
  report(def.name, validateSectionContract(def).issues)
}

console.log('\nTemplates:')
const templates = existsSync(templatesDir)
  ? readdirSync(templatesDir).filter((f) => f.endsWith('.json'))
  : []
for (const file of templates) {
  const doc = JSON.parse(readFileSync(join(templatesDir, file), 'utf8'))
  report(file, validateDocument(doc, catalog).issues)
}

console.log('')
if (errors) {
  console.error(`✗ ${errors} error(s), ${warnings} warning(s).`)
  process.exit(1)
}
console.log(`✓ Valid — ${warnings} warning(s).`)
