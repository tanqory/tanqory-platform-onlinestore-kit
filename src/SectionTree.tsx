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
        {node.blocks?.map((child, i) => (
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
