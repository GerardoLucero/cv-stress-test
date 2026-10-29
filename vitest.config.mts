import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/sdk/**', 'src/lib/**'], exclude: ['**/*.test.ts'], reporter: ['text', 'text-summary'] },
  },
})
