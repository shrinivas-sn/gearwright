# Gearwright

A third-person 3D mechanical puzzle game built with TypeScript, Three.js, and custom kinematic physics.
Restore power through physical gear trains, valve manifolds, and pressure networks in the Pressure Gallery.

**Live Game:** https://shrinivas-sn.github.io/gearwright/

## Controls

| Action | Key / Input |
|---|---|
| Move | W A S D |
| Run | Shift |
| Look | Mouse |
| Grab · use · confirm | E / Left click |
| Rotate held part | Q / F |
| Drop held part | R |
| Remove a mounted part | E, then E again |
| Hint | H |
| Pause · release mouse | Esc |

## Development

```bash
npm install        # Install dependencies
npm run dev        # Start local development server (http://localhost:5199)
npm test           # Run Vitest test suite (49 test files, 595 tests)
npm run typecheck  # TypeScript typecheck
npm run build      # Build production bundle to dist/
```

## Browser Verification Harness

The committed CDP harness runs headless Chrome scenarios against the game:

```bash
npm run check:browser -- <scenario>
```

Available scenarios: `boot`, `title`, `hold`, `focus`, `branch`, `bm1`, `press`.
Supports `--production` for local bundle checks and `--url=<URL>` for live deployment verification.

## Deployment

Deployments to GitHub Pages run automatically via GitHub Actions upon pushing to the `main` branch.

## Forge consumer (in progress)

A reward-material consumer was built on `main` in the 2026-10-27 session and left as the session's
continuation point: an additive upgrade projection (`src/game-state/upgrade-system.ts`), an upgrade
catalogue (`src/data/upgrades.ts`), a forge view and upgrade rows in the HUD (`src/presentation/
hud.ts`), a forge interactable on the hub (`src/levels/hub.ts`), and the runtime wiring (`src/main.
ts`, `src/gameplay/interaction-system.ts`, `src/gameplay/phase-world.ts`, the save codec and save
system). The live forge scenario passed end-to-end with `problems: []` before the session ended; the
full CI (typecheck, suite, build, `browser-check.mjs forge/branch/decoy`) is the next thing to run.
See [DOCS/STATUS.md](DOCS/STATUS.md) for the exact continuation point and the probe defect that was
patched mid-session.
