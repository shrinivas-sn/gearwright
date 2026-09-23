import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Executable enforcement of a stylesheet invariant that is otherwise invisible.
 *
 * There is no CSS compile step here, so an unbalanced or accidentally nested rule does
 * not fail the build — with CSS nesting supported by browsers, a rule that is missing its
 * closing brace silently becomes a *descendant* selector for every rule that follows, and
 * the browser simply never applies them. Nothing throws, the tests stay green, and the
 * page renders as if the CSS were never written (jsdom applies no CSS at all, so the dom
 * suite cannot see it either).
 *
 * That is a real defect this project shipped twice (`src/style.css`: `.gw-debug-bad` and
 * `.gw-hud-materials, .gw-hud-blueprints` were each missing `}`, which swallowed the whole
 * HUD block and then the hint/toast/`.gw-hud-hidden` rules), found only by measuring
 * computed styles in a real browser (CHK-12.4). These assertions are the cheap guard that
 * turns the same mistake into a failing test.
 *
 * The stylesheet is deliberately **flat** — no `@`-rules, no nesting — so a depth above 1
 * is always a missing brace rather than a legitimate authoring choice.
 */
const STYLESHEET = join(process.cwd(), 'src', 'style.css');

/** Comments are stripped first: prose may quote selectors and braces. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('stylesheet integrity — src/style.css', () => {
  const source = stripComments(readFileSync(STYLESHEET, 'utf8'));

  it('balances its braces', () => {
    const opens = (source.match(/\{/g) ?? []).length;
    const closes = (source.match(/\}/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it('never nests a rule inside another rule (a missing brace is silent otherwise)', () => {
    let depth = 0;
    const offenders: Array<{ line: number; reason: string }> = [];

    source.split('\n').forEach((line, index) => {
      for (const character of line) {
        if (character === '{') {
          depth += 1;
          if (depth > 1) offenders.push({ line: index + 1, reason: 'rule opened inside a rule' });
        } else if (character === '}') {
          depth -= 1;
          if (depth < 0) offenders.push({ line: index + 1, reason: 'closing brace with nothing open' });
        }
      }
    });

    expect(offenders).toEqual([]);
    expect(depth).toBe(0);
  });

  it('keeps the selectors the HUD is built from at the top level', () => {
    // A swallowed block loses these declarations without removing the text, so the
    // presence of the selector text is not enough on its own — the nesting rule above
    // is what makes the check real. This list pins the surfaces the HUD must style.
    const required = [
      '.gw-hud {',
      '.gw-hud-surface {',
      '.gw-hud-reticle {',
      '.gw-hud-left {',
      '.gw-hud-objective {',
      // `.gw-hud-log` deliberately has no rule of its own: it is a `.gw-hud-surface`
      // laid out by the `.gw-hud-left` column. The entry rules are what it does define.
      '.gw-hud-log-entry {',
      '.gw-hud-resources {',
      '.gw-hud-manipulation {',
      '.gw-hud-hint {',
      '.gw-hud-toasts {',
      '.gw-hud-entry {',
      '.gw-hud-save-note {',
      '.gw-hud .gw-hud-hidden {'
    ];

    expect(required.filter((selector) => !source.includes(selector))).toEqual([]);
  });
});
