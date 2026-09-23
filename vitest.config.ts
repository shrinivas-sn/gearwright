import { defineConfig } from 'vitest/config';

/**
 * Test runner config (ADR-012, TEST_SUITE_PLAN §2).
 * Three projects so tests keep the right environment without per-file pragmas:
 *  - `logic`    : headless game/platform rules (node env) — the majority
 *  - `boundary` : dependency-boundary enforcement (node env, filesystem scans)
 *  - `dom`      : UI/lifecycle-adapter tests (jsdom env)
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'logic',
          environment: 'node',
          include: ['tests/logic/**/*.test.ts']
        }
      },
      {
        test: {
          name: 'boundary',
          environment: 'node',
          include: ['tests/boundary/**/*.test.ts']
        }
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/dom/**/*.test.ts']
        }
      }
    ]
  }
});