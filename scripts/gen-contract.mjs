/**
 * Emit the distributable Theme Contract artifacts from the built module.
 *
 *   contract/theme-contract.json   the data — vendored by studio-api, read by AI
 *   contract/schemas/*.schema.json JSON Schema for section defs + content trees
 *   contract/AI-GUIDE.md           the authoring rules, generated from the table
 *
 * Everything is DERIVED from `dist/contract.js`, which is compiled from
 * `src/contract/*.ts`, whose table `AttrSpec['type']` is itself derived from.
 * There is one hand-edited source and `tsc` proves the chain — so these files
 * cannot drift from the types the way eight hand-maintained copies did.
 *
 *   node scripts/gen-contract.mjs [--check]
 *
 * `--check` regenerates in memory and exits 1 if what is committed differs —
 * the same CI ratchet `theme-nova/scripts/gen-manifest.mjs` uses.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(root, 'contract')
const check = process.argv.includes('--check')

const dist = join(root, 'dist', 'contract.js')
if (!existsSync(dist)) {
  console.error('✗ dist/contract.js missing — run `pnpm build` first.')
  process.exit(1)
}

const C = await import(`file://${dist}`)
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// ── theme-contract.json ───────────────────────────────────────────────────
const data = {
  $schema: 'https://schemas.tanqory.com/theme-contract/v1',
  contractVersion: C.CONTRACT_VERSION,
  kitVersion: pkg.version,
  kitCompatibility: C.KIT_COMPATIBILITY,
  generatedFrom: 'src/contract/*.ts (do not hand-edit — run `pnpm contract`)',

  fieldTypes: C.FIELD_TYPES.map((t) => ({ ...t })),
  fieldTypeAliases: { ...C.FIELD_TYPE_ALIASES },
  editorOnlyTypes: [...C.EDITOR_ONLY_TYPES],
  universalConstraints: [...C.UNIVERSAL_CONSTRAINTS],

  content: {
    currentVersion: C.CURRENT_CONTENT_VERSION,
    nodeIdPattern: C.NODE_ID_PATTERN.source,
    areas: [...C.TEMPLATE_AREAS],
    contextKinds: [...C.CONTEXT_KINDS],
    roles: [...C.SECTION_ROLES],
    groupSlots: [...C.GROUP_SLOTS],
    groupNamePattern: C.GROUP_NAME_PATTERN.source,
    // The context each base template provides — the validator's default when a
    // caller names the template instead of listing kinds by hand.
    templateContext: Object.fromEntries(
      ['index', 'product', 'collection', 'list-collections', 'page', 'blog', 'article', 'cart', 'search', '404', 'account']
        .map((t) => [t, C.templateContext(t)]),
    ),
  },
}

// ── JSON Schemas ──────────────────────────────────────────────────────────
const coreIds = C.FIELD_TYPES.map((t) => t.id)
const allTypeIds = [...coreIds, ...Object.keys(C.FIELD_TYPE_ALIASES)]

const attrSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.tanqory.com/theme-contract/v1/attr-spec.schema.json',
  title: 'AttrSpec',
  description: 'One editor-facing setting on a section or block.',
  type: 'object',
  required: ['type'],
  properties: {
    type: { enum: allTypeIds },
    default: {},
    label: { type: 'string' },
    info: { type: 'string' },
    placeholder: { type: 'string' },
    group: { type: 'string' },
    dynamic: { type: 'boolean' },
    visible_if: { oneOf: [{ type: 'string' }, { type: 'object' }] },
    min: { type: 'number' },
    max: { type: 'number' },
    step: { type: 'number' },
    unit: { type: 'string' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        required: ['value', 'label'],
        properties: { value: { type: 'string' }, label: { type: 'string' } },
      },
    },
  },
  additionalProperties: false,
}

const nodeSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.tanqory.com/theme-contract/v1/content-node.schema.json',
  title: 'ContractNode',
  description:
    'A section instance or child block. `id` is REQUIRED: a missing id is filled in from the node position, so reordering silently reassigns it to different content.',
  type: 'object',
  required: ['type', 'id'],
  properties: {
    type: { type: 'string' },
    id: { type: 'string', pattern: C.NODE_ID_PATTERN.source },
    settings: { type: 'object' },
    area: { enum: [...C.TEMPLATE_AREAS] },
    blocks: { type: 'array', items: { $ref: '#' } },
  },
}

const groupBindingSchema = {
  oneOf: [
    { type: 'string', pattern: C.GROUP_NAME_PATTERN.source, description: 'Shared group name (groups/<name>.json).' },
    { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } }, additionalProperties: false },
    {
      type: 'object', required: ['override'],
      properties: { override: { type: 'array', items: { $ref: 'content-node.schema.json' } } },
      additionalProperties: false,
      description: 'A page-specific composition; the shared group is not rendered on this page.',
    },
  ],
}

const groupSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.tanqory.com/theme-contract/v1/section-group.schema.json',
  title: 'SectionGroupDoc',
  description: 'A shared header or footer as stored at groups/<name>.json — the single source of truth every template binding it renders.',
  type: 'object',
  required: ['type', 'sections'],
  properties: {
    type: { enum: [...C.GROUP_SLOTS] },
    name: { type: 'string' },
    contentVersion: { type: 'integer', minimum: 1 },
    sections: { type: 'array', items: { $ref: 'content-node.schema.json' } },
  },
}

const pageSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.tanqory.com/theme-contract/v1/page-doc.schema.json',
  title: 'PageDoc',
  description: 'A template document as stored at templates/<slug>.json.',
  type: 'object',
  required: ['sections'],
  properties: {
    contentVersion: { type: 'integer', minimum: 1 },
    groups: {
      type: 'object',
      description: 'Content version 2: how each shared slot is filled. Absent = the inline header/footer sections in `sections` (version 1).',
      properties: Object.fromEntries(C.GROUP_SLOTS.map((s) => [s, groupBindingSchema])),
      additionalProperties: false,
    },
    sections: {
      type: 'array',
      items: { $ref: 'content-node.schema.json' },
    },
  },
}

const sectionSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.tanqory.com/theme-contract/v1/section-def.schema.json',
  title: 'SectionContract',
  description: 'The serialisable half of defineSection() — everything but `component`.',
  type: 'object',
  required: ['name', 'title', 'attributes'],
  properties: {
    name: { type: 'string' },
    title: { type: 'string' },
    category: { type: 'string' },
    icon: { type: 'string' },
    attributes: { type: 'object', additionalProperties: { $ref: 'attr-spec.schema.json' } },
    allowedBlocks: { type: 'array', items: { type: 'string' } },
    requiresContext: { type: 'array', items: { enum: [...C.CONTEXT_KINDS] } },
    role: { enum: [...C.SECTION_ROLES], description: 'section | block | layout. Absent = derived from category/area/name.' },
    area: { enum: [...C.TEMPLATE_AREAS], description: 'Default slot for a layout section.' },
    placement: {
      type: 'object',
      properties: {
        areas: { type: 'array', items: { enum: [...C.TEMPLATE_AREAS] } },
        templates: { type: 'array', items: { type: 'string' } },
        parents: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    presets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          settings: { type: 'object' },
          blocks: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  },
}

// ── AI-GUIDE.md ───────────────────────────────────────────────────────────
function aiGuide() {
  const L = []
  L.push('# Tanqory Theme Contract — authoring rules for AI')
  L.push('')
  L.push(`Contract \`${C.CONTRACT_VERSION}\` · theme-kit \`${C.KIT_COMPATIBILITY.min}\`–\`${C.KIT_COMPATIBILITY.maxVerified}\``)
  L.push('')
  L.push('**Generated from the contract — do not hand-edit, and do not copy these')
  L.push('names into a prompt.** Read this file (or `theme-contract.json`) at author')
  L.push('time instead: a memorised list is how the generator ended up teaching')
  L.push('`image_picker`, which the CMS silently rewrites to a plain text box.')
  L.push('')
  L.push('## Rules that are not negotiable')
  L.push('')
  L.push('1. **Every node carries an explicit `id`.** Format:')
  L.push(`   \`${'`'}<type>_<8 chars>${'`'}\` matching \`${C.NODE_ID_PATTERN.source}\`.`)
  L.push('   A node without an id is given one derived from its POSITION, so any')
  L.push('   reorder silently reassigns that id to different content — and a later')
  L.push('   targeted edit then hits the wrong node.')
  L.push('2. **Only declared settings.** A key the section does not declare is')
  L.push('   dropped at render and gets no editor control.')
  L.push('3. **Only `allowedBlocks` may nest.** A section with no `allowedBlocks` is a leaf.')
  L.push('4. **`area` is one of:** ' + C.TEMPLATE_AREAS.map((a) => `\`${a}\``).join(', ') + '.')
  L.push('5. **Validate before you finish.** `validatePage(template, groups, catalog, { template })` returns')
  L.push('   `{nodeId, path, code, message}` — fix what it reports rather than guessing.')
  L.push('6. **Header and footer are SHARED.** `groups/header.json` and `groups/footer.json` are the')
  L.push('   single source of truth; a template binds them with `"groups": { "header": "header", "footer": "footer" }`.')
  L.push('   Editing a group changes EVERY page that binds it — read the impact list before writing.')
  L.push('   A page that must differ says so explicitly: `"header": { "override": [ …sections ] }`.')
  L.push('   Never copy the header into a template body; never edit a group to change one page.')
  L.push('7. **Respect `role`, `placement` and `requiresContext`.** A `block` only nests inside a')
  L.push('   parent that lists it; a `layout` unit lives in its `area`; a section that `requiresContext`')
  L.push('   (e.g. `product`) is REJECTED on a template that does not provide it — the validator says which.')
  L.push('8. **Edit by stable id with a revision.** Read the page (`GET /tq/v2/page`), change nodes by')
  L.push('   `id`, write back with the revisions you read. A `409 revision_conflict` means someone')
  L.push('   else saved first: re-read and re-apply, never retry the stale write.')
  L.push('')
  L.push('## Field types')
  L.push('')
  L.push('| type | control | value | bindable | AI may emit | notes |')
  L.push('| --- | --- | --- | :-: | :-: | --- |')
  for (const t of C.FIELD_TYPES) {
    const notes = [
      t.constraints.length ? `requires/uses: ${t.constraints.join(', ')}` : '',
      t.resource ? `value = ${t.resource} handle` : '',
      t.media ? `media: ${t.media}` : '',
    ].filter(Boolean).join('; ')
    L.push(`| \`${t.id}\` | ${t.control} | ${t.value} | ${t.dynamicBindable ? '✅' : '—'} | ${t.aiGenerate ? '✅' : '—'} | ${notes} |`)
  }
  L.push('')
  L.push('### Accepted aliases (normalised — prefer the canonical name)')
  L.push('')
  for (const [alias, target] of Object.entries(C.FIELD_TYPE_ALIASES)) {
    L.push(`- \`${alias}\` → \`${target}\``)
  }
  L.push('')
  L.push('### Rendered by the editor but NOT declarable by a theme')
  L.push('')
  L.push(C.EDITOR_ONLY_TYPES.map((t) => `\`${t}\``).join(' · '))
  L.push('')
  L.push('Declaring one of these is an error, not a downgrade — the theme cannot')
  L.push('reach these controls until the contract promotes them.')
  L.push('')
  L.push('## Per-type detail')
  L.push('')
  for (const t of C.FIELD_TYPES) {
    L.push(`- **\`${t.id}\`** — ${t.doc}`)
  }
  L.push('')
  return L.join('\n') + '\n'
}

// ── write / check ─────────────────────────────────────────────────────────
const files = {
  'theme-contract.json': JSON.stringify(data, null, 2) + '\n',
  'schemas/attr-spec.schema.json': JSON.stringify(attrSchema, null, 2) + '\n',
  'schemas/content-node.schema.json': JSON.stringify(nodeSchema, null, 2) + '\n',
  'schemas/page-doc.schema.json': JSON.stringify(pageSchema, null, 2) + '\n',
  'schemas/section-def.schema.json': JSON.stringify(sectionSchema, null, 2) + '\n',
  'schemas/section-group.schema.json': JSON.stringify(groupSchema, null, 2) + '\n',
  'AI-GUIDE.md': aiGuide(),
}

let stale = []
for (const [rel, content] of Object.entries(files)) {
  const path = join(outDir, rel)
  if (check) {
    const cur = existsSync(path) ? readFileSync(path, 'utf8') : ''
    if (cur !== content) stale.push(rel)
  } else {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
}

if (check) {
  if (stale.length) {
    console.error(`✗ contract/ stale: ${stale.join(', ')}. Run \`pnpm contract\` and commit.`)
    process.exitCode = 1
  } else {
    console.log('✓ contract/ is up to date.')
  }
} else {
  console.log(
    `✓ contract/ — v${C.CONTRACT_VERSION}, ${C.FIELD_TYPES.length} field types, ` +
    `${Object.keys(C.FIELD_TYPE_ALIASES).length} aliases, ${Object.keys(files).length} files`,
  )
}
