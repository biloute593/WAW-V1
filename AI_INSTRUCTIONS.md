# WAW ENGINE — Agent Instructions (V0)

## Projet
Waw est un moteur AR (MR passthrough) **web-based, cross-platform, offline-only** qui modifie
la météo et la saison en temps réel sur la caméra (desktop ou mobile), tout en préservant
intégralement le premier plan (humains, véhicules, objets dynamiques).

## Vision produit
L'utilisateur ouvre Waw dans son navigateur (Chrome, Safari, Firefox).
Il active la caméra et choisit un thème météo/saison (soleil, coucher de soleil, nuit…).
Le ciel et l'atmosphère changent visuellement — mais les personnes,
véhicules et objets dynamiques restent 100% fidèles à la réalité.

Cas d'usage principaux :
1. **Outdoor** : transformer un ciel gris en ciel bleu, via la caméra du téléphone/laptop.
2. **Indoor** : remplacer l'arrière-plan par un autre ciel tout en gardant le bureau réel.
3. **Preview saison** : visualiser un paysage sous différentes lumières/saisons.

## Stack obligatoire
- **Langage** : TypeScript (strict mode)
- **Plateforme** : Web (Chrome 90+, Safari 15+, Firefox 90+), desktop & mobile
- **Bundler** : Vite
- **Capture caméra** : WebRTC (`navigator.mediaDevices.getUserMedia`)
- **Machine Learning** : TensorFlow.js + @tensorflow-models/deeplab (DeepLabV3 PASCAL VOC, quantized 2-byte)
- **GPU Backend** : @tensorflow/tfjs-backend-webgl
- **Rendu** : Canvas 2D (compositing in-place sur ImageData)
- **Aucun framework UI lourd** (pas de React/Vue/Angular — vanilla TS + HTML/CSS)

## Architecture

```
WebRTC Camera (getUserMedia)
    → <video> element → Canvas drawImage
        → SegmentationEngine (TF.js DeepLabV3 PASCAL VOC)
            → SkyReplacer (Canvas 2D : gradient ciel + tone mapping + edge blending)
                → <canvas> display
```

### Modules WawCore (`src/waw-core/`)
| Module | Fichier | Rôle |
|--------|---------|------|
| `WawEngine` | `WawEngine.ts` | Orchestrateur : caméra → segmentation → compositing → affichage. Gère modes + render loop |
| `SegmentationEngine` | `SegmentationEngine.ts` | Charge DeepLabV3, inférence TF.js → masque sémantique (Int32Array), heuristique ciel, temporal smoothing |
| `SkyReplacer` | `SkyReplacer.ts` | Remplacement pixels ciel via gradient procédural, tone mapping adaptatif, blending bords doux |

### Entry point
| Fichier | Rôle |
|---------|------|
| `src/main.ts` | Boot sequence : charge TF.js → charge modèle → init caméra → wire UI → start render loop |

### Modules futurs (V1+)
| Module | Rôle |
|--------|------|
| `SeasonTransformer` | Recoloration végétation + filter saisonnier (CSS/Canvas) |
| `AtmosphereEngine` | Particules (pluie, neige) via Canvas ou WebGL particles |
| `LightHarmonizer` | Color grading global adaptatif au nouveau ciel |
| `WebGLCompositor` | Migration du compositing Canvas 2D → WebGL shaders (perf) |

## Segmentation — Notes techniques
- DeepLabV3 PASCAL VOC produit 21 classes. **Pas de classe "sky" explicite**.
- Heiristique : classe 0 (background) dans les **65% supérieurs** de l'image → traité comme "ciel".
- Classe 0 dans les 35% inférieurs → traité comme "autre" (sol, route…).
- Classes préservées (premier plan) : 15 (person), 7 (car), 16 (plant/potted), 2 (bicycle), etc.
- **Temporal smoothing** : un pixel doit être stable pendant 2+ frames consécutives avant changement de classe.
- Résolution d'inférence : **513×513** (taille native DeepLabV3).

## Règles strictes

### Performance
1. **requestAnimationFrame** render loop — viser 30+ FPS sur mobile, 60 FPS desktop.
2. Inférence ML **asynchrone** (await sur TF.js) — ne bloque pas le render loop principal.
3. Canvas `willReadFrequently: true` pour optimiser les lectures imageData.
4. `processCanvas` dédié à 513×513 pour l'inférence (pas resizer le canvas principal).
5. Sky gradient lookup **pré-calculé** par type de ciel (pas de lerp par pixel par frame).

### Privacy & Sécurité
6. **100% offline** — zéro appel réseau après chargement initial du modèle, zéro upload, zéro analytics.
7. **Zéro stockage de frames** — les ImageData sont traités puis garbage-collectés.
8. **Pas de logs d'images** — aucun frame n'est écrit sur disque ou envoyé.
9. Permissions caméra demandées avec message clair dans l'UI.
10. Aucune permission inutile (pas de micro, pas de géoloc).

### Architecture code
11. **WawCore est indépendant de l'UI** — pas de DOM manipulation dans les engines.
12. Chaque engine est **instanciable isolément** (constructeur avec paramètres explicites).
13. **Nommage clair** : pas d'abréviations cryptiques, commentaires en anglais.
14. **Pas de singletons** — injection via constructeur.
15. **Types stricts** : pas de `any`, tout est typé.

## Phases de développement

| Phase | Objectif | Critère de validation |
|-------|----------|----------------------|
| **V0.1** | Segmentation debug : overlay masques colorés sur caméra live dans le navigateur | Masques stables, classes visibles, fonctionne sur mobile |
| **V0.2** | Sky replacement live + préservation humains | Ciel remplacé, personnes intactes, bords propres, 30 FPS |
| **V0.3** | Modes ciel multiples (clear, sunset, night) + sélecteur UI | Transition smooth entre modes |
| **V0.4** | PWA installable + HTTPS local (mkcert) | App installable sur iPhone home screen |
| **V1.0** | WebGL compositor (migration perf depuis Canvas 2D) | 60 FPS stable desktop, 30+ FPS mobile |
| **V1.0** | Végétation stylisée (shader saisonnier, pas géométrie) | Arbres recolorés de façon crédible |
| **V2.0** | Relighting adaptatif (ombres cohérentes) | Ombres ajustées au nouveau ciel |
| **V3.0** | Port lunettes AR (si hardware disponible) | Même pipeline, latence <20ms |

## Ressources nécessaires
- **DeepLabV3 (TF.js)** : Auto-téléchargé par `@tensorflow-models/deeplab` (~8MB, cached par le navigateur)
- **Node.js** : 18+ (LTS recommandé)
- **Navigateur test** : Chrome 90+, Safari 15+, Firefox 90+ (avec accès caméra)
- **Test mobile** : Ouvrir `https://<ip-locale>:3000` en Safari/Chrome (HTTPS requis pour caméra)
- **Dev machine** : Windows 10/11 avec VS Code

## Menaces de sécurité identifiées (threat model V0)
| Menace | Mitigation |
|--------|-----------|
| Fuite flux caméra | 100% on-device, aucun réseau |
| Stockage involontaire de frames | Buffers libérés après chaque cycle draw |
| Supply-chain attack (npm deps) | Minimum de dépendances, audit npm régulier, lockfile |
| Risque sécurité physique (perception altérée) | Humains/véhicules toujours préservés, mode passthrough disponible |

---
*Ce fichier est la source de vérité pour tout agent IA travaillant sur ce projet.*
*Dernière mise à jour : Mars 2026*
