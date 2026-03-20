/**
 * SegmentationEngine.ts — Waw SDK / WawCore
 * 
 * Moteur de segmentation sémantique temps réel via TensorFlow.js
 * Utilise DeepLab (PASCAL VOC, 21 classes) pour classifier chaque pixel.
 * 
 * Classes clés pour Waw :
 *   0  = background (sky candidate si partie haute de l'image)
 *   7  = car
 *   15 = person
 *   16 = potted plant
 * 
 * RÈGLE : aucun frame n'est stocké. Les résultats sont des masques légers.
 */

export interface SegmentationMask {
  data: Int32Array;  // Class ID per pixel (converted from model output)
  width: number;
  height: number;
}

type DeepLabModel = {
  segment: (input: HTMLCanvasElement | ImageData) => Promise<{
    segmentationMap: Uint8ClampedArray;
    width: number;
    height: number;
  }>;
};

export class SegmentationEngine {
  private model: DeepLabModel | null = null;
  
  // Temporal smoothing
  private previousMask: Int32Array | null = null;
  private readonly SMOOTHING_THRESHOLD = 2; // Frames a pixel must be consistent before switching class
  private stabilityCounter: Uint8Array | null = null;
  private pendingMask: Int32Array | null = null;

  /**
   * Load the DeepLab segmentation model.
   * Downloads model weights (~8MB) on first load, then cached by browser.
   */
  async load(): Promise<void> {
    const deeplab = await import('@tensorflow-models/deeplab');
    
    // Load DeepLabV3 with PASCAL VOC (21 classes including person, car, plant, etc.)
    // Quantized version for faster inference
    this.model = await deeplab.load({
      base: 'pascal',       // PASCAL VOC 2012 dataset (21 classes)
      quantizationBytes: 2, // 2-byte quantization (smaller, faster)
    });

    console.log('[SegEngine] DeepLabV3 PASCAL loaded (quantized)');
  }

  /**
   * Run segmentation on a canvas frame.
   * Returns a mask with class ID per pixel.
   */
  async segment(canvas: HTMLCanvasElement): Promise<SegmentationMask | null> {
    if (!this.model) return null;

    try {
      const result = await this.model.segment(canvas);
      
      // Convert Uint8ClampedArray to Int32Array for processing
      const maskInt32 = new Int32Array(result.segmentationMap);
      
      // Apply sky heuristic: background (0) in upper part → sky
      const processed = this.applySkyHeuristic(maskInt32, result.width, result.height);
      
      // Apply temporal smoothing to reduce flicker
      const smoothed = this.applyTemporalSmoothing(processed);
      
      return {
        data: smoothed,
        width: result.width,
        height: result.height,
      };
    } catch (err) {
      console.error('[SegEngine] Inference error:', err);
      return null;
    }
  }

  /**
   * Sky heuristic: DeepLab classifies sky as "background" (0).
   * We keep class 0 for sky-candidate pixels in the upper portion.
   * Lower background pixels get remapped to 255 (other/ground).
   * This helps SkyReplacer know what to replace.
   */
  private applySkyHeuristic(mask: Int32Array, width: number, height: number): Int32Array {
    const result = new Int32Array(mask.length);
    
    for (let y = 0; y < height; y++) {
      const relativeY = y / height;
      
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const classId = mask[idx];
        
        if (classId === 0) {
          // Background — is it sky (upper) or ground (lower)?
          if (relativeY < 0.65) {
            // Upper 65% → likely sky
            result[idx] = 0;  // Keep as sky
          } else {
            // Lower 35% → likely ground/building
            result[idx] = 255; // Other
          }
        } else {
          result[idx] = classId;
        }
      }
    }
    
    return result;
  }

  /**
   * Temporal smoothing: prevent single-frame flickering.
   * A pixel only changes class after being consistent for N frames.
   */
  private applyTemporalSmoothing(mask: Int32Array): Int32Array {
    if (!this.previousMask || this.previousMask.length !== mask.length) {
      // First frame or resolution changed — no smoothing
      this.previousMask = new Int32Array(mask);
      this.stabilityCounter = new Uint8Array(mask.length);
      this.pendingMask = new Int32Array(mask);
      return mask;
    }

    const result = new Int32Array(mask.length);

    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === this.previousMask[i]) {
        // Same class as previous → stable, use it
        result[i] = mask[i];
        this.stabilityCounter![i] = 0;
      } else {
        // Class changed — check if it's been consistent
        if (mask[i] === this.pendingMask![i]) {
          this.stabilityCounter![i]++;
        } else {
          this.stabilityCounter![i] = 1;
          this.pendingMask![i] = mask[i];
        }

        if (this.stabilityCounter![i] >= this.SMOOTHING_THRESHOLD) {
          // New class is consistent enough → accept change
          result[i] = mask[i];
          this.stabilityCounter![i] = 0;
        } else {
          // Not yet stable → keep previous
          result[i] = this.previousMask[i];
        }
      }
    }

    this.previousMask = new Int32Array(result);
    return result;
  }
}
