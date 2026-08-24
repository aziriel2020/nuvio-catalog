'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const calendar=require('../src/calendar');
const api=require('../api/index');
const fixedNow=new Date('2026-08-24T12:28:00Z');
const tz='Europe/Brussels';

test('archive windows',()=>{
  assert.deepEqual(calendar.dateWindow('archive-2025-02',fixedNow,tz),{start:'2025-02-01',end:'2025-02-28',kind:'archive-month',today:'2026-08-24',allowPast:true,empty:false,archiveYear:2025,archiveMonth:2});
  assert.deepEqual(calendar.dateWindow('archive-2026-08',fixedNow,tz),{start:'2026-08-01',end:'2026-08-24',kind:'archive-month',today:'2026-08-24',allowPast:true,empty:false,archiveYear:2026,archiveMonth:8});
  assert.equal(calendar.dateWindow('archive-2026-09',fixedNow,tz).empty,true);
});

test('catalogs are split by parent type, month and streaming service',()=>{
  const e=api._internals.buildArchiveCatalogEntries(fixedNow,tz);
  const expectedPerYear=12*(api._internals.ARCHIVE_SERIES_PROVIDERS.length+api._internals.ARCHIVE_FILM_PROVIDERS.length);
  assert.equal(e.length,expectedPerYear*2);
  assert.equal(e[0].id,'archives-v2-series-netflix-2026-01');
  assert.equal(e[0].catalog.name,'Janvier 2026 — Netflix');
  assert.equal(e.at(-1).id,'archives-v2-movie-peacock-2025-12');
  assert(e.every(x=>x.catalog.source==='tmdb-streaming'));
});

test('manifest is hidden from normal Home and exposes provider-specific row names',()=>{
  const m=api._internals.buildManifest('https://archives.example',fixedNow,tz);
  assert.equal(m.id,'com.nuvio.calendar.archives');
  assert.equal(m.version,'1.2.0');
  assert.equal(m.catalogs.length,408);
  assert(m.catalogs.every(c=>c.showInHome===false));
  assert(m.catalogs.every(c=>c.extraSupported.includes('skip')));
  assert(m.catalogs.some(c=>c.type==='series'&&c.name==='Janvier 2026 — Netflix'));
  assert(m.catalogs.some(c=>c.type==='movie'&&c.name==='Janvier 2026 — Prime Video'));
});

test('series and film IDs resolve only with their correct Nuvio type',()=>{
  const s=api._internals.resolveArchiveCatalog('archives-v2-series-netflix-2025-04','series',fixedNow,tz);
  const m=api._internals.resolveArchiveCatalog('archives-v2-movie-netflix-2025-04','movie',fixedNow,tz);
  assert.equal(s.type,'series');
  assert.equal(s.providerSlug,'netflix');
  assert.equal(m.type,'movie');
  assert.equal(m.providerSlug,'netflix');
  assert.equal(api._internals.resolveArchiveCatalog('archives-v2-series-netflix-2025-04','movie',fixedNow,tz),null);
});

test('Shield Modern decoration keeps real type and forces landscape card',()=>{
  assert.equal(api._internals.isHomeCalendarPeriod('archive-2025-04'),true);
  const meta={id:'tt1234567',type:'movie',name:'Archive Film',poster:'https://image.tmdb.org/t/p/w500/demo.jpg',background:'https://image.tmdb.org/t/p/original/demo-bg.jpg',landscapePoster:'https://image.tmdb.org/t/p/original/demo-bg.jpg',releaseInfo:'4 avr. 2025',released:'2025-04-04',_calendarProvider:'Netflix',_calendarSource:'tmdb-streaming'};
  const c=api._internals.resolveArchiveCatalog('archives-v2-movie-netflix-2025-04','movie',fixedNow,tz);
  const [d]=api._internals.decorateCatalogMetas('https://archives.example',[meta],c,tz);
  assert.equal(d.type,'movie');
  assert.equal(d.posterShape,'landscape');
  assert.match(d.background,/calendar-card\.svg/);
  assert.match(d.logo,/calendar-transparent-logo\.svg/);
  assert.match(d.releaseInfo,/NETFLIX/);
});

test('Nuvio import payload has exactly two pinned parent collections',()=>{
  const payload=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example');
  assert(Array.isArray(payload));
  assert.equal(payload.length,2);
  assert.deepEqual(payload.map(c=>c.title),['📺 Séries','🎬 Films']);
  assert.deepEqual(payload.map(c=>c.id),['calendar-archives','calendar-archives-films']);
  assert(payload.every(c=>c.viewMode==='FOLLOW_LAYOUT'));
  assert(payload.every(c=>c.showAllTab===false));
  assert(payload.every(c=>c.pinToTop===true));
});

test('old calendar-archives collection id is reused by Series parent for clean upgrade',()=>{
  const [series]=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example');
  assert.equal(series.id,'calendar-archives');
  assert.equal(series.title,'📺 Séries');
});

test('each parent has child year cards 2026 and 2025',()=>{
  const collections=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example');
  for(const collection of collections){
    assert.deepEqual(collection.folders.map(f=>f.title),['2026','2025']);
    assert(collection.folders.every(f=>f.tileShape==='LANDSCAPE'));
    assert(collection.folders.every(f=>/^https:\/\/archives\.example\/archive-year-card\.svg\?year=20\d{2}&category=(series|films)$/.test(f.coverImageUrl)));
  }
});

test('Series year has 12 months x 9 services in month-major row order',()=>{
  const [series]=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example');
  const y=series.folders[0];
  assert.equal(y.sources.length,108);
  assert.equal(y.catalogSources.length,108);
  assert.equal(y.sources[0].catalogId,'archives-v2-series-netflix-2026-01');
  assert.equal(y.sources[8].catalogId,'archives-v2-series-crunchyroll-2026-01');
  assert.equal(y.sources[9].catalogId,'archives-v2-series-netflix-2026-02');
  assert.equal(y.sources.at(-1).catalogId,'archives-v2-series-crunchyroll-2026-12');
});

test('Films year has 12 months x 8 services in separate rows',()=>{
  const films=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example')[1];
  const y=films.folders[0];
  assert.equal(y.sources.length,96);
  assert.equal(y.catalogSources.length,96);
  assert.equal(y.sources[0].catalogId,'archives-v2-movie-netflix-2026-01');
  assert.equal(y.sources[7].catalogId,'archives-v2-movie-peacock-2026-01');
  assert.equal(y.sources[8].catalogId,'archives-v2-movie-netflix-2026-02');
  assert.equal(y.sources.at(-1).catalogId,'archives-v2-movie-peacock-2026-12');
});

test('folder sources use installed addon id and their real category type',()=>{
  const [series,films]=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example');
  assert(series.folders.flatMap(f=>f.sources).every(s=>s.provider==='addon'&&s.addonId==='com.nuvio.calendar.archives'&&s.type==='series'));
  assert(films.folders.flatMap(f=>f.sources).every(s=>s.provider==='addon'&&s.addonId==='com.nuvio.calendar.archives'&&s.type==='movie'));
});

test('future month is prewired for every service',()=>{
  const series=api._internals.resolveArchiveCatalog('archives-v2-series-netflix-2026-12','series',fixedNow,tz);
  const film=api._internals.resolveArchiveCatalog('archives-v2-movie-prime-video-2026-12','movie',fixedNow,tz);
  assert(series&&film);
  assert.equal(calendar.dateWindow(series.period,fixedNow,tz).empty,true);
  assert.equal(calendar.dateWindow(film.period,fixedNow,tz).empty,true);
});

test('reject pre-2025, wrong provider and legacy v1 IDs',()=>{
  assert.equal(api._internals.resolveArchiveCatalog('archives-v2-series-netflix-2024-12','series',fixedNow,tz),null);
  assert.equal(api._internals.resolveArchiveCatalog('archives-v2-series-made-up-2025-01','series',fixedNow,tz),null);
  assert.equal(api._internals.resolveArchiveCatalog('archives-v1-month-2025-01','series',fixedNow,tz),null);
});

test('year card artwork names the selected parent category',()=>{
  assert.match(api._internals.archiveYearCardSvg('2026','series'),/CALENDAR SÉRIES/);
  assert.match(api._internals.archiveYearCardSvg('2026','films'),/CALENDAR FILMS/);
});
