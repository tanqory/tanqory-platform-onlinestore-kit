# @tanqory/theme-kit

The Studio framework. Themes depend only on this — it auto-discovers a theme's
`sections/`, `templates/`, `layouts/` and renders the **JSON content tree** to React.

Public API: `defineSection`, `defineSettings`, `defineTheme`, `mount`,
`SectionTree`, `useData` / `useSettings` / `useT`, `createMockData`, `jsxToJSON`.

**Status:** already built & passing (currently at `wordpress/tanqory-theme-kit`).
Move it here as `packages/theme-kit` to consolidate under Studio.

```
src/
  defineSection.ts · config.ts (defineTheme/defineSettings) · registry.ts
  SectionTree.tsx (JSON tree → React) · mount.tsx · data.tsx · theme-context.tsx
  jsx-to-json.ts · composition.ts · types.ts · index.ts
```
