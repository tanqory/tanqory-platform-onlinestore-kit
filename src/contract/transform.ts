/**
 * The canonical Editor ↔ runtime transform.
 *
 * Two shapes exist and both are load-bearing:
 *   runtime / disk : `{ sections: [ { type, id, settings, blocks? } ] }` — an
 *                    ARRAY, because `SectionTree` does `node.blocks?.map`.
 *   editor UI      : `{ order: [id], sections: { id: {...} } }` — an object map
 *                    keyed by id, because the panel addresses nodes by id.
 *
 * studio-api converts between them today (`editor-routes.mjs:77-108`). That
 * implementation is lossy in three ways this one is not:
 *
 *   1. **It rebuilds a fixed shape**, so any key it does not enumerate is
 *      destroyed on the first autosave. `area` — used 43× in Nova's templates,
 *      and written by the AI theme assembler — is dropped on read and never
 *      restored on write. Anything this contract adds later would go the same
 *      way. Here, unknown keys are carried through.
 *   2. **A block with no id gets `` `${type}-${index}` ``** — a POSITIONAL
 *      identity. Reorder and `faq-item-0` silently means a different question,
 *      which breaks "edit one answer without touching the others".
 *   3. **A section with no id falls back to its `type`**, so two sections of the
 *      same type collide in the map and the second overwrites the first.
 *
 * Ids are minted once, here, when genuinely absent — and reported, so the
 * caller can persist them instead of re-minting on every read.
 */
import { mintNodeId, type ContractNode, type ContractPageDoc } from './content'

/** The editor's object-map shape for one node. */
export interface EditorNode {
  type: string
  settings: Record<string, unknown>
  blocks?: Record<string, EditorNode>
  order?: string[]
  /** Keys the contract does not model, preserved verbatim across the round trip. */
  [extra: string]: unknown
}

export interface EditorDoc {
  order: string[]
  sections: Record<string, EditorNode>
  contentVersion?: number
  /**
   * Top-level keys the transform does not model — `groups` (the shared
   * header/footer bindings) above all — preserved verbatim, so a document that
   * binds a group still binds it after an Editor round trip.
   */
  [extra: string]: unknown
}

/** Top-level keys the transform manages; everything else rides through. */
const MANAGED_DOC_KEYS = new Set(['sections', 'order', 'contentVersion'])

export interface TransformReport {
  /** Ids minted because a node had none. Persist these or they change next read. */
  mintedIds: Array<{ path: string; type: string; id: string }>
  /** Ids that collided and had to be disambiguated. */
  renamedIds: Array<{ path: string; from: string; to: string }>
}

/** Keys the transform manages explicitly; everything else rides in `extra`. */
const MANAGED = new Set(['type', 'id', 'settings', 'blocks'])

/**
 * runtime/disk → editor. Non-destructive: unmodelled keys survive in the node
 * and are restored by `toRuntimeShape`.
 */
export function toEditorShape(
  doc: ContractPageDoc,
  mint: (type: string) => string = mintNodeId,
): { doc: EditorDoc; report: TransformReport } {
  const report: TransformReport = { mintedIds: [], renamedIds: [] }
  const sections = Array.isArray(doc?.sections) ? doc.sections : []
  const { map, order } = levelToEditor(sections, 'sections', report, mint)
  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(doc ?? {})) if (!MANAGED_DOC_KEYS.has(k)) extra[k] = v
  return {
    doc: {
      order,
      sections: map,
      contentVersion: doc?.contentVersion ?? undefined,
      ...extra,
    },
    report,
  }
}

function levelToEditor(
  nodes: ContractNode[],
  basePath: string,
  report: TransformReport,
  mint: (type: string) => string,
): { map: Record<string, EditorNode>; order: string[] } {
  const map: Record<string, EditorNode> = {}
  const order: string[] = []

  nodes.forEach((node, i) => {
    const path = `${basePath}[${i}]`
    let id = typeof node?.id === 'string' && node.id !== '' ? node.id : ''

    if (!id) {
      id = mint(node?.type ?? 'node')
      report.mintedIds.push({ path, type: node?.type ?? 'node', id })
    }
    if (map[id]) {
      const to = mint(node?.type ?? 'node')
      report.renamedIds.push({ path, from: id, to })
      id = to
    }

    const extra: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node ?? {})) {
      if (!MANAGED.has(k)) extra[k] = v
    }

    const child = Array.isArray(node?.blocks)
      ? levelToEditor(node.blocks, `${path}.blocks`, report, mint)
      : null

    map[id] = {
      type: node?.type,
      settings: node?.settings ?? {},
      ...extra,
      ...(child ? { blocks: child.map, order: child.order } : {}),
    }
    order.push(id)
  })

  return { map, order }
}

/** editor → runtime/disk. The exact inverse, including unmodelled keys. */
export function toRuntimeShape(doc: EditorDoc): ContractPageDoc {
  const order = Array.isArray(doc?.order) ? doc.order : Object.keys(doc?.sections ?? {})
  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(doc ?? {})) if (!MANAGED_DOC_KEYS.has(k)) extra[k] = v
  return {
    ...(doc?.contentVersion !== undefined ? { contentVersion: doc.contentVersion } : {}),
    sections: levelToRuntime(doc?.sections ?? {}, order),
    ...extra,
  }
}

function levelToRuntime(map: Record<string, EditorNode>, order: string[]): ContractNode[] {
  return order
    .filter((id) => map[id])
    .map((id) => {
      const node = map[id]!
      const extra: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node)) {
        if (k === 'type' || k === 'settings' || k === 'blocks' || k === 'order') continue
        extra[k] = v
      }
      const blocks =
        node.blocks && typeof node.blocks === 'object'
          ? levelToRuntime(node.blocks, Array.isArray(node.order) ? node.order : Object.keys(node.blocks))
          : null

      return {
        type: node.type,
        id,
        settings: node.settings ?? {},
        ...extra,
        ...(blocks && blocks.length ? { blocks } : {}),
      } as ContractNode
    })
}

/**
 * Give every node an explicit id, in place of the positional fallback.
 *
 * Run once over a template authored before this contract (or by a producer that
 * omitted ids) and persist the result: after that, ids are stable and a
 * targeted edit addresses the node the author meant.
 */
export function ensureNodeIds(
  doc: ContractPageDoc,
  mint: (type: string) => string = mintNodeId,
): { doc: ContractPageDoc; report: TransformReport } {
  const { doc: editor, report } = toEditorShape(doc, mint)
  return { doc: toRuntimeShape(editor), report }
}
