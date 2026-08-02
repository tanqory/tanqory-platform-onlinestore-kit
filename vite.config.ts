import { defineConfig } from 'vite'

// Library build → dist/index.js (ESM). React stays external so the host theme
// provides a single React instance (hooks/context work across the boundary).
export default defineConfig({
  build: {
    target: 'es2021',
    // Four entries:
    //   index    — client API
    //   ssg      — SSG render (uses react-dom/server)
    //   app      — the storefront application layer (@tanqory/theme-kit/app)
    //   app-ssg  — its server-side factories (@tanqory/theme-kit/app/ssg)
    // Separate so themes never bundle react-dom/server into the client.
    lib: {
      entry: {
        index: 'src/index.ts',
        ssg: 'src/ssg.tsx',
        app: 'src/app/index.ts',
        'app-ssg': 'src/app/ssg.ts',
      },
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
