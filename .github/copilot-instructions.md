# WAW ENGINE — Agent Instructions (V0)

## Projet
Waw est un moteur AR web-based, cross-platform, offline-only qui modifie la météo et la saison
en temps réel via la caméra du navigateur, tout en préservant le premier plan
(humains, véhicules, objets dynamiques).

## Stack obligatoire
- **TypeScript** (strict) + **Vite** (bundler)
- **TensorFlow.js** + @tensorflow-models/deeplab (DeepLabV3 PASCAL VOC, quantized)
- **WebRTC** (caméra) + **Canvas 2D** (compositing)
- Aucun framework UI (vanilla TS + HTML/CSS)

## Architecture
```
WebRTC Camera → Canvas drawImage
    → SegmentationEngine (TF.js DeepLabV3)
        → SkyReplacer (Canvas 2D : gradient + tone mapping + edge blend)
            → <canvas> display
```

## Règles strictes
1. **100% offline** — zéro appel réseau après chargement modèle, zéro upload, zéro analytics.
2. **Zéro stockage de frames** — ImageData traités puis garbage-collectés.
3. **Performance** — inférence async, canvas `willReadFrequently`, viser 30+ FPS mobile.
4. **Modularité** — WawCore indépendant du DOM. Chaque engine instanciable isolément.
5. **Privacy by design** — pas de permissions inutiles, message clair pour la caméra.
6. **Types stricts** — pas de `any`, tout est typé.

## Segmentation notes
- DeepLabV3 PASCAL VOC = 21 classes, pas de "sky" explicite.
- Heuristique : classe 0 (background) dans les 65% supérieurs = sky.
- Temporal smoothing : 2+ frames stables avant changement de classe.
- Résolution inférence : 513×513.

## Phases
- V0.1 : Segmentation debug (overlay masques colorés dans le navigateur)
- V0.2 : Sky replacement live + préservation humains
- V0.3 : Modes ciel multiples (clear, sunset, night) + UI sélecteur
- V1.0 : Migration compositing vers WebGL shaders

---
*Ce fichier est lu automatiquement par GitHub Copilot comme contexte persistant.*
