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
function normalizeBlocks(blocks: ContentNode['blocks'] | Record<string, ContentNode>): ContentNode[] {
  if (Array.isArray(blocks)) return blocks
  if (blocks && typeof blocks === 'object') {
    return Object.entries(blocks)
      .filter(([, b]) => b && typeof b === 'object' && typeof (b as ContentNode).type === 'string')
      .map(([id, b]) => ({ ...(b as ContentNode), id: (b as ContentNode).id ?? id }))
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
        {normalizeBlocks(node.blocks).map((child, i) => (
          <RenderNode key={child.id ?? i} node={child} path={`${path}.${i}`} />
        ))}
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
