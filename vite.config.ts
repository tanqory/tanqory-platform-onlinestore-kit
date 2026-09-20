import { defineConfig } from 'vite'

// Library build → dist/index.js (ESM). React stays external so the host theme
// provides a single React instance (hooks/context work across the boundary).
export default defineConfig({
  build: {
    target: 'es2021',
    // Two entries: client API (index) and SSG render (ssg, uses react-dom/server).
    // Separate so themes never bundle react-dom/server into the client.
    //
    // The dependency-free theme contract is NOT an entry here — it is built by
    // `vite.contract.config.ts` as its own single file. With three entries in
    // one build, Rollup hoisted the modules the runtime and the contract share
    // (`resolvePage`) into a common chunk, and `dist/contract.js` started
    // importing `./groups-<hash>.js` — which studio-api's zero-dependency
    // vendoring cannot carry.
    lib: {
      entry: { index: 'src/index.ts', ssg: 'src/ssg.tsx' },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'react-dom/server'],
      output: { entryFileNames: '[name].js' },
    },
    minify: false,
    sourcemap: true,
  },
})
