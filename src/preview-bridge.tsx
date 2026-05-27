import React, { useEffect, useRef, useState, type FC, type ReactNode } from 'react'
import { SectionTree } from './SectionTree'
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
        // studio-editor edited a section's settings → merge + re-render live
        const id = e.data.sectionId as string
        const s = (e.data.settings ?? {}) as Record<string, unknown>
        setTree((t) => t.map((n) => (n.id === id ? { ...n, settings: { ...n.settings, ...s } } : n)))
      } else if (e.data.type === 'tanqory-preview-select') {
        const id = e.data.sectionId as string
        setTree((t) => { const i = t.findIndex((n) => n.id === id); setSelected(i >= 0 ? [i] : null); return t })
      }
    }
    window.addEventListener('message', onMsg)
    send({ type: 'tq:ready', pages: Object.keys(pages) })
    return () => window.removeEventListener('message', onMsg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Click a top-level section → report its path so the editor can select it.
  const onClickCapture = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tq-path]')
    if (el?.dataset.tqPath) {
      const path = el.dataset.tqPath.split('.').map(Number)
      setSelected(path)
      send({ type: 'tq:select', path })
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
