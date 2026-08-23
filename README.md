# Nuvio USA Releases Catalog v1.0.0

Add-on NuvioTV **catalog-first** indépendant.

Ce projet est séparé de :
- `Nuvio Calendar` (`com.nuvio.calendar`)
- l'ancien projet `Nuvio USA Releases`

Son ID est :

```text
com.nuvio.usareleases.catalog
```

## Objectif

Afficher les sorties USA directement sous forme de **catalogues natifs Nuvio Home / See All**, tout en gardant le moteur dynamique du projet Calendar :

- marché streaming toujours `US`
- fuseau du spectateur via `x-vercel-ip-timezone`
- films avec date Digital US fiable + provider flatrate US
- séries streaming basées sur l'événement épisode / web schedule, pas sur `first_air_date`
- TV USA avec vrai timestamp TVmaze `airstamp` converti dans le fuseau du spectateur
- anime via AniList `AiringSchedule.airingAt`, converti localement
- badges distinctifs par plateforme/source
- déduplication des mêmes événements multi-plateformes
- cache par date locale / timezone / type / période

## Catalogues Home

Le manifest expose exactement 10 catalogues natifs :

```text
Aujourd’hui • Films
Aujourd’hui • Séries
Demain • Films
Demain • Séries
7 prochains jours • Films
7 prochains jours • Séries
7 derniers jours • Films
7 derniers jours • Séries
Ce mois • Films
Ce mois • Séries
```

Tous ont `showInHome: true`.

Les périodes historiques sont strictes :

- `7 derniers jours` = J-7 jusqu'à hier, jamais aujourd'hui
- `Ce mois` = 1er du mois jusqu'à hier, jamais aujourd'hui

## Badges

Dans les catalogues globaux, les cartes peuvent afficher :

- Netflix
- Prime Video
- Disney+
- Max
- Apple TV+
- Hulu
- Paramount+
- Peacock
- Crunchyroll
- TV USA
- Anime

Si un même événement exact existe sur plusieurs plateformes, une seule carte est conservée avec plusieurs badges.

Les cartes sont générées via `/release-card.svg` afin de garder le rendu dans les posters natifs Nuvio sans modifier l'APK.

## Déploiement Vercel

Crée un **nouveau projet Vercel** pour ne pas écraser Calendar ni l'ancien USA Releases.

À la racine du projet :

```text
api/
  index.js
src/
  calendar.js
  env.js
test/
scripts/
package.json
vercel.json
README.md
```

Ajoute au minimum dans Vercel :

```text
TMDB_READ_TOKEN=...
```

Optionnel :

```text
DEBUG=false
CALENDAR_CARDS=true
MAX_CANDIDATES=80
MAX_ITEMS=100
TMDB_LANGUAGE=fr-FR
```

Ne mets jamais le token directement dans le code ou dans le ZIP.

## Installation Nuvio

Après déploiement :

```text
https://TON-PROJET.vercel.app/manifest.json
```

Ajoute cette URL dans NuvioTV.

## Endpoints utiles

```text
/manifest.json
/health
/catalog/movie/usa-releases-today-movie.json
/catalog/series/usa-releases-today-series.json
/catalog/movie/usa-releases-tomorrow-movie.json
/catalog/series/usa-releases-week-series.json
/catalog/movie/usa-releases-past7-movie.json
/catalog/series/usa-releases-month-series.json
/meta/movie/<id>.json
/meta/series/<id>.json
/release-card.svg
```

## Sources

- TMDb / JustWatch data : métadonnées, IDs et providers US
- TVmaze : broadcast USA et web schedules
- AniList : airing original anime

Une date streaming sans heure officielle reste une date civile ; elle n'est jamais convertie comme un faux minuit. Une heure AniList est présentée comme airing original anime, pas comme heure Crunchyroll/Netflix sans confirmation séparée.

This product uses the TMDB API but is not endorsed or certified by TMDB.

## Tests

```bash
npm test
```

Validation v1.0.0 : **64/64 tests pass**.
