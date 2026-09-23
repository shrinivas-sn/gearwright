import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Executable enforcement of a composition invariant that no unit test could see
 * (Bug 20: root-caused by CHK-12.7's rerun, fixed and guarded in CHK-12.8).
 *
 * `InteractionSystem` reports focus twice, and the two are not interchangeable:
 *  - `world.step(...).focus` is a `FocusChanged` **edge** — `{ previous, current }`,
 *    emitted only on the step the focused target *changes* (ARCH §13's contract);
 *  - `interaction.focus` is the **live** read — the target the player is aiming at
 *    right now, answering on every step.
 *
 * The composition consumed the edge as if it were live: `result.focus?.current` is
 * `null` on every steady step, so the staged press (ADR-018), the hint engagement and
 * the clue discovery silently saw "no focus" unless their input happened to land on
 * the exact acquisition step. Every suite stayed green — every system was correct,
 * only the composition's read was wrong — and BM-1's whole priming half was
 * unreachable in play until a browser run found it.
 *
 * The composition's live read is `interaction.focus` (the same read the HUD, the
 * scanner request and the hint button already used). These assertions fail the build
 * if the edge read comes back.
 */
const SRC_ROOT = join(process.cwd(), 'src');

/**
 * `focus.current` / `focus?.current` — the edge's field, whatever the receiver is
 * called (`result.focus?.current`, a destructured local, an aliased step result).
 * Case-sensitive on purpose: `currentFocus.*` and `FocusChanged` are different names,
 * and creating the edge (`{ previous, current }`) is not a read of it.
 */
const EDGE_READ = /\bfocus\??\.current\b/;

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Block and whole-line comments are stripped so prose may quote the misuse. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('focus reads — src/ (Bug 20)', () => {
  const files = listTsFiles(SRC_ROOT).map((file) => ({
    path: relative(process.cwd(), file).replace(/\\/g, '/'),
    source: stripComments(readFileSync(file, 'utf8'))
  }));

  it('never reads the step result’s focus *edge* as live focus', () => {
    const offenders = files.filter((file) => EDGE_READ.test(file.source)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('keeps the composition reading live focus through the interaction system', () => {
    const composition = files.find((file) => file.path === 'src/main.ts');
    if (composition === undefined) throw new Error('src/main.ts is missing');
    const liveReads = composition.source.match(/interaction\.focus\b/g) ?? [];
    // Three consumers depend on it — the hint engagement, the staged press and the
    // clue discovery — and the HUD, hint button and scanner request read it too. A
    // silent removal is exactly the regression this pins.
    expect(liveReads.length).toBeGreaterThanOrEqual(3);
  });
});
