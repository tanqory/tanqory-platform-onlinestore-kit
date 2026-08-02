// Ship the non-bundled artefacts alongside the library build:
//   tokens.css       — the CSS variable vocabulary every theme section depends
//                      on (themes @import it from assets/styles.css)
//   gen-manifest.mjs — the theme.manifest.json generator (bin + subpath export)
//   vite-preset.mjs  — the shared theme Vite config (+ its hand-written .d.ts)
//
// These are copied, not rolled up: they run in Node (or are consumed by
// PostCSS), so bundling them through the React library build would be wrong.
import { copyFileSync, chmodSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dist = join(root, 'dist')

mkdirSync(dist, { recursive: true })

copyFileSync(join(root, 'src/app/tokens.css'), join(dist, 'tokens.css'))
copyFileSync(join(root, 'scripts/gen-manifest.mjs'), join(dist, 'gen-manifest.mjs'))
copyFileSync(join(root, 'scripts/vite-preset.mjs'), join(dist, 'vite-preset.mjs'))
copyFileSync(join(root, 'scripts/vite-preset.d.ts'), join(dist, 'vite-preset.d.ts'))
chmodSync(join(dist, 'gen-manifest.mjs'), 0o755)

console.log('✓ copied tokens.css + gen-manifest.mjs + vite-preset.mjs → dist/')
