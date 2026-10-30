import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Renderer DOM harness (audit F14): component and hook tests run in
// jsdom through `npm run test:renderer`. The backend suite (`npm
// test`, plain node:test over .cjs files) is untouched — this config
// only includes src/**/*.test.{ts,tsx}. Owner setup: `npm install`
// (new devDeps), then `npm run test:renderer`.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true, // lets @testing-library auto-cleanup register
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 10000,
  },
})
