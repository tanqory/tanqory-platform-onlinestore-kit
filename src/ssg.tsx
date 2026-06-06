import { type FC, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'

import { registerSections } from './registry'
import { SectionTree } from './SectionTree'
import { DataProvider } from './data'
import { CartProvider } from './cart'
import { ThemeProvider } from './theme-context'
import type { SectionDef, PageDoc } from './types'
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
