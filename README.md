# Waw SDK

**Moteur AR web de transformation météo/saison en temps réel.**
Change le ciel, garde la réalité. Fonctionne dans le navigateur — Windows, Mac, iPhone, Android.

## Concept

Waw transforme ce que tu vois à travers ta caméra (laptop, téléphone) :
- Ciel gris → ciel bleu ensoleillé
- Jour → coucher de soleil ou nuit étoilée
- Bureau → atmosphère différente derrière toi

Tout en **préservant 100%** les personnes, véhicules et objets réels.

## Quick Start

```bash
# 1. Installer les dépendances
npm install

# 2. Lancer le serveur de développement
npm run dev

# 3. Ouvrir dans le navigateur
# → http://localhost:3000
# Autoriser l'accès caméra quand demandé
```

Pour tester sur iPhone (même réseau Wi-Fi) avec HTTPS :
```bash
npm run dev:https
# → https://<ton-ip>:3000
```

## Structure du projet

```
WAW V1/
├── .github/
│   └── copilot-instructions.md    ← Contexte IA persistant (GitHub Copilot)
├── AI_INSTRUCTIONS.md             ← Contexte IA détaillé (tout agent)
├── README.md                      ← Ce fichier
├── package.json                   ← Dépendances (TF.js, Vite)
├── tsconfig.json                  ← Config TypeScript (strict, ES2022)
├── vite.config.ts                 ← Config Vite (port 3000)
├── index.html                     ← HTML principal (UI complète)
└── src/
    ├── main.ts                    ← Entry point : boot, UI, render loop
    ├── styles.css                 ← Styles CSS complets
    └── waw-core/
        ├── WawEngine.ts           ← Orchestrateur (caméra → segmentation → compositing → display)
        ├── SegmentationEngine.ts  ← TF.js DeepLabV3 + heuristique ciel + temporal smoothing
        └── SkyReplacer.ts         ← Remplacement ciel (gradient procédural + tone mapping + edge blend)
```

## Architecture technique

```
Navigateur (WebRTC Camera)
    │
    ▼
WawEngine ─── getUserMedia → <video> → Canvas drawImage
    │
    ▼
SegmentationEngine ─── TF.js DeepLabV3 PASCAL VOC (quantized)
    │                   21 classes, heuristique ciel (background upper 65%)
    │                   Temporal smoothing (2+ frames stables)
    ▼
SkyReplacer ─── Canvas 2D in-place sur ImageData
    │           - Gradient procédural (clear / sunset / night)
    │           - Tone mapping adaptatif (luminance caméra)
    │           - Edge blending doux (5×5 kernel)
    │           - Préserve humains/objets intacts
    ▼
<canvas> (écran)
```

## Modes disponibles

| Mode | Touche | Description |
|------|--------|-------------|
| Passthrough | — | Caméra brute, aucun traitement |
| Segmentation | — | Masques colorés superposés (debug) |
| Sky Replace | — | Remplacement du ciel en temps réel |

## Types de ciel

| Type | Apparence |
|------|-----------|
| Clear | Ciel bleu dégradé (jour ensoleillé) |
| Sunset | Dégradé orange-rouge-bleu (coucher de soleil) |
| Night | Bleu très sombre (nuit) |

## Roadmap

| Version | Feature | Status |
|---------|---------|--------|
| V0.1 | Segmentation debug (masques colorés) | 🔨 En cours |
| V0.2 | Sky replacement live | 🔨 En cours |
| V0.3 | PWA installable + HTTPS local | 📋 Planifié |
| V0.4 | Background replacement indoor | 📋 Planifié |
| V1.0 | WebGL compositor (perf boost) | 📋 Futur |
| V2.0 | Saisons (végétation, atmosphère) | 📋 Futur |

## Contraintes

- **100% offline** — aucun appel réseau après chargement initial
- **Aucun stockage de frames** — privacy by design
- **30+ FPS** — performance temps réel (mobile), 60 FPS (desktop)
- **Cross-platform** — fonctionne dans tout navigateur moderne

## Documentation technique

Voir [AI_INSTRUCTIONS.md](AI_INSTRUCTIONS.md) pour les règles d'architecture, les notes de segmentation, et les consignes détaillées pour agents IA.

## Licence

Propriétaire — Tous droits réservés.
