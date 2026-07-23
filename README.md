# @tanqory/theme-kit

The Tanqory Studio theme framework. Tanqory React themes depend **only** on this
package — it auto-discovers a theme's `sections/`, `templates/`, `layouts/` and
renders the **JSON content tree** to React.

Public API: `defineSection`, `defineSettings`, `defineTheme`, `mount`,
`SectionTree`, `useData` / `useSettings` / `useT`, `createMockData`, `jsxToJSON`.

```
src/
  defineSection.ts · config.ts (defineTheme/defineSettings) · registry.ts
  SectionTree.tsx (JSON tree → React) · mount.tsx · data.tsx · theme-context.tsx
  jsx-to-json.ts · composition.ts · types.ts · index.ts
```

## Install

Published to **GitHub Packages** under the `@tanqory` scope. Consumers need an
`.npmrc` mapping the scope + an auth token:

```
@tanqory:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
pnpm add @tanqory/theme-kit
```

## Build

```bash
pnpm install
pnpm build      # vite build + emit d.ts to dist/types
```

## Release

CI (`.github/workflows/publish.yml`) publishes on a pushed `v*` tag:

```bash
npm version patch      # bumps package.json + creates the tag
git push --follow-tags # → Action builds & publishes to GitHub Packages
```

---

> Extracted from `tanqory-platform-studio-new/packages/theme-kit` (git history
> preserved) as part of the online-store repo split. `tanqory-studio` keeps a
> copy as fallback until all consumers switch to the published package.
