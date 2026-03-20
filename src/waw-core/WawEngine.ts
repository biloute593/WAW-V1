/**
 * WawEngine.ts — Orchestrateur principal du moteur Waw
 * 
 * Pipeline chaque frame :
 *   1. Lire frame caméra (video element)
 *   2. Si mode segmentation ou sky-replace → inférence SegmentationEngine
 *   3. Si mode sky-replace → SkyReplacer composite
 *   4. Dessiner résultat sur output canvas
 * 
 * RÈGLES :
 * - 100% offline (zéro fetch réseau après chargement initial)
 * - Zéro stockage de frames
 * - Ne jamais bloquer le main thread plus que nécessaire
 */

import { SegmentationEngine, SegmentationMask } from './SegmentationEngine';
import { SkyReplacer } from './SkyReplacer';

export type WawMode = 'passthrough' | 'segmentation' | 'sky-replace';
export type SkyType = 'clear' | 'sunset' | 'night';

export class WawEngine {
  private video!: HTMLVideoElement;
  private outputCanvas!: HTMLCanvasElement;
  private outputCtx!: CanvasRenderingContext2D;
  private debugCanvas!: HTMLCanvasElement;
  private debugCtx!: CanvasRenderingContext2D;

  private segEngine!: SegmentationEngine;
  private skyReplacer!: SkyReplacer;

  private mode: WawMode = 'passthrough';
  private running = false;
  private animFrameId = 0;

  // Performance tracking
  private frameCount = 0;
  private lastFpsTime = 0;
  private perfFpsEl!: HTMLElement;
  private perfSegEl!: HTMLElement;
  private perfRenderEl!: HTMLElement;

  // Processing resolution (lower = faster, higher = better masks)
  private readonly PROCESS_WIDTH = 513;   // DeepLab standard input
  private readonly PROCESS_HEIGHT = 513;

  // Temp canvas for resizing camera frame before inference
  private processCanvas!: HTMLCanvasElement;
  private processCtx!: CanvasRenderingContext2D;

  constructor() {
    // DOM elements
    this.video = document.getElementById('camera-feed') as HTMLVideoElement;
    this.outputCanvas = document.getElementById('output-canvas') as HTMLCanvasElement;
    this.outputCtx = this.outputCanvas.getContext('2d', { willReadFrequently: true })!;
    this.debugCanvas = document.getElementById('debug-canvas') as HTMLCanvasElement;
    this.debugCtx = this.debugCanvas.getContext('2d')!;

    // Perf elements
    this.perfFpsEl = document.getElementById('perf-fps')!;
    this.perfSegEl = document.getElementById('perf-seg')!;
    this.perfRenderEl = document.getElementById('perf-render')!;

    // Processing canvas (offscreen, for resizing frames)
    this.processCanvas = document.createElement('canvas');
    this.processCanvas.width = this.PROCESS_WIDTH;
    this.processCanvas.height = this.PROCESS_HEIGHT;
    this.processCtx = this.processCanvas.getContext('2d', { willReadFrequently: true })!;
  }

  // ── Load TensorFlow.js ──
  async loadTF(): Promise<void> {
    const tf = await import('@tensorflow/tfjs');
    await import('@tensorflow/tfjs-backend-webgl');
    await tf.setBackend('webgl');
    await tf.ready();
    console.log('[WawEngine] TF.js ready — backend:', tf.getBackend());
  }

  // ── Load Segmentation Model ──
  async loadSegmentationModel(): Promise<void> {
    this.segEngine = new SegmentationEngine();
    await this.segEngine.load();
    console.log('[WawEngine] Segmentation model loaded');
  }

  // ── Init Camera ──
  async initCamera(): Promise<void> {
    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: 'environment',  // Rear camera on mobile
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = stream;
      await new Promise<void>((resolve) => {
        this.video.onloadedmetadata = () => {
          // Set canvas sizes to match video
          this.outputCanvas.width = this.video.videoWidth;
          this.outputCanvas.height = this.video.videoHeight;
          this.debugCanvas.width = this.video.videoWidth;
          this.debugCanvas.height = this.video.videoHeight;
          resolve();
        };
      });
      console.log(`[WawEngine] Camera ready: ${this.video.videoWidth}×${this.video.videoHeight}`);
    } catch (err) {
      console.error('[WawEngine] Camera access failed:', err);
      throw new Error('Impossible d\'accéder à la caméra. Vérifie les permissions.');
    }

    // Init sky replacer (needs canvas dimensions)
    this.skyReplacer = new SkyReplacer(this.outputCanvas.width, this.outputCanvas.height);
  }

  // ── Public API ──

  setMode(mode: WawMode): void {
    this.mode = mode;
    
    // Toggle debug canvas visibility
    this.debugCanvas.style.display = mode === 'segmentation' ? 'block' : 'none';
    this.outputCanvas.style.display = mode === 'segmentation' ? 'none' : 'block';

    console.log(`[WawEngine] Mode: ${mode}`);
  }

  setSkyType(type: SkyType): void {
    this.skyReplacer.setSkyType(type);
    console.log(`[WawEngine] Sky type: ${type}`);
  }

  start(): void {
    this.running = true;
    this.lastFpsTime = performance.now();
    this.frameCount = 0;
    this.renderLoop();
    console.log('[WawEngine] Render loop started');
  }

  stop(): void {
    this.running = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
  }

  // ── Render Loop ──

  private renderLoop = (): void => {
    if (!this.running) return;

    this.animFrameId = requestAnimationFrame(this.renderLoop);
    this.processFrame();
  };

  private async processFrame(): Promise<void> {
    if (this.video.readyState < 2) return; // Video not ready yet

    const renderStart = performance.now();

    switch (this.mode) {
      case 'passthrough':
        this.drawPassthrough();
        break;

      case 'segmentation':
        await this.drawSegmentationDebug();
        break;

      case 'sky-replace':
        await this.drawSkyReplace();
        break;
    }

    // Performance tracking
    const renderTime = performance.now() - renderStart;
    this.updatePerf(renderTime);
  }

  // ── Passthrough: just draw camera to canvas ──
  private drawPassthrough(): void {
    this.outputCtx.drawImage(this.video, 0, 0, this.outputCanvas.width, this.outputCanvas.height);
  }

  // ── Segmentation Debug: colored overlay of class masks ──
  private async drawSegmentationDebug(): Promise<void> {
    const segStart = performance.now();

    // Resize frame for inference
    this.processCtx.drawImage(this.video, 0, 0, this.PROCESS_WIDTH, this.PROCESS_HEIGHT);

    // Run segmentation
    const mask = await this.segEngine.segment(this.processCanvas);
    const segTime = performance.now() - segStart;
    this.perfSegEl.textContent = `Seg: ${segTime.toFixed(1)}ms`;

    if (!mask) {
      // Fallback: just draw camera
      this.debugCtx.drawImage(this.video, 0, 0, this.debugCanvas.width, this.debugCanvas.height);
      return;
    }

    // Draw camera frame
    this.debugCtx.drawImage(this.video, 0, 0, this.debugCanvas.width, this.debugCanvas.height);

    // Overlay colored masks
    this.drawMaskOverlay(this.debugCtx, mask, this.debugCanvas.width, this.debugCanvas.height);
  }

  // ── Sky Replace: replace sky pixels, preserve people ──
  private async drawSkyReplace(): Promise<void> {
    const segStart = performance.now();

    // Resize frame for inference
    this.processCtx.drawImage(this.video, 0, 0, this.PROCESS_WIDTH, this.PROCESS_HEIGHT);

    // Run segmentation
    const mask = await this.segEngine.segment(this.processCanvas);
    const segTime = performance.now() - segStart;
    this.perfSegEl.textContent = `Seg: ${segTime.toFixed(1)}ms`;

    if (!mask) {
      this.drawPassthrough();
      return;
    }

    // Draw camera to output
    this.outputCtx.drawImage(this.video, 0, 0, this.outputCanvas.width, this.outputCanvas.height);

    // Get camera pixels
    const cameraImageData = this.outputCtx.getImageData(0, 0, this.outputCanvas.width, this.outputCanvas.height);

    // Composite: replace sky, preserve rest
    this.skyReplacer.composite(cameraImageData, mask);

    // Put composited result back
    this.outputCtx.putImageData(cameraImageData, 0, 0);
  }

  // ── Draw colored segmentation overlay ──
  private drawMaskOverlay(
    ctx: CanvasRenderingContext2D,
    mask: SegmentationMask,
    canvasW: number,
    canvasH: number
  ): void {
    // Create overlay image data
    const overlay = ctx.createImageData(canvasW, canvasH);
    const scaleX = mask.width / canvasW;
    const scaleY = mask.height / canvasH;

    // Color map for classes
    const classColors: Record<number, [number, number, number, number]> = {
      0:  [50, 150, 255, 90],    // Sky/background → blue
      15: [255, 50, 50, 100],    // Person → red
      7:  [255, 255, 0, 90],     // Car → yellow
      6:  [255, 140, 0, 90],     // Bus → orange
      14: [255, 200, 0, 90],     // Motorbike → gold
      16: [0, 200, 80, 90],      // Potted plant → green
      // Everything else → light gray with low alpha
    };
    const defaultColor: [number, number, number, number] = [128, 128, 128, 40];

    for (let y = 0; y < canvasH; y++) {
      for (let x = 0; x < canvasW; x++) {
        const maskX = Math.floor(x * scaleX);
        const maskY = Math.floor(y * scaleY);
        const classId = mask.data[maskY * mask.width + maskX];
        const color = classColors[classId] || defaultColor;

        const idx = (y * canvasW + x) * 4;
        overlay.data[idx]     = color[0];
        overlay.data[idx + 1] = color[1];
        overlay.data[idx + 2] = color[2];
        overlay.data[idx + 3] = color[3];
      }
    }

    // Blend overlay on top of camera
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvasW;
    tempCanvas.height = canvasH;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(overlay, 0, 0);

    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(tempCanvas, 0, 0);
  }

  // ── Performance Display ──
  private updatePerf(renderTimeMs: number): void {
    this.frameCount++;
    const now = performance.now();
    const elapsed = now - this.lastFpsTime;

    if (elapsed >= 1000) {
      const fps = Math.round((this.frameCount / elapsed) * 1000);
      this.perfFpsEl.textContent = `${fps} FPS`;
      this.perfRenderEl.textContent = `Render: ${renderTimeMs.toFixed(1)}ms`;
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
  }
}
