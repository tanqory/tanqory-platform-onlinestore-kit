// @tanqory/theme-kit/app — the storefront APPLICATION layer.
//
// Everything a Tanqory marketplace theme used to copy-paste verbatim: the
// client entry (routing / SEO head / locale / hydration / analytics), the
// application shell (SPA soft-route, menus, url redirects, dynamic sources,
// global overlays), and the shared UI primitives those depend on.
//
// A theme keeps only what should differ between themes: assets/styles.css,
// templates/*.json, config/*, index.html and its own sections/.
//
// Layer 1 = @tanqory/theme-kit  (data + registry + renderer)
// Layer 2 = @tanqory/theme-kit/app  (this)
// Layer 3 = the theme

export { createStorefrontEntry } from './entry'
export type { StorefrontEntryOptions } from './entry'

export {
  StorefrontShell,
  StorefrontEnvProvider,
  useStorefrontEnv,
  useSoftRoute,
  usePersistedChoice,
  usePreviewSelection,
  useUrlRedirect,
  useStorefrontMenus,
  useChrome,
  LOCALE_KEY,
  COUNTRY_KEY,
} from './shell'
export type {
  StorefrontShellProps,
  StorefrontShellSlots,
  MenuLink,
} from './shell'

export type { StorefrontEnv } from './env'

// Routing + head + locale — exported so a theme (or a signature section) can
// reuse the exact same resolution the entry uses instead of re-deriving it.
export {
  resolveTemplate,
  resolvePageHandle,
  resolveProductHandle,
  resolveCollectionHandle,
  resolveBlogHandle,
  resolveArticleMatch,
  detailHandles,
  templateExists,
  variantOf,
} from './routes'
export {
  applyBrandFonts,
  applyHead,
  computeHead,
  headFrom,
  absUrl,
} from './head'
export type { HeadMeta } from './head'
export {
  DEFAULT_LOCALE,
  localeMapsFrom,
  pickLocale,
  resolveCountry,
  resolveLocale,
  localeHeader,
} from './locale'

// lib
export { apiBase } from './lib/api-base'
export { decodeHandle, handleFromPath } from './lib/handle'

// headless commerce hooks — write your own commerce sections as markup and
// read the money path (product/variant/price, cart, search, account) from here
export {
  useProductPage,
  useCartDrawerState,
  useStorefrontSearch,
  useCustomerAccount,
  useCustomerSession,
} from './hooks'
export type {
  ProductPageAttributes,
  CartDrawerState,
  StorefrontSearchOptions,
  StorefrontSearchState,
  CustomerAccountState,
  CustomerAccountStatus,
  CustomerSession,
} from './hooks'

// primitives
export { Button } from './components/Button'
export { Container } from './components/Container'
export { CookieConsent } from './components/CookieConsent'
export { Drawer } from './components/Drawer'
export { ImageResponsive } from './components/ImageResponsive'
export { Link } from './components/Link'
export { Modal } from './components/Modal'
export { Money } from './components/Money'
export { Price } from './components/Price'
export { TrackingPixels } from './components/TrackingPixels'
export { ProductProvider, useProductContext } from './components/product-context'
export type { ProductContextValue } from './components/product-context'
export { openOverlay, closeOverlay, useOverlay } from './components/useOverlayChannel'
export type { OverlayName } from './components/useOverlayChannel'
export { useMenu } from './components/use-menu'

// overlay surfaces (behaviour; markup overridable via StorefrontShell slots)
export { AccountMenu } from './overlays/AccountMenu'
export type { AccountMenuProps } from './overlays/AccountMenu'
export { CartDrawer } from './overlays/CartDrawer'
export type { CartDrawerProps } from './overlays/CartDrawer'
export { MobileNavDrawer } from './overlays/MobileNavDrawer'
export type { MobileNavDrawerProps } from './overlays/MobileNavDrawer'
export { SearchModal } from './overlays/SearchModal'
export type { SearchModalProps } from './overlays/SearchModal'
