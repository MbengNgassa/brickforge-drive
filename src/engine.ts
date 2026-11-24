import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { GraphicsQuality } from './types';

/**
 * Full-GPU WebGL2 Graphics Engine with PBR studio environment reflections,
 * dynamic shadows, ACES Filmic tone mapping, and safe hardware-checked
 * selective UnrealBloom for luminous jet thrusters and crash sparks.
 */
export class GraphicsEngine {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly pmrem: THREE.PMREMGenerator;
  public readonly envRT: THREE.WebGLRenderTarget;

  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private quality: GraphicsQuality = 'ultra';
  private gpuName = 'Hardware WebGL2 GPU';
  private supportsSafeBloom = false;
  private bloomSceneEnabled = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.15, 650);

    // Real PBR environment reflections so glossy ABS bricks gleam cleanly without washing out
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    this.envRT = this.pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.52;

    this.detectGpuInfo();
    this.checkBloomSafety();

    const saved = this.loadQuality();
    this.setQuality(saved);

    window.addEventListener('resize', this.handleResize);
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
    });
  }

  public setBloomEnabled(enabled: boolean): void {
    this.bloomSceneEnabled = enabled;
  }

  private detectGpuInfo(): void {
    try {
      const gl = this.renderer.getContext();
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const raw = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        if (typeof raw === 'string' && raw.length > 0) {
          this.gpuName = raw.replace(/ANGLE \((.*)\)/, '$1').slice(0, 48);
        }
      }
    } catch {
      // keep default
    }
  }

  private checkBloomSafety(): void {
    try {
      const gl = this.renderer.getContext();
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const hasFloatRT =
        Boolean(gl.getExtension('EXT_color_buffer_float')) ||
        Boolean(gl.getExtension('EXT_color_buffer_half_float'));
      this.supportsSafeBloom = !isMobile && this.renderer.capabilities.isWebGL2 && hasFloatRT;
    } catch {
      this.supportsSafeBloom = false;
    }
  }

  public getGpuName(): string {
    return this.gpuName;
  }

  public getQuality(): GraphicsQuality {
    return this.quality;
  }

  private loadQuality(): GraphicsQuality {
    try {
      const val = localStorage.getItem('brickforge_quality');
      if (val === 'ultra' || val === 'high' || val === 'balanced') return val;
    } catch {
      // ignore
    }
    return 'ultra';
  }

  public setQuality(q: GraphicsQuality): void {
    this.quality = q;
    try {
      localStorage.setItem('brickforge_quality', q);
    } catch {
      // ignore
    }

    const dpr = window.devicePixelRatio || 1;
    if (q === 'ultra') {
      this.renderer.setPixelRatio(Math.min(dpr, 2.0));
      this.renderer.shadowMap.enabled = true;
      if (this.supportsSafeBloom) {
        this.setupPostProcessing();
      } else {
        this.teardownPostProcessing();
      }
    } else if (q === 'high') {
      this.renderer.setPixelRatio(Math.min(dpr, 1.65));
      this.renderer.shadowMap.enabled = true;
      this.teardownPostProcessing();
    } else {
      this.renderer.setPixelRatio(Math.min(dpr, 1.15));
      this.renderer.shadowMap.enabled = true;
      this.teardownPostProcessing();
    }
    this.handleResize();
  }

  public getShadowMapSize(): number {
    if (this.quality === 'ultra') return 2048;
    if (this.quality === 'high') return 1024;
    return 512;
  }

  private setupPostProcessing(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.renderPass = new RenderPass(this.scene, this.camera);
    // High luminance threshold (1.45) so ONLY emissive plasma thrusters, lights & sparks bloom — never normal bricks!
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.28, 0.38, 1.45);
    const outputPass = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(outputPass);
  }

  private teardownPostProcessing(): void {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.renderPass = null;
      this.bloomPass = null;
    }
  }

  public clearScene(): void {
    while (this.scene.children.length > 0) {
      this.scene.remove(this.scene.children[0]);
    }
    this.scene.fog = null;
  }

  public handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    if (this.bloomPass) {
      this.bloomPass.setSize(w, h);
    }
  };

  public render(): void {
    if (this.composer && this.quality === 'ultra' && this.supportsSafeBloom && this.bloomSceneEnabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
