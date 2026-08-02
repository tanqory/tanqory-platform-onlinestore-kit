/**
 * Build-time storefront env, passed IN from the theme.
 *
 * The theme MUST read `import.meta.env` itself and hand the values over —
 * this package is shipped pre-built (dist/), so an `import.meta.env.VITE_*`
 * read inside it would be frozen at the KIT's build time (i.e. `undefined`)
 * instead of the theme's. Every env-dependent behaviour here (live data,
 * url redirects, live menus, analytics) therefore takes its config as a
 * parameter, exactly like `createLiveData` already does.
 */
export interface StorefrontEnv {
  VITE_TANQORY_BACKEND?: string
  VITE_TANQORY_STORE_ID?: string
  VITE_TANQORY_STOREFRONT_TOKEN?: string
}

/**
 * Declare the storefront vars on Vite's `ImportMetaEnv` for every theme, so a
 * theme can pass `import.meta.env` straight through instead of repeating the
 * `as ImportMetaEnv & { VITE_TANQORY_… }` cast in each file that reads it.
 */
declare global {
  interface ImportMetaEnv {
    readonly VITE_TANQORY_BACKEND?: string
    readonly VITE_TANQORY_STORE_ID?: string
    readonly VITE_TANQORY_STOREFRONT_TOKEN?: string
  }
}
