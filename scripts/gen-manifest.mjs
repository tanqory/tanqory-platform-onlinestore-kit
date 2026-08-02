#!/usr/bin/env node
/**
 * Emit theme.manifest.json — the single machine-readable catalog of a theme,
 * read by the editor inserter, the AI theme generator (ai-api), and the Phase 1
 * dashboard↔surface conformance test.
 *
 * It loads the THEME's `scripts/manifest-entry.ts` through a Vite SSR server
 * rather than plain Node so `import.meta.glob` resolves against the exact
 * `sections/*.tsx` + `templates/*.json` the app registers — the manifest is
 * generated from the same source of truth it describes, so it cannot drift.
 * That entry file stays in the theme precisely because its globs must resolve
 * from the theme directory; only this runner is shared.
 *
 *   tanqory-gen-manifest [--check]        # run from the theme root
 *
 * --check regenerates in memory and fails (exit 1) if the committed
 * theme.manifest.json is stale — for CI, so a new/edited section without a
 * regenerated manifest is caught in review.
 */
import { createServer } from 'vite'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// The theme root is the working directory, not this script's location — the
// runner ships inside @tanqory/theme-kit and is run from each theme.
const root = process.cwd()
const outFile = join(root, 'theme.manifest.json')
const readmeFile = join(root, 'README.md')
const check = process.argv.includes('--check')

const CATALOG_START = '<!-- BEGIN GENERATED CATALOG -->'
const CATALOG_END = '<!-- END GENERATED CATALOG -->'

/** Render the human-readable catalog block spliced into README.md — a view of
 *  the same manifest, so the docs can't drift from what the theme ships. */
function renderCatalog(m) {
  const byCat = {}
  for (const s of m.sections) (byCat[s.category] ??= []).push(s.name)
  const lines = []
  lines.push(`**${m.stats.sections} sections · ${m.stats.templates} templates · ${m.stats.settings} settings**`)
  lines.push('')
  lines.push('### Sections by category')
  for (const cat of Object.keys(byCat).sort()) {
    lines.push(`- **${cat}** (${byCat[cat].length}): ${byCat[cat].sort().join(', ')}`)
  }
  lines.push('')
  lines.push('### Templates')
  lines.push('| template | sections |')
  lines.push('| --- | --- |')
  for (const t of m.templates) lines.push(`| \`${t.name}\` | ${t.sectionTypes.join(', ') || '—'} |`)
  lines.push('')
  lines.push('### Theme settings')
  for (const g of m.settingsSchema) {
    lines.push(`- **${g.group}**: ${g.items.map((i) => i.key).join(', ')}`)
  }
  return lines.join('\n')
}

/** Splice a freshly-rendered catalog between the markers. Returns the new
 *  README text, or throws if the markers are missing. */
function spliceReadme(current, catalog) {
  const a = current.indexOf(CATALOG_START)
  const b = current.indexOf(CATALOG_END)
  if (a === -1 || b === -1 || b < a) {
    throw new Error(`README.md is missing the ${CATALOG_START} / ${CATALOG_END} markers`)
  }
  return current.slice(0, a + CATALOG_START.length) + '\n' + catalog + '\n' + current.slice(b)
}

const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  // The section files import CSS/assets; Vite SSR stubs those, so importing a
  // section to read its static definition is safe.
  appType: 'custom',
})

try {
  const mod = await server.ssrLoadModule('./scripts/manifest-entry.ts')
  const manifest = mod.buildManifest()
  // Theme-author AI guidance (config/ai-guidance.json) rides along in the
  // manifest so platform AI (theme customize/editor agents) can obey the
  // theme's identity guardrails when editing an installed copy.
  const aiGuidanceFile = join(root, 'config/ai-guidance.json')
  if (existsSync(aiGuidanceFile)) {
    manifest.ai = JSON.parse(readFileSync(aiGuidanceFile, 'utf8'))
  }
  const json = JSON.stringify(manifest, null, 2) + '\n'

  const newReadme = spliceReadme(readFileSync(readmeFile, 'utf8'), renderCatalog(manifest))

  if (check) {
    const curJson = existsSync(outFile) ? readFileSync(outFile, 'utf8') : ''
    const curReadme = readFileSync(readmeFile, 'utf8')
    const staleJson = curJson !== json
    const staleReadme = curReadme !== newReadme
    if (staleJson || staleReadme) {
      const what = [staleJson && 'theme.manifest.json', staleReadme && 'README.md catalog']
        .filter(Boolean)
        .join(' + ')
      console.error(`✗ ${what} stale. Run \`node scripts/gen-manifest.mjs\` and commit the result.`)
      process.exitCode = 1
    } else {
      console.log('✓ theme.manifest.json + README catalog are up to date.')
    }
  } else {
    writeFileSync(outFile, json)
    writeFileSync(readmeFile, newReadme)
    const { sections, templates, layouts } = manifest.stats
    console.log(
      `✓ theme.manifest.json + README catalog — ${sections} sections, ${templates} templates, ${layouts} layouts`,
    )
    const { danglingTemplateRefs, settingsUndeclared, settingsMissingValue } = manifest.warnings
    for (const d of danglingTemplateRefs) console.warn(`⚠ template ${d.template} → unknown section ${d.type}`)
    for (const k of settingsUndeclared) console.warn(`⚠ settings.json key '${k}' has no schema entry`)
    for (const k of settingsMissingValue) console.warn(`⚠ schema key '${k}' has no value in settings.json`)
  }
} finally {
  await server.close()
}
