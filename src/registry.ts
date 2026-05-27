import type { SectionDef } from './types'

const registry = new Map<string, SectionDef>()

export function registerSections(defs: SectionDef[]): void {
  for (const def of defs) registry.set(def.name, def)
}

export function getSection(name: string): SectionDef | undefined {
  return registry.get(name)
}

/** All registered sections — the editor uses this to build its inserter. */
export function allSections(): SectionDef[] {
  return [...registry.values()]
}
