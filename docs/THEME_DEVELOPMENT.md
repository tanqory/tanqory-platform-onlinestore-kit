# Building Tanqory Themes

A practical guide for developers building storefront themes on `@tanqory/theme-kit`.

> **TL;DR** — A theme is your own React code. You author `sections/`, `templates/`,
> `layouts/` and a bit of config; you import everything else from `@tanqory/theme-kit`.
> It runs offline against mock data while you develop, connects to a real store's
> Storefront GraphQL API when live, is edited visually in the studio editor, and
> publishes as a server-rendered static site.

---

## 1. Mental model

```
1 store  ──►  N themes          a theme is independent React code
@tanqory/theme-kit              the framework/runtime every theme depends on
                                 → you write sections/templates/layouts; the kit does the rest
edit live in the studio editor  → publish as a static (SSG) site
```

Merchants never run a CLI. Everything — create, edit, preview, publish, delete —
happens through the studio API + the visual editor. Your job is to author the
React building blocks; the kit wires data, the editor, routing, SSR and the cart.

---

## 2. Quick start

```bash
# from a theme folder (e.g. apps/examples/react or themes/nova)
pnpm install
pnpm dev          # http://localhost:5173 — runs OFFLINE against ./lib/collections.json
pnpm build        # production build (static + SSG)
pnpm typecheck
```

To preview against a **real store** instead of mock data:

```bash
cp .env.example .env
# then set:
#   TANQORY_DATA_MODE=live
#   TANQORY_BACKEND=https://api-<cell>.tanqory.com
#   TANQORY_STORE_ID=<store-uuid>
#   TANQORY_STOREFRONT_TOKEN=<publishable-key>   # optional for public reads
#   TANQORY_COUNTRY=TH                            # optional — Market/currency
pnpm dev
```

The theme itself stays **store-agnostic** — the store is chosen by config in dev,
and by hostname in production. Never hardcode a store id in theme code.

---

## 3. Project structure

```
my-theme/
├── tanqory.config.ts     # theme manifest: name + routes + data mode   (defineTheme)
├── main.tsx              # entry: globs your files → mount()
├── sections/*.tsx        # ★ the unit of the editor               (defineSection)
├── templates/*.json      # a page = an ordered list of sections + their settings
├── layouts/layout.tsx    # the header/footer shell wrapping every page
├── config/
│   ├── settings.ts       # theme-level settings SCHEMA              (defineSettings)
│   └── settings.json     # the merchant's chosen VALUES
├── components/*.tsx       # plain React helpers (Button, Price) — NOT sections
├── locales/en.json        # i18n strings                            (useT)
├── lib/collections.json   # mock catalogue for offline dev
├── assets/styles.css
└── index.html · vite.config.ts · tsconfig.json
```

A full theme (`themes/nova`, 26 sections) is the same shape plus `entry-server.tsx`
(SSR entry) and `overlays/`.

---

## 4. The six building blocks

### ① `tanqory.config.ts` — the manifest

```ts
import { defineTheme } from '@tanqory/theme-kit'

export default defineTheme({
  name: 'nova',
  routes: {
    '/': 'index',                          // → templates/index.json
    '/products/:handle': 'product',        // → templates/product.json
    '/collections/:handle': 'collection',  // → templates/collection.json
  },
  data: {
    mode: import.meta.env.TANQORY_DATA_MODE === 'live' ? 'live' : 'mock',
    endpoint: import.meta.env.TANQORY_BACKEND,
    storeId: import.meta.env.TANQORY_STORE_ID,
    token: import.meta.env.TANQORY_STOREFRONT_TOKEN,
  },
})
```

A `route` maps a URL pattern to a **template name**. `:handle` is captured and
exposed to the matching template's sections.

### ② `main.tsx` — the entry (rarely touched)

```ts
import { mount, createMockData, createLiveData } from '@tanqory/theme-kit'
import './assets/styles.css'
import config from './tanqory.config'
import collections from './lib/collections.json'
import settings from './config/settings.json'
import locale from './locales/en.json'

const themeFiles = {
  sections: import.meta.glob('./sections/*.tsx', { eager: true }), // auto-registers every section
  pages:    import.meta.glob('./templates/*.json'),
  shell:    import.meta.glob('./layouts/*.tsx'),
}

const data =
  config.data.mode === 'live'
    ? await createLiveData({ endpoint: config.data.endpoint, storeId: config.data.storeId, token: config.data.token })
    : createMockData(collections)

mount({ ...themeFiles, data, settings, locale })
```

You drop a file in `sections/` and the glob registers it — no manual registry.

### ③ Sections — `defineSection` ★ the heart of a theme

A section is a React component **plus** an editor schema. Every section file
**must `export default defineSection(...)`**.

```ts
import { defineSection, useData, type SectionProps } from '@tanqory/theme-kit'
import { Price } from '../components/Price'

export function ProductGrid({ attributes }: SectionProps) {
  const { collectionByHandle } = useData()
  const collection = collectionByHandle(attributes.collection)
  const products = collection?.products ?? []
  const columns = attributes.columns ?? 4

  return (
    <section className="section">
      {attributes.heading && <h2>{attributes.heading}</h2>}
      <div className="tq-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {products.map((p) => (
          <a key={p.handle} href={`/products/${p.handle}`}>
            {p.featuredImage && <img src={p.featuredImage.url} alt={p.featuredImage.altText ?? p.title} />}
            <span>{p.title}</span>
            <Price money={p.price} compareAt={p.compareAtPrice} />
          </a>
        ))}
      </div>
    </section>
  )
}

export default defineSection({
  name: 'product-grid',          // referenced by templates as "type"
  title: 'Product grid',         // shown in the editor's "Add section" menu
  category: 'commerce',
  icon: '▦',
  attributes: {                  // ← each entry becomes a control in the editor
    heading:    { type: 'text',       default: 'Featured', label: 'Heading' },
    collection: { type: 'collection', default: 'all',      label: 'Collection' },
    columns:    { type: 'number',     default: 4,          label: 'Columns' },
  },
  component: ProductGrid,
})
```

The `component` receives `SectionProps` — `{ attributes }` are the merchant-set
values (defaulting to the schema defaults).

### ④ Templates — `templates/*.json`

A page is an ordered list of section instances and their settings:

```json
{
  "sections": [
    { "type": "hero",         "id": "hero",     "settings": { "heading": "Modern essentials", "bg": "#0a0a0a" } },
    { "type": "product-grid", "id": "featured", "settings": { "collection": "all", "columns": 4 } }
  ]
}
```

The editor renders/re-orders these; `type` must match a section's `name`.

### ⑤ Layout — `layouts/layout.tsx`

The shell wrapping every page (header, nav, footer):

```ts
export default function Layout({ children, shopName, t }) {
  return (
    <>
      <header className="site-header">
        <a href="/">{shopName}</a>
        <nav><a href="/collections/all">{t('nav.shop')}</a></nav>
      </header>
      <main>{children}</main>
      <footer><small>© {shopName} — {t('footer.rights')}</small></footer>
    </>
  )
}
```

> Tip: for a **live, merchant-managed** menu use `useData().menu('main-menu')`
> instead of hardcoding nav links (see §6).

### ⑥ Theme settings — `config/settings.ts` + `settings.json`

Global, merchant-configurable theme options (colors, fonts, shop name):

```ts
import { defineSettings } from '@tanqory/theme-kit'

export default defineSettings({
  shopName: { type: 'text',  default: 'nova',    label: 'Shop name' },
  accent:   { type: 'color', default: '#0a0a0a', label: 'Accent color' },
})
```

Read them anywhere with `useSettings()`; translate with `useT()`:

```ts
import { useSettings, useT } from '@tanqory/theme-kit'
const { accent } = useSettings()
const t = useT()
```

---

## 5. Field types (editor controls)

Each `attributes[key].type` (and each theme-setting type) maps to an editor control:

| Type | Control | Value |
|------|---------|-------|
| `text` | single-line input | `string` |
| `textarea` | multi-line input | `string` |
| `richtext` | rich text editor | HTML `string` |
| `color` | color picker | hex `string` |
| `number` | number input | `number` |
| `boolean` | checkbox | `boolean` |
| `url` | URL input | `string` |
| `select` | dropdown (give `options`) | `string` |
| `collection` | collection picker | collection **handle** |
| `product` | product picker | product **handle** |
| `image` | media-library picker | image **url** |

```ts
attributes: {
  layout: { type: 'select', default: 'grid', label: 'Layout',
            options: [{ label: 'Grid', value: 'grid' }, { label: 'List', value: 'list' }] },
  banner: { type: 'image', label: 'Banner image' },
}
```

> ⚠️ **Known caveat:** the deployed studio-editor settings panel currently uses
> standard type names for a few controls (`image_picker`, `checkbox`,
> no `textarea`). Until reconciled, prefer `text`/`url`/`color`/`number`/`select`/
> `collection`/`product` for guaranteed editor rendering; `textarea`/`boolean`/
> `image` may show "unsupported type" in the editor (they still work at runtime).

---

## 6. Data layer — `useData()`

`useData()` returns a `DataApi`. **Core** read methods are always present (mock +
live). **Storefront extensions** are *live-only* — feature-detect them
(`data.search?.(...)`).

### Core (mock + live)

```ts
const data = useData()

data.collectionByHandle('all')        // Collection | null  (prefetched at boot, sync)
data.allCollections()                 // Collection[]
data.productByHandle('tshirt')        // Product | null     (card-level, sync)
data.pageByHandle('about')            // Page | null        (current page only)
data.localization                     // markets/countries  (null when no Markets)

await data.fetchProduct('tshirt', {   // full PDP: variants, options, gallery, ...
  metafields: [{ namespace: 'custom', key: 'spec' }],
})
await data.graphql(query, variables)  // raw Storefront GraphQL escape hatch (live only)
```

### Storefront extensions (live only — feature-detect)

```ts
data.shop                              // { name, description, brand, policies{privacy,refund,...} }
data.menu('main-menu')                 // Menu | null (main-menu + footer prefetched, sync)
await data.fetchMenu('mobile-menu')    // any menu by handle

await data.search('shirt', { first: 24, after, types: ['PRODUCT'] })
//   → { totalCount, products, pages, articles, filters, pageInfo }
await data.predictiveSearch('shi', { limit: 4 })       // autocomplete dropdown
await data.collectionProducts('shoes', {               // collection page, paginated + faceted
  first: 24, after, sortKey: 'PRICE', reverse: false, filters: [{ available: true }],
})  // → { products, filters, pageInfo }

await data.productRecommendations(product.id)          // "you may also like"
await data.blogByHandle('news', { articles: 20 })      // blog + its articles
await data.articleByHandle('news', 'launch-day')       // single article
await data.metaobject('announcement', 'spring')        // custom content
await data.metaobjects('faq', { first: 50 })
```

### Customer account (`data.customer`, live only)

```ts
import { customerTokenStore } from '@tanqory/theme-kit'

const res = await data.customer.login(email, password)
if (res.token) customerTokenStore.set(res.token)        // persist (localStorage helper)

const me     = await data.customer.get(customerTokenStore.get())   // account page
const orders = await data.customer.orders(token)                   // order history
await data.customer.register({ email, password, firstName })
await data.customer.createAddress(token, { city: 'BKK', country: 'TH' })
await data.customer.setDefaultAddress(token, addressId)
const order  = await data.customer.orderByLookup('1001', 'a@b.com') // guest lookup
```

### Product shape (what cards/PDP get)

```ts
interface Product {
  id?, handle, title
  price: Money
  compareAtPrice?: Money | null        // present only on a real sale (was > now) → strikethrough
  featuredImage?, variantId?, availableForSale?
  vendor?, productType?, tags?         // facets (card badges / filtering)
  // PDP-only (after fetchProduct):
  description?, images?, options?, seo?
  variants?: ProductVariant[]          // each: price, compareAtPrice, sku, unitPrice,
                                        //       quantityRule, storeAvailability (pickup)
  sellingPlanGroups?                   // subscriptions
  metafields?: Record<string, string>  // "namespace.key" → value
}
```

---

## 7. Cart — `useCart()`

```ts
const cart = useCart()   // CartApi (state + methods)

// state
cart.lines · cart.subtotal · cart.total · cart.totalQuantity · cart.checkoutUrl
cart.discountCodes · cart.discountAmount · cart.appliedGiftCards
cart.loading · cart.ready · cart.error

// line mutations
await cart.add({ variantId, quantity: 1 })
await cart.updateQuantity(lineId, 2)
await cart.remove(lineId)
await cart.clear()

// promotions (live only)
await cart.applyDiscountCodes(['SAVE10'])   // replaces the set; [] clears
await cart.applyGiftCardCodes(['GIFT-XXXX'])
await cart.removeGiftCards([giftCardId])
```

The cart id is persisted in `localStorage`; line data is always reconciled from
the backend after every mutation. SSR/SSG-safe (empty on the server, hydrates
post-mount — check `cart.ready` before rendering).

---

## 8. The two planes (how editing & publishing work)

| Plane | What happens |
|-------|--------------|
| **Edit / Preview** | Editor canvas iframe = `preview-<themeId>.mytanqory.com`. The kit's `preview-bridge` speaks a `tq:` postMessage protocol — the editor pushes the draft (`tq:set-content`), edits merge live, the editor reads back the tree (`tanqory-get-content`). **No Save button** — edits are write-through drafts. |
| **Build** | `vite build` (+ `vite build --ssr` + prerender when `entry-server.tsx` exists). Prod HTML is **server-rendered then hydrated** — SSG, not an empty CSR shell. |
| **Publish** | The editor reads the live content → `POST /tq/v2/publish` → studio-api writes it to the code store, flips the published label, and warms `<slug>.mytanqory.com`. *What you see in preview is exactly what publishes.* |

---

## 9. Conventions & gotchas

- **Import only from `@tanqory/theme-kit`.** No direct `fetch`/`axios` — use `useData()` / `useCart()`.
- **Every section file must `export default defineSection(...)`.** A stray file in `sections/` without it crashes the runtime (`reading 'name'`).
- **Hooks need their providers** (the kit's `mount()` supplies them): `useData()`→`<DataProvider>`, `useCart()`→`<CartProvider>`, `useSettings()`/`useT()`→`<ThemeProvider>`.
- **GraphQL cost budget is 1000 per request.** Heavy fields (full variants, metafields, storeAvailability, sellingPlanGroups) belong in `fetchProduct()` (PDP), *not* the boot prefetch.
- **Feature-detect live-only data** — `data.search?.(...)`, `data.customer?.login(...)` — so the same theme renders under mock (editor preview / offline).
- **Stay store-agnostic** — pick the store via config (dev) / hostname (prod).
- **Monorepo:** packages are linked `workspace:*`. After deleting `node_modules`, re-run `pnpm install` to relink (e.g. `themes/nova` → `@tanqory/theme-kit`).

---

## 10. Tutorial — add a "Related products" section

```ts
// sections/RelatedProducts.tsx
import { defineSection, useData, type SectionProps } from '@tanqory/theme-kit'
import { useEffect, useState } from 'react'
import type { Product } from '@tanqory/theme-kit'

export function RelatedProducts({ attributes }: SectionProps) {
  const data = useData()
  const [items, setItems] = useState<Product[]>([])

  useEffect(() => {
    // live-only — no-op under mock
    if (!data.productRecommendations || !attributes.productId) return
    data.productRecommendations(attributes.productId).then(setItems)
  }, [data, attributes.productId])

  if (!items.length) return null
  return (
    <section className="section">
      <h2>{attributes.heading ?? 'You may also like'}</h2>
      <div className="tq-grid">
        {items.map((p) => (
          <a key={p.handle} href={`/products/${p.handle}`}>{p.title}</a>
        ))}
      </div>
    </section>
  )
}

export default defineSection({
  name: 'related-products',
  title: 'Related products',
  category: 'commerce',
  icon: '✥',
  attributes: {
    heading:   { type: 'text',    default: 'You may also like', label: 'Heading' },
    productId: { type: 'text',     label: 'Product node id (from the PDP context)' },
  },
  component: RelatedProducts,
})
```

Drop it in `sections/`, reference it from a template (`{ "type": "related-products" }`),
and it appears in the editor's "Add section" menu automatically.

---

## 11. Where to look next (30-min onboarding)

1. `apps/examples/react/` — a minimal 2-section theme; read it end-to-end first.
2. `tanqory.config.ts` + `main.tsx` — the boot path.
3. `themes/nova/` — the full reference theme (26 sections, 11 pages, SSR).
4. `packages/theme-kit/src/{data.tsx,cart.tsx,storefront.ts}` — the `DataApi`/`CartApi`
   your sections consume.
5. `packages/theme-kit/src/{mount,preview-bridge,ssg}.tsx` — boot, the editor bridge, SSG.

---

*The Storefront data layer follows the standard commerce object model (products, collections,
cart, menus, blog/articles, search, recommendations, metaobjects, customer
accounts, shop/policies). Reviews/ratings and wishlists are the only the commerce standard
objects not yet backed by the Storefront API.*
