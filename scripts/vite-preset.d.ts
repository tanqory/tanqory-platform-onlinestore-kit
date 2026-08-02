import type { ConfigEnv, UserConfig } from 'vite'

/**
 * The standard Tanqory theme Vite config (dev server + studio-save +
 * section-preview middleware + preview host allow-list).
 */
export declare function tanqoryThemeConfig(
  ctx?: Partial<ConfigEnv>,
  extra?: UserConfig,
): UserConfig

export default tanqoryThemeConfig
