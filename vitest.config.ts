import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['scripts/**/__tests__/**/*.test.ts'],
    // Several suites spawn node or poppler as subprocesses; under a full parallel run they
    // pass alone in seconds but can exceed the 5s default.
    testTimeout: 30_000,
  },
})
