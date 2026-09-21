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

Published to **npmjs.org** — public, no token:

```bash
pnpm add @tanqory/theme-kit            # latest stable
pnpm add @tanqory/theme-kit@rc         # the current release candidate
```

A theme meant to be cloned by anyone (nova) resolves it this way, so its
`.npmrc` must NOT map the `@tanqory` scope anywhere.

The same tarball is also published to **GitHub Packages**, which is where the
org's own repositories resolve `@tanqory` (they need other, private `@tanqory`
packages from there). Those keep their existing `.npmrc`:

```
@tanqory:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Both registries carry identical bytes, so a lockfile's integrity is valid on
either.

## Build

```bash
pnpm install
pnpm build      # vite build + emit d.ts to dist/types
```

## Release

CI (`.github/workflows/publish.yml`) publishes on a pushed `v*` tag: it runs
`pnpm verify`, packs ONCE, and publishes that tarball to npmjs.org and to
GitHub Packages. A prerelease (`0.2.0-rc.2`) gets its identifier as the dist-tag
(`rc`) and never becomes `latest`. Re-running for a version that is already
published is a no-op.

Needs the repository secret **`NPM_TOKEN`** — an npm automation token that can
publish to the `@tanqory` scope. Without it the release fails loudly rather than
reaching one registry only.

```bash
npm version 0.2.0-rc.2 --no-git-tag-version   # or patch / minor
git commit -am "chore(release): 0.2.0-rc.2" && git tag v0.2.0-rc.2
git push --follow-tags
```

---

> Extracted from `tanqory-platform-studio-new/packages/theme-kit` (git history
> preserved) as part of the online-store repo split. `tanqory-studio` keeps a
> copy as fallback until all consumers switch to the published package.
