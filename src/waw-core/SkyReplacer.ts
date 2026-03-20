/**
 * SkyReplacer.ts — Waw SDK / WawCore
 * 
 * Remplacement du ciel en temps réel via Canvas 2D.
 * 
 * Input : ImageData de la caméra + masque de segmentation
 * Output : ImageData modifié in-place (ciel remplacé, humains préservés)
 * 
 * Stratégie :
 * 1. Pour chaque pixel classé "sky" (class 0) → remplacer par couleur du ciel choisi
 * 2. Pixels "person" (15), "car" (7), etc. → garder intacts (réalité)
 * 3. Bords → blending doux pour éviter les halos
 * 4. Tone mapping adaptatif : ajuster luminosité du ciel à l'exposition caméra
 */

import { SegmentationMask } from './SegmentationEngine';

export type SkyType = 'clear' | 'sunset' | 'night';

interface SkyGradient {
  top: [number, number, number];
  middle: [number, number, number];
  bottom: [number, number, number];
}

export class SkyReplacer {
  private canvasWidth: number;
  private canvasHeight: number;
  private skyType: SkyType = 'clear';

  // Pre-computed sky gradient lookup (per row of output)
  private skyLookup: Uint8ClampedArray | null = null;
  private skyLookupType: SkyType | null = null;
  private skyLookupHeight = 0;

  // Sky gradients (RGB per section)
  private readonly SKY_GRADIENTS: Record<SkyType, SkyGradient> = {
    clear: {
      top:    [30, 100, 220],    // Deep blue
      middle: [100, 170, 240],   // Light blue
      bottom: [160, 210, 250],   // Pale blue (horizon)
    },
    sunset: {
      top:    [20, 30, 80],      // Dark blue
      middle: [180, 80, 50],     // Orange-red
      bottom: [240, 160, 60],    // Golden
    },
    night: {
      top:    [5, 5, 20],        // Near black
      middle: [10, 15, 40],      // Dark blue
      bottom: [20, 25, 50],      // Slightly lighter
    },
  };

  constructor(width: number, height: number) {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  setSkyType(type: SkyType): void {
    this.skyType = type;
    this.skyLookup = null; // Force rebuild
  }

  /**
   * Composite sky replacement in-place on the camera ImageData.
   * Modifies cameraImageData directly — zero allocation per frame (except first).
   */
  composite(cameraImageData: ImageData, mask: SegmentationMask): void {
    const { width: outW, height: outH, data: pixels } = cameraImageData;
    const { data: maskData, width: maskW, height: maskH } = mask;

    // Build sky gradient lookup if needed
    if (!this.skyLookup || this.skyLookupType !== this.skyType || this.skyLookupHeight !== outH) {
      this.buildSkyLookup(outH);
    }

    const scaleX = maskW / outW;
    const scaleY = maskH / outH;
    const skyLookup = this.skyLookup!;

    // Compute average camera luminance for tone mapping (sample every 16th pixel)
    let cameraLumaSum = 0;
    let sampleCount = 0;
    for (let i = 0; i < pixels.length; i += 64) { // every 16th pixel × 4 channels
      cameraLumaSum += pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
      sampleCount++;
    }
    const avgCameraLuma = cameraLumaSum / Math.max(sampleCount, 1);
    const exposureFactor = Math.min(Math.max(avgCameraLuma / 128, 0.4), 1.8);

    // Process every pixel
    for (let y = 0; y < outH; y++) {
      const maskY = Math.floor(y * scaleY);

      for (let x = 0; x < outW; x++) {
        const maskX = Math.floor(x * scaleX);
        const classId = maskData[maskY * maskW + maskX];

        // Only replace sky pixels (class 0)
        if (classId !== 0) continue;

        // Compute edge blend factor (check neighborhood for non-sky pixels)
        const blend = this.computeEdgeBlend(maskData, maskW, maskH, maskX, maskY);

        // Get sky color for this row
        const skyIdx = y * 3;
        let skyR = skyLookup[skyIdx]     * exposureFactor;
        let skyG = skyLookup[skyIdx + 1] * exposureFactor;
        let skyB = skyLookup[skyIdx + 2] * exposureFactor;

        // Clamp
        skyR = Math.min(skyR, 255);
        skyG = Math.min(skyG, 255);
        skyB = Math.min(skyB, 255);

        // Blend: camera * (1-blend) + sky * blend
        const pixIdx = (y * outW + x) * 4;
        pixels[pixIdx]     = pixels[pixIdx]     * (1 - blend) + skyR * blend;
        pixels[pixIdx + 1] = pixels[pixIdx + 1] * (1 - blend) + skyG * blend;
        pixels[pixIdx + 2] = pixels[pixIdx + 2] * (1 - blend) + skyB * blend;
        // Alpha stays 255
      }
    }
  }

  /**
   * Compute soft blend factor at mask edges.
   * Counts sky neighbors in a 5×5 window → ratio used for blending.
   * Core sky = blend≈1.0, edge = blend<1.0 (softer transition).
   */
  private computeEdgeBlend(
    maskData: Int32Array,
    maskW: number,
    maskH: number,
    mx: number,
    my: number
  ): number {
    const radius = 2; // 5×5 kernel
    let skyCount = 0;
    let total = 0;

    for (let dy = -radius; dy <= radius; dy++) {
      const ny = my + dy;
      if (ny < 0 || ny >= maskH) continue;

      for (let dx = -radius; dx <= radius; dx++) {
        const nx = mx + dx;
        if (nx < 0 || nx >= maskW) continue;

        total++;
        if (maskData[ny * maskW + nx] === 0) {
          skyCount++;
        }
      }
    }

    return skyCount / Math.max(total, 1);
  }

  /**
   * Pre-build sky gradient lookup table (one RGB per row).
   * Avoids computing gradient math per pixel every frame.
   */
  private buildSkyLookup(height: number): void {
    const gradient = this.SKY_GRADIENTS[this.skyType];
    this.skyLookup = new Uint8ClampedArray(height * 3);

    for (let y = 0; y < height; y++) {
      const t = y / height; // 0 = top, 1 = bottom

      let r: number, g: number, b: number;

      if (t < 0.5) {
        // Top → middle
        const localT = t / 0.5;
        r = gradient.top[0] + (gradient.middle[0] - gradient.top[0]) * localT;
        g = gradient.top[1] + (gradient.middle[1] - gradient.top[1]) * localT;
        b = gradient.top[2] + (gradient.middle[2] - gradient.top[2]) * localT;
      } else {
        // Middle → bottom
        const localT = (t - 0.5) / 0.5;
        r = gradient.middle[0] + (gradient.bottom[0] - gradient.middle[0]) * localT;
        g = gradient.middle[1] + (gradient.bottom[1] - gradient.middle[1]) * localT;
        b = gradient.middle[2] + (gradient.bottom[2] - gradient.middle[2]) * localT;
      }

      const idx = y * 3;
      this.skyLookup[idx]     = Math.round(r);
      this.skyLookup[idx + 1] = Math.round(g);
      this.skyLookup[idx + 2] = Math.round(b);
    }

    this.skyLookupType = this.skyType;
    this.skyLookupHeight = height;
  }
}
