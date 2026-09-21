/**
 * Section groups — the shared header/footer contract.
 *
 * The problem this solves: every template carried its own copy of the header
 * and footer (17 of Nova's 18 templates, and all 12 marketplace forks). Editing
 * the header on the home page changed the home page only; the other sixteen
 * copies drifted silently, and there was no way to say "this page is different
 * on purpose" versus "nobody updated this copy".
 *
 * The model, in Tanqory's JSON-tree vocabulary:
 *
 *   groups/<name>.json     ONE source of truth per shared slot:
 *                          { "type": "header", "sections": [ …ContractNode ] }
 *
 *   templates/<slug>.json  references the group instead of copying it:
 *                          { "groups": { "header": "header", "footer": "footer" },
 *                            "sections": [ …template-area sections only ] }
 *
 *                          or overrides it for THIS page, explicitly:
 *                          { "groups": { "header": { "override": [ …nodes ] } } }
 *
 * `resolvePage` is the ONLY function that turns a template + its groups into
 * the flat section list the runtime renders. The storefront, the SSG, the
 * editor preview bridge, studio-api and the AI tools all call it, so "what
 * does this page render" cannot be answered two different ways.
 *
 * Backward compatibility is total: a template with no `groups` key and inline
 * header/footer sections (every template that exists today) resolves exactly
 * as it did — those inline sections are treated as an implicit per-page
 * override. Nothing has to migrate to keep working; migrating is what makes the
 * header SHARED.
 */
import { NODE_ID_PATTERN, type ContractNode, type ContractPageDoc, type TemplateArea } from './content'

/** The slots a group can fill. `template` is the page body and is never shared. */
export type GroupSlot = 'header' | 'footer'
export const GROUP_SLOTS: readonly GroupSlot[] = ['header', 'footer']

/** A shared section group as stored at `groups/<name>.json`. */
export interface SectionGroupDoc {
  /** Which slot this group fills. */
  type: GroupSlot
  /** Human label for the editor; defaults to the file name. */
  name?: string
  sections: ContractNode[]
  contentVersion?: number
}

/**
 * How a template binds a slot.
 *   - a string             → shorthand for `{ ref: <name> }`
 *   - `{ ref }`            → the shared group at `groups/<ref>.json`
 *   - `{ override: [...] }`→ a page-specific composition; the shared group is
 *                            NOT rendered on this page
 */
export type GroupBinding = string | { ref: string } | { override: ContractNode[] }

/** A template that knows about groups. Superset of `ContractPageDoc`. */
export interface GroupedPageDoc extends ContractPageDoc {
  groups?: Partial<Record<GroupSlot, GroupBinding>>
}

/** Where a resolved node came from — what the editor shows and what a save must respect. */
export type NodeSource =
  | { kind: 'group'; slot: GroupSlot; group: string }
  | { kind: 'override'; slot: GroupSlot }
  | { kind: 'inline'; slot: GroupSlot }
  | { kind: 'template' }

export interface SlotResolution {
  /** `ref` = shared group · `override` = explicit per-page · `inline` = legacy
   *  inline sections (implicit per-page) · `none` = the slot is empty. */
  mode: 'ref' | 'override' | 'inline' | 'none'
  group?: string
  sections: ContractNode[]
}

export interface ResolvedPage {
  /** The flat list the runtime renders: header → template → footer. */
  sections: ContractNode[]
  /** nodeId → provenance. Every top-level node has an entry. */
  provenance: Record<string, NodeSource>
  slots: Record<GroupSlot, SlotResolution>
  /** Groups that were referenced but not supplied — rendered as empty, reported here. */
  missingGroups: string[]
}

export type GroupMap = Record<string, SectionGroupDoc>

const bindingOf = (b: GroupBinding | undefined): { ref?: string; override?: ContractNode[] } | null => {
  if (b === undefined || b === null) return null
  if (typeof b === 'string') return { ref: b }
  if (typeof b === 'object') {
    if ('override' in b && Array.isArray(b.override)) return { override: b.override }
    if ('ref' in b && typeof b.ref === 'string') return { ref: b.ref }
  }
  return null
}

/** The slot a legacy inline node belongs to, from `area` first, then its type. */
export function inlineSlotOf(node: ContractNode): GroupSlot | 'template' {
  const area = node?.area as TemplateArea | undefined
  if (area === 'header' || area === 'footer') return area
  if (area === 'template') return 'template'
  if (node?.type === 'header') return 'header'
  if (node?.type === 'footer') return 'footer'
  return 'template'
}

const withArea = (node: ContractNode, area: TemplateArea): ContractNode =>
  node.area === area ? node : { ...node, area }

/**
 * Resolve a template into the section list the runtime renders.
 *
 * Pure and deterministic: the same template + groups always produce the same
 * list, so the storefront, the SSG, the preview and the editor agree by
 * construction rather than by discipline.
 */
export function resolvePage(template: GroupedPageDoc, groups: GroupMap = {}): ResolvedPage {
  const provenance: Record<string, NodeSource> = {}
  const missingGroups: string[] = []
  const all = Array.isArray(template?.sections) ? template.sections : []

  // Legacy inline nodes are bucketed by slot once; a template that binds a slot
  // explicitly ignores any inline node for that slot (the binding wins).
  const inline: Record<GroupSlot | 'template', ContractNode[]> = { header: [], template: [], footer: [] }
  for (const node of all) inline[inlineSlotOf(node)].push(node)

  const slots = {} as Record<GroupSlot, SlotResolution>
  for (const slot of GROUP_SLOTS) {
    const b = bindingOf(template?.groups?.[slot])
    if (b?.ref !== undefined) {
      const g = groups[b.ref]
      if (!g) {
        missingGroups.push(b.ref)
        slots[slot] = { mode: 'ref', group: b.ref, sections: [] }
        continue
      }
      const sections = (Array.isArray(g.sections) ? g.sections : []).map((n) => withArea(n, slot))
      for (const n of sections) if (n.id) provenance[n.id] = { kind: 'group', slot, group: b.ref }
      slots[slot] = { mode: 'ref', group: b.ref, sections }
    } else if (b?.override !== undefined) {
      const sections = b.override.map((n) => withArea(n, slot))
      for (const n of sections) if (n.id) provenance[n.id] = { kind: 'override', slot }
      slots[slot] = { mode: 'override', sections }
    } else if (inline[slot].length) {
      const sections = inline[slot].map((n) => withArea(n, slot))
      for (const n of sections) if (n.id) provenance[n.id] = { kind: 'inline', slot }
      slots[slot] = { mode: 'inline', sections }
    } else {
      slots[slot] = { mode: 'none', sections: [] }
    }
  }

  const body = inline.template
  for (const n of body) if (n.id) provenance[n.id] = { kind: 'template' }

  return {
    sections: [...slots.header.sections, ...body, ...slots.footer.sections],
    provenance,
    slots,
    missingGroups,
  }
}

export interface SplitResult {
  template: GroupedPageDoc
  /** Only the groups whose sections were part of this page and may have changed. */
  groups: Partial<Record<GroupSlot, { name: string; doc: SectionGroupDoc }>>
}

export interface SplitOptions {
  /**
   * Per slot, how the saved template should bind. Omitted slots keep the mode
   * they were resolved with. `ref` needs a group name (the one to write to);
   * `override` freezes the current nodes into the template; `none` drops the
   * slot from this page.
   */
  slots?: Partial<Record<GroupSlot, { mode: 'ref'; group: string } | { mode: 'override' } | { mode: 'none' }>>
}

/**
 * The inverse of `resolvePage`: take an edited flat list plus the provenance
 * it was resolved with, and produce what to write to the template and to each
 * group file.
 *
 * Rules that make this safe for a shared group:
 *   - A node whose provenance says `group` goes back to that group — and ONLY
 *     if the slot is still bound to that group. Nothing about a template save
 *     can silently rewrite a group the page no longer references.
 *   - A node with no provenance (newly inserted) lands where its `area` says.
 *     Inserted into a `ref`-bound slot, it becomes part of the shared group —
 *     that is the merchant editing "the header", which is shared by design and
 *     is reported as such by `groupImpact`.
 *   - Body nodes carry no `area` on disk unless they already had one, so a
 *     template that never used `area` on body nodes stays byte-identical.
 */
export function splitPage(
  sections: ContractNode[],
  previous: ResolvedPage,
  opts: SplitOptions = {},
): SplitResult {
  const buckets: Record<GroupSlot | 'template', ContractNode[]> = { header: [], template: [], footer: [] }
  for (const node of sections) {
    const prov = node.id ? previous.provenance[node.id] : undefined
    const slot: GroupSlot | 'template' = prov
      ? prov.kind === 'template'
        ? 'template'
        : prov.slot
      : inlineSlotOf(node)
    buckets[slot].push(node)
  }

  const source = previousTemplateShape(previous)
  const groupsOut: SplitResult['groups'] = {}
  const groupsBinding: Partial<Record<GroupSlot, GroupBinding>> = {}
  // Legacy inline nodes stay inline, in slot order, so an unmigrated template
  // saves back exactly as it was read.
  const inline: Record<GroupSlot, ContractNode[]> = { header: [], footer: [] }

  for (const slot of GROUP_SLOTS) {
    const prev = previous.slots[slot]
    const want = opts.slots?.[slot]
    const mode = want?.mode ?? (prev.mode === 'none' ? (buckets[slot].length ? 'inline' : 'none') : prev.mode)
    const nodes = buckets[slot].map((n) => withArea(n, slot))

    if (mode === 'ref') {
      const name = want && want.mode === 'ref' ? want.group : prev.group
      if (!name) throw new Error(`splitPage: slot "${slot}" is bound to a group but no group name is known`)
      groupsBinding[slot] = name
      // Group nodes are stored without `area` — the slot is the group's `type`.
      groupsOut[slot] = {
        name,
        doc: { type: slot, sections: nodes.map(stripArea) },
      }
    } else if (mode === 'override') {
      groupsBinding[slot] = { override: nodes }
    } else if (mode === 'inline') {
      // Raw nodes, not `withArea` — a legacy template must save back byte-identical.
      inline[slot] = buckets[slot]
    }
    // 'none' → nothing written for this slot.
  }

  // Rebuild in the SOURCE template's key order, so a save that changes nothing
  // is byte-identical to what was read — that is what makes the revision check
  // and the "nothing to write" short-circuit honest.
  const next: Record<string, unknown> = {}
  const merged = [...inline.header, ...buckets.template, ...inline.footer]
  const hasGroups = Object.keys(groupsBinding).length > 0
  for (const [k, v] of Object.entries(source)) {
    if (k === 'sections') next.sections = merged
    else if (k === 'groups') { if (hasGroups) next.groups = groupsBinding }
    else next[k] = v
  }
  if (!('sections' in next)) next.sections = merged
  if (hasGroups && !('groups' in next)) next.groups = groupsBinding
  const template = next as unknown as GroupedPageDoc

  return { template, groups: groupsOut }
}

/** `resolvePage` does not keep the template; carry the keys a split must preserve. */
function previousTemplateShape(previous: ResolvedPage): GroupedPageDoc {
  const extra = (previous as ResolvedPage & { template?: GroupedPageDoc }).template
  return extra ? { ...extra } : { sections: [] }
}

function stripArea(node: ContractNode): ContractNode {
  if (node.area === undefined) return node
  const { area: _a, ...rest } = node
  return rest as ContractNode
}

/**
 * Attach the source template to a resolution so `splitPage` can preserve any
 * top-level keys it does not model (`contentVersion`, future additions).
 */
export function resolvePageFrom(template: GroupedPageDoc, groups: GroupMap = {}): ResolvedPage & { template: GroupedPageDoc } {
  return { ...resolvePage(template, groups), template }
}

/** Which templates render a given group — the blast radius of editing it. */
export function groupImpact(groupName: string, templates: Record<string, GroupedPageDoc>): string[] {
  const out: string[] = []
  for (const [slug, doc] of Object.entries(templates)) {
    for (const slot of GROUP_SLOTS) {
      const b = bindingOf(doc?.groups?.[slot])
      if (b?.ref === groupName) {
        out.push(slug)
        break
      }
    }
  }
  return out.sort()
}

// ── Migration: inline copies → one shared group ─────────────────────────────

export interface ExtractOptions {
  /**
   * Attribute defaults per section type, so two copies that differ only by an
   * explicitly-written default (`{}` vs `{ sticky: 'always' }` when `always`
   * IS the default) compare equal. Without this, the design-converted home
   * page would look "different" from seventeen pages that merely omit defaults.
   */
  defaults?: Record<string, Record<string, unknown>>
  /** Group file names to write. */
  names?: Partial<Record<GroupSlot, string>>
}

export interface ExtractReport {
  slot: GroupSlot
  group: string
  /** The signature that won and the templates that carried it. */
  canonical: { signature: string; templates: string[] }
  /** Templates whose copy differs — kept as explicit overrides, never merged. */
  overrides: Array<{ template: string; signature: string; differences: string[] }>
  /** Templates that carried no section in this slot. */
  empty: string[]
  /** Templates that already bind this slot (a re-run) — untouched. */
  alreadyBound: string[]
  /**
   * Ids that change for a template that binds the group: its own copy carried
   * the same content under different ids, and a shared group has one set of
   * ids. Reported so nothing about a merchant's ids changes silently; an
   * override keeps every id verbatim.
   */
  idRemaps: Array<{ template: string; from: string; to: string }>
}

export interface ExtractResult {
  groups: Partial<Record<GroupSlot, { name: string; doc: SectionGroupDoc }>>
  templates: Record<string, GroupedPageDoc>
  report: ExtractReport[]
  /** True when nothing needed to change — the second run of a migration. */
  noop: boolean
}

/**
 * Canonical comparison form for a slot's nodes: type + settings-with-defaults
 * + blocks, with ids REMOVED. Ids are identity, not content; two pages whose
 * headers differ only in id are the same header.
 */
export function slotSignature(nodes: ContractNode[], defaults: ExtractOptions['defaults'] = {}): string {
  const norm = (n: ContractNode): unknown => ({
    type: n.type,
    settings: sortKeys({ ...(defaults[n.type] ?? {}), ...(n.settings ?? {}) }),
    blocks: (n.blocks ?? []).map(norm),
  })
  return JSON.stringify(nodes.map(norm))
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))
}

/** Human-readable diff between two signatures, for the migration report. */
function describeDifference(a: ContractNode[], b: ContractNode[], defaults: ExtractOptions['defaults'] = {}): string[] {
  const out: string[] = []
  const ta = a.map((n) => n.type).join(' + ') || '(empty)'
  const tb = b.map((n) => n.type).join(' + ') || '(empty)'
  if (ta !== tb) out.push(`sections: ${tb} vs canonical ${ta}`)
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (a[i]!.type !== b[i]!.type) continue
    const sa = { ...(defaults[a[i]!.type] ?? {}), ...(a[i]!.settings ?? {}) }
    const sb = { ...(defaults[b[i]!.type] ?? {}), ...(b[i]!.settings ?? {}) }
    for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
      if (JSON.stringify(sa[k]) !== JSON.stringify(sb[k])) {
        out.push(`${a[i]!.type}.${k}: ${JSON.stringify(sb[k])} vs canonical ${JSON.stringify(sa[k])}`)
      }
    }
    const ba = (a[i]!.blocks ?? []).map((x) => x.type).join(',')
    const bb = (b[i]!.blocks ?? []).map((x) => x.type).join(',')
    if (ba !== bb) out.push(`${a[i]!.type}.blocks: [${bb}] vs canonical [${ba}]`)
    else {
      const blocksA = a[i]!.blocks ?? []
      const blocksB = b[i]!.blocks ?? []
      for (let j = 0; j < blocksA.length; j++) {
        const x = { ...(defaults[blocksA[j]!.type] ?? {}), ...(blocksA[j]!.settings ?? {}) }
        const y = { ...(defaults[blocksB[j]!.type] ?? {}), ...(blocksB[j]!.settings ?? {}) }
        for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
          if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) {
            out.push(`${a[i]!.type}.blocks[${j}] (${blocksA[j]!.type}).${k}: ${JSON.stringify(y[k])} vs canonical ${JSON.stringify(x[k])}`)
          }
        }
      }
    }
  }
  return out
}

/**
 * Turn per-template inline header/footer copies into shared groups.
 *
 * Deterministic and idempotent:
 *   - The canonical composition for a slot is the one the MOST templates carry
 *     (ties broken by the alphabetically-first template that carries it).
 *   - A template whose copy matches canonical (after defaults) binds the group.
 *   - A template whose copy differs keeps its own nodes as an explicit
 *     `override` — the difference is REPORTED, never merged away.
 *   - A template with nothing in the slot binds nothing for it.
 *   - A template that already binds the slot is left alone, so running the
 *     migration twice changes nothing (`noop: true`).
 *
 * Ids, settings, blocks and order are carried verbatim into the group and into
 * every override; nothing is re-minted.
 */
export function extractGroups(
  templates: Record<string, GroupedPageDoc>,
  opts: ExtractOptions = {},
): ExtractResult {
  const defaults = opts.defaults ?? {}
  const out: Record<string, GroupedPageDoc> = {}
  for (const [slug, doc] of Object.entries(templates)) out[slug] = doc
  const groups: ExtractResult['groups'] = {}
  const report: ExtractReport[] = []
  let changed = false

  for (const slot of GROUP_SLOTS) {
    const name = opts.names?.[slot] ?? slot
    const bySig = new Map<string, string[]>()
    const nodesBySlug = new Map<string, ContractNode[]>()
    const alreadyBound: string[] = []
    const empty: string[] = []

    for (const slug of Object.keys(templates).sort()) {
      const doc = templates[slug]!
      if (bindingOf(doc.groups?.[slot])) {
        alreadyBound.push(slug)
        continue
      }
      const nodes = (Array.isArray(doc.sections) ? doc.sections : []).filter((n) => inlineSlotOf(n) === slot)
      if (!nodes.length) {
        empty.push(slug)
        continue
      }
      nodesBySlug.set(slug, nodes)
      const sig = slotSignature(nodes, defaults)
      bySig.set(sig, [...(bySig.get(sig) ?? []), slug])
    }

    if (!nodesBySlug.size) {
      // Nothing inline anywhere: either already migrated (noop) or no such slot.
      if (alreadyBound.length) {
        report.push({
          slot, group: name,
          canonical: { signature: '', templates: [] },
          overrides: [], empty, alreadyBound, idRemaps: [],
        })
      }
      continue
    }

    // Majority wins; ties → the signature whose first template sorts first.
    const ranked = [...bySig.entries()].sort((a, b) => b[1].length - a[1].length || a[1][0]!.localeCompare(b[1][0]!))
    const [canonicalSig, canonicalSlugs] = ranked[0]!
    const canonicalNodes = nodesBySlug.get(canonicalSlugs[0]!)!

    groups[slot] = {
      name,
      doc: { type: slot, sections: canonicalNodes.map(stripArea) },
    }

    const overrides: ExtractReport['overrides'] = []
    const idRemaps: ExtractReport['idRemaps'] = []
    for (const [slug, nodes] of nodesBySlug) {
      const sig = slotSignature(nodes, defaults)
      const doc = out[slug]!
      const rest = (doc.sections ?? []).filter((n) => inlineSlotOf(n) !== slot)
      const binding: GroupBinding = sig === canonicalSig ? name : { override: nodes.map((n) => withArea(n, slot)) }
      if (sig !== canonicalSig) {
        overrides.push({ template: slug, signature: sig, differences: describeDifference(canonicalNodes, nodes, defaults) })
      } else {
        // Same content, possibly different ids: the group keeps the canonical
        // template's ids. Say which ids this template loses.
        const pairs = (a: ContractNode[], b: ContractNode[]): void => {
          a.forEach((x, i) => {
            const y = b[i]
            if (!y) return
            if (x.id && y.id && x.id !== y.id) idRemaps.push({ template: slug, from: y.id, to: x.id })
            pairs(x.blocks ?? [], y.blocks ?? [])
          })
        }
        pairs(canonicalNodes, nodes)
      }
      out[slug] = {
        ...doc,
        groups: { ...(doc.groups ?? {}), [slot]: binding },
        sections: rest,
      }
      changed = true
    }

    report.push({
      slot, group: name,
      canonical: { signature: canonicalSig, templates: canonicalSlugs },
      overrides, empty, alreadyBound, idRemaps,
    })
  }

  return { groups, templates: out, report, noop: !changed }
}

/** Validate a group document's own shape (the content validator checks its nodes). */
export function isSectionGroupDoc(v: unknown): v is SectionGroupDoc {
  if (!v || typeof v !== 'object') return false
  const g = v as SectionGroupDoc
  return (GROUP_SLOTS as readonly string[]).includes(g.type) && Array.isArray(g.sections)
}

/** Group file names must be safe path segments. */
export const GROUP_NAME_PATTERN = NODE_ID_PATTERN
