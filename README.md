# Nuvio Calendar Archives v1.2.0 — Modern Shield

Projet séparé du calendrier principal, pensé pour **Nuvio TV en layout Modern sur NVIDIA Shield**.

## Structure v1.2.0

L’accueil Modern reçoit maintenant **deux Collections parentes épinglées** :

- `📺 Séries`
- `🎬 Films`

Chacune contient les dossiers année :

- `2026`
- `2025`

Le clic sur une année ouvre le **FolderDetail natif Nuvio** en `FOLLOW_LAYOUT`.

Dans chaque année, les mois et les services sont **séparés en vraies lignes Modern**. Exemple pour Séries 2026 :

```text
Janvier 2026 — Netflix
Janvier 2026 — Prime Video
Janvier 2026 — Disney+
Janvier 2026 — Max
Janvier 2026 — Apple TV+
...
Février 2026 — Netflix
Février 2026 — Prime Video
...
Décembre 2026 — Crunchyroll
```

### Services Séries

Netflix, Prime Video, Disney+, Max, Apple TV+, Hulu, Paramount+, Peacock, Crunchyroll.

### Services Films

Netflix, Prime Video, Disney+, Max, Apple TV+, Hulu, Paramount+, Peacock.

Les catalogues addon restent tous `showInHome: false` : **seules les deux Collections parentes apparaissent sur l’accueil**.

## Migration depuis v1.1.1

La Collection Séries réutilise volontairement l’ID historique `calendar-archives`. En réimportant le nouveau JSON, Nuvio **remplace donc l’ancienne ligne `🗄️ Calendar Archives` par `📺 Séries`** au lieu de laisser un doublon.

La nouvelle Collection Films utilise `calendar-archives-films`.

## Pourquoi chaque service a son propre catalogue

Dans FolderDetail `FOLLOW_LAYOUT`, Nuvio Modern utilise le **nom du catalogue du manifest** comme titre de ligne. Pour obtenir réellement :

```text
Janvier 2026 — Netflix
Janvier 2026 — Prime Video
```

et non plusieurs lignes toutes nommées seulement `Janvier 2026`, chaque combinaison **type + mois + service** possède donc un ID catalogue propre.

Pour 2026 + 2025, cela donne 408 catalogues cachés au manifest :

- Séries : `12 mois × 9 services × 2 années = 216`
- Films : `12 mois × 8 services × 2 années = 192`

Ils ne polluent pas l’accueil car `showInHome=false`.

## Mois futurs = zéro appel réseau

Les lignes futures sont déjà présentes pour garder Janvier → Décembre stable toute l’année, mais la route catalogue répond immédiatement :

```json
{"metas":[]}
```

avant toute résolution provider/TMDb. Exemple au 24 août 2026 : Septembre → Décembre 2026 sont visibles mais vides et ne déclenchent aucun appel upstream.

## Modern Shield

Les Collections sont `pinToTop: true`, les cartes année sont `LANDSCAPE`, et les contenus utilisent le rendu Calendar 16:9 / Blue Overlay XXL déjà présent dans le projet.

Les cartes année dynamiques sont servies par :

```text
/archive-year-card.svg?year=2026&category=series
/archive-year-card.svg?year=2026&category=films
```

## Import Nuvio

Le serveur déployé expose :

```text
/nuvio-collections.json
```

C’est le meilleur import car les URLs des cartes année utilisent automatiquement le domaine du déploiement.

Le ZIP contient aussi un fichier local :

```text
nuvio-collections.json
```

Il est directement compatible avec le nom de fichier recherché par Nuvio dans Downloads, mais ses covers année sont nulles tant qu’aucun domaine de déploiement n’est connu.

Ordre recommandé :

1. déployer / mettre à jour l’addon `com.nuvio.calendar.archives` ;
2. mettre à jour l’addon dans Nuvio avec son `manifest.json` ;
3. réimporter `/nuvio-collections.json` ou le fichier local `nuvio-collections.json`.

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

La suite v1.2.0 valide la hiérarchie Séries/Films → 2026/2025 → mois/service, les 408 catalogues provider-specific, l’upgrade sans doublon de l’ancienne Collection, le rendu Modern et le zéro appel upstream pour les mois futurs.
