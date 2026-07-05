import React, { type FC, type ReactNode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'

import { registerSections } from './registry'
import { SectionTree } from './SectionTree'
import { DataProvider, type DataApi } from './data'
import { CartProvider } from './cart'
import { ThemeProvider } from './theme-context'
import { Editor } from './editor'
import { PreviewBridge } from './preview-bridge'
import type { SectionDef, PageDoc, ContentNode } from './types'

// Vite's import.meta.glob(..., { eager: true }) types each value as `unknown`,
// so the theme entry passes plain glob maps with no generics. We narrow here.
type GlobMap = Record<string, unknown>

export interface MountOptions {
  /** import.meta.glob('./sections/*.tsx', { eager: true }) — run in the THEME. */
  sections: GlobMap
  /** import.meta.glob('./templates/*.json', { eager: true }). */
  pages: GlobMap
  /** import.meta.glob('./layouts/*.tsx', { eager: true }) — optional. */
  shell?: GlobMap
  /** Data source the theme provides (createMockData(...) or a live client). */
  data: DataApi
  /** Global settings values (config/settings.json). */
  settings?: Record<string, unknown>
  /** Locale strings (locales/<lang>.json). */
  locale?: Record<string, string>
  /** Which page to render (default 'index'). */
  page?: string
  /** Mount target id (default 'root'). */
  rootId?: string
  /**
   * SWR refresh: the initial render uses `data` (the SSG snapshot — so
   * hydration matches the server markup by construction), then this runs once
   * after mount and the fresh result is swapped in. Return null/reject to keep
   * the snapshot data (e.g. the network is down).
   */
  revalidate?: () => Promise<DataApi | null>
  /**
   * Force client rendering even when SSG markup exists in the root (wipe +
   * createRoot instead of hydrateRoot). Pass when the prerendered markup is
   * known NOT to match what the client will render — a different page than the
   * one that was prerendered, or no data snapshot to hydrate with — because
   * hydrating against mismatched markup throws React #418/#425.
   */
  forceClientRender?: boolean
}

function defaultsOf<T>(map: GlobMap): T[] {
  return Object.values(map).map((m) => (m as { default: T }).default)
}

function pickByName<T>(map: GlobMap, name: string): T | undefined {
  const hit = Object.entries(map).find(
    ([key]) => key.endsWith(`/${name}.json`) || key.endsWith(`/${name}.tsx`),
  )
  return hit ? (hit[1] as { default: T }).default : undefined
}

/**
 * Boot a theme. The theme's entry passes its globbed sections/templates/layouts
 * (so Vite resolves them relative to the theme) plus a data source. Everything
 * else — registry, tree rendering, providers — is the framework.
 */
export function mount(opts: MountOptions): void {
  registerSections(defaultsOf<SectionDef>(opts.sections))

  const shells = opts.shell ? defaultsOf<FC<{ children: ReactNode }>>(opts.shell) : []
  const Shell: FC<{ children: ReactNode }> = shells[0] ?? (({ children }) => <>{children}</>)

  const pageDoc = pickByName<PageDoc>(opts.pages, opts.page ?? 'index') ?? { sections: [] }
  const rootEl = document.getElementById(opts.rootId ?? 'root')
  if (!rootEl) throw new Error('[tanqory] mount target not found')

  // `?edit=true` → visual editor (EDIT plane); otherwise the storefront (SERVE).
  // Bare `?edit` counts as on; an explicit falsey value (`?edit=false` / `?edit=0`)
  // stays on the storefront, so the flag can be toggled off from the URL without
  // dropping the param. Editing only persists on the EDIT-plane sandbox (vite dev,
  // `preview-<slug>`); the published `<slug>` is static and has no save endpoint.
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()
  const on = (k: string) => { const v = params.get(k); return v !== null && v !== 'false' && v !== '0' }
  // PREVIEW plane = the dedicated `preview-<themeId>.<domain>` host (the editor
  // canvas) — render the postMessage bridge. `?preview`/`?edit` still work for
  // local/dev. Otherwise the storefront (SERVE plane / production <slug>).
  const previewHost = typeof location !== 'undefined' && /^preview-/.test(location.hostname)
  const previewMode = previewHost || on('preview')
  const editMode = on('edit')

  // All pages (name → sections) so the editor can switch between templates.
  const pagesByName: Record<string, ContentNode[]> = {}
  for (const [key, mod] of Object.entries(opts.pages)) {
    const name = key.replace(/^.*\//, '').replace(/\.json$/, '')
    pagesByName[name] = (mod as { default?: PageDoc }).default?.sections ?? []
  }

  const content = previewMode ? (
    <PreviewBridge pages={pagesByName} initialPage={opts.page ?? 'index'} Shell={Shell} />
  ) : editMode ? (
    <Editor pages={pagesByName} initialPage={opts.page ?? 'index'} />
  ) : (
    <Shell>
      <SectionTree tree={pageDoc.sections} />
    </Shell>
  )

  // Holds the DataApi in state so `revalidate` can swap fresh data in AFTER
  // hydration: first render = the SSG snapshot (markup matches the server
  // byte-for-byte), then the fresh fetch reconciles in place (SWR).
  const Root: FC = () => {
    const [data, setData] = React.useState(opts.data)
    React.useEffect(() => {
      if (!opts.revalidate) return
      let live = true
      opts
        .revalidate()
        .then((fresh) => {
          if (live && fresh) setData(fresh)
        })
        .catch(() => {
          /* keep the snapshot data — a failed refresh must not blank the page */
        })
      return () => {
        live = false
      }
      // mount() runs once per page load; opts never changes afterwards.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return (
      <DataProvider value={data}>
        <ThemeProvider settings={opts.settings} locale={opts.locale}>
          <CartProvider>{content}</CartProvider>
        </ThemeProvider>
      </DataProvider>
    )
  }

  const app = (
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  )

  // Storefront (SERVE plane) is prerendered to static HTML at build time (SSG,
  // see ssg.tsx) — hydrate it so the markup is reused (no flash, SEO-ready).
  // Preview/edit planes are always client-rendered (not prerendered).
  // forceClientRender = the SSG markup is known not to match (different page /
  // no snapshot): wipe it and client-render — hydrating would mismatch (#418).
  const isStorefront = !previewMode && !editMode
  const hasSSG = rootEl.firstChild != null
  if (isStorefront && hasSSG && !opts.forceClientRender) {
    hydrateRoot(rootEl, app)
  } else {
    if (hasSSG) rootEl.replaceChildren()
    createRoot(rootEl).render(app)
  }
}
