import { Children, isValidElement, type ReactNode } from 'react'
import type { ContentNode } from './types'

/**
 * Compile a *static* JSX composition into the canonical JSON block tree.
 *
 *   <Hero settings={{…}}><Button settings={{…}} /></Hero>
 *     →  [{ type:'hero', settings:{…}, blocks:[{ type:'button', settings:{…} }] }]
 *
 * Only nesting + literal `settings` are read — there is no place for logic, which
 * is exactly what keeps a page round-trippable by the editor. (Logic lives in
 * the block components, never in a page composition.)
 */
export function jsxToJSON(node: ReactNode): ContentNode[] {
  return Children.toArray(node).flatMap((el): ContentNode[] => {
    if (!isValidElement(el)) return []
    const name = (el.type as { blockName?: string })?.blockName
    if (!name) return []
    const props = el.props as { settings?: Record<string, unknown>; children?: ReactNode }
    const out: ContentNode = { type: name }
    if (props.settings) out.settings = props.settings
    const blocks = jsxToJSON(props.children)
    if (blocks.length) out.blocks = blocks
    return [out]
  })
}
