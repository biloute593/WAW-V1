# WAW ENGINE — Project Prompt

> Ce fichier est destiné à tout agent IA qui intervient sur le projet.
> Il résume le principe, l'architecture, les contraintes et l'état actuel du code.

---

## Qu'est-ce que Waw ?

**Waw** est un **moteur de réalité augmentée (AR) web-based** qui transforme la météo et la saison
en temps réel à travers la caméra du navigateur.

**En une phrase** : l'utilisateur ouvre son navigateur, active sa caméra, et Waw remplace le ciel
(gris → bleu, jour → coucher de soleil, nuit étoilée…) tout en **préservant 100%** les personnes,
véhicules et objets du premier plan.

### Cas d'usage
| Scénario | Description |
|----------|-------------|
| Outdoor mobile | Pointer la caméra du téléphone vers un ciel gris → le voir devenir bleu en temps réel |
| Indoor laptop | Remplacer le ciel visible derrière soi en visio ou preview |
| Preview saison | Visualiser un même paysage sous différentes lumières (été, crépuscule, nuit) |

---

## Stack technique

| Couche | Technologie | Rôle |
|--------|-------------|------|
| Langage | **TypeScript** (strict, zéro `any`) | Tout le code source |
| Bundler | **Vite** | Dev server (port 3000) + build prod |
| Capture vidéo | **WebRTC** (`getUserMedia`) | Flux caméra temps réel |
| Segmentation IA | **TensorFlow.js** + **DeepLabV3** (PASCAL VOC, quantized 2-byte) | Identifier chaque pixel (ciel, personne, voiture…) |
| Rendu | **Canvas 2D** (compositing in-place sur `ImageData`) | Remplacement ciel + affichage |
| UI | Vanilla **HTML/CSS** (aucun framework) | Interface utilisateur légère |

---

## Architecture — Pipeline par frame

```
┌─────────────────────────────────────────────────────────────┐
│                       NAVIGATEUR                            │
│                                                             │
│   WebRTC Camera (getUserMedia)                              │
│        │                                                    │
│        ▼                                                    │
│   <video> ──────────────────────────────────────────┐       │
│        │                                            │       │
│        ▼                                            │       │
│   processCanvas (513×513)     outputCanvas (1280×720)│      │
│        │                            ▲               │       │
│        ▼                            │               │       │
│   SegmentationEngine                │               │       │
│   (TF.js DeepLabV3)                │               │       │
│   → masque sémantique (Int32Array)  │               │       │
│   → heuristique ciel               │               │       │
│   → temporal smoothing              │               │       │
│        │                            │               │       │
│        ▼                            │               │       │
│   SkyReplacer                       │               │       │
│   → gradient procédural (clear/sunset/night)        │       │
│   → tone mapping adaptatif          │               │       │
│   → edge blending 5×5              │               │       │
│   → rendu in-place sur ImageData ───┘               │       │
│                                                     │       │
│   <canvas> affiché à l'écran ◄──────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

---

## Structure du code

```
WAW V1/
├── PROJECT_PROMPT.md              ← CE FICHIER (contexte agent)
├── AI_INSTRUCTIONS.md             ← Règles détaillées pour agents IA
├── .github/copilot-instructions.md← Contexte GitHub Copilot
├── README.md                      ← Documentation utilisateur
├── package.json                   ← Deps: TF.js, Vite, TypeScript
├── tsconfig.json                  ← TypeScript strict, ES2022
├── vite.config.ts                 ← Vite (port 3000, HTTPS optionnel)
├── index.html                     ← HTML principal (loading + AR view + contrôles)
└── src/
    ├── main.ts                    ← Entry point : boot → loadTF → loadModel → initCamera → UI → start
    ├── styles.css                 ← Styles complets (loading, AR view, contrôles)
    └── waw-core/                  ← Moteur cœur (indépendant du DOM)
        ├── WawEngine.ts           ← Orchestrateur : caméra → segmentation → compositing → affichage
        ├── SegmentationEngine.ts  ← TF.js DeepLabV3 + heuristique ciel + temporal smoothing
        └── SkyReplacer.ts         ← Remplacement ciel (gradient + tone mapping + edge blend)
```

### Rôle de chaque module

**`main.ts`** — Séquence de boot :
1. Affiche écran de chargement avec barre de progression
2. Instancie `WawEngine`
3. Charge TF.js (backend WebGL)
4. Charge le modèle DeepLabV3
5. Initialise la caméra
6. Wire les contrôles UI (boutons mode + boutons ciel)
7. Lance le render loop

**`WawEngine.ts`** — Orchestrateur principal :
- Gère 3 modes : `passthrough` (caméra brute), `segmentation` (masques colorés debug), `sky-replace` (remplacement ciel)
- Render loop via `requestAnimationFrame`
- Tracking FPS / temps segmentation / temps render
- Canvas dédié 513×513 pour inférence (pas de resize du canvas principal)

**`SegmentationEngine.ts`** — Intelligence artificielle :
- Charge DeepLabV3 PASCAL VOC (21 classes, quantized 2-byte, ~8MB)
- Inférence async sur chaque frame
- Heuristique ciel : classe 0 (background) dans les 65% supérieurs de l'image → classé "sky"
- Temporal smoothing : un pixel doit être stable pendant 2+ frames avant changement de classe (anti-flicker)

**`SkyReplacer.ts`** — Compositing visuel :
- 3 types de ciel : `clear` (bleu), `sunset` (orange-rouge), `night` (sombre)
- Gradient procédural pré-calculé par type (lookup table par ligne)
- Tone mapping adaptatif basé sur la luminance de la caméra
- Edge blending doux (kernel 5×5) pour bords propres entre ciel et objets
- Modification in-place de l'ImageData (zéro allocation par frame après init)

---

## Segmentation — Détails techniques

| Paramètre | Valeur |
|-----------|--------|
| Modèle | DeepLabV3 PASCAL VOC 2012 |
| Classes | 21 (person=15, car=7, plant=16, bicycle=2, background=0…) |
| Quantization | 2-byte (plus léger, plus rapide) |
| Résolution inférence | 513×513 (taille native DeepLab) |
| Classe "sky" | Pas explicite → heuristique : background (0) + zone haute image (>65%) |
| Temporal smoothing | 2 frames stables consécutives requis |

### Classes préservées (premier plan)
Les pixels de ces classes ne sont **jamais remplacés** :
- 15 = person
- 7 = car
- 16 = potted plant
- 2 = bicycle
- Toute classe ≠ 0 dans la zone ciel

---

## Contraintes non négociables

### Privacy & Offline
- **100% offline** après chargement initial du modèle — zéro fetch, zéro upload, zéro analytics
- **Zéro stockage de frames** — les ImageData sont traités puis garbage-collectés
- Aucun log d'image sur disque ou réseau
- Seule permission demandée : caméra (ni micro, ni géoloc)

### Performance
- Render loop via `requestAnimationFrame` — cible **30+ FPS mobile**, 60 FPS desktop
- Inférence ML **asynchrone** (ne bloque pas le render)
- Canvas `willReadFrequently: true`
- Gradient ciel **pré-calculé** (pas de lerp par pixel par frame)

### Architecture code
- **WawCore indépendant du DOM** — les engines ne manipulent pas le DOM directement
- Chaque engine **instanciable isolément**
- **Types stricts** — pas de `any`, tout est typé
- **Pas de singletons** — injection via constructeur
- Pas de framework UI (vanilla TS + HTML/CSS)

---

## Modes de l'application

| Mode | Rendu | Usage |
|------|-------|-------|
| `passthrough` | Caméra brute dessinée sur le canvas | Mode par défaut, aucun traitement |
| `segmentation` | Masques colorés superposés à la caméra (debug) | Visualiser les classes détectées |
| `sky-replace` | Ciel remplacé, humains/objets préservés | Mode principal AR |

### Types de ciel disponibles

| Type | Gradient |
|------|----------|
| `clear` | Bleu profond → bleu clair → bleu pâle (jour ensoleillé) |
| `sunset` | Bleu sombre → orange-rouge → doré (coucher de soleil) |
| `night` | Quasi-noir → bleu sombre → légèrement plus clair |

---

## Commandes

```bash
npm install          # Installer les dépendances
npm run dev          # Serveur dev local (http://localhost:3000)
npm run dev:https    # Serveur dev HTTPS (pour tester sur mobile, même réseau)
npm run build        # Build production (tsc + vite build)
npm run preview      # Prévisualiser le build prod
```

---

## Roadmap

| Version | Objectif | État |
|---------|----------|------|
| **V0.1** | Segmentation debug (masques colorés dans le navigateur) | ✅ Implémenté |
| **V0.2** | Sky replacement live + préservation humains | ✅ Implémenté |
| **V0.3** | Modes ciel multiples (clear, sunset, night) + UI sélecteur | ✅ Implémenté |
| **V0.4** | PWA installable + HTTPS local | 📋 À faire |
| **V1.0** | Migration compositing Canvas 2D → WebGL shaders | 📋 À faire |
| **V1.x** | Recoloration végétation (shader saisonnier) | 📋 À faire |
| **V2.0** | Relighting adaptatif (ombres cohérentes au nouveau ciel) | 📋 À faire |

---

## Pour contribuer / modifier

1. Lire `AI_INSTRUCTIONS.md` pour les règles strictes complètes
2. Le code est dans `src/waw-core/` — ne pas mettre de logique DOM dans les engines
3. Tout doit rester **100% offline** et **privacy-first**
4. TypeScript strict — aucun `any`
5. Tester sur mobile (Chrome Android / Safari iOS) avec `npm run dev:https`

---

*Ce fichier est lu automatiquement par tout agent IA intervenant sur le projet.*
