import React, { useEffect, useRef, useState, type FC, type ReactNode } from 'react'
import { SectionTree } from './SectionTree'
import { useData } from './data'
import type { ContentNode } from './types'

/**
 * Preview bridge — the EDIT-plane runtime that lives INSIDE the iframe.
 *
 * Unlike `?edit` (which mounts the whole editor inside the theme bundle), the
 * bridge ships no editor UI: it only (1) renders the content tree and (2) speaks
 * postMessage with the parent editor app. The editor chrome lives in a separate
 * app (apps/studio-editor) and drives this iframe.
 *
 * Protocol (namespaced `tq:`):
 *   iframe → parent : { type:'tq:ready', pages }       on mount
 *                     { type:'tq:select', path }       when a section is clicked
 *   parent → iframe : { type:'tq:set-content', page?, doc? }   render this tree
 *                     { type:'tq:select', path }               highlight a node
 */
const isMsg = (m: unknown): m is { type: string; [k: string]: unknown } =>
  !!m && typeof m === 'object' && typeof (m as { type?: unknown }).type === 'string'

export function PreviewBridge({
  pages,
  initialPage,
  Shell,
}: {
  pages: Record<string, ContentNode[]>
  initialPage: string
  Shell: FC<{ children: ReactNode }>
}): JSX.Element {
  const [tree, setTree] = useState<ContentNode[]>(pages[initialPage] ?? [])
  const [selected, setSelected] = useState<number[] | null>(null)
  const data = useData()
  const send = (msg: object) => window.parent?.postMessage(msg, '*')

  // Keep the latest tree in a ref so the message handler can return it on
  // demand (the editor's Publish reads the LIVE-edited content straight from
  // the preview — the source of truth for "what's on screen").
  const treeRef = useRef<ContentNode[]>(tree)
  useEffect(() => { treeRef.current = tree }, [tree])

  // Write-through (lovable-style): on every content change, push the current
  // content to the editor host so it persists the draft immediately — no
  // explicit "save". `firstRender` skips the initial mount so we don't re-save
  // the just-loaded draft. The host debounces.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    send({ type: 'tanqory-content-changed', content: { sections: tree } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree])

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!isMsg(e.data)) return
      if (e.data.type === 'tanqory-get-content') {
        // reply with the current (live-edited) page content in theme-kit format
        send({ type: 'tanqory-content', requestId: e.data.requestId ?? null, content: { sections: treeRef.current } })
      } else if (e.data.type === 'tq:set-content') {
        if (Array.isArray(e.data.doc)) setTree(e.data.doc as ContentNode[])
        else if (typeof e.data.page === 'string' && pages[e.data.page]) setTree(pages[e.data.page])
      } else if (e.data.type === 'tq:select') {
        setSelected(Array.isArray(e.data.path) ? (e.data.path as number[]) : null)
      } else if (e.data.type === 'tanqory-preview-update-section') {
        // studio-editor edited a section's settings (and possibly its child
        // blocks) → merge + re-render live. The editor sends blocks in its
        // OWN shape (object map keyed by id + order[]) — convert to
        // theme-kit's array here so render code only ever sees arrays.
        const id = e.data.sectionId as string
        const s = (e.data.settings ?? {}) as Record<string, unknown>
        const rawBlocks = e.data.blocks as Record<string, ContentNode> | ContentNode[] | null
        const order = e.data.order as string[] | null
        let blocks: ContentNode[] | undefined
        if (Array.isArray(rawBlocks)) {
          blocks = rawBlocks
        } else if (rawBlocks && typeof rawBlocks === 'object') {
          const ids = Array.isArray(order) && order.length ? order : Object.keys(rawBlocks)
          blocks = ids
            .filter((bid) => rawBlocks[bid])
            .map((bid) => ({ ...rawBlocks[bid], id: rawBlocks[bid].id ?? bid }))
        }
        setTree((t) =>
          t.map((n) =>
            n.id === id
              ? { ...n, settings: { ...n.settings, ...s }, ...(blocks ? { blocks } : {}) }
              : n,
          ),
        )
      } else if (e.data.type === 'tanqory-preview-select') {
        const id = e.data.sectionId as string
        setTree((t) => { const i = t.findIndex((n) => n.id === id); setSelected(i >= 0 ? [i] : null); return t })
        // Scroll the canvas to the clicked section (editor tree → preview, like
        // Shopify). The section wrapper is `display:contents` (no layout box), so
        // scroll its first real child element into view instead.
        if (typeof document !== 'undefined' && id) {
          const sel = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id
          requestAnimationFrame(() => {
            const wrap = document.querySelector(`[data-tq-section-id="${sel}"]`)
            const target = (wrap?.firstElementChild as HTMLElement | null) ?? (wrap as HTMLElement | null)
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          })
        }
      } else if (e.data.type === 'tanqory-preview-reorder-sections') {
        // Reorder the EXISTING nodes in place (same object refs, keyed by id)
        // so React moves the DOM instead of rebuilding the whole tree — this is
        // what kills the flicker on drag/swap. A full `tq:set-content` would
        // re-mount every section. Any node the editor didn't list is preserved.
        const order = e.data.order as string[]
        if (Array.isArray(order)) {
          setTree((t) => {
            const byId = new Map(t.map((n) => [n.id, n]))
            const next = order.map((id) => byId.get(id)).filter(Boolean) as ContentNode[]
            for (const n of t) if (!order.includes(n.id as string)) next.push(n)
            return next.length ? next : t
          })
        }
      } else if (e.data.type === 'tanqory-preview-remove-section') {
        const id = e.data.sectionId as string
        setTree((t) => t.filter((n) => n.id !== id))
      } else if (e.data.type === 'tanqory-preview-insert-section') {
        // Splice ONE new node in after `afterSectionId` (or at the top) — no
        // full-tree replace. Blocks arrive as the editor's id-map + order array;
        // convert to theme-kit's array shape (same as update-section).
        const id = e.data.sectionId as string
        const rawBlocks = e.data.blocks as Record<string, ContentNode> | ContentNode[] | null
        const order = e.data.order as string[] | null
        let blocks: ContentNode[] | undefined
        if (Array.isArray(rawBlocks)) {
          blocks = rawBlocks
        } else if (rawBlocks && typeof rawBlocks === 'object') {
          const ids = Array.isArray(order) && order.length ? order : Object.keys(rawBlocks)
          blocks = ids
            .filter((bid) => rawBlocks[bid])
            .map((bid) => ({ ...rawBlocks[bid], id: rawBlocks[bid].id ?? bid }))
        }
        const node: ContentNode = {
          id,
          type: e.data.sectionType as string,
          settings: (e.data.settings ?? {}) as Record<string, unknown>,
          ...(blocks ? { blocks } : {}),
        }
        const after = e.data.afterSectionId as string | null
        setTree((t) => {
          if (t.some((n) => n.id === id)) return t
          const idx = after ? t.findIndex((n) => n.id === after) : -1
          const next = [...t]
          next.splice(idx + 1, 0, node)
          return next
        })
      } else if (e.data.type === 'tanqory-request-collections') {
        // Editor needs to populate a `type: 'collection'` picker — reply with
        // every collection the bootstrap query loaded so the merchant sees
        // their actual storefront catalogue, not a typed-in handle.
        const collections = data.allCollections().map((c) => ({
          handle: c.handle,
          title: c.title,
          productCount: c.products.length,
        }))
        send({ type: 'tanqory-collections', requestId: e.data.requestId ?? null, collections })
      } else if (e.data.type === 'tanqory-request-products') {
        // Same idea as collections — flatten every product across collections,
        // dedupe by handle (first occurrence wins, matching SectionTree's
        // canonical-handle rule), and hand the editor enough metadata to
        // render a search/filter picker without a second round-trip.
        const seen = new Set<string>()
        const products: Array<{ handle: string; title: string; price: string; image: string | null }> = []
        for (const c of data.allCollections()) {
          for (const p of c.products) {
            if (seen.has(p.handle)) continue
            seen.add(p.handle)
            products.push({
              handle: p.handle,
              title: p.title,
              price: p.price?.amount ?? '',
              image: p.featuredImage?.url ?? null,
            })
          }
        }
        send({ type: 'tanqory-products', requestId: e.data.requestId ?? null, products })
      }
    }
    window.addEventListener('message', onMsg)
    send({ type: 'tq:ready', pages: Object.keys(pages) })
    return () => window.removeEventListener('message', onMsg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Click any element inside a rendered section → report its identity so the
  // editor can highlight the matching row in the tree and surface its
  // settings panel. We send BOTH the legacy `tq:select` (with path) and the
  // editor's `tanqory-section-selected` (with sectionId) — the editor side
  // only listens to the latter, but external tooling may still be on tq:.
  //
  // Preview-mode click handling also short-circuits internal navigation:
  // anchors inside a section would otherwise pull the iframe off the page
  // the editor is editing. Section CTAs become "select this" while the
  // editor is open.
  const onClickCapture = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const sectionEl = target.closest<HTMLElement>('[data-tq-section-id]')
    if (!sectionEl) return
    const sectionId = sectionEl.dataset.tqSectionId
    const pathAttr = sectionEl.dataset.tqPath
    if (target.closest('a, button[type="submit"]')) {
      e.preventDefault()
    }
    if (pathAttr) {
      const path = pathAttr.split('.').map(Number)
      setSelected(path)
      send({ type: 'tq:select', path })
    }
    if (sectionId) {
      send({ type: 'tanqory-section-selected', sectionId })
    }
  }

  return (
    <div onClickCapture={onClickCapture} data-tq-selected={selected?.join('.') ?? ''}>
      <Shell>
        <SectionTree tree={tree} />
      </Shell>
    </div>
  )
}
