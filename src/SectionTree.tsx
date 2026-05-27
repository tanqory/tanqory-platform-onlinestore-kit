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

function RenderNode({ node }: { node: ContentNode }): JSX.Element | null {
  const def = getSection(node.type)
  if (!def) {
    console.warn(`[tanqory] unknown section "${node.type}"`)
    return null
  }
  const Comp = def.component
  const attributes = resolveAttributes(def, node.settings)
  return (
    <Comp attributes={attributes}>
      {node.blocks?.map((child, i) => <RenderNode key={child.id ?? i} node={child} />)}
    </Comp>
  )
}

/**
 * The heart: render a JSON content tree → React. The editor and the storefront
 * both render through this — content stays JSON, never HTML.
 */
export function SectionTree({ tree }: { tree: ContentNode[] }): JSX.Element {
  return <>{tree.map((node, i) => <RenderNode key={node.id ?? i} node={node} />)}</>
}
