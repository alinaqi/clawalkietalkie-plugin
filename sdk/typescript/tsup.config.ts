import { defineConfig } from 'tsup'

// ESM and CommonJS, with types for both; no runtime dependencies.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  target: 'node18',
  platform: 'node',
  clean: true,
  sourcemap: true
})
