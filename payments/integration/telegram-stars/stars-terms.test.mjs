import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {
  publishedStarsTerms,starsTermsAccepted,recordStarsTermsAcceptance
} from './stars-terms.mjs';

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('./stars-terms-migration.sql',import.meta.url),'utf8'));
  const db={
    prepare(query){
      return {bind(...args){
        const st=sqlite.prepare(query);
        return {
          async first(){return st.get(...args)||null;},
          async run(){return {meta:{changes:st.run(...args).changes}};}
        };
      }};
    }
  };
  return {sqlite,db};
}
test('only an explicit HTTPS policy URL and version are accepted',()=>{
  assert.deepEqual(publishedStarsTerms({
    STARS_TERMS_VERSION:'2026-11-v1',
    STARS_TERMS_URL:'https://example.org/legal/terms'
  }),{version:'2026-11-v1',url:'https://example.org/legal/terms'});
  assert.equal(publishedStarsTerms({}),null);
  assert.equal(publishedStarsTerms({
    STARS_TERMS_VERSION:'v1',STARS_TERMS_URL:'http://example.org/terms'
  }),null);
  assert.equal(publishedStarsTerms({
    STARS_TERMS_VERSION:'v1',STARS_TERMS_URL:'https://user:pass@example.org/terms'
  }),null);
});
test('records a verified buyer agreement only once per version',async()=>{
  const f=fixture(),terms={version:'2026-11-v1'};
  try{
    assert.equal(await starsTermsAccepted(f.db,1234,terms),false);
    const first=await recordStarsTermsAcceptance(f.db,1234,terms,1794000000000);
    assert.deepEqual(first,{accepted:true,version:terms.version,alreadyAccepted:false});
    const retry=await recordStarsTermsAcceptance(f.db,1234,terms,1794000000001);
    assert.equal(retry.alreadyAccepted,true);
    assert.equal(await starsTermsAccepted(f.db,1234,terms),true);
    assert.equal(await starsTermsAccepted(f.db,5678,terms),false);
    assert.equal(await starsTermsAccepted(f.db,1234,{version:'2026-12-v2'}),false);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM rustup_stars_terms_acceptances').get().n,1);
  }finally{f.sqlite.close();}
});
test('refuses invalid accounts or timestamps',async()=>{
  const f=fixture();
  try{
    await assert.rejects(()=>recordStarsTermsAcceptance(f.db,0,{version:'v10'}),/invalid/);
    await assert.rejects(()=>recordStarsTermsAcceptance(f.db,1,{version:'v10'},0),/invalid/);
    await assert.rejects(()=>recordStarsTermsAcceptance(f.db,1,{version:'?'},1794000000000),/invalid/);
  }finally{f.sqlite.close();}
});
