import test from 'node:test';
import assert from 'node:assert/strict';
import {
 parseOfficialCbrUsd,parseMirrorCbrUsd,readIndependentlyConfirmedRubUsdRate
} from './trusted-rub-usd.mjs';

const now=Date.parse('2026-11-06T12:00:00Z');
const xml=(rate='80,0900',date='06.11.2026')=>
 '<?xml version="1.0" encoding="windows-1251"?>'+
 '<ValCurs Date="'+date+'" name="Foreign Currency Market">'+
 '<Valute ID="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode>'+
 '<Nominal>1</Nominal><Name>US Dollar</Name><Value>'+rate+
 '</Value></Valute></ValCurs>';
const mirror=(rate=80.1,date='2026-11-06T11:30:00+03:00')=>
 JSON.stringify({Date:date,Valute:{USD:{CharCode:'USD',Nominal:1,Value:rate}}});
function mockFetch(a,b){
 return async url=>{
  const body=url.includes('cbr.ru/scripts')?a:b;
  return {ok:true,async text(){return body;}};
 };
}
test('two fresh CBR sources yield the conservative validated integer rate',async()=>{
 assert.equal(parseOfficialCbrUsd(xml(),now),8009);
 assert.equal(parseMirrorCbrUsd(mirror(),now),8010);
 const result=await readIndependentlyConfirmedRubUsdRate(mockFetch(xml(),mirror()),now);
 assert.equal(result.rubPerUsdMinor,8009);
 assert.equal(result.sourcesVerified,2);
 assert.equal(result.marketDataFallbackUsed,false);
});
test('different or stale rates cannot silently fall back to fixed 81 RUB per USD',async()=>{
 await assert.rejects(()=>readIndependentlyConfirmedRubUsdRate(
  mockFetch(xml('80,1000'),mirror(93.2)),now),/sources_disagree/);
 assert.throws(()=>parseOfficialCbrUsd(xml('80,0100','20.10.2026'),now),/stale/);
 assert.throws(()=>parseMirrorCbrUsd(mirror(80.1,'2026-10-01T10:00:00Z'),now),/stale/);
 assert.throws(()=>parseOfficialCbrUsd(xml('0,0100'),now),/invalid|out_of_range/);
 assert.throws(()=>parseMirrorCbrUsd('{}',now),/mirror_invalid/);
});
test('incomplete or forged official CBR source blocks payments',async()=>{
 await assert.rejects(()=>readIndependentlyConfirmedRubUsdRate(
  async url=>({ok:url.includes('cbr.ru/scripts'),
   async text(){return xml();}}),now),/source_unavailable/);
 assert.throws(()=>parseOfficialCbrUsd(xml().replace(
  '<CharCode>USD</CharCode>','<CharCode>EUR</CharCode>'),now),/usd_missing/);
 assert.throws(()=>parseOfficialCbrUsd(xml().replace(
  '<Nominal>1</Nominal>','<Nominal>10</Nominal>'),now),/nominal/);
});
