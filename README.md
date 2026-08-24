# Nuvio Calendar Archives v1.4.0 — NVIDIA Shield / Modern

Cette version adopte la structure native Nuvio demandée : **plateforme → Séries / Films → mois + année → contenus**.

## Arborescence finale

```text
Netflix
├── Séries
│   ├── Août 2026
│   ├── Juillet 2026
│   ├── Juin 2026
│   ├── ...
│   ├── Janvier 2026
│   ├── Décembre 2025
│   └── ... → Janvier 2025
└── Films
    └── mêmes mois en décroissant

Prime Video
├── Séries
└── Films

Disney+
├── Séries
└── Films

Max
├── Séries
└── Films

Apple TV+
├── Séries
└── Films

Paramount+
├── Séries
└── Films

Peacock
├── Séries
└── Films

Hulu
├── Séries
└── Films

Crunchyroll
└── Séries

VOD
└── Films
```

## Mois automatiques

En août 2026, les premières lignes visibles sont `Août 2026`, `Juillet 2026`, etc. Les lignes de septembre à décembre 2026 existent déjà mais leur catalogue est vide, donc Nuvio Modern les masque.

Le 1er septembre 2026, `Septembre 2026` commence automatiquement à retourner ses contenus et apparaît au-dessus d'août. **Aucune réimportation mensuelle n'est nécessaire.**

La prochaine année est également pré-câblée pour permettre le passage 2026 → 2027 sans réimport immédiat. Les lignes qui sortent de la fenêtre glissante de deux années deviennent vides automatiquement.

## Visuels Modern et logos réels

Chaque parent est une vraie Collection Nuvio portant le nom de la plateforme. Les cartes `Séries` et `Films` sont en **LANDSCAPE 16:9**, avec un habillage Modern sombre/premium.

Le serveur récupère le **vrai logo de la plateforme via l'annuaire TMDb Watch Providers**, puis l'intègre dans les cartes et le backdrop. Si TMDb est temporairement indisponible, un visuel de secours reste affichable.

Routes visuelles :

- `/platform-category-card.svg?provider=netflix&category=series`
- `/platform-category-card.svg?provider=netflix&category=films`
- `/platform-backdrop.svg?provider=netflix&type=movie`
- `/platform-logo?provider=netflix&type=movie`

Pour obtenir les vrais visuels sur la Shield, il faut importer **le JSON depuis le déploiement** :

```text
https://TON-DEPLOIEMENT/nuvio-collections.json
```

Le fichier `nuvio-collections.json` inclus dans le ZIP sert aussi d'inspection/import de secours, mais sans URL de déploiement il ne peut pas contenir les covers hébergées.

## Mise à jour depuis v1.3.0

Après avoir déployé v1.4.0 :

1. Mets à jour l'addon avec le `manifest.json` du nouveau déploiement.
2. Réimporte **une seule fois** `/nuvio-collections.json` pour installer la nouvelle architecture.
3. Ensuite, les nouveaux mois apparaissent automatiquement sans réimportation mensuelle.

Les deux anciens IDs de Collections sont réutilisés :

- `calendar-archives` devient **Netflix**
- `calendar-archives-films` devient **Prime Video**

Cela remplace proprement les deux parents v1.3 au lieu de laisser les anciennes lignes `Séries` / `Films` en doublon.

## Configuration TMDb

Le contenu et les logos réels utilisent TMDb. Configure soit :

```text
TMDB_READ_TOKEN=...
```

ou :

```text
TMDB_API_KEY=...
```

Tu peux lancer :

```bash
npm run configure
```

## Tests

```bash
npm test
```

La v1.4.0 contient des tests dédiés à la hiérarchie plateforme, aux cartes Modern, aux vrais logos TMDb, au VOD Films, au mois automatique de septembre, aux mois futurs sans appels réseau et au roulement des deux années.
