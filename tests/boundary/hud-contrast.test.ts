import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Executable audit of the HUD palette (ARCH §33.2 rule 4 — "readable without colour
 * alone" has a prerequisite: the colour must be readable at all).
 *
 * The HUD's text sits on translucent panels, so its real backdrop is a *blend*: the
 * panel colour over whatever the 3D canvas draws behind it. The worst case is the
 * lab's lightest authored surface (the step, `LAB_STEP = 0x8b939c` in
 * `levels/lab-world.ts`); teal geometry (a carryable at `0x5fb8a6`, a compatible
 * marker) is the second-worst and close enough to audit too. A token that only
 * passes over the dark graphite floor fails in play — the same silent failure mode
 * the §33 stylesheet has shipped before (Bugs 15/16): nothing throws, the build
 * stays green, and the text is simply hard to read in the running game.
 *
 * What this audit found (and the fix it pinned):
 *  - the `.gw-hud-surface` panel at its previous alpha (0.72) left *every* accent
 *    token below AA over the step — `--gw-muted` measured 4.08:1, `--gw-invalid`
 *    3.4:1. The panel now composites at 0.86.
 *  - even over the fixed panel, `--gw-invalid` (3.5:1) and `--gw-unpowered`
 *    (3.3:1) still failed AA, so both tokens were brightened.
 *  - `--gw-complete` over the *unbacked* save note measured ≈1.2–1.5:1 against the
 *    step or the red test block — unreadable — so the note gained the pill backing
 *    it now has.
 *
 * Every ratio is computed the way a browser composites it: alpha blend in sRGB
 * space, then sRGB decode → luminance → (L1+0.05)/(L2+0.05) (WCAG 2.1 §1.4.3).
 * Thresholds: WCAG 2.1 AA is 4.5:1 for normal text, 3:1 for ≥24px (or ≥18.66px
 * bold); the HUD's text is 10–13px, so it is all "normal" and must clear 4.5:1.
 * The scanner button is the one `disabled` control (`locked` only — hud.ts), so its
 * dimmed state is exempt as an inactive control; its enabled states share the
 * audited tokens anyway. The dev-only `.gw-debug-*` panel is tooling, not game UI.
 *
 * Mutation-tested: reverting `--gw-invalid` to its pre-audit `#d2604f` fails
 * exactly the pairs below that use it (3.5:1 / 3.4:1), and dropping the surface
 * alpha back to 0.72 fails the structural pin before any ratio can lie. This is
 * the `stylesheet-integrity.test.ts` pattern: CSS has no compile step, so nothing
 * else catches this class of defect.
 */

const STYLESHEET = join(process.cwd(), 'src', 'style.css');

/** Authored backdrop facts, by value, each with its L4 source. */
const PANEL_RGB = [0x0c, 0x0e, 0x10] as const; // rgb(12 14 16 / …) — .gw-hud-surface &c.
const PANEL_ALPHA = 0.86; // pinned structurally below
const CANVAS_CLEAR = [0x1b, 0x1d, 0x20] as const; // three-renderer.ts clear colour / scene bg
const LAB_STEP = [0x8b, 0x93, 0x9c] as const; // lab-world.ts LAB_STEP — lightest floor
const CARRYABLE_TEAL = [0x5f, 0xb8, 0xa6] as const; // three-renderer.ts idle carryable

/** Text tokens that carry HUD copy, with the smallest size each is used at. */
const TOKEN_USES = {
  interactive: 13,
  muted: 10,
  unpowered: 12,
  compatible: 12,
  invalid: 12,
  hazardous: 12,
  complete: 12
} as const;

const AA_NORMAL_TEXT = 4.5;

function srgbToLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(rgb: readonly number[]): number {
  const c = [0, 1, 2].map((i) => srgbToLinear(rgb[i]!));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** Browser compositing: alpha blend in sRGB space, then decode. */
function blendOver(fg: readonly number[], alpha: number, under: readonly number[]): number[] {
  return [0, 1, 2].map((i) => fg[i]! * alpha + under[i]! * (1 - alpha));
}

function contrast(a: readonly number[], b: readonly number[]): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** The audited backdrops, computed once. */
const PANEL_OVER_STEP = blendOver(PANEL_RGB, PANEL_ALPHA, LAB_STEP);
const PANEL_OVER_TEAL = blendOver(PANEL_RGB, PANEL_ALPHA, CARRYABLE_TEAL);
const BARE_CLEAR = CANVAS_CLEAR; // alpha 1

/** Parse `--gw-*: #rrggbb;` declarations out of the `:root` block. */
function parseTokens(source: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const rootStart = source.indexOf(':root');
  const rootEnd = source.indexOf('}', rootStart);
  const root = source.slice(rootStart, rootEnd);
  for (const match of root.matchAll(/--gw-([a-z]+):\s*(#[0-9a-fA-F]{6})/g)) {
    tokens.set(match[1]!, match[2]!);
  }
  return tokens;
}

/** Slice one top-level rule out of the (flat) stylesheet — the nesting suite guarantees flatness. */
function ruleBlock(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return '';
  const end = source.indexOf('}', start);
  return source.slice(start, end);
}

function hexToRgb(hex: string): number[] {
  return [0, 2, 4].map((offset) => parseInt(hex.slice(1 + offset, 3 + offset), 16));
}

describe('HUD contrast — the §33 palette passes WCAG AA over its worst-case backdrops', () => {
  const source = (() => {
    const raw = readFileSync(STYLESHEET, 'utf8');
    return raw.replace(/\/\*[\s\S]*?\*\//g, '');
  })();
  const tokens = parseTokens(source);

  it('defines every token the audit reads', () => {
    // A subset, not an enumeration: `:root` also holds environment tokens
    // (--gw-graphite/--gw-steel/--gw-concrete, --gw-powered) that no HUD text uses.
    // What must never happen is an audited token vanishing or being renamed, which
    // would silently drop it from every ratio below.
    const missing = Object.keys(TOKEN_USES).filter((token) => !tokens.has(token));
    expect(missing).toEqual([]);
  });

  it('keeps the audited panel alpha authored (change it → re-audit, do not bypass)', () => {
    // The ratios below are computed against 0.86; a different alpha silently
    // invalidates them, so the value itself is pinned in both blocks that use it.
    expect(ruleBlock(source, '.gw-hud-surface')).toContain('rgb(12 14 16 / 86%)');
    expect(ruleBlock(source, '.gw-hud-toast')).toContain('rgb(12 14 16 / 86%)');
  });

  for (const [name, under] of [
    ['the lab step (lightest authored surface)', PANEL_OVER_STEP],
    ['a teal carryable behind the panel', PANEL_OVER_TEAL],
    ['the bare clear colour', BARE_CLEAR]
  ] as const) {
    it(`every text token clears AA over ${name}`, () => {
      for (const [token, size] of Object.entries(TOKEN_USES)) {
        const hex = tokens.get(token);
        expect(hex, `--gw-${token} is defined`).toBeDefined();
        const ratio = contrast(hexToRgb(hex!), under);
        const floor = size >= 24 ? 3 : AA_NORMAL_TEXT;
        expect(
          ratio,
          `--gw-${token} (${hex}) over this backdrop: ${ratio.toFixed(2)}:1, needs ${floor}:1 at ${size}px`
        ).toBeGreaterThanOrEqual(floor);
      }
    });
  }
});
