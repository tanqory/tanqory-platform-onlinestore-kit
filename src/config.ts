export interface ThemeConfig {
  name: string
  routes: Record<string, string>
  data: {
    mode: 'mock' | 'live'
    endpoint?: string | undefined
    token?: string | undefined
  }
  tokens?: string
}

export function defineTheme(config: ThemeConfig): ThemeConfig {
  return config
}

import type { AttrSpec } from './types'

/** Global theme settings schema (drives the editor's "Theme settings" panel). */
export type SettingsSchema = Record<string, AttrSpec>

export function defineSettings(schema: SettingsSchema): SettingsSchema {
  return schema
}
