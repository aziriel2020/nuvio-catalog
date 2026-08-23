'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/index');

function mockResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async json() { return payload; }
  };
}

function request(url, timezone = 'Europe/Brussels') {
  return {
    method: 'GET',
    url,
    headers: {
      host: 'example.vercel.app',
      'x-forwarded-proto': 'https',
      'x-vercel-ip-timezone': timezone
    }
  };
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value = '') { this.body += value; }
  };
}

async function call(url, timezone) {
  const res = response();
  await handler(request(url, timezone), res);
  return { status: res.statusCode, headers: res.headers, body: res.body, json: JSON.parse(res.body) };
}

function clearCaches() {
  for (const key of ['catalogCache', 'detailsCache', 'providerCache', 'tvmazeCache', 'anilistCache', 'mappingCache']) {
    handler._internals[key].clear();
  }
}

function tmdbMovie(id = 101, digitalDate = '2026-08-23') {
  return {
    id,
    title: 'Fresh Film',
    overview: 'Fresh',
    popularity: 10,
    vote_count: 20,
    vote_average: 7.2,
    external_ids: { imdb_id: 'tt7654321' },
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ type: 4, release_date: `${digitalDate}T00:00:00Z` }] }] },
    'watch/providers': { results: { US: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } } },
    genres: [{ name: 'Drama' }]
  };
}

function tvEpisode() {
  return {
    id: 222,
    name: 'Tonight',
    season: 1,
    number: 2,
    airdate: '2026-08-23',
    airtime: '12:00',
    airstamp: '2026-08-23T12:00:00-04:00',
    runtime: 60,
    _embedded: { show: {
      id: 333,
      name: 'Network Show',
      language: 'English',
      genres: ['Drama'],
      status: 'Running',
      weight: 50,
      rating: { average: 7.5 },
      image: { original: 'https://img/show.jpg' },
      externals: { imdb: 'tt1234567' },
      network: { name: 'ABC', country: { code: 'US', timezone: 'America/New_York' } }
    } }
  };
}


function netflixWebEpisode() {
  return {
    id: 991,
    name: 'Drop Day',
    season: 2,
    number: 1,
    airdate: '2026-08-23',
    airtime: '',
    airstamp: '2026-08-23T00:00:00Z',
    runtime: 50,
    _embedded: { show: {
      id: 992,
      name: 'Netflix Fresh Series',
      externals: { imdb: 'tt9999999' },
      network: null,
      webChannel: { id: 1, name: 'Netflix', country: null }
    } }
  };
}

function netflixSeriesDetails() {
  return {
    id: 993,
    name: 'Netflix Fresh Series',
    first_air_date: '2026-08-23',
    popularity: 80,
    vote_count: 20,
    vote_average: 8,
    external_ids: { imdb_id: 'tt9999999' },
    'watch/providers': { results: { US: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } } },
    genres: [{ name: 'Drama' }]
  };
}

function animeSchedule() {
  return {
    id: 444,
    airingAt: Math.floor(new Date('2026-08-23T15:30:00Z').getTime() / 1000),
    episode: 8,
    mediaId: 555,
    media: {
      id: 555,
      title: { english: 'Exact Anime', romaji: 'Exact Anime', native: null },
      seasonYear: 2026,
      countryOfOrigin: 'JP',
      isAdult: false,
      popularity: 1000,
      averageScore: 80,
      genres: ['Action'],
      description: 'Anime',
      coverImage: { extraLarge: 'https://img/anime.jpg' },
      bannerImage: 'https://img/anime-bg.jpg'
    }
  };
}

function tmdbSeries() {
  return {
    id: 777,
    name: 'Exact Anime',
    first_air_date: '2026-01-01',
    original_language: 'ja',
    popularity: 100,
    vote_count: 20,
    vote_average: 8,
    external_ids: { imdb_id: 'tt8888888' },
    'watch/providers': { results: { US: { flatrate: [] } } },
    genres: [{ name: 'Animation' }]
  };
}

test('manifest route exposes USA Releases fixed-period Home catalogs', async () => {
  const result = await call('/manifest.json');
  assert.equal(result.status, 200);
  assert.equal(result.json.version, '1.0.0');
  assert.equal(result.json.id, 'com.nuvio.usareleases.catalog');
  assert.equal(result.json.catalogs.length, 10);
  assert.ok(result.json.catalogs.some((c) => c.id === 'usa-releases-today-movie'));
  assert.ok(result.json.catalogs.some((c) => c.id === 'usa-releases-today-series'));
  assert.ok(result.json.catalogs.some((c) => c.id === 'usa-releases-tomorrow-movie'));
  assert.ok(result.json.catalogs.some((c) => c.id === 'usa-releases-week-series'));
  assert.ok(result.json.catalogs.some((c) => c.id === 'usa-releases-past7-movie'));
  assert.ok(result.json.catalogs.some((c) => c.id === 'usa-releases-month-series'));
  assert.ok(result.json.catalogs.every((c) => c.showInHome === true));
  assert.ok(result.json.catalogs.every((c) => c.extra === undefined));
});


test('catalog project manifest does not expose Calendar addon IDs', async () => {
  const result = await call('/manifest.json');
  assert.equal(result.status, 200);
  assert.equal(result.json.id, 'com.nuvio.usareleases.catalog');
  assert.equal(result.json.catalogs.some((c) => c.id.startsWith('calendar-')), false);
  assert.equal(result.body.includes('com.nuvio.calendar'), false);
});

test('health checks TMDb, TVmaze and AniList without exposing secrets', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'super-secret';
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/3/configuration') return mockResponse(200, { images: {} });
    if (u.pathname === '/3/watch/providers/movie' || u.pathname === '/3/watch/providers/tv') {
      return mockResponse(200, { results: [{ provider_id: 8, provider_name: 'Netflix' }] });
    }
    if (u.hostname === 'api.tvmaze.com' && u.pathname === '/shows/1') return mockResponse(200, { id: 1 });
    if (u.hostname === 'graphql.anilist.co') return mockResponse(200, { data: { Media: { id: 1 } } });
    throw new Error(`Unexpected ${u} ${options.method || 'GET'}`);
  };
  try {
    const result = await call('/health');
    assert.equal(result.status, 200);
    assert.equal(result.json.tmdb, 'ok');
    assert.equal(result.json.tvmaze, 'ok');
    assert.equal(result.json.anilist, 'ok');
    assert.equal(result.json.timezone, 'Europe/Brussels');
    assert.equal(result.body.includes('super-secret'), false);
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});

test('Netflix film route returns date-only streaming release', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'test';
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/3/watch/providers/movie') return mockResponse(200, { results: [{ provider_id: 8, provider_name: 'Netflix' }] });
    if (u.pathname === '/3/discover/movie') return mockResponse(200, { results: [{ id: 101 }], total_pages: 1 });
    if (u.pathname === '/3/movie/101') return mockResponse(200, tmdbMovie());
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await call('/catalog/movie/calendar-netflix-movie.json');
    assert.equal(result.status, 200);
    assert.equal(result.json.metas.length, 1);
    assert.equal(result.json.metas[0].released, '2026-08-23');
    assert.doesNotMatch(result.json.metas[0].releaseInfo, /00:00/);
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});


test('Netflix series route is validated by TVmaze web schedule and keeps same civil date', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'test';
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/3/watch/providers/tv') return mockResponse(200, { results: [{ provider_id: 8, provider_name: 'Netflix' }] });
    if (u.hostname === 'api.tvmaze.com' && u.pathname === '/schedule/web') {
      return u.searchParams.get('date') === '2026-08-23' ? mockResponse(200, [netflixWebEpisode()]) : mockResponse(200, []);
    }
    if (u.pathname === '/3/find/tt9999999') return mockResponse(200, { tv_results: [{ id: 993 }] });
    if (u.pathname === '/3/tv/993') return mockResponse(200, netflixSeriesDetails());
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await call('/catalog/series/calendar-netflix-series.json');
    assert.equal(result.status, 200);
    assert.equal(result.json.metas.length, 1);
    assert.equal(result.json.metas[0].released, '2026-08-23');
    assert.doesNotMatch(result.json.metas[0].releaseInfo, /00:00/);
    assert.match(result.json.metas[0].description, /date streaming officielle/);
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});

test('TV USA route returns converted Belgian broadcast time', async () => {
  clearCaches();
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.tvmaze.com' && u.pathname === '/schedule') return mockResponse(200, [tvEpisode()]);
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await call('/catalog/series/calendar-tv-usa-series.json');
    assert.equal(result.status, 200);
    assert.equal(result.json.metas.length, 1);
    assert.match(result.json.metas[0].releaseInfo, /18:00/);
    assert.match(result.json.metas[0].description, /Diffusion US/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Anime route returns original airing converted locally, not fake Crunchyroll time', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'test';
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'graphql.anilist.co') return mockResponse(200, {
      data: { Page: { pageInfo: { currentPage: 1, hasNextPage: false }, airingSchedules: [animeSchedule()] } }
    });
    if (u.pathname === '/3/search/tv') return mockResponse(200, { results: [{
      id: 777, name: 'Exact Anime', original_name: 'Exact Anime', first_air_date: '2026-01-01', original_language: 'ja', popularity: 100
    }] });
    if (u.pathname === '/3/tv/777') return mockResponse(200, tmdbSeries());
    throw new Error(`Unexpected ${u} ${options.method || 'GET'}`);
  };
  try {
    const result = await call('/catalog/series/calendar-anime-series.json');
    assert.equal(result.status, 200);
    assert.equal(result.json.metas.length, 1);
    assert.match(result.json.metas[0].releaseInfo, /17:30/);
    assert.match(result.json.metas[0].description, /airing original AniList/);
    assert.doesNotMatch(result.json.metas[0].releaseInfo, /Crunchyroll/);
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});


test('Explore genre=Demain selects tomorrow without changing streaming market', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'test';
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/3/watch/providers/movie') return mockResponse(200, { results: [{ provider_id: 8, provider_name: 'Netflix' }] });
    if (u.pathname === '/3/discover/movie') {
      assert.equal(u.searchParams.get('release_date.gte'), '2026-08-24');
      assert.equal(u.searchParams.get('release_date.lte'), '2026-08-24');
      assert.equal(u.searchParams.get('watch_region'), 'US');
      return mockResponse(200, { results: [{ id: 102 }], total_pages: 1 });
    }
    if (u.pathname === '/3/movie/102') return mockResponse(200, tmdbMovie(102, '2026-08-24'));
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await call('/catalog/movie/calendar-netflix-movie/genre=Demain.json');
    assert.equal(result.status, 200);
    assert.equal(result.headers['x-nuvio-calendar-period'], 'tomorrow');
    assert.equal(result.json.metas.length, 1);
    assert.equal(result.json.metas[0].released, '2026-08-24');
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});

test('Explore encoded 7-day period is parsed from standard Nuvio extra URL', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'test';
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/3/watch/providers/movie') return mockResponse(200, { results: [{ provider_id: 8, provider_name: 'Netflix' }] });
    if (u.pathname === '/3/discover/movie') {
      assert.equal(u.searchParams.get('release_date.gte'), '2026-08-23');
      assert.equal(u.searchParams.get('release_date.lte'), '2026-08-29');
      return mockResponse(200, { results: [{ id: 103 }], total_pages: 1 });
    }
    if (u.pathname === '/3/movie/103') return mockResponse(200, tmdbMovie(103, '2026-08-29'));
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await call('/catalog/movie/calendar-netflix-movie/genre=7%20prochains%20jours.json');
    assert.equal(result.status, 200);
    assert.equal(result.headers['x-nuvio-calendar-period'], 'week');
    assert.equal(result.json.metas.length, 1);
    assert.equal(result.json.metas[0].released, '2026-08-29');
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});

test('Explore 7 derniers jours requests J-7 through yesterday and excludes today', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'test';
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/3/watch/providers/movie') return mockResponse(200, { results: [{ provider_id: 8, provider_name: 'Netflix' }] });
    if (u.pathname === '/3/discover/movie') {
      assert.equal(u.searchParams.get('release_date.gte'), '2026-08-16');
      assert.equal(u.searchParams.get('release_date.lte'), '2026-08-22');
      return mockResponse(200, { results: [{ id: 104 }, { id: 105 }], total_pages: 1 });
    }
    if (u.pathname === '/3/movie/104') return mockResponse(200, tmdbMovie(104, '2026-08-22'));
    if (u.pathname === '/3/movie/105') return mockResponse(200, tmdbMovie(105, '2026-08-23'));
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await call('/catalog/movie/calendar-netflix-movie/genre=7%20derniers%20jours.json');
    assert.equal(result.status, 200);
    assert.equal(result.headers['x-nuvio-calendar-period'], 'past7');
    assert.equal(result.json.metas.length, 1);
    assert.equal(result.json.metas[0].released, '2026-08-22');
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});

test('Explore Ce mois requests month start through yesterday only', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'test';
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/3/watch/providers/movie') return mockResponse(200, { results: [{ provider_id: 8, provider_name: 'Netflix' }] });
    if (u.pathname === '/3/discover/movie') {
      assert.equal(u.searchParams.get('release_date.gte'), '2026-08-01');
      assert.equal(u.searchParams.get('release_date.lte'), '2026-08-22');
      return mockResponse(200, { results: [{ id: 106 }], total_pages: 1 });
    }
    if (u.pathname === '/3/movie/106') return mockResponse(200, tmdbMovie(106, '2026-08-01'));
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await call('/catalog/movie/calendar-netflix-movie/genre=Ce%20mois.json');
    assert.equal(result.status, 200);
    assert.equal(result.headers['x-nuvio-calendar-period'], 'month');
    assert.equal(result.json.metas.length, 1);
    assert.equal(result.json.metas[0].released, '2026-08-01');
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});

test('legacy USA Releases catalog IDs are not exposed by standalone Calendar addon', async () => {
  const result = await call('/catalog/movie/netflix-movie-upcoming.json');
  assert.equal(result.status, 404);
});

test('Explore TV USA period=Demain classifies by viewer-local broadcast date', async () => {
  clearCaches();
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.tvmaze.com' && u.pathname === '/schedule') {
      const date = u.searchParams.get('date');
      if (date === '2026-08-24') {
        const episode = tvEpisode();
        episode.airdate = '2026-08-24';
        episode.airstamp = '2026-08-24T12:00:00-04:00';
        return mockResponse(200, [episode]);
      }
      return mockResponse(200, []);
    }
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await call('/catalog/series/calendar-tv-usa-series/genre=Demain.json');
    assert.equal(result.status, 200);
    assert.equal(result.headers['x-nuvio-calendar-period'], 'tomorrow');
    assert.equal(result.json.metas.length, 1);
    assert.equal(result.json.metas[0].released, '2026-08-24');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Explore Anime period=Demain uses AniList instant and viewer-local date', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'test';
  const originalFetch = global.fetch;
  const schedule = animeSchedule();
  schedule.airingAt = Math.floor(new Date('2026-08-24T15:30:00Z').getTime() / 1000);
  global.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'graphql.anilist.co') return mockResponse(200, {
      data: { Page: { pageInfo: { currentPage: 1, hasNextPage: false }, airingSchedules: [schedule] } }
    });
    if (u.pathname === '/3/search/tv') return mockResponse(200, { results: [{
      id: 777, name: 'Exact Anime', original_name: 'Exact Anime', first_air_date: '2026-01-01', original_language: 'ja', popularity: 100
    }] });
    if (u.pathname === '/3/tv/777') return mockResponse(200, tmdbSeries());
    throw new Error(`Unexpected ${u} ${options.method || 'GET'}`);
  };
  try {
    const result = await call('/catalog/series/calendar-anime-series/genre=Demain.json');
    assert.equal(result.status, 200);
    assert.equal(result.headers['x-nuvio-calendar-period'], 'tomorrow');
    assert.equal(result.json.metas.length, 1);
    assert.equal(result.json.metas[0].released, '2026-08-24');
    assert.match(result.json.metas[0].releaseInfo, /17:30/);
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});

test('calendar-card.svg embeds an allowed remote poster into an SVG calendar card', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    assert.equal(u.hostname, 'image.tmdb.org');
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => String(name).toLowerCase() === 'content-type' ? 'image/jpeg' : null },
      async arrayBuffer() { return Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer; }
    };
  };
  try {
    const res = response();
    await handler(request('/release-card.svg?src=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2Fposter.jpg&title=Show&provider=Netflix&info=S01E02%20%E2%80%A2%2003%3A00&type=series'), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /image\/svg\+xml/);
    assert.match(res.body, /data:image\/jpeg;base64/);
    assert.match(res.body, /Netflix/);
    assert.match(res.body, /03:00/);
  } finally {
    global.fetch = originalFetch;
  }
});



test('catalog-first tomorrow row uses its fixed period without an Explore extra', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'test';
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/3/watch/providers/movie') return mockResponse(200, { results: [{ provider_id: 8, provider_name: 'Netflix' }] });
    if (u.pathname === '/3/discover/movie') {
      assert.equal(u.searchParams.get('release_date.gte'), '2026-08-24');
      assert.equal(u.searchParams.get('release_date.lte'), '2026-08-24');
      return mockResponse(200, { results: [{ id: 101 }], total_pages: 1 });
    }
    if (u.pathname === '/3/movie/101') { const movie = tmdbMovie(101, '2026-08-24'); movie.poster_path = '/poster.jpg'; return mockResponse(200, movie); }
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await call('/catalog/movie/usa-releases-tomorrow-movie.json');
    assert.equal(result.status, 200);
    assert.equal(result.json.metas.length, 1);
    assert.equal(result.json.metas[0].released, '2026-08-24');
    assert.equal(new URL(result.json.metas[0].poster).pathname, '/release-card.svg');
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});

test('Global movie view merges platforms and puts their badges on the calendar card', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'test';
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/3/watch/providers/movie') return mockResponse(200, { results: [
      { provider_id: 8, provider_name: 'Netflix' },
      { provider_id: 337, provider_name: 'Disney Plus' }
    ] });
    if (u.pathname === '/3/discover/movie') return mockResponse(200, { results: [{ id: 101 }], total_pages: 1 });
    if (u.pathname === '/3/movie/101') {
      const movie = tmdbMovie();
      movie.poster_path = '/poster.jpg';
      movie['watch/providers'].results.US.flatrate = [
        { provider_id: 8, provider_name: 'Netflix' },
        { provider_id: 337, provider_name: 'Disney Plus' }
      ];
      return mockResponse(200, movie);
    }
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await call('/catalog/movie/calendar-global-movie/genre=Aujourd%E2%80%99hui.json');
    assert.equal(result.status, 200);
    assert.equal(result.json.metas.length, 1);
    const poster = new URL(result.json.metas[0].poster);
    assert.equal(poster.pathname, '/release-card.svg');
    assert.equal(poster.searchParams.get('badges'), 'Netflix|Disney+');
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});

test('Global series view groups streaming with source badge while TV/anime can be empty', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'test';
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/3/watch/providers/tv') return mockResponse(200, { results: [{ provider_id: 8, provider_name: 'Netflix' }] });
    if (u.hostname === 'api.tvmaze.com' && u.pathname === '/schedule/web') {
      return u.searchParams.get('date') === '2026-08-23' ? mockResponse(200, [netflixWebEpisode()]) : mockResponse(200, []);
    }
    if (u.hostname === 'api.tvmaze.com' && u.pathname === '/schedule') return mockResponse(200, []);
    if (u.pathname === '/3/find/tt9999999') return mockResponse(200, { tv_results: [{ id: 993 }] });
    if (u.pathname === '/3/tv/993') {
      const details = netflixSeriesDetails();
      details.poster_path = '/series-poster.jpg';
      return mockResponse(200, details);
    }
    if (u.hostname === 'graphql.anilist.co') return mockResponse(200, { data: { Page: { pageInfo: { currentPage: 1, hasNextPage: false }, airingSchedules: [] } } });
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await call('/catalog/series/calendar-global-series/genre=Aujourd%E2%80%99hui.json');
    assert.equal(result.status, 200);
    assert.equal(result.json.metas.length, 1);
    const poster = new URL(result.json.metas[0].poster);
    assert.equal(poster.searchParams.get('badges'), 'Netflix');
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});
