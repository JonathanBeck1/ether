// Plain-Vite consumer of the engine, driven by tests/e2e. Two flat-color
// scenes with instrumented lifecycles so the suite reads counters, not
// pixels (headless GL makes pixel assertions flaky).
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import fontUrl from 'three/examples/fonts/ttf/kenpixel.ttf?url';
import { BaseScene } from 'ether/core';
import { createProgress, loadGLTF, loadTexture } from 'ether/loaders';
import { createHeroComposer } from 'ether/postfx';
import { ShaderQuad } from 'ether/primitives';
import type { QualityProfile } from 'ether/quality';
import { msdfText } from 'ether/text/msdf';
import { initSceneRouter, type VanillaRouter } from 'ether/vanilla';

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
}

class FlatScene extends BaseScene {
  readonly counters: Counters = { ticks: 0, entered: 0, exited: 0, disposed: 0, resized: 0 };
  private readonly quad: ShaderQuad;

  constructor(
    renderer: THREE.WebGLRenderer,
    quality: QualityProfile,
    readonly name: string,
    color: string,
    composed: boolean,
  ) {
    super();
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

  async enterTransition(): Promise<void> {
    this.counters.entered++;
  }

  async exitTransition(): Promise<void> {
    this.counters.exited++;
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
      boot(): Promise<VanillaRouter>;
      loaderProbe: typeof loaderProbe;
      textProbe: typeof textProbe;
    };
  }
}

const canvas = document.getElementById('scene-canvas') as HTMLCanvasElement;
const scenes: FlatScene[] = [];
const flat =
  (name: string, color: string, composed: boolean) =>
  (renderer: THREE.WebGLRenderer, quality: QualityProfile) => {
    const scene = new FlatScene(renderer, quality, name, color, composed);
    scenes.push(scene);
    return scene;
  };
const A = flat('A', '#3060ff', true);
const B = flat('B', '#ff6030', false);

const boot = () =>
  initSceneRouter(canvas, { '/': A, '/b': B, '*': B }, { quality: QUALITY, interceptLinks: true });

window.__fixture = { scenes, router: null, boot, loaderProbe, textProbe };
window.__fixture.router = await boot();
