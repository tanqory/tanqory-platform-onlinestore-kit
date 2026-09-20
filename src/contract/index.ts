/**
 * Tanqory Theme Contract v1 — the shared agreement between the theme (kit),
 * the CMS (studio-api + code-store), the Editor (studio-app), the storefront
 * runtime, and any AI authoring against them.
 *
 * Owner: `@tanqory/theme-kit`. It already owns `AttrSpec` / `SectionDef` /
 * `ContentNode` / `PageDoc`, so the contract derives from the code rather than
 * restating it — and `tsc` proves the derivation.
 *
 * This entry is dependency-free (no React), so it builds to a single portable
 * `dist/contract.js` that studio-api can vendor without breaking its
 * zero-npm-dependency image.
 */
export const CONTRACT_VERSION = '1.0.0'

/**
 * Which theme-kit releases this contract describes.
 *
 * Nothing on the platform declared runtime compatibility before, so a theme
 * built against one kit and rendered by another failed at runtime with no
 * signal. A consumer compares its installed kit version against this range and
 * says so up front.
 */
export const KIT_COMPATIBILITY = {
  /** Lowest kit release whose runtime honours everything in this contract. */
  min: '0.1.3',
  /** Highest kit release verified against it. */
  maxVerified: '0.2.0',
} as const

export * from './field-types'
export * from './content'
export * from './groups'
export * from './transform'
export * from './validate'
