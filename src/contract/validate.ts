/**
 * THE validator. One implementation, called by the Editor API, the CLI, the AI
 * tools and the theme's own test suite — so "valid" means the same thing in all
 * four, and a fix in one is a fix in all.
 *
 * Dependency-free on purpose: studio-api ships a zero-npm-dependency image
 * (`studio/CLAUDE.md` → Conventions), so it consumes the built single-file
 * artifact rather than an npm install.
 *
 * Every finding carries `nodeId` + `path` + `code` + `message`. The codes are
 * stable identifiers a caller can branch on; the messages are written to be
 * actionable by whoever reads them — including a model feeding them into a
 * repair loop, which is why they name the correct value rather than only
 * rejecting the wrong one.
 */
import {
  canonicalFieldType,
  fieldType,
  FIELD_TYPE_ALIASES,
  EDITOR_ONLY_TYPES,
  UNIVERSAL_CONSTRAINTS,
} from './field-types'
import {
  NODE_ID_PATTERN,
  TEMPLATE_AREAS,
  roleOf,
  type AttrContract,
  type ContractNode,
  type ContractPageDoc,
  type SectionContract,
  type TemplateArea,
} from './content'
import {
  GROUP_SLOTS,
  GROUP_NAME_PATTERN,
  isSectionGroupDoc,
  resolvePage,
  type GroupMap,
  type GroupedPageDoc,
} from './groups'

export type Severity = 'error' | 'warning'

export interface ValidationIssue {
  severity: Severity
  /** Stable machine identifier. Callers branch on this, never on `message`. */
  code: ValidationCode
  /** The node this is about, when there is one. */
  nodeId?: string
  /** JSON path into the document, e.g. `sections[2].blocks[0].settings.answer`. */
  path: string
  message: string
  /** The corrected value, when the validator knows it (aliases, casing). */
  suggestion?: string
}

export type ValidationCode =
  | 'unknown_component'
  | 'unknown_setting'
  | 'unknown_field_type'
  | 'alias_field_type'
  | 'editor_only_field_type'
  | 'missing_node_id'
  | 'invalid_node_id'
  | 'duplicate_node_id'
  | 'disallowed_nesting'
  | 'leaf_cannot_nest'
  | 'invalid_area'
  | 'invalid_value'
  | 'missing_required_constraint'
  | 'invalid_binding'
  | 'missing_context'
  | 'invalid_placement'
  | 'unknown_group'
  | 'invalid_group'

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

/** The section catalogue a document is validated against. */
export type SectionCatalog = Record<string, SectionContract>

export interface ValidateOptions {
  /**
   * Route context available where this document renders, for `requiresContext`.
   * When supplied, a section placed outside its required context is an ERROR —
   * the caller has said where this renders, and it would show a not-found
   * state on every visit. Omitted → the same finding is a warning.
   */
  context?: readonly string[]
  /**
   * Treat unknown settings as warnings rather than errors. Off by default: an
   * unknown setting is silently dropped at render, so the template claims to
   * configure something it does not.
   */
  lenientSettings?: boolean
  /** Base template slug this document is, for `placement.templates`. */
  template?: string
}

const err = (
  code: ValidationCode,
  path: string,
  message: string,
  nodeId?: string,
  suggestion?: string,
): ValidationIssue => ({
  severity: 'error', code, path, message,
  ...(nodeId ? { nodeId } : {}),
  ...(suggestion ? { suggestion } : {}),
})

const warn = (
  code: ValidationCode,
  path: string,
  message: string,
  nodeId?: string,
  suggestion?: string,
): ValidationIssue => ({
  severity: 'warning', code, path, message,
  ...(nodeId ? { nodeId } : {}),
  ...(suggestion ? { suggestion } : {}),
})

// ── Section definitions ──────────────────────────────────────────────────

/**
 * Validate a section's own declaration — the shape a theme author or an AI
 * writes in `defineSection({...})`.
 */
export function validateSectionContract(def: SectionContract): ValidationResult {
  const issues: ValidationIssue[] = []
  const base = `sections.${def.name}`

  for (const [key, spec] of Object.entries(def.attributes ?? {})) {
    issues.push(...validateAttr(spec, `${base}.attributes.${key}`, def.name))
  }

  for (const [i, preset] of (def.presets ?? []).entries()) {
    for (const [j, block] of (preset.blocks ?? []).entries()) {
      const p = `${base}.presets[${i}].blocks[${j}]`
      if (!def.allowedBlocks?.includes(block.type)) {
        issues.push(err('disallowed_nesting', p,
          `Preset nests "${block.type}", which is not in allowedBlocks (${(def.allowedBlocks ?? []).join(', ') || 'none'}).`,
          def.name))
      }
    }
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues }
}

/** Validate one attribute declaration. */
function validateAttr(spec: AttrContract, path: string, nodeId?: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const declared = spec?.type

  const canonical = canonicalFieldType(declared)
  if (!canonical) {
    if (typeof declared === 'string' && (EDITOR_ONLY_TYPES as readonly string[]).includes(declared)) {
      issues.push(err('editor_only_field_type', `${path}.type`,
        `"${declared}" is rendered by the editor but cannot be declared by a theme. Use a core type; promoting it requires a contract change.`,
        nodeId))
    } else {
      issues.push(err('unknown_field_type', `${path}.type`,
        `Unknown field type "${String(declared)}". It will be silently downgraded to a plain text box.`,
        nodeId))
    }
    return issues
  }

  const aliasTarget = (FIELD_TYPE_ALIASES as Record<string, string>)[String(declared)]
  if (aliasTarget) {
    issues.push(warn('alias_field_type', `${path}.type`,
      `"${declared}" is a legacy alias — use "${aliasTarget}".`, nodeId, aliasTarget))
  }

  const def = fieldType(canonical)!

  // Required constraints: a select with no options is an empty dropdown.
  if (def.constraints.includes('options') && !Array.isArray(spec.options)) {
    issues.push(err('missing_required_constraint', `${path}.options`,
      `Field type "${canonical}" requires \`options: [{ value, label }]\`.`, nodeId))
  }

  // Constraints that do nothing on this type are a sign the author expected
  // different behaviour — the `columns`-on-a-section class of mistake.
  for (const key of Object.keys(spec ?? {})) {
    if (key === 'type') continue
    if ((UNIVERSAL_CONSTRAINTS as readonly string[]).includes(key)) continue
    if (def.constraints.includes(key)) continue
    issues.push(warn('invalid_value', `${path}.${key}`,
      `"${key}" has no meaning for field type "${canonical}" and is ignored.`, nodeId))
  }

  if (spec.dynamic === true && !def.dynamicBindable) {
    issues.push(err('invalid_binding', `${path}.dynamic`,
      `Field type "${canonical}" cannot be bound to a dynamic source.`, nodeId))
  }

  if (spec.default !== undefined) {
    const t = typeof spec.default
    const want = def.value
    const okType =
      (want === 'string' && t === 'string') ||
      (want === 'number' && t === 'number') ||
      (want === 'boolean' && t === 'boolean') ||
      (want === 'string[]' && Array.isArray(spec.default))
    if (!okType) {
      issues.push(err('invalid_value', `${path}.default`,
        `Default for "${canonical}" should be ${want}, got ${Array.isArray(spec.default) ? 'array' : t}.`,
        nodeId))
    }
  }

  return issues
}

// ── Content tree ─────────────────────────────────────────────────────────

/**
 * Validate a template document against a section catalogue.
 *
 * This is the check that makes the FAQ round trip provable: unknown component,
 * unknown setting, disallowed nesting, duplicate id and missing id are each a
 * distinct, addressable failure instead of a silent drop at render time.
 */
export function validateDocument(
  doc: ContractPageDoc,
  catalog: SectionCatalog,
  opts: ValidateOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = []
  const sections = Array.isArray(doc?.sections) ? doc.sections : []

  if (!Array.isArray(doc?.sections)) {
    issues.push(err('invalid_value', 'sections',
      'Document must have a `sections` array. The editor\'s object-map shape must be converted before it reaches disk.'))
    return { ok: false, issues }
  }

  walkLevel(sections, 'sections', null, catalog, issues, opts)
  return { ok: !issues.some((i) => i.severity === 'error'), issues }
}

function walkLevel(
  nodes: ContractNode[],
  basePath: string,
  parent: SectionContract | null,
  catalog: SectionCatalog,
  issues: ValidationIssue[],
  opts: ValidateOptions,
): void {
  const seen = new Map<string, number>()

  nodes.forEach((node, i) => {
    const path = `${basePath}[${i}]`
    const id = node?.id

    // ── identity ──
    if (typeof id !== 'string' || id === '') {
      issues.push(err('missing_node_id', `${path}.id`,
        `Node of type "${node?.type}" has no id. Ids must be explicit — a missing id is filled in from the node's POSITION, so reordering silently reassigns it to different content.`,
        undefined, `${String(node?.type ?? 'node')}_<8 hex>`))
    } else if (!NODE_ID_PATTERN.test(id)) {
      issues.push(err('invalid_node_id', `${path}.id`,
        `Node id "${id}" must match ${NODE_ID_PATTERN.source}.`, id))
    } else if (seen.has(id)) {
      issues.push(err('duplicate_node_id', `${path}.id`,
        `Duplicate node id "${id}" (also at index ${seen.get(id)}). The editor keys nodes by id, so the later one overwrites the earlier.`,
        id))
    } else {
      seen.set(id, i)
    }

    // ── component ──
    const def = catalog[node?.type]
    if (!def) {
      issues.push(err('unknown_component', `${path}.type`,
        `Unknown component "${String(node?.type)}". It renders nothing and the editor offers no controls for it.`,
        id))
      return
    }

    // ── nesting ──
    if (parent) {
      const allowed = parent.allowedBlocks ?? []
      if (allowed.length === 0) {
        issues.push(err('leaf_cannot_nest', path,
          `"${parent.name}" declares no allowedBlocks, so it cannot contain "${node.type}".`, id))
      } else if (!allowed.includes(node.type)) {
        issues.push(err('disallowed_nesting', path,
          `"${parent.name}" does not allow "${node.type}". Allowed: ${allowed.join(', ')}.`, id))
      }
    }

    // ── area ──
    if (node.area !== undefined && !(TEMPLATE_AREAS as readonly string[]).includes(node.area)) {
      issues.push(err('invalid_area', `${path}.area`,
        `Invalid area "${node.area}". Expected one of: ${TEMPLATE_AREAS.join(', ')}.`, id))
    }

    // ── role / placement ──
    // A block at the top level, or a section nested inside another, is placed
    // where it cannot render meaningfully; `category` used to be the only
    // signal and it is a display grouping, not a rule.
    const role = roleOf(def)
    if (!parent && role === 'block') {
      issues.push(err('invalid_placement', path,
        `"${def.name}" is a block and can only be placed inside a section that allows it${
          def.placement?.parents?.length ? ` (${def.placement.parents.join(', ')})` : ''
        }.`, id))
    }
    // Nesting itself is governed by the parent's `allowedBlocks` (checked
    // above): a parent may legitimately host a section-role unit as a block —
    // Nova's footer lists `newsletter`. Only chrome can never be nested.
    if (parent && role === 'layout') {
      issues.push(err('invalid_placement', path,
        `"${def.name}" is a layout section and cannot be nested inside "${parent.name}".`, id))
    }
    if (!parent) {
      const slot: TemplateArea = (node.area as TemplateArea | undefined) ??
        (def.area ?? (def.name === 'header' ? 'header' : def.name === 'footer' ? 'footer' : 'template'))
      const allowedAreas = def.placement?.areas ?? (def.area ? [def.area] : undefined)
      if (allowedAreas && !allowedAreas.includes(slot)) {
        issues.push(err('invalid_placement', `${path}.area`,
          `"${def.name}" may only be placed in: ${allowedAreas.join(', ')} — not "${slot}".`, id,
          allowedAreas[0]))
      }
      if (def.placement?.templates?.length && opts.template) {
        const base = opts.template.split('.')[0] ?? opts.template
        if (!def.placement.templates.includes(base)) {
          issues.push(err('invalid_placement', path,
            `"${def.name}" may only be placed on: ${def.placement.templates.join(', ')} — not "${base}".`, id))
        }
      }
    }
    if (parent && def.placement?.parents?.length && !def.placement.parents.includes(parent.name)) {
      issues.push(err('invalid_placement', path,
        `"${def.name}" may only be placed inside: ${def.placement.parents.join(', ')} — not "${parent.name}".`, id))
    }

    // ── settings ──
    for (const [key, value] of Object.entries(node.settings ?? {})) {
      const spec = def.attributes?.[key]
      const sPath = `${path}.settings.${key}`
      if (!spec) {
        const near = nearest(key, Object.keys(def.attributes ?? {}))
        issues.push({
          severity: opts.lenientSettings ? 'warning' : 'error',
          code: 'unknown_setting',
          ...(id ? { nodeId: id } : {}),
          path: sPath,
          message: `"${node.type}" does not declare a setting "${key}"; it is dropped at render and has no editor control.${near ? ` Did you mean "${near}"?` : ''}`,
          ...(near ? { suggestion: near } : {}),
        })
        continue
      }
      issues.push(...validateSettingValue(spec, value, sPath, id))
    }

    // ── required context ──
    // Known context → an error: the caller has said where this renders, and a
    // product block on the cart page shows a not-found state on every visit.
    // Unknown context → a warning, so a bare document check still says so.
    if (def.requiresContext?.length) {
      const ctx = opts.context
      for (const need of def.requiresContext) {
        if (ctx === undefined) {
          issues.push(warn('missing_context', path,
            `"${def.name}" needs ${need} context; check the template that will host it provides one.`, id))
        } else if (!ctx.includes(need)) {
          issues.push(err('missing_context', path,
            `"${def.name}" needs ${need} context, which this template does not provide.`, id))
        }
      }
    }

    // ── children ──
    if (node.blocks?.length) {
      walkLevel(node.blocks, `${path}.blocks`, def, catalog, issues, opts)
    }
  })
}

/** Check one authored VALUE against its declared field type. */
function validateSettingValue(
  spec: AttrContract,
  value: unknown,
  path: string,
  nodeId?: string,
): ValidationIssue[] {
  const canonical = canonicalFieldType(spec.type)
  if (!canonical) return [] // the definition itself is already reported

  const def = fieldType(canonical)!
  const issues: ValidationIssue[] = []
  if (value === null || value === undefined) return issues

  const t = typeof value
  const okType =
    (def.value === 'string' && t === 'string') ||
    (def.value === 'number' && t === 'number') ||
    (def.value === 'boolean' && t === 'boolean') ||
    (def.value === 'string[]' && Array.isArray(value))

  if (!okType) {
    issues.push(err('invalid_value', path,
      `Expected ${def.value} for field type "${canonical}", got ${Array.isArray(value) ? 'array' : t}.`,
      nodeId))
    return issues
  }

  if (Array.isArray(spec.options) && typeof value === 'string') {
    // Options are `{ value, label }` by contract; a bare string is the editor's
    // accepted shorthand (normOptions) and must not crash the validator, which
    // would turn a merchant's save into a 500 instead of an issue.
    const allowed = (spec.options as unknown[])
      .map((o) => (typeof o === 'string' ? o : (o as { value?: unknown } | null)?.value))
      .filter((v): v is string => typeof v === 'string')
    if (!allowed.includes(value)) {
      issues.push(err('invalid_value', path,
        `"${value}" is not one of the declared options: ${allowed.join(', ')}.`, nodeId,
        nearest(value, allowed) ?? undefined))
    }
  }

  if (typeof value === 'number') {
    if (typeof spec.min === 'number' && value < spec.min) {
      issues.push(err('invalid_value', path, `${value} is below the minimum ${spec.min}.`, nodeId))
    }
    if (typeof spec.max === 'number' && value > spec.max) {
      issues.push(err('invalid_value', path, `${value} is above the maximum ${spec.max}.`, nodeId))
    }
  }

  return issues
}

/** Closest candidate by edit distance, for "did you mean" — only when close. */
function nearest(input: string, candidates: string[]): string | null {
  let best: string | null = null
  let bestScore = Infinity
  for (const c of candidates) {
    const d = distance(input.toLowerCase(), c.toLowerCase())
    if (d < bestScore) { bestScore = d; best = c }
  }
  const limit = Math.max(2, Math.floor(input.length / 3))
  return best !== null && bestScore <= limit ? best : null
}

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const cur = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!
  }
  return prev[b.length]!
}

// ── Groups ───────────────────────────────────────────────────────────────

/** Validate one `groups/<name>.json` document against the catalogue. */
export function validateGroup(
  name: string,
  group: unknown,
  catalog: SectionCatalog,
  opts: ValidateOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = []
  if (!GROUP_NAME_PATTERN.test(name)) {
    issues.push(err('invalid_group', `groups.${name}`, `Group name "${name}" must match ${GROUP_NAME_PATTERN.source}.`))
  }
  if (!isSectionGroupDoc(group)) {
    issues.push(err('invalid_group', `groups.${name}`,
      `A group must be { type: ${GROUP_SLOTS.join(' | ')}, sections: [] }.`))
    return { ok: false, issues }
  }
  // A group's nodes are validated as top-level nodes of their slot: a block
  // cannot sit directly in a header, and a section limited to the template
  // area cannot be shared as a footer.
  const nodes = group.sections.map((n) => (n.area === undefined ? { ...n, area: group.type } : n))
  walkLevel(nodes, `groups.${name}.sections`, null, catalog, issues, { ...opts, context: opts.context ?? [] })
  return { ok: !issues.some((i) => i.severity === 'error'), issues }
}

/**
 * Validate a template TOGETHER with the groups it binds — the check the editor,
 * studio-api and the AI tools run before a save.
 *
 *   - the template's own body validates as before;
 *   - each `ref` must name a supplied group (`unknown_group` otherwise);
 *   - each `override` validates as that slot's nodes;
 *   - the RESOLVED page is checked for duplicate ids across slots, so a group
 *     node and a body node cannot share an id.
 */
export function validatePage(
  template: GroupedPageDoc,
  groups: GroupMap,
  catalog: SectionCatalog,
  opts: ValidateOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = []
  const base = validateDocument(template, catalog, opts)
  issues.push(...base.issues)

  const bindings = template?.groups ?? {}
  for (const slot of GROUP_SLOTS) {
    const b = bindings[slot]
    if (b === undefined) continue
    const path = `groups.${slot}`
    if (typeof b === 'string' || (b && typeof b === 'object' && 'ref' in b)) {
      const ref = typeof b === 'string' ? b : (b as { ref: string }).ref
      if (typeof ref !== 'string' || !ref) {
        issues.push(err('invalid_group', path, `Slot "${slot}" binding must be a group name or { override: [] }.`))
      } else if (!groups[ref]) {
        issues.push(err('unknown_group', path,
          `Slot "${slot}" references group "${ref}", which does not exist (groups/${ref}.json).`,
          undefined, Object.keys(groups).find((g) => groups[g]!.type === slot)))
      } else if (groups[ref]!.type !== slot) {
        issues.push(err('invalid_group', path,
          `Group "${ref}" is a ${groups[ref]!.type} group and cannot fill the ${slot} slot.`))
      }
    } else if (b && typeof b === 'object' && 'override' in b) {
      const nodes = (b as { override: ContractNode[] }).override
      if (!Array.isArray(nodes)) {
        issues.push(err('invalid_group', path, `Slot "${slot}" override must be an array of sections.`))
      } else {
        walkLevel(nodes.map((n) => (n.area === undefined ? { ...n, area: slot } : n)),
          `${path}.override`, null, catalog, issues, opts)
      }
    } else {
      issues.push(err('invalid_group', path, `Slot "${slot}" binding must be a group name or { override: [] }.`))
    }
  }

  // Duplicate ids across slots: the editor and every targeted edit key by id.
  // Labels come from the slot each node was resolved INTO, not from the
  // provenance map — a duplicate id has already overwritten its own entry there.
  const resolved = resolvePage(template, groups)
  const labelled: Array<{ id: string; label: string }> = []
  for (const slot of GROUP_SLOTS) {
    const r = resolved.slots[slot]
    const label = r.mode === 'ref' ? `group ${r.group}` : `${slot} ${r.mode}`
    for (const n of r.sections) if (n.id) labelled.push({ id: n.id, label })
  }
  const headerCount = resolved.slots.header.sections.length
  const footerCount = resolved.slots.footer.sections.length
  const body = resolved.sections.slice(headerCount, resolved.sections.length - footerCount)
  const bodyLabelled = body.filter((n) => n.id).map((n) => ({ id: n.id!, label: 'template' }))
  const ordered = [...labelled.slice(0, headerCount), ...bodyLabelled, ...labelled.slice(headerCount)]
  const seen = new Map<string, string>()
  ordered.forEach(({ id, label }, i) => {
    if (seen.has(id)) {
      issues.push(err('duplicate_node_id', `resolved[${i}].id`,
        `Node id "${id}" appears in both ${seen.get(id)} and ${label}. Ids must be unique across the page including its shared groups.`,
        id))
    } else {
      seen.set(id, label)
    }
  })

  return { ok: !issues.some((i) => i.severity === 'error'), issues }
}

/** Render issues as human lines — shared by the CLI and error responses. */
export function formatIssues(issues: ValidationIssue[]): string {
  return issues
    .map((i) => `${i.severity === 'error' ? '✗' : '⚠'} [${i.code}] ${i.path}: ${i.message}`)
    .join('\n')
}
