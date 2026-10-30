import { defineConfig } from 'tsup'

// One file: the relay client and address grammar come from ../claude-code and are bundled in.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  banner: { js: '#!/usr/bin/env node' }
})
