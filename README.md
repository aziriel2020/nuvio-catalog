# Nuvio Calendar Archives v1.0.0 — Modern Shield

Projet **séparé** du calendrier principal. Il ne remplace pas Nuvio Calendar Ultimate.

## Structure

Archives par **année → mois** de l’année courante jusqu’à **2025**, avec quatre sources strictement séparées :

- 📺 Séries Streaming
- 🎬 Films + VOD US
- 🎌 Anime + Crunchyroll
- 🇺🇸 TV USA

Chaque année pré-déclare **Janvier → Décembre**. Les mois futurs renvoient immédiatement `metas: []` et ne déclenchent aucun appel upstream. Le mois courant s’arrête à la date locale du spectateur ; les mois passés sont complets.

Au 24 août 2026, 2026 a Jan→Août actifs et Sep→Déc vides ; 2025 est complet. Quand septembre arrive, les mêmes IDs septembre deviennent actifs automatiquement.

## Modern View NVIDIA Shield

Même parade que le Calendar principal validé : `posterShape=landscape`, carte Calendar 16:9 dans `background`, `landscapePoster` 16:9, logo transparent, artwork cover centré plein cadre, overlay bleu semi-transparent, titre/date/heure/plateforme XXL. `/meta` restaure le vrai backdrop sur la fiche détail.

Pour une Nuvio Collection, utiliser **FOLLOW_LAYOUT** afin que le Folder suive le layout Modern de la Shield.

## Blueprint Collection

Le serveur expose `/archive-blueprint.json` avec une Collection `Calendar Archives`, un Folder par année et toutes les sources Jan→Déc.

Nuvio Collections/Folders est une donnée locale/synchronisée de l’application : un addon standard ne peut pas injecter lui-même les folders. Le blueprint évite de rechercher les IDs. Une fois Jan→Déc câblé pour une année, les mois s’auto-alimentent.

## Déploiement Vercel

Variables : `TMDB_READ_TOKEN` recommandé (ou `TMDB_API_KEY`). Optionnels : `TMDB_LANGUAGE=en-US`, `PAGE_SIZE=60`, `MAX_ITEMS=240`, `MAX_CANDIDATES=120`.

Aucun secret n’est inclus.

Manifest ID : `com.nuvio.calendar.archives`

Exemples d’IDs : `archives-v1-series-2025-01`, `archives-v1-films-2025-01`, `archives-v1-anime-2025-01`, `archives-v1-tvusa-2025-01`.
