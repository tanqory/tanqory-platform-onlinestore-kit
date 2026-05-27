import { createContext, useContext, type ReactNode } from 'react'

type Settings = Record<string, unknown>
type Locale = Record<string, string>

const SettingsContext = createContext<Settings>({})
const LocaleContext = createContext<Locale>({})

/** Provides global settings values + locale strings to the whole theme. */
export function ThemeProvider({
  settings = {},
  locale = {},
  children,
}: {
  settings?: Settings
  locale?: Locale
  children: ReactNode
}): JSX.Element {
  return (
    <SettingsContext.Provider value={settings}>
      <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
    </SettingsContext.Provider>
  )
}

/** Read global theme settings (values from config/settings.json). */
export function useSettings(): Settings {
  return useContext(SettingsContext)
}

/** Translate a key against the active locale (falls back to the key). */
export function useT(): (key: string) => string {
  const locale = useContext(LocaleContext)
  return (key) => locale[key] ?? key
}
