'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/index');
function call(path,headers={}){return new Promise((resolve,reject)=>{const req={method:'GET',url:path,headers:{host:'archives.example','x-forwarded-proto':'https',...headers}};const out={statusCode:200,headers:{},body:Buffer.alloc(0)};const chunks=[];const res={get statusCode(){return out.statusCode},set statusCode(v){out.statusCode=v},setHeader(k,v){out.headers[String(k).toLowerCase()]=v},end(v=''){if(v){chunks.push(Buffer.isBuffer(v)?v:Buffer.from(String(v)))}out.body=Buffer.concat(chunks);out.text=out.body.toString('utf8');resolve(out)},getHeader(k){return out.headers[String(k).toLowerCase()]}};Promise.resolve(handler(req,res)).catch(reject)})}
const tz={'x-vercel-ip-timezone':'Europe/Brussels'};

test('manifest route exposes v1.4 month+year catalogs',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';
  try{
    const r=await call('/manifest.json',tz);assert.equal(r.statusCode,200);const m=JSON.parse(r.text);
    assert.equal(m.version,'1.4.0');assert.equal(m.catalogs.length,648);
    assert(m.catalogs.some(c=>c.name==='Août 2026'&&c.type==='series'));
    assert(!m.catalogs.some(c=>c.name==='Netflix — Août 2026'));
  }finally{delete process.env.NUVIO_NOW_OVERRIDE}
});

test('future September row is already wired and makes zero upstream calls in August',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('must not call upstream')};
  try{const r=await call('/catalog/series/archives-v2-series-netflix-2026-09.json',tz);assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.text),{metas:[]});assert.equal(calls,0)}finally{global.fetch=old;delete process.env.NUVIO_NOW_OVERRIDE}
});

test('prewired 2027 row also makes zero upstream calls while still in 2026',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('must not call upstream')};
  try{const r=await call('/catalog/movie/archives-v2-movie-prime-video-2027-01.json',tz);assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.text),{metas:[]});assert.equal(calls,0)}finally{global.fetch=old;delete process.env.NUVIO_NOW_OVERRIDE}
});

test('old 2025 rows become empty automatically in 2027 so only two years remain visible',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2027-01-05T12:28:00Z';const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('must not call upstream')};
  try{const r=await call('/catalog/series/archives-v2-series-netflix-2025-12.json',tz);assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.text),{metas:[]});assert.equal(calls,0)}finally{global.fetch=old;delete process.env.NUVIO_NOW_OVERRIDE}
});

test('VOD future row is Films-only and zero-upstream',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('must not call upstream')};
  try{const r=await call('/catalog/movie/archives-v2-movie-vod-us-2026-10.json',tz);assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.text),{metas:[]});assert.equal(calls,0)}finally{global.fetch=old;delete process.env.NUVIO_NOW_OVERRIDE}
});

test('collections route is platform parents -> Series/Films cards -> month rows',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';
  try{
    const r=await call('/nuvio-collections.json',tz);assert.equal(r.statusCode,200);const p=JSON.parse(r.text);
    assert.deepEqual(p.map(x=>x.title),['Netflix','Prime Video','Disney+','Max','Apple TV+','Paramount+','Peacock','Hulu','Crunchyroll','VOD']);
    assert.deepEqual(p[0].folders.map(x=>x.title),['Séries','Films']);
    assert.deepEqual(p[8].folders.map(x=>x.title),['Séries']);
    assert.deepEqual(p[9].folders.map(x=>x.title),['Films']);
    assert.equal(p[0].folders[0].sources.length,36);
    assert.equal(p[0].folders[0].sources[16].catalogId,'archives-v2-series-netflix-2026-08');
    assert.equal(p[0].pinToTop,true);
    assert.equal(p[0].folders[0].coverImageUrl,'https://archives.example/platform-category-card.svg?provider=netflix&category=series');
    assert.equal(p[0].folders[1].titleLogoUrl,'https://archives.example/platform-logo?provider=netflix&type=movie');
  }finally{delete process.env.NUVIO_NOW_OVERRIDE}
});

test('blueprint route describes the final native hierarchy',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';
  try{const r=await call('/archive-blueprint.json',tz);const b=JSON.parse(r.text);assert.equal(b.schema,'nuvio-calendar-archives-blueprint-v1.4.0');assert.equal(b.hierarchy,'platform collection -> Series/Films folder -> month+year rows descending -> content');assert.equal(b.visibleRollingYears,2);assert.equal(b.prewiredFutureYears,1);assert.equal(b.platformParents.at(-1),'VOD')}finally{delete process.env.NUVIO_NOW_OVERRIDE}
});

test('modern category-card route still renders a premium card when TMDb credentials are absent',async()=>{
  const oldKey=process.env.TMDB_API_KEY;const oldToken=process.env.TMDB_READ_TOKEN;delete process.env.TMDB_API_KEY;delete process.env.TMDB_READ_TOKEN;
  try{const r=await call('/platform-category-card.svg?provider=netflix&category=series');assert.equal(r.statusCode,200);assert.match(r.headers['content-type'],/image\/svg\+xml/);assert.match(r.text,/SÉRIES/);assert.match(r.text,/Netflix/)}finally{if(oldKey!==undefined)process.env.TMDB_API_KEY=oldKey;if(oldToken!==undefined)process.env.TMDB_READ_TOKEN=oldToken}
});

test('platform backdrop route renders platform-branded Modern artwork',async()=>{
  const oldKey=process.env.TMDB_API_KEY;const oldToken=process.env.TMDB_READ_TOKEN;delete process.env.TMDB_API_KEY;delete process.env.TMDB_READ_TOKEN;
  try{const r=await call('/platform-backdrop.svg?provider=disney-plus&type=movie');assert.equal(r.statusCode,200);assert.match(r.text,/Disney\+/);assert.match(r.text,/CALENDAR ARCHIVES/)}finally{if(oldKey!==undefined)process.env.TMDB_API_KEY=oldKey;if(oldToken!==undefined)process.env.TMDB_READ_TOKEN=oldToken}
});
