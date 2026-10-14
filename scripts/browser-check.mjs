/**
 * Local browser verification harness (committed tooling; not part of the build, not run in CI).
 *
 * Drives the *shipped* dev build in headless Chrome over CDP and reports what the
 * composition actually does: boot logs, HUD read-outs, focus acquisition from real
 * vantages, a played BM-1 sequence, console errors, and §36 budget numbers.
 *
 * Usage: node scripts/browser-check.mjs [boot|title|focus|hold|press|dock|bm1|branch|b2audit] [--production]
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
// player), no title screen, game logs on even in production builds.
const QUERY = '?shoulder=0&skipTitle=1&log=1';
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
      objectiveFailure: text('.gw-hud-objective-failure-text'),
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
    const shipped = await import('/src/levels/shipped-content.ts');
    const hub = await import('/src/levels/hub.ts');
    const branchB = await import('/src/levels/branch-b.ts');
    window.__probe.__colliders = [
      ...shipped.SHIPPED_WORLD.colliders,
      ...hub.hubColliders(() => 'Complete'),
      ...branchB.BRANCH_B_WORLD.colliders
    ];
    return window.__probe.__colliders;
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
    const half = 0.36; // the player capsule's own half-width: what actually fits
    const step = 0.5;
    const minX = -9;
    const maxX = 9;
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
   * maxLinearSpeed (8 m/s ≈ 0.27 m per fixed step) — so one long teleport leaves the
   * part metres behind and drops it (what killed the valve's first dock attempt).
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
      trace.push({
        hop,
        held: dev.manipulation.heldId ?? null,
        dist:
          pose === null || pose === undefined
            ? null
            : Number(
                Math.hypot(pose.center.x - player.x, pose.center.y - player.y, pose.center.z - player.z).toFixed(2)
              ),
        player: { x: Number(player.x.toFixed(2)), y: Number(player.y.toFixed(2)), z: Number(player.z.toFixed(2)) }
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
        dev.player.teleport({ x: ax + ((bx - ax) * i) / steps, y: 0.01, z: az + ((bz - az) * i) / steps });
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
          dev.player.teleport({ x: lastGood.x, y: 0.01, z: lastGood.z });
          await new Promise((resolve) => setTimeout(resolve, 120));
          trace.push({
            hop: 'rollback',
            at: { x: Number(now.x.toFixed(2)), y: Number(now.y.toFixed(2)), z: Number(now.z.toFixed(2)) }
          });
          return false;
        }
        lastGood = { x: now.x, z: now.z };
        if (dev.manipulation.heldId === null || dev.manipulation.heldId === undefined) break;
      }
    }
    return true;
  },
  /**
   * 'pitch' here is a *view* angle — positive looks DOWN, the sign the aim math computes
   * (atan2(1.4 - centre.y, h)) — while the rig stores the eye's elevation offset, which
   * is the opposite sign (CameraRig.placeAndCollide: direction.y = -sin(pitch)).
   * 'pitchHome' parks the rig on its min clamp (-1.1), so driving the rig to -pitch is
   * 1.1 - pitch of rig travel, i.e. (pitch - 1.1) / 0.006 pixels.
   *
   * NOTE: this whole probe is one template literal in the harness. A backtick anywhere in
   * here — even inside a comment — ends the template and breaks the harness at parse time.
   */
  pitchHome: async () => window.__probe.lookBy(0, 600),
  pitchTo: async (pitch) =>
    window.__probe.lookBy(0, Math.max(-600, Math.min(600, (pitch - 1.1) / 0.006))),
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
    // focus scenario walks them, which is how the new room proves it is reachable).
    let branchB = null;
    try { branchB = await import('/src/levels/branch-b.ts'); } catch { /* optional */ }
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
      hubTargets
    };
  }
};
true;
`;

async function boot(cdp) {
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.navigate', { url: BASE });

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
  await evaluate(cdp, PROBE_SOURCE);

  const readyDeadline = Date.now() + 45000;
  while (Date.now() < readyDeadline) {
    const ready = await evaluate(cdp, 'window.__probe.ready()').catch(() => false);
    if (ready) break;
    await sleep(250);
  }
  // Let a second of frames run: boot status is removed on the first frame.
  await sleep(1500);
}

function drainConsole(cdp) {
  for (const event of cdp.events.splice(0, cdp.events.length)) {
    if (event.method === 'Runtime.consoleAPICalled') {
      const type = event.params.type;
      const text = event.params.args
        .map((arg) => arg.value ?? arg.description ?? arg.type)
        .join(' ');
      if (type === 'error' || type === 'warning') report.problems.push(`console.${type}: ${text}`);
      report.logs.push(`${type}: ${text}`);
    } else if (event.method === 'Runtime.exceptionThrown') {
      const details = event.params.exceptionDetails;
      report.problems.push(`exception: ${details.exception?.description ?? details.text}`);
    } else if (event.method === 'Log.entryAdded') {
      const entry = event.params.entry;
      if (entry.level === 'error' || entry.level === 'warning') {
        report.problems.push(`log.${entry.level}: ${entry.text}`);
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

async function scenarioBoot(cdp) {
  const state = await evaluate(cdp, 'window.__probe.state()');
  const hud = await evaluate(cdp, 'window.__probe.hud()');
  const stats = await evaluate(cdp, 'window.__probe.stats()');
  const bootStatus = await evaluate(cdp, 'document.getElementById("boot-status") === null');
  report.data.boot = { state, hud, bootStatus, overlay: stats.overlay };
  drainConsole(cdp);

  // The player's body is a procedural skinned humanoid (no glTF): this is the only place that
  // can prove the real composition builds it, draws it, and stands it on the player's feet.
  const character = await evaluate(cdp, 'window.__probe.character()');
  report.data.character = character;
  if (character === null) {
    report.problems.push('character: the render port exposes no player body (characterFacts absent)');
  } else {
    if (character.bones !== 19) report.problems.push(`character: expected 19 bones, got ${character.bones}`);
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
    for (const back of [1.5, 1.2, 1.9, 2.3]) {
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
  report.data.dock = {
    grab,
    dropped: dock.dropped === true,
    attempts: dock.attempts,
    socketAfter: dock.hud?.socket?.text ?? null,
    hud: await evaluate(cdp, 'window.__probe.hud()'),
    progress: await evaluate(cdp, 'window.__probe.progress()')
  };
  if (dock.dropped === true) report.problems.push('dock: the held part was soft-detached mid-carry');
  else if (/incompatible/i.test(dock.hud?.socket?.text ?? '')) {
    report.problems.push(`dock: the socket refused the part (${dock.hud?.socket?.text})`);
  }
}

async function scenarioBm1(cdp) {
  const level = await evaluate(cdp, 'window.__probe.level()');
  report.data.bm1Start = await evaluate(cdp, 'window.__probe.hud()');
  report.data.bm1 = await playBm1Sequence(cdp, level);
  report.data.bm1Logs = report.logs.slice(-40);
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
    const log = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const before = report.logs.length;
      const grab = await grabPart(cdp, part);
      const dock = await dockInto(cdp, socket, part);
      await sleep(900); // three confirmed steps is the §25 stable window
      drainConsole(cdp);
      const fresh = report.logs.slice(before).join('\n');
      const completed = puzzleId !== null && new RegExp(`\\[reward\\] ${puzzleId}:`).test(fresh);
      log.push({ attempt, held: grab.held, dropped: dock.dropped === true, attempts: dock.attempts });
      if (completed || (puzzleId === null && dock.dropped !== true)) {
        return {
          label,
          grab,
          log,
          socketAfter: (await evaluate(cdp, 'window.__probe.hud()')).socket?.text ?? null,
          completed: true,
          saved: /\[save\] autosave written/.test(fresh),
          progress: await evaluate(cdp, 'window.__probe.progress()')
        };
      }
    }
    return {
      label,
      grab: log[log.length - 1],
      log,
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
    // Both branches are Complete by the end of the run, so both clues carry — the ids are
    // the point, and the count is 2 of 2 (one plate per branch).
    cluesRestored: /\[clue\] 2\/2 clue\(s\) discovered: clue\/regulator-plate, clue\/thermal-plate/.test(reloadLogs),
    // BM-1's four staged actions plus BM-2's four: the log is canonical, so a save that
    // ran both capstones restores eight.
    stagedRestored: /\[staged\] 8 staged action\(s\) restored/.test(reloadLogs),
    // Branch B's completion moved the hub: stage 2 (Regulator Awake) with both branch doors
    // reading Complete (open) — derived from the restored puzzle set, never stored.
    hubStage: /\[hub\] stage 2 \(Regulator Awake\); branch-a=Complete \(open\), branch-b=Complete \(open\)/.test(reloadLogs),
    progress: await evaluate(cdp, 'window.__probe.progress()'),
    hud: await evaluate(cdp, 'window.__probe.hud()')
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
  if (SCENARIO === 'hold') {
    // PLAN T1.1 regression: a human-length E press (~160 ms ≈ 5 fixed steps) must grab
    // without rotating the part.
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
      // Hands toward the held part: the carry pose floats the part 1.35 m ahead of the torso
      // while the arms only reach 0.56 m, so the analytic IK clamps at full extension along
      // the reach direction. The gate asserts the *reach shape* (alignment + extension),
      // yaw-independent, not the raw distance.
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
        // Reach shape, not proximity: the carry pose floats the part 1.35 m ahead of the torso
        // while the arms only reach 0.56 m, so the analytic IK clamps at full extension along
        // the reach direction. The gate asserts *alignment* (each hand extended along the
        // chest → part direction, dot > 0.9) and *extension* (> 0.4 m, not hanging at the
        // sides) — yaw-independent, so it holds whatever way the player faces.
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
        if (!(left.dot > 0.9 && right.dot > 0.9 && left.handLen > 0.4 && right.handLen > 0.4)) {
          report.problems.push(
            `hold: hands not extended toward the held part (left dot ${left.dot.toFixed(2)} @ ${left.handLen.toFixed(2)} m, right dot ${right.dot.toFixed(2)} @ ${right.handLen.toFixed(2)} m)`
          );
        }
      }
    }
    drainConsole(cdp);
  }
  if (SCENARIO === 'dock') await scenarioDock(cdp);
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
