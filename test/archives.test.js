'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const calendar=require('../src/calendar'); const api=require('../api/index');
const fixedNow=new Date('2026-08-24T12:28:00Z');

test('archive windows',()=>{
  assert.deepEqual(calendar.dateWindow('archive-2025-02',fixedNow,'Europe/Brussels'),{start:'2025-02-01',end:'2025-02-28',kind:'archive-month',today:'2026-08-24',allowPast:true,empty:false,archiveYear:2025,archiveMonth:2});
  assert.deepEqual(calendar.dateWindow('archive-2026-08',fixedNow,'Europe/Brussels'),{start:'2026-08-01',end:'2026-08-24',kind:'archive-month',today:'2026-08-24',allowPast:true,empty:false,archiveYear:2026,archiveMonth:8});
  assert.equal(calendar.dateWindow('archive-2026-09',fixedNow,'Europe/Brussels').empty,true);
});

test('dynamic catalogs from current year to 2025 with 12 predeclared months',()=>{
  const e=api._internals.buildArchiveCatalogEntries(fixedNow,'Europe/Brussels');
  assert.equal(e.length,96); assert.equal(e[0].id,'archives-v1-series-2026-01'); assert.equal(e.at(-1).id,'archives-v1-tvusa-2025-12'); assert(e.some(x=>x.id==='archives-v1-films-2026-12'));
});

test('separate manifest and no normal Home clutter',()=>{
  const m=api._internals.buildManifest('https://archives.example',fixedNow,'Europe/Brussels');
  assert.equal(m.id,'com.nuvio.calendar.archives'); assert.equal(m.catalogs.length,96); assert(m.catalogs.every(c=>c.showInHome===false)); assert(m.catalogs.every(c=>c.extraSupported.includes('skip')));
});

test('source isolation',()=>{
  const s=api._internals.resolveArchiveCatalog('archives-v1-series-2025-04','series',fixedNow,'Europe/Brussels');
  const f=api._internals.resolveArchiveCatalog('archives-v1-films-2025-04','movie',fixedNow,'Europe/Brussels');
  const a=api._internals.resolveArchiveCatalog('archives-v1-anime-2025-04','series',fixedNow,'Europe/Brussels');
  const t=api._internals.resolveArchiveCatalog('archives-v1-tvusa-2025-04','series',fixedNow,'Europe/Brussels');
  assert.equal(s.section,'series-streaming'); assert.equal(f.section,'films'); assert.equal(a.section,'anime'); assert.equal(t.section,'tvusa');
  assert.equal(api._internals.combinedLeafCatalogs(s).some(x=>x.source==='tvmaze-broadcast'),false);
  assert.deepEqual(api._internals.combinedLeafCatalogs(a).map(x=>x.source).sort(),['anilist-airing','tmdb-streaming'].sort());
  assert.deepEqual(api._internals.combinedLeafCatalogs(t).map(x=>x.source),['tvmaze-broadcast']);
});

test('Shield Modern decoration is forced for archive months',()=>{
  assert.equal(api._internals.isHomeCalendarPeriod('archive-2025-04'),true);
  const meta={id:'tt1234567',type:'movie',name:'Archive Film',poster:'https://image.tmdb.org/t/p/w500/demo.jpg',background:'https://image.tmdb.org/t/p/original/demo-bg.jpg',landscapePoster:'https://image.tmdb.org/t/p/original/demo-bg.jpg',releaseInfo:'4 avr. 2025',released:'2025-04-04',_calendarProvider:'Netflix',_calendarSource:'tmdb-digital'};
  const c=api._internals.resolveArchiveCatalog('archives-v1-films-2025-04','movie',fixedNow,'Europe/Brussels');
  const [d]=api._internals.decorateCatalogMetas('https://archives.example',[meta],c,'Europe/Brussels');
  assert.equal(d.posterShape,'landscape'); assert.match(d.background,/calendar-card\.svg/); assert.match(d.logo,/calendar-transparent-logo\.svg/); assert.match(d.releaseInfo,/NETFLIX/);
});

test('future month can be prewired and is empty',()=>{
  const c=api._internals.resolveArchiveCatalog('archives-v1-series-2026-12','series',fixedNow,'Europe/Brussels'); assert(c); assert.equal(calendar.dateWindow(c.period,fixedNow,'Europe/Brussels').empty,true);
});

test('reject pre-2025 and wrong type',()=>{
  assert.equal(api._internals.resolveArchiveCatalog('archives-v1-series-2024-12','series',fixedNow,'Europe/Brussels'),null); assert.equal(api._internals.resolveArchiveCatalog('archives-v1-films-2025-01','series',fixedNow,'Europe/Brussels'),null);
});

test('blueprint has year folders with all 48 monthly section sources',()=>{
  const b=api._internals.buildArchiveBlueprint(fixedNow,'Europe/Brussels'); assert.equal(b.collection.viewMode,'FOLLOW_LAYOUT'); assert.deepEqual(b.collection.folders.map(f=>f.title),['2026','2025']); assert.equal(b.collection.folders[0].sources.length,48); assert.equal(b.collection.folders[1].sources.length,48);
});
