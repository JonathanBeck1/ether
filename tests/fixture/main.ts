// Plain-Vite consumer of the engine, driven by tests/e2e. Two flat-color
// scenes with instrumented lifecycles so the suite reads counters, not
// pixels (headless GL makes pixel assertions flaky).
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import fontUrl from 'three/examples/fonts/ttf/kenpixel.ttf?url';
import { attachSceneManager, BaseScene } from 'ether/core';
import { initCardTilt } from 'ether/interactions';
import { createProgress, loadGLTF, loadTexture } from 'ether/loaders';
import { createHeroComposer } from 'ether/postfx';
import { ShaderQuad } from 'ether/primitives';
import type { QualityProfile } from 'ether/quality';
import { msdfText } from 'ether/text/msdf';
import { initSceneRouter, type SceneRoutes, type VanillaRouter } from 'ether/vanilla';

// Forced profile: the suite asserts against MID, and the engine must not
// probe the GPU under test — headless GL classifies unpredictably.
const QUALITY: QualityProfile = {
  tier: 'MID',
  rawScore: 0,
  dprCap: 1.5,
  antialias: false,
  enablePostFX: true,
  enableDither: true,
  msaaSamples: 0,
  enableSmoothScroll: false,
  reducedMotion: false,
};

const VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uTime;
void main() {
  gl_FragColor = vec4(uColor * (0.75 + 0.25 * sin(uTime)), 1.0);
}
`;

export interface Counters {
  ticks: number;
  entered: number;
  exited: number;
  disposed: number;
  resized: number;
  retargeted: number;
}

// Latches the suite closes to hold a scene inside a transition phase and
// read the manager's mid-hop state, then opens again.
const openers: { preload?: () => void; exit?: () => void } = {};
const held: { preload?: Promise<void>; exit?: Promise<void> } = {};
const hold = (phase: 'preload' | 'exit') => {
  held[phase] = new Promise<void>((resolve) => {
    openers[phase] = resolve;
  });
};
const release = (phase: 'preload' | 'exit') => {
  openers[phase]?.();
  openers[phase] = undefined;
  held[phase] = undefined;
};

class FlatScene extends BaseScene {
  readonly counters: Counters = {
    ticks: 0,
    entered: 0,
    exited: 0,
    disposed: 0,
    resized: 0,
    retargeted: 0,
  };
  private readonly quad: ShaderQuad;
  retarget?: (route: string) => void;

  constructor(
    renderer: THREE.WebGLRenderer,
    quality: QualityProfile,
    readonly name: string,
    color: string,
    composed: boolean,
    retargetable = false,
  ) {
    super();
    if (retargetable) {
      this.retarget = () => {
        this.counters.retargeted++;
      };
    }
    this.quad = this.track(
      new ShaderQuad({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uColor: { value: new THREE.Color(color) } },
      }),
    );
    this.scene.add(this.quad.mesh);
    if (composed) {
      this.composer = createHeroComposer(renderer, this.scene, this.camera, {
        enableDither: quality.enableDither,
        multisampling: quality.msaaSamples,
      }).composer;
    }
  }

  async preload(): Promise<void> {
    await held.preload;
  }

  async enterTransition(): Promise<void> {
    this.counters.entered++;
  }

  async exitTransition(): Promise<void> {
    this.counters.exited++;
    await held.exit;
  }

  tick(time: number): void {
    this.counters.ticks++;
    this.quad.tick(time);
  }

  onResize(width: number, height: number): void {
    this.counters.resized++;
    this.quad.resize(width, height);
  }

  dispose(): void {
    this.counters.disposed++;
    super.dispose();
  }
}

// 1x1 PNG — enough to prove the texture path and its color space.
const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// GLB round-trip: export a triangle in-browser, load it back through
// the kit with a weighted progress bus, then a texture behind it.
async function loaderProbe() {
  const triangle = new THREE.Mesh(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
    ]),
    new THREE.MeshBasicMaterial(),
  );
  const glb = (await new GLTFExporter().parseAsync(triangle, { binary: true })) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
  const progress = createProgress();
  const steps: number[] = [];
  progress.onChange((v) => steps.push(v));
  const gltf = await loadGLTF(url, { progress, weight: 3 });
  const texture = await loadTexture(PIXEL_PNG, { progress, colorSpace: THREE.SRGBColorSpace });
  URL.revokeObjectURL(url);
  let meshes = 0;
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes++;
  });
  return {
    meshes,
    steps,
    value: progress.value,
    colorSpace: texture.colorSpace,
    width: (texture.image as { width: number }).width,
  };
}

// A GLB that cannot parse, behind a texture that can: the rejection has
// to reach the caller while the shared progress bus still settles.
async function failProbe() {
  const url = URL.createObjectURL(new Blob(['not a glb'], { type: 'model/gltf-binary' }));
  const progress = createProgress();
  const texture = loadTexture(PIXEL_PNG, { progress });
  let rejected = false;
  try {
    await loadGLTF(url, { progress, weight: 3 });
  } catch {
    rejected = true;
  }
  await texture;
  URL.revokeObjectURL(url);
  return { rejected, value: progress.value };
}

// The `bind` contract of ether/core, on a canvas of its own so the
// router-owned one the rest of the suite reads is untouched.
async function attachProbe() {
  const probeCanvas = document.body.appendChild(document.createElement('canvas'));
  const tierBefore = document.body.dataset.gpuTier ?? null;
  const quality: QualityProfile = { ...QUALITY, tier: 'LOW', dprCap: 1 };
  const built: { scene: FlatScene | null } = { scene: null };
  const binds: { current: boolean; tagged: boolean }[] = [];
  let unbinds = 0;
  const attachment = await attachSceneManager(
    probeCanvas,
    { '*': (renderer, q) => (built.scene = new FlatScene(renderer, q, 'P', '#30ff60', false)) },
    {
      quality,
      bind(attached) {
        binds.push({
          current: attached.isCurrent(),
          tagged:
            (probeCanvas as HTMLCanvasElement & { __sceneManager?: unknown }).__sceneManager ===
            attached.manager,
        });
        return () => {
          unbinds++;
        };
      },
    },
  );
  const pixelRatio = attachment.manager.renderer.getPixelRatio();
  const tierDuring = document.body.dataset.gpuTier ?? null;
  attachment.detach();
  const released =
    (probeCanvas as HTMLCanvasElement & { __sceneManager?: unknown }).__sceneManager === undefined;
  attachment.detach();
  // The initial transition is still mid-preload here: let it land on the
  // manager's torn-down guard rather than on a live scene.
  await new Promise((resolve) => setTimeout(resolve, 0));
  probeCanvas.remove();
  if (tierBefore) document.body.dataset.gpuTier = tierBefore;
  return {
    binds,
    overrode: attachment.quality === quality && attachment.manager.quality.tier === 'LOW',
    tierDuring,
    pixelRatio,
    expectedPixelRatio: Math.min(window.devicePixelRatio, quality.dprCap),
    released,
    unbinds,
    disposed: built.scene?.counters.disposed ?? -1,
    idle: attachment.manager.activeScene === null,
  };
}

// An unreachable font must reject rather than hang: troika's loader only
// console.errors a failed fetch and never calls back.
async function missingFontProbe(font: string) {
  const started = performance.now();
  try {
    await msdfText({ text: 'ETHER', font });
    return { rejected: false, message: '', ms: performance.now() - started };
  } catch (error) {
    return {
      rejected: true,
      message: (error as Error).message,
      ms: performance.now() - started,
    };
  }
}

// initCardTilt returns its teardown; after calling it, pointer movement must
// stop writing the tilt vars.
async function tiltProbe() {
  const card = document.createElement('div');
  card.setAttribute('data-tilt', '');
  card.style.cssText = 'position:fixed;top:0;left:0;width:200px;height:200px';
  document.body.append(card);

  const move = () =>
    card.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 150, clientY: 150, bubbles: true }),
    );
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => requestAnimationFrame(r));
  };
  const tiltX = () => card.style.getPropertyValue('--tilt-x');

  const teardown = initCardTilt();
  move();
  await settle();
  const bound = tiltX();

  teardown();
  card.style.removeProperty('--tilt-x');
  move();
  await settle();
  const afterTeardown = tiltX();

  card.remove();
  return { returnsFunction: typeof teardown === 'function', bound, afterTeardown };
}

async function textProbe() {
  const { mesh, dispose } = await msdfText({ text: 'ETHER', font: fontUrl, fontSize: 0.5 });
  const info = mesh.textRenderInfo;
  const result = {
    glyphs: info ? info.glyphAtlasIndices.length : 0,
    width: info ? info.blockBounds[2] - info.blockBounds[0] : 0,
  };
  dispose();
  return result;
}

declare global {
  interface Window {
    __fixture: {
      scenes: FlatScene[];
      router: VanillaRouter | null;
      boot(routes?: SceneRoutes): Promise<VanillaRouter>;
      flat: typeof flat;
      hold: typeof hold;
      release: typeof release;
      loaderProbe: typeof loaderProbe;
      failProbe: typeof failProbe;
      attachProbe: typeof attachProbe;
      textProbe: typeof textProbe;
      missingFontProbe: typeof missingFontProbe;
      tiltProbe: typeof tiltProbe;
    };
  }
}

const canvas = document.getElementById('scene-canvas') as HTMLCanvasElement;

// ?failinit: refuse the FIRST WebGL context, the way a browser under
// memory pressure does, so tests/e2e/recovery.mjs can retry the attach.
if (new URLSearchParams(location.search).has('failinit')) {
  const real = HTMLCanvasElement.prototype.getContext as (
    this: HTMLCanvasElement,
    id: string,
    options?: unknown,
  ) => RenderingContext | null;
  let refused = false;
  canvas.getContext = function (this: HTMLCanvasElement, id: string, options?: unknown) {
    if (refused) return real.call(this, id, options);
    refused = true;
    return null;
  } as HTMLCanvasElement['getContext'];
}

const scenes: FlatScene[] = [];
const flat =
  (name: string, color: string, composed: boolean, retargetable = false) =>
  (renderer: THREE.WebGLRenderer, quality: QualityProfile) => {
    const scene = new FlatScene(renderer, quality, name, color, composed, retargetable);
    scenes.push(scene);
    return scene;
  };
const A = flat('A', '#3060ff', true);
const B = flat('B', '#ff6030', false);
// One factory over two routes, with retarget(): the same-world path.
const C = flat('C', '#60ff30', false, true);
const boom = (): FlatScene => {
  throw new Error('fixture: scene factory failed');
};

const boot = (
  routes: SceneRoutes = { '/': A, '/b': B, '/c1': C, '/c2': C, '/boom': boom, '*': B },
) => initSceneRouter(canvas, routes, { quality: QUALITY, interceptLinks: true });

window.__fixture = {
  scenes,
  router: null,
  boot,
  flat,
  hold,
  release,
  loaderProbe,
  failProbe,
  attachProbe,
  textProbe,
  missingFontProbe,
  tiltProbe,
};
// A refused context (?failinit) rejects here by design; the suite reboots.
window.__fixture.router = await boot().catch(() => null);
