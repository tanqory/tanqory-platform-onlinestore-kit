import { defineConfig } from 'vite'

/**
 * The Theme Contract as ONE self-contained file.
 *
 * It is a separate build on purpose. In the main library build the contract
 * shares modules with the runtime (`mount` resolves groups through the same
 * `resolvePage` the validator uses), and Rollup hoists shared modules into a
 * common chunk — which turned `dist/contract.js` into a file that imports
 * `./groups-<hash>.js`. studio-api vendors `dist/contract.js` verbatim into a
 * zero-npm-dependency image (`apps/api/sync-contract.mjs`), so the contract
 * must never import anything. A single-entry build has nothing to share.
 *
 * Runs after the main build with `emptyOutDir: false` so it only adds
 * `contract.js` next to `index.js` and `ssg.js`.
 */
export default defineConfig({
  build: {
    target: 'es2021',
    emptyOutDir: false,
    lib: {
      entry: { contract: 'src/contract/index.ts' },
      formats: ['es'],
    },
    rollupOptions: {
      output: { entryFileNames: '[name].js', inlineDynamicImports: true },
    },
    minify: false,
    sourcemap: true,
  },
})
