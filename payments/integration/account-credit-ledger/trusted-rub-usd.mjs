// RUST UP: strictly validated RUB/USD reference for a new, immutable quote.
// Never use the game's fallback of 81 RUB/USD for real paid conversion.
// Two independent HTTPS endpoints must agree and both publish fresh dates.
// No live checkout imports this module yet.
const CBR='https://www.cbr.ru/scripts/XML_daily.asp';
const MIRROR='https://www.cbr-xml-daily.ru/daily_json.js';
const FIVE_DAYS=5*24*60*60*1000;
function asMinor(raw){
 if(typeof raw!=='string'||!/^[1-9]\d{0,2}[.,]\d{1,4}$/.test(raw))
  throw Error('rub_usd_rate_invalid');
 const [whole,fraction]=raw.replace(',','.').split('.');
 const four=fraction.padEnd(4,'0');
 const rate=BigInt(whole)*100n+BigInt(four.slice(0,2))+
  (Number(four[2])>=5?1n:0n);
 if(rate<1000n||rate>50000n)
  throw Error('rub_usd_rate_out_of_range');
 return Number(rate);
}
function freshness(date,now){
 if(!Number.isSafeInteger(now)||now<1||
    !Number.isFinite(date)||date>now+86400000||now-date>FIVE_DAYS)
  throw Error('rub_usd_reference_stale');
}
export function parseOfficialCbrUsd(xml,now=Date.now()){
 if(typeof xml!=='string'||xml.length<100||xml.length>300000)
  throw Error('cbr_feed_invalid');
 const date=/\bDate="(\d{2})\.(\d{2})\.(\d{4})"/i.exec(xml);
 if(!date)throw Error('cbr_reference_date_missing');
 const timestamp=Date.UTC(Number(date[3]),Number(date[2])-1,Number(date[1]));
 freshness(timestamp,now);
 const entries=xml.match(/<Valute\b[^>]*>[\s\S]*?<\/Valute>/gi)||[];
 const usd=entries.filter(x=>/<CharCode>USD<\/CharCode>/i.test(x));
 if(usd.length!==1)throw Error('cbr_usd_missing_or_ambiguous');
 const nominal=/<Nominal>(\d+)<\/Nominal>/i.exec(usd[0]);
 const value=/<Value>([\d,.]+)<\/Value>/i.exec(usd[0]);
 if(nominal?.[1]!=='1'||!value)throw Error('cbr_usd_nominal_invalid');
 return asMinor(value[1]);
}
export function parseMirrorCbrUsd(json,now=Date.now()){
 let feed;
 try{feed=JSON.parse(json);}catch{throw Error('cbr_mirror_invalid_json');}
 if(!feed||typeof feed!=='object'||feed.Valute?.USD?.CharCode!=='USD'||
    feed.Valute.USD.Nominal!==1||
    !Number.isFinite(feed.Valute.USD.Value))
  throw Error('cbr_mirror_invalid');
 freshness(Date.parse(feed.Date),now);
 const minor=asMinor(String(feed.Valute.USD.Value));
 return minor;
}
async function getText(url,fetchImpl){
 const response=await fetchImpl(url,{
  method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),
  headers:{accept:'application/xml,application/json;q=0.9,text/plain;q=0.8'}
 });
 if(!response?.ok)throw Error('cbr_rate_source_unavailable');
 const text=await response.text();
 if(text.length>300000)throw Error('cbr_rate_source_too_large');
 return text;
}
export async function readIndependentlyConfirmedRubUsdRate(fetchImpl=fetch,now=Date.now()){
 const [official,mirror]=await Promise.all([
  getText(CBR,fetchImpl),getText(MIRROR,fetchImpl)
 ]);
 const a=parseOfficialCbrUsd(official,now);
 const b=parseMirrorCbrUsd(mirror,now);
 // 1% maximum deviation. Never quietly prefer a single feed.
 if(BigInt(Math.abs(a-b))*100n>BigInt(Math.min(a,b)))
  throw Error('rub_usd_sources_disagree');
 // The smaller reference yields fewer paid game units, avoiding over-credit.
 return Object.freeze({rubPerUsdMinor:Math.min(a,b),
  officialRateMinor:a,mirrorRateMinor:b,observedAtMs:now,
  sourcesVerified:2,marketDataFallbackUsed:false});
}
