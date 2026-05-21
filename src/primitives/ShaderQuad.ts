import * as THREE from 'three';

export interface ShaderQuadOptions {
  vertexShader: string;
  fragmentShader: string;
  /**
   * Additional uniforms specific to your shader. `uTime` and `uAspect`
   * are added automatically and updated by `tick()` / `resize()` —
   * don't provide them here.
   */
  uniforms?: Record<string, THREE.IUniform>;
  /** Plane width in world units. Default 50 (oversized to overshoot frustum). */
  width?: number;
  /** Plane height. Default 32. */
  height?: number;
  /** Z position. Default -8 (well behind scene origin). */
  z?: number;
  /** `mesh.renderOrder`. Default -10 (renders before everything else). */
  renderOrder?: number;
  /** `material.depthWrite`. Default false — backdrop shouldn't occlude. */
  depthWrite?: boolean;
  /** `material.depthTest`. Default false. */
  depthTest?: boolean;
  /** `mesh.frustumCulled`. Default false — the oversized plane often
   *  registers outside the frustum at edges; we always want it drawn. */
  frustumCulled?: boolean;
}

/**
 * A fullscreen-ish shader-driven plane. Owns the geometry, material,
 * mesh, and the two uniforms every animated backdrop needs (`uTime`,
 * `uAspect`). The shader is yours; the wiring is the kit's.
 *
 * Typical use — animated background quad behind the main scene:
 *
 *   const bg = new ShaderQuad({
 *     vertexShader: passthroughVert,
 *     fragmentShader: causticsFrag,
 *     uniforms: {
 *       uIntensity: { value: 0.04 },
 *       uBaseColor: { value: new THREE.Color('#05060a') },
 *     },
 *   });
 *   scene.add(bg.mesh);
 *   // per frame
 *   bg.tick(elapsed);
 *   // on resize
 *   bg.resize(w, h);
 *   // teardown
 *   bg.dispose();
 *
 * Consumers can reach `.material.uniforms` to set additional values at
 * runtime (e.g. ramping `uIntensity` for a fade). `tick()` and `resize()`
 * are the only built-in uniform writes.
 */
export class ShaderQuad {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(options: ShaderQuadOptions) {
    const {
      vertexShader,
      fragmentShader,
      uniforms = {},
      width = 50,
      height = 32,
      z = -8,
      renderOrder = -10,
      depthWrite = false,
      depthTest = false,
      frustumCulled = false,
    } = options;

    const geometry = new THREE.PlaneGeometry(width, height);
    this.disposables.push(geometry);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uAspect: { value: window.innerWidth / window.innerHeight },
        ...uniforms,
      },
      depthWrite,
      depthTest,
    });
    this.disposables.push(this.material);

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.z = z;
    this.mesh.renderOrder = renderOrder;
    this.mesh.frustumCulled = frustumCulled;
  }

  /** Per-frame: advance `uTime`. */
  tick(time: number): void {
    this.material.uniforms.uTime.value = time;
  }

  /** On window resize: refresh `uAspect`. */
  resize(width: number, height: number): void {
    this.material.uniforms.uAspect.value = width / height;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
