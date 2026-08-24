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

test('one combined catalog per month from current year to 2025',()=>{
  const e=api._internals.buildArchiveCatalogEntries(fixedNow,tz);
  assert.equal(e.length,24);
  assert.equal(e[0].id,'archives-v1-month-2026-01');
  assert.equal(e.at(-1).id,'archives-v1-month-2025-12');
  assert(e.every(x=>x.catalog.section==='archive-month'));
});

test('manifest is separate, hidden from normal Home, and has 24 monthly catalogs',()=>{
  const m=api._internals.buildManifest('https://archives.example',fixedNow,tz);
  assert.equal(m.id,'com.nuvio.calendar.archives');
  assert.equal(m.version,'1.1.0');
  assert.equal(m.catalogs.length,24);
  assert(m.catalogs.every(c=>c.type==='series'));
  assert(m.catalogs.every(c=>c.showInHome===false));
  assert(m.catalogs.every(c=>c.extraSupported.includes('skip')));
});

test('combined month contains all four archive families',()=>{
  const c=api._internals.resolveArchiveCatalog('archives-v1-month-2025-04','series',fixedNow,tz);
  const leaves=api._internals.combinedLeafCatalogs(c);
  assert.equal(leaves.length,20);
  assert(leaves.some(x=>x.type==='series'&&x.section==='series-streaming'));
  assert(leaves.some(x=>x.type==='movie'&&x.section==='films'&&x.source==='tmdb-streaming'));
  assert(leaves.some(x=>x.source==='tmdb-vod'));
  assert(leaves.some(x=>x.source==='anilist-airing'));
  assert(leaves.some(x=>x.source==='tvmaze-broadcast'));
});

test('mixed month merge preserves movie and series meta types',()=>{
  const results=[
    {leaf:{type:'movie',name:'Netflix',source:'tmdb-streaming'},result:{metas:[{id:'ttm',type:'movie',name:'Film',released:'2025-04-02'}]}},
    {leaf:{type:'series',name:'TV USA',source:'tvmaze-broadcast'},result:{metas:[{id:'tts',type:'series',name:'Series',released:'2025-04-03'}]}}
  ];
  const metas=api._internals.mergeCombinedMetas(results,'series','archive-2025-04');
  assert.deepEqual(new Set(metas.map(x=>x.type)),new Set(['movie','series']));
});

test('Shield Modern decoration is forced for archive months',()=>{
  assert.equal(api._internals.isHomeCalendarPeriod('archive-2025-04'),true);
  const meta={id:'tt1234567',type:'movie',name:'Archive Film',poster:'https://image.tmdb.org/t/p/w500/demo.jpg',background:'https://image.tmdb.org/t/p/original/demo-bg.jpg',landscapePoster:'https://image.tmdb.org/t/p/original/demo-bg.jpg',releaseInfo:'4 avr. 2025',released:'2025-04-04',_calendarProvider:'Netflix',_calendarSource:'tmdb-digital'};
  const c=api._internals.resolveArchiveCatalog('archives-v1-month-2025-04','series',fixedNow,tz);
  const [d]=api._internals.decorateCatalogMetas('https://archives.example',[meta],c,tz);
  assert.equal(d.type,'movie');
  assert.equal(d.posterShape,'landscape');
  assert.match(d.background,/calendar-card\.svg/);
  assert.match(d.logo,/calendar-transparent-logo\.svg/);
  assert.match(d.releaseInfo,/NETFLIX/);
});

test('future month can be prewired and is empty',()=>{
  const c=api._internals.resolveArchiveCatalog('archives-v1-month-2026-12','series',fixedNow,tz);
  assert(c);
  assert.equal(calendar.dateWindow(c.period,fixedNow,tz).empty,true);
});

test('reject pre-2025, wrong type and old four-section ids',()=>{
  assert.equal(api._internals.resolveArchiveCatalog('archives-v1-month-2024-12','series',fixedNow,tz),null);
  assert.equal(api._internals.resolveArchiveCatalog('archives-v1-month-2025-01','movie',fixedNow,tz),null);
  assert.equal(api._internals.resolveArchiveCatalog('archives-v1-series-2025-01','series',fixedNow,tz),null);
});

test('Nuvio import payload is a top-level collection array',()=>{
  const payload=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example');
  assert(Array.isArray(payload));
  assert.equal(payload.length,1);
  assert.equal(payload[0].id,'calendar-archives');
  assert.equal(payload[0].viewMode,'FOLLOW_LAYOUT');
  assert.equal(payload[0].showAllTab,false);
});

test('year folders are 2026 and 2025 with exactly 12 native rows each',()=>{
  const [collection]=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example');
  assert.deepEqual(collection.folders.map(f=>f.title),['2026','2025']);
  assert(collection.folders.every(f=>f.sources.length===12));
  assert(collection.folders.every(f=>f.catalogSources.length===12));
});

test('folder sources point to installed addon id and transport type',()=>{
  const [collection]=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example');
  const sources=collection.folders.flatMap(f=>f.sources);
  assert(sources.every(s=>s.provider==='addon'));
  assert(sources.every(s=>s.addonId==='com.nuvio.calendar.archives'));
  assert(sources.every(s=>s.type==='series'));
  assert.equal(sources[0].catalogId,'archives-v1-month-2026-01');
});

test('year cards use landscape covers on deployed import',()=>{
  const [collection]=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example');
  assert(collection.folders.every(f=>f.tileShape==='LANDSCAPE'));
  assert.equal(collection.folders[0].coverImageUrl,'https://archives.example/archive-year-card.svg?year=2026');
  assert.match(api._internals.archiveYearCardSvg('2026'),/>2026<\/text>/);
});
