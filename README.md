# Nuvio Calendar Archives v1.1.0 — Modern Shield

Projet **séparé** du calendrier principal. Il ne remplace pas Nuvio Calendar Ultimate.

## Ce que change la v1.1

La navigation repose maintenant sur les **Collections/Folders natifs de Nuvio** :

- Collection `🗄️ Calendar Archives`
- cartes année `2026`, `2025`, etc. en `LANDSCAPE`
- clic sur une année → écran natif **FolderDetail** de Nuvio
- exactement **12 lignes mensuelles** par année : Janvier → Décembre
- exactement **1 catalogue combiné par mois** au lieu de 4 catalogues séparés
- chaque mois combine : 📺 Séries Streaming + 🎬 Films/VOD US + 🎌 Anime/Crunchyroll + 🇺🇸 TV USA
- mois futurs déjà câblés mais renvoyant immédiatement `metas: []` avec **0 appel upstream**

Au 24 août 2026, Janvier→Août 2026 sont actifs, Septembre→Décembre 2026 sont vides, et 2025 est complet. Les mêmes IDs mensuels deviennent actifs automatiquement quand leur mois arrive.

## Pourquoi le catalogue mensuel est déclaré `series`

Une source de Collection Nuvio doit pointer vers un type de catalogue addon précis. La v1.1 utilise `series` uniquement comme **type de transport** du catalogue mensuel. Les cartes retournées gardent chacune leur vrai champ `type` (`movie` ou `series`), que Nuvio utilise pour ouvrir correctement les fiches détail.

Exemples d’IDs :

- `archives-v1-month-2026-01`
- `archives-v1-month-2026-12`
- `archives-v1-month-2025-01`
- `archives-v1-month-2025-12`

## Modern View NVIDIA Shield

Même rendu validé que le Calendar principal : `posterShape=landscape`, carte Calendar 16:9 dans `background`, `landscapePoster` 16:9, logo transparent, artwork plein cadre, overlay bleu XXL, titre/date/heure/plateforme. `/meta` restaure le vrai backdrop sur la fiche détail.

La Collection utilise `viewMode: FOLLOW_LAYOUT`, donc **FolderDetail suit le layout Modern de la Shield**.

Les cartes année utilisent `/archive-year-card.svg?year=2026` et `/archive-year-card.svg?year=2025` lorsque le JSON est récupéré depuis le serveur déployé.

## Import Nuvio Collections

Le serveur expose un payload directement importable :

```text
/nuvio-collections.json
```

Le format racine est bien un **tableau JSON de Collections**, conforme à l’import Nuvio. Chaque Folder année contient à la fois :

- `sources` — schéma Nuvio actuel ;
- `catalogSources` — compatibilité avec les builds Nuvio plus anciens.

Le fichier local `docs/nuvio-collections-2026-2025.json` contient le même import sans URL de cover dépendante du déploiement.

`/archive-blueprint.json` reste disponible pour inspection et contient aussi `importPayload`.

> Important : installer d’abord l’addon `com.nuvio.calendar.archives`, puis importer la Collection. Les sources de Collection résolvent l’addon par son ID.

## Déploiement Vercel

Variables :

- `TMDB_READ_TOKEN` recommandé, ou `TMDB_API_KEY`
- optionnels : `TMDB_LANGUAGE=en-US`, `PAGE_SIZE=60`, `MAX_ITEMS=240`, `MAX_CANDIDATES=120`

Aucun secret n’est inclus.

Manifest ID : `com.nuvio.calendar.archives`

## Tests

```bash
npm test
```

La suite v1.1 valide notamment : 24 catalogues mensuels pour 2026/2025, 12 sources par Folder année, payload d’import Nuvio en tableau, catalogue mensuel mixte, rendu Modern Shield et zéro appel réseau pour les mois futurs.
