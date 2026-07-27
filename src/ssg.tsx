import { type FC, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'

import { registerSections } from './registry'
import { SectionTree } from './SectionTree'
import { DataProvider } from './data'
import { CartProvider } from './cart'
import { ThemeProvider } from './theme-context'
import type { SectionDef, PageDoc, ContentNode } from './types'
import type { MountOptions } from './mount'

// Server-side render entry (SSG). Produces the storefront HTML string at BUILD
// time so the published page ships real content in <div id="root">…</div>
// (SEO + fast first paint) instead of an empty CSR shell. The client then
// hydrates the same tree (see mount.tsx). Storefront only — preview/edit planes
// stay client-only.

function defaultsOf<T>(map: Record<string, unknown>): T[] {
  return Object.values(map).map((m) => (m as { default: T }).default)
}

function pickByName<T>(map: Record<string, unknown>, name: string): T | undefined {
  const hit = Object.entries(map).find(
    ([key]) => key.endsWith(`/${name}.json`) || key.endsWith(`/${name}.tsx`),
  )
  return hit ? (hit[1] as { default: T }).default : undefined
}

/** Render a theme page to an HTML string (same tree mount() renders client-side). */
export function renderStorefrontHTML(opts: MountOptions): string {
  registerSections(defaultsOf<SectionDef>(opts.sections))

  const shells = opts.shell ? defaultsOf<FC<{ children: ReactNode }>>(opts.shell) : []
  const Shell: FC<{ children: ReactNode }> = shells[0] ?? (({ children }) => <>{children}</>)
  const pageDoc = pickByName<PageDoc>(opts.pages, opts.page ?? 'index') ?? { sections: [] }

  return renderToString(
    <DataProvider value={opts.data}>
      <ThemeProvider settings={opts.settings} locale={opts.locale}>
        <CartProvider>
          <Shell>
            <SectionTree tree={pageDoc.sections} />
          </Shell>
        </CartProvider>
      </ThemeProvider>
    </DataProvider>,
  )
}

/**
 * Render ONE section to an HTML string for the editor's "Add section" preview —
 * no Shell/layout, no page routing, no client SPA boot. This is the fast path
 * (commerce-standard): the runtime server-renders just the requested section with
 * the theme's providers + data and returns instant HTML. Block-composed sections
 * are seeded with their preset blocks so they aren't empty.
 */
export function renderSectionPreviewHTML(
  opts: Pick<MountOptions, 'sections' | 'data' | 'settings' | 'locale'>,
  type: string,
  settingsOverride?: Record<string, unknown>,
): string {
  const defs = defaultsOf<SectionDef>(opts.sections)
  registerSections(defs)

  const def = defs.find((d) => (d as { name?: string }).name === type)
  const presetBlocks = ((def as { presets?: Array<{ blocks?: ContentNode[] }> } | undefined)
    ?.presets?.[0]?.blocks ?? []) as ContentNode[]
  const node = {
    type,
    id: 'preview',
    settings: settingsOverride ?? {},
    blocks: presetBlocks.map((b, i) => ({
      type: b.type,
      id: `preview-${i}`,
      settings: b.settings ?? {},
    })),
  } as ContentNode

  return renderToString(
    <DataProvider value={opts.data}>
      <ThemeProvider settings={opts.settings} locale={opts.locale}>
        <CartProvider>
          <SectionTree tree={[node]} />
        </CartProvider>
      </ThemeProvider>
    </DataProvider>,
  )
}
