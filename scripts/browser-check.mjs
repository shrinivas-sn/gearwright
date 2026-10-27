/**
 * Local browser verification harness (committed tooling; not part of the build, not run in CI).
 *
 * Drives the *shipped* dev build in headless Chrome over CDP and reports what the
 * composition actually does: boot logs, HUD read-outs, focus acquisition from real
 * vantages, a played BM-1 sequence, console errors, and §36 budget numbers.
 *
 * Usage: node scripts/browser-check.mjs [boot|title|focus|hold|press|arms|dock|crucible|decoy|forge|bm1|branch|b2audit] [--production]
 */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = process.cwd();
const SCENARIO = process.argv[2] ?? 'boot';
const PRODUCTION = process.argv.includes('--production');
const URL_ARG = process.argv.find((arg) => arg.startsWith('--url='))?.slice('--url='.length) ?? null;
// Ports and profile are overridable so two scenarios can run at once: a long scenario (the
// full branch curve) and a short one (a single dock check) on separate dev/Chrome ports,
// instead of queueing behind each other.
const DEV_PORT = Number(process.env.HARNESS_DEV_PORT ?? 5199);
const PREVIEW_PORT = Number(process.env.HARNESS_PREVIEW_PORT ?? 5198);
const DEBUG_PORT = Number(process.env.HARNESS_DEBUG_PORT ?? 9333);
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = join(ROOT, process.env.HARNESS_PROFILE ?? '.tmp-chrome-profile');
// Harness URL flags: shoulder camera off (aim math assumes the camera looks through the
// player), no title screen, game logs on even in production builds. HARNESS_BODY=proc drives the
// body flag too, so the procedural fallback can be verified live instead of assumed.
// HARNESS_GUNS=0 flips the weapons pass off (`?guns=0`), which is how the pre-pass game is
// verified from the same script: the flag restores the game exactly as it was before the
// 16/10 weapons pass. Unset = the shipped default (weapons on).
const QUERY = `?shoulder=0&skipTitle=1&log=1${process.env.HARNESS_BODY ? `&body=${process.env.HARNESS_BODY}` : ''}${process.env.HARNESS_GUNS ? `&guns=${process.env.HARNESS_GUNS}` : ''}`;
const BASE = URL_ARG !== null ? URL_ARG.replace(/\/?$/, '/') + QUERY : (PRODUCTION ? `http://127.0.0.1:${PREVIEW_PORT}/` : `http://127.0.0.1:${DEV_PORT}/`) + QUERY;

const report = { scenario: SCENARIO, production: PRODUCTION, logs: [], problems: [], data: {} };
const children = [];

function log(message) {
  console.log(message);
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return true;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  return false;
}

function startProcess(command, args, label) {
  const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.stdout.on('data', (chunk) => {
    const text = String(chunk);
    if (/error|failed/i.test(text)) log(`[${label}] ${text.trim()}`);
  });
  child.stderr.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text && !/^$/.test(text)) log(`[${label}!] ${text}`);
  });
  return child;
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      this.events.push(message);
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function connect() {
  const deadline = Date.now() + 20000;
  let target = null;
  while (Date.now() < deadline && target === null) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = list.find((entry) => entry.type === 'page') ?? null;
    } catch {
      /* not up yet */
    }
    if (target === null) await sleep(200);
  }
  if (target === null) throw new Error('no page target on the debugging port');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', () => reject(new Error('websocket failed')));
  });
  return new Cdp(socket);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) {
    throw new Error(
      `page exception: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`
    );
  }
  return result.result.value;
}

const KEYS = {
  KeyW: ['w', 87],
  KeyA: ['a', 65],
  KeyS: ['s', 83],
  KeyD: ['d', 68],
  KeyE: ['e', 69],
  KeyQ: ['q', 81],
  KeyR: ['r', 82],
  KeyH: ['h', 72],
  KeyB: ['b', 66],
  KeyC: ['c', 67],
  Digit1: ['1', 49],
  Digit2: ['2', 50],
  Digit3: ['3', 51],
  Digit4: ['4', 52],
  Digit5: ['5', 53],
  Escape: ['Escape', 27],
  F3: ['F3', 114]
};

async function keyDown(cdp, code) {
  const [key, vk] = KEYS[code];
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    code,
    key,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk
  });
}

async function keyUp(cdp, code) {
  const [key, vk] = KEYS[code];
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    code,
    key,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk
  });
}

async function tapKey(cdp, code) {
  await keyDown(cdp, code);
  await sleep(60);
  await keyUp(cdp, code);
  await sleep(120);
}

/**
 * Hold a mouse button down (weapons pass). A gun's trigger is an edge *and* a hold: a
 * semi-auto weapon fires on the press, an automatic one keeps firing while it is held, so
 * the harness needs a real down/up pair rather than `clickAt`'s single frame.
 */
async function mouseDown(cdp, button = 'left', x = 800, y = 450) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
    buttons: 0
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button,
    buttons: button === 'right' ? 2 : 1,
    clickCount: 1
  });
}

async function mouseUp(cdp, button = 'left', x = 800, y = 450) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button,
    buttons: 0,
    clickCount: 1
  });
}

async function clickAt(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
    buttons: 0
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await sleep(50);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
}

const PROBE_SOURCE = `
window.__probe = {
  canvas: document.getElementById('game-canvas'),
  ready: () => typeof window.__gearwrightDev === 'object' && window.__gearwrightDev !== null,
  state: () => {
    const dev = window.__gearwrightDev;
    const player = dev.player.snapshot();
    return {
      pos: player.position,
      grounded: player.grounded,
      crouched: player.crouched,
      speed: player.speed,
      walkSpeed: player.walkSpeed,
      facingYaw: player.facingYaw,
      yaw: dev.camera.currentYaw,
      eye: dev.camera.snapshot().eye,
      focus: dev.interaction.focus ? { id: dev.interaction.focus.id, kind: dev.interaction.focus.kind, verb: dev.interaction.focus.verb, distance: dev.interaction.focus.distance } : null,
      pointerLocked: document.pointerLockElement !== null && document.pointerLockElement !== undefined,
      canvasFocused: document.activeElement === document.getElementById('game-canvas'),
      lifecycle: window.__gearwright ? window.__gearwright.snapshot().lifecycle : null,
      loop: window.__gearwright ? window.__gearwright.snapshot().loop : null
    };
  },
  /**
   * The live derived machine state (ARCH §23.4). The Crucible's ceiling is a property of the
   * *graph*, which exists whether or not §25 has unlocked the branch's puzzles — so a check
   * can prove a machine's warnings before the player is allowed to play it.
   */
  machine: (machineId) => {
    const dev = window.__gearwrightDev;
    if (dev === undefined || dev === null || typeof dev.machineState !== 'function') return null;
    return dev.machineState(machineId);
  },
  /** §25's own read (state + failed requirement ids) — a live refusal, not a graph guess. */
  puzzle: (puzzleId) => {
    const dev = window.__gearwrightDev;
    if (dev === undefined || dev === null || typeof dev.puzzle !== 'function') return null;
    return dev.puzzle(puzzleId);
  },
  /**
   * Walk a puzzle through the SM's own unlock()/begin() calls (dev-only). A fresh save keeps
   * every branch puzzle Locked, and a gated puzzle publishes no reasons — so this is how a
   * browser check can read the refusal line a player reaches after the branch has opened.
   * It changes no rule: it is the same pair syncBranchAccess calls.
   */
  puzzleOpen: (puzzleId) => {
    const dev = window.__gearwrightDev;
    if (dev === undefined || dev === null || typeof dev.puzzleOpen !== 'function') return null;
    return dev.puzzleOpen(puzzleId);
  },
  /** Dev-only: seed materials so the §28 forge can be driven without eleven milestones. */
  grantMaterials: (counts) => {
    const dev = window.__gearwrightDev;
    if (dev === undefined || dev === null || typeof dev.grantMaterials !== 'function') return null;
    return dev.grantMaterials(counts);
  },
  /** The §28 pipeline's live read: levels, the next offer, and the two derived effects. */
  upgrades: () => {
    const dev = window.__gearwrightDev;
    if (dev === undefined || dev === null || typeof dev.readUpgrades !== 'function') return null;
    return dev.readUpgrades();
  },
  hud: () => {
    const text = (selector) => {
      const element = document.querySelector(selector);
      if (element === null) return null;
      return { text: element.textContent, hidden: element.classList.contains('gw-hud-hidden') };
    };
    return {
      focusName: text('.gw-hud-focus-name'),
      focusVerb: text('.gw-hud-focus-verb'),
      held: text('.gw-hud-held'),
      socket: text('.gw-hud-socket-text'),
      bindingsHidden: document.querySelector('.gw-hud-bindings')?.classList.contains('gw-hud-hidden') ?? null,
      objectiveTitle: text('.gw-hud-objective-title'),
      objectiveState: text('.gw-hud-objective-state'),
      upgradeRows: Array.from(document.querySelectorAll('.gw-hud-upgrade')).map((row) => ({
        text: row.textContent,
        hidden: row.classList.contains('gw-hud-hidden')
      })),
      objectiveFailure: text('.gw-hud-objective-failure-text'),
      objectiveMeter: text('.gw-hud-objective-meter'),
      objectiveMeterOver:
        document.querySelector('.gw-hud-objective-meter')?.classList.contains('gw-hud-objective-meter--over') ?? null,
      parts: text('.gw-hud-parts'),
      hintLevel: text('.gw-hud-hint-level'),
      scannerLabel: text('.gw-hud-scanner-label'),
      scannerText: text('.gw-hud-scanner-text'),
      logHeading: text('.gw-hud-log-heading'),
      logText: text('.gw-hud-log-text'),
      entryLine: text('.gw-hud-entry'),
      toasts: [...document.querySelectorAll('.gw-hud-toast')].map((node) => node.textContent)
    };
  },
  teleport: (x, y, z) => {
    window.__gearwrightDev.player.teleport({ x, y, z });
  },
  look: (dx, dy) => {
    const event = new MouseEvent('mousemove', { bubbles: true });
    Object.defineProperty(event, 'movementX', { value: dx });
    Object.defineProperty(event, 'movementY', { value: dy });
    window.__probe.canvas.dispatchEvent(event);
  },
  /**
   * Look deltas are clamped to maxLookDeltaPerStep (120 px) by the input system, so a
   * large rotation must be delivered in chunks ACROSS STEPS — one chunk per rendered
   * frame, each consumed by that frame's fixed step.
   */
  lookBy: async (dx, dy) => {
    const dev = window.__gearwrightDev;
    const carrying = () => dev.manipulation?.heldId !== null && dev.manipulation?.heldId !== undefined;
    // While carrying, a fast look sweeps the 1.35 m carry lead along an arc the part
    // cannot follow: it closes maxLinearSpeed (8 m/s) per fixed step, so a 1 rad chunk
    // moves the target ~1.35 m instantly and past maxHoldRange (2.6 m) the part is
    // soft-detached (EC-MAN-07) mid-sweep — which is what kept killing the B2 and BM-2
    // docks. Carrying therefore turns in small chunks, each followed by a wait for the
    // part to come abreast again; empty-handed looking is unchanged (119 px, the input
    // system's own per-step clamp).
    const maxChunk = carrying() ? 24 : 119;
    const steps = Math.max(Math.ceil(Math.abs(dx) / maxChunk), Math.ceil(Math.abs(dy) / maxChunk), 1);
    for (let i = 0; i < steps; i += 1) {
      window.__probe.look(dx / steps, dy / steps);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      for (let frame = 0; frame < 20 && carrying(); frame += 1) {
        const pose = dev.manipulation.currentPose;
        if (pose === null || pose === undefined) break;
        const player = dev.player.snapshot().position;
        if (Math.hypot(pose.center.x - player.x, pose.center.z - player.z) <= 2.1) break;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
  },
  /** Yaw integrates as yaw - dX * 0.25 * (1/30)  →  dX = -radians * 120. */
  aimYaw: async (targetYaw) => {
    let delta = targetYaw - window.__gearwrightDev.camera.currentYaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    // Sweep past the target and back: the exponential target-blend means a single
    // equal-and-opposite pair can settle yaw-visible short of targetYaw, and the
    // leftover from one vantage attempt contaminates the next.
    await window.__probe.lookBy(-delta * 120 - 36, 0);
    await window.__probe.lookBy(36, 0);
  },
  /**
   * Pitch has no getter: slam it on the clamp, then move a known distance from there.
   * The slam only needs to exceed the widest possible travel — the full clamp span
   * (1.65 rad) is ~275 px at 0.006 rad/px — so 600 px guarantees the clamp in 6 chunked
   * frames. (A 100_000 px slam is *correct* but grinds through ~840 fixed steps, one
   * per rendered frame, ~28 s per aim — which is what stalled the first bm1 run.)
   */
  /**
   * The shipped static colliders, for path planning.
   *
   * The harness moves the player by teleport, which has no notion of collision: hopping a
   * held part straight at a socket used to send the player *through* a machine post, and
   * the physics resolved the overlapping capsule downwards — through the floor (a hop trace
   * caught the player at y = -1.9 with the part left 26 m behind). Planning a route around
   * the level's own colliders is the fix, so the same world the game collides with is read
   * here (hub doors taken as open: every branch the harness drives is enterable).
   */
  staticColliders: async () => {
    if (window.__probe.__colliders !== undefined) return window.__probe.__colliders;
    if (window.__probe.sourceAvailable === false) {
      // Do not even *ask* for the module: a failed dynamic import still logs a network 404,
      // and the harness counts browser log errors as problems (correctly — which is exactly
      // why the harness must not manufacture one).
      window.__probe.__colliderNote = 'route planning unavailable (no TypeScript sources served here)';
      window.__probe.__colliders = null;
      return null;
    }
    try {
      const shipped = await import('/src/levels/shipped-content.ts');
      const hub = await import('/src/levels/hub.ts');
      const branchB = await import('/src/levels/branch-b.ts');
      const branchC = await import('/src/levels/branch-c.ts');
      window.__probe.__colliders = [
        ...shipped.SHIPPED_WORLD.colliders,
        ...hub.hubColliders(() => 'Complete'),
        ...branchB.BRANCH_B_WORLD.colliders,
        // Branch C's room sits east of the Steam Works; without its structure the planner
        // would route the player through plinths and wall posts it cannot see.
        ...branchC.BRANCH_C_WORLD.colliders
      ];
    } catch (error) {
      // A production build serves dist/, where the TypeScript sources do not exist — and
      // route planning is a *harness* convenience (it exists so a teleport cannot land inside
      // a machine post), so its absence is a limitation of the check, never a game defect.
      // Returning null says "unknown", which the callers treat conservatively: findPath
      // answers "no route" and segmentClear "not clear", so hopping falls back to the
      // straight line plus the rollback, exactly as it did before planning existed.
      window.__probe.__colliderNote = 'route planning unavailable (' + String(error).slice(0, 90) + ')';
      window.__probe.__colliders = null;
    }
    return window.__probe.__colliders;
  },
  /** Why route planning is unavailable, or null when it is fine (for the report). */
  colliderNote: () => window.__probe.__colliderNote ?? null,
  /**
   * The height a hop should place the player at over (x, z): the highest collider top whose
   * footprint covers the point and that is reachable from fromY (within the capsule's
   * step height), or null when there is nothing there to stand on.
   *
   * Hops used to teleport to a flat y = 0.01. That only worked because the physics reported
   * "supported" for a pose with nothing under it — a bug fixed on 17/10/2026 — so a spot
   * inside a plinth, or past a floor edge, floated the player up instead of dropping them.
   * With gravity working, such a teleport *falls*, the held part soft-detaches (EC-MAN-07)
   * once the player is more than maxHoldRange (2.6 m) below it, and the whole dock attempt
   * is lost — a tooling artefact that reads exactly like a game defect. Placing the player
   * on the height the level actually has is the same fix the route planner got (issue #8).
   */
  standingHeightAt: async (x, z, fromY) => {
    const list = await window.__probe.staticColliders();
    if (list === null) return null;
    const reach = (Number.isFinite(fromY) ? fromY : 0) + 0.45;
    let best = null;
    for (const box of list) {
      if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) continue;
      if (box.max.y > reach) continue;
      if (best === null || box.max.y > best) best = box.max.y;
    }
    return best;
  },
  /**
   * A walkable route from (ax, az) to (bx, bz), on a 0.5 m grid over the hall and the
   * Steam Works, using the same static colliders the player collides with.
   *
   * Straight-line hopping is not enough: B2's steam port sits in a pocket walled by the
   * gauge post and the boiler plinth, so the direct line from the part's spawn crosses a
   * plinth — and a teleport that lands inside one sends the player *through the floor*.
   * A breadth-first search over the free cells fixes that generally: it routes around
   * whatever the level has (posts, plinths, the Regulator, walls) and returns the corner
   * list to hop through. Returns null when no route exists.
   */
  findPath: async (ax, az, bx, bz) => {
    const list = await window.__probe.staticColliders();
    if (list === null) return null; // the colliders are unknown here: do not invent a route
    const half = 0.36; // the player capsule's own half-width: what actually fits
    const step = 0.5;
    const minX = -9;
    // The grid reaches the Great Crucible's east wall (x = 24) as well as the hall and the
    // Steam Works; the old 9 m bound made every vantage in Branch C fall back to a straight
    // line, which teleports through whatever stands between (including a closed door).
    const maxX = 25;
    const minZ = -20;
    const maxZ = 35;
    const nx = Math.round((maxX - minX) / step) + 1;
    const nz = Math.round((maxZ - minZ) / step) + 1;
    const blocked = new Uint8Array(nx * nz);
    for (let iz = 0; iz < nz; iz += 1) {
      for (let ix = 0; ix < nx; ix += 1) {
        const x = minX + ix * step;
        const z = minZ + iz * step;
        for (const box of list) {
          if (box.max.y <= 0.25) continue;
          if (x + half > box.min.x && x - half < box.max.x && z + half > box.min.z && z - half < box.max.z) {
            blocked[iz * nx + ix] = 1;
            break;
          }
        }
      }
    }
    const cellOf = (x, z) => [Math.round((x - minX) / step), Math.round((z - minZ) / step)];
    const worldOf = (ix, iz) => [minX + ix * step, minZ + iz * step];
    const free = (ix, iz) => ix >= 0 && iz >= 0 && ix < nx && iz < nz && blocked[iz * nx + ix] === 0;
    // A vantage can stand hard against a plinth (a socket next to its machine): fall back
    // to the nearest free cell, so "almost there" still plans.
    let [gx, gz] = cellOf(bx, bz);
    if (!free(gx, gz)) {
      let best = null;
      for (let radius = 1; radius <= 6 && best === null; radius += 1) {
        for (let dz = -radius; dz <= radius && best === null; dz += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
            if (!free(gx + dx, gz + dz)) continue;
            best = [gx + dx, gz + dz];
            break;
          }
        }
      }
      if (best === null) return null;
      [gx, gz] = best;
    }
    const [sx, sz] = cellOf(ax, az);
    if (!free(sx, sz)) return null;
    const start = sz * nx + sx;
    const goal = gz * nx + gx;
    const cameFrom = new Int32Array(nx * nz).fill(-1);
    const queue = [start];
    cameFrom[start] = start;
    let found = false;
    for (let head = 0; head < queue.length && !found; head += 1) {
      const current = queue[head];
      const cx = current % nx;
      const cz = Math.floor(current / nx);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nxi = cx + dx;
        const nzi = cz + dz;
        if (!free(nxi, nzi)) continue;
        const next = nzi * nx + nxi;
        if (cameFrom[next] !== -1) continue;
        cameFrom[next] = current;
        if (next === goal) {
          found = true;
          break;
        }
        queue.push(next);
      }
    }
    if (!found && start !== goal) return null;
    const cells = [];
    let cursor = goal;
    while (cursor !== start) {
      cells.push(cursor);
      cursor = cameFrom[cursor];
    }
    cells.reverse();
    // Every third cell keeps the polyline short; the hop loop still moves in 0.4 m steps.
    const points = cells.filter((_, index) => index % 3 === 0 || index === cells.length - 1).map((cell) => worldOf(cell % nx, Math.floor(cell / nx)));
    points.push([bx, bz]);
    return [points[0] ?? [bx, bz], ...points];
  },
  /**
   * Is a player-height corridor from (ax, az) to (bx, bz) clear of static geometry?
   * Sampled every 0.25 m with a 0.45 m half-width (player capsule + margin). Boxes whose
   * top is at or below 0.25 m are steps, not walls — the floor and plinths are walkable.
   */
  segmentClear: async (ax, az, bx, bz) => {
    const list = await window.__probe.staticColliders();
    if (list === null) return false; // unknown geometry is not a corridor to walk down
    const half = 0.45;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
    for (let i = 0; i <= steps; i += 1) {
      const x = ax + ((bx - ax) * i) / steps;
      const z = az + ((bz - az) * i) / steps;
      for (const box of list) {
        if (box.max.y <= 0.25) continue;
        if (x + half > box.min.x && x - half < box.max.x && z + half > box.min.z && z - half < box.max.z) return false;
      }
    }
    return true;
  },
  /**
   * Carry-safe relocation. EC-MAN-07 soft-detaches a held part that ends a step more
   * than maxHoldRange (2.6 m) from the player, and the part can only close
   * maxLinearSpeed (9 m/s ≈ 0.30 m per fixed step since the 17/10/2026 carry pass) — so
   * one long teleport leaves the part metres behind and drops it (what killed the valve's
   * first dock attempt).
   *
   * Three things make the hop survivable: 0.4 m steps, a wait after each step until the
   * part has come abreast again, and a **route around the level's colliders** — the
   * straight line is used when it is clear, otherwise an L-route through one of the two
   * corners. A hop that still lands the player inside geometry (y below the floor) is
   * rolled back to the last good spot and reported as a false return, so the caller can
   * try another vantage instead of carrying on from inside a wall.
   */
  hopTo: async (x, z, yaw) => {
    const dev = window.__gearwrightDev;
    const start = dev.player.snapshot().position;
    const trace = [];
    window.__probe.hopTrace = trace;
    const sample = (hop) => {
      const pose = dev.manipulation.currentPose;
      const player = dev.player.snapshot().position;
      const yaw = dev.camera.currentYaw;
      trace.push({
        hop,
        held: dev.manipulation.heldId ?? null,
        dist:
          pose === null || pose === undefined
            ? null
            : Number(
                Math.hypot(pose.center.x - player.x, pose.center.y - player.y, pose.center.z - player.z).toFixed(2)
              ),
        // The part's own pose and the hold target the follow is chasing: a part that stops
        // moving while the player walks is a blocked follow, and only these two make that
        // readable from the trace instead of inferred from the gap.
        part:
          pose === null || pose === undefined
            ? null
            : {
                x: Number(pose.center.x.toFixed(2)),
                y: Number(pose.center.y.toFixed(2)),
                z: Number(pose.center.z.toFixed(2))
              },
        blocked:
          (dev.manipulation.snapshots() ?? []).find((row) => row.id === dev.manipulation.heldId)?.blocked ?? null,
        player: { x: Number(player.x.toFixed(2)), y: Number(player.y.toFixed(2)), z: Number(player.z.toFixed(2)) },
        yaw: Number(yaw.toFixed(2))
      });
    };
    // Route through the level's own free space. The straight line is the fallback when no
    // grid route exists at all (a start or goal boxed in), and the rollback below is the
    // last line of defence for that case.
    const planned = await window.__probe.findPath(start.x, start.z, x, z);
    const waypoints = [[start.x, start.z], ...(planned ?? [[x, z]])];
    let lastGood = { x: start.x, z: start.z };
    for (let leg = 1; leg < waypoints.length; leg += 1) {
      const [ax, az] = waypoints[leg - 1];
      const [bx, bz] = waypoints[leg];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4));
      for (let i = 1; i <= steps; i += 1) {
        const tx = ax + ((bx - ax) * i) / steps;
        const tz = az + ((bz - az) * i) / steps;
        // Stand on the height the level has here, not at a flat 0.01 above its floor: with
        // gravity working (17/10/2026) a teleport into a pocket falls and drops the part.
        const ground = await window.__probe.standingHeightAt(tx, tz, start.y);
        dev.player.teleport({ x: tx, y: (ground === null ? 0.01 : ground + 0.002), z: tz });
        if (yaw !== undefined) await window.__probe.aimYaw(yaw);
        for (let frame = 0; frame < 30 && dev.manipulation.heldId !== null; frame += 1) {
          const pose = dev.manipulation.currentPose;
          if (pose === null || pose === undefined) break;
          const player = dev.player.snapshot().position;
          if (Math.hypot(pose.center.x - player.x, pose.center.z - player.z) <= 2.1) break;
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        await new Promise((resolve) => setTimeout(resolve, 60));
        sample(leg + ':' + i);
        const now = dev.player.snapshot().position;
        if (now.y < -0.2) {
          // The teleport landed inside geometry and the physics resolved the capsule
          // downwards, out through the floor (a trace once caught the player at y = -1.9).
          // Roll back to the last good spot and let the caller choose another vantage.
          const back = await window.__probe.standingHeightAt(lastGood.x, lastGood.z, start.y);
          dev.player.teleport({ x: lastGood.x, y: (back === null ? 0.01 : back + 0.002), z: lastGood.z });
          await new Promise((resolve) => setTimeout(resolve, 120));
          trace.push({
            hop: 'rollback',
            at: { x: Number(now.x.toFixed(2)), y: Number(now.y.toFixed(2)), z: Number(now.z.toFixed(2)) }
          });
          return false;
        }
        lastGood = { x: now.x, z: now.z };
        // No early exit here: an *empty-handed* hop used to break out of the step loop after
        // the first 0.4 m chunk, so a check that walked the player somewhere without carrying
        // anything silently stayed near where it started (it reported entered/ok while still
        // at the spawn pose). The wait loop above already handles a held part; the movement
        // itself is the same either way.
      }
    }
    return true;
  },
  /**
   * 'pitch' here is a *view* angle — positive looks DOWN, the sign the aim math computes
   * (atan2(1.4 - centre.y, h)) — while the rig stores the eye's elevation offset, which
   * is the opposite sign (CameraRig.placeAndCollide: direction.y = -sin(pitch)).
   * The vertical look axis is inverted by design (15/10/2026), so a *positive*
   * movementY pitches the view UP: 'pitchHome' parks the rig on its min clamp (-1.1)
   * with -600 px, and driving the rig back to -pitch is 1.1 - pitch of rig travel,
   * i.e. (1.1 - pitch) / 0.006 pixels.
   *
   * NOTE: this whole probe is one template literal in the harness. A backtick anywhere in
   * here — even inside a comment — ends the template and breaks the harness at parse time.
   */
  pitchHome: async () => window.__probe.lookBy(0, -600),
  pitchTo: async (pitch) =>
    window.__probe.lookBy(0, Math.max(-600, Math.min(600, (1.1 - pitch) / 0.006))),
  stats: () => {
    const overlay = document.getElementById('debug-root');
    return { overlay: overlay ? overlay.textContent : null, memory: performance.memory ? performance.memory.usedJSHeapSize : null };
  },
  /**
   * The player's body: bone count, drawn triangles, visibility and where it stands. Read live,
   * so the boot scenario can prove the rig is built, drawn and standing on the simulation's own
   * position rather than trusting a screenshot.
   */
  character: () => {
    const dev = window.__gearwrightDev;
    return typeof dev.character === 'function' ? dev.character() : null;
  },
  /**
   * The live weapon read model + counters (weapons pass), or null with ?guns=0. The
   * scenario reads ammunition, the fire mode, the ADS blend and the pool's own high-water
   * mark from here, so the numbers it reports are the game's, not the harness's.
   */
  weapon: () => {
    const dev = window.__gearwrightDev;
    return typeof dev.weapon === 'function' ? dev.weapon() : null;
  },
  /**
   * The weapon mount (stance-derived since the hand-motion pass): the muzzle and aim direction
   * the simulation is using this step. Standing still, the muzzle must not move at all — that is
   * what proves the arms are not driving the gun.
   */
  weaponMount: () => {
    const dev = window.__gearwrightDev;
    return typeof dev.weaponMount === 'function' ? dev.weaponMount() : null;
  },
  weaponMountPresent: () => {
    const dev = window.__gearwrightDev;
    return typeof dev.weaponMountPresent === 'function' ? dev.weaponMountPresent() : null;
  },
  /** How many tracers/impacts the presenter handed the renderer on the last frame. */
  weaponEffects: () => {
    const dev = window.__gearwrightDev;
    return typeof dev.weaponEffects === 'function' ? dev.weaponEffects() : null;
  },
  /**
   * Watch the effect pools and report the highest counts seen.
   *
   * A single sample is not enough: a tracer lives 0.1 s, so a semi-auto's tracer is gone
   * by the time a 300 ms hold ends (that read is how this instrument was added — the DMR
   * honestly reported "no tracer" for a shot that plainly drew one). Peaks are what
   * matter, because the pool's ceiling is the budget claim.
   *
   * A cheap interval rather than a requestAnimationFrame loop: reading two numbers every
   * 8 ms cannot perturb the frame rate the same check is measuring, whereas an awaiting
   * rAF loop from the harness competes with the game's own rAF loop for the page's main
   * thread (and at ~6 fps in software rendering that cost real shots).
   */
  startEffectsWatch: () => {
    window.__probe.__fx = { tracers: 0, impacts: 0 };
    if (window.__probe.__fxTimer !== undefined) clearInterval(window.__probe.__fxTimer);
    window.__probe.__fxTimer = setInterval(() => {
      const effects = window.__probe.weaponEffects();
      if (effects === null) return;
      window.__probe.__fx.tracers = Math.max(window.__probe.__fx.tracers, effects.tracers);
      window.__probe.__fx.impacts = Math.max(window.__probe.__fx.impacts, effects.impacts);
    }, 8);
  },
  stopEffectsWatch: () => {
    if (window.__probe.__fxTimer !== undefined) clearInterval(window.__probe.__fxTimer);
    window.__probe.__fxTimer = undefined;
    return window.__probe.__fx ?? { tracers: 0, impacts: 0 };
  },
  /** Frames the loop has rendered — the honest frame-rate denominator for the numbers above. */
  frames: () => window.__gearwright?.snapshot().loop.frames ?? null,
  /** The renderer's own draw-call/triangle counters (the weapons pass's budget claim). */
  renderStats: () => {
    const dev = window.__gearwrightDev;
    return typeof dev.renderStats === 'function' ? dev.renderStats() : null;
  },
  /** The camera's own lens, so ADS is verified against the value the renderer draws with. */
  fov: () => window.__gearwrightDev.camera.currentFov(),
  /**
   * A loose part's *live* box, from the manipulation layer's own records.
   *
   * The level data's spawn pose is where a part starts, not where it is: after a dropped
   * hold it lies wherever it fell, and focusing the spawn box then reports NOT FOCUSABLE
   * while the part sits two metres away. Re-grabbing a part therefore has to ask the game
   * where it actually is (the same records the renderer draws from).
   */
  partBox: (id) => {
    const snapshots = window.__gearwrightDev.manipulation.snapshots
      ? window.__gearwrightDev.manipulation.snapshots()
      : [];
    const found = snapshots.find((entry) => entry.id === id);
    if (found === undefined) return null;
    const h = found.halfExtents;
    return {
      min: { x: found.center.x - h.x, y: found.center.y - h.y, z: found.center.z - h.z },
      max: { x: found.center.x + h.x, y: found.center.y + h.y, z: found.center.z + h.z }
    };
  },
  /**
   * A second, independent InteractionSystem over a fresh physics world built from the
   * same shipped level data — the composition's own camera pose can then be replayed
   * against it instantly (no frame waits), which is what makes aim/occlusion questions
   * answerable rather than guessed at.
   */
  oracle: async (ids) => {
    const { KinematicPhysics } = await import('/src/adapters/kinematic-physics.ts');
    const { InteractionSystem } = await import('/src/gameplay/interaction-system.ts');
    const shipped = await import('/src/levels/shipped-content.ts');
    const branch = await import('/src/levels/branch-a.ts');
    const hub = await import('/src/levels/hub.ts');
    const physics = new KinematicPhysics();
    physics.setStaticColliders([
      ...shipped.SHIPPED_WORLD.colliders,
      ...hub.hubColliders((id) => (id === 'branch-a' ? 'Available' : 'Locked'))
    ]);
    const all = [...shipped.SHIPPED_INTERACTABLES, ...branch.bm1PropInteractables(true), ...hub.hubInteractables(() => 'Complete')];
    const byId = new Map(all.map((item) => [item.id, item]));
    const inter = new InteractionSystem(
      physics,
      ids.map((id) => byId.get(id)).filter((item) => item !== undefined)
    );
    const cam = window.__gearwrightDev.camera.snapshot();
    const anchor = window.__gearwrightDev.player.snapshot().position;

    // 1. Does the live camera pose hit anything at all, and is the target box-blocked?
    const direction = {
      x: cam.target.x - cam.eye.x,
      y: cam.target.y - cam.eye.y,
      z: cam.target.z - cam.eye.z
    };
    const length = Math.hypot(direction.x, direction.y, direction.z);
    const unit = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
    const hits = physics.queryInteractionRay(cam.eye, unit, 12);

    const result = { liveEye: cam.eye, liveAnchor: anchor, hits, targets: {} };
    for (const id of ids) {
      const item = byId.get(id);
      if (item === undefined) continue;
      const centre = {
        x: (item.min.x + item.max.x) / 2,
        y: (item.min.y + item.max.y) / 2,
        z: (item.min.z + item.max.z) / 2
      };
      result.targets[id] = {
        enabled: item.enabled,
        kind: item.kind,
        centre,
        boxBlocked: physics.isBoxBlocked(item.min, item.max),
        reachFromLiveAnchor: Math.hypot(centre.x - anchor.x, centre.y - anchor.y, centre.z - anchor.z)
      };
    }

    // 2. Search for a vantage + aim that focuses each target, through the real system.
    for (const id of ids) {
      const item = byId.get(id);
      if (item === undefined) continue;
      const centre = {
        x: (item.min.x + item.max.x) / 2,
        y: (item.min.y + item.max.y) / 2,
        z: (item.min.z + item.max.z) / 2
      };
      const aims = [];
      for (const distance of [2.0, 2.4, 1.6, 2.8]) {
        for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          if (aims.length >= 4) break;
          const len = Math.hypot(dx, dz);
          const px = centre.x + (dx / len) * distance;
          const pz = centre.z + (dz / len) * distance;
          const yaw = Math.atan2(-(centre.x - px), -(centre.z - pz));
          const h = distance;
          for (const pitchOffset of [0, 0.1, -0.1]) {
            if (aims.length >= 4) break;
            // 'pitch' is a view angle (positive = looking down); the rig's own pitch is its
            // negation, so the clamps read the other way round (maxPitch 0.55 up, minPitch
            // -1.1 down ⇒ a view pitch in [-0.55, 1.1]).
            const pitch = Math.atan2(1.4 - centre.y, h) + pitchOffset;
            if (pitch > 1.1 || pitch < -0.55) continue;
            const dirY = Math.sin(pitch);
            const cosPitch = Math.cos(pitch);
            for (const arm of [4.2, 2.6, 1.2]) {
              const camPose = {
                eye: {
                  x: px + Math.sin(yaw) * cosPitch * arm,
                  y: 1.4 + dirY * arm,
                  z: pz + Math.cos(yaw) * cosPitch * arm
                },
                target: { x: px, y: 1.4, z: pz },
                anchor: { x: px, y: 0.01, z: pz }
              };
              for (let step = 0; step < 4; step += 1) inter.update(camPose);
              const focus = inter.focus;
              if (focus !== null && focus.id === id) {
                aims.push({ from: { x: px, z: pz }, yaw, pitch, arm, reach: focus.distance, verb: focus.verb });
                break;
              }
            }
          }
        }
      }
      result.targets[id].aims = aims;
    }
    return result;
  },
  /** Derived progression state (branch state, hub stage, clue set) — for persistence checks. */
  progress: () => {
    const progression = window.__gearwrightDev.progression;
    return {
      branchA: progression.branchState('branch-a'),
      // Branch B ships too, so the full curve's own end state is readable (the branch
      // scenario plays A → B1 → B2 → BM-2 and asserts B completes, not A alone).
      branchB: progression.branchState('branch-b'),
      // Branch C is the third room's gate; a fresh save must keep it Locked (A and B open it).
      branchC: progression.branchState('branch-c'),
      hubStage: progression.hubStageIndex,
      clues: [...progression.discoveredClueIds]
    };
  },
  level: async () => {
    let branch = window.__gearwrightDev?.level?.branch;
    let hubInteractables = window.__gearwrightDev?.level?.hubInteractables;
    let hubTargets = null;
    if (branch && hubInteractables) {
      hubTargets = hubInteractables(() => 'Complete').map((i) => ({ id: i.id, min: i.min, max: i.max }));
    } else {
      try {
        const branchMod = await import('/src/levels/branch-a.ts');
        const hubMod = await import('/src/levels/hub.ts');
        branch = branchMod;
        hubTargets = hubMod.hubInteractables(() => 'Complete').map((i) => ({ id: i.id, min: i.min, max: i.max }));
      } catch {}
    }
    if (!branch) return null;
    // Branch B ships alongside A, so its parts and sockets are probe-able too (the
    // focus scenario walks them, which is how the new room proves it is reachable). The
    // composition's own hook carries both branches, so the module import is only needed on
    // the fallback path — and asking for it in a production build logs a 404 that the
    // harness would report as a problem (it did, before this).
    let branchB = branch.B1_CARRYABLES === undefined ? null : branch;
    if (branchB === null && window.__probe.sourceAvailable !== false) {
      try { branchB = await import('/src/levels/branch-b.ts'); } catch { /* optional */ }
    }
    // Branch C is a second new room; the crucible scenario walks and docks in it.
    let branchC = branch.C1_CARRYABLES === undefined ? null : branch;
    if (branchC === null && window.__probe.sourceAvailable !== false) {
      try { branchC = await import('/src/levels/branch-c.ts'); } catch { /* optional */ }
    }
    const parts = (list) => list.map((c) => ({ id: c.instanceId, center: c.spawn.center, half: c.definition.halfExtents }));
    const sockets = (list) => list.map((s) => ({ id: s.id, center: s.pose.center, half: s.halfExtents }));
    return {
      p1: branch.P1_INTERACTABLES,
      p1Parts: parts(branch.P1_CARRYABLES),
      p1Sockets: sockets(branch.P1_SOCKETS),
      p2Parts: parts(branch.P2_CARRYABLES),
      p2Sockets: sockets(branch.P2_SOCKETS),
      p3Parts: parts(branch.P3_CARRYABLES),
      p3Sockets: sockets(branch.P3_SOCKETS),
      bm1Parts: parts(branch.BM1_CARRYABLES),
      bm1Sockets: sockets(branch.BM1_SOCKETS),
      bm1Props: branch.BM1_PROPS.map((p) => ({ id: p.id, centerX: p.centerX })),
      b1Parts: branchB ? parts(branchB.B1_CARRYABLES) : [],
      b1Sockets: branchB ? sockets(branchB.B1_SOCKETS) : [],
      b2Parts: branchB ? parts(branchB.B2_CARRYABLES) : [],
      b2Sockets: branchB ? sockets(branchB.B2_SOCKETS) : [],
      b3Parts: branchB ? parts(branchB.B3_CARRYABLES) : [],
      b3Sockets: branchB ? sockets(branchB.B3_SOCKETS) : [],
      bm2Parts: branchB ? parts(branchB.BM2_CARRYABLES) : [],
      bm2Sockets: branchB ? sockets(branchB.BM2_SOCKETS) : [],
      bm2Props: branchB ? branchB.BM2_PROPS.map((p) => ({ id: p.id, centerX: p.centerX })) : [],
      c1Parts: branchC ? parts(branchC.C1_CARRYABLES) : [],
      c1Sockets: branchC ? sockets(branchC.C1_SOCKETS) : [],
      c2Parts: branchC ? parts(branchC.C2_CARRYABLES) : [],
      c2Sockets: branchC ? sockets(branchC.C2_SOCKETS) : [],
      c3Parts: branchC ? parts(branchC.C3_CARRYABLES) : [],
      c3Sockets: branchC ? sockets(branchC.C3_SOCKETS) : [],
      cm3Parts: branchC ? parts(branchC.CM3_CARRYABLES) : [],
      cm3Sockets: branchC ? sockets(branchC.CM3_SOCKETS) : [],
      cm3Props: branchC ? branchC.CM3_PROPS.map((p) => ({ id: p.id, centerX: p.centerX })) : [],
      hubTargets
    };
  }
};
true;
`;

/**
 * Navigate to `url`, wait for the game to boot, and inject the probe. Taking the URL as a
 * parameter (rather than always using BASE) is what lets a scenario reload the *same* page
 * with one flag flipped — the `guns` scenario's `?guns=0` pass does exactly that, and a
 * fresh navigation is the honest way to check an escape hatch (nothing carries over).
 */
async function boot(cdp, url = BASE) {
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.navigate', { url });

  const deadline = Date.now() + 60000;
  let up = false;
  while (Date.now() < deadline && !up) {
    try {
      up = await evaluate(cdp, `(async () => {
        if (document.querySelector('canvas[data-booted="true"]')) return true;
        ${PRODUCTION || URL_ARG !== null ? '' : "try { await import('/src/levels/branch-a.ts'); return true; } catch { return false; }"}
        return false;
      })()`);
    } catch {
      up = false;
    }
    if (!up) await sleep(300);
  }
  if (!up) throw new Error('page never booted');
  // The probe is told whether the page can import the game's TypeScript sources at all:
  // the dev server serves them, a production `dist/` does not. Route planning reads them, and
  // a failed import would log a 404 that the harness would (honestly) report as a problem —
  // so the check declines to make the request it knows will fail.
  const sourceAvailable = !(PRODUCTION || URL_ARG !== null);
  await evaluate(cdp, `${PROBE_SOURCE}\nwindow.__probe.sourceAvailable = ${sourceAvailable};\ntrue;`);

  const readyDeadline = Date.now() + 45000;
  while (Date.now() < readyDeadline) {
    const ready = await evaluate(cdp, 'window.__probe.ready()').catch(() => false);
    if (ready) break;
    await sleep(250);
  }
  // Let a second of frames run: boot status is removed on the first frame.
  await sleep(1500);
}

/**
 * Console lines this harness has always documented as expected noise. Kept to *exactly* these two
 * (both recorded in `DOCS/STATUS.md` since the 16/10 weapons pass): ANGLE's shader-precision note
 * and the browser's autoplay refusal before the first gesture. Everything else is still a problem.
 *
 * They are filtered here rather than in the docs because the harness counted them as failures, so
 * `boot --production` could never truthfully report `problems: []` on a machine whose driver emits
 * X4122 — which made the clean gate unreachable rather than clean.
 */
const KNOWN_CONSOLE_NOISE = [/warning X4122/, /AudioContext was not allowed to start/];

function drainConsole(cdp) {
  for (const event of cdp.events.splice(0, cdp.events.length)) {
    if (event.method === 'Runtime.consoleAPICalled') {
      const type = event.params.type;
      const text = event.params.args
        .map((arg) => arg.value ?? arg.description ?? arg.type)
        .join(' ');
      const expected = KNOWN_CONSOLE_NOISE.some((pattern) => pattern.test(text));
      if (!expected && (type === 'error' || type === 'warning')) {
        report.problems.push(`console.${type}: ${text}`);
      }
      report.logs.push(`${type}: ${text}`);
    } else if (event.method === 'Runtime.exceptionThrown') {
      const details = event.params.exceptionDetails;
      report.problems.push(`exception: ${details.exception?.description ?? details.text}`);
    } else if (event.method === 'Log.entryAdded') {
      const entry = event.params.entry;
      if (entry.level === 'error' || entry.level === 'warning') {
        // The URL matters: an unattributed 404 in a check cannot be acted on, and one did
        // show up here before this was added.
        const text = `log.${entry.level}: ${entry.text}${entry.url ? ` <- ${entry.url}` : ''}`;
        // The same two documented lines arrive on *both* channels — the autoplay refusal is a
        // console warning *and* a browser log entry — and the filter above only knew the console
        // one. A clean `branch` run (21/10/2026) therefore ended with two "problems" that the
        // docs have always listed as expected noise.
        if (KNOWN_CONSOLE_NOISE.some((pattern) => pattern.test(entry.text))) report.logs.push(text);
        else report.problems.push(text);
      } else {
        report.logs.push(`log.${entry.level}: ${entry.text}`);
      }
    }
  }
}

const APPROACHES = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1]
];

/**
 * Focus a target through the real composition.
 *
 * The camera looks through its anchor (the player's position + 1.4 m), so the ray's
 * height `h` metres ahead is `1.4 - h * tan(pitch)`: one closed-form yaw + pitch. The
 * aim is recomputed from where the player *actually* ended up, because a teleport into
 * geometry is resolved out by the physics and would otherwise invalidate the aim.
 */
async function focusTarget(cdp, id, target, reach = 3.1) {
  const centre = {
    x: (target.min.x + target.max.x) / 2,
    y: (target.min.y + target.max.y) / 2,
    z: (target.min.z + target.max.z) / 2
  };
  for (const distance of [2.2, 1.6, 2.6, 1.2]) {
    for (const [dx, dz] of APPROACHES) {
      const length = Math.hypot(dx, dz);
      const px = centre.x + (dx / length) * distance;
      const pz = centre.z + (dz / length) * distance;
      await evaluate(cdp, `window.__probe.teleport(${px}, 0.01, ${pz})`);
      await sleep(450);
      const state = await evaluate(cdp, 'window.__probe.state()');
      const actual = state.pos;
      const h = Math.hypot(centre.x - actual.x, centre.z - actual.z);
      if (h > reach) continue;
      const yaw = Math.atan2(-(centre.x - actual.x), -(centre.z - actual.z));
      const pitch = Math.atan2(1.4 - centre.y, h);
      // ScanY: a closed-form pitch can still miss by a hair (box edge, blend settling),
      // so if the aim comes up empty, nudge pitch both ways before giving up.
      for (const scanY of [0, 0.03, -0.03, -0.06]) {
        await evaluate(
          cdp,
          `(async () => { await window.__probe.pitchHome(); await window.__probe.pitchTo(${pitch + scanY}); await window.__probe.aimYaw(${yaw}); return true; })()`
        );
        await sleep(400);
        const aimed = await evaluate(cdp, 'window.__probe.state()');
        if (aimed.focus !== null && aimed.focus.id === id) {
          return { from: { x: actual.x, z: actual.z }, pitch: pitch + scanY, focus: aimed.focus };
        }
      }
    }
  }
  return null;
}

function boxOf(entry) {
  if (entry.min !== undefined) return { min: entry.min, max: entry.max };
  return {
    min: { x: entry.center.x - entry.half.x, y: entry.center.y - entry.half.y, z: entry.center.z - entry.half.z },
    max: { x: entry.center.x + entry.half.x, y: entry.center.y + entry.half.y, z: entry.center.z + entry.half.z }
  };
}

async function scenarioTitle(cdp) {
  const titleUrl = BASE.replace('skipTitle=1&', '');
  await cdp.send('Page.navigate', { url: titleUrl });
  await sleep(4000);
  const before = await evaluate(
    cdp,
    "({ visible: !!document.querySelector('.gw-title') && !document.querySelector('.gw-title').classList.contains('gw-title--hidden'), buttonText: document.querySelector('.gw-title-start')?.textContent })"
  );
  const rect = await evaluate(
    cdp,
    "(() => { const r = document.querySelector('.gw-title-start').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()"
  );
  await clickAt(cdp, rect.x, rect.y);
  await sleep(1000);
  const afterHidden = await evaluate(
    cdp,
    "document.querySelector('.gw-title').classList.contains('gw-title--hidden')"
  );
  const lifecycle = await evaluate(cdp, 'window.__gearwright ? window.__gearwright.snapshot().lifecycle : null');
  report.data.title = {
    visibleAtBoot: before.visible,
    buttonText: before.buttonText,
    hiddenAfterStart: afterHidden,
    lifecycle
  };
  drainConsole(cdp);
}

/**
 * Wait for the composition to settle which body it draws, then read its facts.
 *
 * `upgradePlayerBody` fetches the imported humanoid in the background, so the first frames of a
 * session are legitimately the procedural rig; `canvas.dataset.body` is written when the swap has
 * resolved either way (a failed fetch sets 'proc' — the fallback is the contract, not a failure).
 */
async function waitForPlayerBody(cdp) {
  const deadline = Date.now() + 30000;
  const settled = () =>
    evaluate(cdp, 'document.getElementById("game-canvas").dataset.body ?? null');
  while (Date.now() < deadline) {
    if ((await settled()) !== null) break;
    await sleep(250);
  }
  const kind = await settled();
  if (kind === null) report.problems.push('character: the body swap never settled (no dataset.body)');
  return evaluate(cdp, 'window.__probe.character()');
}

async function scenarioBoot(cdp) {
  const state = await evaluate(cdp, 'window.__probe.state()');
  const hud = await evaluate(cdp, 'window.__probe.hud()');
  const stats = await evaluate(cdp, 'window.__probe.stats()');
  const bootStatus = await evaluate(cdp, 'document.getElementById("boot-status") === null');
  report.data.boot = { state, hud, bootStatus, overlay: stats.overlay };
  drainConsole(cdp);

  // Weapon HUD layout (19/10/2026). The weapons pass shipped this markup with no CSS at all,
  // so the read-out was an unstyled list: "the boxes and the slots don't fit" was literally
  // true. Pin the fix in layout terms — a real panel, and every visible slot chip a real box
  // that sits *inside* that panel. Absent when the weapon system is composed off (`?guns=0`).
  const readWeaponLayout = () =>
    evaluate(
      cdp,
      `(() => {
        const panel = document.querySelector('.gw-hud-weapon');
        if (panel === null) return null;
        if (getComputedStyle(panel).display === 'none') return null;
        const p = panel.getBoundingClientRect();
        const chips = [...panel.querySelectorAll('.gw-hud-weapon-slots > li')]
          .filter((li) => !li.classList.contains('gw-hud-hidden'))
          .map((li) => {
            const b = li.getBoundingClientRect();
            return {
              text: li.textContent,
              width: b.width,
              height: b.height,
              inside:
                b.left >= p.left - 1 && b.right <= p.right + 1 && b.top >= p.top - 1 && b.bottom <= p.bottom + 1
            };
          });
        return {
          panel: { width: p.width, height: p.height, left: p.left, right: p.right, top: p.top, bottom: p.bottom },
          chips
        };
      })()`
    );
  // The panel exists in the template before the first HUD render, so the chips can legitimately
  // be empty for a frame or two. Poll instead of racing the first `present()`; a real "no chips"
  // state still fails after the window closes.
  let weaponLayout = await readWeaponLayout();
  for (let attempt = 0; attempt < 8 && weaponLayout !== null && weaponLayout.chips.length === 0; attempt += 1) {
    await sleep(250);
    weaponLayout = await readWeaponLayout();
  }
  report.data.weaponLayout = weaponLayout;
  if (weaponLayout !== null) {
    if (!(weaponLayout.panel.width > 100 && weaponLayout.panel.height > 40)) {
      report.problems.push(
        `hud: the weapon panel is ${weaponLayout.panel.width}×${weaponLayout.panel.height} px (it has no usable surface)`
      );
    }
    if (weaponLayout.chips.length === 0) {
      report.problems.push('hud: the weapon panel draws no slot chips');
    }
    for (const chip of weaponLayout.chips) {
      if (!(chip.width > 0 && chip.height > 0)) {
        report.problems.push(`hud: slot chip "${chip.text}" has no box (${chip.width}×${chip.height} px)`);
      }
      if (!chip.inside) {
        report.problems.push(`hud: slot chip "${chip.text}" overflows the weapon panel`);
      }
    }
  }

  // The player's body: whichever of the two the composition settled on — the procedural rig
  // (19 bones, generated) or the imported humanoid (CHARACTER-3D.md §5, fetched in the background).
  // This is the only place that can prove the real composition builds it, draws it, and stands it
  // on the player's feet, so it waits for the swap to settle instead of racing the download.
  const character = await waitForPlayerBody(cdp);
  report.data.character = character;
  if (character === null) {
    report.problems.push('character: the render port exposes no player body (characterFacts absent)');
  } else if (character.body !== 'gltf' && character.body !== 'procedural') {
    report.problems.push(`character: unknown body kind ${JSON.stringify(character.body)}`);
  } else {
    const bones = character.body === 'gltf' ? character.bones >= 19 : character.bones === 19;
    if (!bones) {
      report.problems.push(
        `character: ${character.body} body expected ${character.body === 'gltf' ? 'at least 19' : '19'} bones, got ${character.bones}`
      );
    }
    if (character.triangles < 500) report.problems.push(`character: body has only ${character.triangles} triangles`);
    if (character.visible !== true) report.problems.push('character: the player body is not visible');
    const drift = Math.hypot(character.x - state.pos.x, character.z - state.pos.z);
    if (!(drift <= 0.5)) report.problems.push(`character: body stands ${drift.toFixed(2)} m from the player`);
  }

  // Bug 21 (§15/EC-BRN-06): the entry handshake. Before the first click the guidance
  // line must be up and nobody's capture should be claimed; after a real click the
  // canvas must own focus, and the lock must either be granted (line gone) or reported
  // as refused (toast + fallback line). Both outcomes are honest; silence is not.
  report.data.pointerEntryBefore = await evaluate(cdp, 'window.__probe.state()');
  await clickAt(cdp, 800, 450);
  await sleep(900);
  report.data.pointerEntryAfter = {
    state: await evaluate(cdp, 'window.__probe.state()'),
    hud: await evaluate(cdp, 'window.__probe.hud()')
  };
  drainConsole(cdp);

  // Input soak: walk, look, act. Any exception or NaN surfaces here.
  const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'KeyR', 'KeyH'];
  for (let i = 0; i < 6; i += 1) {
    const code = codes[i % codes.length];
    await keyDown(cdp, code);
    await sleep(400);
    await keyUp(cdp, code);
    await evaluate(cdp, `window.__probe.look(${(Math.random() - 0.5) * 400}, ${(Math.random() - 0.5) * 200})`);
    await clickAt(cdp, 800, 450).catch(() => {});
    await sleep(200);
  }
  await tapKey(cdp, 'F3');
  await sleep(500);

  const after = await evaluate(cdp, 'window.__probe.state()');
  const overlay = await evaluate(cdp, 'window.__probe.stats()');
  report.data.soak = { after, overlay };
  drainConsole(cdp);

  // Pause / resume lifecycle (Escape with an empty hand pauses) + the PLAN T1.2 overlay.
  await tapKey(cdp, 'Escape');
  await sleep(600);
  const paused = await evaluate(cdp, 'window.__probe.state()');
  const overlayShown = await evaluate(cdp, "(() => { const el = document.querySelector('.gw-pause'); return el !== null && !el.classList.contains('gw-pause--hidden'); })()");
  await clickAt(cdp, 800, 450);
  await sleep(800);
  const resumedByClick = await evaluate(cdp, 'window.__probe.state()');
  await tapKey(cdp, 'Escape');
  await sleep(600);
  await tapKey(cdp, 'Escape');
  await sleep(800);
  const resumed = await evaluate(cdp, 'window.__probe.state()');
  report.data.lifecycle = {
    pausedState: paused.lifecycle,
    overlayShown,
    resumedByClick: resumedByClick.lifecycle,
    resumedState: resumed.lifecycle,
    resumedFrames: resumed.loop?.frames
  };
  drainConsole(cdp);
}

async function scenarioFocus(cdp) {
  const level = await evaluate(cdp, 'window.__probe.level()');
  const targets = [
    ...level.bm1Parts.map((entry) => ({ id: entry.id, box: boxOf(entry) })),
    ...level.bm1Sockets.map((entry) => ({ id: entry.id, box: boxOf(entry) })),
    ...(level.b1Parts ?? []).map((entry) => ({ id: entry.id, box: boxOf(entry) })),
    ...(level.b1Sockets ?? []).map((entry) => ({ id: entry.id, box: boxOf(entry) })),
    ...(level.b2Parts ?? []).map((entry) => ({ id: entry.id, box: boxOf(entry) })),
    ...(level.b2Sockets ?? []).map((entry) => ({ id: entry.id, box: boxOf(entry) })),
    ...(level.b3Parts ?? []).map((entry) => ({ id: entry.id, box: boxOf(entry) })),
    ...(level.b3Sockets ?? []).map((entry) => ({ id: entry.id, box: boxOf(entry) })),
    ...(level.bm2Parts ?? []).map((entry) => ({ id: entry.id, box: boxOf(entry) })),
    ...(level.bm2Sockets ?? []).map((entry) => ({ id: entry.id, box: boxOf(entry) })),
    ...level.p1.map((entry) => ({ id: entry.id, box: boxOf(entry) }))
  ];

  const results = {};
  const objective = {};
  for (const target of targets) {
    // The in-page oracle finds a working vantage + aim instantly; the live attempt then
    // proves the *real* composition focuses from it (same world, same systems).
    const oracle = await evaluate(cdp, `window.__probe.oracle(['${target.id}'])`);
    const probe = oracle.targets[target.id];
    const aims = probe?.aims ?? [];
    const found = await focusTarget(cdp, target.id, target.box);
    let outcome;
    if (found === null) {
      outcome = `NOT FOCUSABLE (oracle found ${aims.length} aim(s)${probe === undefined ? ', target not in the interaction set' : ''})`;
    } else {
      const hud = await evaluate(cdp, 'window.__probe.hud()');
      outcome = `focused from (${found.from.x.toFixed(1)}, ${found.from.z.toFixed(1)}) — verb ${found.focus.verb}, reach ${found.focus.distance.toFixed(2)} m, ${probe?.boxBlocked ? 'BOX-BLOCKED' : 'box clear'}`;
      objective[target.id] = `${hud.objectiveTitle?.text} / ${hud.objectiveState?.text} / ${hud.objectiveFailure?.text}`;
    }
    results[target.id] = outcome;
    log(`  focus ${target.id}: ${outcome}`);
  }
  report.data.focus = results;
  report.data.objective = objective;
  drainConsole(cdp);
}

/**
 * Focus + grab a loose part through the real composition (a KeyE edge).
 *
 * The box is read live (the manipulation layer's own records) rather than taken from the
 * level's spawn pose, so a part that was dropped mid-carry is still grabbable — which is
 * what makes the caller's retry able to recover instead of reporting NOT FOCUSABLE for a
 * part that is lying in plain sight.
 */
async function grabPart(cdp, part) {
  const live = await evaluate(cdp, `window.__probe.partBox('${part.id}')`).catch(() => null);
  const found = await focusTarget(cdp, part.id, live ?? boxOf(part));
  if (found === null) return { id: part.id, focus: 'NOT FOCUSABLE' };
  await tapKey(cdp, 'KeyE');
  await sleep(600);
  const hud = await evaluate(cdp, 'window.__probe.hud()');
  return {
    id: part.id,
    focus: `${found.focus.verb} @ ${found.focus.distance.toFixed(2)} m`,
    held: hud.held?.text ?? null
  };
}

/**
 * Carry a held part into a socket's volume: hop + aim from several approach directions
 * (a machine's usable side differs — P1/P2 face the aisle, BM-1's sockets face the
 * bench), then confirm like a human holding the button. A frame-accurate click can land
 * in the step before `SnapPreview` (§14's order), so the confirm retries.
 */
async function dockInto(cdp, socket, part = null) {
  const attempts = [];
  /** One recovery attempt: re-grab the part the caller named, wherever it now lies. */
  const regrab = async () => {
    if (part === null) return false;
    const again = await grabPart(cdp, part);
    attempts.push(`re-grab ${part.id}: ${again.focus}${again.held === undefined ? '' : ` (held ${again.held})`}`);
    return again.held === part.id;
  };
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const length = Math.hypot(dx, dz);
    // The standoffs are a *coverage* list, not a tuning knob. 1.2 and 1.5 first (they are the
    // vantages the shipped sockets were proven from), then 0.9 — a standoff a player at arm's
    // length actually uses — and two long ones. The 19/10 carry pass found that this list was the
    // whole of the 18/10 `dock` failure: a shorter hold was rejected because no vantage under
    // 1.2 m was ever tried, not because the part could not reach the socket.
    for (const back of [1.5, 1.2, 1.9, 0.9, 2.3, 0.7]) {
      const px = socket.center.x + (dx / length) * back;
      const pz = socket.center.z + (dz / length) * back;
      const yaw = Math.atan2(-(socket.center.x - px), -(socket.center.z - pz));
      // hopTo returns false when the teleport landed inside geometry (it rolls the player
      // back). All that is left to do with that vantage is skip it.
      const hopped = await evaluate(
        cdp,
        `(async () => {
          const ok = await window.__probe.hopTo(${px}, ${pz}, ${yaw});
          await window.__probe.pitchHome();
          await window.__probe.pitchTo(0.0);
          await window.__probe.aimYaw(${yaw});
          const dev = window.__gearwrightDev;
          window.__probe.hopTrace.push({ hop: 'aim', held: dev.manipulation.heldId ?? null });
          return ok;
        })()`
      );
      await sleep(500);
      let hud = await evaluate(cdp, 'window.__probe.hud()');
      // The hop trace is what turns "hold lost" into a diagnosis: it shows the step the
      // part was left behind on, the gap at that moment, and where the player stood.
      const trace = await evaluate(cdp, 'window.__probe.hopTrace ?? []').catch(() => []);
      attempts.push(
        `dir ${dx},${dz} back ${back}: ${hud.socket?.text ?? '?'}${hopped === false ? ' | route blocked (rolled back)' : ''}${trace.length > 0 ? ` | trace ${JSON.stringify(trace)}` : ''}`
      );
      // A hold can be soft-detached mid-hop (EC-MAN-07: >2.6 m from the player) — the
      // teleport-driven hopping is faster than a player, so the part can be left behind
      // and dropped. Recover it if the caller named it, then try the next vantage; the
      // run only gives up once the part cannot be picked up again at all.
      if (/empty-handed/i.test(hud.held?.text ?? '')) {
        attempts.push('hold lost');
        if (!(await regrab())) return { attempts, hud, dropped: true };
        continue;
      }
      if (!/incompatible/i.test(hud.socket?.text ?? '') && /compatible/i.test(hud.socket?.text ?? '')) {
        for (let i = 0; i < 3; i += 1) {
          await clickAt(cdp, 800, 450);
          await sleep(400);
          hud = await evaluate(cdp, 'window.__probe.hud()');
          if (/incompatible/i.test(hud.socket?.text ?? '') || !/compatible/i.test(hud.socket?.text ?? '')) break;
        }
        return { attempts, hud };
      }
    }
  }
  return { attempts, hud: await evaluate(cdp, 'window.__probe.hud()') };
}

/**
 * Press a staged machine's panel props in the given order, through the real
 * composition (focus → KeyE), reporting each one's focus, the objective line and any
 * failure reason. ADR-018's staged machines share this shape exactly: BM-1 and BM-2
 * differ only in their prop ids and where their panel stands, so both walkthroughs use
 * this one helper.
 */
async function pressStagedProps(cdp, props, zFrom, zTo) {
  const steps = [];
  for (const prop of props) {
    const box = {
      min: { x: prop.x - 0.25, y: 1.05, z: zFrom },
      max: { x: prop.x + 0.25, y: 1.45, z: zTo }
    };
    const found = await focusTarget(cdp, prop.id, box, 3.4);
    if (found === null) {
      steps.push({ id: prop.id, focus: 'NOT FOCUSABLE' });
      continue;
    }
    await tapKey(cdp, 'KeyE');
    await sleep(400);
    const hud = await evaluate(cdp, 'window.__probe.hud()');
    steps.push({
      id: prop.id,
      focus: found.focus.verb,
      objective: `${hud.objectiveTitle?.text} / ${hud.objectiveState?.text}`,
      failure: hud.objectiveFailure?.text
    });
    drainConsole(cdp);
    await sleep(700);
  }
  return steps;
}

async function playBm1Sequence(cdp, level) {
  const steps = { assembly: [] };
  const gear = level.bm1Parts.find((entry) => entry.id === 'gear-bm1');
  const valve = level.bm1Parts.find((entry) => entry.id === 'valve-bm1');
  const drive = level.bm1Sockets.find((entry) => entry.id === 'socket-bm1-drive');
  const line = level.bm1Sockets.find((entry) => entry.id === 'socket-bm1-line');

  // Assembly with the same bounded retry as the branch pairs: a lost hold mid-hop is a
  // harness artefact (EC-MAN-07), not a game failure — re-grab and try again.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const before = report.logs.length;
    const grabGear = await grabPart(cdp, gear);
    const dockGear = await dockInto(cdp, drive, gear);
    const grabValve = await grabPart(cdp, valve);
    const dockValve = await dockInto(cdp, line, valve);
    await sleep(900);
    drainConsole(cdp);
    const fresh = report.logs.slice(before).join('\n');
    steps.assembly.push({ attempt, grabGear, dockGear, grabValve, dockValve });
    if (/BM-1 structure complete/.test(fresh)) break;
  }
  steps['after assembly'] = await evaluate(cdp, 'window.__probe.hud()');

  // Priming: the three lines in any order (the props' ids *are* the staged action
  // ids), then the engage lever — the one ordered step.
  const props = [
    { id: 'bm1/prime-feed', x: -2.0 },
    { id: 'bm1/prime-return', x: -0.7 },
    { id: 'bm1/prime-bleed', x: 0.7 },
    { id: 'bm1/engage', x: 2.0 }
  ];
  steps.presses = await pressStagedProps(cdp, props, -16.8, -16.4);

  await sleep(1200);
  steps.finalHud = await evaluate(cdp, 'window.__probe.hud()');
  drainConsole(cdp);
  return steps;
}

/**
 * BM-2 "Steam Engine" — Branch B's staged capstone, played the same way BM-1 is: the two
 * carriers into their sockets, the three priming lines in any order, then the throttle.
 *
 * This is the proof STATUS.md §Next up #1 asks for: the branch completes *only* once its
 * capstone has run, so reaching Branch B's Complete state through the real composition is
 * the acceptance criterion — B2 alone leaves it InProgress by design.
 */
async function playBm2Sequence(cdp, level) {
  const steps = { assembly: [] };
  const gear = level.bm2Parts.find((entry) => entry.id === 'gear-bm2');
  const valve = level.bm2Parts.find((entry) => entry.id === 'valve-bm2');
  const drive = level.bm2Sockets.find((entry) => entry.id === 'socket-bm2-drive');
  const steam = level.bm2Sockets.find((entry) => entry.id === 'socket-bm2-steam');

  // Same bounded retry as BM-1's assembly: a hold lost mid-hop is an EC-MAN-07 harness
  // artefact (the probe teleports faster than a player), not a game failure.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const before = report.logs.length;
    const grabGear = await grabPart(cdp, gear);
    const dockGear = await dockInto(cdp, drive, gear);
    const grabValve = await grabPart(cdp, valve);
    const dockValve = await dockInto(cdp, steam, valve);
    await sleep(900);
    drainConsole(cdp);
    const fresh = report.logs.slice(before).join('\n');
    steps.assembly.push({ attempt, grabGear, dockGear, grabValve, dockValve });
    if (/BM-2 structure complete/.test(fresh)) break;
  }
  steps['after assembly'] = await evaluate(cdp, 'window.__probe.hud()');

  // The capstone's priming lines are live only now ("assembly before priming", the same
  // world-side rule BM-1 uses), so this is also the check that the staged rig installed.
  const props = [
    { id: 'bm2/prime-inlet', x: -2.0 },
    { id: 'bm2/prime-outlet', x: -0.7 },
    { id: 'bm2/prime-drain', x: 0.7 },
    { id: 'bm2/engage', x: 2.0 }
  ];
  steps.presses = await pressStagedProps(cdp, props, 30.4, 30.8);

  await sleep(1500);
  steps.finalHud = await evaluate(cdp, 'window.__probe.hud()');
  drainConsole(cdp);
  return steps;
}

/**
 * A fast carry/dock check — the failure the long branch run kept hitting.
 *
 * The branch curve is a 20-minute scenario, so when a *dock* is what breaks, debugging it
 * there is expensive. This plays one pair (B2's valve into its steam port, the pair that
 * used to lose its hold three times over) and reports the mechanics: held, docked, and
 * the socket's read-out. B2's puzzle is `Locked` at boot (Branch B is gated behind
 * Branch A), which is deliberate — the snap seam and the socket are what this checks, not
 * the puzzle latch.
 */
async function scenarioDock(cdp) {
  const level = await evaluate(cdp, 'window.__probe.level()');
  const valve = level.b2Parts.find((entry) => entry.id === 'valve-b2');
  const socket = level.b2Sockets.find((entry) => entry.id === 'socket-b2-steam');
  const grab = await grabPart(cdp, valve);
  const dock = await dockInto(cdp, socket, valve);
  await sleep(900);
  drainConsole(cdp);
  const planning = await evaluate(cdp, 'window.__probe.colliderNote()').catch(() => null);
  report.data.dock = {
    grab,
    dropped: dock.dropped === true,
    attempts: dock.attempts,
    socketAfter: dock.hud?.socket?.text ?? null,
    routePlanning: planning ?? 'available',
    hud: await evaluate(cdp, 'window.__probe.hud()'),
    progress: await evaluate(cdp, 'window.__probe.progress()')
  };
  // A carry check *teleports* the player, and the game's own physics resolves where that
  // lands — so if the harness cannot plan a route around the level's geometry, it can hop
  // into a machine post and get pushed through the floor (`player.y = -2.65` in the trace).
  // That is a limitation of the check, and saying so is the honest answer: a verdict that
  // depends on where a straight line happens to land is not a verdict about the game.
  const rolledBack = (dock.attempts ?? []).some((attempt) => /rolled back/.test(attempt));
  if (dock.dropped === true) {
    report.problems.push('dock: the held part was soft-detached mid-carry');
  } else if (/incompatible/i.test(dock.hud?.socket?.text ?? '')) {
    if (planning !== null && rolledBack) {
      report.data.dock.inconclusive =
        'a hop was rolled back and route planning is unavailable here, so the check could not stand where it needs to';
    } else {
      report.problems.push(`dock: the socket refused the part (${dock.hud?.socket?.text})`);
    }
  }
  if ((dock.attempts ?? []).some((attempt) => /rolled back/.test(attempt))) {
    report.data.dock.rolledBackHops = (dock.attempts ?? []).filter((a) => /rolled back/.test(a)).length;
  }
}

/**
 * THE GREAT CRUCIBLE, entered and played (22/10/2026).
 *
 * Branch C is new level geometry and four new machines, and no headless suite can tell whether
 * the room behind the hall's east-north doorway is *walkable* or whether its sockets can be
 * reached with a carried part. This check does both, and it proves the branch's new teaching
 * live: C1's two blast ports read one feed and then **overpressure** on the machine graph as
 * the second valve goes in. The puzzle stays `Locked` throughout on purpose — a fresh save has
 * not completed A and B — which is itself the point: derived machine state exists independently
 * of §25 gating, and the gate is honest about what the player may play.
 */
async function scenarioCrucible(cdp) {
  const level = await evaluate(cdp, 'window.__probe.level()');
  const valveA = (level.c1Parts ?? []).find((entry) => entry.id === 'valve-c1-1');
  const valveB = (level.c1Parts ?? []).find((entry) => entry.id === 'valve-c1-2');
  const socketA = (level.c1Sockets ?? []).find((entry) => entry.id === 'socket-c1-flow-a');
  const socketB = (level.c1Sockets ?? []).find((entry) => entry.id === 'socket-c1-flow-b');
  const machine = () => evaluate(cdp, "window.__probe.machine('C1-tuyere')");
  const machineOf = (machineId) =>
    evaluate(cdp, `window.__probe.machine(${JSON.stringify(machineId)})`);

  report.data.crucible = {
    parts: (level.c1Parts ?? []).length,
    sockets: (level.c1Sockets ?? []).length
  };
  if (valveA === undefined || valveB === undefined || socketA === undefined || socketB === undefined) {
    report.problems.push('crucible: the branch is not composed (no C1 parts/sockets in the probe)');
    return;
  }

  // 1. Walk in: the doorway is a real gap at x = 12 and the new floor is walkable.
  // The harness hop plans with every door taken as open, so this is a *room* check, not a
  // gate check: whether a sealed Crucible keeps the player in the hall is the boot log's
  // "branch-c=Locked (sealed)" plus the headless access-gate suite. What is proven here is
  // that the floor beyond the doorway is walkable and the socket can be stood at.
  // A direct teleport, then let the game's own physics settle: if the new floor were missing
  // or mis-positioned the capsule would fall (y below the floor) or be resolved out of a
  // collider. Route planning is deliberately not used here — it takes doors as open, so it
  // could not tell a room check from a gate check.
  report.data.crucible.entered = await enterCrucibleRoom(cdp);

  // 2. One open valve: the tuyere lights and the machine is not over-fed.
  const grabA = await grabPart(cdp, valveA);
  const dockA = await dockInto(cdp, socketA, valveA);
  await sleep(900);
  const first = await machine();
  report.data.crucible.first = {
    grabA,
    dropped: dockA.dropped === true,
    socket: dockA.hud?.socket?.text ?? null,
    outputs: first?.outputs ?? [],
    warnings: first?.warnings ?? [],
    state: first?.state ?? null
  };
  if (dockA.dropped === true) {
    report.problems.push('crucible: the first valve was soft-detached mid-carry');
  } else if ((first?.outputs ?? []).length === 0) {
    report.problems.push('crucible: one valve did not power the tuyere');
  } else if ((first?.warnings ?? []).includes('overpressure')) {
    report.problems.push('crucible: one feed already over-pressurised the tuyere');
  }

  // 3. A second open valve: the same machine now reports its ceiling. This is the branch's
  //    whole teaching, read from the graph rather than inferred from the HUD.
  const grabB = await grabPart(cdp, valveB);
  const dockB = await dockInto(cdp, socketB, valveB);
  await sleep(900);
  const second = await machine();
  report.data.crucible.second = {
    grabB,
    dropped: dockB.dropped === true,
    socket: dockB.hud?.socket?.text ?? null,
    outputs: second?.outputs ?? [],
    warnings: second?.warnings ?? [],
    state: second?.state ?? null
  };
  if (dockB.dropped === true) {
    report.problems.push('crucible: the second valve was soft-detached mid-carry');
  } else if (!(second?.warnings ?? []).includes('overpressure')) {
    report.problems.push('crucible: two open feeds did not trip the tuyere ceiling');
  }

  // 3b. The ceiling is on the HUD *before* it is hit. The graph's warning is not enough on its
  //     own — a player learns the limit from the objective surface reading the machine's own
  //     number against its declared ceiling, then sees the words when it trips. The puzzle is
  //     `Locked` on a fresh save, so the line only appears while the machine is in view (the
  //     same derivation the hint key uses). Docking leaves the reticle on the valve, which is
  //     a machine part; if it somehow does not, aim at the socket the valve now sits in.
  let hudB = await evaluate(cdp, 'window.__probe.hud()');
  let meterText = hudB?.objectiveMeter?.text ?? '';
  let focused = /Tuyere/.test(hudB?.objectiveTitle?.text ?? '');
  if (!focused) {
    const aimed = await focusTarget(cdp, valveB.id, boxOf(socketB));
    focused = aimed !== null;
    hudB = await evaluate(cdp, 'window.__probe.hud()');
    meterText = hudB?.objectiveMeter?.text ?? '';
  }
  report.data.crucible.hudMeter = {
    focused,
    title: hudB?.objectiveTitle ?? null,
    meter: hudB?.objectiveMeter ?? null,
    over: hudB?.objectiveMeterOver ?? null
  };
  if (!focused) {
    report.problems.push('crucible: the tuyere could not be brought into view, so the HUD meter was never read');
  } else if (!/Tuyere/.test(hudB?.objectiveTitle?.text ?? '')) {
    report.problems.push(
      `crucible: focusing the tuyere socket named the wrong puzzle (title "${hudB?.objectiveTitle?.text ?? ''}")`
    );
  } else if (hudB?.objectiveMeter?.hidden !== false) {
    report.problems.push('crucible: the focused tuyere shows no pressure meter (hidden on the objective surface)');
  } else if (!/Pressure 2 \/ 1\.5/.test(meterText)) {
    report.problems.push(`crucible: the HUD meter does not read the over-fed tuyere (got "${meterText}")`);
  } else if (hudB?.objectiveMeterOver !== true || !/over ceiling/.test(meterText)) {
    report.problems.push(`crucible: the over-fed tuyere is not marked over its ceiling (got "${meterText}")`);
  }

  // 4. C2 "Quench" — the combining beat, live. A plain gear preserves the crank's clockwise
  //    sense and ONE quench feed is enough; the second feed is the same ceiling C1 just taught.
  //    The puzzle is gated on a fresh save, so this proves the machine, not the reward.
  const dockPair = async (label, partId, socketId, parts, sockets) => {
    const part = (parts ?? []).find((entry) => entry.id === partId);
    const socket = (sockets ?? []).find((entry) => entry.id === socketId);
    if (part === undefined || socket === undefined) {
      report.problems.push(`crucible: ${label} is not composed (missing part or socket)`);
      return { label, found: false };
    }
    let attemptReport = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const grab = await grabPart(cdp, part);
      const dock = await dockInto(cdp, socket, part);
      await sleep(900);
      drainConsole(cdp);
      attemptReport = {
        label,
        found: true,
        attempt,
        grab: grab.focus,
        held: grab.held ?? null,
        dropped: dock.dropped === true,
        socket: dock.hud?.socket?.text ?? null
      };
      if (dock.dropped !== true) break;
    }
    return attemptReport;
  };
  const outputOf = (state, kind) => (state?.outputs ?? []).find((output) => output.kind === kind) ?? null;

  // The *idler* deliberately: the branch's direction lesson is that the sense comes from the
  // part, and C2's correct plain gear is proven by the completion run in `branch`. Here the
  // wrong part proves the near-miss live — the vessel turns ccw while the machine still runs.
  const c2Pairs = [
    await dockPair('C2 idler -> drive', 'idler-c2', 'socket-c2-drive', level.c2Parts, level.c2Sockets),
    await dockPair('C2 valve 1 -> feed A', 'valve-c2-1', 'socket-c2-feed-a', level.c2Parts, level.c2Sockets)
  ];
  await sleep(600);
  const c2First = await machineOf('C2-quench');
  report.data.crucible.c2 = {
    pairs: c2Pairs,
    first: {
      state: c2First?.state ?? null,
      rotation: outputOf(c2First, 'rotation'),
      pressure: outputOf(c2First, 'pressure'),
      warnings: c2First?.warnings ?? []
    }
  };
  const c2Rotation = outputOf(c2First, 'rotation');
  const c2Pressure = outputOf(c2First, 'pressure');
  if (c2Pairs.some((pair) => pair?.found === false)) {
    // already reported
  } else if (
    (c2First?.state ?? null) !== 'running' ||
    c2Rotation?.spin !== 'ccw' ||
    c2Rotation?.value < 1
  ) {
    report.problems.push(
      `crucible: C2 did not turn anticlockwise from the idler (state ${c2First?.state ?? '?'}, rotation ${JSON.stringify(c2Rotation)})`
    );
  } else if (c2Pressure?.value < 1) {
    report.problems.push('crucible: C2 received no quench pressure from one feed');
  } else if ((c2First?.warnings ?? []).includes('overpressure')) {
    report.problems.push('crucible: C2 over-pressurised on a single feed');
  }

  const c2Second = await dockPair('C2 valve 2 -> feed B', 'valve-c2-2', 'socket-c2-feed-b', level.c2Parts, level.c2Sockets);
  await sleep(600);
  const c2Over = await machineOf('C2-quench');
  report.data.crucible.c2.second = {
    pair: c2Second,
    state: c2Over?.state ?? null,
    pressure: outputOf(c2Over, 'pressure'),
    warnings: c2Over?.warnings ?? []
  };
  if (c2Second?.found === false) {
    // already reported
  } else if (!(c2Over?.warnings ?? []).includes('overpressure')) {
    report.problems.push('crucible: C2 did not trip its ceiling on two quench feeds');
  }

  // 5. C3 "Slag Run" — the open-ended beat's two kinds of answer, live. The cross-run (route C)
  //    alone feeds both consumers at 2 and stays under the 2.5 ceiling; adding route A stacks
  //    a run on the shared bridge, reads 3 at the casting floor and trips the ceiling.
  const c3Pairs = [
    await dockPair('C3 valve 1 -> cross-run C', 'valve-c3-1', 'socket-c3-route-c', level.c3Parts, level.c3Sockets)
  ];
  await sleep(600);
  const c3Cross = await machineOf('C3-slag');
  const c3Cast = outputOf(c3Cross, 'pressure');
  // C3's two consumers are distinct output nodes; the probe's machine state names them.
  const c3Outputs = c3Cross?.outputs ?? [];
  report.data.crucible.c3 = {
    cross: c3Pairs,
    first: { state: c3Cross?.state ?? null, outputs: c3Outputs, warnings: c3Cross?.warnings ?? [] }
  };
  if (c3Pairs.some((pair) => pair?.found === false)) {
    // already reported
  } else if ((c3Cross?.state ?? null) !== 'running') {
    report.problems.push(`crucible: the cross-run alone did not run C3 (state ${c3Cross?.state ?? '?'})`);
  } else if (c3Outputs.filter((output) => output.value >= 2).length < 2) {
    report.problems.push(
      `crucible: the cross-run did not feed both consumers at 2 (got ${JSON.stringify(c3Outputs)})`
    );
  } else if ((c3Cross?.warnings ?? []).includes('overpressure')) {
    report.problems.push('crucible: the cross-run alone tripped C3\'s ceiling');
  } else if (c3Cast !== null && c3Cast.value !== 2) {
    // `c3Cast` is the first output, kept for the report only; the pair check above is the rule.
    report.data.crucible.c3.first.note = `first output ${c3Cast.value}`;
  }

  const c3Stacked = await dockPair('C3 valve 2 -> route A', 'valve-c3-2', 'socket-c3-route-a', level.c3Parts, level.c3Sockets);
  await sleep(600);
  const c3Over = await machineOf('C3-slag');
  report.data.crucible.c3.second = {
    pair: c3Stacked,
    state: c3Over?.state ?? null,
    outputs: c3Over?.outputs ?? [],
    warnings: c3Over?.warnings ?? []
  };
  if (c3Stacked?.found === false) {
    // already reported
  } else if (!(c3Over?.warnings ?? []).includes('overpressure')) {
    report.problems.push('crucible: stacking route A on the cross-run did not trip C3\'s ceiling');
  }

  // 6. CM-3 "Great Crucible" — the staged capstone, live. Assembly (gear + pipe) is what
  //    installs the panel (ADR-018's "assembly before priming", read from the graph), the
  //    three lines prime in any order, and the pour lever follows them. The puzzle is Locked
  //    on a fresh save, so this proves the rig and the ordered vocabulary, not the reward.
  const logsBeforeCm3 = report.logs.length;
  const cm3Pairs = [
    await dockPair('CM-3 gear -> drive', 'gear-cm3', 'socket-cm3-drive', level.cm3Parts, level.cm3Sockets),
    await dockPair('CM-3 valve -> feed', 'valve-cm3', 'socket-cm3-feed', level.cm3Parts, level.cm3Sockets)
  ];
  await sleep(900);
  drainConsole(cdp);
  const cm3Built = await machineOf('CM-3');
  const cm3Props = [
    { id: 'cm3/prime-blast', x: 13.4 },
    { id: 'cm3/prime-quench', x: 14.6 },
    { id: 'cm3/prime-slag', x: 15.8 },
    { id: 'cm3/engage', x: 17.6 }
  ];
  const cm3Presses = await pressStagedProps(cdp, cm3Props, 30.4, 30.8);
  await sleep(900);
  drainConsole(cdp);
  const cm3Logs = report.logs.slice(logsBeforeCm3).join('\n');
  report.data.crucible.cm3 = {
    pairs: cm3Pairs,
    built: { state: cm3Built?.state ?? null, outputs: cm3Built?.outputs ?? [], warnings: cm3Built?.warnings ?? [] },
    rigInstalled: /\[staged\] CM-3 structure complete/.test(cm3Logs),
    primed: /\[staged\] CM-3 primed — engage to activate/.test(cm3Logs),
    presses: cm3Presses
  };
  if (cm3Pairs.some((pair) => pair?.found === false)) {
    // already reported
  } else if ((cm3Built?.outputs ?? []).length !== 2) {
    report.problems.push(
      `crucible: CM-3 assembly did not produce both outputs (got ${JSON.stringify(cm3Built?.outputs ?? [])})`
    );
  }
  if (!report.data.crucible.cm3.rigInstalled) {
    report.problems.push('crucible: CM-3 assembly did not install the staged panel');
  }
  if (!report.data.crucible.cm3.primed) {
    report.problems.push('crucible: CM-3 did not report all three priming lines open');
  }
  for (const press of cm3Presses) {
    if (press.focus === 'NOT FOCUSABLE') {
      report.problems.push(`crucible: CM-3's ${press.id} was not focusable`);
    }
  }
  if ((cm3Presses.find((press) => press.id === 'cm3/engage')?.focus ?? 'NOT FOCUSABLE') === 'NOT FOCUSABLE') {
    report.problems.push('crucible: CM-3\'s pour lever was not focusable after priming');
  }

  // 7. The gate is honest: a fresh save cannot have any of this in progress, whatever the
  //    graph says.
  report.data.crucible.progress = await evaluate(cdp, 'window.__probe.progress()');
  if ((report.data.crucible.progress?.branchC ?? null) !== 'Locked') {
    report.problems.push(
      `crucible: Branch C is not Locked on a fresh save (got ${report.data.crucible.progress?.branchC ?? 'null'})`
    );
  }
  drainConsole(cdp);
}

/**
 * Enter the Crucible room and let the game's own physics answer whether the floor is there.
 *
 * Shared by `crucible` and `decoy`: both stand the player on the new floor, and neither uses
 * route planning for the entry (it takes every door as open, so it cannot tell a room check
 * from a gate check). Returns the record the scenarios report, and pushes a problem directly
 * when the room does not hold the player up.
 */
async function enterCrucibleRoom(cdp) {
  await evaluate(cdp, 'window.__probe.teleport(12.2, 0.06, 24.4)');
  await sleep(900);
  const landed = await evaluate(cdp, 'window.__probe.state()');
  const entered = {
    pos: landed.pos,
    grounded: landed.grounded,
    inRoom: landed.pos.x > 9 && landed.pos.z > 21 && landed.pos.y > -0.2
  };
  if (!entered.inRoom || landed.grounded !== true) {
    report.problems.push(
      `crucible: the new room does not hold the player up at (12.2, 24.4) — ${JSON.stringify(landed.pos)}, grounded=${landed.grounded}`
    );
  }
  return entered;
}

/**
 * THE WRONG BUILDS, played (27/10/2026).
 *
 * `STATUS.md` item 4's gap: the shut-off valve's jam (C1), the blanking plate (C2) and the
 * idler's *reason* (C2) were asserted in the logic suite and nowhere in the browser. The
 * harness proved position and state; it never proved that seat the wrong part and the machine
 * refuses — and that the objective surface tells the player why.
 *
 * Each case is played on the same fresh board, one machine at a time: the parts are
 * per-machine instances (`shutoff-c1`, `plate-c2`, `idler-c2`), so a refusal costs one dock and
 * leaves the other machines untouched.
 *
 * §25 gating is honest and a fresh save has every branch puzzle `Locked`, which publishes *no*
 * reasons — so the scenario first walks each puzzle through the SM's own `unlock()`/`begin()`
 * (the dev-only `puzzleOpen`, the same two calls `syncBranchAccess` makes when a branch opens).
 * That is what makes the refusal a *reason the player reads* rather than a machine state: an
 * open puzzle publishes its failed requirements on the objective surface.
 *
 * The progress assertions at the end still hold the gate to account: opening a puzzle for the
 * harness is not opening the branch.
 */
async function scenarioDecoy(cdp) {
  const level = await evaluate(cdp, 'window.__probe.level()');
  const machineOf = (machineId) =>
    evaluate(cdp, `window.__probe.machine(${JSON.stringify(machineId)})`);
  const puzzleOf = (puzzleId) =>
    evaluate(cdp, `window.__probe.puzzle(${JSON.stringify(puzzleId)})`);
  const openPuzzle = (puzzleId) =>
    evaluate(cdp, `window.__probe.puzzleOpen(${JSON.stringify(puzzleId)})`);
  const socketOf = (sockets, id) => (sockets ?? []).find((entry) => entry.id === id) ?? null;
  const partOf = (parts, id) => (parts ?? []).find((entry) => entry.id === id) ?? null;

  report.data.decoy = {};
  report.data.decoy.entered = await enterCrucibleRoom(cdp);

  /** Seat one wrong part and read both authorities: the graph and the puzzle SM. */
  const refuse = async (label, partId, socketId, machineId, puzzleId, parts, sockets) => {
    const part = partOf(parts, partId);
    const socket = socketOf(sockets, socketId);
    if (part === null || socket === null) {
      report.problems.push(`decoy: ${label} is not composed (missing part or socket)`);
      return { label, found: false };
    }
    const opened = await openPuzzle(puzzleId);
    const grab = await grabPart(cdp, part);
    const dock = await dockInto(cdp, socket, part);
    await sleep(900);
    drainConsole(cdp);
    const state = await machineOf(machineId);
    const puzzle = await puzzleOf(puzzleId);
    return {
      label,
      found: true,
      opened,
      grab: grab.focus,
      held: grab.held ?? null,
      dropped: dock.dropped === true,
      socket: dock.hud?.socket?.text ?? null,
      machine: { state: state?.state ?? null, outputs: state?.outputs ?? [], warnings: state?.warnings ?? [] },
      puzzle,
      box: (await evaluate(cdp, `window.__probe.partBox(${JSON.stringify(partId)})`).catch(() => null)) ?? boxOf(part)
    };
  };

  /** Focus a part and read the objective line the player is looking at. */
  const readObjective = async (targetId, box) => {
    const aimed = await focusTarget(cdp, targetId, box);
    const hud = await evaluate(cdp, 'window.__probe.hud()');
    return {
      focused: aimed !== null,
      title: hud?.objectiveTitle?.text ?? null,
      state: hud?.objectiveState?.text ?? null,
      failure: hud?.objectiveFailure?.text ?? null
    };
  };

  // 1. C1: a shut-off valve fits the blast port, conducts nothing and jams the machine.
  //    Three things are asserted: the machine reports `jammed`, no output exists, and the
  //    open puzzle names the two failures. Then the line the player reads. The two reasons are
  //    the same pair the logic suite pins — `c1/blast-line` and `c1/no-jam` — and the branch's
  //    ceiling requirement must *not* be among them: a jam is not an overpressure.
  const shutoff = await refuse(
    'C1 shut-off valve -> blast port',
    'shutoff-c1',
    'socket-c1-flow-a',
    'C1-tuyere',
    'C1',
    level.c1Parts,
    level.c1Sockets
  );
  report.data.decoy.shutoff = shutoff;
  if (shutoff.found === false) {
    // already reported
  } else if (shutoff.dropped === true) {
    report.problems.push('decoy: the shut-off valve was soft-detached mid-carry');
  } else if (shutoff.machine.state !== 'jammed') {
    report.problems.push(
      `decoy: a shut-off valve in the blast port did not jam C1 (state ${shutoff.machine.state ?? 'null'})`
    );
  } else if ((shutoff.machine.outputs ?? []).length !== 0) {
    report.problems.push(
      `decoy: the jammed tuyere still reports output (${JSON.stringify(shutoff.machine.outputs ?? [])})`
    );
  } else if (!(shutoff.puzzle?.reasonCodes ?? []).includes('c1/no-jam')) {
    report.problems.push(
      `decoy: C1 does not name the jam (reasons ${JSON.stringify(shutoff.puzzle?.reasonCodes ?? null)})`
    );
  } else if (!(shutoff.puzzle?.reasonCodes ?? []).includes('c1/blast-line')) {
    report.problems.push(
      `decoy: C1 does not name the broken blast line (reasons ${JSON.stringify(shutoff.puzzle?.reasonCodes ?? null)})`
    );
  } else if ((shutoff.puzzle?.reasonCodes ?? []).includes('c1/no-overpressure')) {
    report.problems.push('decoy: C1 blames the ceiling for a jammed run');
  }
  if (shutoff.found !== false && shutoff.dropped !== true) {
    // The objective surface shows the *first* failed requirement in the authored order, which
    // for a dead blast line is "Run pipework from the furnace to the tuyere" — the jam reason is
    // second. Both are on the SM (asserted above); what this measures is that the pane names
    // *some* outstanding requirement while the player stands at the dead machine, rather than
    // the empty line a gated puzzle shows.
    const line = await readObjective('shutoff-c1', shutoff.box);
    report.data.decoy.shutoffObjective = line;
    if (!line.focused) {
      report.problems.push('decoy: the seated shut-off valve could not be brought into view');
    } else if (!/Tuyere/.test(line.title ?? '')) {
      report.problems.push(`decoy: the dead tuyere named the wrong puzzle (got "${line.title ?? ''}")`);
    } else if ((line.failure ?? '').trim() === '') {
      report.problems.push('decoy: the objective surface names no requirement for the jammed run');
    }
  }

  // 2. C2: the blanking plate fits the drive mount and bridges nothing. The open puzzle must
  //    name the unbridged drive and *not* the sense: nothing turns, so there is no wrong
  //    direction to blame.
  const plate = await refuse(
    'C2 blanking plate -> drive mount',
    'plate-c2',
    'socket-c2-drive',
    'C2-quench',
    'C2',
    level.c2Parts,
    level.c2Sockets
  );
  report.data.decoy.plate = plate;
  if (plate.found === false) {
    // already reported
  } else if (plate.dropped === true) {
    report.problems.push('decoy: the blanking plate was soft-detached mid-carry');
  } else if ((plate.machine.outputs ?? []).find((output) => output.kind === 'rotation') !== undefined) {
    report.problems.push('decoy: a blanking plate on the drive still turned the vessel');
  } else if (!(plate.puzzle?.reasonCodes ?? []).includes('c2/drive-coupled')) {
    report.problems.push(
      `decoy: C2 does not name the unbridged drive (reasons ${JSON.stringify(plate.puzzle?.reasonCodes ?? null)})`
    );
  }
  // `c2/drive-sense` also fails here, and correctly: nothing turns, so the requirement that the
  // vessel turn clockwise is unmet. The plate's *identity* is the `drive-coupled` reason, which
  // is what separates it from the idler case below (the idler bridges and turns the wrong way).

  // 3. The plate comes out again through the game's own detach rule (ARCH §19 `DetachPrompt`:
  //    a first `primary` while an attached part is focused, then the detach). This is the first
  //    live exercise of that path, so each step is recorded — a refusal (EC-MAN-01, no free
  //    pose) is a finding, not a scenario bug, and must be visible in the report either way.
  let detached = null;
  if (plate.found !== false && plate.dropped !== true) {
    // Re-aim at where the plate now *is*: the dock left the reticle on the socket marker, and
    // the SM's detach state is only reachable from a focus on the attached component itself.
    const live = await evaluate(cdp, "window.__probe.partBox('plate-c2')").catch(() => null);
    const aimed = await focusTarget(cdp, 'plate-c2', live ?? plate.box);
    if (aimed === null) {
      detached = { focused: false };
    } else {
      const verb = aimed.focus.verb;
      const hudBefore = await evaluate(cdp, 'window.__probe.hud()');
      await tapKey(cdp, 'KeyE');
      await sleep(500);
      const hudPrompt = await evaluate(cdp, 'window.__probe.hud()');
      await tapKey(cdp, 'KeyE');
      await sleep(900);
      const state = await machineOf('C2-quench');
      const hud = await evaluate(cdp, 'window.__probe.hud()');
      detached = {
        focused: true,
        verb,
        socketBefore: hudBefore?.socket?.text ?? null,
        promptSocket: hudPrompt?.socket?.text ?? null,
        machine: state?.state ?? null,
        held: hud?.held?.text ?? null
      };
    }
    report.data.decoy.detached = detached;
    if (detached.focused !== true) {
      report.problems.push('decoy: the seated plate could not be focused for its detach');
    } else if (detached.machine === 'jammed') {
      // A refused detach leaves the part mounted (EC-MAN-01), which is honest but means the
      // idler case below cannot use this socket.
      report.data.decoy.detachNote = 'detach refused or incomplete — see the recorded state';
    }
  }

  // 4. C2 again: the idler fits the same mount, the machine still runs — and turns the wrong
  //    way. That is the difference between "no drive" and "the wrong drive", and the open
  //    puzzle must name the second. If the plate could not be detached, the idler goes to the
  //    free quench feed instead and the sense case is reported as the finding it is.
  const idlerSocket =
    (detached?.held ?? '').includes('plate-c2') || detached === null || detached.machine === 'jammed'
      ? 'socket-c2-feed-b'
      : 'socket-c2-drive';
  report.data.decoy.idlerSocket = idlerSocket;
  const idler = await refuse(
    `C2 idler gear -> ${idlerSocket === 'socket-c2-drive' ? 'drive mount' : 'free feed'}`,
    'idler-c2',
    idlerSocket,
    'C2-quench',
    'C2',
    level.c2Parts,
    level.c2Sockets
  );
  report.data.decoy.idler = idler;
  if (idler.found === false) {
    // already reported
  } else if (idler.dropped === true) {
    report.problems.push('decoy: the idler was soft-detached mid-carry');
  } else if (idlerSocket === 'socket-c2-drive') {
    const spin = (idler.machine.outputs ?? []).find((output) => output.kind === 'rotation')?.spin ?? null;
    if (spin !== 'ccw') {
      report.problems.push(`decoy: the idler did not turn the vessel anticlockwise (spin ${spin ?? 'null'})`);
    } else if (!(idler.puzzle?.reasonCodes ?? []).includes('c2/drive-sense')) {
      report.problems.push(
        `decoy: C2 does not name the wrong sense (reasons ${JSON.stringify(idler.puzzle?.reasonCodes ?? null)})`
      );
    }
  } else if (idler.held !== 'idler-c2') {
    report.problems.push(`decoy: the idler could not be seated in the free feed (held ${idler.held ?? 'null'})`);
  }

  // 5. The gate stays honest, exactly as in `crucible`: opening a puzzle for the harness, or
  //    building a machine, never opens the branch on a fresh save.
  report.data.decoy.progress = await evaluate(cdp, 'window.__probe.progress()');
  if ((report.data.decoy.progress?.branchC ?? null) !== 'Locked') {
    report.problems.push(
      `decoy: Branch C is not Locked on a fresh save (got ${report.data.decoy.progress?.branchC ?? 'null'})`
    );
  }
  drainConsole(cdp);
}

/**
 * THE WEAPONS PASS, played (16/10/2026).
 *
 * The headless suites prove the rules (fire modes, rpm, magazines, recoil patterns, the
 * bullet pool); this is the *feel* gate the plan asks for, and it is measured rather than
 * watched — the numbers it reports are the composition's own:
 *
 *   - every slot fires, spends rounds and produces tracers through the real input path;
 *   - a magazine reloads from reserve, and a switch cancels a reload in flight;
 *   - ADS closes the camera's own lens (`currentFov()`) and slows the walk;
 *   - crouch is a real stance the weapon reads;
 *   - firing for a long time leaves the bullet/tracer pools flat (`poolDrops` stays 0);
 *   - the left button fires while `KeyE` still grabs (the Phase C action split);
 *   - and `?guns=0` restores the pre-pass game exactly — no weapon, no HUD block, no shot.
 *
 * Every stage records what happened even when it fails, so a red run is a diagnosis.
 */
async function scenarioGuns(cdp) {
  const readWeapon = async () => evaluate(cdp, 'window.__probe.weapon()');
  const hud = async () => evaluate(cdp, 'window.__probe.hud()');
  const pause = (ms) => sleep(ms);

  const started = await readWeapon();
  if (started === null) {
    report.problems.push('guns: no weapon system composed with weapons on (expected one)');
    report.data.guns = { weapon: null };
    return;
  }
  report.data.guns = {
    start: started.view,
    slots: [],
    ads: null,
    crouch: null,
    pool: null,
    grabSplit: null,
    disabled: null
  };

  const slotCount = started.view.slotCount;
  for (let slot = 0; slot < slotCount; slot += 1) {
    const row = { slot: slot + 1 };
    await tapKey(cdp, `Digit${slot + 1}`);
    await pause(900); // the swap timer has to elapse before the weapon will fire
    const selected = await readWeapon();
    row.name = selected.view.name;
    row.classLabel = selected.view.classLabel;
    row.fireMode = selected.view.fireModeLabel;
    row.ammoBefore = `${selected.view.magazine}/${selected.view.reserve}`;
    const shotsBefore = selected.stats.shotsFired;

    // Hold the trigger long enough to fire however this class fires. The watch runs in the
    // page for the whole window, so a single shot's 0.1 s tracer is caught rather than
    // missed between reads.
    const framesBefore = await evaluate(cdp, 'window.__probe.frames()');
    await evaluate(cdp, 'window.__probe.startEffectsWatch()');
    await mouseDown(cdp, 'left');
    await pause(700);
    await mouseUp(cdp, 'left');
    await pause(180);
    const after = await readWeapon();
    const peaks = await evaluate(cdp, 'window.__probe.stopEffectsWatch()');
    const framesAfter = await evaluate(cdp, 'window.__probe.frames()');
    row.frames = framesAfter === null || framesBefore === null ? null : framesAfter - framesBefore;
    row.shots = after.stats.shotsFired - shotsBefore;
    row.rounds = after.stats.roundsSpent - selected.stats.roundsSpent;
    row.ammoAfter = `${after.view.magazine}/${after.view.reserve}`;
    row.tracersDrawn = peaks.tracers;
    row.impactsDrawn = peaks.impacts;
    row.spreadAfterSpray = Number(after.view.spread.toFixed(4));

    // Reload: the magazine refills from reserve, and the reload takes time to finish. The
    // wait covers the longest authored *empty* reload (3.6 s), because a spray may have
    // emptied the magazine — which is exactly when the slower reload should be seen.
    const magBefore = after.view.magazine;
    await tapKey(cdp, 'KeyR');
    await pause(120);
    row.reloadingDuringReload = (await readWeapon()).view.reloading;
    await pause(4200);
    const reloaded = await readWeapon();
    row.reloaded = `${reloaded.view.magazine}/${reloaded.view.reserve}`;
    row.reloadRefilled = reloaded.view.magazine > magBefore;
    row.reloadingAfter = reloaded.view.reloading;

    report.data.guns.slots.push(row);
    if (row.shots <= 0) report.problems.push(`guns: slot ${slot + 1} (${row.name}) fired nothing`);
    if (row.tracersDrawn <= 0) {
      report.problems.push(`guns: slot ${slot + 1} (${row.name}) drew no tracer`);
    }
    if (row.reloadRefilled !== true) {
      report.problems.push(`guns: slot ${slot + 1} (${row.name}) did not refill on reload`);
    }
    drainConsole(cdp);
  }

  // --- a switch mid-reload cancels the reload (a real state machine, not a timer) ------
  await tapKey(cdp, 'Digit1');
  await pause(900);
  await mouseDown(cdp, 'left');
  await pause(200);
  await mouseUp(cdp, 'left');
  await tapKey(cdp, 'KeyR');
  await pause(150);
  const duringReload = await readWeapon();
  await tapKey(cdp, 'Digit2');
  await pause(150);
  const afterSwitch = await readWeapon();
  report.data.guns.switchCancelsReload = {
    reloadingBeforeSwitch: duringReload.view.reloading,
    reloadingAfterSwitch: afterSwitch.view.reloading,
    slotAfter: afterSwitch.view.activeSlot + 1,
    swapSeen: afterSwitch.stats.switches > started.stats.switches
  };
  if (duringReload.view.reloading !== true || afterSwitch.view.reloading !== false) {
    report.problems.push('guns: a switch did not cancel the reload in flight');
  }

  // --- ADS: the camera's own lens closes, and the walk really slows --------------------
  await tapKey(cdp, 'Digit1');
  await pause(900);
  const fovHip = await evaluate(cdp, 'window.__probe.fov()');
  await mouseDown(cdp, 'right');
  await pause(500);
  const adsView = await readWeapon();
  const fovAim = await evaluate(cdp, 'window.__probe.fov()');
  const adsState = await evaluate(cdp, 'window.__probe.state()');
  await mouseUp(cdp, 'right');
  await pause(500);
  const fovBack = await evaluate(cdp, 'window.__probe.fov()');
  // The blend eases back at 9/s, so it is fully released within a few frames — but the
  // headless renderer runs at ~25 fps, so the wait has to cover *frames*, not just time.
  await pause(1200);
  const fovSettled = await evaluate(cdp, 'window.__probe.fov()');
  report.data.guns.ads = {
    blendAiming: Number(adsView.view.adsBlend.toFixed(3)),
    fovHip: Number(fovHip.toFixed(3)),
    fovAiming: Number(fovAim.toFixed(3)),
    fovRestored: Number(fovSettled.toFixed(3)),
    fovRestoredImmediately: Number(fovBack.toFixed(3)),
    moveScaleAiming: Number(adsView.view.moveScale.toFixed(3)),
    walkSpeedWhileAiming: adsState.walkSpeed ?? null
  };
  if (report.data.guns.ads.blendAiming <= 0.5) {
    report.problems.push('guns: aiming down sights did not blend in');
  }
  if (!(fovAim < fovHip)) report.problems.push('guns: ADS did not close the camera lens');
  if (Math.abs(fovSettled - fovHip) > 0.05) {
    report.problems.push('guns: the lens did not come back after releasing aim');
  }

  // --- crouch is a real stance the weapon reads, and it really slows the walk ----------
  // Measured by walking: the read model's `walkSpeed` is deliberately the *nominal* walk
  // (what the weapon layer speaks in fractions of), so the stance's own cost shows up in
  // the speed the player actually reaches.
  const walkSpeedFor = async (crouch) => {
    if (crouch) await keyDown(cdp, 'KeyC');
    await pause(250);
    await keyDown(cdp, 'KeyW');
    await pause(900);
    const state = await evaluate(cdp, 'window.__probe.state()');
    await keyUp(cdp, 'KeyW');
    if (crouch) await keyUp(cdp, 'KeyC');
    await pause(700);
    return state;
  };
  const crouchedState = await walkSpeedFor(true);
  const standingState = await walkSpeedFor(false);
  report.data.guns.crouch = {
    crouched: crouchedState.crouched,
    standing: standingState.crouched,
    speedWhileCrouched: Number(crouchedState.speed.toFixed(3)),
    speedStanding: Number(standingState.speed.toFixed(3)),
    nominalWalkSpeed: standingState.walkSpeed ?? null,
    moveScaleWhileCrouched: Number((await readWeapon()).view.moveScale.toFixed(3))
  };
  if (crouchedState.crouched !== true || standingState.crouched !== false) {
    report.problems.push('guns: the crouch key did not move the stance');
  }
  if (!(crouchedState.speed < standingState.speed)) {
    report.problems.push(
      `guns: crouching did not slow the walk (${crouchedState.speed} vs ${standingState.speed} m/s)`
    );
  }

  // --- the pool is a budget: empty several magazines and watch it stay flat ------------
  await tapKey(cdp, 'Digit2'); // the SMG: fastest cadence, the worst case for pooling
  await pause(900);
  // The render budget, before anything is fired: the drawn weapon is part of the frame
  // (it is not holstered while empty-handed), so this is the baseline the burst adds to.
  const idleBudget = await evaluate(cdp, 'window.__probe.renderStats()');
  const poolBefore = (await readWeapon()).stats.poolPeak;
  let dumps = 0;
  let peakTracers = 0;
  let peakImpacts = 0;
  let burstDraws = 0;
  let burstTriangles = 0;
  for (let burst = 0; burst < 4; burst += 1) {
    await evaluate(cdp, 'window.__probe.startEffectsWatch()');
    await mouseDown(cdp, 'left');
    await pause(300);
    // Sampled *while firing*: a pooled presentation must not add draws as it fills.
    const burstBudget = await evaluate(cdp, 'window.__probe.renderStats()');
    if (burstBudget !== null) {
      burstDraws = Math.max(burstDraws, burstBudget.drawCalls);
      burstTriangles = Math.max(burstTriangles, burstBudget.triangles);
    }
    await pause(600);
    await mouseUp(cdp, 'left');
    const peaks = await evaluate(cdp, 'window.__probe.stopEffectsWatch()');
    peakTracers = Math.max(peakTracers, peaks.tracers);
    peakImpacts = Math.max(peakImpacts, peaks.impacts);
    await tapKey(cdp, 'KeyR');
    await pause(3000); // the SMG's empty reload is 2.2 s; leave room for the cadence
    dumps += 1;
  }
  const poolAfter = await readWeapon();
  report.data.guns.pool = {
    bursts: dumps,
    shotsFired: poolAfter.stats.shotsFired,
    impacts: poolAfter.stats.impacts,
    poolPeakBefore: poolBefore,
    poolPeakAfter: poolAfter.stats.poolPeak,
    poolDrops: poolAfter.stats.poolDrops,
    liveBullets: poolAfter.stats.liveBullets,
    peakTracersDrawn: peakTracers,
    peakImpactsDrawn: peakImpacts,
    drawCallsIdle: idleBudget?.drawCalls ?? null,
    drawCallsFiring: burstDraws,
    trianglesIdle: idleBudget?.triangles ?? null,
    trianglesFiring: burstTriangles
  };
  if (poolAfter.stats.poolDrops !== 0) {
    report.problems.push(`guns: the bullet pool dropped ${poolAfter.stats.poolDrops} spawn(s)`);
  }
  // The presenter's own cap (DEFAULT_WEAPON_EFFECTS_TUNING): a long burst must not grow it.
  if (peakTracers > 24) {
    report.problems.push(`guns: the tracer pool grew to ${peakTracers} (cap 24)`);
  }
  // The plan's budget rule: `stats()` must not grow with how much you shoot. Both pools are
  // pre-allocated and the drawn weapon is a single merged mesh, so a burst may add the two
  // effect buffers and no more.
  if (idleBudget !== null && burstDraws > idleBudget.drawCalls + 3) {
    report.problems.push(
      `guns: firing grew the frame from ${idleBudget.drawCalls} to ${burstDraws} draw calls`
    );
  }

  // --- the action split: the left button fires, KeyE still grabs (Plan issue #2) --------
  const level = await evaluate(cdp, 'window.__probe.level()');
  const part = level.p1[0] ?? null;
  if (part !== null) {
    const live = await evaluate(cdp, `window.__probe.partBox('${part.id}')`).catch(() => null);
    const found = await focusTarget(cdp, part.id, live ?? boxOf(part));
    if (found === null) {
      report.data.guns.grabSplit = { part: part.id, focus: 'NOT FOCUSABLE' };
      report.problems.push(`guns: ${part.id} was not focusable for the grab-split check`);
    } else {
      await clickAt(cdp, 800, 450); // the left button must NOT grab
      await pause(500);
      const afterClick = await evaluate(cdp, 'window.__probe.hud()');
      await tapKey(cdp, 'KeyE'); // ...but KeyE must
      await pause(500);
      const afterKey = await evaluate(cdp, 'window.__probe.hud()');
      // Carrying holsters the weapon, so *this* page gives the clean comparison the budget
      // claim wants: same scene, same frame, with and without a drawn weapon.
      const carryingBudget = await evaluate(cdp, 'window.__probe.renderStats()');
      report.data.guns.grabSplit = {
        part: part.id,
        heldAfterLeftClick: afterClick.held?.text ?? null,
        heldAfterKeyE: afterKey.held?.text ?? null,
        drawCallsWhileCarrying: carryingBudget?.drawCalls ?? null,
        drawCallsEmptyHanded: idleBudget?.drawCalls ?? null
      };
      report.data.guns.routePlanning =
        (await evaluate(cdp, 'window.__probe.colliderNote()')) ?? 'available';
      if (
        carryingBudget !== null &&
        idleBudget !== null &&
        !(carryingBudget.drawCalls < idleBudget.drawCalls)
      ) {
        report.problems.push(
          `guns: the drawn weapon is not in the frame (${carryingBudget.drawCalls} draw calls carrying vs ${idleBudget.drawCalls} empty-handed)`
        );
      }
      if ((afterClick.held?.text ?? '').includes(part.id) === false && (afterKey.held?.text ?? '').includes(part.id) === false) {
        report.problems.push('guns: neither the left button nor KeyE picked the part up');
      }
      if ((afterClick.held?.text ?? '').includes(part.id)) {
        report.problems.push('guns: the left button grabbed a part — it owns firing now');
      }
    }
  }
  drainConsole(cdp);

  // --- the escape hatch: `?guns=0` is the pre-pass game ---------------------------------
  // The page is navigated fresh, so nothing from the fired-away state above carries over.
  const offUrl = BASE.replace(/([?&])guns=\d+/, '$1guns=0');
  const target = offUrl.includes('guns=0') ? offUrl : `${BASE}&guns=0`;
  // A full boot (navigate + wait for the game + re-inject the probe): a fresh page is the
  // honest test of the escape hatch, and the probe does not survive a navigation.
  await boot(cdp, target);
  const offState = await evaluate(
    cdp,
    `(() => ({
      weapon: window.__probe.weapon(),
      effects: window.__probe.weaponEffects(),
      hudWeaponHidden: document.querySelector('.gw-hud-weapon')?.classList.contains('gw-hud-hidden') ?? null,
      state: window.__probe.state()
    }))()`
  );
  await mouseDown(cdp, 'left');
  await pause(300);
  await mouseUp(cdp, 'left');
  await pause(200);
  const offAfterFire = await evaluate(cdp, 'window.__probe.weaponEffects()');
  drainConsole(cdp);
  const offBudget = await evaluate(cdp, 'window.__probe.renderStats()');
  report.data.guns.disabled = {
    weapon: offState.weapon,
    hudWeaponHidden: offState.hudWeaponHidden,
    tracersAfterFiring: offAfterFire?.tracers ?? null,
    drawCalls: offBudget?.drawCalls ?? null,
    triangles: offBudget?.triangles ?? null,
    lifecycle: offState.state?.lifecycle ?? null
  };

  if (offState.weapon !== null) report.problems.push('guns: ?guns=0 still composed a weapon system');
  if (offState.hudWeaponHidden !== true) report.problems.push('guns: ?guns=0 left the HUD weapon block up');
  if ((offAfterFire?.tracers ?? 0) !== 0) report.problems.push('guns: ?guns=0 still drew tracers');
  drainConsole(cdp);
}

async function scenarioBm1(cdp) {
  const level = await evaluate(cdp, 'window.__probe.level()');
  report.data.bm1Start = await evaluate(cdp, 'window.__probe.hud()');
  report.data.bm1 = await playBm1Sequence(cdp, level);
  report.data.bm1Logs = report.logs.slice(-40);
}

/**
 * THE FORGE, played (27/10/2026).
 *
 * ARCH §28's promise is that materials are "only used for upgrades"; before this pass nothing
 * read them. This check drives the whole loop through the real composition: seed what the
 * branches would have paid (a dev-only grant, stated as such — it writes through the same
 * inventory API the reward system uses), walk to the Regulator's fitting, read the prompt it
 * writes from the live pipeline, press it, and then measure every consequence that matters:
 *
 *   - the materials left the inventory, by exactly the authored cost;
 *   - the level and the *derived* reach both moved (`InteractionSystem.range`);
 *   - the HUD grew a row for the forged upgrade;
 *   - the autosave was written, and a reload restores the level and the effect;
 *   - pressing again with a short purse refuses without charging or changing anything.
 *
 * What no check can decide is whether a 4 m reach *feels* right; that is the owner's call and
 * is why the numbers live in one data file.
 */
async function scenarioForge(cdp) {
  const forgeBox = {
    min: { x: -1.05, y: 0.3, z: 13.66 },
    max: { x: 1.05, y: 1.1, z: 13.99 }
  };
  const upgrades = () => evaluate(cdp, 'window.__probe.upgrades()');
  const materials = () =>
    evaluate(cdp, '(window.__probe.hud()?.materials ?? []).map((row) => row.text)');

  report.data.forge = {};

  // 1. Stand in front of the Regulator and seed the forge's own price (2 scrap + 2 brass
  //    for the first level), plus nothing else: the refusal below needs a short purse.
  await evaluate(cdp, 'window.__probe.teleport(0, 0.06, 12.0)');
  await sleep(600);
  const granted = await evaluate(cdp, 'window.__probe.grantMaterials({ scrap: 2, brass: 2 })');
  report.data.forge.granted = granted;
  const before = await upgrades();
  report.data.forge.before = before;
  if (before === null) {
    report.problems.push('forge: the upgrade pipeline is not composed (no probe read)');
    return;
  }
  if (before.next === null) {
    report.problems.push('forge: a fresh save offers nothing to forge');
    return;
  }
  // The first offer is the reach upgrade; the run asserts the *pipeline's* numbers, so it
  // reads the cost from the same table the game used rather than hard-coding it here.
  const expectedCost = await evaluate(
    cdp,
    '(async () => { const mod = await import(\'/src/data/upgrades.ts\'); const d = mod.UPGRADE_DEFINITIONS[0]; return d === undefined ? null : { id: d.id, title: d.title, cost: d.levels[0].cost }; })()'
  ).catch(() => null);
  report.data.forge.expected = expectedCost;
  if (expectedCost === null) {
    report.problems.push('forge: could not read the published upgrade table (dev sources unavailable?)');
    return;
  }
  if (expectedCost.id !== before.next.id) {
    report.problems.push(
      `forge: the bench offers ${before.next.id}, but the table's first upgrade is ${expectedCost.id}`
    );
  }

  // 2. Focus the fitting. Its verb is written by the composition from the live pipeline, so
  //    reading it here proves the prompt agrees with what a press will do.
  const aimed = await focusTarget(cdp, 'forge/regulator', forgeBox, 3.4);
  report.data.forge.focus = aimed === null ? 'NOT FOCUSABLE' : aimed.focus;
  if (aimed === null) {
    report.problems.push('forge: the Regulator\'s fitting is not focusable from in front of it');
    return;
  }
  if (!/Forge/.test(aimed.focus.verb)) {
    report.problems.push(`forge: the prompt does not name the forge (verb "${aimed.focus.verb}")`);
  }
  for (const cost of expectedCost.cost) {
    if (!new RegExp(`\\b${cost.amount} ${cost.kind}\\b`).test(aimed.focus.verb)) {
      report.problems.push(
        `forge: the prompt does not name its cost ${cost.amount} ${cost.kind} (verb "${aimed.focus.verb}")`
      );
    }
  }

  // 3. Forge it. The material panel is read before and after so the *inventory* is the
  //    authority on the spend, not the toast.
  const materialsBefore = await materials();
  const logsBefore = report.logs.length;
  await tapKey(cdp, 'KeyE');
  await sleep(900);
  drainConsole(cdp);
  const after = await upgrades();
  const hud = await evaluate(cdp, 'window.__probe.hud()');
  const fresh = report.logs.slice(logsBefore).join('\n');
  report.data.forge.after = {
    materialsBefore,
    materialsAfter: await materials(),
    upgrades: after,
    upgradeRows: hud.upgradeRows,
    logged: /\[upgrade\] /.test(fresh),
    autosaved: /\[save\] autosave written/.test(fresh)
  };
  if (after === null || after.levels[expectedCost.id] !== 1) {
    report.problems.push(
      `forge: the press did not forge level 1 (levels ${JSON.stringify(after?.levels ?? null)})`
    );
  } else if (!(after.interactionRange > before.interactionRange)) {
    report.problems.push(
      `forge: the reach did not move with the upgrade (${before.interactionRange} → ${after.interactionRange})`
    );
  } else if (!/(^|\s)0(\s|$)/.test((report.data.forge.after.materialsAfter ?? []).join(' '))) {
    report.problems.push(
      `forge: the materials were not spent (panel ${JSON.stringify(report.data.forge.after.materialsAfter)})`
    );
  } else if (!report.data.forge.after.autosaved) {
    report.problems.push('forge: forging an upgrade did not autosave');
  } else if (
    !(hud.upgradeRows ?? []).some(
      (row) => row.hidden !== true && /1\/2/.test(row.text ?? '') && row.text.includes(expectedCost.title)
    )
  ) {
    report.problems.push(
      `forge: the HUD does not show the forged upgrade (rows ${JSON.stringify(hud.upgradeRows ?? [])})`
    );
  }

  // 4. Press again with an empty purse: the refusal must charge nothing and change nothing.
  const refusedBefore = await upgrades();
  await tapKey(cdp, 'KeyE');
  await sleep(700);
  const refusedAfter = await upgrades();
  report.data.forge.refused = {
    before: refusedBefore?.levels ?? null,
    after: refusedAfter?.levels ?? null,
    materials: await materials()
  };
  if (JSON.stringify(refusedBefore?.levels ?? {}) !== JSON.stringify(refusedAfter?.levels ?? {})) {
    report.problems.push('forge: an unaffordable press still changed the levels');
  }

  // 5. The reload clause: the level is canonical, so a fresh boot restores it *and* the reach
  //    it implies — the derived effect is never persisted, it is recomputed.
  const logsBeforeReload = report.logs.length;
  await boot(cdp);
  drainConsole(cdp);
  const reloadLogs = report.logs.slice(logsBeforeReload).join('\n');
  const restored = await upgrades();
  report.data.forge.reload = {
    loaded: /\\[save\\] loaded autosave/.test(reloadLogs),
    upgrades: restored,
    materials: await materials()
  };
  if (restored === null || restored.levels[expectedCost.id] !== 1) {
    report.problems.push(
      `forge: the forged level did not survive a reload (levels ${JSON.stringify(restored?.levels ?? null)})`
    );
  } else if (!(restored.interactionRange > before.interactionRange)) {
    report.problems.push(
      `forge: the reach was not re-derived on load (${restored.interactionRange})`
    );
  }
}

/**
 * THE FULL BRANCH, played: P1 → P2 → P3 → BM-1 in one session, then the clue beat and a
 * reload — the branch-completion consequences the `bm1` scenario cannot reach (it plays
 * BM-1 alone), and M9's "persists" clause measured rather than assumed.
 */
async function scenarioBranch(cdp) {
  const level = await evaluate(cdp, 'window.__probe.level()');
  report.data.branchStart = {
    hud: await evaluate(cdp, 'window.__probe.hud()'),
    progress: await evaluate(cdp, 'window.__probe.progress()')
  };

  const playPair = async (label, puzzleId, partId, socketId, parts, sockets) => {
    const part = parts.find((entry) => entry.id === partId);
    const socket = sockets.find((entry) => entry.id === socketId);
    const tries = [];
    log(`[pair] ${label}`);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const before = report.logs.length;
      const grab = await grabPart(cdp, part);
      // This scenario runs for a quarter of an hour on a good day, so report as it goes. A
      // silent run can only be judged when it finishes, which is useless when it is the first
      // pair that fails: the diagnosis is in `attempts`, and that used to be written once at
      // the very end.
      log(`  attempt ${attempt}: grab ${grab.focus}${grab.held === undefined ? '' : ` (held ${grab.held})`}`);
      const dock = await dockInto(cdp, socket, part);
      await sleep(900); // three confirmed steps is the §25 stable window
      drainConsole(cdp);
      const fresh = report.logs.slice(before).join('\n');
      const completed = puzzleId !== null && new RegExp(`\\[reward\\] ${puzzleId}:`).test(fresh);
      const rolledBack = (dock.attempts ?? []).filter((entry) => /rolled back/.test(entry)).length;
      // The pairs before a branch's reward run have no puzzle of their own (`null`): for those,
      // the run's own criterion is "the part stayed in hand", not "a reward fired".
      const settled = completed || (puzzleId === null && dock.dropped !== true);
      log(
        `  attempt ${attempt}: ${completed ? 'completed' : settled ? 'docked' : 'NOT completed'} | socket ${dock.hud?.socket?.text ?? '?'}${dock.dropped === true ? ' | hold lost' : ''}${rolledBack > 0 ? ` | ${rolledBack} hop(s) rolled back` : ''}`
      );
      if (!settled) for (const entry of dock.attempts) log(`      ${entry}`);
      tries.push({ attempt, held: grab.held, dropped: dock.dropped === true, attempts: dock.attempts });
      if (completed || (puzzleId === null && dock.dropped !== true)) {
        return {
          label,
          grab,
          log: tries,
          socketAfter: (await evaluate(cdp, 'window.__probe.hud()')).socket?.text ?? null,
          completed: true,
          saved: /\[save\] autosave written/.test(fresh),
          progress: await evaluate(cdp, 'window.__probe.progress()')
        };
      }
    }
    return {
      label,
      grab: tries[tries.length - 1],
      log: tries,
      socketAfter: (await evaluate(cdp, 'window.__probe.hud()')).socket?.text ?? null,
      completed: false,
      saved: false,
      progress: await evaluate(cdp, 'window.__probe.progress()')
    };
  };

  // Bug 20's other half: a *steady* focus must still feed the hint ladder. The gear names
  // P1 through `required`; before the fix `engagement.puzzleId` was null on every
  // steady-focus step, so four KeyH edges left the HUD line at L0.
  const gearA = level.p1Parts.find((entry) => entry.id === 'gear-a');
  const hintFocus = await focusTarget(cdp, 'gear-a', boxOf(gearA));
  const hintLevels = { focus: hintFocus === null ? 'NOT FOCUSABLE' : hintFocus.focus.id, before: null, after: [] };
  if (hintFocus !== null) {
    hintLevels.before = (await evaluate(cdp, 'window.__probe.hud()')).hintLevel?.text ?? null;
    for (let i = 0; i < 4; i += 1) {
      await tapKey(cdp, 'KeyH');
      await sleep(450);
      hintLevels.after.push((await evaluate(cdp, 'window.__probe.hud()')).hintLevel?.text ?? null);
    }
  }
  report.data.branchHints = hintLevels;
  drainConsole(cdp);

  report.data.branchPairs = [];
  report.data.branchPairs.push(await playPair('P1 gear -> mesh', 'P1', 'gear-a', 'socket-mesh', level.p1Parts, level.p1Sockets));
  report.data.branchPairs.push(await playPair('P2 gear -> mesh', 'P2', 'gear-p2', 'socket-p2-mesh', level.p2Parts, level.p2Sockets));
  report.data.branchPairs.push(await playPair('P3 valve 1 -> A', null, 'valve-p3-1', 'socket-p3-valve-a', level.p3Parts, level.p3Sockets));
  report.data.branchPairs.push(await playPair('P3 valve 2 -> C', 'P3', 'valve-p3-2', 'socket-p3-valve-c', level.p3Parts, level.p3Sockets));
  report.data.branchAfterPuzzles = {
    hud: await evaluate(cdp, 'window.__probe.hud()'),
    progress: await evaluate(cdp, 'window.__probe.progress()')
  };
  // BM-1, then the burst the branch owes: stage advance, branch complete, plate awake.
  report.data.branchBm1 = await playBm1Sequence(cdp, level);
  await sleep(1500);
  drainConsole(cdp);
  const burst = report.logs.join('\n');
  report.data.branchBurst = {
    bm1Reward: /\[reward\] BM-1:milestone\/bm1-pressure-dynamo applied/.test(burst),
    branchComplete: /\[progression\] branch branch-a complete/.test(burst),
    hubStage: /\[progression\] hub stage -> stage\/pressure-online/.test(burst),
    plateAwake: /\[clue\] plate awake: clue\/regulator-plate/.test(burst),
    autosave: /\[save\] autosave written \(puzzle-completed trigger\)/.test(burst)
  };
  report.data.branchAfterBm1 = {
    hud: await evaluate(cdp, 'window.__probe.hud()'),
    progress: await evaluate(cdp, 'window.__probe.progress()')
  };

  // The thermal branch's curve, played live. Branch A's completion opened the door, so
  // B1 is live the moment the burst above lands and B2 follows it — ordinary `playPair`
  // runs against the shipped geometry, so the new content is proven *reachable and
  // completable in the real composition*, not only in the logic suites.
  report.data.branchPairs.push(await playPair('B1 valve 1 -> flow A', null, 'valve-b1-1', 'socket-b1-flow-a', level.b1Parts, level.b1Sockets));
  report.data.branchPairs.push(await playPair('B1 valve 2 -> flow B', 'B1', 'valve-b1-2', 'socket-b1-flow-b', level.b1Parts, level.b1Sockets));
  report.data.branchAfterB1 = {
    hud: await evaluate(cdp, 'window.__probe.hud()'),
    progress: await evaluate(cdp, 'window.__probe.progress()')
  };
  report.data.branchPairs.push(await playPair('B2 gear -> drive', null, 'gear-b2', 'socket-b2-drive', level.b2Parts, level.b2Sockets));
  report.data.branchPairs.push(await playPair('B2 valve -> steam', 'B2', 'valve-b2', 'socket-b2-steam', level.b2Parts, level.b2Sockets));
  drainConsole(cdp);
  report.data.branchAfterB2 = {
    // The combining machine alone is not the branch: BM-2 is still outstanding, so the
    // branch is InProgress and the objective line is BM-2's.
    hud: await evaluate(cdp, 'window.__probe.hud()'),
    progress: await evaluate(cdp, 'window.__probe.progress()')
  };

  // B3, the branch's open-ended beat: two serviceable valves, and the second goes in the
  // cross-run port so the pair proves the multi-solution machine in the real composition
  // (A+B, A+C and B+C are all accepted; the harness plays A+C).
  report.data.branchPairs.push(await playPair('B3 valve 1 -> heat', null, 'valve-b3-1', 'socket-b3-route-a', level.b3Parts, level.b3Sockets));
  report.data.branchPairs.push(await playPair('B3 valve 2 -> cross-run', 'B3', 'valve-b3-2', 'socket-b3-route-c', level.b3Parts, level.b3Sockets));
  drainConsole(cdp);
  report.data.branchAfterB3 = {
    // The open-ended beat does not complete the branch either: BM-2 is still outstanding.
    hud: await evaluate(cdp, 'window.__probe.hud()'),
    progress: await evaluate(cdp, 'window.__probe.progress()')
  };

  // BM-2, the staged capstone — the one step that completes the Thermal Line. This is
  // STATUS.md §Next up #1: the whole curve A → B1 → B2 → BM-2 played live in one session,
  // on the shipped composition rather than in the logic suites.
  report.data.branchBm2 = await playBm2Sequence(cdp, level);
  await sleep(1500);
  drainConsole(cdp);
  const burst2 = report.logs.join('\n');
  report.data.branchBurst2 = {
    bm2Reward: /\[reward\] BM-2:milestone\/bm2-steam-engine applied/.test(burst2),
    branchComplete: /\[progression\] branch branch-b complete \(Thermal Line\)/.test(burst2),
    hubStage: /\[progression\] hub stage -> stage\/regulator-awake \(Regulator Awake\)/.test(burst2),
    plateAwake: /\[clue\] plate awake: clue\/thermal-plate/.test(burst2),
    autosave: /\[save\] autosave written \(puzzle-completed trigger\)/.test(burst2)
  };
  report.data.branchAfterBm2 = {
    hud: await evaluate(cdp, 'window.__probe.hud()'),
    progress: await evaluate(cdp, 'window.__probe.progress()')
  };

  // The clue beat (§6 step 8): each plate is awake once *its* branch is Complete, so
  // focusing it is the discovery. Branch A's plate is read first; Branch B's is read after
  // its capstone has run — which is itself the proof that completing B woke the second
  // plate (a dormant plate is not focusable at all, §18).
  const readPlate = async (clueId) => {
    const plate = level.hubTargets.find((entry) => entry.id === clueId);
    const before = report.logs.length;
    const focus = await focusTarget(cdp, clueId, boxOf(plate));
    await sleep(700);
    drainConsole(cdp);
    const fresh = report.logs.slice(before).join('\n');
    return {
      focused: focus === null ? 'NOT FOCUSABLE' : `${focus.focus.verb} @ ${focus.focus.distance.toFixed(2)} m`,
      discovered: fresh.includes(`[clue] discovered ${clueId}`)
    };
  };
  report.data.branchClue = {
    regulator: await readPlate('clue/regulator-plate'),
    thermal: await readPlate('clue/thermal-plate'),
    hud: await evaluate(cdp, 'window.__probe.hud()'),
    progress: await evaluate(cdp, 'window.__probe.progress()')
  };

  // Reload: the M9 acceptance clause. Branch state re-derives from the restored puzzle
  // set, the clue set and the staged log come back, and the hub re-renders at stage 2.
  const logsBeforeReload = report.logs.length;
  await boot(cdp);
  drainConsole(cdp);
  const reloadLogs = report.logs.slice(logsBeforeReload).join('\n');
  report.data.branchReload = {
    loaded: /\[save\] loaded autosave/.test(reloadLogs),
    // Both branches this run plays are Complete, so both of their clues carry. The count is
    // now 2 of **3**: the Great Crucible's plate belongs to Branch C, whose branch is only
    // `Available` at the end of an A→B run, so its clue staying asleep is correct — and the
    // ids are the part that must match.
    cluesRestored: /\[clue\] 2\/3 clue\(s\) discovered: clue\/regulator-plate, clue\/thermal-plate/.test(reloadLogs),
    // BM-1's four staged actions plus BM-2's four: the log is canonical, so a save that
    // ran both capstones restores eight.
    stagedRestored: /\[staged\] 8 staged action\(s\) restored/.test(reloadLogs),
    // Branch B's completion moved the hub: stage 2 (Regulator Awake) with both branch doors
    // reading Complete (open) — derived from the restored puzzle set, never stored.
    hubStage: /\[hub\] stage 2 \(Regulator Awake\); branch-a=Complete \(open\), branch-b=Complete \(open\)/.test(reloadLogs),
    progress: await evaluate(cdp, 'window.__probe.progress()'),
    hud: await evaluate(cdp, 'window.__probe.hud()')
  };

  // Branch C's own curve — played here, after the reload, because this is the only state in
  // which the third branch can complete at all: A and B are Complete, so its puzzles are open
  // and its rewards can fire. `crucible` proves the machines on a freshly gated save; this
  // proves completion, the reward burst, `stage/crucible-restored` and the third clue plate.
  report.data.branchCPairs = [];
  report.data.branchCPairs.push(
    await playPair('C1 valve -> flow A', 'C1', 'valve-c1-1', 'socket-c1-flow-a', level.c1Parts, level.c1Sockets)
  );
  report.data.branchCPairs.push(
    await playPair('C2 gear -> drive', null, 'gear-c2', 'socket-c2-drive', level.c2Parts, level.c2Sockets)
  );
  report.data.branchCPairs.push(
    await playPair('C2 valve -> feed A', 'C2', 'valve-c2-1', 'socket-c2-feed-a', level.c2Parts, level.c2Sockets)
  );
  report.data.branchCPairs.push(
    await playPair('C3 valve -> cross-run C', 'C3', 'valve-c3-1', 'socket-c3-route-c', level.c3Parts, level.c3Sockets)
  );
  report.data.branchCPairs.push(
    await playPair('CM-3 gear -> drive', null, 'gear-cm3', 'socket-cm3-drive', level.cm3Parts, level.cm3Sockets)
  );
  report.data.branchCPairs.push(
    await playPair('CM-3 valve -> feed', null, 'valve-cm3', 'socket-cm3-feed', level.cm3Parts, level.cm3Sockets)
  );
  await sleep(900);
  drainConsole(cdp);

  // The ordered stage, refused and then recovered, live. Pull the pour lever *before* the
  // lines are primed and read the puzzle's own failed requirement, then prime in any order,
  // then pour again. ADR-018's earliest-match rule is what makes the second pour legitimate,
  // so this also proves an early lever does not lock the player out.
  report.data.branchCEarlyPour = await pressStagedProps(cdp, [{ id: 'cm3/engage', x: 17.6 }], 30.4, 30.8);
  const afterEarlyPour = await evaluate(cdp, "window.__probe.puzzle('CM-3')");
  report.data.branchCAfterEarlyPour = afterEarlyPour;
  if (afterEarlyPour === null || !(afterEarlyPour.reasonCodes ?? []).includes('cm3/staged')) {
    report.problems.push(
      `branch: CM-3 did not refuse the early pour (got ${JSON.stringify(afterEarlyPour)})`
    );
  }
  report.data.branchCm3Presses = await pressStagedProps(
    cdp,
    [
      { id: 'cm3/prime-blast', x: 13.4 },
      { id: 'cm3/prime-quench', x: 14.6 },
      { id: 'cm3/prime-slag', x: 15.8 }
    ],
    30.4,
    30.8
  );
  const afterPriming = await evaluate(cdp, "window.__probe.puzzle('CM-3')");
  report.data.branchCAfterPriming = afterPriming;
  if (afterPriming === null || (afterPriming.reasonCodes ?? []).includes('cm3/primed')) {
    report.problems.push(
      `branch: CM-3 did not accept the three priming lines (got ${JSON.stringify(afterPriming)})`
    );
  }
  report.data.branchCSecondPour = await pressStagedProps(cdp, [{ id: 'cm3/engage', x: 17.6 }], 30.4, 30.8);
  await sleep(1800);
  drainConsole(cdp);
  const cLogs = report.logs.join('\n');
  report.data.branchCBurst = {
    c1Reward: /\[reward\] C1:milestone\/c1-tuyere applied/.test(cLogs),
    c2Reward: /\[reward\] C2:milestone\/c2-quench applied/.test(cLogs),
    c3Reward: /\[reward\] C3:milestone\/c3-slag-run applied/.test(cLogs),
    cm3Reward: /\[reward\] CM-3:milestone\/cm3-great-crucible applied/.test(cLogs),
    branchComplete: /\[progression\] branch branch-c complete \(Great Crucible\)/.test(cLogs),
    hubStage: /\[progression\] hub stage -> stage\/crucible-restored \(Crucible Restored\)/.test(cLogs),
    plateAwake: /\[clue\] plate awake: clue\/crucible-plate/.test(cLogs)
  };
  if (!report.data.branchCBurst.branchComplete) {
    report.problems.push('branch: Branch C did not complete after C1 → C2 → C3 → CM-3');
  }
  if (!report.data.branchCBurst.hubStage) {
    report.problems.push('branch: completing Branch C did not reach stage/crucible-restored');
  }
  if (!report.data.branchCBurst.cm3Reward) {
    report.problems.push('branch: CM-3 did not apply its reward');
  }
  for (const pair of report.data.branchCPairs) {
    if (pair.completed !== true) report.problems.push(`branch: ${pair.label} did not complete`);
  }
  for (const press of [...report.data.branchCEarlyPour, ...report.data.branchCm3Presses, ...report.data.branchCSecondPour]) {
    if (press.focus === 'NOT FOCUSABLE') {
      report.problems.push(`branch: CM-3's ${press.id} was not focusable`);
    }
  }
  report.data.branchCClue = await readPlate('clue/crucible-plate');
  report.data.branchC = {
    hud: await evaluate(cdp, 'window.__probe.hud()'),
    progress: await evaluate(cdp, 'window.__probe.progress()')
  };
}

/** TEMPORARY diagnostic — see the B2 steam port's dock attempts with the live part pose. */
async function scenarioB2Audit(cdp) {
  const level = await evaluate(cdp, 'window.__probe.level()');
  const valve = level.b2Parts.find((entry) => entry.id === 'valve-b2');
  const socket = level.b2Sockets.find((entry) => entry.id === 'socket-b2-steam');
  const grab = await grabPart(cdp, valve);
  const rows = [];
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    for (const back of [1.5, 1.2, 1.9, 2.3]) {
      const px = socket.center.x + dx * back;
      const pz = socket.center.z + dz * back;
      const yaw = Math.atan2(-(socket.center.x - px), -(socket.center.z - pz));
      await evaluate(
        cdp,
        `(async () => { await window.__probe.hopTo(${px}, ${pz}, ${yaw}); await window.__probe.pitchHome(); await window.__probe.pitchTo(0.0); await window.__probe.aimYaw(${yaw}); return true; })()`
      );
      await sleep(700);
      const sample = await evaluate(
        cdp,
        `(() => {
          const dev = window.__gearwrightDev;
          const pose = dev.manipulation.currentPose;
          return {
            player: dev.player.snapshot().position,
            heldId: dev.manipulation.heldId,
            part: { x: pose.center.x, y: pose.center.y, z: pose.center.z },
            previewSocketId: dev.manipulation.previewSocketId,
            socketText: window.__probe.hud().socket?.text ?? null
          };
        })()`
      );
      const dist = Math.hypot(
        sample.part.x - socket.center.x,
        sample.part.y - socket.center.y,
        sample.part.z - socket.center.z
      );
      rows.push({ dir: `${dx},${dz}`, back, px, pz, dist: Number(dist.toFixed(3)), ...sample });
      log(`  b2audit dir ${dx},${dz} back ${back}: ${sample.socketText} | part ${sample.part.x.toFixed(2)},${sample.part.y.toFixed(2)},${sample.part.z.toFixed(2)} | d=${dist.toFixed(2)}`);
      if (sample.heldId === null) break;
    }
  }
  report.data.b2audit = { grab, socket, rows };
  drainConsole(cdp);
}

async function main() {
  // Every run starts from a clean profile, because the game autosaves into it. The profile is
  // also deleted on the way out, but a run that is killed (a timeout, Ctrl-C, a stuck scenario)
  // leaves the autosave behind — and the next run then boots into *that* world: gear-a lying
  // under the shafts where the previous run dropped it, so its first grab is unfocusable and a
  // real defect is indistinguishable from stale state. Observed on 21/10/2026.
  try {
    rmSync(PROFILE, { recursive: true, force: true });
  } catch {
    /* chrome may still hold files; the run will reuse whatever it can */
  }
  mkdirSync(PROFILE, { recursive: true });
  if (URL_ARG === null) {
    if (PRODUCTION) {
      log('building…');
      await new Promise((resolve, reject) => {
        const build = spawn('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
        build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build failed: ${code}`))));
      });
      startProcess('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '127.0.0.1'], 'preview');
    } else {
      startProcess('node', ['node_modules/vite/bin/vite.js', '--port', String(DEV_PORT), '--strictPort', '--host', '127.0.0.1'], 'vite');
    }

    const up = await waitForHttp(BASE, 60000);
    if (!up) throw new Error('server never came up');
    log(`server up at ${BASE}`);
  } else {
    log(`testing live URL: ${BASE}`);
  }

  startProcess(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--enable-unsafe-swiftshader',
      '--window-size=1600,900',
      '--mute-audio',
      'about:blank'
    ],
    'chrome'
  );

  const cdp = await connect();
  await boot(cdp);
  log('page booted');

  if (SCENARIO === 'boot') await scenarioBoot(cdp);
  if (SCENARIO === 'title') await scenarioTitle(cdp);
  if (SCENARIO === 'focus') await scenarioFocus(cdp);
  if (SCENARIO === 'b2audit') await scenarioB2Audit(cdp);
  if (SCENARIO === 'arms') {
    // The hand-motion pass (18/10/2026). Two numbers, both measured rather than looked at:
    //  - standing still with a weapon drawn, the muzzle must not move (it used to drift forward
    //    until the arm's reach clamp, because the mount read the rendered hand — a closed loop);
    //  - the hands, measured *relative to the body*, must not chatter while the player walks.
    report.data.arms = { body: await waitForPlayerBody(cdp), still: null, walk: null };
    const read = async () =>
      evaluate(
        cdp,
        '({ c: window.__probe.character(), m: window.__probe.weaponMountPresent() })'
      );

    const collect = async (ms, every = 60) => {
      const samples = [];
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const s = await read();
        if (s?.c?.handL && s?.c?.handR && s?.m?.muzzle) {
          samples.push({
            t: Date.now(),
            root: { x: s.c.x, y: s.c.y, z: s.c.z },
            left: { x: s.c.handL.x - s.c.x, y: s.c.handL.y - s.c.y, z: s.c.handL.z - s.c.z },
            right: { x: s.c.handR.x - s.c.x, y: s.c.handR.y - s.c.y, z: s.c.handR.z - s.c.z },
            // The 19/10 wrist solve: unit wrist→fingers, absent on a body with no finger bones.
            leftForward: s.c.handLForward ?? null,
            rightForward: s.c.handRForward ?? null,
            muzzle: s.m.muzzle,
            aim: s.m.aimDirection
          });
        }
        await sleep(every);
      }
      return samples;
    };

    const worstStep = (samples) => {
      let worst = 0;
      for (let i = 1; i < samples.length; i += 1) {
        for (const key of ['left', 'right']) {
          const a = samples[i - 1][key];
          const b = samples[i][key];
          worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
        }
      }
      return worst;
    };
    // Where each hand actually is, versus the grip the mount says it should hold: the two are
    // the same target when the solve is exact, and a gap means the hand is trailing the gun.
    const gripError = (samples) => {
      let worst = 0;
      for (const s of samples) {
        const dir = s.aim;
        const rear = {
          x: s.muzzle.x - dir.x * 0.3,
          y: s.muzzle.y - dir.y * 0.3,
          z: s.muzzle.z - dir.z * 0.3
        };
        const front = {
          x: s.muzzle.x - dir.x * 0.12,
          y: s.muzzle.y - dir.y * 0.12,
          z: s.muzzle.z - dir.z * 0.12
        };
        const left = { x: s.left.x + s.root.x, y: s.left.y + s.root.y, z: s.left.z + s.root.z };
        const right = { x: s.right.x + s.root.x, y: s.right.y + s.root.y, z: s.right.z + s.root.z };
        worst = Math.max(
          worst,
          Math.hypot(left.x - front.x, left.y - front.y, left.z - front.z),
          Math.hypot(right.x - rear.x, right.y - rear.y, right.z - rear.z)
        );
      }
      return worst;
    };
    /**
     * Worst angular *rate* of either hand (wrist → fingers, world space), rad/s. A hand left to
     * the clip's own orientation swings with the walk; a hand settled onto the forearm holds
     * still relative to the body and the gun, which is what the 19/10 solve is for. Time-based,
     * not per-sample: the sampling interval includes a CDP round-trip and is not fixed.
     */
    const handTurnRate = (samples) => {
      let worst = 0;
      for (let i = 1; i < samples.length; i += 1) {
        const dt = Math.max((samples[i].t - samples[i - 1].t) / 1000, 1e-3);
        for (const key of ['leftForward', 'rightForward']) {
          const a = samples[i - 1][key];
          const b = samples[i][key];
          if (a === null || b === null) continue;
          const dot = Math.min(Math.max(a.x * b.x + a.y * b.y + a.z * b.z, -1), 1);
          worst = Math.max(worst, Math.acos(dot) / dt);
        }
      }
      return worst;
    };
    /**
     * Samples where a hand sits inside the torso box, in the body's own frame. The harness plays
     * facing yaw 0 (forward = −Z, right = +X), so the body-relative sample coordinates are already
     * the torso frame: ±0.18 m wide, ±0.12 m deep, 0.8–1.62 m up.
     */
    const handsInsideBody = (samples) => {
      let count = 0;
      for (const s of samples) {
        for (const hand of [s.left, s.right]) {
          const inside =
            Math.abs(hand.x) < 0.18 && Math.abs(hand.z) < 0.12 && hand.y > 0.8 && hand.y < 1.62;
          if (inside) count += 1;
        }
      }
      return count;
    };
    const muzzleDrift = (samples) => {
      let worst = 0;
      const first = samples[0]?.muzzle;
      if (first === undefined) return 0;
      for (const s of samples) {
        worst = Math.max(
          worst,
          Math.hypot(s.muzzle.x - first.x, s.muzzle.y - first.y, s.muzzle.z - first.z)
        );
      }
      return worst;
    };

    await sleep(900);
    const still = await collect(1600);
    report.data.arms.still = {
      samples: still.length,
      muzzleDrift: Number(muzzleDrift(still).toFixed(4)),
      handStep: Number(worstStep(still).toFixed(4)),
      gripError: Number(gripError(still).toFixed(4))
    };
    if (still.length < 10) {
      report.problems.push('arms: too few samples while standing still (is a body drawn?)');
    } else {
      if (still.muzzleDrift > 0.005) {
        report.problems.push(
          `arms: the muzzle drifted ${report.data.arms.still.muzzleDrift} m while standing still (a renderer-driven mount loops)`
        );
      }
      if (report.data.arms.still.handStep > 0.005) {
        report.problems.push(
          `arms: the hands moved ${report.data.arms.still.handStep} m between samples while standing still`
        );
      }
      if (report.data.arms.still.gripError > 0.02) {
        report.problems.push(
          `arms: hands are ${report.data.arms.still.gripError} m off their grip while standing still`
        );
      }
    }

    await keyDown(cdp, 'KeyW');
    const walk = await collect(1600);
    await keyUp(cdp, 'KeyW');
    report.data.arms.walk = {
      samples: walk.length,
      handStep: Number(worstStep(walk).toFixed(4)),
      gripError: Number(gripError(walk).toFixed(4)),
      handTurnRate: Number(handTurnRate(walk).toFixed(3)),
      insideBody: handsInsideBody(walk),
      // Spread of each hand's body-relative position over the whole walk: drift, not per-frame
      // noise, is what a broken solve shows (it walks away from the gun over seconds).
      leftSpread: Number(
        (Math.max(...walk.map((s) => s.left.z)) - Math.min(...walk.map((s) => s.left.z))).toFixed(4)
      ),
      rightSpread: Number(
        (Math.max(...walk.map((s) => s.right.z)) - Math.min(...walk.map((s) => s.right.z))).toFixed(4)
      )
    };
    if (walk.length < 10) {
      report.problems.push('arms: too few samples while walking');
    } else {
      // The hands are pinned to a body-relative grip, so walking must not move them relative to
      // the body at all. This held at 0.0001 m; the old solve wandered by up to 0.12 m.
      if (report.data.arms.walk.handStep > 0.02) {
        report.problems.push(
          `arms: a hand jumped ${report.data.arms.walk.handStep} m between samples while walking (body-relative chatter)`
        );
      }
      if (report.data.arms.walk.gripError > 0.02) {
        report.problems.push(
          `arms: a hand is ${report.data.arms.walk.gripError} m off its grip while walking (the arm cannot reach it)`
        );
      }
      // The 19/10 wrist solve: a held hand must not swing about its own wrist while the body
      // walks straight, and no hand may sit inside the torso volume. The wrist's own rate limit
      // is 24 rad/s, so 12 rad/s is "settled, following the arm" while a hand left to the clip
      // runs at the limit.
      if (report.data.arms.walk.handTurnRate > 12) {
        report.problems.push(
          `arms: a hand turned at ${report.data.arms.walk.handTurnRate} rad/s while walking (the wrist is not settled)`
        );
      }
      if (report.data.arms.walk.insideBody > 0) {
        report.problems.push(
          `arms: hands were inside the torso in ${report.data.arms.walk.insideBody} samples`
        );
      }
    }
    drainConsole(cdp);
  }
  if (SCENARIO === 'hold') {
    // PLAN T1.1 regression: a human-length E press (~160 ms ≈ 5 fixed steps) must grab
    // without rotating the part. The body swap is awaited first: the grip gate is meant to cover
    // whichever body the session ended up with, not whichever happened to be up during the grab.
    report.data.holdBody = await waitForPlayerBody(cdp);
    const level = await evaluate(cdp, 'window.__probe.level()');
    const gear = level.p1Parts.find((entry) => entry.id === 'gear-a');
    const found = await focusTarget(cdp, 'gear-a', boxOf(gear));
    report.data.hold = { focused: found !== null };
    if (found !== null) {
      await keyDown(cdp, 'KeyE');
      await sleep(160);
      await keyUp(cdp, 'KeyE');
      await sleep(400);
      report.data.hold.after = await evaluate(
        cdp,
        '({ state: window.__gearwrightDev.manipulation.state, held: window.__gearwrightDev.manipulation.heldId, yaw: window.__gearwrightDev.manipulation.currentPose.yaw })'
      );
      // Hands toward the held part. Since the 19/10 carry pass the hold distance is derived from
      // the part's own size (near face at the hands) and the body is handed that *face*, not the
      // part's centre, so this gate now checks contact as well as shape: each hand must be
      // extended along the chest → part line (dot > 0.9), out from the body (> 0.4 m), and within
      // a hand's width of the point it grips. Body-agnostic on purpose: the imported humanoid
      // solves its own two-bone IK onto the same target, so one assertion covers both
      // (`grip.body` records which one was measured).
      await sleep(700);
      const grip = await evaluate(cdp, 'window.__probe.character()');
      report.data.hold.grip = grip;
      if (grip === null) {
        report.problems.push('hold: the render port exposes no player body (characterFacts absent)');
      } else if (report.data.hold.after?.held !== 'gear-a') {
        report.problems.push(`hold: expected gear-a held, got ${report.data.hold.after?.held ?? 'nothing'}`);
      } else if (grip.holding !== true || grip.hold === null || grip.hold === undefined) {
        report.problems.push('hold: the body reports no grip target while gear-a is held');
      } else if (grip.handL === undefined || grip.handR === undefined) {
        report.problems.push('hold: the body reports no hand positions');
      } else {
        // Alignment and extension, both yaw-independent: each hand must lie along the chest →
        // grip direction (dot > 0.9) and stand out from the body (> 0.4 m, not hanging at the
        // sides). `surface` adds the proximity the carry could not deliver before the 19/10 pass.
        const chest = { x: grip.x, y: grip.y + 1.45, z: grip.z };
        const toPart = { x: grip.hold.x - chest.x, y: grip.hold.y - chest.y, z: grip.hold.z - chest.z };
        const partLen = Math.hypot(toPart.x, toPart.y, toPart.z);
        const check = (hand) => {
          const toHand = { x: hand.x - chest.x, y: hand.y - chest.y, z: hand.z - chest.z };
          const handLen = Math.hypot(toHand.x, toHand.y, toHand.z);
          const dot =
            partLen > 1e-6 && handLen > 1e-6
              ? (toHand.x * toPart.x + toHand.y * toPart.y + toHand.z * toPart.z) / (handLen * partLen)
              : -1;
          return { handLen, dot };
        };
        const left = check(grip.handL);
        const right = check(grip.handR);
        // How far each hand sits from the grip point the body was handed. `splitGrip` puts the
        // hands 0.17 m either side of it, so a hand that is touching the part measures ~0.17 m;
        // anything over 0.25 m means the arm could not close on the part it is carrying.
        const surface = (hand) =>
          Math.hypot(hand.x - grip.hold.x, hand.y - grip.hold.y, hand.z - grip.hold.z);
        const onSurface = { left: Number(surface(grip.handL).toFixed(3)), right: Number(surface(grip.handR).toFixed(3)) };
        report.data.hold.reach = {
          body: grip.body ?? 'unknown',
          left: { dot: Number(left.dot.toFixed(3)), length: Number(left.handLen.toFixed(3)) },
          right: { dot: Number(right.dot.toFixed(3)), length: Number(right.handLen.toFixed(3)) },
          surface: onSurface
        };
        if (!(left.dot > 0.9 && right.dot > 0.9 && left.handLen > 0.4 && right.handLen > 0.4)) {
          report.problems.push(
            `hold: hands (${grip.body ?? 'unknown'} body) not extended toward the held part (left dot ${left.dot.toFixed(2)} @ ${left.handLen.toFixed(2)} m, right dot ${right.dot.toFixed(2)} @ ${right.handLen.toFixed(2)} m)`
          );
        }
        if (!(onSurface.left <= 0.25 && onSurface.right <= 0.25)) {
          report.problems.push(
            `hold: hands (${grip.body ?? 'unknown'} body) are not on the carried part (left ${onSurface.left} m, right ${onSurface.right} m from its grip point)`
          );
        }
      }
    }
    drainConsole(cdp);
  }
  if (SCENARIO === 'dock') await scenarioDock(cdp);
  if (SCENARIO === 'crucible') await scenarioCrucible(cdp);
  if (SCENARIO === 'decoy') await scenarioDecoy(cdp);
  if (SCENARIO === 'forge') await scenarioForge(cdp);
  if (SCENARIO === 'guns') await scenarioGuns(cdp);
  if (SCENARIO === 'bm1') await scenarioBm1(cdp);
  if (SCENARIO === 'branch') await scenarioBranch(cdp);
  if (SCENARIO === 'press') {
    // Instrumented one-press diagnosis: assemble BM-1 (the presses only exist once the
    // structure completes), then watch the live focus at 10 ms granularity around a
    // KeyE press AND a trusted click on one priming prop.
    const assemble = async () => {
      const level = await evaluate(cdp, 'window.__probe.level()');
      const grabPart = async (part) => {
        const found = await focusTarget(cdp, part.id, boxOf(part));
        if (found === null) return false;
        await tapKey(cdp, 'KeyE');
        await sleep(600);
        const hud = await evaluate(cdp, 'window.__probe.hud()');
        return /carrying|held/i.test(hud.held?.text ?? '') || (hud.held?.text ?? '') === part.id;
      };
      const dockInto = async (socket) => {
        const back = 1.5;
        const px = socket.center.x;
        const pz = socket.center.z + back;
        const yaw = Math.atan2(-(socket.center.x - px), -(socket.center.z - pz));
        await evaluate(
          cdp,
          `(async () => {
            await window.__probe.hopTo(${px}, ${pz}, ${yaw});
            await window.__probe.pitchHome();
            await window.__probe.pitchTo(0.0);
            await window.__probe.aimYaw(${yaw});
            const dev = window.__gearwrightDev;
            window.__probe.hopTrace.push({ hop: 'aim', held: dev.manipulation.heldId ?? null });
            return true;
          })()`
        );
        await sleep(500);
        for (let i = 0; i < 3; i += 1) {
          await clickAt(cdp, 800, 450);
          await sleep(400);
          const hud = await evaluate(cdp, 'window.__probe.hud()');
          if (!/compatible/i.test(hud.socket?.text ?? '')) return true;
        }
        return false;
      };
      const gear = level.bm1Parts.find((entry) => entry.id === 'gear-bm1');
      const valve = level.bm1Parts.find((entry) => entry.id === 'valve-bm1');
      const drive = level.bm1Sockets.find((entry) => entry.id === 'socket-bm1-drive');
      const line = level.bm1Sockets.find((entry) => entry.id === 'socket-bm1-line');
      report.data.pressSetup = {
        grabGear: await grabPart(gear),
        dockGear: await dockInto(drive),
        grabValve: await grabPart(valve),
        dockValve: await dockInto(line)
      };
      drainConsole(cdp);
    };
    await assemble();

    const feed = { id: 'bm1/prime-feed', box: { min: { x: -2.25, y: 1.05, z: -16.8 }, max: { x: -1.75, y: 1.45, z: -16.4 } } };
    const pressObservation = async (label, act) => {
      const found = await focusTarget(cdp, feed.id, feed.box, 3.4);
      if (found === null) {
        report.data[label] = { focus: 'NOT FOCUSABLE' };
        return;
      }
      await sleep(600);
      await evaluate(cdp, 'window.__focusLog = []; window.__focusTimer = setInterval(() => { const f = window.__gearwrightDev.interaction.focus; window.__focusLog.push(f ? f.id : null); }, 10)');
      await act();
      await evaluate(cdp, 'clearInterval(window.__focusTimer)');
      const timeline = await evaluate(cdp, 'window.__focusLog');
      const held = timeline.filter((entry) => entry === feed.id).length;
      report.data[label] = {
        focusAtStart: found.focus,
        timelineMs: timeline.length * 10,
        focusedSamples: held,
        nullSamples: timeline.filter((entry) => entry === null).length,
        otherSamples: timeline.filter((entry) => entry !== null && entry !== feed.id).length
      };
      drainConsole(cdp);
    };

    await pressObservation('pressKeyE', async () => {
      await keyDown(cdp, 'KeyE');
      await sleep(100);
      await keyUp(cdp, 'KeyE');
      await sleep(500);
    });
    await pressObservation('pressClick', async () => {
      await clickAt(cdp, 800, 450);
      await sleep(600);
    });

    report.data.finalHud = await evaluate(cdp, 'window.__probe.hud()');
    drainConsole(cdp);
  }

  drainConsole(cdp);
  report.data.finalState = await evaluate(cdp, 'window.__probe.state()').catch(() => null);
  writeFileSync(join(ROOT, `.tmp-browser-report-${SCENARIO}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error('HARNESS ERROR:', error.message);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const child of children) child.kill();
    await sleep(500);
    try {
      rmSync(PROFILE, { recursive: true, force: true });
    } catch {
      /* chrome may hold files; cleaned separately */
    }
  });
