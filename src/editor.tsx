import { useState } from 'react'
import type { AttrSpec, ContentNode } from './types'
import { getSection, allSections } from './registry'
import { SectionTree } from './SectionTree'

// ─── tree helpers (path = number[] into nested .blocks) ─────────────────────
type Path = number[]
const samePath = (a: Path, b: Path) => a.length === b.length && a.every((v, i) => v === b[i])

function nodeAt(tree: ContentNode[], path: Path): ContentNode | undefined {
  let nodes = tree
  let node: ContentNode | undefined
  for (const i of path) { node = nodes[i]; nodes = node?.blocks ?? [] }
  return node
}
function updateAt(tree: ContentNode[], path: Path, fn: (n: ContentNode) => ContentNode): ContentNode[] {
  const [i, ...rest] = path
  return tree.map((n, k) =>
    k !== i ? n : rest.length === 0 ? fn(n) : { ...n, blocks: updateAt(n.blocks ?? [], rest, fn) },
  )
}
function removeAt(tree: ContentNode[], path: Path): ContentNode[] {
  const [i, ...rest] = path
  if (rest.length === 0) return tree.filter((_, k) => k !== i)
  return tree.map((n, k) => (k !== i ? n : { ...n, blocks: removeAt(n.blocks ?? [], rest) }))
}
function insertChild(tree: ContentNode[], parent: Path, node: ContentNode): ContentNode[] {
  if (parent.length === 0) return [...tree, node]
  const [i, ...rest] = parent
  return tree.map((n, k) => (k !== i ? n : { ...n, blocks: insertChild(n.blocks ?? [], rest, node) }))
}
function reorder(tree: ContentNode[], parent: Path, from: number, to: number): ContentNode[] {
  const moveArr = (arr: ContentNode[]) => { const c = [...arr]; const [m] = c.splice(from, 1); c.splice(to, 0, m); return c }
  if (parent.length === 0) return moveArr(tree)
  const [i, ...rest] = parent
  return tree.map((n, k) => (k !== i ? n : { ...n, blocks: reorder(n.blocks ?? [], rest, from, to) }))
}
function defaultsFor(type: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, s] of Object.entries(getSection(type)?.attributes ?? {})) if (s.default !== undefined) out[k] = s.default
  return out
}
const newNode = (type: string): ContentNode => ({ type, id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, settings: defaultsFor(type) })

// ─── inputs ──────────────────────────────────────────────────────────────
function Field({ name, spec, value, onChange }: { name: string; spec: AttrSpec; value: unknown; onChange: (v: unknown) => void }): JSX.Element {
  const label = spec.label ?? name
  const c = { style: { width: '100%', padding: '6px 8px', boxSizing: 'border-box' as const } }
  let input: JSX.Element
  if (spec.type === 'textarea') input = <textarea {...c} rows={3} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
  else if (spec.type === 'color') input = <input type="color" value={String(value ?? '#000000')} onChange={(e) => onChange(e.target.value)} />
  else if (spec.type === 'number') input = <input {...c} type="number" value={Number(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />
  else if (spec.type === 'boolean') input = <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
  else input = <input {...c} type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
  return <label style={{ display: 'block', margin: '0 0 12px' }}><span style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</span>{input}</label>
}
const btn = (active = false): React.CSSProperties => ({ border: '1px solid', borderColor: active ? '#111' : '#e5e5e5', borderRadius: 6, background: active ? '#111' : '#fff', color: active ? '#fff' : '#111', cursor: 'pointer', font: 'inherit' })

// ─── editor (multi-page + nested + drag-drop) ───────────────────────────────
export function Editor({ pages, initialPage = 'index' }: { pages: Record<string, ContentNode[]>; initialPage?: string }): JSX.Element {
  const pageNames = Object.keys(pages)
  const [trees, setTrees] = useState<Record<string, ContentNode[]>>(pages)
  const [page, setPage] = useState(pageNames.includes(initialPage) ? initialPage : pageNames[0] ?? 'index')
  const [sel, setSel] = useState<Path>([0])
  const [addParent, setAddParent] = useState<Path | null>(null)
  const [status, setStatus] = useState('')
  const [drag, setDrag] = useState<{ parent: string; index: number } | null>(null)

  const tree = trees[page] ?? []
  const setTree = (fn: (t: ContentNode[]) => ContentNode[]) => setTrees((all) => ({ ...all, [page]: fn(all[page] ?? []) }))
  const node = nodeAt(tree, sel)
  const def = node ? getSection(node.type) : undefined

  const save = async () => {
    setStatus('saving…')
    const res = await fetch('/__studio/save', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page, doc: { sections: trees[page] ?? [] } }),
    })
    setStatus(res.ok ? `saved ${page} ✓` : 'save failed')
  }

  const onDrop = (parent: Path, to: number) => {
    if (drag && drag.parent === parent.join('.')) setTree((t) => reorder(t, parent, drag.index, to))
    setDrag(null)
  }

  const inserter = (parent: Path, allow?: string[]) => {
    const opts = allSections().filter((s) => !allow || allow.includes(s.name))
    return (
      <div style={{ margin: '2px 0 8px', marginLeft: (parent.length + 1) * 14, border: '1px solid #eee', borderRadius: 6, padding: 6 }}>
        {opts.map((s) => (
          <button key={s.name} onClick={() => { setTree((t) => insertChild(t, parent, newNode(s.name))); setAddParent(null) }}
            style={{ ...btn(), display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', marginBottom: 2 }}>
            {s.icon ?? '▪'} {s.title}
          </button>
        ))}
      </div>
    )
  }

  const renderList = (nodes: ContentNode[], parent: Path): JSX.Element[] =>
    nodes.map((n, i) => {
      const path = [...parent, i]
      const sec = getSection(n.type)
      return (
        <div key={n.id ?? i}>
          <div draggable onDragStart={() => setDrag({ parent: parent.join('.'), index: i })}
            onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(parent, i)}
            style={{ display: 'flex', gap: 4, marginBottom: 4, marginLeft: parent.length * 14 }}>
            <span style={{ cursor: 'grab', color: '#bbb', padding: '0 2px' }}>⠿</span>
            <button onClick={() => setSel(path)} style={{ ...btn(samePath(path, sel)), flex: 1, textAlign: 'left', padding: '6px 8px' }}>
              {sec?.icon ?? '▪'} {sec?.title ?? n.type}
            </button>
            {sec?.allowedBlocks?.length ? <button title="add child" onClick={() => setAddParent(path)} style={{ ...btn(), width: 26 }}>＋</button> : null}
            <button title="remove" onClick={() => { setTree((t) => removeAt(t, path)); setSel([0]) }} style={{ ...btn(), width: 26, color: '#c0392b' }}>✕</button>
          </div>
          {n.blocks?.length ? renderList(n.blocks, path) : null}
          {addParent && samePath(addParent, path) ? inserter(path, sec?.allowedBlocks) : null}
        </div>
      )
    })

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 320px', height: '100vh', fontFamily: 'system-ui' }}>
      {/* LEFT — section tree (drag to reorder, add / remove / nest) */}
      <aside style={{ borderRight: '1px solid #e5e5e5', overflow: 'auto', padding: 16 }}>
        <select value={page} onChange={(e) => { setPage(e.target.value); setSel([0]) }} style={{ width: '100%', padding: '6px 8px', marginBottom: 12 }}>
          {pageNames.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <strong style={{ fontSize: 13 }}>SECTIONS — drag ⠿ to reorder</strong>
        <div style={{ margin: '8px 0' }}>{renderList(tree, [])}</div>

        <button onClick={() => setAddParent([])} style={{ ...btn(), padding: '8px 10px', width: '100%' }}>+ Add section</button>
        {addParent && addParent.length === 0 ? inserter([]) : null}

        <button onClick={save} style={{ marginTop: 16, padding: '10px 16px', border: 'none', borderRadius: 6, background: '#111', color: '#fff', cursor: 'pointer', width: '100%' }}>Save</button>
        <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>{status}</div>
      </aside>

      {/* MIDDLE — live canvas */}
      <main style={{ overflow: 'auto' }}><SectionTree tree={tree} /></main>

      {/* RIGHT — props of the selected section (from its schema) */}
      <aside style={{ borderLeft: '1px solid #e5e5e5', overflow: 'auto', padding: 16 }}>
        {def ? (
          <>
            <strong style={{ fontSize: 13 }}>{def.title.toUpperCase()} SETTINGS</strong>
            <div style={{ marginTop: 8 }}>
              {Object.entries(def.attributes ?? {}).map(([k, spec]) => (
                <Field key={k} name={k} spec={spec} value={node!.settings?.[k] ?? spec.default}
                  onChange={(v) => setTree((t) => updateAt(t, sel, (nn) => ({ ...nn, settings: { ...nn.settings, [k]: v } })))} />
              ))}
            </div>
          </>
        ) : (
          <div style={{ color: '#888', fontSize: 13 }}>Select a section in the tree to edit its settings.</div>
        )}
      </aside>
    </div>
  )
}
