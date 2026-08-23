'use strict';

const {
  DEFAULT_TIMEZONE,
  DEFAULT_COUNTRY,
  DEFAULT_LANGUAGE,
  EVENT_MODES,
  isValidTimeZone,
  addIsoDays,
  localIsoDate,
  localTime,
  dateWindow,
  normalizeIsoDate,
  humanDate,
  humanCalendarDate,
  viewerDateTimeFromInstant,
  viewerWindowEpochBounds,
  buildInstantEvent,
  parseTmdbFallbackId,
  hasProviderInFlatrate,
  movieDetailsToMeta,
  seriesDetailsToMeta,
  baseMeta,
  cleanCatalogMeta,
  sortAndDedupeMetas,
  catalogCacheKey,
  episodeCode,
  stripHtml,
  normalizeTitle
} = require('../src/calendar');

const VERSION = '1.0.0';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TVMAZE_BASE = 'https://api.tvmaze.com';
const ANILIST_URL = 'https://graphql.anilist.co';
const DEFAULT_MAX_CANDIDATES = 80;
const DEFAULT_MAX_ITEMS = 100;
const ENRICH_CONCURRENCY = 8;
const CATALOG_TTL_MS = 15 * 60 * 1000;
const DETAILS_TTL_MS = 15 * 60 * 1000;
const PROVIDERS_TTL_MS = 6 * 60 * 60 * 1000;
const TVMAZE_SCHEDULE_TTL_MS = 10 * 60 * 1000;
const ANILIST_SCHEDULE_TTL_MS = 10 * 60 * 1000;
const MAPPING_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SOURCE_VERSION = 'usa-releases-catalog-v1';

const PROVIDERS = [
  { slug: 'netflix', label: 'Netflix', aliases: ['Netflix', 'Netflix Standard with Ads'] },
  { slug: 'prime-video', label: 'Prime Video', aliases: ['Amazon Prime Video', 'Prime Video', 'Amazon Prime Video with Ads'] },
  { slug: 'disney-plus', label: 'Disney+', aliases: ['Disney Plus', 'Disney+'] },
  { slug: 'max', label: 'Max', aliases: ['Max', 'HBO Max'] },
  { slug: 'apple-tv-plus', label: 'Apple TV+', aliases: ['Apple TV Plus', 'Apple TV+'] },
  { slug: 'hulu', label: 'Hulu', aliases: ['Hulu'] },
  { slug: 'paramount-plus', label: 'Paramount+', aliases: ['Paramount Plus', 'Paramount+'] },
  { slug: 'peacock', label: 'Peacock', aliases: ['Peacock Premium', 'Peacock Premium Plus', 'Peacock'] },
  { slug: 'crunchyroll', label: 'Crunchyroll', aliases: ['Crunchyroll'] }
];

const PROVIDER_BY_SLUG = new Map(PROVIDERS.map((provider) => [provider.slug, provider]));

// Nuvio Discover exposes three native selectors: Type, Catalog and Genre.
// We intentionally use the standard `genre` extra as a period selector so the
// addon works in stock NuvioTV without requiring an APK fork. No genre value
// means "Aujourd’hui"; this also makes Nuvio's built-in "Tous les genres"
// fallback behave as the default day instead of returning unrelated content.
const PERIOD_OPTIONS = Object.freeze([
  { label: 'Ce mois', value: 'month' },
  { label: '7 derniers jours', value: 'past7' },
  { label: 'Aujourd’hui', value: 'today' },
  { label: 'Demain', value: 'tomorrow' },
  { label: '7 prochains jours', value: 'week' }
]);
const PERIOD_LABELS = new Map(PERIOD_OPTIONS.map((entry) => [entry.value, entry.label]));

function normalizePeriodLabel(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’`]/g, "'")
    .trim()
    .toLowerCase();
}

function periodFromExtra(value, fallback = 'today') {
  const normalized = normalizePeriodLabel(value);
  if (!normalized) return fallback;
  if (['month', 'ce mois', 'mois en cours', "ce mois jusqu'a hier", 'month to date', 'month-to-date'].includes(normalized)) return 'month';
  if (['past7', 'last 7 days', '7 derniers jours', 'derniers 7 jours', '7 jours precedents'].includes(normalized)) return 'past7';
  if (['today', "aujourd'hui", 'aujourdhui'].includes(normalized)) return 'today';
  if (['tomorrow', 'demain'].includes(normalized)) return 'tomorrow';
  if (['week', '7 days', '7 jours', '7 prochains jours', 'cette semaine'].includes(normalized)) return 'week';
  if (['upcoming', 'a venir', 'a venir (j+1 -> j+6)'].includes(normalized)) return 'upcoming';
  return fallback;
}

function parseCatalogExtraSegment(segment = '') {
  if (!segment) return {};
  const output = {};
  for (const part of String(segment).split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq >= 0 ? part.slice(0, eq) : part;
    const rawValue = eq >= 0 ? part.slice(eq + 1) : '';
    let key = rawKey;
    let value = rawValue;
    try { key = decodeURIComponent(rawKey); } catch {}
    try { value = decodeURIComponent(rawValue); } catch {}
    if (key) output[key] = value;
  }
  return output;
}

const CATALOGS = {
  'calendar-global-movie': {
    type: 'movie', name: 'Global • Calendar', providerSlug: 'global', period: 'today',
    source: 'global', explore: true
  },
  'calendar-global-series': {
    type: 'series', name: 'Global • Calendar', providerSlug: 'global', period: 'today',
    source: 'global', explore: true
  }
};
const EXPLORE_CATALOG_IDS = ['calendar-global-movie', 'calendar-global-series'];
for (const provider of PROVIDERS) {
  const movieId = `calendar-${provider.slug}-movie`;
  const seriesId = `calendar-${provider.slug}-series`;
  CATALOGS[movieId] = {
    type: 'movie',
    name: `${provider.label} • Calendar`,
    providerSlug: provider.slug,
    period: 'today',
    source: 'tmdb-streaming',
    explore: true
  };
  CATALOGS[seriesId] = {
    type: 'series',
    name: `${provider.label} • Calendar`,
    providerSlug: provider.slug,
    period: 'today',
    source: 'tmdb-streaming',
    explore: true
  };
  EXPLORE_CATALOG_IDS.push(movieId, seriesId);

}
Object.assign(CATALOGS, {
  'calendar-tv-usa-series': {
    type: 'series', name: 'TV USA • Calendar', providerSlug: 'tv-usa', period: 'today',
    source: 'tvmaze-broadcast', explore: true
  },
  'calendar-anime-series': {
    type: 'series', name: 'Anime • Calendar', providerSlug: 'anime', period: 'today',
    source: 'anilist-airing', explore: true
  }
});
EXPLORE_CATALOG_IDS.push('calendar-tv-usa-series', 'calendar-anime-series');


// Catalog-first presentation. These fixed-period global catalogs are the only
// catalogs exposed by this add-on's manifest. They turn the same dynamic
// Calendar engine into native Nuvio Home/See-All rows without requiring an APK
// modification. Provider/source identity is rendered on every release card.
const HOME_PERIODS = Object.freeze([
  { slug: 'today', period: 'today', label: 'Aujourd’hui' },
  { slug: 'tomorrow', period: 'tomorrow', label: 'Demain' },
  { slug: 'week', period: 'week', label: '7 prochains jours' },
  { slug: 'past7', period: 'past7', label: '7 derniers jours' },
  { slug: 'month', period: 'month', label: 'Ce mois' }
]);
const HOME_CATALOG_IDS = [];
for (const entry of HOME_PERIODS) {
  for (const type of ['movie', 'series']) {
    const id = `usa-releases-${entry.slug}-${type}`;
    CATALOGS[id] = {
      type,
      name: `${entry.label} • ${type === 'movie' ? 'Films' : 'Séries'}`,
      providerSlug: 'global',
      period: entry.period,
      source: 'global',
      explore: false,
      home: true
    };
    HOME_CATALOG_IDS.push(id);
  }
}

class MemoryCache {
  constructor() {
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  clear() {
    this.map.clear();
  }
}

const catalogCache = new MemoryCache();
const detailsCache = new MemoryCache();
const providerCache = new MemoryCache();
const tvmazeCache = new MemoryCache();
const anilistCache = new MemoryCache();
const mappingCache = new MemoryCache();

function json(res, status, body, cache = 'private, max-age=60') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(body));
}

function html(res, body) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(body);
}

function svg(res, body) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  res.end(body);
}

function requestOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}


const ALLOWED_POSTER_HOSTS = new Set([
  'image.tmdb.org',
  'static.tvmaze.com',
  's1.anilist.co',
  's2.anilist.co',
  's3.anilist.co',
  's4.anilist.co',
  'img.anili.st'
]);

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function compactCardText(value, max = 42) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function cardLines(value, maxPerLine = 24, maxLines = 2) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxPerLine || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  const consumed = lines.join(' ').split(/\s+/).filter(Boolean).length;
  if (consumed < words.length && lines.length) {
    lines[lines.length - 1] = compactCardText(lines[lines.length - 1], maxPerLine);
  }
  return lines.slice(0, maxLines);
}

function isAllowedPosterSource(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && ALLOWED_POSTER_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function catalogBadgeLabels(catalog) {
  if (!catalog) return ['USA'];
  if (catalog.providerSlug === 'tv-usa') return ['TV USA'];
  if (catalog.providerSlug === 'anime') return ['Anime'];
  const provider = PROVIDER_BY_SLUG.get(catalog.providerSlug);
  if (provider) return [provider.label];
  const fromName = String(catalog.name || '').replace(/\s*•\s*Calendar\s*$/i, '').trim();
  return fromName ? [fromName] : ['USA'];
}

function calendarCardUrl(origin, meta, catalog, timeZone) {
  if (!getConfig().calendarCards || !meta?.poster || !isAllowedPosterSource(meta.poster)) return meta?.poster || null;
  const badges = Array.isArray(meta.calendarProviders) && meta.calendarProviders.length ? meta.calendarProviders : catalogBadgeLabels(catalog);
  const url = new URL('/release-card.svg', origin);
  url.searchParams.set('src', meta.poster);
  url.searchParams.set('title', compactCardText(meta.name, 56));
  url.searchParams.set('provider', compactCardText(badges[0] || 'USA', 24));
  url.searchParams.set('badges', badges.join('|'));
  url.searchParams.set('info', compactCardText(meta.releaseInfo || '', 64));
  url.searchParams.set('tz', timeZone || DEFAULT_TIMEZONE);
  url.searchParams.set('type', meta.type || catalog?.type || '');
  return url.toString();
}

function decorateCatalogMetas(origin, metas, catalog, timeZone) {
  return (metas || []).map((meta) => {
    const poster = getConfig().calendarCards ? (calendarCardUrl(origin, meta, catalog, timeZone) || meta.poster) : meta.poster;
    const clean = { ...meta, poster };
    delete clean.calendarProviders;
    return clean;
  });
}

function badgePalette(label) {
  const key = normalizeProviderName(label);
  if (key.includes('netflix')) return ['#e50914', '#ffffff', '#ff6b72'];
  if (key.includes('prime')) return ['#00a8e1', '#001018', '#8be1ff'];
  if (key.includes('disney')) return ['#1736c7', '#ffffff', '#7e9cff'];
  if (key === 'max' || key.includes('hbo max')) return ['#6f2cff', '#ffffff', '#b99cff'];
  if (key.includes('apple')) return ['#111827', '#ffffff', '#d1d5db'];
  if (key.includes('hulu')) return ['#1ce783', '#062b1a', '#9fffc5'];
  if (key.includes('paramount')) return ['#0064ff', '#ffffff', '#7eb4ff'];
  if (key.includes('peacock')) return ['#f7c600', '#181000', '#fff08a'];
  if (key.includes('crunchyroll')) return ['#f47521', '#ffffff', '#ffb27d'];
  if (key.includes('tv usa')) return ['#ef4444', '#ffffff', '#fca5a5'];
  if (key.includes('anime')) return ['#ec4899', '#ffffff', '#f9a8d4'];
  return ['#334155', '#ffffff', '#94a3b8'];
}

function calendarCardSvg({ imageDataUri = null, title = '', provider = '', badges = [], info = '', type = '' }) {
  const lines = cardLines(title, 23, 2);
  const titleSpans = lines.map((line, index) => `<tspan x="64" dy="${index === 0 ? 0 : 58}">${escapeXml(line)}</tspan>`).join('');
  const badgeList = [...new Set((Array.isArray(badges) ? badges : String(badges || '').split('|')).map((x) => compactCardText(x, 18)).filter(Boolean))];
  if (!badgeList.length && provider) badgeList.push(compactCardText(provider, 18));
  const visible = badgeList.slice(0, 3);
  if (badgeList.length > 3) visible.push(`+${badgeList.length - 3}`);
  const badgeNodes = visible.map((label, index) => {
    const [fill, text, stroke] = badgePalette(label);
    const width = Math.max(190, Math.min(430, 105 + label.length * 20));
    const y = 54 + index * 88;
    return `<rect x="54" y="${y}" rx="30" width="${width}" height="70" fill="${fill}" fill-opacity=".95" stroke="${stroke}" stroke-width="3"/><text x="84" y="${y + 47}" fill="${text}" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="800">${escapeXml(label)}</text>`;
  }).join('');
  const infoText = escapeXml(compactCardText(info, 52));
  const typeText = type === 'movie' ? 'FILM' : type === 'series' ? 'SÉRIE' : '';
  const imageNode = imageDataUri ? `<image width="1000" height="1500" href="${escapeXml(imageDataUri)}" preserveAspectRatio="xMidYMid slice"/>` : `<rect width="1000" height="1500" fill="#111827"/><circle cx="760" cy="220" r="330" fill="#7c3aed" opacity=".22"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500" viewBox="0 0 1000 1500"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020617" stop-opacity=".08"/><stop offset=".55" stop-color="#020617" stop-opacity=".08"/><stop offset="1" stop-color="#020617" stop-opacity=".96"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000" flood-opacity=".55"/></filter></defs>${imageNode}<rect width="1000" height="1500" fill="url(#shade)"/><g filter="url(#shadow)">${badgeNodes}${typeText ? `<rect x="790" y="54" rx="30" width="156" height="70" fill="#7c3aed" fill-opacity=".92"/><text x="868" y="101" text-anchor="middle" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="800">${typeText}</text>` : ''}<text x="64" y="1260" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="800">${titleSpans}</text><rect x="54" y="1372" rx="30" width="892" height="82" fill="#7c3aed" fill-opacity=".94"/><text x="500" y="1425" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700">${infoText || 'Calendrier USA'}</text></g></svg>`;
}

async function handleCalendarCard(res, url) {
  const src = url.searchParams.get('src') || '';
  const title = url.searchParams.get('title') || '';
  const provider = url.searchParams.get('provider') || '';
  const badges = (url.searchParams.get('badges') || '').split('|').filter(Boolean);
  const info = url.searchParams.get('info') || '';
  const type = url.searchParams.get('type') || '';
  if (!isAllowedPosterSource(src)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    return res.end(calendarCardSvg({ title, provider, badges, info, type }));
  }

  let imageDataUri = null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(src, {
      signal: controller.signal,
      headers: { Accept: 'image/avif,image/webp,image/jpeg,image/png,*/*', 'User-Agent': `NuvioUSAReleasesCatalog/${VERSION}` }
    });
    if (response.ok) {
      const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
      if (/^image\/(jpeg|jpg|png|webp|avif)$/.test(contentType)) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length <= 5 * 1024 * 1024) imageDataUri = `data:${contentType};base64,${bytes.toString('base64')}`;
      }
    }
  } catch {
    imageDataUri = null;
  } finally {
    clearTimeout(timeout);
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
  return res.end(calendarCardSvg({ imageDataUri, title, provider, badges, info, type }));
}

function requestTimeZone(req) {
  const fromVercel = req?.headers?.['x-vercel-ip-timezone'];
  return isValidTimeZone(fromVercel) ? fromVercel : DEFAULT_TIMEZONE;
}

function getConfig() {
  return {
    language: process.env.TMDB_LANGUAGE || DEFAULT_LANGUAGE,
    maxCandidates: Math.max(10, Math.min(200, Number(process.env.MAX_CANDIDATES || DEFAULT_MAX_CANDIDATES))),
    maxItems: Math.max(1, Math.min(100, Number(process.env.MAX_ITEMS || DEFAULT_MAX_ITEMS))),
    token: process.env.TMDB_READ_TOKEN || null,
    apiKey: process.env.TMDB_API_KEY || null,
    debug: /^(1|true|yes|on)$/i.test(process.env.DEBUG || ''),
    tmdbTimeoutMs: Math.max(1000, Math.min(20000, Number(process.env.TMDB_TIMEOUT_MS || 8000))),
    sourceTimeoutMs: Math.max(1000, Math.min(20000, Number(process.env.SOURCE_TIMEOUT_MS || 8000))),
    retryBaseMs: Math.max(1, Math.min(5000, Number(process.env.RETRY_BASE_MS || process.env.TMDB_RETRY_BASE_MS || 250))),
    calendarCards: !/^(0|false|no|off)$/i.test(process.env.RELEASE_CARDS || process.env.CALENDAR_CARDS || 'true')
  };
}

function requireTmdbConfig() {
  const config = getConfig();
  if (!config.token && !config.apiKey) {
    const err = new Error('TMDB_READ_TOKEN or TMDB_API_KEY is required');
    err.code = 'TMDB_CONFIG_MISSING';
    throw err;
  }
  return config;
}

function buildManifest(origin) {
  const catalogs = HOME_CATALOG_IDS.map((id) => {
    const catalog = CATALOGS[id];
    return {
      type: catalog.type,
      id,
      name: catalog.name,
      pageSize: getConfig().maxItems,
      showInHome: true
    };
  });

  return {
    id: 'com.nuvio.usareleases.catalog',
    version: VERSION,
    name: 'Nuvio USA Releases Catalog',
    description: 'Catalogues natifs Nuvio des sorties USA : vue globale multi-plateformes, TV USA et anime, avec badges source et périodes fixes.',
    logo: `${origin}/logo.svg`,
    background: `${origin}/background.svg`,
    resources: [
      { name: 'catalog', types: ['movie', 'series'] },
      { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:movie:', 'tmdb:tv:'] }
    ],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb:movie:', 'tmdb:tv:'],
    catalogs,
    behaviorHints: { configurable: false, configurationRequired: false, newEpisodeNotifications: false },
    language: 'fr'
  };
}

class SourceHttpError extends Error {
  constructor(source, status, path, statusMessage = null) {
    super(`${source} ${status} on ${path}${statusMessage ? `: ${statusMessage}` : ''}`);
    this.name = 'SourceHttpError';
    this.code = `${source.toUpperCase()}_HTTP_ERROR`;
    this.source = source;
    this.status = status;
    this.path = path;
    this.statusMessage = statusMessage;
  }
}

class TmdbHttpError extends SourceHttpError {
  constructor(status, path, statusMessage = null) {
    super('tmdb', status, path, statusMessage);
    this.name = 'TmdbHttpError';
    this.code = 'TMDB_HTTP_ERROR';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableStatus(status) {
  return status === 429 || [500, 502, 503, 504].includes(status);
}

async function tmdbFetch(path, params = {}) {
  const config = requireTmdbConfig();
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const url = new URL(`${TMDB_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    if (!config.token && config.apiKey) url.searchParams.set('api_key', config.apiKey);

    const headers = { Accept: 'application/json', 'User-Agent': `NuvioUSAReleasesCatalog/${VERSION}` };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.tmdbTimeoutMs);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.ok) return await response.json();

      let statusMessage = null;
      try {
        const payload = await response.json();
        statusMessage = payload?.status_message || payload?.message || null;
      } catch {}

      if (attempt < maxAttempts && retryableStatus(response.status)) {
        const retryAfter = Number(response.headers?.get?.('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(3000, retryAfter * 1000)
          : config.retryBaseMs * (2 ** (attempt - 1));
        await sleep(waitMs);
        continue;
      }
      throw new TmdbHttpError(response.status, path, statusMessage);
    } catch (error) {
      if (error?.name === 'AbortError' && attempt < maxAttempts) {
        await sleep(config.retryBaseMs * (2 ** (attempt - 1)));
        continue;
      }
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(`TMDb timeout on ${path}`);
        timeoutError.code = 'TMDB_TIMEOUT';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`TMDb request failed on ${path}`);
}

async function sourceFetchJson(source, url, options = {}, maxAttempts = 2) {
  const config = getConfig();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.sourceTimeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (response.ok) return await response.json();
      let message = null;
      try {
        const payload = await response.json();
        message = payload?.message || payload?.error || payload?.errors?.[0]?.message || null;
      } catch {}
      if (attempt < maxAttempts && retryableStatus(response.status)) {
        await sleep(config.retryBaseMs * (2 ** (attempt - 1)));
        continue;
      }
      throw new SourceHttpError(source, response.status, new URL(url).pathname, message);
    } catch (error) {
      if (error?.name === 'AbortError' && attempt < maxAttempts) {
        await sleep(config.retryBaseMs * (2 ** (attempt - 1)));
        continue;
      }
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(`${source} timeout`);
        timeoutError.code = `${source.toUpperCase()}_TIMEOUT`;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`${source} request failed`);
}

function normalizeProviderName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function providerDirectory(type) {
  const namespace = type === 'movie' ? 'movie' : 'tv';
  const cacheKey = `providers:${namespace}:US:${getConfig().language}`;
  const cached = providerCache.get(cacheKey);
  if (cached) return cached;
  const payload = await tmdbFetch(`/watch/providers/${namespace}`, {
    language: getConfig().language,
    watch_region: DEFAULT_COUNTRY
  });
  const list = (payload?.results || []).map((entry) => ({
    id: Number(entry?.provider_id),
    name: entry?.provider_name || '',
    normalized: normalizeProviderName(entry?.provider_name)
  })).filter((entry) => Number.isFinite(entry.id) && entry.name);
  return providerCache.set(cacheKey, list, PROVIDERS_TTL_MS);
}

function resolveProviderFromDirectory(definition, directory) {
  const aliasSet = new Set(definition.aliases.map(normalizeProviderName));
  const matches = directory.filter((entry) => aliasSet.has(entry.normalized));
  return {
    ...definition,
    ids: [...new Set(matches.map((entry) => entry.id))],
    matchedNames: [...new Set(matches.map((entry) => entry.name))]
  };
}

async function resolveProvider(providerSlug, type) {
  const definition = PROVIDER_BY_SLUG.get(providerSlug);
  if (!definition) return null;
  const directory = await providerDirectory(type);
  return resolveProviderFromDirectory(definition, directory);
}

function discoverParams(catalog, window, providerIds, page, timeZone = DEFAULT_TIMEZONE) {
  const common = {
    language: getConfig().language,
    page,
    include_adult: false,
    sort_by: 'popularity.desc',
    watch_region: DEFAULT_COUNTRY,
    with_watch_providers: providerIds.join('|'),
    with_watch_monetization_types: 'flatrate'
  };

  if (catalog.type === 'movie') {
    return {
      ...common,
      region: DEFAULT_COUNTRY,
      'release_date.gte': window.start,
      'release_date.lte': window.end,
      with_release_type: '4'
    };
  }

  // For streaming series, TMDb air_date is used only as a candidate date.
  // It remains a calendar date and is never converted as a timezone instant.
  return {
    ...common,
    'air_date.gte': window.start,
    'air_date.lte': window.end,
    include_null_first_air_dates: false
  };
}

function fallbackDiscoverParams(catalog, window, providerIds, page, timeZone) {
  const params = discoverParams(catalog, window, providerIds, page, timeZone);
  delete params.watch_region;
  delete params.with_watch_providers;
  delete params.with_watch_monetization_types;
  return params;
}

async function discoverCandidates(catalog, window, providerIds, timeZone) {
  const endpoint = catalog.type === 'movie' ? '/discover/movie' : '/discover/tv';
  const maxCandidates = getConfig().maxCandidates;
  const items = [];
  for (let page = 1; page <= 5 && items.length < maxCandidates; page += 1) {
    let payload;
    try {
      payload = await tmdbFetch(endpoint, discoverParams(catalog, window, providerIds, page, timeZone));
    } catch (error) {
      if (error?.code === 'TMDB_HTTP_ERROR' && [400, 422].includes(error.status)) {
        payload = await tmdbFetch(endpoint, fallbackDiscoverParams(catalog, window, providerIds, page, timeZone));
      } else {
        throw error;
      }
    }
    items.push(...(payload?.results || []));
    if (page >= Number(payload?.total_pages || 1)) break;
  }
  return items.slice(0, maxCandidates);
}

async function mapLimitSettled(items, limit, mapper) {
  const results = [];
  for (let start = 0; start < items.length; start += limit) {
    const chunk = items.slice(start, start + limit);
    const settled = await Promise.allSettled(chunk.map((item, index) => mapper(item, start + index)));
    for (const result of settled) {
      if (result.status === 'fulfilled') results.push(result.value);
      else results.push({ error: result.reason });
    }
  }
  return results;
}

async function fetchDetails(type, tmdbId) {
  const cacheKey = `details:${type}:${tmdbId}:${getConfig().language}`;
  const cached = detailsCache.get(cacheKey);
  if (cached) return cached;
  const namespace = type === 'movie' ? 'movie' : 'tv';
  const append = type === 'movie'
    ? 'external_ids,watch/providers,release_dates'
    : 'external_ids,watch/providers';
  const details = await tmdbFetch(`/${namespace}/${tmdbId}`, {
    language: getConfig().language,
    append_to_response: append
  });
  return detailsCache.set(cacheKey, details, DETAILS_TTL_MS);
}

function emptyStats(provider, catalog, window, timeZone) {
  return {
    provider: provider?.label || catalog.providerSlug,
    providerSlug: catalog.providerSlug,
    source: catalog.source,
    providerIds: provider?.ids || [],
    type: catalog.type,
    period: catalog.period,
    timezone: timeZone,
    today: window.today,
    start: window.start,
    end: window.end,
    candidates: 0,
    excludedPast: 0,
    excludedDateUnknown: 0,
    excludedOutsideWindow: 0,
    excludedWrongProvider: 0,
    excludedNoImdb: 0,
    excludedMapping: 0,
    enrichmentErrors: 0,
    duplicatesRemoved: 0,
    final: 0
  };
}

function countReason(stats, reason) {
  if (reason === 'past') stats.excludedPast += 1;
  else if (reason === 'date-unknown') stats.excludedDateUnknown += 1;
  else if (reason === 'outside-window') stats.excludedOutsideWindow += 1;
}

async function buildStreamingCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({
    providerSlug: catalog.providerSlug,
    type: catalog.type,
    period,
    timeZone,
    today: window.today,
    sourceVersion: SOURCE_VERSION
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }

  const provider = await resolveProvider(catalog.providerSlug, catalog.type);
  const stats = emptyStats(provider, { ...catalog, period }, window, timeZone);
  if (window.empty) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }
  if (!provider?.ids?.length) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }

  const raw = await discoverCandidates({ ...catalog, period }, window, provider.ids, timeZone);
  stats.candidates = raw.length;

  const settled = await mapLimitSettled(raw, ENRICH_CONCURRENCY, async (candidate) => {
    const details = await fetchDetails(catalog.type, candidate.id);
    if (!hasProviderInFlatrate(details, provider.ids)) return { meta: null, reason: 'wrong-provider' };
    if (catalog.type === 'movie') return movieDetailsToMeta(details, provider.label, window);
    return seriesDetailsToMeta(details, provider.label, window);
  });

  const metas = [];
  for (const result of settled) {
    if (result?.error) {
      stats.enrichmentErrors += 1;
      continue;
    }
    if (result?.reason === 'wrong-provider') {
      stats.excludedWrongProvider += 1;
      continue;
    }
    if (!result?.meta) {
      countReason(stats, result?.reason);
      continue;
    }
    metas.push(result.meta);
  }

  const sorted = sortAndDedupeMetas(metas);
  stats.duplicatesRemoved = Math.max(0, metas.length - sorted.length);
  const finalMetas = sorted.slice(0, getConfig().maxItems).map((meta) => ({ ...cleanCatalogMeta(meta), calendarProviders: [provider.label] }));
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}

function isoDateRange(start, end) {
  const values = [];
  for (let current = normalizeIsoDate(start); current && current <= end; current = addIsoDays(current, 1)) {
    values.push(current);
  }
  return values;
}

async function tvmazeFetch(path, params = {}) {
  const url = new URL(`${TVMAZE_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return sourceFetchJson('tvmaze', url, { headers: { Accept: 'application/json', 'User-Agent': `NuvioUSAReleasesCatalog/${VERSION}` } });
}

async function tvmazeScheduleDate(sourceDate) {
  const key = `tvmaze:schedule:US:${sourceDate}`;
  const cached = tvmazeCache.get(key);
  if (cached) return cached;
  const payload = await tvmazeFetch('/schedule', { country: 'US', date: sourceDate });
  const list = Array.isArray(payload) ? payload : [];
  return tvmazeCache.set(key, list, TVMAZE_SCHEDULE_TTL_MS);
}

function tvmazeShowFromEpisode(episode) {
  return episode?._embedded?.show || episode?.show || null;
}

function tvmazeSourceTimezone(show) {
  const zone = show?.network?.country?.timezone || null;
  return isValidTimeZone(zone) ? zone : null;
}

function tvmazeBroadcastToMeta(episode, timeZone, window, now = new Date()) {
  const show = tvmazeShowFromEpisode(episode);
  if (!show?.network || show?.network?.country?.code !== 'US') return { meta: null, reason: 'not-us-broadcast' };
  if (!episode?.airstamp) return { meta: null, reason: 'date-unknown' };
  const imdbId = show?.externals?.imdb || null;
  if (!/^tt\d+$/.test(String(imdbId || ''))) return { meta: null, reason: 'no-imdb' };

  const sourceTimezone = tvmazeSourceTimezone(show);
  const sourceLocal = sourceTimezone ? viewerDateTimeFromInstant(episode.airstamp, sourceTimezone) : null;
  const eventResult = buildInstantEvent({
    eventMode: EVENT_MODES.BROADCAST_INSTANT,
    eventInstant: episode.airstamp,
    viewerTimezone: timeZone,
    window,
    sourceTimezone,
    sourceDate: sourceLocal?.date || episode.airdate || null,
    sourceTime: sourceLocal?.time || episode.airtime || null
  });
  if (!eventResult.event) return { meta: null, reason: eventResult.reason };
  const event = eventResult.event;
  const code = episodeCode({ season: episode.season, number: episode.number });
  const viewerLabel = `${humanDate(event.viewerDate, timeZone, window.today)} • ${event.viewerTime}`;
  const sourceLabel = sourceLocal
    ? `${humanCalendarDate(sourceLocal.date)} • ${sourceLocal.time}${sourceLocal.timeZoneLabel ? ` ${sourceLocal.timeZoneLabel}` : ''}`
    : [episode.airdate, episode.airtime].filter(Boolean).join(' • ');
  const episodeTitle = episode?.name ? `${code} — ${episode.name}` : code;
  const summary = stripHtml(episode?.summary) || stripHtml(show?.summary);
  const description = [
    episodeTitle,
    sourceLabel ? `Diffusion US : ${sourceLabel}` : null,
    'Horaires : TVmaze',
    summary
  ].filter(Boolean).join('\n\n');

  const runtime = Number(episode?.runtime || show?.runtime || 0) || null;
  const meta = {
    id: imdbId,
    type: 'series',
    name: show.name || 'Sans titre',
    poster: show?.image?.original || show?.image?.medium || null,
    posterShape: 'poster',
    background: show?.image?.original || null,
    landscapePoster: show?.image?.original || null,
    description,
    releaseInfo: `${code} • ${viewerLabel}`,
    released: event.viewerDate,
    status: show?.status || null,
    imdbRating: Number.isFinite(show?.rating?.average) ? Number(show.rating.average).toFixed(1) : null,
    imdb_id: imdbId,
    genres: Array.isArray(show?.genres) ? show.genres : [],
    runtime: runtime ? `${runtime} min` : null,
    country: 'United States',
    language: show?.language || null,
    behaviorHints: { hasScheduledVideos: true },
    _popularity: Number(show?.weight || 0),
    _voteCount: 0,
    _dedupeKey: `tvmaze:${show.id}:${episode.id || `${episode.season}:${episode.number}`}`,
    _eventInstantMs: event.eventInstantMs,
    _eventHasTime: true,
    _eventMode: event.eventMode,
    _eventStatus: event.eventInstant ? temporalStatus(event, now, runtime) : null
  };
  return { meta, reason: null, event };
}

function temporalStatus(event, now, runtime) {
  const start = new Date(event.eventInstant).getTime();
  if (!Number.isFinite(start)) return null;
  const diff = start - now.getTime();
  const end = start + (Number(runtime) > 0 ? Number(runtime) * 60_000 : 0);
  if (diff > 60 * 60_000) return 'UPCOMING';
  if (diff > 0) return 'AIRING_SOON';
  if (end > start && now.getTime() < end) return 'AIRING_NOW';
  return 'RELEASED_TODAY';
}

async function buildTvBroadcastCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({
    providerSlug: 'tv-usa',
    type: 'series',
    period,
    timeZone,
    today: window.today,
    sourceVersion: SOURCE_VERSION
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }
  const stats = emptyStats(null, { ...catalog, period }, window, timeZone);
  if (window.empty) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }
  const sourceDates = isoDateRange(addIsoDays(window.start, -2), addIsoDays(window.end, 2));
  const scheduleResults = await mapLimitSettled(sourceDates, 4, async (sourceDate) => tvmazeScheduleDate(sourceDate));
  const raw = scheduleResults.flatMap((result) => Array.isArray(result) ? result : []);
  stats.candidates = raw.length;
  stats.enrichmentErrors += scheduleResults.filter((result) => result?.error).length;

  const metas = [];
  for (const episode of raw) {
    const converted = tvmazeBroadcastToMeta(episode, timeZone, window, now);
    if (!converted.meta) {
      if (converted.reason === 'no-imdb') stats.excludedNoImdb += 1;
      else if (converted.reason !== 'not-us-broadcast') countReason(stats, converted.reason);
      continue;
    }
    metas.push(converted.meta);
  }

  const sorted = sortAndDedupeMetas(metas);
  stats.duplicatesRemoved = Math.max(0, metas.length - sorted.length);
  const finalMetas = sorted.slice(0, getConfig().maxItems).map((meta) => ({ ...cleanCatalogMeta(meta), calendarProviders: ['TV USA'] }));
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}


async function tvmazeWebScheduleDate(calendarDate) {
  const key = `tvmaze:web-schedule:${calendarDate}`;
  const cached = tvmazeCache.get(key);
  if (cached) return cached;
  // No country parameter: TVmaze returns both local and global web channels.
  // Global services keep their announced civil airdate and normally have no airtime.
  const payload = await tvmazeFetch('/schedule/web', { date: calendarDate });
  const list = Array.isArray(payload) ? payload : [];
  return tvmazeCache.set(key, list, TVMAZE_SCHEDULE_TTL_MS);
}

function webChannelMatchesProvider(show, provider) {
  const name = show?.webChannel?.name || '';
  if (!name || !provider) return false;
  const normalized = normalizeProviderName(name);
  const aliases = new Set([provider.label, ...(provider.aliases || [])].map(normalizeProviderName));
  return aliases.has(normalized);
}

async function resolveTvmazeShowToTmdb(show) {
  const cacheKey = `tvmaze-map:${show?.id}`;
  const cached = mappingCache.get(cacheKey);
  if (cached !== null && cached !== undefined) return cached || null;
  let tmdbId = null;
  const imdb = show?.externals?.imdb;
  const tvdb = Number(show?.externals?.thetvdb);
  if (/^tt\d+$/.test(String(imdb || ''))) {
    tmdbId = await lookupTmdbFromExternal(imdb, 'series', 'imdb_id');
  } else if (Number.isFinite(tvdb) && tvdb > 0) {
    tmdbId = await lookupTmdbFromExternal(tvdb, 'series', 'tvdb_id');
  }
  mappingCache.set(cacheKey, tmdbId || 0, MAPPING_TTL_MS);
  return tmdbId || null;
}

function tvmazeStreamingEpisodeToMeta(episode, details, provider, timeZone, window) {
  const show = tvmazeShowFromEpisode(episode);
  const calendarDate = normalizeIsoDate(episode?.airdate);
  if (!calendarDate) return { meta: null, reason: 'date-unknown' };
  if (!window.allowPast && calendarDate < window.today) return { meta: null, reason: 'past' };
  if (window.empty || calendarDate < window.start || calendarDate > window.end) return { meta: null, reason: 'outside-window' };

  const code = episodeCode({ season: episode.season, number: episode.number });
  const isLocalUsWebChannel = show?.webChannel?.country?.code === 'US';
  let event = {
    eventMode: EVENT_MODES.STREAMING_DATE,
    calendarDate,
    viewerDate: calendarDate,
    viewerTime: null,
    eventInstant: null,
    eventInstantMs: null
  };

  // TVmaze documents airtime for local web channels as the time the episode
  // was first made available. Global web channels intentionally have no release time.
  if (isLocalUsWebChannel && episode?.airstamp) {
    const viewer = viewerDateTimeFromInstant(episode.airstamp, timeZone);
    if (viewer) {
      event = {
        ...event,
        eventMode: EVENT_MODES.STREAMING_INSTANT,
        eventInstant: viewer.instant,
        eventInstantMs: new Date(viewer.instant).getTime(),
        viewerTime: viewer.time,
        convertedViewerDate: viewer.date
      };
    }
  }

  const dateLabel = humanDate(calendarDate, timeZone, window.today);
  const releaseInfo = event.viewerTime
    ? `${code} • ${dateLabel} • ${event.viewerTime}`
    : `${code} • ${dateLabel}`;
  const meta = baseMeta(details, 'series', calendarDate, releaseInfo);
  const episodeSummary = stripHtml(episode?.summary);
  const timingNote = event.viewerTime
    ? `${provider.label} US • heure de mise en ligne TVmaze convertie en ${timeZone}`
    : `${provider.label} US • date streaming officielle, heure non annoncée`;
  meta.description = [
    `${code}${episode?.name ? ` — ${episode.name}` : ''}`,
    timingNote,
    episodeSummary,
    meta.description
  ].filter(Boolean).join('\n\n');
  meta._eventInstantMs = event.eventInstantMs;
  meta._eventHasTime = Boolean(event.viewerTime);
  meta._eventMode = event.eventMode;
  meta._dedupeKey = `stream:${details.id}:${episode.season || 0}:${episode.number || episode.id}`;
  return { meta, reason: null, event };
}

async function buildStreamingSeriesCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({
    providerSlug: catalog.providerSlug,
    type: 'series',
    period,
    timeZone,
    today: window.today,
    sourceVersion: `${SOURCE_VERSION}-webschedule`
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }

  const provider = await resolveProvider(catalog.providerSlug, 'series');
  const stats = emptyStats(provider, { ...catalog, period, source: 'tvmaze-web+tmdb' }, window, timeZone);
  if (window.empty) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }
  if (!provider?.ids?.length) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }

  const dates = isoDateRange(window.start, window.end);
  const scheduleResults = await mapLimitSettled(dates, 4, (date) => tvmazeWebScheduleDate(date));
  const allEpisodes = scheduleResults.flatMap((result) => Array.isArray(result) ? result : []);
  stats.enrichmentErrors += scheduleResults.filter((result) => result?.error).length;
  const providerEpisodes = allEpisodes.filter((episode) => webChannelMatchesProvider(tvmazeShowFromEpisode(episode), provider));
  stats.candidates = providerEpisodes.length;

  const settled = await mapLimitSettled(providerEpisodes.slice(0, getConfig().maxCandidates), 5, async (episode) => {
    const show = tvmazeShowFromEpisode(episode);
    const tmdbId = await resolveTvmazeShowToTmdb(show);
    if (!tmdbId) return { meta: null, reason: 'mapping' };
    const details = await fetchDetails('series', tmdbId);
    if (!hasProviderInFlatrate(details, provider.ids)) return { meta: null, reason: 'wrong-provider' };
    return tvmazeStreamingEpisodeToMeta(episode, details, provider, timeZone, window);
  });

  const metas = [];
  for (const result of settled) {
    if (result?.error) {
      stats.enrichmentErrors += 1;
      continue;
    }
    if (result?.reason === 'mapping') {
      stats.excludedMapping += 1;
      continue;
    }
    if (result?.reason === 'wrong-provider') {
      stats.excludedWrongProvider += 1;
      continue;
    }
    if (!result?.meta) {
      countReason(stats, result?.reason);
      continue;
    }
    metas.push(result.meta);
  }

  const sorted = sortAndDedupeMetas(metas);
  stats.duplicatesRemoved = Math.max(0, metas.length - sorted.length);
  const finalMetas = sorted.slice(0, getConfig().maxItems).map((meta) => ({ ...cleanCatalogMeta(meta), calendarProviders: [provider.label] }));
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}

const ANILIST_AIRING_QUERY = `
query ($page: Int, $start: Int, $end: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { currentPage hasNextPage }
    airingSchedules(airingAt_greater: $start, airingAt_lesser: $end) {
      id
      airingAt
      episode
      mediaId
      media {
        id
        idMal
        title { romaji english native }
        seasonYear
        countryOfOrigin
        format
        status
        isAdult
        duration
        popularity
        averageScore
        genres
        description(asHtml: false)
        coverImage { extraLarge large }
        bannerImage
      }
    }
  }
}`;

const ANILIST_AIRING_BY_ID_QUERY = `
query ($id: Int) {
  AiringSchedule(id: $id) {
    id
    airingAt
    episode
    mediaId
    media {
      id idMal seasonYear countryOfOrigin format status isAdult duration popularity averageScore genres
      title { romaji english native }
      description(asHtml: false)
      coverImage { extraLarge large }
      bannerImage
    }
  }
}`;

async function anilistFetch(query, variables = {}) {
  return sourceFetchJson('anilist', ANILIST_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': `NuvioUSAReleasesCatalog/${VERSION}`
    },
    body: JSON.stringify({ query, variables })
  });
}

async function anilistSchedules(window, timeZone) {
  const bounds = viewerWindowEpochBounds(window, timeZone);
  if (!bounds) return [];
  const key = `anilist:schedule:${timeZone}:${window.start}:${window.end}`;
  const cached = anilistCache.get(key);
  if (cached) return cached;

  const all = [];
  for (let page = 1; page <= 8; page += 1) {
    const payload = await anilistFetch(ANILIST_AIRING_QUERY, {
      page,
      start: bounds.startEpoch - 1,
      end: bounds.endExclusiveEpoch
    });
    if (payload?.errors?.length) throw new SourceHttpError('anilist', 502, '/graphql', payload.errors[0]?.message || 'GraphQL error');
    const section = payload?.data?.Page;
    all.push(...(section?.airingSchedules || []));
    if (!section?.pageInfo?.hasNextPage) break;
  }
  return anilistCache.set(key, all, ANILIST_SCHEDULE_TTL_MS);
}

function animeTitles(media) {
  return [...new Set([
    media?.title?.english,
    media?.title?.romaji,
    media?.title?.native
  ].filter(Boolean))];
}

function candidateMatchesAnime(candidate, media) {
  const expected = new Set(animeTitles(media).map(normalizeTitle).filter(Boolean));
  if (!expected.size) return false;
  const names = [candidate?.name, candidate?.original_name].map(normalizeTitle).filter(Boolean);
  if (!names.some((name) => expected.has(name))) return false;
  const year = Number(media?.seasonYear);
  if (Number.isFinite(year)) {
    const candidateYear = Number(String(candidate?.first_air_date || '').slice(0, 4));
    if (!Number.isFinite(candidateYear) || candidateYear !== year) return false;
  }
  return true;
}

async function resolveAnimeToTmdb(media) {
  const key = `anime-map:${media?.id}`;
  const cached = mappingCache.get(key);
  if (cached !== null && cached !== undefined) return cached;
  const titles = animeTitles(media).slice(0, 2);
  let candidates = [];
  for (const title of titles) {
    const params = { query: title, include_adult: false, language: getConfig().language };
    if (Number.isFinite(Number(media?.seasonYear))) params.first_air_date_year = Number(media.seasonYear);
    const payload = await tmdbFetch('/search/tv', params);
    candidates.push(...(payload?.results || []));
  }
  const unique = [...new Map(candidates.map((candidate) => [Number(candidate.id), candidate])).values()];
  const matches = unique.filter((candidate) => candidateMatchesAnime(candidate, media));
  matches.sort((a, b) => {
    const langA = a.original_language === 'ja' ? 1 : 0;
    const langB = b.original_language === 'ja' ? 1 : 0;
    if (langA !== langB) return langB - langA;
    return Number(b.popularity || 0) - Number(a.popularity || 0);
  });
  const tmdbId = Number(matches[0]?.id) || null;
  mappingCache.set(key, tmdbId || 0, MAPPING_TTL_MS);
  return tmdbId || null;
}

function animeScheduleToMeta(schedule, details, timeZone, window) {
  if (!schedule?.airingAt || !schedule?.episode || schedule?.media?.isAdult) return { meta: null, reason: 'date-unknown' };
  const eventResult = buildInstantEvent({
    eventMode: EVENT_MODES.ANIME_ORIGINAL_AIRING,
    eventInstant: new Date(Number(schedule.airingAt) * 1000),
    viewerTimezone: timeZone,
    window,
    sourceTimezone: null
  });
  if (!eventResult.event) return { meta: null, reason: eventResult.reason };
  const event = eventResult.event;
  const episodeLabel = `Épisode ${schedule.episode}`;
  const info = `${episodeLabel} • ${humanDate(event.viewerDate, timeZone, window.today)} • ${event.viewerTime}`;
  const meta = baseMeta(details, 'series', event.viewerDate, info);
  const anilistTitle = schedule?.media?.title?.english || schedule?.media?.title?.romaji || null;
  if (anilistTitle) meta.name = anilistTitle;
  if (schedule?.media?.coverImage?.extraLarge) meta.poster = schedule.media.coverImage.extraLarge;
  if (schedule?.media?.bannerImage) {
    meta.background = schedule.media.bannerImage;
    meta.landscapePoster = schedule.media.bannerImage;
  }
  meta.description = [
    `${episodeLabel} • Diffusion originale`,
    `Heure locale : ${humanCalendarDate(event.viewerDate)} • ${event.viewerTime}`,
    'Cette heure est l’airing original AniList ; elle n’est pas présentée comme une heure de mise en ligne Crunchyroll/Netflix.',
    schedule?.media?.description || meta.description
  ].filter(Boolean).join('\n\n');
  meta._eventInstantMs = event.eventInstantMs;
  meta._eventHasTime = true;
  meta._eventMode = event.eventMode;
  meta._dedupeKey = `anime:${schedule.mediaId}:${schedule.episode}`;
  meta._popularity = Number(schedule?.media?.popularity || meta._popularity || 0);
  meta._voteCount = Number(schedule?.media?.averageScore || 0);
  return { meta, reason: null, event };
}

async function buildAnimeCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({
    providerSlug: 'anime',
    type: 'series',
    period,
    timeZone,
    today: window.today,
    sourceVersion: SOURCE_VERSION
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }
  const stats = emptyStats(null, { ...catalog, period }, window, timeZone);
  if (window.empty) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }
  const schedules = await anilistSchedules(window, timeZone);
  const filtered = schedules.filter((schedule) => !schedule?.media?.isAdult);
  stats.candidates = filtered.length;

  const settled = await mapLimitSettled(filtered.slice(0, getConfig().maxCandidates), 5, async (schedule) => {
    const tmdbId = await resolveAnimeToTmdb(schedule.media);
    if (!tmdbId) return { meta: null, reason: 'mapping' };
    const details = await fetchDetails('series', tmdbId);
    return animeScheduleToMeta(schedule, details, timeZone, window);
  });

  const metas = [];
  for (const result of settled) {
    if (result?.error) {
      stats.enrichmentErrors += 1;
      continue;
    }
    if (result?.reason === 'mapping') {
      stats.excludedMapping += 1;
      continue;
    }
    if (!result?.meta) {
      countReason(stats, result?.reason);
      continue;
    }
    metas.push(result.meta);
  }

  const sorted = sortAndDedupeMetas(metas);
  stats.duplicatesRemoved = Math.max(0, metas.length - sorted.length);
  const finalMetas = sorted.slice(0, getConfig().maxItems).map((meta) => ({ ...cleanCatalogMeta(meta), calendarProviders: ['Anime'] }));
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}

function publicGlobalSortAndMerge(metas = []) {
  const map = new Map();
  for (const input of metas.filter(Boolean)) {
    const providers = Array.isArray(input.calendarProviders) ? input.calendarProviders.filter(Boolean) : [];
    const key = [input.type, input.id, input.released || '', input.releaseInfo || ''].join(':');
    const previous = map.get(key);
    if (!previous) {
      map.set(key, { ...input, calendarProviders: [...new Set(providers)] });
      continue;
    }
    previous.calendarProviders = [...new Set([...(previous.calendarProviders || []), ...providers])];
    if (!previous.poster && input.poster) previous.poster = input.poster;
    if (!previous.background && input.background) previous.background = input.background;
  }
  return [...map.values()].sort((a, b) => {
    const dateCmp = String(a.released || '').localeCompare(String(b.released || ''));
    if (dateCmp) return dateCmp;
    const ta = String(a.releaseInfo || '').match(/\b([01]\d|2[0-3]):[0-5]\d\b/)?.[0] || '99:99';
    const tb = String(b.releaseInfo || '').match(/\b([01]\d|2[0-3]):[0-5]\d\b/)?.[0] || '99:99';
    if (ta !== tb) return ta.localeCompare(tb);
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

async function resolvedProviders(type) {
  const directory = await providerDirectory(type);
  return PROVIDERS.map((definition) => resolveProviderFromDirectory(definition, directory)).filter((provider) => provider.ids.length);
}

function matchingProviderLabels(details, providers) {
  const active = new Set((details?.['watch/providers']?.results?.[DEFAULT_COUNTRY]?.flatrate || [])
    .map((entry) => Number(entry?.provider_id)).filter(Number.isFinite));
  return providers.filter((provider) => provider.ids.some((id) => active.has(Number(id)))).map((provider) => provider.label);
}

async function buildGlobalMovieCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({ providerSlug: 'global', type: 'movie', period, timeZone, today: window.today, sourceVersion: `${SOURCE_VERSION}-global-movie` });
  if (useCache) { const cached = catalogCache.get(key); if (cached) return cached; }
  const stats = emptyStats(null, { ...catalog, period }, window, timeZone);
  const providers = await resolvedProviders('movie');
  const ids = [...new Set(providers.flatMap((provider) => provider.ids))];
  if (window.empty || !ids.length) return { metas: [], stats };
  const raw = await discoverCandidates({ ...catalog, type: 'movie', period }, window, ids, timeZone);
  stats.candidates = raw.length;
  const settled = await mapLimitSettled(raw, ENRICH_CONCURRENCY, async (candidate) => {
    const details = await fetchDetails('movie', candidate.id);
    const labels = matchingProviderLabels(details, providers);
    if (!labels.length) return { meta: null, reason: 'wrong-provider' };
    const converted = movieDetailsToMeta(details, labels.join(' • '), window);
    if (converted.meta) converted.meta.calendarProviders = labels;
    return converted;
  });
  const metas = [];
  for (const result of settled) {
    if (result?.error) { stats.enrichmentErrors += 1; continue; }
    if (!result?.meta) { if (result?.reason === 'wrong-provider') stats.excludedWrongProvider += 1; else countReason(stats, result?.reason); continue; }
    metas.push({ ...cleanCatalogMeta(result.meta), calendarProviders: result.meta.calendarProviders || [] });
  }
  const finalMetas = publicGlobalSortAndMerge(metas).slice(0, getConfig().maxItems);
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}

async function buildGlobalSeriesCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({ providerSlug: 'global', type: 'series', period, timeZone, today: window.today, sourceVersion: `${SOURCE_VERSION}-global-series` });
  if (useCache) { const cached = catalogCache.get(key); if (cached) return cached; }
  const stats = emptyStats(null, { ...catalog, period }, window, timeZone);
  if (window.empty) return { metas: [], stats };
  const providers = await resolvedProviders('series');
  const dates = isoDateRange(window.start, window.end);
  const scheduleResults = await mapLimitSettled(dates, 4, (date) => tvmazeWebScheduleDate(date));
  const episodes = scheduleResults.flatMap((result) => Array.isArray(result) ? result : []);
  const providerEpisodes = episodes.map((episode) => {
    const show = tvmazeShowFromEpisode(episode);
    const provider = providers.find((candidate) => webChannelMatchesProvider(show, candidate));
    return provider ? { episode, provider } : null;
  }).filter(Boolean);
  stats.candidates = providerEpisodes.length;
  const settled = await mapLimitSettled(providerEpisodes.slice(0, getConfig().maxCandidates), 5, async ({ episode, provider }) => {
    const show = tvmazeShowFromEpisode(episode);
    const tmdbId = await resolveTvmazeShowToTmdb(show);
    if (!tmdbId) return { meta: null, reason: 'mapping' };
    const details = await fetchDetails('series', tmdbId);
    if (!hasProviderInFlatrate(details, provider.ids)) return { meta: null, reason: 'wrong-provider' };
    const converted = tvmazeStreamingEpisodeToMeta(episode, details, provider, timeZone, window);
    if (converted.meta) converted.meta.calendarProviders = [provider.label];
    return converted;
  });
  const streaming = [];
  for (const result of settled) {
    if (result?.error) { stats.enrichmentErrors += 1; continue; }
    if (!result?.meta) continue;
    streaming.push({ ...cleanCatalogMeta(result.meta), calendarProviders: result.meta.calendarProviders || [] });
  }
  const [tv, anime] = await Promise.all([
    buildTvBroadcastCatalog({ catalog: CATALOGS['calendar-tv-usa-series'], timeZone, now, period, useCache: true }),
    buildAnimeCatalog({ catalog: CATALOGS['calendar-anime-series'], timeZone, now, period, useCache: true })
  ]);
  const finalMetas = publicGlobalSortAndMerge([...streaming, ...(tv.metas || []), ...(anime.metas || [])]).slice(0, getConfig().maxItems);
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}

async function buildCatalog(options) {
  const source = options.catalog.source;
  if (source === 'global') return options.catalog.type === 'movie' ? buildGlobalMovieCatalog(options) : buildGlobalSeriesCatalog(options);
  if (source === 'tvmaze-broadcast') return buildTvBroadcastCatalog(options);
  if (source === 'anilist-airing') return buildAnimeCatalog(options);
  if (source === 'tmdb-streaming' && options.catalog.type === 'series') return buildStreamingSeriesCatalog(options);
  return buildStreamingCatalog(options);
}

async function handleCatalog(req, res, type, catalogId, extras = {}, url = null) {
  const catalog = CATALOGS[catalogId];
  if (!catalog || catalog.type !== type) return json(res, 404, { metas: [] });
  const timeZone = requestTimeZone(req);
  const requestedPeriod = extras.genre || extras.period || url?.searchParams?.get('period');
  // Explore catalogs default to today. Legacy v4 IDs retain their historical
  // fixed period when no extra was supplied.
  const fallbackPeriod = catalog.explore ? 'today' : catalog.period;
  const period = periodFromExtra(requestedPeriod, fallbackPeriod);
  const result = await buildCatalog({ catalog, timeZone, now: new Date(), period, useCache: true });
  const origin = requestOrigin(req);
  const decoratedMetas = decorateCatalogMetas(origin, result.metas, catalog, timeZone);
  res.setHeader('Vary', 'x-vercel-ip-timezone');
  res.setHeader('X-Nuvio-Calendar-Date', result.stats.today);
  res.setHeader('X-Nuvio-Calendar-Period', period);
  return json(res, 200, { metas: decoratedMetas }, 'private, max-age=60');
}

async function lookupTmdbFromExternal(id, type, externalSource = 'imdb_id') {
  const payload = await tmdbFetch(`/find/${id}`, { external_source: externalSource, language: getConfig().language });
  const list = type === 'movie' ? payload.movie_results : payload.tv_results;
  return list?.[0]?.id || null;
}

async function resolveTmdbId(id, type) {
  const fallback = parseTmdbFallbackId(id, type);
  if (fallback) return fallback;
  if (/^tt\d+$/.test(id)) return lookupTmdbFromExternal(id, type, 'imdb_id');
  return null;
}

async function handleMeta(res, type, id) {
  const tmdbId = await resolveTmdbId(id, type);
  if (!tmdbId) return json(res, 404, { meta: null });
  const details = await fetchDetails(type, tmdbId);
  let releaseDate;
  let releaseInfo;
  if (type === 'series' && details?.next_episode_to_air?.air_date) {
    releaseDate = details.next_episode_to_air.air_date;
    releaseInfo = `${episodeCode(details.next_episode_to_air)} • ${humanCalendarDate(releaseDate)}`;
  } else {
    releaseDate = type === 'movie' ? details?.release_date : details?.first_air_date;
    releaseInfo = releaseDate || null;
  }
  const meta = cleanCatalogMeta(baseMeta(details, type, releaseDate, releaseInfo));
  meta.id = id;
  return json(res, 200, { meta }, 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600');
}

async function providerHealth() {
  const [movieDirectory, tvDirectory] = await Promise.all([
    providerDirectory('movie'),
    providerDirectory('series')
  ]);
  return Object.fromEntries(PROVIDERS.map((provider) => {
    const movie = resolveProviderFromDirectory(provider, movieDirectory);
    const series = resolveProviderFromDirectory(provider, tvDirectory);
    return [provider.label, Boolean(movie.ids.length || series.ids.length)];
  }));
}

async function sourceHealth() {
  const [tvmaze, anilist] = await Promise.allSettled([
    tvmazeFetch('/shows/1'),
    anilistFetch('query { Media(id: 1) { id } }')
  ]);
  return {
    tvmaze: tvmaze.status === 'fulfilled' ? 'ok' : 'error',
    anilist: anilist.status === 'fulfilled' && anilist.value?.data?.Media?.id ? 'ok' : 'error'
  };
}

async function handleHealth(req, res) {
  const configured = Boolean(getConfig().token || getConfig().apiKey);
  const timeZone = requestTimeZone(req);
  const now = new Date();
  const today = localIsoDate(now, timeZone);
  const currentTime = localTime(now, timeZone);
  if (!configured) {
    const sources = await sourceHealth().catch(() => ({ tvmaze: 'error', anilist: 'error' }));
    return json(res, 503, {
      ok: false,
      version: VERSION,
      market: DEFAULT_COUNTRY,
      mode: 'usa-releases-catalog',
      periods: PERIOD_OPTIONS.map((entry) => entry.label),
      timezone: timeZone,
      today,
      currentTime,
      tmdb: 'missing',
      ...sources
    }, 'no-store');
  }

  try {
    await tmdbFetch('/configuration');
    const [providers, sources] = await Promise.all([
      providerHealth(),
      sourceHealth()
    ]);
    return json(res, 200, {
      ok: true,
      version: VERSION,
      market: DEFAULT_COUNTRY,
      mode: 'usa-releases-catalog',
      periods: PERIOD_OPTIONS.map((entry) => entry.label),
      timezone: timeZone,
      today,
      currentTime,
      tmdb: 'ok',
      tvmaze: sources.tvmaze,
      anilist: sources.anilist,
      providers
    }, 'no-store');
  } catch (error) {
    const sources = await sourceHealth().catch(() => ({ tvmaze: 'error', anilist: 'error' }));
    return json(res, 503, {
      ok: false,
      version: VERSION,
      market: DEFAULT_COUNTRY,
      mode: 'usa-releases-catalog',
      periods: PERIOD_OPTIONS.map((entry) => entry.label),
      timezone: timeZone,
      today,
      currentTime,
      tmdb: 'error',
      tvmaze: sources.tvmaze,
      anilist: sources.anilist,
      tmdbStatus: error?.status || null,
      tmdbMessage: error?.statusMessage || error?.code || 'TMDb inaccessible'
    }, 'no-store');
  }
}

async function handleDebugProvider(req, res, providerSlug, url) {
  if (!getConfig().debug) return json(res, 404, { error: 'Not found' }, 'no-store');
  const definition = PROVIDER_BY_SLUG.get(providerSlug);
  if (!definition) return json(res, 404, { error: 'Unknown provider' }, 'no-store');
  const period = ['month', 'past7', 'today', 'tomorrow', 'week', 'upcoming'].includes(url.searchParams.get('period'))
    ? url.searchParams.get('period')
    : 'week';
  const timeZone = requestTimeZone(req);
  const output = {};
  for (const type of ['movie', 'series']) {
    const catalog = {
      type,
      name: `${definition.label} • ${type === 'movie' ? 'Films' : 'Séries'}`,
      providerSlug,
      period,
      source: 'tmdb-streaming'
    };
    const result = await buildCatalog({ catalog, timeZone, now: new Date(), period, useCache: false });
    output[type] = result.stats;
  }
  return json(res, 200, {
    ok: true,
    version: VERSION,
    market: DEFAULT_COUNTRY,
    provider: definition.label,
    timezone: timeZone,
    today: localIsoDate(new Date(), timeZone),
    period,
    stats: output
  }, 'no-store');
}

async function handleDebugTime(req, res) {
  if (!getConfig().debug) return json(res, 404, { error: 'Not found' }, 'no-store');
  const viewerTimezone = requestTimeZone(req);
  const now = new Date();
  return json(res, 200, {
    viewerTimezone,
    viewerNow: {
      date: localIsoDate(now, viewerTimezone),
      time: localTime(now, viewerTimezone)
    },
    utcNow: now.toISOString()
  }, 'no-store');
}

async function anilistScheduleById(id) {
  const payload = await anilistFetch(ANILIST_AIRING_BY_ID_QUERY, { id: Number(id) });
  if (payload?.errors?.length) throw new SourceHttpError('anilist', 502, '/graphql', payload.errors[0]?.message || 'GraphQL error');
  return payload?.data?.AiringSchedule || null;
}

async function handleDebugAiring(req, res, debugId) {
  if (!getConfig().debug) return json(res, 404, { error: 'Not found' }, 'no-store');
  const timeZone = requestTimeZone(req);
  const now = new Date();
  const window = dateWindow('week', now, timeZone);
  if (/^tvmaze-\d+$/.test(debugId)) {
    const id = Number(debugId.slice('tvmaze-'.length));
    const episode = await tvmazeFetch(`/episodes/${id}`, { embed: 'show' });
    const converted = tvmazeBroadcastToMeta(episode, timeZone, window, now);
    return json(res, 200, {
      source: 'tvmaze',
      id,
      event: converted.event || null,
      reason: converted.reason || null
    }, 'no-store');
  }
  if (/^anilist-\d+$/.test(debugId)) {
    const id = Number(debugId.slice('anilist-'.length));
    const schedule = await anilistScheduleById(id);
    const eventResult = schedule ? buildInstantEvent({
      eventMode: EVENT_MODES.ANIME_ORIGINAL_AIRING,
      eventInstant: new Date(Number(schedule.airingAt) * 1000),
      viewerTimezone: timeZone,
      window
    }) : { event: null, reason: 'not-found' };
    return json(res, 200, {
      source: 'anilist',
      id,
      event: eventResult.event || null,
      reason: eventResult.reason || null
    }, 'no-store');
  }
  return json(res, 404, { error: 'Unknown airing id' }, 'no-store');
}

function landing(origin, timeZone = DEFAULT_TIMEZONE) {
  const manifest = `${origin}/manifest.json`;
  const configured = Boolean(getConfig().token || getConfig().apiKey);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nuvio USA Releases Catalog</title><style>body{margin:0;background:#08111f;color:#f7f7fb;font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}.card{max-width:900px;margin:24px;padding:32px;border:1px solid #26364d;border-radius:24px;background:#0e1a2b}h1{margin-top:0}.pill{display:inline-block;background:#2563eb;padding:8px 14px;border-radius:999px;font-weight:800}code{display:block;overflow-wrap:anywhere;background:#07101c;padding:14px;border-radius:12px;margin:14px 0}a{color:#7dd3fc}.muted{color:#aab2c0}.ok{color:#7ee787}.bad{color:#ff7b72}</style></head><body><main class="card"><span class="pill">ADD-ON INDÉPENDANT • CATALOGUES</span><h1>Nuvio USA Releases Catalog ${VERSION}</h1><p>Projet séparé du Calendar et de l'ancien USA Releases. Il transforme le même moteur dynamique en vrais catalogues Nuvio Home/See-All.</p><p><b>10 lignes natives :</b> Films + Séries pour Aujourd’hui, Demain, 7 prochains jours, 7 derniers jours et Ce mois.</p><p>Chaque carte conserve les badges Netflix / Prime Video / Disney+ / Max / Apple TV+ / Hulu / Paramount+ / Peacock / Crunchyroll / TV USA / Anime. Les doublons multi-plateformes sont fusionnés avec plusieurs badges.</p><p>Fuseau spectateur : <b>${timeZone}</b> — Marché streaming : <b>US</b></p><p>TMDb : <b class="${configured ? 'ok' : 'bad'}">${configured ? 'configuré' : 'clé manquante'}</b></p><p>URL NuvioTV :</p><code>${manifest}</code><p><a href="${manifest}">Ouvrir manifest.json</a> · <a href="${origin}/health">Health</a></p><p class="muted">Streaming : date civile US officielle. TV USA : timestamp réel converti dans le fuseau du spectateur. Anime : airing original AniList converti localement, sans prétendre qu'il s'agit d'une heure Crunchyroll. This product uses the TMDB API but is not endorsed or certified by TMDB.</p></main></body></html>`;
}

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#08111f"/><rect x="70" y="82" width="372" height="348" rx="78" fill="#0e1a2b" stroke="#2563eb" stroke-width="18"/><path d="M118 176h276M118 252h276M118 328h180" stroke="#fff" stroke-width="24" stroke-linecap="round"/><text x="313" y="360" fill="#60a5fa" font-family="Arial,sans-serif" font-size="72" font-weight="900">USA</text></svg>`;
const BG = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#08111f"/><stop offset="1" stop-color="#172554"/></linearGradient></defs><rect width="1920" height="1080" fill="url(#g)"/><circle cx="1510" cy="210" r="430" fill="#2563eb" opacity=".20"/></svg>`;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.end();
  }
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const origin = requestOrigin(req);
  const url = new URL(req.url, origin);
  const path = decodeURIComponent(url.pathname);

  try {
    if (path === '/' || path === '/index.html') return html(res, landing(origin, requestTimeZone(req)));
    if (path === '/manifest.json') return json(res, 200, buildManifest(origin), 'public, max-age=300, s-maxage=900');
    if (path === '/logo.svg') return svg(res, LOGO);
    if (path === '/background.svg') return svg(res, BG);
    if (path === '/release-card.svg' || path === '/calendar-card.svg') return await handleCalendarCard(res, url);
    if (path === '/health') return await handleHealth(req, res);

    if (path === '/debug/time') return await handleDebugTime(req, res);
    const debugProviderMatch = path.match(/^\/debug\/provider\/([^/]+)$/);
    if (debugProviderMatch) return await handleDebugProvider(req, res, debugProviderMatch[1], url);
    const debugAiringMatch = path.match(/^\/debug\/airing\/([^/]+)$/);
    if (debugAiringMatch) return await handleDebugAiring(req, res, debugAiringMatch[1]);

    const catalogMatch = path.match(/^\/catalog\/(movie|series)\/([^/]+)(?:\/([^/]+))?\.json$/);
    if (catalogMatch) {
      const extras = parseCatalogExtraSegment(catalogMatch[3] || '');
      return await handleCatalog(req, res, catalogMatch[1], catalogMatch[2], extras, url);
    }

    const metaMatch = path.match(/^\/meta\/(movie|series)\/([^/]+)\.json$/);
    if (metaMatch) return await handleMeta(res, metaMatch[1], metaMatch[2]);

    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    if (error?.code === 'TMDB_CONFIG_MISSING') {
      return json(res, 503, { error: 'Configure TMDB_READ_TOKEN ou TMDB_API_KEY sur le serveur.' }, 'no-store');
    }
    if (error?.code === 'TMDB_HTTP_ERROR') {
      return json(res, 502, {
        error: 'Impossible de charger les nouvelles sorties USA pour le moment.',
        tmdbStatus: error.status || null,
        tmdbMessage: error.statusMessage || null
      }, 'no-store');
    }
    if (error?.code === 'TMDB_TIMEOUT') return json(res, 504, { error: 'TMDb a mis trop de temps à répondre.' }, 'no-store');
    if (error?.source === 'tvmaze' || String(error?.code || '').startsWith('TVMAZE_')) {
      return json(res, 502, { error: 'TVmaze est momentanément indisponible.' }, 'no-store');
    }
    if (error?.source === 'anilist' || String(error?.code || '').startsWith('ANILIST_')) {
      return json(res, 502, { error: 'AniList est momentanément indisponible.' }, 'no-store');
    }
    return json(res, 502, { error: 'Impossible de charger les sorties USA pour le moment.' }, 'no-store');
  }
};

module.exports._internals = {
  VERSION,
  PROVIDERS,
  PERIOD_OPTIONS,
  PERIOD_LABELS,
  CATALOGS,
  EXPLORE_CATALOG_IDS,
  HOME_PERIODS,
  HOME_CATALOG_IDS,
  EVENT_MODES,
  MemoryCache,
  buildManifest,
  getConfig,
  requestTimeZone,
  normalizePeriodLabel,
  periodFromExtra,
  parseCatalogExtraSegment,
  isAllowedPosterSource,
  calendarCardUrl,
  decorateCatalogMetas,
  calendarCardSvg,
  normalizeProviderName,
  resolveProviderFromDirectory,
  discoverParams,
  fallbackDiscoverParams,
  providerDirectory,
  resolveProvider,
  fetchDetails,
  buildStreamingCatalog,
  buildStreamingSeriesCatalog,
  buildTvBroadcastCatalog,
  buildAnimeCatalog,
  buildGlobalMovieCatalog,
  buildGlobalSeriesCatalog,
  publicGlobalSortAndMerge,
  matchingProviderLabels,
  buildCatalog,
  mapLimitSettled,
  tmdbFetch,
  tvmazeFetch,
  tvmazeScheduleDate,
  tvmazeWebScheduleDate,
  tvmazeBroadcastToMeta,
  tvmazeStreamingEpisodeToMeta,
  webChannelMatchesProvider,
  resolveTvmazeShowToTmdb,
  anilistFetch,
  anilistSchedules,
  anilistScheduleById,
  animeScheduleToMeta,
  candidateMatchesAnime,
  resolveAnimeToTmdb,
  SourceHttpError,
  TmdbHttpError,
  catalogCache,
  detailsCache,
  providerCache,
  tvmazeCache,
  anilistCache,
  mappingCache,
  providerHealth,
  sourceHealth,
  isoDateRange
};
