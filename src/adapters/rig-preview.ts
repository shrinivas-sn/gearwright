/**
 * L4 DEBUG TOOL — `?rig=1` rig preview (ARCH §37).
 *
 * A standalone preview of the procedural player body: its own `three` scene, its own
 * `CharacterRig`, and a small slider panel (speed / carry / grounded / gait scrub). It never
 * touches game state, the simulation, or the shipped renderer — it only exists so animation
 * can be iterated in seconds instead of by walking to a part and picking it up.
 *
 * Additive by contract (§37): this module is imported and mounted only when the `rig` URL flag
 * is present, and `dispose()` removes everything it added. Production without the flag is
 * byte-identical with or without this file.
 */

import * as THREE from 'three';

import { CharacterRig } from './character-rig.ts';

export interface RigPreviewOptions {
  /** Element to append the preview canvas + panel to (defaults to `document.body`). */
  readonly root?: HTMLElement | undefined;
  /** Initial slider values; everything defaults to a standing idle. */
  readonly speed?: number | undefined;
  readonly carrying?: boolean | undefined;
  readonly grounded?: boolean | undefined;
}

interface SliderSpec {
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
}

interface PreviewState {
  speed: number;
  carrying: boolean;
  grounded: boolean;
  gaitScrub: number;
  scrub: boolean;
  distance: number;
}

/**
 * Mount the preview. Returns a `dispose` that removes the canvas, stops the loop and frees
 * GPU resources. Safe to call when WebGL2 is unavailable — reports `ok: false` and adds
 * nothing to the DOM.
 */
export function mountRigPreview(
  options: RigPreviewOptions = {}
): { readonly ok: boolean; dispose(): void } {
  const doc = options.root?.ownerDocument ?? (typeof document === 'undefined' ? null : document);
  const root = options.root ?? (typeof document === 'undefined' ? null : document.body);
  if (doc === null || root === null) return { ok: false, dispose: () => {} };

  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    return { ok: false, dispose: () => {} };
  }
  const gl = renderer;
  if (gl === null) return { ok: false, dispose: () => {} };

  const host = doc.createElement('div');
  host.className = 'gw-rig-preview';
  const canvas = gl.domElement;
  canvas.setAttribute('aria-label', 'Player rig preview');
  host.appendChild(canvas);

  const panel = doc.createElement('div');
  panel.className = 'gw-rig-preview-panel';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Rig preview controls');
  host.appendChild(panel);
  root.appendChild(host);
  return mountScene(doc, host, panel, gl, options);
}



function mountScene(
  doc: Document,
  host: HTMLDivElement,
  panel: HTMLDivElement,
  renderer: THREE.WebGLRenderer,
  options: RigPreviewOptions
): { readonly ok: boolean; dispose(): void } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14171a);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
  camera.position.set(1.6, 1.5, 2.6);
  camera.lookAt(0, 0.9, 0);
  scene.add(new THREE.HemisphereLight(0xbfc6cf, 0x2a2e33, 1.1));
  const key = new THREE.DirectionalLight(0xfff4e6, 1.6);
  key.position.set(2, 4, 3);
  scene.add(key);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.95, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const rig = new CharacterRig();
  scene.add(rig.object);

  const state: PreviewState = {
    speed: options.speed ?? 0,
    carrying: options.carrying ?? false,
    grounded: options.grounded ?? true,
    gaitScrub: 0,
    scrub: false,
    distance: 0
  };
  wireControls(doc, panel, state);
  return runLoop(host, panel, scene, camera, floor, rig, renderer, state);
}


function wireControls(doc: Document, panel: HTMLDivElement, state: PreviewState): void {
  const sliders: SliderSpec[] = [
    { id: 'speed', label: 'speed', min: 0, max: 5, step: 0.1, value: state.speed },
    { id: 'gait', label: 'gait scrub', min: 0, max: Math.PI * 2, step: 0.05, value: 0 }
  ];
  for (const spec of sliders) {
    const row = doc.createElement('label');
    row.className = 'gw-rig-preview-row';
    const name = doc.createElement('span');
    name.textContent = spec.label;
    const input = doc.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(spec.value);
    input.setAttribute('aria-label', spec.label);
    const readout = doc.createElement('output');
    readout.textContent = spec.value.toFixed(2);
    input.addEventListener('input', () => {
      const value = Number.parseFloat(input.value);
      readout.textContent = Number.isFinite(value) ? value.toFixed(2) : input.value;
      if (spec.id === 'speed') state.speed = Number.isFinite(value) ? value : 0;
      if (spec.id === 'gait') {
        state.gaitScrub = Number.isFinite(value) ? value : 0;
        state.scrub = true;
      }
    });
    row.append(name, input, readout);
    panel.appendChild(row);
  }

  const toggle = (label: string, initial: boolean, onChange: (value: boolean) => void): void => {
    const row = doc.createElement('label');
    row.className = 'gw-rig-preview-row';
    const name = doc.createElement('span');
    name.textContent = label;
    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.checked = initial;
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => onChange(input.checked));
    row.append(name, input);
    panel.appendChild(row);
  };
  toggle('carrying', state.carrying, (value) => {
    state.carrying = value;
  });
  toggle('grounded', state.grounded, (value) => {
    state.grounded = value;
  });
  toggle('scrub gait', false, (value) => {
    state.scrub = value;
  });

  const note = doc.createElement('p');
  note.className = 'gw-rig-preview-note';
  note.textContent = '?rig=1 preview — the game behind this is untouched';
  panel.appendChild(note);
}

function runLoop(
  host: HTMLDivElement,
  panel: HTMLDivElement,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>,
  rig: CharacterRig,
  renderer: THREE.WebGLRenderer,
  state: PreviewState
): { readonly ok: boolean; dispose(): void } {
  void panel;
  const resize = (): void => {
    const width = Math.max(1, Math.floor(host.clientWidth || 360));
    const height = Math.max(1, Math.floor(host.clientHeight || 420));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  const view = typeof window === 'undefined' ? null : window;
  const onResize = (): void => resize();
  view?.addEventListener('resize', onResize);

  const position = { x: 0, y: 0, z: 0 };
  let last = performance.now();
  let raf = 0;
  let disposed = false;
  const frame = (now: number): void => {
    if (disposed) return;
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.25);
    last = now;
    if (state.scrub) {
      state.distance = state.gaitScrub;
      position.z = -state.gaitScrub;
    } else {
      state.distance += state.speed * dt;
      position.z = -state.distance;
    }
    rig.update({
      position,
      facingYaw: 0,
      speed: state.speed,
      walkSpeed: 1.8,
      runSpeed: 4.6,
      grounded: state.grounded,
      carrying: state.carrying,
      dt,
      holdTarget: state.carrying ? { x: 0, y: 1.25, z: -0.42 } : null,
      weaponGrip: null,
      footGroundY: null,
      lookTarget: { x: 0, y: 1.4, z: -3 },
      cameraDistance: 4.2
    });
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    ok: true,
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      view?.removeEventListener('resize', onResize);
      rig.dispose();
      floor.geometry.dispose();
      floor.material.dispose();
      scene.clear();
      renderer.dispose();
      host.remove();
    }
  };
}

