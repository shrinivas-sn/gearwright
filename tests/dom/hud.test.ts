import { describe, expect, it, vi } from 'vitest';

import {
  HUD_TOAST_LIFETIME_SECONDS,
  Hud,
  type HudSnapshot
} from '../../src/presentation/hud.ts';

/** A fully-populated snapshot; individual tests override the fields they exercise. */
function makeSnapshot(overrides: Partial<HudSnapshot> = {}): HudSnapshot {
  return {
    focus: {
      targetName: 'Primary Coil',
      verb: 'Grab',
      keyLabel: 'F',
      valid: true
    },
    manipulation: {
      heldName: 'Coil (copper)',
      rotateKey: 'Q',
      confirmKey: 'E',
      cancelKey: 'Esc',
      socketState: 'preview'
    },
    objective: {
      puzzleTitle: 'P1 — Power the gate',
      state: 'InProgress',
      failedText: 'The gate has no power source.'
    },
    resources: {
      partsHeld: 2,
      partsRequired: 4,
      materials: [{ kind: 'copper', count: 3 }],
      blueprints: []
    },
    log: {
      entries: [
        {
          id: 'clue/regulator-plate',
          title: 'Regulator Plate',
          text: 'PRESSURE FIRST.'
        }
      ]
    },
    hint: {
      level: 0,
      levelName: 'Environmental cue',
      text: null,
      keyLabel: 'H',
      scannerState: 'locked',
      scannerText: null
    },
    saveNote: null,
    entry: null,
    ...overrides
  };
}

function mountHud(): { root: HTMLDivElement; hud: Hud } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const hud = new Hud(root);
  return { root, hud };
}

describe('Hud — §33.1 read-model render', () => {
  it('renders every surface of a snapshot into the static skeleton', () => {
    const { root, hud } = mountHud();
    hud.render(makeSnapshot());

    expect(root.querySelector('.gw-hud-focus-name')?.textContent).toBe('Primary Coil');
    expect(root.querySelector('.gw-hud-focus-verb')?.textContent).toBe('Grab');
    expect(root.querySelector('.gw-hud-focus-key')?.textContent).toBe('F');
    expect(root.querySelector('.gw-hud-focus-validity')?.textContent).toBe('✓ compatible');

    expect(root.querySelector('.gw-hud-held')?.textContent).toBe('Coil (copper)');
    expect(root.querySelector('.gw-hud-socket-icon')?.textContent).toBe('◇');
    expect(root.querySelector('.gw-hud-socket-text')?.textContent).toContain('compatible');
    // Carrying: the strip's keys and socket verdict are live, so they are shown.
    expect(root.querySelector('.gw-hud-bindings')?.classList.contains('gw-hud-hidden')).toBe(false);
    expect(root.querySelector('.gw-hud-socket')?.classList.contains('gw-hud-hidden')).toBe(false);

    expect(root.querySelector('.gw-hud-objective-title')?.textContent).toBe('P1 — Power the gate');
    expect(root.querySelector('.gw-hud-objective-state')?.textContent).toBe('InProgress');
    expect(root.querySelector('.gw-hud-objective-failure-text')?.textContent).toBe(
      'The gate has no power source.'
    );

    expect(root.querySelector('.gw-hud-parts')?.textContent).toBe('Parts 2 / 4');
    expect(root.querySelector('.gw-hud-material')?.textContent).toContain('copper');

    expect(root.querySelector('.gw-hud-log-heading')?.textContent).toBe('Field log — 1 entry');
    expect(root.querySelector('.gw-hud-log-title')?.textContent).toBe('Regulator Plate');
    expect(root.querySelector('.gw-hud-log-text')?.textContent).toBe('PRESSURE FIRST.');
    expect(root.querySelector('.gw-hud-log')?.classList.contains('gw-hud-hidden')).toBe(false);

    expect(root.querySelector('.gw-hud-hint-level')?.textContent).toBe('L0 · Environmental cue');
    expect(root.querySelector('.gw-hud-hint-key')?.textContent).toBe('H');

    root.remove();
  });

  it('hides conditional lines when their value is null (never reads as a false negative)', () => {
    const { root, hud } = mountHud();
    hud.render(
      makeSnapshot({
        focus: { targetName: null, verb: null, keyLabel: null, valid: null },
        objective: { puzzleTitle: null, state: null, failedText: null },
        manipulation: {
          heldName: null,
          rotateKey: 'Q',
          confirmKey: 'E',
          cancelKey: 'Esc',
          socketState: 'none'
        },
        log: { entries: [] }
      })
    );

    // An empty log hides: "you have found nothing" is not "the world holds nothing".
    expect(root.querySelector('.gw-hud-log')?.classList.contains('gw-hud-hidden')).toBe(true);

    expect(root.querySelector('.gw-hud-focus-line')?.classList.contains('gw-hud-hidden')).toBe(true);
    expect(root.querySelector('.gw-hud-objective-failure')?.classList.contains('gw-hud-hidden')).toBe(
      true
    );
    expect(root.querySelector('.gw-hud-objective-title')?.textContent).toBe('No active puzzle');
    // Held is never hidden — an empty hand is a real state with a real label.
    expect(root.querySelector('.gw-hud-held')?.textContent).toBe('Empty-handed');
    // ...but rotate/confirm/cancel and the socket verdict are not a state, they are an
    // action's vocabulary: while nothing is held they describe keys the player is not
    // using (E is the *focus* line's grab) and a socket that cannot apply.
    expect(root.querySelector('.gw-hud-bindings')?.classList.contains('gw-hud-hidden')).toBe(true);
    expect(root.querySelector('.gw-hud-socket')?.classList.contains('gw-hud-hidden')).toBe(true);

    root.remove();
  });

  it('shows the manipulation keys only while carrying, and restores them on the next grab', () => {
    const { root, hud } = mountHud();
    const empty = {
      heldName: null,
      rotateKey: 'Q',
      confirmKey: 'E',
      cancelKey: 'Esc',
      socketState: 'none' as const
    };

    hud.render(makeSnapshot({ manipulation: empty }));
    expect(root.querySelector('.gw-hud-held')?.textContent).toBe('Empty-handed');
    expect(root.querySelector('.gw-hud-bindings')?.classList.contains('gw-hud-hidden')).toBe(true);

    // Carrying with nothing in reach: the keys apply (rotate/move) and the socket line
    // says so — that is the state the strip exists for.
    hud.render(makeSnapshot({ manipulation: { ...empty, heldName: 'Gear', socketState: 'none' } }));
    expect(root.querySelector('.gw-hud-held')?.textContent).toBe('Gear');
    expect(root.querySelector('.gw-hud-bindings')?.classList.contains('gw-hud-hidden')).toBe(false);
    expect(root.querySelector('.gw-hud-socket-text')?.textContent).toBe('No socket in range');

    // Dropping it again hides both, with the keys still sourced from the binding map.
    hud.render(makeSnapshot({ manipulation: empty }));
    expect(root.querySelector('.gw-hud-confirm-key')?.textContent).toBe('E');
    expect(root.querySelector('.gw-hud-bindings')?.classList.contains('gw-hud-hidden')).toBe(true);
    expect(root.querySelector('.gw-hud-socket')?.classList.contains('gw-hud-hidden')).toBe(true);

    root.remove();
  });

  it('shows hint text only at a non-zero ladder level and toggles validity classes', () => {
    const { root, hud } = mountHud();
    hud.render(makeSnapshot({ hint: { level: 1, levelName: 'Environmental cue', text: 'The gate is dark.', keyLabel: 'H', scannerState: 'locked', scannerText: null } }));
    expect(root.querySelector('.gw-hud-hint-text')?.textContent).toBe('The gate is dark.');
    expect(root.querySelector('.gw-hud-hint-text')?.classList.contains('gw-hud-hidden')).toBe(false);

    hud.render(makeSnapshot({ focus: { targetName: 'x', verb: null, keyLabel: null, valid: false } }));
    const validity = root.querySelector('.gw-hud-focus-validity');
    expect(validity?.textContent).toBe('✕ not compatible');
    expect(validity?.classList.contains('gw-hud-focus-validity--invalid')).toBe(true);

    root.remove();
  });

  it('is idempotent for an unchanged snapshot (change-only writes, §33.2 rule 5)', () => {
    const { root, hud } = mountHud();
    const snapshot = makeSnapshot();
    hud.render(snapshot);

    const materialRow = root.querySelector('.gw-hud-material');
    const partsBefore = root.querySelector('.gw-hud-parts')?.textContent;
    expect(materialRow).not.toBeNull();

    hud.render(snapshot);
    hud.render(snapshot);

    // Same DOM rows, same texts: no pooling churn, no rewrite.
    expect(root.querySelector('.gw-hud-material')).toBe(materialRow);
    expect(root.querySelectorAll('.gw-hud-material')).toHaveLength(1);
    expect(root.querySelector('.gw-hud-parts')?.textContent).toBe(partsBefore);

    root.remove();
  });
});

describe('Hud — pooled resource rows', () => {
  it('grows the pool on demand and hides (never removes) surplus rows', () => {
    const { root, hud } = mountHud();
    hud.render(
      makeSnapshot({
        resources: {
          partsHeld: 1,
          partsRequired: 1,
          materials: [
            { kind: 'copper', count: 3 },
            { kind: 'steel', count: 1 }
          ],
          blueprints: []
        }
      })
    );

    const rows = root.querySelectorAll('.gw-hud-material');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('copper');
    expect(rows[1]?.textContent).toContain('steel');

    // Down to one entry: the surplus row is hidden, still in the DOM (pooled).
    hud.render(
      makeSnapshot({
        resources: {
          partsHeld: 1,
          partsRequired: 1,
          materials: [{ kind: 'copper', count: 9 }],
          blueprints: []
        }
      })
    );
    expect(root.querySelectorAll('.gw-hud-material')).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('9');
    expect(rows[1]?.classList.contains('gw-hud-hidden')).toBe(true);

    root.remove();
  });

  it('pools blueprint rows the same way', () => {
    const { root, hud } = mountHud();
    hud.render(
      makeSnapshot({
        resources: {
          partsHeld: 0,
          partsRequired: 0,
          materials: [],
          blueprints: ['blueprint/scanner']
        }
      })
    );
    expect(root.querySelector('.gw-hud-blueprint')?.textContent).toBe('blueprint/scanner');

    hud.render(makeSnapshot());
    expect(root.querySelectorAll('.gw-hud-blueprint')).toHaveLength(1);
    expect(root.querySelector('.gw-hud-blueprint')?.classList.contains('gw-hud-hidden')).toBe(true);

    root.remove();
  });
});

describe('Hud — field log (§12.2 discovered clues)', () => {
  it('hides the surface while nothing is discovered, then reports the count it holds', () => {
    const { root, hud } = mountHud();
    hud.render(makeSnapshot({ log: { entries: [] } }));
    expect(root.querySelector('.gw-hud-log')?.classList.contains('gw-hud-hidden')).toBe(true);
    expect(root.querySelectorAll('.gw-hud-log-entry')).toHaveLength(0);

    hud.render(
      makeSnapshot({
        log: {
          entries: [
            { id: 'clue/a', title: 'First', text: 'one' },
            { id: 'clue/b', title: 'Second', text: 'two' }
          ]
        }
      })
    );
    expect(root.querySelector('.gw-hud-log')?.classList.contains('gw-hud-hidden')).toBe(false);
    expect(root.querySelector('.gw-hud-log-heading')?.textContent).toBe('Field log — 2 entries');
    expect(root.querySelectorAll('.gw-hud-log-entry')).toHaveLength(2);

    root.remove();
  });

  it('pools rows and hides surplus ones when the set shrinks (New Game)', () => {
    const { root, hud } = mountHud();
    hud.render(
      makeSnapshot({
        log: {
          entries: [
            { id: 'clue/a', title: 'First', text: 'one' },
            { id: 'clue/b', title: 'Second', text: 'two' }
          ]
        }
      })
    );
    const rows = root.querySelectorAll<HTMLElement>('.gw-hud-log-entry');
    expect(rows).toHaveLength(2);

    hud.render(makeSnapshot({ log: { entries: [{ id: 'clue/a', title: 'First', text: 'one' }] } }));
    // Same pooled elements, surplus hidden rather than removed.
    expect(root.querySelectorAll('.gw-hud-log-entry')).toHaveLength(2);
    expect(root.querySelector('.gw-hud-log-entry')).toBe(rows[0]);
    expect(rows[1]?.classList.contains('gw-hud-hidden')).toBe(true);

    // And a New Game (empty) hides the surface without emptying the pool.
    hud.render(makeSnapshot({ log: { entries: [] } }));
    expect(root.querySelector('.gw-hud-log')?.classList.contains('gw-hud-hidden')).toBe(true);
    expect(root.querySelectorAll('.gw-hud-log-entry')).toHaveLength(2);

    root.remove();
  });

  it('is unchanged-signature cheap and hides a wordless entry line', () => {
    const { root, hud } = mountHud();
    // An id whose content could not be resolved carries no words: the title line stays,
    // the text line is hidden rather than rendering an empty paragraph.
    hud.render(makeSnapshot({ log: { entries: [{ id: 'clue/ghost', title: 'clue/ghost', text: '' }] } }));
    const row = root.querySelector('.gw-hud-log-entry');
    const title = root.querySelector('.gw-hud-log-title');
    expect(title?.textContent).toBe('clue/ghost');
    expect(root.querySelector('.gw-hud-log-text')?.classList.contains('gw-hud-hidden')).toBe(true);

    hud.render(makeSnapshot({ log: { entries: [{ id: 'clue/ghost', title: 'clue/ghost', text: '' }] } }));
    expect(root.querySelector('.gw-hud-log-entry')).toBe(row);
    expect(root.querySelector('.gw-hud-log-title')).toBe(title);

    root.remove();
  });
});

describe('Hud — toasts (§33.1)', () => {
  it('appends a notice with kind data and written severity, never colour alone', () => {
    const { root, hud } = mountHud();
    hud.toast('Blueprint unlocked: scanner', 'info');

    const toast = root.querySelector('.gw-hud-toast');
    expect(toast).not.toBeNull();
    expect(toast?.getAttribute('data-kind')).toBe('info');
    expect(toast?.textContent).toContain('Info');
    expect(toast?.textContent).toContain('Blueprint unlocked: scanner');

    root.remove();
  });

  it('caps the visible buffer at four, dropping the oldest', () => {
    const { root, hud } = mountHud();
    for (let index = 0; index < 6; index += 1) hud.toast(`notice ${index}`);

    const toasts = root.querySelectorAll('.gw-hud-toast');
    expect(toasts).toHaveLength(4);
    expect(toasts[0]?.textContent).toContain('notice 2');
    expect(toasts[3]?.textContent).toContain('notice 5');

    root.remove();
  });

  it('expires toasts through update(dt) using the shared lifetime table', () => {
    const { root, hud } = mountHud();
    hud.toast('brief', 'info');

    // Just under the lifetime: still visible.
    hud.update(HUD_TOAST_LIFETIME_SECONDS.info - 0.5);
    expect(root.querySelectorAll('.gw-hud-toast')).toHaveLength(1);

    // Past it: gone.
    hud.update(1);
    expect(root.querySelectorAll('.gw-hud-toast')).toHaveLength(0);

    root.remove();
  });

  it('treats a non-finite or negative frame delta as zero elapsed time', () => {
    const { root, hud } = mountHud();
    hud.toast('stays', 'warn');

    hud.update(Number.NaN);
    hud.update(-1);
    expect(root.querySelectorAll('.gw-hud-toast')).toHaveLength(1);

    // It still expires normally afterwards — the bad frames simply did not count.
    hud.update(HUD_TOAST_LIFETIME_SECONDS.warn + 0.1);
    expect(root.querySelectorAll('.gw-hud-toast')).toHaveLength(0);

    root.remove();
  });
});

describe('Hud — intents out (§33.2 rule 2)', () => {
  it('reports hint requests from the button click', () => {
    const { root, hud } = mountHud();
    const onHint = vi.fn();
    hud.onHintRequest(onHint);

    hud.render(makeSnapshot());
    root.querySelector<HTMLButtonElement>('.gw-hud-hint-button')?.click();

    expect(onHint).toHaveBeenCalledTimes(1);

    root.remove();
  });

  it('keeps the scanner locked until the blueprint exists, then reports its intent', () => {
    const { root, hud } = mountHud();
    const onScanner = vi.fn();
    hud.onScannerRequest(onScanner);
    const button = root.querySelector<HTMLButtonElement>('.gw-hud-scanner-button');

    hud.render(makeSnapshot());
    expect(button?.disabled).toBe(true);
    expect(button?.classList.contains('gw-hud-scanner--locked')).toBe(true);
    expect(button?.textContent).toContain('blueprint');

    hud.render(
      makeSnapshot({
        hint: {
          level: 0,
          levelName: 'Environmental cue',
          text: null,
          keyLabel: 'H',
          scannerState: 'ready',
          scannerText: null
        }
      })
    );
    expect(button?.disabled).toBe(false);
    expect(button?.classList.contains('gw-hud-scanner--locked')).toBe(false);
    expect(button?.textContent).toContain('Scanner ready');
    button?.click();
    expect(onScanner).toHaveBeenCalledTimes(1);

    root.remove();
  });

  it('spells out the scanner reveal and its cooldown, so a refusal is never silent (§29.2)', () => {
    const { root, hud } = mountHud();
    const button = root.querySelector<HTMLButtonElement>('.gw-hud-scanner-button');
    const text = root.querySelector('.gw-hud-scanner-text');

    // Scanning: the button says so, and the line carries the revealed requirement's words.
    hud.render(
      makeSnapshot({
        hint: {
          level: 0,
          levelName: 'Environmental cue',
          text: null,
          keyLabel: 'H',
          scannerState: 'scanning',
          scannerText: 'Bridge the two shafts: mount the gear in the mesh socket.'
        }
      })
    );
    expect(button?.textContent).toContain('Scanning');
    expect(button?.classList.contains('gw-hud-scanner--scanning')).toBe(true);
    expect(button?.disabled).toBe(false);
    expect(text?.classList.contains('gw-hud-hidden')).toBe(false);
    expect(text?.textContent).toContain('Bridge the two shafts');

    // Cooling: the same button reads as recharging, and the reveal line goes away.
    hud.render(
      makeSnapshot({
        hint: {
          level: 0,
          levelName: 'Environmental cue',
          text: null,
          keyLabel: 'H',
          scannerState: 'cooling',
          scannerText: null
        }
      })
    );
    expect(button?.textContent).toContain('recharging');
    expect(button?.classList.contains('gw-hud-scanner--cooling')).toBe(true);
    expect(text?.classList.contains('gw-hud-hidden')).toBe(true);

    root.remove();
  });
});

describe('Hud — entry pointer guidance (Bug 21)', () => {
  it('stays hidden while no guidance is owed', () => {
    const { root, hud } = mountHud();
    hud.render(makeSnapshot({ entry: null }));

    expect(root.querySelector('.gw-hud-entry')?.classList.contains('gw-hud-hidden')).toBe(true);
    root.remove();
  });

  it('names the click-to-capture contract before the mouse is captured', () => {
    const { root, hud } = mountHud();
    hud.render(makeSnapshot({ entry: { pointerLocked: false, pointerLockUnavailable: false } }));

    const line = root.querySelector('.gw-hud-entry');
    expect(line?.classList.contains('gw-hud-hidden')).toBe(false);
    expect(line?.textContent).toContain('capture the mouse');
    root.remove();
  });

  it('falls back to the no-capture wording when the browser refused the lock', () => {
    const { root, hud } = mountHud();
    hud.render(makeSnapshot({ entry: { pointerLocked: false, pointerLockUnavailable: true } }));

    const line = root.querySelector('.gw-hud-entry');
    expect(line?.classList.contains('gw-hud-hidden')).toBe(false);
    expect(line?.textContent).toContain('without mouse capture');
    root.remove();
  });

  it('hides the moment the capture is live, and never comes back on a steady render', () => {
    const { root, hud } = mountHud();
    hud.render(makeSnapshot({ entry: { pointerLocked: true, pointerLockUnavailable: false } }));
    expect(root.querySelector('.gw-hud-entry')?.classList.contains('gw-hud-hidden')).toBe(true);

    // Same snapshot again: the change-only writer must not un-hide or rewrite it.
    hud.render(makeSnapshot({ entry: { pointerLocked: true, pointerLockUnavailable: false } }));
    expect(root.querySelector('.gw-hud-entry')?.classList.contains('gw-hud-hidden')).toBe(true);
    root.remove();
  });
});

describe('Hud — no injected markup (§33.2)', () => {
  it('renders a hostile string as text, never as markup', () => {
    const { root, hud } = mountHud();
    const hostile = '<img src=x onerror="window.__pwned=1">';
    hud.render(
      makeSnapshot({
        focus: { targetName: hostile, verb: null, keyLabel: null, valid: null },
        objective: { puzzleTitle: hostile, state: null, failedText: hostile },
        log: { entries: [{ id: 'clue/x', title: hostile, text: hostile }] }
      })
    );
    hud.toast(hostile, 'warn');

    expect(root.querySelectorAll('img')).toHaveLength(0);
    expect(root.querySelector('.gw-hud-focus-name')?.textContent).toBe(hostile);
    expect(root.querySelector('.gw-hud-objective-failure-text')?.textContent).toBe(hostile);
    expect(root.querySelector('.gw-hud-log-title')?.textContent).toBe(hostile);
    expect(root.querySelector('.gw-hud-log-text')?.textContent).toBe(hostile);
    expect(root.querySelector('.gw-hud-toast-text')?.textContent).toBe(hostile);

    root.remove();
  });
});

describe('Hud — overhaul T1.1 bindings', () => {
  it('shows the second rotate key and the drop key when provided, hides them when absent', () => {
    const root = document.createElement('div');
    const hud = new Hud(root);
    hud.render(makeSnapshot({ manipulation: { heldName: 'Gear', rotateKey: 'Q', rotateRightKey: 'F', dropKey: 'R', confirmKey: 'E', cancelKey: 'Esc', socketState: 'none' } }));
    expect(root.querySelector('.gw-hud-rotate-right-key')?.textContent).toBe('F');
    expect(root.querySelector('.gw-hud-drop-key')?.textContent).toBe('R');
    expect(root.querySelector('.gw-hud-drop-binding')?.classList.contains('gw-hud-hidden')).toBe(false);
    hud.render(makeSnapshot({ manipulation: { heldName: 'Gear', rotateKey: 'Q', confirmKey: 'E', cancelKey: 'Esc', socketState: 'none' } }));
    expect(root.querySelector('.gw-hud-drop-binding')?.classList.contains('gw-hud-hidden')).toBe(true);
  });
});
