import type { SectionDef, ContentNode } from './types'
import { getSection } from './registry'

/** Apply attribute defaults from the section definition onto a node's settings. */
function resolveAttributes(def: SectionDef, settings?: Record<string, unknown>): Record<string, any> {
  const out: Record<string, any> = { ...(settings ?? {}) }
  for (const [key, spec] of Object.entries(def.attributes ?? {})) {
    if (out[key] === undefined && spec.default !== undefined) out[key] = spec.default
  }
  return out
}

/** Tolerate both child-block shapes. Templates written by older editor
 *  builds carry blocks as an OBJECT MAP keyed by id (the studio editor's
 *  internal shape) instead of theme-kit's array — `blocks.map` on that
 *  object crashed the ENTIRE storefront render ("o.map is not a function").
 *  A malformed template must degrade to "blocks don't render", never to a
 *  dead page. */
function normalizeBlocks(
  blocks: ContentNode['blocks'] | Record<string, ContentNode>,
  order?: string[],
): ContentNode[] {
  if (Array.isArray(blocks)) return blocks
  if (blocks && typeof blocks === 'object') {
    // Build the node list + a lookup keyed by BOTH the map key and the block's
    // own id — the editor's `order` array references the map key ("0".."n"),
    // but be tolerant of templates that order by block id.
    const nodes: ContentNode[] = []
    const byRef = new Map<string, ContentNode>()
    for (const [key, raw] of Object.entries(blocks)) {
      if (!raw || typeof raw !== 'object' || typeof (raw as ContentNode).type !== 'string') continue
      const node = { ...(raw as ContentNode), id: (raw as ContentNode).id ?? key }
      nodes.push(node)
      byRef.set(key, node)
      if (node.id) byRef.set(node.id as string, node)
    }
    // The map's key order is NOT the merchant's arrangement — the editor stores
    // the real order in `order`. Honour it (then append any stragglers).
    if (Array.isArray(order) && order.length) {
      const ordered: ContentNode[] = []
      const used = new Set<ContentNode>()
      for (const ref of order) {
        const n = byRef.get(ref)
        if (n && !used.has(n)) {
          ordered.push(n)
          used.add(n)
        }
      }
      for (const n of nodes) if (!used.has(n)) ordered.push(n)
      return ordered
    }
    return nodes
  }
  return []
}

function RenderNode({
  node,
  path,
}: {
  node: ContentNode
  /** Dotted index path from the tree root — `"0"`, `"0.1"`, etc. Read by the
   *  editor preview bridge to identify which section the visitor clicked. */
  path: string
}): JSX.Element | null {
  const def = getSection(node.type)
  if (!def) {
    console.warn(`[tanqory] unknown section "${node.type}"`)
    return null
  }
  const Comp = def.component
  const attributes = resolveAttributes(def, node.settings)
  // Wrap each rendered section in a CSS-transparent tag so the editor preview
  // bridge can resolve clicks back to the JSON node (via data-tq-section-id /
  // data-tq-path) without sections having to opt in. `display: contents`
  // means the wrapper participates in layout as if it weren't there.
  return (
    <div
      data-tq-section-id={node.id}
      data-tq-section-type={node.type}
      data-tq-path={path}
      style={{ display: 'contents' }}
    >
      <Comp attributes={attributes}>
        {normalizeBlocks(node.blocks, (node as ContentNode & { order?: string[] }).order).map(
          (child, i) => (
            <RenderNode key={child.id ?? i} node={child} path={`${path}.${i}`} />
          ),
        )}
      </Comp>
    </div>
  )
}

/**
 * The heart: render a JSON content tree → React. The editor and the storefront
 * both render through this — content stays JSON, never HTML.
 */
export function SectionTree({ tree }: { tree: ContentNode[] }): JSX.Element {
  return (
    <>
      {tree.map((node, i) => (
        <RenderNode key={node.id ?? i} node={node} path={String(i)} />
      ))}
    </>
  )
}
