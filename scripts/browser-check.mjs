/**
 * Local browser verification harness (committed tooling; not part of the build, not run in CI).
 *
 * Drives the *shipped* dev build in headless Chrome over CDP and reports what the
 * composition actually does: boot logs, HUD read-outs, focus acquisition from real
 * vantages, a played BM-1 sequence, console errors, and §36 budget numbers.
 *
 * Usage: node tmp-browser-check.mjs [boot|focus|bm1|branch] [--production]
 */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = process.cwd();
const SCENARIO = process.argv[2] ?? 'boot';
const PRODUCTION = process.argv.includes('--production');
const URL_ARG = process.argv.find((arg) => arg.startsWith('--url='))?.slice('--url='.length) ?? null;
const DEV_PORT = 5199;
const PREVIEW_PORT = 5198;
const DEBUG_PORT = 9333;
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = join(ROOT, '.tmp-chrome-profile');
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
    const steps = Math.max(Math.ceil(Math.abs(dx) / 119), Math.ceil(Math.abs(dy) / 119), 1);
    for (let i = 0; i < steps; i += 1) {
      window.__probe.look(dx / steps, dy / steps);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
   * Carry-safe relocation. EC-MAN-07 soft-detaches a held part that ends a step more
   * than maxHoldRange (2.6 m) from the player, and the part can only close
   * maxLinearSpeed (8 m/s ≈ 0.27 m per fixed step) — so one long teleport leaves the
   * part metres behind and drops it (what killed the valve's first dock attempt).
   * Hopping ≤0.8 m at a time with a settle between hops keeps the part in range, and
   * aiming at the target while hopping points the 1.35 m carry lead toward it.
   */
  hopTo: async (x, z, yaw) => {
    const start = window.__gearwrightDev.player.snapshot().position;
    const dx = x - start.x;
    const dz = z - start.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.8));
    for (let i = 1; i <= steps; i += 1) {
      window.__gearwrightDev.player.teleport({ x: start.x + (dx * i) / steps, y: 0.01, z: start.z + (dz * i) / steps });
      if (yaw !== undefined) await window.__probe.aimYaw(yaw);
      await new Promise((resolve) => setTimeout(resolve, 90));
    }
  },
  pitchHome: async () => window.__probe.lookBy(0, 600),
  pitchTo: async (pitch) =>
    window.__probe.lookBy(0, Math.max(-600, Math.min(600, (-1.1 - pitch) / 0.006))),
  stats: () => {
    const overlay = document.getElementById('debug-root');
    return { overlay: overlay ? overlay.textContent : null, memory: performance.memory ? performance.memory.usedJSHeapSize : null };
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
            const pitch = Math.atan2(1.4 - centre.y, h) + pitchOffset;
            if (pitch > 0.55 || pitch < -1.1) continue;
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

/** Focus + grab a loose part through the real composition (a KeyE edge). */
async function grabPart(cdp, part) {
  const found = await focusTarget(cdp, part.id, boxOf(part));
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
async function dockInto(cdp, socket) {
  const attempts = [];
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const length = Math.hypot(dx, dz);
    for (const back of [1.5, 1.2, 1.9, 2.3]) {
      const px = socket.center.x + (dx / length) * back;
      const pz = socket.center.z + (dz / length) * back;
      const yaw = Math.atan2(-(socket.center.x - px), -(socket.center.z - pz));
      await evaluate(
        cdp,
        `(async () => { await window.__probe.hopTo(${px}, ${pz}, ${yaw}); await window.__probe.pitchHome(); await window.__probe.pitchTo(0.0); await window.__probe.aimYaw(${yaw}); return true; })()`
      );
      await sleep(500);
      let hud = await evaluate(cdp, 'window.__probe.hud()');
      attempts.push(`dir ${dx},${dz} back ${back}: ${hud.socket?.text ?? '?'}`);
      // A hold can be soft-detached mid-hop (EC-MAN-07: >2.6 m from the player) — the
      // teleport-driven hopping is faster than a player, so the part can be left behind
      // and dropped. Clicking on is pointless; report it so the caller re-grabs.
      if (/empty-handed/i.test(hud.held?.text ?? '')) {
        attempts.push('hold lost — re-grab required');
        return { attempts, hud, dropped: true };
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
    const dockGear = await dockInto(cdp, drive);
    const grabValve = await grabPart(cdp, valve);
    const dockValve = await dockInto(cdp, line);
    await sleep(900);
    drainConsole(cdp);
    const fresh = report.logs.slice(before).join('\n');
    steps.assembly.push({ attempt, grabGear, dockGear, grabValve, dockValve });
    if (/BM-1 structure complete/.test(fresh)) break;
  }
  steps['after assembly'] = await evaluate(cdp, 'window.__probe.hud()');

  // Priming: the three lines in any order, then the engage lever.
  const props = [
    { id: 'bm1/prime-feed', x: -2.0 },
    { id: 'bm1/prime-return', x: -0.7 },
    { id: 'bm1/prime-bleed', x: 0.7 },
    { id: 'bm1/engage', x: 2.0 }
  ];
  steps.presses = [];
  for (const prop of props) {
    const box = {
      min: { x: prop.x - 0.25, y: 1.05, z: -16.8 },
      max: { x: prop.x + 0.25, y: 1.45, z: -16.4 }
    };
    const found = await focusTarget(cdp, prop.id, box, 3.4);
    if (found === null) {
      steps.presses.push({ id: prop.id, focus: 'NOT FOCUSABLE' });
      continue;
    }
    await tapKey(cdp, 'KeyE');
    await sleep(400);
    const hud = await evaluate(cdp, 'window.__probe.hud()');
    steps.presses.push({ id: prop.id, focus: found.focus.verb, objective: `${hud.objectiveTitle?.text} / ${hud.objectiveState?.text}`, failure: hud.objectiveFailure?.text });
    drainConsole(cdp);
    await sleep(700);
  }

  await sleep(1200);
  steps.finalHud = await evaluate(cdp, 'window.__probe.hud()');
  drainConsole(cdp);
  return steps;
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
      const dock = await dockInto(cdp, socket);
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

  // The clue beat (§6 step 8): the plate is awake, so focusing it *is* the discovery.
  const plate = level.hubTargets.find((entry) => entry.id === 'clue/regulator-plate');
  const plateFocus = await focusTarget(cdp, 'clue/regulator-plate', boxOf(plate));
  await sleep(700);
  drainConsole(cdp);
  const clueLogs = report.logs.join('\n');
  report.data.branchClue = {
    focused: plateFocus === null ? 'NOT FOCUSABLE' : `${plateFocus.focus.verb} @ ${plateFocus.focus.distance.toFixed(2)} m`,
    discovered: /\[clue\] discovered clue\/regulator-plate/.test(clueLogs),
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
    cluesRestored: /\[clue\] 1\/1 clue\(s\) discovered: clue\/regulator-plate/.test(reloadLogs),
    stagedRestored: /\[staged\] 4 staged action\(s\) restored/.test(reloadLogs),
    hubStage: /\[hub\] stage 1 \(Pressure Line Online\); branch-a=Complete \(open\)/.test(reloadLogs),
    progress: await evaluate(cdp, 'window.__probe.progress()'),
    hud: await evaluate(cdp, 'window.__probe.hud()')
  };
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
    }
    drainConsole(cdp);
  }
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
          `(async () => { await window.__probe.hopTo(${px}, ${pz}, ${yaw}); await window.__probe.pitchHome(); await window.__probe.pitchTo(0.0); await window.__probe.aimYaw(${yaw}); return true; })()`
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
