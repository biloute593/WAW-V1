/**
 * main.ts — Waw SDK Entry Point
 * 
 * Pipeline: Camera → Segmentation (TF.js) → Compositing (Canvas) → Display
 * 100% offline — no network calls, no data storage
 */

import { WawEngine } from './waw-core/WawEngine';

async function boot() {
  const statusEl = document.getElementById('loading-status')!;
  const fillEl = document.getElementById('loading-fill')!;

  const updateLoading = (msg: string, pct: number) => {
    statusEl.textContent = msg;
    fillEl.style.width = `${pct}%`;
  };

  try {
    updateLoading('Initialisation du moteur Waw...', 10);

    const engine = new WawEngine();

    updateLoading('Chargement de TensorFlow.js...', 25);
    await engine.loadTF();

    updateLoading('Chargement du modèle de segmentation...', 50);
    await engine.loadSegmentationModel();

    updateLoading('Accès à la caméra...', 75);
    await engine.initCamera();

    updateLoading('Prêt !', 100);

    // Hide loading, show AR view
    setTimeout(() => {
      document.getElementById('loading-screen')!.style.display = 'none';
      document.getElementById('ar-view')!.style.display = 'block';

      // Setup UI controls
      setupControls(engine);

      // Start render loop
      engine.start();
    }, 400);

  } catch (err) {
    console.error('[Waw] Boot error:', err);
    updateLoading(`Erreur: ${(err as Error).message}`, 0);
  }
}

function setupControls(engine: WawEngine) {
  // Mode buttons
  const modeButtons = document.querySelectorAll<HTMLButtonElement>('.mode-btn');
  const modeIndicator = document.getElementById('mode-indicator')!;
  const skySelector = document.getElementById('sky-selector')!;

  const modeLabels: Record<string, string> = {
    'passthrough': '📷 Passthrough',
    'segmentation': '🔬 Segmentation Debug',
    'sky-replace': '☀️ Sky Replace',
  };

  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode!;
      
      // Update active button
      modeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update indicator
      modeIndicator.textContent = modeLabels[mode] || mode;
      
      // Show/hide sky selector
      skySelector.style.display = mode === 'sky-replace' ? 'flex' : 'none';
      
      // Set engine mode
      engine.setMode(mode as 'passthrough' | 'segmentation' | 'sky-replace');
    });
  });

  // Sky type buttons
  const skyButtons = document.querySelectorAll<HTMLButtonElement>('.sky-btn');
  skyButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const sky = btn.dataset.sky!;
      skyButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      engine.setSkyType(sky as 'clear' | 'sunset' | 'night');
    });
  });
}

// Boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
