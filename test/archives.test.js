'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const calendar=require('../src/calendar');
const api=require('../api/index');

const fixedNow=new Date('2026-08-24T12:28:00Z');
const fixedSepNow=new Date('2026-09-01T12:28:00Z');
const fixedJan2027=new Date('2027-01-05T12:28:00Z');
const tz='Europe/Brussels';

function collection(title, now=fixedNow, origin='https://archives.example'){
  return api._internals.buildNuvioCollectionsImport(now,tz,origin).find(c=>c.title===title);
}
function folder(parent,title){return parent.folders.find(f=>f.title===title)}

test('archive month windows are complete/current/future aware',()=>{
  assert.deepEqual(calendar.dateWindow('archive-2025-02',fixedNow,tz),{start:'2025-02-01',end:'2025-02-28',kind:'archive-month',today:'2026-08-24',allowPast:true,empty:false,archiveYear:2025,archiveMonth:2});
  assert.equal(calendar.dateWindow('archive-2026-08',fixedNow,tz).end,'2026-08-24');
  assert.equal(calendar.dateWindow('archive-2026-09',fixedNow,tz).empty,true);
  assert.equal(calendar.dateWindow('archive-2026-09',fixedSepNow,tz).empty,false);
});

test('prewire includes previous, current and next year for rollover without monthly reimport',()=>{
  assert.deepEqual(api._internals.archivePrewiredYears(fixedNow,tz),[2027,2026,2025]);
  assert.equal(api._internals.archiveYearIsVisible(2027,fixedNow,tz),false);
  assert.equal(api._internals.archiveYearIsVisible(2026,fixedNow,tz),true);
  assert.equal(api._internals.archiveYearIsVisible(2025,fixedNow,tz),true);
  assert.equal(api._internals.archiveYearIsVisible(2025,fixedJan2027,tz),false);
  assert.equal(api._internals.archiveYearIsVisible(2027,fixedJan2027,tz),true);
});

test('manifest catalogs are month+year rows, not provider-prefixed rows',()=>{
  const e=api._internals.buildArchiveCatalogEntries(fixedNow,tz);
  const perYear=12*(api._internals.ARCHIVE_SERIES_PROVIDERS.length+api._internals.ARCHIVE_FILM_PROVIDERS.length);
  assert.equal(e.length,perYear*3);
  const aug=e.find(x=>x.id==='archives-v2-series-netflix-2026-08');
  assert.equal(aug.catalog.name,'Août 2026');
  assert.equal(aug.catalog.cardProvider,'Netflix');
  assert.equal(e.find(x=>x.id==='archives-v2-movie-vod-us-2025-12').catalog.name,'Décembre 2025');
});

test('VOD is a Films-only platform',()=>{
  const vod=api._internals.resolveArchiveCatalog('archives-v2-movie-vod-us-2026-08','movie',fixedNow,tz);
  assert(vod);
  assert.equal(vod.source,'tmdb-vod');
  assert.equal(vod.name,'Août 2026');
  assert.equal(api._internals.resolveArchiveCatalog('archives-v2-series-vod-us-2026-08','series',fixedNow,tz),null);
});

test('manifest v1.4 stays hidden from normal Home because Collections own the UI',()=>{
  const m=api._internals.buildManifest('https://archives.example',fixedNow,tz);
  assert.equal(m.version,'1.4.0');
  assert.equal(m.catalogs.length,648);
  assert(m.catalogs.every(c=>c.showInHome===false));
  assert(m.catalogs.every(c=>c.extraSupported.includes('skip')));
  assert(m.catalogs.some(c=>c.type==='series'&&c.name==='Août 2026'));
  assert(!m.catalogs.some(c=>c.name==='Netflix — Août 2026'));
});

test('catalog IDs resolve only with the correct Nuvio media type',()=>{
  assert.equal(api._internals.resolveArchiveCatalog('archives-v2-series-netflix-2025-04','series',fixedNow,tz).type,'series');
  assert.equal(api._internals.resolveArchiveCatalog('archives-v2-movie-netflix-2025-04','movie',fixedNow,tz).type,'movie');
  assert.equal(api._internals.resolveArchiveCatalog('archives-v2-series-netflix-2025-04','movie',fixedNow,tz),null);
});

test('Shield Modern decoration keeps real content type and landscape artwork',()=>{
  const meta={id:'tt1234567',type:'movie',name:'Archive Film',poster:'https://image.tmdb.org/t/p/w500/demo.jpg',background:'https://image.tmdb.org/t/p/original/demo-bg.jpg',landscapePoster:'https://image.tmdb.org/t/p/original/demo-bg.jpg',releaseInfo:'4 avr. 2025',released:'2025-04-04',_calendarProvider:'Netflix',_calendarSource:'tmdb-streaming'};
  const c=api._internals.resolveArchiveCatalog('archives-v2-movie-netflix-2025-04','movie',fixedNow,tz);
  const [d]=api._internals.decorateCatalogMetas('https://archives.example',[meta],c,tz);
  assert.equal(d.type,'movie');
  assert.equal(d.posterShape,'landscape');
  assert.match(d.background,/calendar-card\.svg/);
  assert.match(d.releaseInfo,/NETFLIX/);
});

test('Nuvio import has platform names as the 10 parent Collections',()=>{
  const payload=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example');
  assert.deepEqual(payload.map(c=>c.title),['Netflix','Prime Video','Disney+','Max','Apple TV+','Paramount+','Peacock','Hulu','Crunchyroll','VOD']);
  assert.equal(payload.length,10);
  assert(payload.every(c=>c.pinToTop===true&&c.viewMode==='FOLLOW_LAYOUT'&&c.showAllTab===false));
});

test('old v1.3 parent IDs are reused by Netflix and Prime Video for a clean upgrade',()=>{
  const payload=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example');
  assert.equal(payload[0].id,'calendar-archives');
  assert.equal(payload[0].title,'Netflix');
  assert.equal(payload[1].id,'calendar-archives-films');
  assert.equal(payload[1].title,'Prime Video');
});

test('normal streaming parent contains modern Series and Films cards',()=>{
  const netflix=collection('Netflix');
  assert.deepEqual(netflix.folders.map(f=>f.title),['Séries','Films']);
  for(const f of netflix.folders){
    assert.equal(f.tileShape,'LANDSCAPE');
    assert.match(f.coverImageUrl,/platform-category-card\.svg\?provider=netflix&category=(series|films)$/);
    assert.match(f.heroBackdropUrl,/platform-backdrop\.svg\?provider=netflix&type=(series|movie)$/);
    assert.match(f.titleLogoUrl,/platform-logo\?provider=netflix&type=(series|movie)$/);
  }
  assert.match(netflix.backdropImageUrl,/platform-backdrop\.svg\?provider=netflix/);
});

test('Crunchyroll has Series only and VOD has Films only',()=>{
  assert.deepEqual(collection('Crunchyroll').folders.map(f=>f.title),['Séries']);
  assert.deepEqual(collection('VOD').folders.map(f=>f.title),['Films']);
});

test('each folder is months+years descending with next year hidden/prewired',()=>{
  const s=folder(collection('Netflix'),'Séries');
  assert.equal(s.sources.length,36);
  assert.equal(s.sources[0].catalogId,'archives-v2-series-netflix-2027-12');
  assert.equal(s.sources[11].catalogId,'archives-v2-series-netflix-2027-01');
  assert.equal(s.sources[12].catalogId,'archives-v2-series-netflix-2026-12');
  assert.equal(s.sources[16].catalogId,'archives-v2-series-netflix-2026-08');
  assert.equal(s.sources[23].catalogId,'archives-v2-series-netflix-2026-01');
  assert.equal(s.sources[24].catalogId,'archives-v2-series-netflix-2025-12');
  assert.equal(s.sources.at(-1).catalogId,'archives-v2-series-netflix-2025-01');
});

test('folder sources use the addon id and the folder real media type',()=>{
  for(const parent of api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example')){
    for(const f of parent.folders){
      const expected=f.title==='Films'?'movie':'series';
      assert(f.sources.every(s=>s.provider==='addon'&&s.addonId==='com.nuvio.calendar.archives'&&s.type===expected));
    }
  }
});

test('August and September use the exact same Collection import',()=>{
  const august=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example');
  const september=api._internals.buildNuvioCollectionsImport(fixedSepNow,tz,'https://archives.example');
  assert.deepEqual(september,august);
  const ids=folder(august[0],'Séries').sources.map(s=>s.catalogId);
  assert(ids.indexOf('archives-v2-series-netflix-2026-09')<ids.indexOf('archives-v2-series-netflix-2026-08'));
});

test('future current-year and prewired next-year catalogs exist but are date-empty',()=>{
  const sep=api._internals.resolveArchiveCatalog('archives-v2-series-netflix-2026-09','series',fixedNow,tz);
  const y2027=api._internals.resolveArchiveCatalog('archives-v2-movie-netflix-2027-01','movie',fixedNow,tz);
  assert(sep&&y2027);
  assert.equal(calendar.dateWindow(sep.period,fixedNow,tz).empty,true);
  assert.equal(calendar.dateWindow(y2027.period,fixedNow,tz).empty,true);
});

test('modern category artwork can embed a real provider logo image',()=>{
  const fake='data:image/png;base64,AAECAwQ=';
  const svg=api._internals.platformCategoryCardSvg('netflix','series',fake);
  assert.match(svg,/SÉRIES/);
  assert.match(svg,/data:image\/png;base64,AAECAwQ=/);
  assert.match(svg,/#e50914/i);
});

test('modern provider backdrop can embed a real provider logo image',()=>{
  const fake='data:image/png;base64,AAAA';
  const svg=api._internals.platformBackdropSvg('prime-video',fake);
  assert.match(svg,/Prime Video/);
  assert.match(svg,/data:image\/png;base64,AAAA/);
});

test('TMDb watch-provider logo is fetched and converted to an embeddable image asset',async()=>{
  const oldFetch=global.fetch;
  const oldKey=process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY='test-key';
  global.fetch=async(url)=>{
    const u=String(url);
    if(u.includes('/watch/providers/movie')){
      return new Response(JSON.stringify({results:[{provider_id:8,provider_name:'Netflix',logo_path:'/netflix.png'}]}),{status:200,headers:{'content-type':'application/json'}});
    }
    if(u==='https://image.tmdb.org/t/p/w300/netflix.png'){
      return new Response(Uint8Array.from([137,80,78,71]),{status:200,headers:{'content-type':'image/png'}});
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  try{
    const asset=await api._internals.platformLogoAsset('netflix','movie');
    assert(asset);
    assert.equal(asset.contentType,'image/png');
    assert.match(asset.dataUri,/^data:image\/png;base64,/);
  }finally{
    global.fetch=oldFetch;
    if(oldKey===undefined) delete process.env.TMDB_API_KEY; else process.env.TMDB_API_KEY=oldKey;
  }
});

test('invalid provider, pre-2025 and legacy v1 catalog IDs are rejected',()=>{
  assert.equal(api._internals.resolveArchiveCatalog('archives-v2-series-netflix-2024-12','series',fixedNow,tz),null);
  assert.equal(api._internals.resolveArchiveCatalog('archives-v2-series-made-up-2026-01','series',fixedNow,tz),null);
  assert.equal(api._internals.resolveArchiveCatalog('archives-v1-month-2025-01','series',fixedNow,tz),null);
});
