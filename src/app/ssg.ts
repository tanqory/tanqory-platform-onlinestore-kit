import { createLiveData, createMockData } from '../data'
import type { DataApi } from '../data'
import { renderSectionPreviewHTML, renderStorefrontHTML } from '../ssg'
import type { StorefrontEnv } from './env'

export interface ServerEntryOptions {
  /** `import.meta.env` read BY THE THEME (see env.ts). */
  env: StorefrontEnv
  /** `import.meta.glob('./sections/*.tsx', { eager: true })` — from the theme. */
  sections: Record<string, unknown>
  /** `import.meta.glob('./templates/*.json', { eager: true })` — from the theme. */
  templates: Record<string, unknown>
  /** `import.meta.glob('./layouts/*.tsx', { eager: true })` — from the theme. */
  layouts: Record<string, unknown>
  /** The theme's `config/settings.json`. */
  settings: Record<string, unknown>
  /** The theme's default-locale strings (`locales/en.json`). */
  locale: Record<string, string>
  /** The theme's offline fixtures (`lib/collections.json`). */
  mockData: Parameters<typeof createMockData>[0]
}

export interface ServerRenderResult {
  html: string
  state: unknown | null
  head: { title: string; description: string; keywords: string[] }
}

/**
 * Build the theme's SSG `render(page)` — renders the storefront to an HTML
 * string at build time. Tries live GraphQL first (so cold rebuilds bake real
 * product data into dist/index.html for SEO + instant first paint) and falls
 * back to the bundled mock fixtures if the backend is unreachable /
 * over-budget — same graceful-degradation policy as the client entry.
 *
 * Returns the SSG HTML plus the serializable data snapshot it was rendered
 * with. The prerender step embeds `state` into the page as
 * `window.__TQ_STATE__`, and `createStorefrontEntry` rebuilds the identical
 * DataApi from it synchronously at hydration — SSR markup and the client's
 * first render match by construction (no React #418/#425). `state` is null
 * when SSG fell back to mocks (no backend at build time) — the client then
 * does a plain CSR boot.
 */
export function createServerEntry(
  options: ServerEntryOptions,
): (page?: string) => Promise<ServerRenderResult> {
  const { env, sections, templates, layouts, settings, locale, mockData } = options

  async function bootData(): Promise<DataApi> {
    const { VITE_TANQORY_BACKEND, VITE_TANQORY_STORE_ID, VITE_TANQORY_STOREFRONT_TOKEN } = env
    if (VITE_TANQORY_BACKEND && VITE_TANQORY_STORE_ID) {
      try {
        return await createLiveData({
          endpoint: VITE_TANQORY_BACKEND,
          storeId: VITE_TANQORY_STORE_ID,
          token: VITE_TANQORY_STOREFRONT_TOKEN,
        })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[ssg] live data fetch failed, falling back to mocks:', (err as Error)?.message ?? err)
      }
    }
    return createMockData(mockData)
  }

  return async function render(page = 'index'): Promise<ServerRenderResult> {
    const data = await bootData()
    const html = renderStorefrontHTML({
      sections,
      pages: templates,
      shell: layouts,
      data,
      settings,
      locale,
      page,
    } as Parameters<typeof renderStorefrontHTML>[0])
    const bootstrap = data.getSnapshot?.() ?? null
    // The SSG only prerenders the home page, so its head is the shop's — the
    // client sets per-route heads for everything else (see head.ts computeHead).
    const shop = (data as { shop?: { name?: string; description?: string } }).shop
    const head = {
      title: (shop?.name || (settings as { shopName?: string }).shopName || 'Store').trim(),
      description: (shop?.description || '').trim(),
      keywords: [] as string[],
    }
    return { html, state: bootstrap ? { page, bootstrap } : null, head }
  }
}

export interface SectionPreviewOptions {
  /** `import.meta.glob('./sections/*.tsx', { eager: true })` — from the theme. */
  sections: Record<string, unknown>
  /** The theme's `config/settings.json`. */
  settings: Record<string, unknown>
  /** The theme's default-locale strings (`locales/en.json`). */
  locale: Record<string, string>
  /** The theme's offline fixtures (`lib/collections.json`). */
  mockData: Parameters<typeof createMockData>[0]
}

/**
 * Build the theme's `renderSection(type, settings?)` for the editor's
 * "Add section" preview. Renders ONE section to an HTML string — no shell, no
 * page routing, no client SPA — using synchronous MOCK data so the markup is
 * instant. The live storefront still uses `createStorefrontEntry`.
 */
export function createSectionPreview(
  options: SectionPreviewOptions,
): (type: string, settingsOverride?: Record<string, unknown>) => string {
  const { sections, settings, locale, mockData } = options
  const data = createMockData(mockData)
  return function renderSection(
    type: string,
    settingsOverride?: Record<string, unknown>,
  ): string {
    return renderSectionPreviewHTML(
      { sections, data, settings, locale } as Parameters<typeof renderSectionPreviewHTML>[0],
      type,
      settingsOverride,
    )
  }
}
