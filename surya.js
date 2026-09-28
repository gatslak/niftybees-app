// =====================================================================
// SURYA — the NIFTYBEES app's built-in stock-market assistant.
//
// Runs 100% in the browser: no API key, no server, no running cost.
// • Answers investment / days / returns / charges / MTF / tax / risk
//   questions, explains market terms, tells market timings & holidays,
//   and looks up ANY stock, index, ETF, commodity or currency (live
//   quote, technicals, returns, comparisons) via the app's own proxy.
// • Text replies follow the header toggle (English default · हिंदी ·
//   Hinglish); spoken questions are language-detected automatically.
//
// It REUSES the app's own formulas and live state (legBreakdown,
// BROKERS, computeBreakevenExitPrice, computeExitPriceForTargetPct,
// livePrice, fetchViaProxy…) so its numbers match the calculator.
// Loaded after app.js (WordPress) or the inline app script (GitHub Pages).
// =====================================================================
(function(){
'use strict';
if (window.__suryaLoaded) return;
window.__suryaLoaded = true;

// ---------------------------------------------------------------------
// 1. Bridges into the app (all guarded — Surya still works for generic
//    maths even if the app failed to load).
// ---------------------------------------------------------------------
const APP = {
  live(){
    try { if (typeof livePrice !== 'undefined' && livePrice) return livePrice; } catch(e){}
    const t = txt('price-value').replace(/[^\d.]/g,'');
    const v = parseFloat(t); return v > 0 ? v : null;
  },
  brokers(){ try { if (typeof BROKERS !== 'undefined') return BROKERS; } catch(e){} return FALLBACK_BROKERS; },
  leg(value, isBuy, broker, intraday){
    try { if (typeof legBreakdown === 'function') return legBreakdown(value, isBuy, broker, intraday); } catch(e){}
    return fallbackLeg(value, isBuy, broker, intraday);
  },
  breakeven(isLong, units, value, entryCh, interest, broker, intraday){
    try { if (typeof computeBreakevenExitPrice === 'function') return computeBreakevenExitPrice(isLong, units, value, entryCh, interest, broker, intraday); } catch(e){}
    return solveExit(isLong, units, value, entryCh, interest, broker, intraday, 0);
  },
  targetExit(isLong, units, value, entryCh, interest, broker, intraday, capital, pct){
    try { if (typeof computeExitPriceForTargetPct === 'function') return computeExitPriceForTargetPct(isLong, units, value, entryCh, interest, broker, intraday, capital, pct); } catch(e){}
    return solveExit(isLong, units, value, entryCh, interest, broker, intraday, capital*pct/100);
  },
  broker(){ const el = document.getElementById('holdings-broker'); return (el && el.value) || 'angelone'; },
  mode(){
    try {
      if (typeof holdingsMode !== 'undefined' && holdingsMode === 'short') return 'short';
      if (typeof holdingsSubMode !== 'undefined' && holdingsSubMode) return holdingsSubMode;
    } catch(e){}
    return 'delivery';
  },
  refresh(){ try { if (typeof runAll === 'function') { runAll(); return true; } } catch(e){} return false; },
};

// Same statutory schedule as app.js — only used if app.js is missing.
const FALLBACK_BROKERS = {
  angelone:     { label:'Angel One', mtfRate:14.99, deliveryBrokerage:v=>Math.max(Math.min(0.001*v,20),5), intradayBrokerage:v=>Math.max(Math.min(0.001*v,20),5) },
  kotakneo_pro: { label:'Kotak Neo (Trade Free Pro)', mtfRate:9.69, deliveryBrokerage:v=>0.001*v, intradayBrokerage:v=>Math.min(10,0.0005*v) },
  kotakneo_std: { label:'Kotak Neo (Trade Free Plan)', mtfRate:14.99, deliveryBrokerage:v=>0.002*v, intradayBrokerage:v=>Math.min(10,0.0005*v) },
};
function fallbackLeg(value, isBuy, broker, intraday){
  const B = APP.brokers()[broker] || FALLBACK_BROKERS.angelone;
  const brokerage = (intraday ? B.intradayBrokerage : B.deliveryBrokerage)(value);
  const exchange = 0.0000307*value, sebi = value/1e6, ipft = value/1e6;
  let stt, stamp, dp;
  if (intraday){ stt = isBuy?0:0.00025*value; stamp = isBuy?0.00003*value:0; dp = 0; }
  else { stt = 0.001*value; stamp = isBuy?0.00015*value:0; dp = isBuy?0:23.60; }
  const gst = 0.18*(brokerage+exchange+sebi+ipft);
  return { brokerage, stt, exchange, sebi, ipft, stamp, dp, gst, total: brokerage+stt+exchange+sebi+ipft+stamp+dp+gst };
}
function solveExit(isLong, units, value, entryCh, interest, broker, intraday, target){
  if (!units || !value) return 0;
  const net = p => { const ev = units*p; const g = isLong ? ev-value : value-ev; return g - entryCh - APP.leg(ev, !isLong, broker, intraday).total - interest; };
  const avg = value/units; let lo, hi;
  if (isLong){ lo = avg; hi = avg*3; } else { lo = avg*0.01; hi = avg; }
  for (let i=0;i<80;i++){ const mid=(lo+hi)/2, v=net(mid); if (isLong){ if (v<target) lo=mid; else hi=mid; } else { if (v<target) hi=mid; else lo=mid; } }
  return (lo+hi)/2;
}

function txt(id){ const el = document.getElementById(id); return el ? (el.textContent||'').replace(/\s+/g,' ').trim() : ''; }
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }


// ---------------------------------------------------------------------
// 2. Language
//    TEXT  : the header toggle (EN default · हिंदी · Hinglish) decides the
//            reply language for anything typed.
//    VOICE : always auto-detected from what was spoken (Hindi / English /
//            Hinglish) — the reply is shown in that language and read
//            aloud (Hinglish is read aloud in Hindi so it sounds natural).
// ---------------------------------------------------------------------
let LANG = 'en';                     // language of the CURRENT reply
let TEXTLANG = 'en';                 // header toggle: en | hi | hn
try { const v = localStorage.getItem('surya-text-lang'); if (v === 'en' || v === 'hi' || v === 'hn') TEXTLANG = v; } catch(e){}

const DEV_G = new RegExp('[\\u0900-\\u097F]', 'g');
const L = (en, hi, hn) => LANG === 'hi' ? hi : LANG === 'hn' ? (hn != null ? hn : en) : en;

const HN_WORDS = /\b(kya|kitna|kitne|kitni|hai|hain|hoga|hogi|karu|karun|karoon|karna|mera|meri|mere|aaj|abhi|din|saal|mahine|paise|rupaye|lagau|lagaun|lagana|lagaye|bechu|bechun|becho|kharidu|kharidun|kharida|munafa|fayda|faida|nuksan|nuksaan|batao|bata|bataye|chahiye|milega|milegi|kaisa|kaise|kab|kaunsa|kaunsi|bhav|bhaav|ka|ki|ke|ko|se|pe|par|mein|mai|tak|baad|wala|wali|agar|toh|sakta|sakte|raha|rahi|bhai|yaar|dijiye|batana|chal|gaya|gira|badha|upar|neeche)\b/gi;
function detectLang(s){
  const dev = (s.match(DEV_G) || []).length;
  const letters = s.replace(/[^A-Za-z]/g, '').length + dev;
  if (!letters) return 'en';
  const share = dev / letters;
  if (share >= 0.6) return 'hi';
  if (share > 0.08) return 'hn';                      // mixed script = Hinglish
  const hits = (s.match(HN_WORDS) || []).length;
  const words = s.trim().split(/\s+/).length;
  if (hits >= 2 || (hits === 1 && words <= 3)) return 'hn';
  return 'en';
}


// ---------------------------------------------------------------------
// 3. Formatting (Indian grouping)
// ---------------------------------------------------------------------
const inr  = (n, dp=2) => (n<0?'-':'') + '₹' + Math.abs(n).toLocaleString('en-IN',{minimumFractionDigits:dp, maximumFractionDigits:dp});
const inr0 = n => inr(n, 0);
const num  = (n, dp=0) => n.toLocaleString('en-IN',{minimumFractionDigits:dp, maximumFractionDigits:dp});
const sgn  = (n, dp=2) => (n>0?'+':'') + n.toFixed(dp) + '%';
function inrShort(n){
  const a = Math.abs(n), s = n<0?'-':'';
  if (a >= 1e7) return s + '₹' + (a/1e7).toLocaleString('en-IN',{maximumFractionDigits:2}) + L(' crore',' करोड़',' crore');
  if (a >= 1e5) return s + '₹' + (a/1e5).toLocaleString('en-IN',{maximumFractionDigits:2}) + L(' lakh',' लाख',' lakh');
  return inr0(n);
}
const cls = n => n >= 0 ? 'up' : 'down';
const fmtDate = d => d.toLocaleDateString(LANG==='hi'?'hi-IN':'en-IN', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
function modeLabel(m){
  return { delivery: L('Delivery','डिलीवरी','Delivery'), intraday: L('Intraday','इंट्राडे','Intraday'),
           mtf: L('MTF (5×)','MTF (5×)','MTF (5×)'), short: L('Short · Intraday','शॉर्ट · इंट्राडे','Short · Intraday') }[m] || m;
}
const brokerLabel = k => (APP.brokers()[k] || {}).label || k;
const DISCLAIMER = () => `<div class="s-fine">${L('Not investment advice — a calculation from the numbers shown.','निवेश सलाह नहीं — दिखाए गए आँकड़ों से केवल गणना।','Investment advice nahi hai — sirf calculation hai.')}</div>`;

// ---------------------------------------------------------------------
// 4. Parsing
// ---------------------------------------------------------------------
const MONTHS = [
  ['january','jan','जनवरी'], ['february','feb','फरवरी','फ़रवरी'], ['march','mar','मार्च'], ['april','apr','अप्रैल','अप्रेल'],
  ['may','मई'], ['june','jun','जून'], ['july','jul','जुलाई'], ['august','aug','अगस्त'],
  ['september','sept','sep','सितंबर','सितम्बर'], ['october','oct','अक्टूबर','अक्तूबर'], ['november','nov','नवंबर','नवम्बर'], ['december','dec','दिसंबर','दिसम्बर'],
];
const MONTH_RX = MONTHS.flat().sort((a,b)=>b.length-a.length).join('|');
function monthIndex(w){ w = w.toLowerCase(); return MONTHS.findIndex(list => list.includes(w)); }
function today0(){ const d = new Date(); d.setHours(0,0,0,0); return d; }

function normalize(raw){
  let s = ' ' + raw.replace(/[०-९]/g, d => '०१२३४५६७८९'.indexOf(d)).toLowerCase() + ' ';
  s = s.replace(/(\d),(?=\d)/g, '$1');                         // 1,00,000 -> 100000
  s = s.replace(/₹\s{0,}/g, ' rs ').replace(/\brs\.\s{0,}/g, ' rs ').replace(/\binr\b/g,' rs ');
  s = s.replace(/(डेढ़|डेढ|\bdedh\b|\bderh\b)/g, ' 1.5 ').replace(/(ढाई|\bdhai\b|\bdhaai\b)/g, ' 2.5 ');
  const END = '(?![a-z\\u0900-\\u097F])';
  s = s.replace(new RegExp('(\\d+(?:\\.\\d+)?)\\s*(crores?|cr|करोड़|करोड|karod|karor|crore)'+END,'g'), (m,n)=>' '+(+n*1e7)+' rs ');
  s = s.replace(new RegExp('(\\d+(?:\\.\\d+)?)\\s*(lakhs?|lacs?|lakh|l|लाख|lac)'+END,'g'), (m,n)=>' '+(+n*1e5)+' rs ');
  s = s.replace(new RegExp('(\\d+(?:\\.\\d+)?)\\s*(k|thousand|hazar|hazaar|hajar|हज़ार|हजार)'+END,'g'), (m,n)=>' '+(+n*1e3)+' ');
  s = s.replace(new RegExp('(\\d+(?:\\.\\d+)?)\\s*(sau|सौ|hundred)'+END,'g'), (m,n)=>' '+(+n*100)+' ');
  return s.replace(/\s+/g,' ');
}

function extractDates(s){
  const dates = []; const t = today0();
  const push = (y,m,d) => { const dt = new Date(y, m, d); if (!isNaN(dt) && dt.getMonth()===m) dates.push(dt); };
  const yr = y => y ? (y < 100 ? 2000 + +y : +y) : t.getFullYear();
  s = s.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m,y,mo,d)=>{ push(+y,+mo-1,+d); return ' § '; });
  s = s.replace(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g, (m,d,mo,y)=>{ push(yr(y),+mo-1,+d); return ' § '; });
  s = s.replace(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s*)?('+MONTH_RX+')(?![a-z])(?:\\s*,?\\s*(\\d{4}))?','g'), (m,d,mo,y)=>{ push(yr(y),monthIndex(mo),+d); return ' § '; });
  s = s.replace(new RegExp('(?:^|\\s)('+MONTH_RX+')\\s*(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:\\s*,?\\s*(\\d{4}))?','g'), (m,mo,d,y)=>{ push(yr(y),monthIndex(mo),+d); return ' § '; });
  let hasToday = false;
  s = s.replace(/\b(today|aaj|abhi tak|till now|now)\b|आज/g, m => { hasToday = true; return ' '; });
  return { dates, rest: s, hasToday };
}

const RX = {
  pct:      /^\s*(%|percent|per cent|pct|pratishat|prateeshat|प्रतिशत|फीसदी|फ़ीसदी|feesadi|fisadi)/,
  days:     /^\s*(?:(?:trading|working|market|karobari|कारोबारी)\s+)?(days?\b|din\b|dino\b|dinon\b|दिन|d\b)/,
  weeks:    /^\s*(weeks?\b|hafte\b|hafta\b|हफ्ते|हफ़्ते|हफ्ता|सप्ताह)/,
  months:   /^\s*(months?\b|mahine\b|mahina\b|mahino\b|महीने|महीना|महीनों)/,
  years:    /^\s*(years?\b|yrs?\b|saal\b|sal\b|साल|वर्ष|varsh\b|baras\b)/,
  units:    /^\s*(units?\b|shares?\b|qty\b|quantity\b|यूनिट|शेयर|nos\b|niftybees|nifty bees|bees\b)/,
  qtyAt:    /^\s*(@|at\b|x\b|×|\*)\s*(rs\s*)?\d/,
  rupeeAft: /^\s*(rs\b|rupees?\b|rupaye\b|rupaiye\b|rupay\b|रुपये|रुपए|रुपया|रूपये)/,
  rupeeBef: /\brs\s*$/,
  atBef:    /(@|\bat|\bpe|\bpar|पर|\bprice|\brate|\bbhav|\bbhaav|भाव|\bof|\bse|से)\s*(rs\s*)?$/,
  atAft:    /^\s*(pe\b|par\b|पर|ke bhav|ke rate|के भाव|वाले)/,
  buyBef:   /(\bbuy|\bbought|\bkharid\S*|खरीद\S*|\bentry|\benter\S*|\bavg|\baverage|\bliya|\bliye|लिया|लिए|\bcost)\D{0,12}$/,
  sellBef:  /(\bsell\S*|\bsold|\bbech\S*|बेच\S*|\bexit|\btarget|\btgt|\bnikal\S*|\bto\b|\btak\b|तक|\bthen)\D{0,12}$/,
  buyAft:   /^\s*(pe|par|पर|@|at)?\s*(liye|liya|lia|le liye|kharid\S*|खरीद\S*|लिए|लिया|liye the|buy\S*|bought|entry)/,
  sellAft:  /^\s*(pe|par|पर|@|at)?\s*(bech\S*|बेच\S*|sell\S*|sold|nikal\S*|निकाल\S*|exit|target)/,
  slBef:    /(\bsl|\bstop ?loss|\bstoploss|\bstop|स्टॉप ?लॉस)\s*(at|@|pe|par|of|is|=|:|-)?\s*(rs\s*)?$/,
  investBef:/(\binvest\S*|\blaga\S*|लगा\S*|\bnivesh|निवेश|\bcapital|\bwith|\bpaas|पास|\bfund|\bportfolio)\s*(rs\s*)?$/,
};

function extract(raw){
  let s = normalize(raw);
  const d = extractDates(s);
  s = d.rest;
  const E = { amounts:[], units:[], prices:[], pcts:[], nums:[], seq:[], pairs:[], dur:{days:0,weeks:0,months:0,years:0,has:false},
              dates:d.dates, hasToday:d.hasToday, s, raw, sl:null };
  const ref = APP.live() || 280;
  const re = /(\d+(?:\.\d+)?)/g; let m; let lastUnit = null;
  while ((m = re.exec(s))){
    const v = parseFloat(m[1]);
    const a = s.slice(re.lastIndex, re.lastIndex + 24);
    const b = s.slice(Math.max(0, m.index - 24), m.index);
    const push = (kind) => { E.seq.push({ v, kind }); };
    if (RX.pct.test(a))    { E.pcts.push(v); push('pct'); continue; }
    if (RX.days.test(a))   { E.dur.days += v; E.dur.has = true; push('dur'); continue; }
    if (RX.weeks.test(a))  { E.dur.weeks += v; E.dur.has = true; push('dur'); continue; }
    if (RX.months.test(a)) { E.dur.months += v; E.dur.has = true; push('dur'); continue; }
    if (RX.years.test(a))  { E.dur.years += v; E.dur.has = true; push('dur'); continue; }
    if (RX.units.test(a) || RX.qtyAt.test(a)) { E.units.push(v); lastUnit = v; push('units'); continue; }
    if (RX.slBef.test(b)) { E.sl = v; push('sl'); continue; }
    const rupee = RX.rupeeAft.test(a) || RX.rupeeBef.test(b);
    const atP   = RX.atBef.test(b) || RX.atAft.test(a) || RX.buyAft.test(a) || RX.sellAft.test(a);
    const role  = RX.sellAft.test(a) ? 'exit' : RX.buyAft.test(a) ? 'entry' : RX.sellBef.test(b) ? 'exit' : RX.buyBef.test(b) ? 'entry' : null;
    const inRange = v >= ref*0.5 && v <= ref*2;
    if (lastUnit != null && atP){ E.pairs.push({ units: lastUnit, price: v }); lastUnit = null; }
    if (RX.investBef.test(b) && !inRange) { E.amounts.push(v); push('amount'); continue; }
    if ((atP || role) && v <= ref*5 && v >= ref*0.2) { E.prices.push({ v, role }); push('price'); continue; }
    if (inRange && !RX.investBef.test(b)) { E.prices.push({ v, role }); push('price'); continue; }
    if (rupee || v >= 1000) { E.amounts.push(v); push('amount'); continue; }
    E.nums.push(v); push('num');
  }
  // roles: explicit first, then order
  const entry = E.prices.find(p => p.role === 'entry') || E.prices.find(p => p.role !== 'exit');
  const exit  = E.prices.find(p => p.role === 'exit' && p !== entry) || E.prices.find(p => p !== entry);
  E.entry = entry ? entry.v : null;
  E.exit  = exit  ? exit.v  : null;
  E.years = E.dur.years + E.dur.months/12 + E.dur.weeks/52 + E.dur.days/365;
  E.days  = E.dur.days + E.dur.weeks*7 + E.dur.months*30 + E.dur.years*365;
  // plain numbers in the order typed (anything that isn't a %, a duration or units)
  E.vals = E.seq.filter(x => x.kind === 'price' || x.kind === 'amount' || x.kind === 'num' || x.kind === 'sl').map(x => x.v);
  // broker / mode
  if (/angel/.test(s)) E.broker = 'angelone';
  else if (/kotak/.test(s) && /\bpro\b|trade free pro/.test(s)) E.broker = 'kotakneo_pro';
  else if (/kotak/.test(s)) E.broker = 'kotakneo_std';
  if (/\bmtf\b|margin|leverage|\b5x\b|\b5 x\b|उधार/.test(s)) E.mode = 'mtf';
  else if (/\bshort\b|shorting|शॉर्ट/.test(s)) E.mode = 'short';
  else if (/intraday|intra day|इंट्राडे|same day|aaj hi/.test(s)) E.mode = 'intraday';
  else if (/delivery|डिलीवरी|\bcnc\b|long term|lambe/.test(s)) E.mode = 'delivery';
  return E;
}


// ---------------------------------------------------------------------
// 5. Core trade maths (mirrors computeHoldings() in app.js)
// ---------------------------------------------------------------------
function trade({ units, entry, exit, mode, broker, days, targetPct }){
  const isLong = mode !== 'short';
  const intraday = mode === 'intraday' || mode === 'short';
  const lev = mode === 'mtf' ? 5 : 1;
  const realUnits = units * lev;
  const value = realUnits * entry;
  const capital = units * entry;
  const borrowed = mode === 'mtf' ? capital * 4 : 0;
  const rate = (APP.brokers()[broker] || {}).mtfRate || 0;
  const dailyInt = mode === 'mtf' ? borrowed * rate/100/365 : 0;
  const interest = dailyInt * (days || 0);
  const entryLeg = APP.leg(value, isLong, broker, intraday);
  const r = { isLong, intraday, lev, realUnits, value, capital, borrowed, rate, dailyInt, interest, entryLeg, days: days||0 };
  r.breakeven = APP.breakeven(isLong, realUnits, value, entryLeg.total, interest, broker, intraday);
  if (targetPct) r.target = APP.targetExit(isLong, realUnits, value, entryLeg.total, interest, broker, intraday, capital, targetPct);
  if (exit){
    const ev = realUnits * exit;
    r.exitLeg = APP.leg(ev, !isLong, broker, intraday);
    r.gross = isLong ? ev - value : value - ev;
    r.charges = entryLeg.total + r.exitLeg.total + interest;
    r.net = r.gross - r.charges;
    r.netPct = r.net / capital * 100;
    if (mode === 'mtf' && dailyInt > 0){
      const beforeInt = r.gross - entryLeg.total - r.exitLeg.total;
      r.maxDays = beforeInt > 0 ? Math.floor(beforeInt / dailyInt) : 0;
    }
  }
  return r;
}

// ---------------------------------------------------------------------
// 6. Handlers — each returns { html, actions? }
// ---------------------------------------------------------------------
const row = (k, v, c='') => `<div class="s-row"><span>${k}</span><b class="${c}">${v}</b></div>`;
const noPrice = () => ({
  html: L('The live NIFTYBEES price isn\'t loaded yet, so I need a price. Tap <b>Refresh</b> below, or include one — e.g. <i>"invest 50,000 at 285"</i>.',
          'NIFTYBEES का लाइव भाव अभी लोड नहीं हुआ है। नीचे <b>Refresh</b> दबाएँ, या भाव साथ में लिखें — जैसे <i>"50000 लगाऊँ 285 पर"</i>।',
          'Live price abhi load nahi hua. Neeche <b>Refresh</b> dabayein, ya price saath mein likhein — jaise <i>"50000 lagau 285 pe"</i>.'),
  actions: [{ label: L('Refresh prices','भाव रिफ्रेश करें','Refresh karo'), run: () => { APP.refresh(); return L('Refreshing all sources… ask me again in ~15 seconds.','सभी स्रोत रिफ्रेश हो रहे हैं… ~15 सेकंड बाद फिर पूछें।','Refresh ho raha hai… 15 second baad phir poochho.'); } }],
});

function fillCalculatorAction(p){
  return { label: L('Load into calculator ↓','कैलकुलेटर में भरें ↓','Calculator mein bharo ↓'), run: () => {
    try {
      const sc = document.getElementById('holdings-slot-count');
      if (sc){ sc.value = '1'; if (typeof setHoldingsSlotCount === 'function') setHoldingsSlotCount(); }
      if (typeof setHoldingsMode === 'function') setHoldingsMode(p.mode === 'short' ? 'short' : 'long');
      if (p.mode !== 'short' && typeof setHoldingsSubMode === 'function') setHoldingsSubMode(p.mode);
      const br = document.getElementById('holdings-broker'); if (br && p.broker) br.value = p.broker;
      const r1 = document.querySelector('.holdings-row[data-slot="1"]');
      if (r1){ r1.querySelector('.h-units').value = p.units; r1.querySelector('.h-price').value = p.entry; }
      if (p.mode === 'mtf'){ const md = document.getElementById('holdings-mtf-days'); if (md) md.value = p.days || 1; }
      const ex = document.getElementById('holdings-exit-price'); if (ex) ex.value = p.exit ? p.exit : '';
      if (typeof setExitMode === 'function') setExitMode('price');
      const tg = document.getElementById('holdings-target-pct'); if (tg) tg.value = p.targetPct || '';
      if (typeof computeHoldings === 'function') computeHoldings();
      const sum = document.getElementById('holdings-summary');
      if (sum) sum.scrollIntoView({ behavior:'smooth', block:'center' });
      if (window.innerWidth < 600) closePanel();
      return L('Done — the calculator below now shows this trade.','हो गया — नीचे कैलकुलेटर में यह ट्रेड भर दिया है।','Ho gaya — neeche calculator mein bhar diya.');
    } catch(e){ return L('Couldn\'t reach the calculator on this page.','इस पेज पर कैलकुलेटर नहीं मिला।','Is page par calculator nahi mila.'); }
  }};
}

function hPrice(){
  const p = APP.live();
  if (!p) return noPrice();
  const pct = txt('price-pct'), sub = txt('sub-price');
  return { html:
    `${L('NIFTYBEES live price','NIFTYBEES का लाइव भाव','NIFTYBEES ka live bhav')}: <b class="s-big">${inr(p)}</b> <span class="${pct.startsWith('-')?'down':'up'}">${esc(pct)}</span>` +
    (sub && !/fail/i.test(sub) ? `<div class="s-fine">${esc(sub)}</div>` : '') };
}

function hBias(){
  const verdict = txt('verdictText'), score = txt('scoreLine');
  if (!verdict || /tap refresh|no data/i.test(verdict)) return {
    html: L('The pre-market bias hasn\'t been run yet.','प्री-मार्केट बायस अभी चलाया नहीं गया है।','Pre-market bias abhi run nahi hua.'),
    actions: noPrice().actions };
  const items = [['val-gift', L('GIFT Nifty gap','GIFT निफ्टी गैप','GIFT Nifty gap')], ['val-preopen', L('NSE pre-open','NSE प्री-ओपन','NSE pre-open')],
                 ['val-us', L('US (Dow/Nasdaq)','अमेरिका (Dow/Nasdaq)','US (Dow/Nasdaq)')], ['val-asia', L('Asia','एशिया','Asia')],
                 ['val-fx', 'USD/INR'], ['val-vix', 'India VIX']];
  const verdictLocal = LANG === 'en' ? verdict :
    /bull/i.test(verdict) ? L('','तेजी की ओर झुकाव','Bullish (tezi) lean') : /bear/i.test(verdict) ? L('','मंदी की ओर झुकाव','Bearish (mandi) lean') : L('','सपाट / न्यूट्रल','Neutral / flat');
  let h = `${L('Pre-market bias','प्री-मार्केट बायस','Pre-market bias')}: <b class="${/bull/i.test(verdict)?'up':/bear/i.test(verdict)?'down':''}">${esc(verdictLocal)}</b><div class="s-fine">${esc(score)}</div>`;
  items.forEach(([id, lab]) => { const v = txt(id); if (v && !/^[-—\s]+$/.test(v) && !/pending|refreshing/i.test(v)) h += row(lab, esc(v)); });
  h += `<div class="s-fine">${L('A weighted lean from these signals — not a prediction. Confirm against the 9:15 open.','इन संकेतों का भारित झुकाव — भविष्यवाणी नहीं। 9:15 की ओपनिंग से पुष्टि करें।','Ye signals ka weighted lean hai — prediction nahi. 9:15 open se confirm karein.')}</div>`;
  return { html: h };
}

function hSignal(){
  const chip = (txt('predChip').match(/BUY|SELL|HOLD/) || [''])[0];
  if (!chip) return { html: L('The 30–60 min signal hasn\'t loaded yet.','30–60 मिनट का सिग्नल अभी लोड नहीं हुआ।','30–60 min signal abhi load nahi hua.'), actions: noPrice().actions };
  const chipLocal = LANG === 'en' ? chip : ({BUY:L('','खरीद (BUY)','BUY (kharid)'), SELL:L('','बिक्री (SELL)','SELL (bikri)'), HOLD:L('','रुकें (HOLD)','HOLD (ruko)')}[chip] || chip);
  let h = `${L('30–60 min signal','30–60 मिनट सिग्नल','30–60 min signal')}: <b class="${chip==='BUY'?'up':chip==='SELL'?'down':''}">${esc(chipLocal)}</b> · ${esc(txt('predConf'))}`;
  const m30 = txt('predMid30'), b30 = txt('predBand30'), m60 = txt('predMid60'), b60 = txt('predBand60');
  if (m30 && m30 !== '—') h += row(L('Projected ~30 min','~30 मिनट अनुमान','~30 min projection'), esc(m30) + (b30?` <span class="s-fine">(${esc(b30)})</span>`:''));
  if (m60 && m60 !== '—') h += row(L('Projected ~60 min','~60 मिनट अनुमान','~60 min projection'), esc(m60) + (b60?` <span class="s-fine">(${esc(b60)})</span>`:''));
  const day = txt('predDayBias'), wk = txt('predWeekBias');
  if (day && day !== '—') h += row(L('Today','आज','Aaj'), esc(day));
  if (wk && wk !== '—') h += row(L('This week','इस हफ्ते','Is hafte'), esc(wk));
  h += `<div class="s-fine">${L('A statistical read of price & volume, not a guarantee. Treat it as one input only.','कीमत और वॉल्यूम का सांख्यिकीय आकलन, गारंटी नहीं। इसे केवल एक संकेत मानें।','Price-volume ka statistical read hai, guarantee nahi. Sirf ek input maano.')}</div>`;
  return { html: h };
}

function hNews(){
  const box = document.getElementById('val-news');
  const links = box ? [...box.querySelectorAll('a')].slice(0,5) : [];
  if (!links.length) return { html: L('Headlines aren\'t loaded yet.','हेडलाइंस अभी लोड नहीं हुईं।','Headlines abhi load nahi hui.'), actions: noPrice().actions };
  return { html: `<b>${L('Top market headlines','मुख्य बाज़ार समाचार','Top market headlines')}</b><ul class="s-list">` +
    links.map(a => `<li><a href="${esc(a.href)}" target="_blank" rel="noopener">${esc(a.textContent.trim().replace(/&amp;/g,'&'))}</a></li>`).join('') + '</ul>' };
}

function hHoldings(){
  const box = document.getElementById('holdings-summary');
  const avg = box && box.querySelector('.hs-avg');
  if (!avg) return { html: L('Your holdings calculator is empty. Fill it below (or upload an order screenshot) — or just ask me, e.g. <i>"500 units at 280, profit at 292?"</i>',
                             'आपका होल्डिंग्स कैलकुलेटर खाली है। नीचे भरें (या ऑर्डर स्क्रीनशॉट अपलोड करें) — या मुझसे पूछें, जैसे <i>"500 यूनिट 280 पर, 292 पर मुनाफ़ा?"</i>',
                             'Holdings calculator khali hai. Neeche bharo (ya order screenshot upload karo) — ya mujhse poochho, jaise <i>"500 units 280 pe liye, 292 pe profit?"</i>') };
  let h = `<b>${L('From your calculator','आपके कैलकुलेटर से','Aapke calculator se')}</b>`;
  h += row(L('Average price','औसत भाव','Average price'), esc(avg.textContent.trim()));
  const be = box.querySelector('.hs-breakeven .gold'); if (be) h += row(L('Breakeven exit','ब्रेकईवन एग्ज़िट','Breakeven exit'), esc(be.textContent.trim()));
  const tg = box.querySelector('.hs-target-exit .purple'); if (tg) h += row(L('Target exit','टारगेट एग्ज़िट','Target exit'), esc(tg.textContent.trim()));
  box.querySelectorAll('.hs-row').forEach(r => {
    const k = r.querySelector('.lbl'), v = r.querySelector('.val');
    if (k && v && /net|total charges/i.test(k.textContent)) h += row(esc(k.textContent.trim()), esc(v.textContent.trim()), v.classList.contains('bear')?'down':v.classList.contains('bull')?'up':'');
  });
  return { html: h };
}

function resolveMode(E){ return E.mode || APP.mode(); }
function resolveBroker(E){ return E.broker || APP.broker(); }

function hInvest(E){
  const price = E.entry || APP.live();
  if (!price) return noPrice();
  const amount = E.amounts[0];
  const mode = resolveMode(E), broker = resolveBroker(E);
  const intraday = mode === 'intraday' || mode === 'short';
  const lev = mode === 'mtf' ? 5 : 1;
  let units = Math.floor(amount / price);
  // leave room for entry charges out of the same cash
  while (units > 0 && units*price + APP.leg(units*lev*price, mode!=='short', broker, intraday).total > amount) units--;
  if (units < 1) return { html: L(`${inr0(amount)} isn't enough for even 1 unit at ${inr(price)} after charges.`, `${inr0(amount)} में ${inr(price)} पर चार्ज के बाद 1 यूनिट भी नहीं आएगा।`, `${inr0(amount)} mein ${inr(price)} pe charges ke baad 1 unit bhi nahi aayega.`) };
  const t = trade({ units, entry: price, mode, broker, days: E.days || (mode==='mtf'?1:0), targetPct: E.pcts[0] });
  let h = `${L('With','','')} <b>${inr0(amount)}</b> ${L('at','पर','pe')} <b>${inr(price)}</b>${E.entry?'':` <span class="s-fine">(${L('live','लाइव','live')})</span>`} · ${modeLabel(mode)}, ${esc(brokerLabel(broker))}:`;
  if (mode === 'mtf'){
    h += row(L('Your units (your money)','आपके यूनिट (अपना पैसा)','Aapke units (apna paisa)'), num(units));
    h += row(L('Position with 5× leverage','5× लीवरेज के साथ पोज़िशन','5× leverage position'), `<b>${num(t.realUnits)} ${L('units','यूनिट','units')}</b> · ${inr0(t.value)}`);
    h += row(L('Borrowed from broker','ब्रोकर से उधार','Broker se udhaar'), inr0(t.borrowed));
    h += row(L(`Interest @ ${t.rate}% p.a.`,`ब्याज @ ${t.rate}% सालाना`,`Interest @ ${t.rate}% saalana`), `${inr(t.dailyInt)}/${L('day','दिन','din')}`);
  } else {
    h += row(L('Units you can buy','आप खरीद सकते हैं','Aap le sakte ho'), `<b>${num(units)} ${L('units','यूनिट','units')}</b>`);
    h += row(L('Cost','लागत','Cost'), inr(t.value));
  }
  h += row(L('Entry charges','खरीद पर चार्ज','Entry charges'), inr(t.entryLeg.total));
  h += row(L('Cash left over','बची राशि','Bacha paisa'), inr(amount - t.capital - t.entryLeg.total));
  h += row(L('Breakeven sell price','ब्रेकईवन बिक्री भाव','Breakeven sell price'), `<b class="gold">${inr(t.breakeven)}</b> <span class="s-fine">(${sgn((t.breakeven/price-1)*100)})</span>`);
  if (t.target) h += row(L(`Exit for ${E.pcts[0]}% net profit`,`${E.pcts[0]}% शुद्ध मुनाफ़े के लिए भाव`,`${E.pcts[0]}% net profit ke liye exit`), `<b class="purple">${inr(t.target)}</b>`);
  h += DISCLAIMER();
  return { html: h, actions: [fillCalculatorAction({ units, entry: price, mode, broker, days: t.days||1, targetPct: E.pcts[0] })] };
}

function pageHoldings(){
  let u = 0, v = 0;
  document.querySelectorAll('.holdings-row').forEach(r => {
    if (r.style.display === 'none') return;
    const a = parseFloat((r.querySelector('.h-units')||{}).value), p = parseFloat((r.querySelector('.h-price')||{}).value);
    if (a > 0 && p > 0){ u += a; v += a*p; }
  });
  return u ? { units: u, entry: v/u } : null;
}
function needUnitsAndEntry(E){
  let entry = E.entry || null;
  let units = E.units[0] || null;
  if (!entry && !units && !E.amounts.length){ const ph = pageHoldings(); if (ph){ E.fromPage = true; return ph; } }
  if (!units && E.amounts[0] && (entry || APP.live())) units = Math.floor(E.amounts[0] / (entry || APP.live()));
  if (!units && E.nums.length) units = E.nums.find(n => Number.isInteger(n) && n > 0) || null;
  return { units, entry };
}

function hPnl(E){
  let { units, entry } = needUnitsAndEntry(E);
  let exit = E.exit;
  if (!entry) return { html: L('Tell me the buy price too — e.g. <i>"500 units bought at 280, sell at 292"</i>.','खरीद भाव भी बताएँ — जैसे <i>"500 यूनिट 280 पर खरीदे, 292 पर बेचें"</i>।','Buy price bhi batao — jaise <i>"500 units 280 pe liye, 292 pe becha"</i>.') };
  if (!units) return { html: L('How many units? e.g. <i>"500 units at 280, sell 292"</i>.','कितने यूनिट? जैसे <i>"500 यूनिट 280 पर, 292 पर बेचें"</i>।','Kitne units? Jaise <i>"500 units 280 pe, 292 pe becho"</i>.') };
  let liveExit = false;
  if (!exit){ exit = APP.live(); liveExit = true; if (!exit) return noPrice(); }
  const mode = resolveMode(E), broker = resolveBroker(E);
  let days = E.days; if (mode === 'mtf' && !days && E.dates.length) days = Math.round((today0()-E.dates[0])/864e5);
  const t = trade({ units, entry, exit, mode, broker, days: days || (mode==='mtf'?1:0), targetPct: E.pcts[0] });
  let h = (E.fromPage ? `<div class="s-fine">${L('Using the position in your calculator below.','नीचे कैलकुलेटर की पोज़िशन ली है।','Neeche calculator ki position li hai.')}</div>` : '') + `<b>${num(units)}</b>${mode==='mtf'?' (×5 = '+num(t.realUnits)+')':''} ${L('units','यूनिट','units')} · ${inr(entry)} → ${inr(exit)}${liveExit?` <span class="s-fine">(${L('live','लाइव','live')})</span>`:''}<div class="s-fine">${modeLabel(mode)}, ${esc(brokerLabel(broker))}</div>`;
  h += row(L('Gross P&L','सकल लाभ/हानि','Gross P&L'), (t.gross>=0?'+':'')+inr(t.gross), cls(t.gross));
  h += row(L('Entry + exit charges','खरीद + बिक्री चार्ज','Entry + exit charges'), '-'+inr(t.entryLeg.total + t.exitLeg.total));
  if (mode === 'mtf') h += row(L(`MTF interest (${t.days} d)`,`MTF ब्याज (${t.days} दिन)`,`MTF interest (${t.days} din)`), '-'+inr(t.interest));
  h += row(`<b>${L('Net P&L','शुद्ध लाभ/हानि','Net P&L')}</b>`, `<span class="s-big">${t.net>=0?'+':''}${inr(t.net)}</span>`, cls(t.net));
  h += row(L(mode==='mtf'?'Net return on your capital':'Net return','शुद्ध रिटर्न','Net return'), sgn(t.netPct), cls(t.netPct));
  h += row(L('Breakeven exit','ब्रेकईवन भाव','Breakeven exit'), `<span class="gold">${inr(t.breakeven)}</span>`);
  if (t.target) h += row(L(`Exit for ${E.pcts[0]}% net`,`${E.pcts[0]}% शुद्ध के लिए`,`${E.pcts[0]}% net ke liye`), `<span class="purple">${inr(t.target)}</span>`);
  if (t.maxDays != null) h += `<div class="s-warn">${t.maxDays>0
      ? L(`At this exit, MTF interest (${inr(t.dailyInt)}/day) wipes out the profit after ~<b>${t.maxDays} days</b>.`, `इस भाव पर MTF ब्याज (${inr(t.dailyInt)}/दिन) ~<b>${t.maxDays} दिन</b> में मुनाफ़ा खत्म कर देगा।`, `Is exit pe MTF interest (${inr(t.dailyInt)}/din) ~<b>${t.maxDays} din</b> mein profit kha jayega.`)
      : L('Charges alone exceed the gross profit at this exit.','इस भाव पर केवल चार्ज ही सकल मुनाफ़े से ज़्यादा हैं।','Is exit pe charges hi gross profit se zyada hain.')}</div>`;
  h += DISCLAIMER();
  return { html: h, actions: [fillCalculatorAction({ units, entry, exit: liveExit ? null : exit, mode, broker, days: t.days||1, targetPct: E.pcts[0] })] };
}

function hBreakevenOrTarget(E, wantTarget){
  let { units, entry } = needUnitsAndEntry(E);
  if (!entry && !units && !E.amounts.length){
    // nothing given — read the page's own calculator if filled
    if (document.querySelector('#holdings-summary .hs-avg')) return hHoldings();
  }
  entry = entry || APP.live();
  if (!entry) return noPrice();
  let assumed = false;
  if (!units){ units = Math.max(1, Math.floor(100000/entry)); assumed = true; }
  const mode = resolveMode(E), broker = resolveBroker(E);
  const pct = E.pcts[0];
  if (wantTarget && !pct) return { html: L('What net profit % do you want? e.g. <i>"exit price for 2% profit, bought 500 at 280"</i>.','कितना % शुद्ध मुनाफ़ा चाहिए? जैसे <i>"2% मुनाफ़े के लिए भाव, 500 यूनिट 280 पर"</i>।','Kitna % net profit chahiye? Jaise <i>"2% profit ke liye exit, 500 units 280 pe"</i>.') };
  const t = trade({ units, entry, mode, broker, days: E.days || (mode==='mtf'?1:0), targetPct: pct });
  let h = `${num(units)} ${L('units at','यूनिट @','units @')} ${inr(entry)} · ${modeLabel(mode)}, ${esc(brokerLabel(broker))}${mode==='mtf'?` · ${t.days} ${L('day(s) interest','दिन ब्याज','din interest')}`:''}`;
  if (assumed) h += `<div class="s-fine">${L('Assumed ~₹1 lakh position — tell me your units for an exact figure.','~₹1 लाख की पोज़िशन मानी है — सटीक आँकड़े के लिए यूनिट बताएँ।','~₹1 lakh position maana hai — exact ke liye units batao.')}</div>`;
  h += row(L('Breakeven exit (no profit, no loss)','ब्रेकईवन (न लाभ, न हानि)','Breakeven (na profit, na loss)'), `<b class="gold">${inr(t.breakeven)}</b> <span class="s-fine">(${sgn((t.breakeven/entry-1)*100)})</span>`);
  if (pct){
    if (t.target > 0) h += row(L(`Exit for ${pct}% net profit (after all fees & taxes)`,`${pct}% शुद्ध मुनाफ़े का भाव (सभी शुल्क व टैक्स के बाद)`,`${pct}% net profit ka exit (sab fees & tax ke baad)`), `<b class="purple">${inr(t.target)}</b> <span class="s-fine">(${sgn((t.target/entry-1)*100)} ${L('move','चाल','move')})</span>`);
    else h += `<div class="s-warn">${L('No valid exit price for that target — try a smaller %.','उस टारगेट के लिए कोई भाव नहीं मिला — छोटा % आज़माएँ।','Us target ke liye price nahi mila — chhota % try karo.')}</div>`;
    const net = t.target > 0 ? t.capital*pct/100 : 0;
    if (net) h += row(L('That is a net profit of','यानी शुद्ध मुनाफ़ा','Yaani net profit'), inr(net), 'up');
  }
  h += DISCLAIMER();
  return { html: h, actions: [fillCalculatorAction({ units, entry, mode, broker, days: t.days||1, targetPct: pct })] };
}

function hMtf(E){
  const broker = resolveBroker(E);
  const B = APP.brokers()[broker] || {};
  let days = E.days;
  if (!days && E.dates.length) days = Math.max(0, Math.round((today0()-E.dates[0])/864e5));
  const price = E.entry || APP.live();
  let units = E.units[0];
  let capital = E.amounts[0] || (units && price ? units*price : 0);
  if (E.exit || (units && E.entry)) return hPnl(Object.assign(E, { mode: 'mtf', days: days || E.days }));
  if (!capital){
    // explain MTF with the broker's rate
    return { html: L(`<b>MTF (Margin Trading Facility)</b>: you pay ~1/5, the broker funds the other 4/5 and charges interest daily. ${esc(B.label)}: <b>${B.mtfRate}% p.a.</b> Ask e.g. <i>"MTF 1 lakh for 10 days interest"</i>.`,
                     `<b>MTF (मार्जिन ट्रेडिंग)</b>: आप ~1/5 देते हैं, बाकी 4/5 ब्रोकर देता है और रोज़ ब्याज लगता है। ${esc(B.label)}: <b>${B.mtfRate}% सालाना</b>। पूछें जैसे <i>"MTF 1 लाख 10 दिन का ब्याज"</i>।`,
                     `<b>MTF</b>: aap ~1/5 dete ho, baaki 4/5 broker deta hai aur roz interest lagta hai. ${esc(B.label)}: <b>${B.mtfRate}% saalana</b>. Poochho jaise <i>"MTF 1 lakh 10 din ka interest"</i>.`) };
  }
  if (!days) days = 1;
  const borrowed = capital * 4, daily = borrowed * B.mtfRate/100/365, total = daily * days;
  let h = `MTF · ${esc(B.label)} @ <b>${B.mtfRate}%</b> ${L('p.a.','सालाना','saalana')}`;
  h += row(L('Your capital','आपकी पूँजी','Aapki capital'), inr0(capital));
  h += row(L('Position (5×)','पोज़िशन (5×)','Position (5×)'), inr0(capital*5));
  h += row(L('Borrowed (4×)','उधार (4×)','Udhaar (4×)'), inr0(borrowed));
  h += row(L('Interest per day','प्रतिदिन ब्याज','Roz ka interest'), inr(daily));
  h += row(`<b>${L(`Interest for ${days} day${days===1?'':'s'}`,`${days} दिन का ब्याज`,`${days} din ka interest`)}</b>`, `<b class="down">${inr(total)}</b>`);
  h += row(L('Price move needed just to cover interest','सिर्फ़ ब्याज निकालने को ज़रूरी चाल','Sirf interest cover karne ko move'), sgn(total/(capital*5)*100, 3));
  h += `<div class="s-fine">${L(`If ${inr0(capital)} is the borrowed amount instead, interest = ${inr(capital*B.mtfRate/100/365*days)}.`, `अगर ${inr0(capital)} उधार की राशि है, तो ब्याज = ${inr(capital*B.mtfRate/100/365*days)}।`, `Agar ${inr0(capital)} udhaar ki amount hai, to interest = ${inr(capital*B.mtfRate/100/365*days)}.`)}</div>`;
  if (price) return { html: h + DISCLAIMER(), actions: [fillCalculatorAction({ units: Math.floor(capital/price), entry: price, mode:'mtf', broker, days })] };
  return { html: h + DISCLAIMER() };
}

function hCharges(E){
  const broker = resolveBroker(E), mode = resolveMode(E);
  const intraday = mode === 'intraday' || mode === 'short';
  let value = E.amounts[0] || (E.units[0] && (E.entry || APP.live()) ? E.units[0]*(E.entry||APP.live()) : 0);
  if (mode === 'mtf' && value && !E.units[0]) value *= 5;
  if (!value){
    const B = APP.brokers()[broker];
    let h = `<b>${esc(B.label)} — ${modeLabel(mode)}</b>`;
    let html = '';
    try { if (typeof buildBreakupHTML === 'function') html = buildBreakupHTML(broker, intraday, mode==='mtf' ? B.mtfRate : undefined); } catch(e){}
    if (html){ const tmp = document.createElement('div'); tmp.innerHTML = html;
      tmp.querySelectorAll('li').forEach(li => { const k = li.querySelector('.bk'); if (k){ const kt = k.textContent; h += row(esc(kt.replace(':','')), esc(li.textContent.replace(kt,'').trim())); } }); }
    h += `<div class="s-fine">${L('Ask with an amount for exact rupees — e.g. <i>"charges on ₹1 lakh delivery"</i>.','सटीक राशि के लिए रकम के साथ पूछें — जैसे <i>"1 लाख डिलीवरी पर चार्ज"</i>।','Exact ke liye amount ke saath poochho — jaise <i>"1 lakh delivery pe charges"</i>.')}</div>`;
    return { html: h };
  }
  const buy = APP.leg(value, mode!=='short', broker, intraday), sell = APP.leg(value, mode==='short', broker, intraday);
  const keys = [['brokerage','Brokerage','ब्रोकरेज'],['stt','STT','STT'],['exchange',L('Exchange','एक्सचेंज','Exchange')],['sebi','SEBI'],['ipft','IPFT'],['stamp',L('Stamp duty','स्टांप ड्यूटी','Stamp duty')],['dp',L('DP charge','DP चार्ज','DP charge')],['gst','GST']];
  let h = `${L('Charges on','चार्ज —','Charges —')} <b>${inr0(value)}</b> · ${modeLabel(mode)}, ${esc(brokerLabel(broker))}<table class="s-tbl"><tr><th></th><th>${L('Buy','खरीद','Buy')}</th><th>${L('Sell','बिक्री','Sell')}</th></tr>`;
  keys.forEach(([k, a, b]) => { if (buy[k] || sell[k]) h += `<tr><td>${LANG==='hi' && b ? b : a}</td><td>${inr(buy[k])}</td><td>${inr(sell[k])}</td></tr>`; });
  h += `<tr class="s-tot"><td>${L('Total','कुल','Total')}</td><td>${inr(buy.total)}</td><td>${inr(sell.total)}</td></tr></table>`;
  h += row(`<b>${L('Round trip','आना-जाना कुल','Round trip')}</b>`, `<b>${inr(buy.total+sell.total)}</b> <span class="s-fine">(${((buy.total+sell.total)/value*100).toFixed(3)}%)</span>`);
  return { html: h + DISCLAIMER() };
}

function hCompare(E){
  const mode = E.mode && E.mode !== 'mtf' ? E.mode : 'delivery';
  const intraday = mode === 'intraday' || mode === 'short';
  const value = E.amounts[0] || 100000;
  const rows = Object.entries(APP.brokers()).map(([k, B]) => {
    const tot = APP.leg(value, true, k, intraday).total + APP.leg(value, false, k, intraday).total;
    return { k, B, tot };
  }).sort((a,b) => a.tot - b.tot);
  let h = `${L('Round-trip charges on','आना-जाना चार्ज —','Round-trip charges —')} <b>${inr0(value)}</b> · ${modeLabel(mode)}<table class="s-tbl"><tr><th>${L('Broker','ब्रोकर','Broker')}</th><th>${L('Charges','चार्ज','Charges')}</th><th>MTF</th></tr>`;
  rows.forEach((r,i) => { h += `<tr${i===0?' class="s-best"':''}><td>${esc(r.B.label)}</td><td>${inr(r.tot)}</td><td>${r.B.mtfRate}%</td></tr>`; });
  h += '</table>';
  const pro = APP.brokers().kotakneo_pro;
  if (pro) h += `<div class="s-fine">${L('Kotak Trade Free Pro also has a ₹249 + GST monthly fee.','Kotak Trade Free Pro पर ₹249 + GST मासिक शुल्क भी है।','Kotak Trade Free Pro pe ₹249 + GST monthly fee bhi hai.')}</div>`;
  return { html: h };
}

function hSip(E){
  const P = E.amounts[0] || E.nums.find(n => n >= 100);
  const r = E.pcts[0] != null ? E.pcts[0] : 12;
  const yrs = E.years || 10;
  if (!P) return { html: L('Tell me the monthly amount — e.g. <i>"SIP 5000 per month, 12% for 10 years"</i>.','मासिक राशि बताएँ — जैसे <i>"SIP 5000 हर महीने, 12% पर 10 साल"</i>।','Monthly amount batao — jaise <i>"SIP 5000 har mahine 12% 10 saal"</i>.') };
  const n = Math.round(yrs*12), i = r/12/100;
  const fv = i ? P * ((Math.pow(1+i, n) - 1)/i) * (1+i) : P*n;
  const inv = P*n;
  let h = `SIP <b>${inr0(P)}</b>/${L('month','महीना','mahina')} · ${r}% ${L('p.a.','सालाना','saalana')} · ${+yrs.toFixed(2)} ${L('years','साल','saal')}`;
  if (E.pcts[0] == null) h += `<div class="s-fine">${L('Assumed 12% p.a. — say a % to change it.','12% सालाना माना है — बदलने के लिए % बताएँ।','12% saalana maana hai — % bata ke badlo.')}</div>`;
  h += row(L('You invest','आप लगाएँगे','Aap lagaoge'), inrShort(inv));
  h += row(L('Estimated gains','अनुमानित लाभ','Anumaanit gain'), inrShort(fv-inv), 'up');
  h += row(`<b>${L('Future value','भविष्य मूल्य','Future value')}</b>`, `<b class="s-big up">${inrShort(fv)}</b>`);
  h += `<div class="s-fine">${L('Assumes a constant return compounded monthly; markets don\'t move in straight lines.','स्थिर रिटर्न, मासिक चक्रवृद्धि मानकर; बाज़ार सीधी रेखा में नहीं चलता।','Constant return, monthly compounding maan ke; market seedha nahi chalta.')}</div>`;
  return { html: h };
}

function hFv(E){
  const P = E.amounts[0], r = E.pcts[0], yrs = E.years;
  const fv = P * Math.pow(1 + r/100, yrs);
  let h = `${inrShort(P)} @ ${r}% ${L('p.a. for','सालाना,','saalana,')} ${+yrs.toFixed(2)} ${L('years','साल','saal')}`;
  h += row(`<b>${L('Grows to','बनेगा','Banega')}</b>`, `<b class="s-big up">${inrShort(fv)}</b>`);
  h += row(L('Gain','लाभ','Gain'), inrShort(fv-P), 'up');
  h += row(L('Total growth','कुल वृद्धि','Total growth'), sgn((fv/P-1)*100));
  h += row(L('Simple interest would give','साधारण ब्याज से','Simple interest se'), inrShort(P*(1+r/100*yrs)));
  return { html: h };
}

function hCagr(E){
  const profitCtx = /profit|munafa|gain|kamai|मुनाफ|फायदा|कमाई|earned|kamaya/.test(E.s);
  // 0) "₹5,000 profit on ₹1 lakh in 15 days" → % then annualise
  if (profitCtx && E.amounts.length >= 2 && (E.days || E.dates.length)){
    const [cap, prof] = E.amounts[0] > E.amounts[1] ? E.amounts : [E.amounts[1], E.amounts[0]];
    const days = E.days || Math.abs(Math.round(((E.dates[1]||today0()) - E.dates[0])/864e5));
    const r = hCagr(Object.assign({}, E, { s:'', amounts: [], pcts: [prof/cap*100], days, dates: [] }));
    return { html: `${inrShort(prof)} ${L('on','/','on')} ${inrShort(cap)} = <b>${sgn(prof/cap*100)}</b><br>` + r.html };
  }
  // 1) two amounts + time  → CAGR
  if (E.amounts.length >= 2 && E.years && (E.dur.years || E.dur.months)){
    const [a, b] = E.amounts; const c = (Math.pow(b/a, 1/E.years) - 1)*100;
    return { html: `${inrShort(a)} → ${inrShort(b)} ${L('in','में','mein')} ${+E.years.toFixed(2)} ${L('years','साल','saal')}` +
      row(`<b>CAGR</b>`, `<b class="s-big ${cls(c)}">${sgn(c)}</b>`) + row(L('Absolute return','कुल रिटर्न','Absolute return'), sgn((b/a-1)*100)) };
  }
  // 2) % over N days → annualised
  const p = E.pcts[0];
  let days = E.days;
  if (!days && E.dates.length) days = Math.abs(Math.round(((E.dates[1]||today0()) - E.dates[0])/864e5));
  if (p != null && days){
    const simple = p*365/days, comp = (Math.pow(1+p/100, 365/days)-1)*100;
    return { html: `${sgn(p)} ${L('in','में','mein')} ${days} ${L('days','दिन','din')}` +
      row(L('Annualised (simple)','सालाना (साधारण)','Saalana (simple)'), sgn(simple)) +
      row(`<b>${L('Annualised (compounded)','सालाना (चक्रवृद्धि)','Saalana (compounded)')}</b>`, `<b class="${cls(comp)}">${sgn(comp)}</b>`) +
      `<div class="s-fine">${L('Compounded figure assumes you could repeat the same return back-to-back all year.','चक्रवृद्धि आँकड़ा मानता है कि यही रिटर्न पूरे साल लगातार दोहराया जाए।','Compounded figure maanta hai ki yahi return saal bhar repeat ho.')}</div>` };
  }
  // 3) profit amount on capital over days
  if (E.amounts.length >= 2 && days){
    const [cap, prof] = E.amounts[0] > E.amounts[1] ? E.amounts : [E.amounts[1], E.amounts[0]];
    return hCagr(Object.assign({}, E, { amounts: [], pcts: [prof/cap*100], days }));
  }
  return { html: L('Give me two values and a time (e.g. <i>"1 lakh became 1.6 lakh in 4 years, CAGR?"</i>) or a % and days (e.g. <i>"3% in 20 days annualised"</i>).',
                   'दो राशियाँ और समय बताएँ (जैसे <i>"1 लाख 4 साल में 1.6 लाख, CAGR?"</i>) या % और दिन (जैसे <i>"20 दिन में 3% सालाना कितना"</i>)।',
                   'Do amounts aur time batao (jaise <i>"1 lakh 4 saal mein 1.6 lakh, CAGR?"</i>) ya % aur din (jaise <i>"20 din mein 3% saalana kitna"</i>).') };
}

function hDouble(E){
  const r = E.pcts[0];
  const y = Math.log(2)/Math.log(1+r/100);
  return { html: `${L('At','','')} ${r}% ${L('p.a., money doubles in','सालाना पर पैसा दोगुना होगा','saalana pe paisa double hoga')}` +
    row(`<b>${L('Exact','सटीक','Exact')}</b>`, `<b class="s-big">${y.toFixed(1)} ${L('years','साल','saal')}</b>`) +
    row(L('Rule of 72','72 का नियम','Rule of 72'), `${(72/r).toFixed(1)} ${L('years','साल','saal')}`) };
}

function weekdaysBetween(a, b){ // (a, b]
  let n = 0; const d = new Date(a);
  while (d < b){ d.setDate(d.getDate()+1); const w = d.getDay(); if (w && w !== 6) n++; }
  return n;
}
function hDays(E){
  const t = today0();
  // "N days after/baad" → a date
  if (!E.dates.length && E.days){
    const trading = /trading|कारोबारी|karobari|market days|working/.test(E.s);
    const out = new Date(t); let n = Math.round(E.days);
    if (trading){ while (n > 0){ out.setDate(out.getDate()+1); const w = out.getDay(); if (w && w !== 6) n--; } }
    else out.setDate(out.getDate() + n);
    const back = /pehle|pahle|पहले|before|ago/.test(E.s);
    if (back){ out.setTime(t.getTime()); out.setDate(out.getDate() - Math.round(E.days)); }
    return { html: `${Math.round(E.days)} ${trading?L('trading days','कारोबारी दिन','trading din'):L('days','दिन','din')} ${back?L('before today','पहले','pehle'):L('from today','बाद','baad')}:` +
      row(`<b>${L('Date','तारीख','Date')}</b>`, `<b class="s-big">${esc(fmtDate(out))}</b>`) +
      (trading ? `<div class="s-fine">${L('Skips weekends only — NSE holidays not excluded.','केवल शनिवार-रविवार छोड़े — NSE छुट्टियाँ शामिल नहीं।','Sirf weekend skip kiye — NSE holidays nahi.')}</div>` : '') };
  }
  if (!E.dates.length) return { html: L('Which date? e.g. <i>"days since 15 Aug"</i>, <i>"days between 1/4/2026 and 28/9/2026"</i>, or <i>"45 days from today"</i>.',
                                         'कौन सी तारीख? जैसे <i>"15 अगस्त से आज तक कितने दिन"</i> या <i>"आज से 45 दिन बाद"</i>।',
                                         'Kaunsi date? Jaise <i>"15 aug se aaj tak kitne din"</i> ya <i>"aaj se 45 din baad"</i>.') };
  let a = E.dates[0], b = E.dates[1] || t;
  if (a > b) [a, b] = [b, a];
  const days = Math.round((b - a)/864e5);
  const wd = weekdaysBetween(a, b);
  let h = `${esc(fmtDate(a))} → ${esc(fmtDate(b))}`;
  h += row(`<b>${L('Calendar days','कुल दिन','Total din')}</b>`, `<b class="s-big">${num(days)}</b>`);
  h += row(L('Weekdays (Mon–Fri)','कार्यदिवस (सोम–शुक्र)','Weekdays (Mon–Fri)'), num(wd));
  h += row(L('Weeks + days','हफ्ते + दिन','Hafte + din'), `${Math.floor(days/7)} + ${days%7}`);
  if (days >= 60) h += row(L('Months (approx.)','महीने (लगभग)','Mahine (lagbhag)'), (days/30.44).toFixed(1));
  h += `<div class="s-fine">${L('Weekdays exclude Sat/Sun only, not NSE holidays.','कार्यदिवसों में NSE छुट्टियाँ नहीं घटाई गईं।','Weekdays mein NSE holidays nahi ghataye.')}</div>`;
  // MTF context: offer interest
  if (/mtf|interest|byaj|ब्याज/.test(E.s) && E.amounts[0]) return hMtf(Object.assign(E, { days }));
  return { html: h };
}

// ---------------------------------------------------------------------
// 6b. Market calendar & timings (NSE, IST)
// ---------------------------------------------------------------------
const HOLIDAYS = [ // NSE equity trading holidays 2026 (weekday closures only)
  ['2026-01-15','Municipal Corporation Election (Maharashtra)','महाराष्ट्र नगर निगम चुनाव'],
  ['2026-01-26','Republic Day','गणतंत्र दिवस'],
  ['2026-03-03','Holi','होली'],
  ['2026-03-26','Shri Ram Navami','श्री राम नवमी'],
  ['2026-03-31','Shri Mahavir Jayanti','श्री महावीर जयंती'],
  ['2026-04-03','Good Friday','गुड फ्राइडे'],
  ['2026-04-14','Dr. Baba Saheb Ambedkar Jayanti','डॉ. बाबासाहेब अंबेडकर जयंती'],
  ['2026-05-01','Maharashtra Day','महाराष्ट्र दिवस'],
  ['2026-05-28','Bakri Id','बकरी ईद'],
  ['2026-06-26','Muharram','मुहर्रम'],
  ['2026-09-14','Ganesh Chaturthi','गणेश चतुर्थी'],
  ['2026-10-02','Mahatma Gandhi Jayanti','महात्मा गांधी जयंती'],
  ['2026-10-20','Dussehra','दशहरा'],
  ['2026-11-10','Diwali Balipratipada','दिवाली बलिप्रतिपदा'],
  ['2026-11-24','Guru Nanak Jayanti','गुरु नानक जयंती'],
  ['2026-12-25','Christmas','क्रिसमस'],
];
const MUHURAT = { date:'2026-11-08', en:'Muhurat trading (Diwali Laxmi Pujan) on Sunday, 8 Nov 2026 — timing is announced by NSE closer to the date.', hi:'मुहूर्त ट्रेडिंग (दिवाली लक्ष्मी पूजन) रविवार, 8 नवंबर 2026 को — समय NSE बाद में घोषित करेगा।' };
const HOLI_MAP = Object.fromEntries(HOLIDAYS.map(h => [h[0], h]));
const ymd = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
function istNow(){
  const p = {}; new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false })
    .formatToParts(new Date()).forEach(x => p[x.type] = x.value);
  const d = new Date(+p.year, +p.month-1, +p.day, +p.hour % 24, +p.minute);
  return d;
}
function isTradingDay(d){ const w = d.getDay(); return w !== 0 && w !== 6 && !HOLI_MAP[ymd(d)]; }
function nextTradingDay(d){ const x = new Date(d); x.setHours(0,0,0,0); do { x.setDate(x.getDate()+1); } while (!isTradingDay(x)); return x; }
function hhmm(d){ return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }

function marketStatus(){
  const n = istNow(), mins = n.getHours()*60 + n.getMinutes();
  const today = isTradingDay(n);
  let st, cls = 'down';
  if (!today){
    const h = HOLI_MAP[ymd(n)];
    st = h ? L(`Closed today — NSE holiday (${h[1]})`, `आज बंद — NSE छुट्टी (${h[2]})`, `Aaj band — NSE holiday (${h[1]})`) : L('Closed — weekend','बंद — सप्ताहांत','Band — weekend');
  } else if (mins < 9*60) st = L('Not open yet — pre-open starts at 9:00 AM','अभी नहीं खुला — प्री-ओपन सुबह 9:00 बजे','Abhi nahi khula — pre-open 9:00 baje');
  else if (mins < 9*60+8) { st = L('Pre-open session (order entry, 9:00–9:08)','प्री-ओपन सत्र (ऑर्डर एंट्री, 9:00–9:08)','Pre-open chal raha hai (9:00–9:08)'); cls = 'gold'; }
  else if (mins < 9*60+15) { st = L('Pre-open matching — normal trading starts 9:15','प्री-ओपन मिलान — सामान्य ट्रेडिंग 9:15 से','Pre-open matching — trading 9:15 se'); cls = 'gold'; }
  else if (mins < 15*60+30) { st = L('OPEN — normal trading till 3:30 PM','खुला है — दोपहर 3:30 तक ट्रेडिंग','OPEN hai — 3:30 tak trading'); cls = 'up'; }
  else if (mins < 16*60) { st = L('Closed for normal trading — post-close session till 4:00 PM','सामान्य ट्रेडिंग बंद — पोस्ट-क्लोज़ 4:00 तक','Normal trading band — post-close 4:00 tak'); cls = 'gold'; }
  else st = L('Closed for the day','आज के लिए बंद','Aaj ke liye band');
  const open = cls === 'up';
  const next = (today && mins < 9*60+15) ? n : nextTradingDay(n);
  return { n, st, cls, open, next };
}

function hMarket(E){
  const s = E.s, ms = marketStatus();
  const wantList = /list|all|saari|sabhi|सभी|सारी|kitni|how many|kaun kaun|कौन कौन|calendar|2026/.test(s);
  const wantHoliday = /holiday|chutti|chhutti|chhuti|chuti|avkash|अवकाश|छुट्टी|छुट्टियाँ|छुट्टियां|band rahega|closed on/.test(s);
  const wantMuhurat = /muhurat|मुहूर्त|diwali|दिवाली/.test(s);
  let h = '';
  // a specific date asked about?
  const tomorrow = /tomorrow|\bkal\b|कल/.test(s) && !/yesterday/.test(s);
  let target = E.dates[0] || (tomorrow ? (() => { const x = istNow(); x.setDate(x.getDate()+1); return x; })() : null);
  if (target && !wantList){
    const hol = HOLI_MAP[ymd(target)], w = target.getDay();
    const open = !hol && w !== 0 && w !== 6;
    h += `${esc(fmtDate(target))}: <b class="${open?'up':'down'}">${open ? L('Market OPEN (9:15 AM – 3:30 PM)','बाज़ार खुला (9:15 – 3:30)','Market OPEN (9:15 – 3:30)') : L('Market CLOSED','बाज़ार बंद','Market BAND')}</b>`;
    if (hol) h += `<div class="s-fine">${esc(LANG==='hi'?hol[2]:hol[1])}</div>`;
    else if (!open) h += `<div class="s-fine">${L('Weekend','सप्ताहांत','Weekend')}</div>`;
    if (ymd(target) === MUHURAT.date) h += `<div class="s-fine">${LANG==='hi'?MUHURAT.hi:MUHURAT.en}</div>`;
    return { html: h };
  }
  if (wantList){
    const today = ymd(istNow());
    h += `<b>${L('NSE trading holidays 2026','NSE ट्रेडिंग छुट्टियाँ 2026','NSE trading holidays 2026')}</b><table class="s-tbl">`;
    HOLIDAYS.forEach(x => { const d = new Date(x[0]+'T00:00'); const past = x[0] < today;
      h += `<tr${past?' class="s-past"':''}><td>${esc(d.toLocaleDateString(LANG==='hi'?'hi-IN':'en-IN',{day:'numeric',month:'short',weekday:'short'}))}</td><td>${esc(LANG==='hi'?x[2]:x[1])}</td></tr>`; });
    h += `</table><div class="s-fine">${LANG==='hi'?MUHURAT.hi:MUHURAT.en}</div>`;
    return { html: h };
  }
  h += `${L('NSE right now','NSE अभी','NSE abhi')} (${hhmm(ms.n)} IST): <b class="${ms.cls}">${ms.st}</b>`;
  if (!ms.open) h += row(L('Next trading session','अगला ट्रेडिंग सत्र','Agla trading session'), `${esc(fmtDate(ms.next))}, 9:15`);
  const up = HOLIDAYS.filter(x => x[0] >= ymd(istNow()));
  if (wantHoliday || !ms.open){
    if (up.length){ const x = up[0]; h += row(L('Next holiday','अगली छुट्टी','Agli chhutti'), `${esc(new Date(x[0]+'T00:00').toLocaleDateString(LANG==='hi'?'hi-IN':'en-IN',{day:'numeric',month:'short',weekday:'short'}))} · ${esc(LANG==='hi'?x[2]:x[1])}`); }
  }
  if (wantMuhurat) h += `<div class="s-fine">${LANG==='hi'?MUHURAT.hi:MUHURAT.en}</div>`;
  h += `<table class="s-tbl"><tr><td>${L('Pre-open','प्री-ओपन','Pre-open')}</td><td>9:00 – 9:15</td></tr><tr><td>${L('Normal market','सामान्य बाज़ार','Normal market')}</td><td>9:15 – 3:30</td></tr><tr><td>${L('Post-close','पोस्ट-क्लोज़','Post-close')}</td><td>3:40 – 4:00</td></tr><tr><td>${L('Intraday auto square-off','इंट्राडे ऑटो स्क्वेयर-ऑफ़','Intraday auto square-off')}</td><td>~3:15 – 3:25*</td></tr></table>`;
  h += `<div class="s-fine">${L('*Square-off time varies by broker. Settlement is T+1 — shares bought today reach your demat the next trading day.','*स्क्वेयर-ऑफ़ समय ब्रोकर पर निर्भर। सेटलमेंट T+1 — आज खरीदे शेयर अगले ट्रेडिंग दिन डीमैट में।','*Square-off time broker pe depend karta hai. Settlement T+1 — aaj ke shares agle trading din demat mein.')}</div>`;
  return { html: h };
}

// ---------------------------------------------------------------------
// 6c. Capital-gains tax (listed equity & equity ETFs like NIFTYBEES)
// ---------------------------------------------------------------------
const TAX = { stcg: 20, ltcg: 12.5, exempt: 125000, cess: 4 };
function hTax(E){
  const s = E.s;
  let gain = null;
  if (E.units[0] && E.entry && E.exit) gain = E.units[0] * (E.exit - E.entry);
  else if (E.amounts.length) gain = E.amounts[0];
  else if (E.vals.length) gain = E.vals[0];
  if (/loss|nuksan|nuksaan|नुकसान|ghata|घाटा/.test(s) && gain > 0) gain = -gain;
  let days = E.days || null;
  if (!days && E.dates.length) days = Math.abs(Math.round(((E.dates[1] || today0()) - E.dates[0])/864e5));
  const intraday = /intraday|इंट्राडे|same day|\bbtst\b/.test(s);
  const fno = /\bf ?& ?o\b|\bfno\b|futures?|options?|फ्यूचर|ऑप्शन/.test(s);
  const rules = `<div class="s-fine">${L(`Equity & equity ETFs (STT paid): held ≤ 12 months → STCG ${TAX.stcg}%; held > 12 months → LTCG ${TAX.ltcg}% on gains above ₹1.25 lakh per financial year (no indexation). Plus ${TAX.cess}% cess; surcharge may apply on high incomes. Not tax advice — confirm with your CA.`,
    `इक्विटी और इक्विटी ETF (STT भुगतान): 12 महीने तक → STCG ${TAX.stcg}%; 12 महीने से ज़्यादा → ₹1.25 लाख/वित्त वर्ष से ऊपर के लाभ पर LTCG ${TAX.ltcg}% (इंडेक्सेशन नहीं)। ऊपर से ${TAX.cess}% सेस; ज़्यादा आय पर सरचार्ज। टैक्स सलाह नहीं — CA से पुष्टि करें।`,
    `Equity/ETF: 12 mahine tak → STCG ${TAX.stcg}%; 12 mahine se zyada → ₹1.25 lakh/FY se upar LTCG ${TAX.ltcg}%. Plus ${TAX.cess}% cess. Tax advice nahi — CA se confirm karein.`)}</div>`;
  if (intraday || fno){
    return { html: `<b>${intraday ? L('Intraday equity profit','इंट्राडे मुनाफ़ा','Intraday profit') : L('F&O profit','F&O मुनाफ़ा','F&O profit')}</b>` +
      `<div>${intraday ? L('Taxed as <b>speculative business income</b> at your income-tax slab rate (not the 20% STCG rate). Speculative losses can only be set off against speculative gains, carried forward 4 years.','<b>सट्टा व्यावसायिक आय</b> — आपके आयकर स्लैब की दर से टैक्स (20% STCG नहीं)। सट्टा घाटा केवल सट्टा लाभ से सेट-ऑफ़, 4 साल तक आगे।','<b>Speculative business income</b> — aapke slab rate pe tax (20% STCG nahi). Loss sirf speculative gain se set-off, 4 saal carry forward.')
                                 : L('Taxed as <b>non-speculative business income</b> at your slab rate; expenses (brokerage, charges, advisory) are deductible; audit rules may apply on large turnover.','<b>गैर-सट्टा व्यावसायिक आय</b> — स्लैब दर से टैक्स; ब्रोकरेज आदि खर्च घटा सकते हैं; बड़े टर्नओवर पर ऑडिट नियम।','<b>Non-speculative business income</b> — slab rate pe tax; brokerage jaise kharche minus ho sakte hain.')}</div>` +
      (gain ? row(L('Your profit','आपका मुनाफ़ा','Aapka profit'), inr0(gain)) + row(L('Tax at 30% slab (+4% cess)','30% स्लैब पर (+4% सेस)','30% slab pe (+4% cess)'), inr0(Math.max(0,gain)*0.30*1.04)) + row(L('Tax at 20% slab (+4% cess)','20% स्लैब पर (+4% सेस)','20% slab pe (+4% cess)'), inr0(Math.max(0,gain)*0.20*1.04)) : '') +
      `<div class="s-fine">${L('Not tax advice — confirm with your CA.','टैक्स सलाह नहीं — CA से पुष्टि करें।','Tax advice nahi — CA se confirm karein.')}</div>` };
  }
  if (gain == null) return { html: `<b>${L('Tax on NIFTYBEES / shares','NIFTYBEES / शेयर पर टैक्स','NIFTYBEES / shares pe tax')}</b>` + rules + `<div class="s-fine">${L('Ask e.g. <i>"tax on ₹80,000 profit held 8 months"</i>.','पूछें जैसे <i>"80000 मुनाफ़े पर टैक्स, 8 महीने होल्ड"</i>।','Poochho jaise <i>"80000 profit pe tax 8 mahine hold"</i>.')}</div>` };
  if (gain < 0){
    return { html: `${L('Capital loss','पूँजीगत हानि','Capital loss')}: <b class="down">${inr0(gain)}</b>` +
      `<div>${L('A short-term loss can be set off against both short- and long-term gains; a long-term loss only against long-term gains. Unused losses carry forward 8 years if you file your return on time.','अल्पकालिक हानि को अल्प और दीर्घ दोनों लाभ से, दीर्घकालिक हानि को केवल दीर्घकालिक लाभ से सेट-ऑफ़ कर सकते हैं। समय पर ITR भरने पर 8 साल तक आगे ले जा सकते हैं।','Short-term loss ko STCG aur LTCG dono se, long-term loss ko sirf LTCG se set-off kar sakte ho. Time pe ITR bharo to 8 saal carry forward.')}</div>` + rules };
  }
  const st = gain * TAX.stcg/100 * (1 + TAX.cess/100);
  const ltTaxable = Math.max(0, gain - TAX.exempt);
  const lt = ltTaxable * TAX.ltcg/100 * (1 + TAX.cess/100);
  let h = `${L('Profit','मुनाफ़ा','Profit')}: <b>${inr0(gain)}</b>${days ? ` · ${L('held','होल्ड','hold')} ${days} ${L('days','दिन','din')}` : ''}`;
  if (days == null){
    h += row(L('If held ≤ 12 months (STCG 20%)','12 महीने तक (STCG 20%)','12 mahine tak (STCG 20%)'), `<b class="down">${inr0(st)}</b>`);
    h += row(L('If held > 12 months (LTCG 12.5%)','12 महीने से ज़्यादा (LTCG 12.5%)','12 mahine se zyada (LTCG 12.5%)'), `<b class="down">${inr0(lt)}</b>`);
  } else if (days > 365){
    h += row(L('Type','प्रकार','Type'), 'LTCG · 12.5%');
    h += row(L('Exempt (₹1.25 lakh/FY)','छूट (₹1.25 लाख/वर्ष)','Exempt (₹1.25 lakh/FY)'), inr0(Math.min(gain, TAX.exempt)));
    h += row(L('Taxable','कर योग्य','Taxable'), inr0(ltTaxable));
    h += row(`<b>${L('Tax (incl. 4% cess)','टैक्स (4% सेस सहित)','Tax (4% cess sahit)')}</b>`, `<b class="down">${inr0(lt)}</b>`);
    h += row(L('You keep','आपके पास बचेगा','Aapke paas bachega'), inr0(gain - lt), 'up');
  } else {
    h += row(L('Type','प्रकार','Type'), 'STCG · 20%');
    h += row(`<b>${L('Tax (incl. 4% cess)','टैक्स (4% सेस सहित)','Tax (4% cess sahit)')}</b>`, `<b class="down">${inr0(st)}</b>`);
    h += row(L('You keep','आपके पास बचेगा','Aapke paas bachega'), inr0(gain - st), 'up');
    const wait = 366 - days;
    if (wait > 0 && wait < 120) h += `<div class="s-warn">${L(`Holding ${wait} more day${wait===1?'':'s'} would make it long-term — tax would drop to ${inr0(lt)}.`,`${wait} दिन और रखने पर यह दीर्घकालिक होगा — टैक्स घटकर ${inr0(lt)}।`,`${wait} din aur hold karo to long-term — tax ${inr0(lt)} ho jayega.`)}</div>`;
  }
  return { html: h + rules };
}

// ---------------------------------------------------------------------
// 6d. Trading tools — % change, stop-loss, position size, risk:reward,
//     averaging, recovery, yield, P/E, goal SIP, inflation
// ---------------------------------------------------------------------
const fmtP = v => inr(v);
function hPctChange(a, b){
  const c = (b - a) / a * 100;
  return { html: `${fmtP(a)} → ${fmtP(b)}` + row(`<b>${L('Change','बदलाव','Change')}</b>`, `<b class="s-big ${cls(c)}">${sgn(c)}</b>`) + row(L('Difference','अंतर','Difference'), `${b-a>=0?'+':''}${inr(b-a)}`, cls(c)) };
}
function hPriceAfterPct(p, pct, down){
  const up = p*(1+pct/100), dn = p*(1-pct/100);
  let h = `${fmtP(p)} ± ${pct}%`;
  if (down == null){ h += row(L(`+${pct}% (up)`,`+${pct}% (ऊपर)`,`+${pct}% (upar)`), `<b class="up">${fmtP(up)}</b>`) + row(L(`−${pct}% (down)`,`−${pct}% (नीचे)`,`−${pct}% (neeche)`), `<b class="down">${fmtP(dn)}</b>`); }
  else h += row(`<b>${down ? L(`After a ${pct}% fall`,`${pct}% गिरने पर`,`${pct}% girne pe`) : L(`After a ${pct}% rise`,`${pct}% बढ़ने पर`,`${pct}% badhne pe`)}</b>`, `<b class="s-big ${down?'down':'up'}">${fmtP(down?dn:up)}</b>`);
  return { html: h };
}
function hRecover(p){
  const need = (1/(1-p/100) - 1)*100;
  return { html: `${L(`After a ${p}% loss`,`${p}% नुकसान के बाद`,`${p}% loss ke baad`)}` + row(`<b>${L('Gain needed to get back to even','बराबर आने के लिए ज़रूरी बढ़त','Wapas barabar aane ko chahiye')}</b>`, `<b class="s-big">${sgn(need)}</b>`) +
    `<div class="s-fine">${L('Losses hurt more than gains help — a 50% fall needs a 100% rise to recover.','नुकसान की भरपाई ज़्यादा कठिन — 50% गिरावट के लिए 100% बढ़त चाहिए।','50% girawat ke baad 100% badhat chahiye.')}</div>` };
}
function hStopLoss(E){
  const entry = E.entry || (E.vals[0] && E.vals[0] !== E.sl ? E.vals[0] : null) || APP.live();
  if (!entry) return noPrice();
  const isShort = E.mode === 'short';
  let sl = E.sl, pct = E.pcts[0];
  if (!sl && pct) sl = isShort ? entry*(1+pct/100) : entry*(1-pct/100);
  if (!sl) return { html: L('Give me a stop-loss % or price — e.g. <i>"2% stop loss on 285"</i> or <i>"entry 285 SL 279"</i>.','स्टॉप-लॉस % या भाव बताएँ — जैसे <i>"285 पर 2% स्टॉप लॉस"</i>।','SL % ya price batao — jaise <i>"285 pe 2% stop loss"</i>.') };
  const perUnit = Math.abs(entry - sl);
  const units = E.units[0] || (E.amounts[0] ? Math.floor(E.amounts[0]/entry) : null);
  let h = `${L('Entry','एंट्री','Entry')} ${fmtP(entry)}${E.entry?'':' <span class="s-fine">('+L('live','लाइव','live')+')</span>'}`;
  h += row(`<b>${L('Stop-loss price','स्टॉप-लॉस भाव','Stop-loss price')}</b>`, `<b class="s-big down">${fmtP(sl)}</b>`);
  h += row(L('Distance','दूरी','Distance'), `${inr(perUnit)} · ${(perUnit/entry*100).toFixed(2)}%`);
  if (units) h += row(L(`Max loss on ${num(units)} units`,`${num(units)} यूनिट पर अधिकतम नुकसान`,`${num(units)} units pe max loss`), `<b class="down">${inr(perUnit*units)}</b>`);
  if (E.exit && E.exit !== sl){ const rr = Math.abs(E.exit-entry)/perUnit; h += row(L('Risk : Reward','रिस्क : रिवॉर्ड','Risk : Reward'), `1 : ${rr.toFixed(2)}`, rr>=2?'up':rr<1?'down':''); }
  h += `<div class="s-fine">${L('Charges are extra. A gap-down open can skip past a stop-loss.','चार्ज अलग। गैप-डाउन ओपनिंग में स्टॉप-लॉस से नीचे भी भर सकता है।','Charges alag. Gap-down mein SL se neeche bhi fill ho sakta hai.')}</div>`;
  return { html: h };
}
function hPositionSize(E){
  const capital = E.amounts[0];
  const riskPct = E.pcts[0] != null ? E.pcts[0] : 1;
  const entry = E.entry || APP.live();
  const sl = E.sl;
  if (!capital || !entry || !sl) return { html: L('Tell me capital, risk %, entry and stop-loss — e.g. <i>"capital 5 lakh, risk 1%, entry 285, SL 279 — how many units?"</i>','पूँजी, रिस्क %, एंट्री और स्टॉप-लॉस बताएँ — जैसे <i>"पूँजी 5 लाख, रिस्क 1%, एंट्री 285, SL 279 — कितने यूनिट?"</i>','Capital, risk %, entry aur SL batao — jaise <i>"capital 5 lakh risk 1% entry 285 SL 279 kitne units"</i>.') };
  const riskAmt = capital * riskPct/100, per = Math.abs(entry - sl);
  let qty = Math.floor(riskAmt / per);
  const maxAff = Math.floor(capital / entry);
  const capped = qty > maxAff; if (capped) qty = maxAff;
  let h = `${L('Capital','पूँजी','Capital')} ${inrShort(capital)} · ${L('risk','रिस्क','risk')} ${riskPct}% = <b>${inr0(riskAmt)}</b>`;
  h += row(L('Risk per unit','प्रति यूनिट रिस्क','Risk per unit'), `${inr(per)} (${fmtP(entry)} → ${fmtP(sl)})`);
  h += row(`<b>${L('Position size','पोज़िशन साइज़','Position size')}</b>`, `<b class="s-big">${num(qty)} ${L('units','यूनिट','units')}</b>`);
  h += row(L('Capital used','लगने वाली पूँजी','Capital used'), inr0(qty*entry));
  h += row(L('Loss if stop-loss hits','स्टॉप-लॉस लगने पर नुकसान','SL hit hua to loss'), inr0(qty*per), 'down');
  if (E.exit){ const rr = Math.abs(E.exit-entry)/per; h += row(L('Risk : Reward','रिस्क : रिवॉर्ड','Risk : Reward'), `1 : ${rr.toFixed(2)}`, rr>=2?'up':rr<1?'down':''); h += row(L('Profit at target','टारगेट पर मुनाफ़ा','Target pe profit'), inr0(qty*Math.abs(E.exit-entry)), 'up'); }
  if (capped) h += `<div class="s-warn">${L('Capped by your capital — the full risk budget would need more money.','आपकी पूँजी तक सीमित।','Capital ki limit tak capped.')}</div>`;
  return { html: h };
}
function hRiskReward(E){
  const entry = E.entry, sl = E.sl, tg = E.exit;
  if (!entry || !sl || !tg) return { html: L('Give entry, stop-loss and target — e.g. <i>"entry 285 SL 279 target 297"</i>.','एंट्री, स्टॉप-लॉस और टारगेट बताएँ — जैसे <i>"एंट्री 285 SL 279 टारगेट 297"</i>।','Entry, SL aur target batao — jaise <i>"entry 285 SL 279 target 297"</i>.') };
  const risk = Math.abs(entry-sl), reward = Math.abs(tg-entry), rr = reward/risk;
  const winNeeded = 1/(1+rr)*100;
  return { html: `${fmtP(entry)} · SL ${fmtP(sl)} · ${L('Target','टारगेट','Target')} ${fmtP(tg)}` +
    row(L('Risk per unit','प्रति यूनिट रिस्क','Risk'), `${inr(risk)} (${(risk/entry*100).toFixed(2)}%)`, 'down') +
    row(L('Reward per unit','प्रति यूनिट रिवॉर्ड','Reward'), `${inr(reward)} (${(reward/entry*100).toFixed(2)}%)`, 'up') +
    row(`<b>${L('Risk : Reward','रिस्क : रिवॉर्ड','Risk : Reward')}</b>`, `<b class="s-big ${rr>=2?'up':rr<1?'down':''}">1 : ${rr.toFixed(2)}</b>`) +
    row(L('Win-rate needed to break even','बराबरी के लिए ज़रूरी जीत-दर','Break-even win rate'), `${winNeeded.toFixed(0)}%`) };
}
function hAverage(E){
  const pairs = E.pairs.slice();
  // "have 500 at 290 — how many at 270 to make average 280?"
  const wantTarget = /make|karne|karna|laane|lane|bring|to get|ho jaye|ho jaaye|हो जाए|करने/.test(E.s);
  if (wantTarget && pairs.length >= 1){
    const [u1, p1] = [pairs[0].units, pairs[0].price];
    const rest = E.vals.filter(v => v !== p1);
    const nums = rest.length >= 2 ? rest.slice(-2) : null;
    if (nums){
      const [p2, target] = nums; // order as typed: new buy price, then target average
      const n = u1 * (p1 - target) / (target - p2);
      if (n > 0 && isFinite(n)) return { html: `${num(u1)} @ ${fmtP(p1)} → ${L('target average','लक्ष्य औसत','target average')} ${fmtP(target)}` +
        row(`<b>${L(`Buy at ${fmtP(p2)}`,`${fmtP(p2)} पर खरीदें`,`${fmtP(p2)} pe lo`)}</b>`, `<b class="s-big">${num(Math.ceil(n))} ${L('units','यूनिट','units')}</b>`) +
        row(L('Extra money needed','अतिरिक्त पैसा','Extra paisa'), inr0(Math.ceil(n)*p2)) + row(L('New total','नया कुल','Naya total'), `${num(u1+Math.ceil(n))} ${L('units','यूनिट','units')}`) };
      return { html: L('That average isn\'t reachable with that buy price — it must lie between the two prices.','उस भाव से यह औसत संभव नहीं — औसत दोनों भावों के बीच होना चाहिए।','Us price se ye average possible nahi — average dono prices ke beech hona chahiye.') };
    }
  }
  if (pairs.length < 2) return { html: L('Give each buy as "units at price" — e.g. <i>"500 at 290 and 300 at 270, average?"</i>','हर खरीद "यूनिट @ भाव" में लिखें — जैसे <i>"500 @ 290 और 300 @ 270, औसत?"</i>','Har buy "units at price" likho — jaise <i>"500 at 290 aur 300 at 270 average?"</i>') };
  let u = 0, v = 0; pairs.forEach(p => { u += p.units; v += p.units*p.price; });
  const avg = v/u, live = APP.live();
  let h = pairs.map(p => `${num(p.units)} @ ${fmtP(p.price)}`).join(' + ');
  h += row(`<b>${L('Average price','औसत भाव','Average price')}</b>`, `<b class="s-big gold">${fmtP(avg)}</b>`);
  h += row(L('Total units','कुल यूनिट','Total units'), num(u)) + row(L('Total invested','कुल निवेश','Total invested'), inr(v));
  if (live) h += row(L(`At live ${fmtP(live)}`,`लाइव ${fmtP(live)} पर`,`Live ${fmtP(live)} pe`), `${sgn((live/avg-1)*100)} · ${live-avg>=0?'+':''}${inr((live-avg)*u)}`, cls(live-avg));
  return { html: h + `<div class="s-fine">${L('Before charges.','चार्ज से पहले।','Charges se pehle.')}</div>`, actions: [fillCalculatorMulti(pairs)] };
}
function fillCalculatorMulti(pairs){
  return { label: L('Load into calculator ↓','कैलकुलेटर में भरें ↓','Calculator mein bharo ↓'), run: () => {
    try {
      const sc = document.getElementById('holdings-slot-count');
      if (sc){ sc.value = String(Math.min(20, pairs.length)); if (typeof setHoldingsSlotCount === 'function') setHoldingsSlotCount(); }
      pairs.slice(0,20).forEach((p,i) => { const r = document.querySelector(`.holdings-row[data-slot="${i+1}"]`); if (r){ r.querySelector('.h-units').value = p.units; r.querySelector('.h-price').value = p.price; } });
      if (typeof computeHoldings === 'function') computeHoldings();
      const sum = document.getElementById('holdings-summary'); if (sum) sum.scrollIntoView({ behavior:'smooth', block:'center' });
      if (window.innerWidth < 600) closePanel();
      return L('Done — all entries are in the calculator below.','हो गया — सभी एंट्री नीचे कैलकुलेटर में।','Ho gaya — saari entries neeche calculator mein.');
    } catch(e){ return L('Couldn\'t reach the calculator on this page.','इस पेज पर कैलकुलेटर नहीं मिला।','Calculator nahi mila.'); }
  }};
}
function hYield(dps, price){
  const y = dps/price*100;
  return { html: `${L('Dividend','लाभांश','Dividend')} ${inr(dps)} / ${L('price','भाव','price')} ${fmtP(price)}` + row(`<b>${L('Dividend yield','लाभांश यील्ड','Dividend yield')}</b>`, `<b class="s-big">${y.toFixed(2)}%</b>`) +
    `<div class="s-fine">${L('Dividends are taxed at your slab rate; TDS 10% applies above ₹10,000 a year per company.','लाभांश पर आपके स्लैब से टैक्स; एक कंपनी से सालाना ₹10,000 से ऊपर 10% TDS।','Dividend pe slab rate se tax; ₹10,000/saal se upar 10% TDS.')}</div>` };
}
function hPE(price, eps){
  const pe = price/eps;
  return { html: `${L('Price','भाव','Price')} ${fmtP(price)} · EPS ${inr(eps)}` + row(`<b>P/E</b>`, `<b class="s-big">${pe.toFixed(1)}×</b>`) + row(L('Earnings yield','अर्निंग्स यील्ड','Earnings yield'), (100/pe).toFixed(2)+'%') +
    `<div class="s-fine">${L('P/E = price ÷ earnings per share: how many years of today\'s profit you pay for. Compare within the same sector.','P/E = भाव ÷ प्रति शेयर आय। एक ही सेक्टर में तुलना करें।','P/E = price ÷ EPS. Same sector mein compare karo.')}</div>` };
}
function hGoalSip(E){
  const goal = Math.max(...E.amounts), r = E.pcts[0] != null ? E.pcts[0] : 12, yrs = E.years || 10;
  const n = Math.round(yrs*12), i = r/12/100;
  const sip = goal * i / ((Math.pow(1+i, n) - 1) * (1+i));
  const lump = goal / Math.pow(1+r/100, yrs);
  return { html: `${L('Goal','लक्ष्य','Goal')} <b>${inrShort(goal)}</b> ${L('in','में','mein')} ${+yrs.toFixed(1)} ${L('years','साल','saal')} @ ${r}%` +
    row(`<b>${L('Monthly SIP needed','ज़रूरी मासिक SIP','Monthly SIP chahiye')}</b>`, `<b class="s-big up">${inr0(sip)}</b>`) +
    row(L('Or one-time investment today','या आज एकमुश्त निवेश','Ya aaj ek saath'), inrShort(lump)) +
    row(L('Total SIP paid','कुल SIP भुगतान','Total SIP'), inrShort(sip*n)) +
    (E.pcts[0] == null ? `<div class="s-fine">${L('Assumed 12% p.a.','12% सालाना माना।','12% saalana maana.')}</div>` : '') };
}
function hInflation(E){
  const P = E.amounts[0], r = E.pcts[0] != null ? E.pcts[0] : 6, yrs = E.years || 10;
  const future = P*Math.pow(1+r/100, yrs), real = P/Math.pow(1+r/100, yrs);
  return { html: `${inrShort(P)} · ${L('inflation','महंगाई','inflation')} ${r}% · ${+yrs.toFixed(1)} ${L('years','साल','saal')}` +
    row(L('Same things will cost','वही चीज़ें इतने की होंगी','Wahi cheez itne ki hogi'), `<b class="down">${inrShort(future)}</b>`) +
    row(L('Today\'s value of that money then','तब इस रकम की आज की कीमत','Tab is paise ki aaj ki value'), `<b>${inrShort(real)}</b>`) +
    (E.pcts[0] == null ? `<div class="s-fine">${L('Assumed 6% inflation.','6% महंगाई मानी।','6% inflation maani.')}</div>` : '') };
}


// ---------------------------------------------------------------------
// 6e. Any stock / index / commodity — live quote, technicals, returns,
//     comparison. Data: Yahoo Finance via the app's own proxy
//     (fetchViaProxy), so it uses the same Cloudflare Worker quota.
// ---------------------------------------------------------------------
const SYM = [
  // indices
  ['nifty 50|nifty50|nifty fifty|nifty index|निफ्टी 50|निफ्टी|nifty', '^NSEI', 'NIFTY 50'],
  ['bank nifty|banknifty|nifty bank|बैंक निफ्टी', '^NSEBANK', 'NIFTY Bank'],
  ['sensex|सेंसेक्स|bse sensex', '^BSESN', 'S&P BSE Sensex'],
  ['nifty it|it index', '^CNXIT', 'NIFTY IT'], ['nifty auto', '^CNXAUTO', 'NIFTY Auto'], ['nifty pharma', '^CNXPHARMA', 'NIFTY Pharma'],
  ['nifty fmcg', '^CNXFMCG', 'NIFTY FMCG'], ['nifty metal', '^CNXMETAL', 'NIFTY Metal'], ['nifty realty', '^CNXREALTY', 'NIFTY Realty'],
  ['nifty energy', '^CNXENERGY', 'NIFTY Energy'], ['nifty psu bank|psu bank', '^CNXPSUBANK', 'NIFTY PSU Bank'],
  ['india vix|indiavix', '^INDIAVIX', 'India VIX'],
  // ETFs
  ['niftybees|nifty bees|निफ्टीबीज़|निफ्टी बीज', 'NIFTYBEES.NS', 'NIFTYBEES'], ['bankbees|bank bees', 'BANKBEES.NS', 'BANKBEES'],
  ['goldbees|gold bees|gold etf', 'GOLDBEES.NS', 'GOLDBEES'], ['silverbees|silver bees|silver etf', 'SILVERBEES.NS', 'SILVERBEES'],
  ['juniorbees|junior bees', 'JUNIORBEES.NS', 'JUNIORBEES'], ['itbees', 'ITBEES.NS', 'ITBEES'], ['liquidbees', 'LIQUIDBEES.NS', 'LIQUIDBEES'],
  ['mon100|nasdaq etf', 'MON100.NS', 'Motilal Nasdaq 100 ETF'], ['cpse etf|cpseetf', 'CPSEETF.NS', 'CPSE ETF'],
  // commodities, currency, crypto, global
  ['gold|सोना|सोने|sona', 'GC=F', 'Gold'], ['silver|चांदी|चाँदी|chandi', 'SI=F', 'Silver'],
  ['crude oil|crude|कच्चा तेल|क्रूड', 'CL=F', 'Crude oil (WTI)'], ['brent', 'BZ=F', 'Brent crude'], ['natural gas', 'NG=F', 'Natural gas'],
  ['dollar|usd inr|usdinr|usd/inr|डॉलर|rupee rate', 'INR=X', 'USD/INR'],
  ['bitcoin|btc|बिटकॉइन', 'BTC-USD', 'Bitcoin'], ['ethereum|eth', 'ETH-USD', 'Ethereum'],
  ['dow jones|dow', '^DJI', 'Dow Jones'], ['nasdaq', '^IXIC', 'Nasdaq'], ['s&p 500|s&p|sp500', '^GSPC', 'S&P 500'],
  ['nikkei', '^N225', 'Nikkei 225'], ['hang seng', '^HSI', 'Hang Seng'], ['ftse', '^FTSE', 'FTSE 100'],
  ['apple', 'AAPL', 'Apple'], ['tesla', 'TSLA', 'Tesla'], ['nvidia', 'NVDA', 'Nvidia'], ['microsoft', 'MSFT', 'Microsoft'],
  ['google|alphabet', 'GOOGL', 'Alphabet'], ['amazon', 'AMZN', 'Amazon'], ['meta platforms|facebook', 'META', 'Meta'],
  // Indian stocks
  ['reliance|ril|रिलायंस', 'RELIANCE.NS', 'Reliance Industries'], ['tcs|tata consultancy|टीसीएस', 'TCS.NS', 'TCS'],
  ['infosys|infy|इंफोसिस|इन्फोसिस', 'INFY.NS', 'Infosys'], ['hdfc bank|hdfcbank|एचडीएफसी बैंक|एचडीएफसी', 'HDFCBANK.NS', 'HDFC Bank'],
  ['icici bank|icicibank|icici|आईसीआईसीआई', 'ICICIBANK.NS', 'ICICI Bank'], ['sbi|state bank|एसबीआई|स्टेट बैंक', 'SBIN.NS', 'State Bank of India'],
  ['itc|आईटीसी', 'ITC.NS', 'ITC'], ['l&t|larsen|l and t|lnt', 'LT.NS', 'Larsen & Toubro'], ['bharti airtel|airtel|एयरटेल', 'BHARTIARTL.NS', 'Bharti Airtel'],
  ['kotak bank|kotak mahindra bank|kotak mahindra', 'KOTAKBANK.NS', 'Kotak Mahindra Bank'], ['axis bank|axis', 'AXISBANK.NS', 'Axis Bank'],
  ['hul|hindustan unilever', 'HINDUNILVR.NS', 'Hindustan Unilever'], ['bajaj finance', 'BAJFINANCE.NS', 'Bajaj Finance'], ['bajaj finserv', 'BAJAJFINSV.NS', 'Bajaj Finserv'],
  ['bajaj auto', 'BAJAJ-AUTO.NS', 'Bajaj Auto'], ['maruti|maruti suzuki|मारुति', 'MARUTI.NS', 'Maruti Suzuki'], ['m&m|mahindra and mahindra|mahindra & mahindra|mahindra', 'M&M.NS', 'Mahindra & Mahindra'],
  ['tata motors|tata motor|tmpv|टाटा मोटर्स', 'TMPV.NS', 'Tata Motors Passenger Vehicles'], ['tata steel|टाटा स्टील', 'TATASTEEL.NS', 'Tata Steel'], ['tata power', 'TATAPOWER.NS', 'Tata Power'],
  ['tata consumer', 'TATACONSUM.NS', 'Tata Consumer'], ['tata elxsi', 'TATAELXSI.NS', 'Tata Elxsi'], ['titan', 'TITAN.NS', 'Titan'],
  ['asian paints', 'ASIANPAINT.NS', 'Asian Paints'], ['ultratech|ultratech cement', 'ULTRACEMCO.NS', 'UltraTech Cement'], ['sun pharma', 'SUNPHARMA.NS', 'Sun Pharma'],
  ['cipla', 'CIPLA.NS', 'Cipla'], ["dr reddy|dr reddys|dr. reddy", 'DRREDDY.NS', "Dr. Reddy's"], ['hcl tech|hcltech|hcl', 'HCLTECH.NS', 'HCL Tech'],
  ['wipro|विप्रो', 'WIPRO.NS', 'Wipro'], ['tech mahindra|techm', 'TECHM.NS', 'Tech Mahindra'], ['ltimindtree|lti mindtree', 'LTIM.NS', 'LTIMindtree'],
  ['nestle', 'NESTLEIND.NS', 'Nestle India'], ['britannia', 'BRITANNIA.NS', 'Britannia'], ['adani enterprises|adani ent|adani|अडानी', 'ADANIENT.NS', 'Adani Enterprises'],
  ['adani ports', 'ADANIPORTS.NS', 'Adani Ports'], ['adani green', 'ADANIGREEN.NS', 'Adani Green'], ['adani power', 'ADANIPOWER.NS', 'Adani Power'],
  ['ntpc|एनटीपीसी', 'NTPC.NS', 'NTPC'], ['power grid|powergrid', 'POWERGRID.NS', 'Power Grid'], ['ongc|ओएनजीसी', 'ONGC.NS', 'ONGC'], ['coal india', 'COALINDIA.NS', 'Coal India'],
  ['bpcl', 'BPCL.NS', 'BPCL'], ['ioc|indian oil', 'IOC.NS', 'Indian Oil'], ['hindalco', 'HINDALCO.NS', 'Hindalco'], ['jsw steel', 'JSWSTEEL.NS', 'JSW Steel'],
  ['grasim', 'GRASIM.NS', 'Grasim'], ['eicher|royal enfield', 'EICHERMOT.NS', 'Eicher Motors'], ['hero motocorp|hero moto', 'HEROMOTOCO.NS', 'Hero MotoCorp'],
  ['indusind', 'INDUSINDBK.NS', 'IndusInd Bank'], ['shriram finance', 'SHRIRAMFIN.NS', 'Shriram Finance'], ['trent', 'TRENT.NS', 'Trent'],
  ['bharat electronics|bel', 'BEL.NS', 'Bharat Electronics'], ['hindustan aeronautics|hal share|hal stock', 'HAL.NS', 'HAL'],
  ['zomato|eternal|जोमैटो|ज़ोमैटो', 'ETERNAL.NS', 'Eternal (Zomato)'], ['swiggy', 'SWIGGY.NS', 'Swiggy'], ['jio financial|jio finance|jiofin', 'JIOFIN.NS', 'Jio Financial'],
  ['lic|life insurance corporation|एलआईसी', 'LICI.NS', 'LIC'], ['dmart|avenue supermarts', 'DMART.NS', 'DMart'], ['irctc', 'IRCTC.NS', 'IRCTC'], ['irfc', 'IRFC.NS', 'IRFC'],
  ['rvnl|rail vikas', 'RVNL.NS', 'RVNL'], ['bhel', 'BHEL.NS', 'BHEL'], ['sail', 'SAIL.NS', 'SAIL'], ['vedanta', 'VEDL.NS', 'Vedanta'], ['yes bank', 'YESBANK.NS', 'Yes Bank'],
  ['idfc first|idfc', 'IDFCFIRSTB.NS', 'IDFC First Bank'], ['pnb|punjab national', 'PNB.NS', 'PNB'], ['bank of baroda|bob', 'BANKBARODA.NS', 'Bank of Baroda'], ['canara bank', 'CANBK.NS', 'Canara Bank'],
  ['suzlon', 'SUZLON.NS', 'Suzlon'], ['paytm|one97', 'PAYTM.NS', 'Paytm'], ['nykaa', 'NYKAA.NS', 'Nykaa'], ['polycab', 'POLYCAB.NS', 'Polycab'], ['dixon', 'DIXON.NS', 'Dixon Technologies'],
  ['hdfc life', 'HDFCLIFE.NS', 'HDFC Life'], ['sbi life', 'SBILIFE.NS', 'SBI Life'], ['apollo hospitals|apollo', 'APOLLOHOSP.NS', 'Apollo Hospitals'], ['pidilite', 'PIDILITIND.NS', 'Pidilite'],
  ['dabur', 'DABUR.NS', 'Dabur'], ['havells', 'HAVELLS.NS', 'Havells'], ['siemens', 'SIEMENS.NS', 'Siemens'], ['dlf', 'DLF.NS', 'DLF'], ['indigo|interglobe', 'INDIGO.NS', 'IndiGo'],
  ['mrf', 'MRF.NS', 'MRF'], ['persistent', 'PERSISTENT.NS', 'Persistent'], ['coforge', 'COFORGE.NS', 'Coforge'], ['hdfc amc', 'HDFCAMC.NS', 'HDFC AMC'], ['muthoot', 'MUTHOOTFIN.NS', 'Muthoot Finance'],
  ['bse ltd|bse share|bse stock', 'BSE.NS', 'BSE Ltd'], ['cdsl', 'CDSL.NS', 'CDSL'], ['angel one|angelone', 'ANGELONE.NS', 'Angel One'], ['hyundai', 'HYUNDAI.NS', 'Hyundai Motor India'],
  ['mazagon dock|mazdock', 'MAZDOCK.NS', 'Mazagon Dock'], ['cochin shipyard', 'COCHINSHIP.NS', 'Cochin Shipyard'], ['nhpc', 'NHPC.NS', 'NHPC'], ['gail', 'GAIL.NS', 'GAIL'],
  ['rec ltd|rec share', 'RECLTD.NS', 'REC'], ['pfc|power finance', 'PFC.NS', 'PFC'], ['ireda', 'IREDA.NS', 'IREDA'], ['waaree', 'WAAREEENER.NS', 'Waaree Energies'],
  ['ola electric', 'OLAELEC.NS', 'Ola Electric'], ['zydus', 'ZYDUSLIFE.NS', 'Zydus Lifesciences'], ['lupin', 'LUPIN.NS', 'Lupin'], ['godrej consumer', 'GODREJCP.NS', 'Godrej Consumer'],
];
const SYM_LIST = SYM.flatMap(([keys, sym, name]) => keys.split('|').map(k => ({ k, sym, name }))).sort((a,b) => b.k.length - a.k.length);
function escRx(k){ return k.replace(/[.*+?^${}()|[\]\\]/g, m => '\\' + m); }
function findSymbols(s){
  const out = []; let t = ' ' + s + ' ';
  for (const x of SYM_LIST){
    const re = new RegExp('(^|[^a-z0-9&])' + escRx(x.k) + '(?![a-z0-9])');
    const m = t.match(re);
    if (m){ if (!out.find(o => o.sym === x.sym)) out.push({ sym: x.sym, name: x.name, at: m.index }); t = t.replace(re, '$1 '); }
  }
  return out.sort((a,b) => a.at - b.at);
}
const STOP = new Set('price prices bhav bhaav rate rates quote level share shares stock stocks stok equity scrip company ka ki ke kya hai hain h what whats is the of for in on today todays aaj abhi current currently live now please pls plz batao bataiye bata btao tell me show give check dekho technical technicals analysis analyse analyze rsi dma sma ema chart trend support resistance pivot return returns performance perform should i buy sell hold kharidu kharidna bechu bechna lena lu chahiye me mein mai 52 week high low year years saal month months mahine week weeks din day days ago pichhle pichle last since from to se tak vs versus compare comparison and aur or with how much kitna kitne kitni ho hua raha rahe rahi gaya gira badha up down upar neeche doing about info information details nse bse india indian ltd limited target stop loss sl news kaisa kaise kaisi value worth market cap outlook view momentum breakout good bad best buy? sell? hai? stock? price? a an it this that my mera meri was were be been will would can could do does did market bazaar bazar bias mood signal holdings holding calculator news charges brokerage mtf sip tax nifty niftybees bees'.split(' '));
function leftoverPhrase(s){
  return s.replace(/[^a-z& ]/g, ' ').split(/\s+/).filter(w => w && w.length > 1 && !STOP.has(w)).join(' ').trim();
}
async function searchSymbol(q){
  if (typeof fetchViaProxy !== 'function') return null;
  try {
    const r = await fetchViaProxy('https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q) + '&quotesCount=8&newsCount=0', 8000);
    const j = await r.json();
    const qs = (j.quotes || []).filter(x => x.symbol);
    const pick = qs.find(x => /\.NS$/.test(x.symbol)) || qs.find(x => /\.BO$/.test(x.symbol)) || qs.find(x => x.quoteType === 'INDEX') || qs[0];
    if (pick) return { sym: pick.symbol, name: pick.shortname || pick.longname || pick.symbol };
  } catch(e){}
  // last resort: treat a single word as an NSE ticker
  const w = q.replace(/[^a-z0-9&-]/g, '').toUpperCase();
  if (w.length >= 2 && w.length <= 15 && !/\s/.test(q)) return { sym: w + '.NS', name: w };
  return null;
}
const HCACHE = {};
async function getHist(sym, range='1y', interval='1d'){
  const key = sym + '|' + range + '|' + interval;
  const c = HCACHE[key]; if (c && Date.now() - c.t < 60000) return c.d;
  if (typeof fetchViaProxy !== 'function') throw new Error('offline');
  const r = await fetchViaProxy(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`, 9000);
  const j = await r.json();
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.meta) throw new Error('no data');
  const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const ts = res.timestamp || [], d = { meta: res.meta, t:[], o:[], h:[], l:[], c:[], v:[] };
  for (let i = 0; i < ts.length; i++){
    if (q.close && q.close[i] != null){ d.t.push(ts[i]*1000); d.o.push(q.open[i]); d.h.push(q.high[i]); d.l.push(q.low[i]); d.c.push(q.close[i]); d.v.push(q.volume ? q.volume[i] : null); }
  }
  if (!d.c.length) throw new Error('empty series');
  HCACHE[key] = { t: Date.now(), d };
  return d;
}
const cur = (meta) => (meta && meta.currency) || 'INR';
function money(v, meta, dp=2){
  const c = cur(meta);
  if (c === 'INR') return inr(v, dp);
  return (c === 'USD' ? '$' : c + ' ') + v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function smaArr(a, n){ if (a.length < n) return null; let s = 0; for (let i = a.length-n; i < a.length; i++) s += a[i]; return s/n; }
function rsiArr(a, n=14){
  if (a.length < n+1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++){ const d = a[i]-a[i-1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n+1; i < a.length; i++){ const d = a[i]-a[i-1]; g = (g*(n-1) + Math.max(d,0))/n; l = (l*(n-1) + Math.max(-d,0))/n; }
  return l === 0 ? 100 : 100 - 100/(1 + g/l);
}
function volAnn(a, n=60){ const r = []; for (let i = Math.max(1, a.length-n); i < a.length; i++) r.push(Math.log(a[i]/a[i-1])); const m = r.reduce((x,y)=>x+y,0)/r.length; const v = r.reduce((x,y)=>x+(y-m)*(y-m),0)/(r.length-1); return Math.sqrt(v*252)*100; }
function retN(a, n){ return a.length > n ? (a[a.length-1]/a[a.length-1-n]-1)*100 : null; }
function maxDD(a){ let peak = a[0], dd = 0; for (const x of a){ if (x > peak) peak = x; dd = Math.min(dd, x/peak-1); } return dd*100; }

function snapshot(d){
  const c = d.c, meta = d.meta;
  const last = meta.regularMarketPrice || c[c.length-1];
  const prev = meta.chartPreviousClose && d.t.length <= 6 ? meta.chartPreviousClose : (meta.previousClose || c[c.length-2]);
  const hi52 = meta.fiftyTwoWeekHigh || Math.max(...d.h.filter(x=>x!=null)), lo52 = meta.fiftyTwoWeekLow || Math.min(...d.l.filter(x=>x!=null));
  return { last, prev, chg: (last/prev-1)*100, dayH: meta.regularMarketDayHigh, dayL: meta.regularMarketDayLow, vol: meta.regularMarketVolume,
           hi52, lo52, pos52: (last-lo52)/(hi52-lo52)*100, name: meta.longName || meta.shortName || meta.symbol };
}
function nameOf(x, d){ return esc((d && d.meta && (d.meta.longName || d.meta.shortName)) || x.name || x.sym); }
async function goldInr(d){
  try { const fx = await getHist('INR=X', '5d', '1d'); const r = fx.meta.regularMarketPrice || fx.c[fx.c.length-1]; return r; } catch(e){ return null; }
}

async function hQuote(x){
  let d; try { d = await getHist(x.sym, '1y', '1d'); } catch(e){ return notFound(x); }
  const q = snapshot(d), m = d.meta;
  let h = `<b>${nameOf(x, d)}</b> <span class="s-fine">${esc(x.sym)}</span><div><b class="s-big">${money(q.last, m)}</b> <span class="${cls(q.chg)}">${sgn(q.chg)}</span></div>`;
  if (x.sym === 'GC=F' || x.sym === 'SI=F'){
    const fx = await goldInr();
    if (fx){ const perGram = q.last*fx/31.1035; h += row(x.sym === 'GC=F' ? L('≈ per 10 g in ₹ (before duty/GST)','≈ ₹ प्रति 10 ग्राम (ड्यूटी/GST से पहले)','≈ ₹/10g (duty/GST se pehle)') : L('≈ per kg in ₹ (before duty/GST)','≈ ₹ प्रति किलो (ड्यूटी/GST से पहले)','≈ ₹/kg (duty/GST se pehle)'), `<b>${inr0(perGram*(x.sym === 'GC=F' ? 10 : 1000))}</b>`); }
  }
  h += row(L('Previous close','पिछला बंद','Pichhla close'), money(q.prev, m));
  if (q.dayH && q.dayL) h += row(L('Day range','आज की रेंज','Aaj ki range'), `${money(q.dayL, m)} – ${money(q.dayH, m)}`);
  h += row(L('52-week range','52-हफ्ते की रेंज','52-week range'), `${money(q.lo52, m)} – ${money(q.hi52, m)}`);
  h += row(L('From 52-week high','52-हफ्ते ऊँचे से','52W high se'), sgn((q.last/q.hi52-1)*100), cls(q.last-q.hi52));
  if (q.vol) h += row(L('Volume','वॉल्यूम','Volume'), num(q.vol));
  h += `<div class="s-fine">${L('Yahoo Finance data via the app proxy; may be delayed.','Yahoo Finance डेटा; देरी संभव।','Yahoo Finance data; delay ho sakta hai.')}</div>`;
  return { html: h, actions: [{ label: L('Technical view','टेक्निकल व्यू','Technical view'), ask: techAsk(x) }, { label: L('Returns','रिटर्न','Returns'), ask: retAsk(x) }] };
}
const techAsk = x => ({ en: `${x.name} technical`, hi: `${x.name} technical`, hn: `${x.name} technical` }[LANG] || `${x.name} technical`);
const retAsk = x => `${x.name} returns`;
function notFound(x){
  return { html: L(`I couldn't fetch data for <b>${esc(x.name || x.sym)}</b>. Try the exact NSE name or symbol, e.g. <i>"HDFCBANK price"</i>.`,
                   `<b>${esc(x.name || x.sym)}</b> का डेटा नहीं मिला। सही NSE नाम या सिंबल लिखें, जैसे <i>"HDFCBANK price"</i>।`,
                   `<b>${esc(x.name || x.sym)}</b> ka data nahi mila. Sahi NSE naam/symbol likho, jaise <i>"HDFCBANK price"</i>.`) };
}

async function hTech(x){
  let d; try { d = await getHist(x.sym, '1y', '1d'); } catch(e){ return notFound(x); }
  const c = d.c, m = d.meta, q = snapshot(d);
  const s20 = smaArr(c,20), s50 = smaArr(c,50), s200 = smaArr(c,200), rsi = rsiArr(c,14), vol = volAnn(c);
  const n = c.length, H = d.h[n-2], Lo = d.l[n-2], C = c[n-2];
  const P = (H+Lo+C)/3, R1 = 2*P-Lo, S1 = 2*P-H, R2 = P+(H-Lo), S2 = P-(H-Lo);
  const lo20 = Math.min(...d.l.slice(-20).filter(v=>v!=null)), hi20 = Math.max(...d.h.slice(-20).filter(v=>v!=null));
  let trend, tcls;
  if (s50 && s200 && q.last > s50 && s50 > s200){ trend = L('Uptrend (price > 50 DMA > 200 DMA)','अपट्रेंड (भाव > 50 DMA > 200 DMA)','Uptrend (price > 50 DMA > 200 DMA)'); tcls = 'up'; }
  else if (s50 && s200 && q.last < s50 && s50 < s200){ trend = L('Downtrend (price < 50 DMA < 200 DMA)','डाउनट्रेंड (भाव < 50 DMA < 200 DMA)','Downtrend (price < 50 DMA < 200 DMA)'); tcls = 'down'; }
  else { trend = L('Sideways / mixed','साइडवेज़ / मिला-जुला','Sideways / mixed'); tcls = 'gold'; }
  const rsiTxt = rsi == null ? '—' : rsi.toFixed(0) + (rsi >= 70 ? L(' · overbought',' · ओवरबॉट',' · overbought') : rsi <= 30 ? L(' · oversold',' · ओवरसोल्ड',' · oversold') : L(' · neutral',' · न्यूट्रल',' · neutral'));
  const vsMA = (ma) => ma ? `${money(ma, m)} <span class="${cls(q.last-ma)}">(${sgn((q.last/ma-1)*100,1)})</span>` : '—';
  let h = `<b>${nameOf(x, d)}</b> · ${money(q.last, m)} <span class="${cls(q.chg)}">${sgn(q.chg)}</span>`;
  h += row(`<b>${L('Trend','ट्रेंड','Trend')}</b>`, `<b class="${tcls}">${trend}</b>`);
  h += row('RSI (14)', rsiTxt, rsi >= 70 ? 'down' : rsi <= 30 ? 'up' : '');
  h += row('20 DMA', vsMA(s20)) + row('50 DMA', vsMA(s50)) + row('200 DMA', vsMA(s200));
  h += row(L('Support (S1 / S2)','सपोर्ट (S1 / S2)','Support (S1 / S2)'), `${money(S1, m)} / ${money(S2, m)}`, 'up');
  h += row(L('Resistance (R1 / R2)','रेज़िस्टेंस (R1 / R2)','Resistance (R1 / R2)'), `${money(R1, m)} / ${money(R2, m)}`, 'down');
  h += row(L('20-day range','20-दिन की रेंज','20-din range'), `${money(lo20, m)} – ${money(hi20, m)}`);
  h += row(L('52-week position','52-हफ्ते में स्थिति','52W position'), `${q.pos52.toFixed(0)}% ${L('of range','रेंज का','range ka')}`);
  h += row(L('Volatility (annualised)','अस्थिरता (सालाना)','Volatility (saalana)'), vol.toFixed(1) + '%');
  h += `<div class="s-fine">${L('Pivots from the last full session. A statistical read of past prices — not a buy/sell recommendation.','पिवट पिछले पूरे सत्र से। पिछले भावों का सांख्यिकीय आकलन — खरीद/बिक्री की सलाह नहीं।','Pivots last session se. Past prices ka read — buy/sell advice nahi.')}</div>`;
  return { html: h, say: `${nameOf(x,d)}. ${trend}. RSI ${rsi ? rsi.toFixed(0) : ''}.` };
}

function periodFromE(E){
  if (E.dates.length){ return { from: E.dates[0], label: fmtDate(E.dates[0]) }; }
  const s = E.s;
  if (/\bytd\b|this year|is saal|इस साल|since jan/.test(s)){ const f = new Date(istNow().getFullYear(), 0, 1); return { from: f, label: L('year to date','इस साल अब तक','is saal ab tak') }; }
  let days = E.days || 0;
  if (!days){ if (/\bweek|hafte|हफ्ते/.test(s)) days = 7; else if (/\bmonth|mahine|महीने/.test(s)) days = 30; }
  if (!days) days = 365;
  const f = new Date(); f.setDate(f.getDate() - Math.round(days));
  const lab = days >= 365 ? `${+(days/365).toFixed(1)} ${L('year','साल','saal')}` : days >= 28 ? `${Math.round(days/30.4)} ${L('month','महीने','mahine')}` : `${Math.round(days)} ${L('days','दिन','din')}`;
  return { from: f, label: lab, days };
}
function pickRange(from){ const age = (Date.now() - from)/864e5; return age <= 360 ? ['1y','1d'] : age <= 1800 ? ['5y','1wk'] : ['max','1mo']; }
function closeAt(d, when){ let idx = 0; for (let i = 0; i < d.t.length; i++){ if (d.t[i] <= when.getTime() + 864e5) idx = i; else break; } return { v: d.c[idx], t: new Date(d.t[idx]) }; }

async function hReturns(x, E, showTable){
  const p = periodFromE(E);
  const [range, interval] = pickRange(p.from);
  let d; try { d = await getHist(x.sym, range, interval); } catch(e){ return notFound(x); }
  const m = d.meta, last = m.regularMarketPrice || d.c[d.c.length-1];
  const start = closeAt(d, p.from);
  const ret = (last/start.v - 1)*100, yrs = (Date.now() - start.t)/864e5/365;
  const amt = E.amounts[0];
  let h = `<b>${nameOf(x, d)}</b> · ${L('return over','रिटर्न —','return —')} ${esc(p.label)}`;
  h += row(`${esc(start.t.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}))} → ${L('now','अब','ab')}`, `${money(start.v, m)} → ${money(last, m)}`);
  h += row(`<b>${L('Return','रिटर्न','Return')}</b>`, `<b class="s-big ${cls(ret)}">${sgn(ret)}</b>`);
  if (yrs > 1.05) h += row('CAGR', sgn((Math.pow(last/start.v, 1/yrs)-1)*100), cls(ret));
  if (amt) h += row(L(`${inrShort(amt)} invested then is now`,`तब लगाए ${inrShort(amt)} अब`,`Tab lagaye ${inrShort(amt)} ab`), `<b class="${cls(ret)}">${inrShort(amt*last/start.v)}</b>`);
  if (showTable !== false && range === '1y'){
    const c = d.c, rows = [[5,'1W','1 हफ्ता'],[21,'1M','1 महीना'],[63,'3M','3 महीने'],[126,'6M','6 महीने'],[c.length-1,'1Y','1 साल']];
    h += '<table class="s-tbl"><tr>' + rows.map(r => `<th>${LANG==='hi'?r[2]:r[1]}</th>`).join('') + '</tr><tr>' + rows.map(r => { const v = retN(c, r[0]); return `<td class="${v==null?'':cls(v)}">${v==null?'—':sgn(v,1)}</td>`; }).join('') + '</tr></table>';
    h += row(L('Max drawdown (1Y)','अधिकतम गिरावट (1 साल)','Max girawat (1Y)'), sgn(maxDD(c),1), 'down');
  }
  h += `<div class="s-fine">${L('Price return only (dividends not included). Past returns don\'t guarantee future returns.','केवल भाव रिटर्न (लाभांश शामिल नहीं)। पिछला रिटर्न भविष्य की गारंटी नहीं।','Sirf price return (dividend nahi). Past return future ki guarantee nahi.')}</div>`;
  return { html: h };
}

async function hCompareStocks(list, E){
  const out = await Promise.all(list.slice(0,4).map(async x => { try { return { x, d: await getHist(x.sym, '1y', '1d') }; } catch(e){ return { x, d: null }; } }));
  const ok = out.filter(o => o.d);
  if (!ok.length) return notFound(list[0]);
  const cols = [[1,'1D'],[5,'1W'],[21,'1M'],[63,'3M'],[126,'6M'],[null,'1Y']];
  let h = `<b>${L('Comparison','तुलना','Comparison')}</b><table class="s-tbl"><tr><th></th>${ok.map(o => `<th>${esc(o.x.name.split(' ')[0])}</th>`).join('')}</tr>`;
  h += `<tr><td>${L('Price','भाव','Price')}</td>${ok.map(o => `<td>${money(o.d.meta.regularMarketPrice || o.d.c[o.d.c.length-1], o.d.meta)}</td>`).join('')}</tr>`;
  cols.forEach(([n, lab]) => { h += `<tr><td>${lab}</td>${ok.map(o => { const v = retN(o.d.c, n == null ? o.d.c.length-1 : n); return `<td class="${v==null?'':cls(v)}">${v==null?'—':sgn(v,1)}</td>`; }).join('')}</tr>`; });
  h += `<tr><td>RSI</td>${ok.map(o => { const r = rsiArr(o.d.c); return `<td>${r==null?'—':r.toFixed(0)}</td>`; }).join('')}</tr>`;
  h += `<tr><td>${L('vs 200 DMA','200 DMA से','vs 200 DMA')}</td>${ok.map(o => { const s = smaArr(o.d.c,200), l = o.d.c[o.d.c.length-1]; return `<td class="${s?cls(l-s):''}">${s?sgn((l/s-1)*100,1):'—'}</td>`; }).join('')}</tr>`;
  h += `<tr><td>${L('Volatility','अस्थिरता','Volatility')}</td>${ok.map(o => `<td>${volAnn(o.d.c).toFixed(0)}%</td>`).join('')}</tr>`;
  h += `<tr><td>${L('From 52W high','52W ऊँचे से','52W high se')}</td>${ok.map(o => { const q = snapshot(o.d); return `<td class="${cls(q.last-q.hi52)}">${sgn((q.last/q.hi52-1)*100,1)}</td>`; }).join('')}</tr></table>`;
  h += `<div class="s-fine">${L('Price returns; not a recommendation.','केवल भाव रिटर्न; सलाह नहीं।','Sirf price return; advice nahi.')}</div>`;
  return { html: h };
}


// ---------------------------------------------------------------------
// 6f. Stock-market glossary (English / हिंदी; Hinglish falls back to English)
// ---------------------------------------------------------------------
const G = (rx, en, hi, hn) => ({ rx, en, hi, hn });
const GLOSSARY = [
  G(/\bmtf\b|margin trading/, '<b>MTF (Margin Trading Facility)</b> — you pay ~20%, the broker lends ~80% (5× position) and charges daily interest (Angel One 14.99%, Kotak Pro 9.69%, Kotak Std 14.99% p.a.). Profit and loss are both 5× bigger, and interest eats the gain each day you hold.',
    '<b>MTF (मार्जिन ट्रेडिंग)</b> — आप ~20% देते हैं, ब्रोकर ~80% उधार देता है (5× पोज़िशन) और रोज़ ब्याज लेता है (Angel One 14.99%, Kotak Pro 9.69%, Kotak Std 14.99% सालाना)। लाभ-हानि दोनों 5×, और हर दिन ब्याज मुनाफ़ा घटाता है।',
    '<b>MTF</b> — aap ~20% dete ho, broker ~80% udhaar deta hai (5× position) aur roz interest leta hai. Profit aur loss dono 5×, interest roz profit khata hai.'),
  G(/\bstt\b|securities transaction/, '<b>STT (Securities Transaction Tax)</b> — government tax: 0.1% on both buy and sell for delivery/MTF; 0.025% on the sell side only for intraday.',
    '<b>STT</b> — सरकारी टैक्स: डिलीवरी/MTF में खरीद-बिक्री दोनों पर 0.1%; इंट्राडे में केवल बिक्री पर 0.025%।', '<b>STT</b> — sarkari tax: delivery/MTF mein buy-sell dono pe 0.1%; intraday mein sirf sell pe 0.025%.'),
  G(/break ?even|ब्रेकईवन/, '<b>Breakeven</b> — the exit price where net P&L is exactly zero after every charge (and MTF interest). Sell above it for a real profit.',
    '<b>ब्रेकईवन</b> — वह बिक्री भाव जहाँ सारे चार्ज (और MTF ब्याज) के बाद लाभ/हानि शून्य हो।', '<b>Breakeven</b> — wo exit price jahan saare charges ke baad P&L zero ho.'),
  G(/gift ?nifty/, '<b>GIFT Nifty</b> — Nifty futures traded at GIFT City almost round the clock. Its gap vs. yesterday\'s Nifty close hints at the opening; it carries the highest weight (3.0) in this app\'s bias score.',
    '<b>GIFT निफ्टी</b> — GIFT City में लगभग 24 घंटे चलने वाला निफ्टी फ्यूचर्स। कल के क्लोज़ से इसका गैप ओपनिंग का संकेत देता है; बायस स्कोर में सबसे ज़्यादा वज़न (3.0)।'),
  G(/\bvix\b/, '<b>India VIX</b> — the market\'s "fear gauge": expected Nifty volatility over the next 30 days. Above ~20 = nervous market; below ~13 = calm. A rising VIX counts against the bias score here.',
    '<b>India VIX</b> — बाज़ार का "डर मापक": अगले 30 दिनों की अपेक्षित निफ्टी अस्थिरता। ~20 से ऊपर = घबराहट; ~13 से नीचे = शांत।'),
  G(/pre.?open/, '<b>Pre-open session</b> — 9:00–9:08 AM order entry, then matching till 9:15; it discovers the opening price.',
    '<b>प्री-ओपन सत्र</b> — सुबह 9:00–9:08 ऑर्डर एंट्री, फिर 9:15 तक मिलान; इससे ओपनिंग भाव तय होता है।'),
  G(/delivery|intraday|डिलीवरी|इंट्राडे|\bcnc\b|\bmis\b/, '<b>Delivery (CNC) vs Intraday (MIS)</b> — delivery shares land in your demat (STT 0.1% both sides, ₹23.60 DP charge on sell). Intraday is squared off the same day (STT 0.025% on sell only, no DP charge).',
    '<b>डिलीवरी बनाम इंट्राडे</b> — डिलीवरी में शेयर डीमैट में आते हैं (STT दोनों तरफ़ 0.1%, बिक्री पर ₹23.60 DP)। इंट्राडे उसी दिन बंद (STT सिर्फ़ बिक्री पर 0.025%)।'),
  G(/\bdp charge|\bdp\b/, '<b>DP charge</b> — ₹23.60 (incl. GST) flat per sell of delivery holdings, charged by the depository via your broker.', '<b>DP चार्ज</b> — डिलीवरी होल्डिंग बेचने पर हर बार ₹23.60 (GST सहित)।'),
  G(/niftybees|nifty bees/, '<b>NIFTYBEES</b> — Nippon India\'s Nifty 50 ETF. One unit tracks the Nifty 50 index (roughly Nifty ÷ 100 in price), trades like a share on NSE, and is taxed like equity.',
    '<b>NIFTYBEES</b> — निप्पॉन इंडिया का निफ्टी 50 ETF। यह निफ्टी 50 को ट्रैक करता है, NSE पर शेयर की तरह ट्रेड होता है और इक्विटी की तरह टैक्स लगता है।'),
  G(/\betf\b|exchange traded fund/, '<b>ETF</b> — a fund that holds a basket (an index, gold, etc.) and trades on the exchange like a share. Low cost; you need a demat account.',
    '<b>ETF</b> — एक फंड जो किसी इंडेक्स/सोने आदि की टोकरी रखता है और शेयर की तरह एक्सचेंज पर ट्रेड होता है।'),
  G(/\bnav\b|\binav\b/, '<b>NAV / iNAV</b> — NAV is the fund\'s per-unit value at day-end; iNAV is its live indicative value. An ETF price far above iNAV means you are overpaying.',
    '<b>NAV / iNAV</b> — NAV दिन के अंत का प्रति यूनिट मूल्य; iNAV लाइव अनुमानित मूल्य। ETF भाव iNAV से बहुत ऊपर हो तो आप ज़्यादा दे रहे हैं।'),
  G(/expense ratio/, '<b>Expense ratio</b> — the yearly fee a fund deducts from its value, as % of assets. Index ETFs are among the cheapest.', '<b>एक्सपेंस रेशियो</b> — फंड का सालाना शुल्क (संपत्ति का %)। इंडेक्स ETF सबसे सस्ते में।'),
  G(/tracking error/, '<b>Tracking error</b> — how much an index fund/ETF\'s return differs from the index it copies. Lower is better.', '<b>ट्रैकिंग एरर</b> — इंडेक्स फंड का रिटर्न इंडेक्स से कितना अलग है। कम बेहतर।'),
  G(/cagr/, '<b>CAGR</b> — compound annual growth rate: the steady yearly return that turns the start value into the end value.', '<b>CAGR</b> — चक्रवृद्धि वार्षिक वृद्धि दर: वह स्थिर सालाना रिटर्न जो शुरुआती राशि को अंतिम राशि बनाता है।'),
  G(/xirr/, '<b>XIRR</b> — annualised return when money goes in at different dates (like SIPs). The right way to measure SIP returns.', '<b>XIRR</b> — अलग-अलग तारीखों पर निवेश (जैसे SIP) का सालाना रिटर्न।'),
  G(/\bsip\b/, '<b>SIP</b> — investing a fixed amount every month; you buy more units when prices are low (rupee-cost averaging).', '<b>SIP</b> — हर महीने तय राशि का निवेश; भाव कम होने पर ज़्यादा यूनिट मिलते हैं।'),
  G(/signal|confidence/, '<b>30–60 min signal</b> — built from the last 30 min of trend (35%), volume build-up (30%), EMA 9/21 gap acceleration (25%) and an RSI(14) guard (10%). BUY ≥ +30, SELL ≤ −30, else HOLD. A statistical read, not advice.',
    '<b>30–60 मिनट सिग्नल</b> — पिछले 30 मिनट के ट्रेंड (35%), वॉल्यूम (30%), EMA 9/21 (25%) और RSI(14) (10%) से। +30 से ऊपर BUY, −30 से नीचे SELL, बाकी HOLD।'),
  G(/bias|score/, '<b>Bias score</b> — weighted lean from GIFT Nifty (3.0), NSE pre-open (2.5), US (1.5), Asia (1.0), USD/INR (0.5) and VIX (0.5). Above +0.35 = bullish, below −0.35 = bearish.',
    '<b>बायस स्कोर</b> — GIFT निफ्टी (3.0), प्री-ओपन (2.5), अमेरिका (1.5), एशिया (1.0), USD/INR (0.5), VIX (0.5) का भारित झुकाव। +0.35 से ऊपर तेजी, −0.35 से नीचे मंदी।'),
  G(/\brsi\b|relative strength/, '<b>RSI (14)</b> — momentum from 0 to 100. Above 70 = overbought (may cool off), below 30 = oversold (may bounce). Strong trends can stay extreme for long.',
    '<b>RSI (14)</b> — 0 से 100 का मोमेंटम। 70 से ऊपर ओवरबॉट, 30 से नीचे ओवरसोल्ड। मज़बूत ट्रेंड में लंबे समय तक ऐसा रह सकता है।'),
  G(/\bdma\b|\bsma\b|moving average|\bema\b/, '<b>Moving average (DMA/SMA/EMA)</b> — average closing price over N days. Price above the 200 DMA = long-term uptrend; 50 DMA crossing above 200 DMA = "golden cross", below = "death cross". EMA gives more weight to recent days.',
    '<b>मूविंग एवरेज</b> — N दिनों का औसत बंद भाव। भाव 200 DMA से ऊपर = लंबा अपट्रेंड; 50 DMA का 200 DMA को ऊपर काटना "गोल्डन क्रॉस", नीचे "डेथ क्रॉस"। EMA हाल के दिनों को ज़्यादा वज़न देता है।'),
  G(/\bmacd\b/, '<b>MACD</b> — difference between the 12- and 26-day EMAs, with a 9-day signal line. MACD crossing above the signal = bullish momentum, below = bearish.', '<b>MACD</b> — 12 और 26 दिन के EMA का अंतर, 9 दिन की सिग्नल लाइन के साथ। ऊपर काटे तो तेजी, नीचे तो मंदी का संकेत।'),
  G(/bollinger/, '<b>Bollinger Bands</b> — 20-day average ± 2 standard deviations. Bands squeezing = low volatility (a big move may follow); price at the upper band = stretched.', '<b>बोलिंजर बैंड</b> — 20 दिन का औसत ± 2 मानक विचलन। बैंड सिकुड़ें तो बड़ी चाल आ सकती है।'),
  G(/\bvwap\b/, '<b>VWAP</b> — volume-weighted average price for the day. Intraday traders treat price above VWAP as strength, below as weakness.', '<b>VWAP</b> — दिन का वॉल्यूम-भारित औसत भाव। उससे ऊपर = मज़बूती, नीचे = कमज़ोरी।'),
  G(/support|resistance|pivot/, '<b>Support / resistance / pivots</b> — support is a level where buying has stopped falls before; resistance is where selling has capped rises. Pivot points: P = (H+L+C)/3, R1 = 2P−L, S1 = 2P−H.',
    '<b>सपोर्ट / रेज़िस्टेंस</b> — सपोर्ट वह स्तर जहाँ पहले गिरावट रुकी; रेज़िस्टेंस जहाँ बढ़त रुकी। पिवट: P = (H+L+C)/3, R1 = 2P−L, S1 = 2P−H।'),
  G(/stop ?loss|stoploss|\bsl\b|trailing/, '<b>Stop-loss</b> — a pre-set exit that limits your loss (SL = limit, SL-M = market). A trailing stop moves up as price rises. Gap openings can fill below your SL.',
    '<b>स्टॉप-लॉस</b> — पहले से तय एग्ज़िट जो नुकसान सीमित करता है (SL = लिमिट, SL-M = मार्केट)। ट्रेलिंग स्टॉप भाव के साथ ऊपर खिसकता है।'),
  G(/limit order|market order|order type|\bamo\b|\bgtt\b|bracket order|cover order/, '<b>Order types</b> — Market (fill now at best price), Limit (only at your price or better), SL/SL-M (triggered stop), AMO (placed after hours for next open), GTT (stays active up to a year until your trigger hits).',
    '<b>ऑर्डर के प्रकार</b> — मार्केट (अभी सबसे अच्छे भाव पर), लिमिट (आपके भाव या बेहतर पर), SL/SL-M (ट्रिगर स्टॉप), AMO (बाज़ार बंद होने के बाद, अगली ओपनिंग के लिए), GTT (ट्रिगर तक एक साल तक सक्रिय)।'),
  G(/circuit|upper circuit|lower circuit|price band/, '<b>Circuit limits</b> — a stock\'s daily price band (2%, 5%, 10% or 20%). At upper circuit there are only buyers; at lower circuit only sellers. Index-wide circuit breakers halt the whole market at 10/15/20% moves.',
    '<b>सर्किट</b> — शेयर की दैनिक भाव सीमा (2/5/10/20%)। अपर सर्किट पर केवल खरीदार, लोअर पर केवल विक्रेता। इंडेक्स 10/15/20% हिलने पर पूरा बाज़ार रुकता है।'),
  G(/\bt\+1\b|settlement/, '<b>T+1 settlement</b> — shares bought today are credited to your demat the next trading day; sale money is also paid out T+1.', '<b>T+1 सेटलमेंट</b> — आज खरीदे शेयर अगले ट्रेडिंग दिन डीमैट में; बिक्री का पैसा भी T+1 पर।'),
  G(/\bbtst\b|\bstbt\b/, '<b>BTST / STBT</b> — buy today, sell tomorrow (before delivery). Risky: if the seller fails to deliver, the auction penalty can hit you. STT and DP charges still apply as delivery.', '<b>BTST</b> — आज खरीदें, कल बेचें (डिलीवरी से पहले)। जोखिम: शॉर्ट डिलीवरी पर नीलामी दंड।'),
  G(/\bp\/?e\b|pe ratio|price to earning|\beps\b/, '<b>P/E ratio</b> — price ÷ earnings per share: how many years of current profit you are paying for. Compare only within the same sector.', '<b>P/E अनुपात</b> — भाव ÷ प्रति शेयर आय। एक ही सेक्टर में तुलना करें।'),
  G(/\bp\/?b\b|price to book|book value/, '<b>P/B & book value</b> — book value is net assets per share; P/B = price ÷ book value. Useful for banks and asset-heavy firms.', '<b>P/B और बुक वैल्यू</b> — प्रति शेयर शुद्ध संपत्ति; P/B = भाव ÷ बुक वैल्यू। बैंकों के लिए उपयोगी।'),
  G(/\broe\b|\broce\b/, '<b>ROE / ROCE</b> — profit earned on shareholders\' equity / on all capital employed. Consistently above ~15% suggests a quality business.', '<b>ROE / ROCE</b> — शेयरधारकों की पूँजी / कुल लगी पूँजी पर मुनाफ़ा। लगातार ~15% से ऊपर अच्छा संकेत।'),
  G(/market cap|large ?cap|mid ?cap|small ?cap/, '<b>Market cap</b> — share price × total shares. In India, large caps = top 100 companies, mid caps = 101–250, small caps = 251 onwards (SEBI classification).', '<b>मार्केट कैप</b> — भाव × कुल शेयर। लार्ज कैप = शीर्ष 100, मिड कैप = 101–250, स्मॉल कैप = 251 के बाद।'),
  G(/dividend|लाभांश|record date|ex.?date/, '<b>Dividend</b> — profit paid to shareholders. You must hold the shares at the end of the ex-date\'s previous day (record date under T+1). Taxed at your slab; TDS 10% above ₹10,000/year per company.',
    '<b>लाभांश</b> — शेयरधारकों को दिया मुनाफ़ा। एक्स-डेट से पहले शेयर होने चाहिए। स्लैब से टैक्स; एक कंपनी से ₹10,000/साल से ऊपर 10% TDS।'),
  G(/\bbonus\b|stock split|\bsplit\b/, '<b>Bonus & split</b> — both give you more shares at a proportionally lower price; your total value doesn\'t change on the day.', '<b>बोनस और स्प्लिट</b> — दोनों में ज़्यादा शेयर, भाव उसी अनुपात में कम; कुल मूल्य उस दिन नहीं बदलता।'),
  G(/buyback|buy back/, '<b>Buyback</b> — the company buys its own shares, usually at a premium. Tendered shares are taxed under capital-gains rules.', '<b>बायबैक</b> — कंपनी अपने शेयर वापस खरीदती है, अक्सर प्रीमियम पर।'),
  G(/\bipo\b|listing|\bgmp\b|allotment/, '<b>IPO</b> — a company\'s first share sale. Apply via UPI/ASBA; allotment is by lottery when oversubscribed; listing follows ~3 days after close (T+3). GMP is unofficial grey-market chatter, not a guarantee.',
    '<b>IPO</b> — कंपनी की पहली शेयर बिक्री। UPI/ASBA से आवेदन; ज़्यादा आवेदन पर लॉटरी; बंद होने के ~3 दिन बाद लिस्टिंग। GMP अनौपचारिक, गारंटी नहीं।'),
  G(/\bf ?& ?o\b|\bfno\b|futures?|options?|call option|put option|\bcall\b|\bput\b|expiry|lot size|premium|strike/, '<b>F&O</b> — futures = obligation to buy/sell at a set price on expiry; options = the right (not obligation): a Call gains when price rises, a Put when it falls. Traded in lots with high leverage; most retail traders lose money here per SEBI studies.',
    '<b>F&O</b> — फ्यूचर्स = तय भाव पर एक्सपायरी पर खरीदने/बेचने की बाध्यता; ऑप्शन = अधिकार: कॉल भाव बढ़ने पर, पुट गिरने पर फ़ायदा देता है। लॉट में, भारी लीवरेज; SEBI अध्ययन के अनुसार अधिकांश खुदरा ट्रेडर नुकसान में।'),
  G(/short sell|shorting|short selling/, '<b>Short selling</b> — selling first and buying back later to profit from a fall. In the cash market it must be squared off the same day (intraday).', '<b>शॉर्ट सेलिंग</b> — पहले बेचकर बाद में खरीदना ताकि गिरावट से फ़ायदा हो। कैश मार्केट में उसी दिन बंद करना ज़रूरी।'),
  G(/\bdemat\b|\bcdsl\b|\bnsdl\b|\bisin\b/, '<b>Demat account</b> — holds your shares electronically at CDSL or NSDL. Each security has a unique ISIN code.', '<b>डीमैट खाता</b> — आपके शेयर इलेक्ट्रॉनिक रूप में CDSL/NSDL में रखता है। हर सिक्योरिटी का एक ISIN कोड।'),
  G(/\bpledge\b|margin pledge|collateral/, '<b>Pledge</b> — using your holdings as collateral to get trading margin (after a haircut). The shares stay yours, but can be sold if you default on margin.', '<b>प्लेज</b> — होल्डिंग को गिरवी रखकर ट्रेडिंग मार्जिन लेना (हेयरकट के बाद)।'),
  G(/\bfii\b|\bfpi\b|\bdii\b/, '<b>FII / DII</b> — foreign vs domestic institutional investors (mutual funds, insurers). Their daily net buying/selling often drives big index moves.', '<b>FII / DII</b> — विदेशी बनाम घरेलू संस्थागत निवेशक। इनकी खरीद-बिक्री से इंडेक्स में बड़ी चाल आती है।'),
  G(/bull|bear|correction|crash|रैली|तेजी|मंदी/, '<b>Bull / bear / correction</b> — bull market = sustained rise; bear market = fall of 20%+ from the peak; correction = 10–20% fall.', '<b>तेजी / मंदी / करेक्शन</b> — तेजी = लगातार बढ़त; मंदी = शिखर से 20%+ गिरावट; करेक्शन = 10–20% गिरावट।'),
  G(/gap up|gap down|gap/, '<b>Gap up / gap down</b> — the market opens well above / below the previous close, usually after overnight news or global moves.', '<b>गैप अप / गैप डाउन</b> — पिछले बंद से काफ़ी ऊपर/नीचे ओपनिंग, अक्सर रात की ख़बरों से।'),
  G(/\bbeta\b|volatility|अस्थिरता/, '<b>Volatility & beta</b> — volatility is how much a price swings (annualised std. dev.); beta compares a stock\'s moves with the index (beta 1.5 ≈ moves 1.5× the Nifty).', '<b>अस्थिरता और बीटा</b> — अस्थिरता = भाव कितना झूलता है; बीटा = इंडेक्स की तुलना में चाल (1.5 ≈ निफ्टी से 1.5×)।'),
  G(/liquidity|bid|ask|spread|market maker/, '<b>Liquidity & spread</b> — the gap between the best buy (bid) and sell (ask) prices. Liquid ETFs like NIFTYBEES have tiny spreads; use limit orders in thin stocks.', '<b>लिक्विडिटी और स्प्रेड</b> — सबसे अच्छे खरीद (बिड) और बिक्री (आस्क) भाव का अंतर। कम ट्रेड वाले शेयर में लिमिट ऑर्डर लगाएँ।'),
  G(/\basm\b|\bgsm\b|surveillance/, '<b>ASM / GSM</b> — exchange surveillance lists for unusually volatile or risky stocks; they bring higher margins and trading restrictions.', '<b>ASM / GSM</b> — असामान्य रूप से अस्थिर शेयरों की निगरानी सूची; ज़्यादा मार्जिन और प्रतिबंध।'),
  G(/ltcg|stcg|capital gain|tax/, '<b>Capital-gains tax (equity & equity ETFs)</b> — held ≤ 12 months: STCG 20%; held > 12 months: LTCG 12.5% above ₹1.25 lakh a year; plus 4% cess. Intraday = speculative income at slab; F&O = business income at slab.',
    '<b>पूँजीगत लाभ कर</b> — 12 महीने तक: STCG 20%; 12 महीने से ज़्यादा: ₹1.25 लाख/वर्ष से ऊपर LTCG 12.5%; ऊपर से 4% सेस। इंट्राडे = सट्टा आय (स्लैब); F&O = व्यावसायिक आय (स्लैब)।'),
  G(/tax.?loss harvest|harvest/, '<b>Tax harvesting</b> — booking up to ₹1.25 lakh of long-term gains each year (and re-buying) uses the yearly exemption; booking losses offsets gains.', '<b>टैक्स हार्वेस्टिंग</b> — हर साल ₹1.25 लाख तक LTCG बुक करके (फिर खरीदकर) छूट का उपयोग।'),
  G(/muhurat|मुहूर्त/, '<b>Muhurat trading</b> — a one-hour special session on Diwali. In 2026 it is on Sunday, 8 November; NSE announces the timing.', '<b>मुहूर्त ट्रेडिंग</b> — दिवाली पर एक घंटे का विशेष सत्र। 2026 में रविवार, 8 नवंबर को।'),
  G(/rupee cost|averaging|average down|average up/, '<b>Averaging</b> — buying more at a lower price lowers your average cost ("averaging down"). It helps only if the stock recovers — don\'t average a broken story.', '<b>एवरेजिंग</b> — कम भाव पर और खरीदने से औसत लागत घटती है। तभी फ़ायदेमंद जब शेयर उबरे।'),
];
function glossaryHit(s){ return GLOSSARY.find(g => g.rx.test(s)); }
const gText = g => g[LANG] || (LANG === 'hn' && g.en) || g.en;

function hHelp(greet){
  const intro = greet
    ? L('Namaste! I\'m <b>Surya</b> — ask me anything about this page, NIFTYBEES or any stock.','नमस्ते! मैं <b>सूर्य</b> हूँ — इस पेज, NIFTYBEES या किसी भी शेयर के बारे में पूछिए।','Namaste! Main <b>Surya</b> hoon — is page, NIFTYBEES ya kisi bhi stock ke baare mein poochho.')
    : L('Here\'s what I can do:','मैं ये कर सकता हूँ:','Main ye kar sakta hoon:');
  const ex = LANG === 'hi'
    ? ['अभी का भाव क्या है?','रिलायंस का भाव','टीसीएस टेक्निकल','50000 लगाऊँ तो कितने यूनिट आएँगे?','500 यूनिट 280 पर लिए, 292 पर बेचूँ तो मुनाफ़ा?','80000 मुनाफ़े पर टैक्स, 8 महीने होल्ड','क्या आज बाज़ार खुला है?','RSI क्या है?']
    : LANG === 'hn'
    ? ['aaj ka bhav kya hai','reliance ka price','tcs technical','50000 lagau to kitne units','500 units 280 pe liye 292 pe becha to profit?','80000 profit pe tax 8 mahine hold','aaj market khula hai?','infosys vs tcs compare']
    : ['What\'s the live price?','Reliance share price','HDFC Bank technical view','Nifty 1 year return','Compare TCS and Infosys','Invest ₹50,000 — how many units?','500 units at 280, sell at 292 — profit?','Capital 5 lakh, risk 1%, entry 285, SL 279 — position size','Tax on ₹80,000 profit held 8 months','Is the market open today?','What is RSI?'];
  return { html: `${intro}<ul class="s-list s-ex">${ex.map(e => `<li data-ask="${esc(e)}">${esc(e)}</li>`).join('')}</ul><div class="s-fine">${L('Type in any language, or tap 🎤 and just speak — Hindi, English or Hinglish is detected automatically.','किसी भी भाषा में लिखें, या 🎤 दबाकर बोलें — हिंदी, English या Hinglish अपने आप पहचानी जाती है।','Kisi bhi bhasha mein likho, ya 🎤 dabake bolo — Hindi, English ya Hinglish apne aap samajh jaata hai.')}</div>` };
}


// ---------------------------------------------------------------------
// 7. Router
// ---------------------------------------------------------------------
const K = {
  greet:   /^\s*(hi+|hello|hey|namaste|namaskar|hola|good (morning|evening|afternoon)|नमस्ते|नमस्कार|हेलो|हाय)\s*[!.]?\s*(surya|सूर्य)?\s*$/,
  help:    /\b(help|madad|what can you|how to use|kaise use|examples?)\b|मदद|क्या कर सकते/,
  explain: /\b(what is|what's|whats|what are|kya hai|kya hota|kya hoti|kya hote|meaning|matlab|explain|samjhao|samjha|define|kise kehte)\b|क्या है|क्या होता|क्या होती|मतलब|समझाओ|समझाइए|किसे कहते/,
  mkt:     /holiday|chutti|chhutti|chhuti|chuti|avkash|अवकाश|छुट्टी|छुट्टि|muhurat|मुहूर्त|timings?\b|market hours|trading hours|kab khul|kab band|कब खुल|कब बंद|is (the )?market open|market (is )?(open|closed|khula|band|खुला|बंद)|(khula|open|band|closed) (hai|he|rahega|hoga)|खुला है|बंद है|बाज़ार खुला|बाजार खुला|market khula|market band/,
  tax:     /\btax|ltcg|stcg|capital gain|टैक्स|कर कितना|income tax/,
  sip:     /\bsip\b|monthly invest|har mahine|हर महीने|\bper month\b|\bmonthly\b|प्रति माह|मासिक/,
  cagr:    /\bcagr\b|annuali[sz]|saalana|सालाना|per annum|yearly return|\bp\.?a\b|वार्षिक/,
  double:  /\bdouble\b|dugna|doguna|dogna|दोगुना|दुगना|दुगुना/,
  days:    /kitne din|how many days|\bdays? (between|since|until|till|left|from)\b|कितने दिन|din bache|trading days|kaunsi date|which date|what date|\bafter \d+ days|\bdin baad\b|\bdays? later|\bbaad\b|बाद|\bago\b|pehle|पहले|कितने हफ्ते|how many weeks/,
  mtf:     /\bmtf\b|margin|leverage|interest|byaj|biyaj|ब्याज|\b5x\b|उधार/,
  be:      /break ?even|no loss|no profit|barabar|बराबर|nuksan na|loss na|cost cover|ब्रेकईवन|ब्रेक ईवन/,
  target:  /\btarget|chahiye|चाहिए|\bke liye\b|के लिए|exit price for|kis price|किस भाव|kis bhav|kab bechu|kab bechun|at what price|which price|what price should/,
  pnl:     /profit|loss|p ?& ?l|\bpnl\b|munafa|munafe|fayda|faida|nuksan|nuksaan|मुनाफ|फायदा|फ़ायदा|नुकसान|\breturn|kamai|कमाई|kitna milega|कितना मिलेगा|\bgain|\bsold|\bsell|bech|बेच/,
  invest:  /invest|lagau|lagaun|lagana|\blaga|लगा|kitne units|how many units|kitne share|buy with|kharid sakta|kharid sakte|खरीद सकत|निवेश|nivesh|कितने यूनिट|कितने शेयर|kitne unit/,
  charges: /charge|brokerage|\bstt\b|\bfees?\b|\bgst\b|stamp|kharcha|खर्च|शुल्क|चार्ज|ब्रोकरेज/,
  compare: /compare|comparison|\bvs\b|versus|better broker|sasta|सस्ता|kaunsa broker|which broker|best broker|तुलना|tulna/,
  price:   /price|\bbhav|bhaav|भाव|\brate\b|kya chal|\bltp\b|\blive\b|abhi kitna|current|कीमत|keemat|kimat|daam|दाम|रेट/,
  bias:    /bias|market|mood|\bgift|\bvix\b|\bdow\b|nasdaq|nikkei|hang seng|\basia|dollar|\busd|sentiment|bullish|bearish|pre.?open|\bgap\b|khulega|खुलेगा|बाज़ार|बाजार|bazaar|bazar|मार्केट/,
  signal:  /signal|buy or sell|should i (buy|sell)|kharidu|kharidun|bechu|bechun|खरीदूं|खरीदूँ|बेचूं|बेचूँ|30 ?min|60 ?min|next hour|prediction|projection|forecast|\bweek\b|hafte|हफ्ते|\btrend|confidence|सिग्नल/,
  holdings:/holding|meri position|my position|mera p ?& ?l|my p ?& ?l|my pnl|मेरी होल्डिंग|मेरा|calculator (me|mein|में)/,
  news:    /\bnews\b|khabar|खबर|ख़बर|headline|samachar|समाचार/,
  // stock-data intents
  quoteW:  /price|\bbhav|bhaav|भाव|\brate\b|quote|\blevel|kitne ka|kya chal|trading at|kaha hai|kahan hai|\bshare\b|\bstock\b|शेयर|कीमत|keemat|kimat|daam|दाम|रेट|\bltp\b|52 ?w|high|low/,
  techW:   /technical|टेक्निकल|\brsi\b|\bdma\b|\bsma\b|\bema\b|moving average|support|resistance|सपोर्ट|रेज़िस्टेंस|रेजिस्टेंस|pivot|trend|ट्रेंड|chart|analysis|analy[sz]e|overbought|oversold|should i (buy|sell)|buy kar|kharidu|kharidun|kharidna|lena chahiye|le lu|lu kya|खरीदूं|खरीदूँ|खरीदना|bechna chahiye|outlook|\bview\b|momentum|breakout|volatil/,
  retW:    /return|रिटर्न|perform|\bsince\b|pichhle|pichle|पिछले|\blast \d|\bytd\b|this year|is saal|इस साल|kitna (badha|gira|upar|neeche|bada)|\bworth\b|\bago\b|pehle|पहले|\bgrew\b|\bgrown\b/,
  cmpW:    /compare|comparison|\bvs\b|versus|tulna|तुलना|better|behtar|बेहतर|\bor\b|\bya\b|\band\b|\baur\b|और/,
  // trading tools
  psize:   /position siz|how many (units|shares|qty)|kitne (units|share|shares|unit)|kitni quantity|quantity kitni|qty kitni|कितने (यूनिट|शेयर)|risk per trade/,
  rr:      /risk ?(:|to|\/|and|n)? ?reward|\brr\b|r ?: ?r|रिस्क रिवॉर्ड/,
  slW:     /stop ?loss|stoploss|\bsl\b|स्टॉप ?लॉस|trailing/,
  avg:     /\baverage|\bavg\b|ausat|औसत|average down|averaging/,
  recover: /recover|recovery|wapas|वापस|breakeven after|barabar aane/,
  pctchg:  /(how much|kitna|kitne|what|kya)\s*(%|percent|pratishat|प्रतिशत)|% ?change|percent(age)? change|change %|kitna badha|kitna gira|kitna upar|kitna neeche|कितना बढ़ा|कितना गिरा|how much (up|down|did it)|by what %/,
  pctmove: /\b(up|down|above|below|rise|rises|fall|falls|increase|decrease|upar|neeche|badhe|badhta|gire|girta|kam ho|ऊपर|नीचे|बढ़े|गिरे)\b|\+|-\s*\d/,
  yieldW:  /dividend|लाभांश|\byield\b/,
  peW:     /\bp ?\/ ?e\b|\bpe ratio|\bpe\b.*\beps\b|\beps\b/,
  goal:    /\bgoal|lakshya|लक्ष्य|banana hai|banane|बनाना|corpus|retire|need .* in \d+|chahiye .* saal/,
  infl:    /inflation|mehangai|mehngai|महंगाई|महँगाई|real value|future cost/,
};

async function answer(raw, lang){
  const q = String(raw || '').trim();
  LANG = lang || TEXTLANG;
  if (!q) return hHelp(true);
  const E = extract(q);
  const s = E.s;
  const has = k => K[k].test(s);
  const nums = E.amounts.length + E.units.length + E.prices.length + E.pcts.length + E.nums.length + (E.sl ? 1 : 0);

  if (has('greet')) return hHelp(true);
  if (has('help') && nums === 0) return hHelp(false);

  // stock / index / commodity entities (ignore GIFT Nifty, which the page's bias covers)
  const syms = findSymbols(s.replace(/gift ?nifty/g, ' '));
  const g = glossaryHit(s);
  if (g && has('explain') && nums === 0 && !(syms.length && !/niftybees|nifty bees/.test(s) && (has('quoteW') || has('techW')))) return { html: gText(g) };

  if (has('mkt')) return hMarket(E);
  if (has('tax') && !has('charges')) return hTax(E);

  // trading tools (numbers-first questions)
  if (has('psize') && E.sl && E.amounts.length) return hPositionSize(E);
  if (has('rr') && E.sl) return hRiskReward(E);
  if (E.sl && E.entry && E.exit && !E.amounts.length && !E.units.length) return hRiskReward(E);
  if (has('slW') && (E.sl || E.pcts.length)) return (E.amounts.length && E.sl && has('psize')) ? hPositionSize(E) : hStopLoss(E);
  if (has('avg') && (E.pairs.length >= 2 || (E.pairs.length >= 1 && E.vals.length >= 3))) return hAverage(E);
  if (has('recover') && E.pcts.length) return hRecover(E.pcts[0]);
  if (has('yieldW') && E.vals.length >= 2 && !syms.length){ const v = E.vals.slice(0,2).sort((a,b)=>a-b); return hYield(v[0], v[1]); }
  if (has('peW') && E.vals.length >= 2 && !syms.length){ const v = E.vals.slice(0,2).sort((a,b)=>a-b); return hPE(v[1], v[0]); }
  if (has('infl') && E.amounts.length) return hInflation(E);
  if (E.amounts.length && Math.max(...E.amounts) >= 100000 && E.years && (has('goal') || (has('sip') && /kitna|how much|kitni|chahiye|need|required|कितना/.test(s)))) return hGoalSip(E);
  if (has('pctchg') && E.vals.length >= 2 && !syms.length) return hPctChange(E.vals[0], E.vals[1]);

  if (/best stock|which stock|kaunsa (share|stock)|konsa (share|stock)|\btips?\b|multibagger|कौन सा शेयर|कौनसा शेयर/.test(s))
    return { html: L('I don\'t give stock tips — but I can check any stock for you: its trend, RSI, support/resistance and returns. Try <i>"Reliance technical"</i> or <i>"compare TCS and Infosys"</i>.','मैं शेयर टिप्स नहीं देता — पर किसी भी शेयर का ट्रेंड, RSI, सपोर्ट/रेज़िस्टेंस और रिटर्न बता सकता हूँ। आज़माएँ <i>"रिलायंस टेक्निकल"</i>।','Main stock tips nahi deta — par kisi bhi stock ka trend, RSI, support/resistance aur return bata sakta hoon. Try <i>"reliance technical"</i>.') };
  // any stock / index / commodity
  const bees = x => x.sym === 'NIFTYBEES.NS';
  const stockish = has('techW') || has('retW');
  const usable = syms.filter(x => !bees(x) || stockish || has('cmpW'));
  if (usable.length){
    const onlyNiftyMood = usable.length === 1 && usable[0].sym === '^NSEI' && has('bias') && !has('quoteW') && !stockish;
    if (!onlyNiftyMood){
      if (usable.length >= 2 && (has('cmpW') || syms.length >= 2)) return hCompareStocks(usable, E);
      if (has('techW') || (has('signal') && !has('retW'))) return hTech(usable[0]);
      if (has('retW') || E.years || E.dates.length) return hReturns(usable[0], E);
      if ((E.units.length || E.amounts.length) && (E.entry || E.exit) && has('pnl')) return hPnl(E);
      return hQuote(usable[0]);
    }
  }

  if (has('double') && E.pcts.length) return hDouble(E);
  if (has('sip') && (E.amounts.length || E.nums.length) && !has('mtf')) return hSip(E);
  if (has('cagr') || (has('pnl') && E.amounts.length >= 2 && E.days && !E.prices.length)) {
    if ((E.amounts.length >= 2 && E.years) || (E.pcts.length && (E.days || E.dates.length)) || (E.amounts.length >= 2 && E.days)) return hCagr(E);
  }
  if (has('be') && !has('explain')) return hBreakevenOrTarget(E, false);
  if (E.pcts.length && has('target') && !E.years) return hBreakevenOrTarget(E, true);
  if (has('mtf') && !has('explain')) return hMtf(E);
  if (has('mtf') && has('explain') && g) return { html: gText(g) };
  if ((has('days') || E.dates.length) && !E.prices.length && !(E.amounts.length && E.pcts.length && E.years)) return hDays(E);
  if (has('compare')) return hCompare(E);
  if (has('charges') && !(E.exit && E.entry)) return hCharges(E);
  if (E.amounts.length && E.pcts.length && E.years && !E.prices.length) return hFv(E);
  if (E.entry && (E.units.length || E.amounts.length || E.nums.length) && (E.exit || has('pnl'))) return hPnl(E);
  if (E.units.length && (E.entry || E.exit)) return hPnl(E);
  if (E.amounts.length && (has('invest') || has('pnl') || nums === 1 || E.entry)) return hInvest(E);
  if (E.pcts.length && (has('target') || has('pnl')) && !E.years) return hBreakevenOrTarget(E, true);
  if (E.pcts.length === 1 && E.vals.length === 1 && has('pctmove')) return hPriceAfterPct(E.vals[0], E.pcts[0], /down|below|fall|decrease|neeche|gire|girta|kam ho|नीचे|गिरे|-\s*\d/.test(s) ? true : /up|above|rise|increase|upar|badhe|badhta|ऊपर|बढ़े|\+/.test(s) ? false : null);
  if (E.units.length && has('pnl')) return hPnl(E);
  if (has('pnl') && E.prices.length) return hPnl(E);
  if (has('holdings')) return hHoldings();
  if (has('news')) return hNews();
  if (has('signal')) return hSignal();
  const phrase0 = leftoverPhrase(s);
  if (phrase0 && phrase0.split(' ').length <= 4 && (has('quoteW') || has('techW') || has('retW'))){
    const x = await searchSymbol(phrase0);
    if (x) return has('techW') ? hTech(x) : has('retW') ? hReturns(x, E) : hQuote(x);
  }
  if (has('price') && !has('bias')) return hPrice();
  if (has('bias')) return hBias();
  if (has('price')) return hPrice();
  if (g) return { html: gText(g) };

  // unknown company name? — look it up
  const phrase = leftoverPhrase(s);
  if (phrase && phrase.split(' ').length <= 4 && (has('quoteW') || stockish || nums === 0)){
    const x = await searchSymbol(phrase);
    if (x){
      if (has('techW')) return hTech(x);
      if (has('retW')) return hReturns(x, E);
      const r = await hQuote(x);
      if (!/couldn't fetch|नहीं मिला|nahi mila/.test(r.html)) return r;
    }
  }
  if (has('pnl')) return hHoldings();
  if (has('help')) return hHelp(false);
  return { html: L('I didn\'t quite catch that. Try one of these:','मैं समझ नहीं पाया। इनमें से कोई आज़माएँ:','Samajh nahi aaya. Ye try karo:') + hHelp(false).html.replace(/^[^<]{0,}/, '') };
}


// ---------------------------------------------------------------------
// 8. UI
// ---------------------------------------------------------------------
const AVATAR = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCACQAJADASIAAhEBAxEB/8QAGwAAAgMBAQEAAAAAAAAAAAAABAUCAwYBBwD/xAA9EAACAQMCBAMFBQYFBQEAAAABAgMABBEFIRIxQVEGE2EUInGBkTJCUqGxBxUjwdHhQ1ODkvAWM0Ri8XL/xAAZAQADAQEBAAAAAAAAAAAAAAABAgMABAX/xAAgEQACAgIDAAMBAAAAAAAAAAAAAQIRAyESEzEEIkFR/9oADAMBAAIRAxEAPwBipPerVK7cqpWrFHeuU6UXqewFWKTncVSu3LnVw2XJ/WlGLAe5AoS/1Sz0yBpribA9NyT2ApL4k8UR6RbmKPhe4fIUHkuOea80vtTnv5jNPOWYZwMZAp4wsRs12o+Prh3cWgMSnIDcIJx86z7X9xOxlS5ZWH3W5Gk/vEAk7elcDlHPCTg1ZRSEbGi6rdYaN8++ffBOeL50bHPA1p5ZeKJ41OFKk5379aQh2xw8jk864zuvC/KjRh4s0cEjvbzLFlseWAeFhj8qd6DrTMQojLI+xyfsnvj4Vi0mdyAepzVsN00A93GA3woNGs9MtfEVtH/DkkuFCybllGOfPI+NP9Puku7YOpDEbEgV5PY655Ts5JVycFW3Qjsa2fhbVYJLt4MookBdSjbZzuB/SpyiOpGtIHLrUSnyqeA24YNnqKlw4G+9SHKGUgZx8ajw5GauLAHB3zXeAA7cqxmKUNXIM0OmRV8ZNMKi9UJ59KR+K9dfRbFRCAJ5shGYZwOrY9M9aeKx7ZrzHxjfyX+tzqGxHE3l7cgAf65NGMbZpOjP3EtzeTPNNK0rk+8zNz+dUFkBxjf05V9MQg4Uwd8b86ItbF5iGkOd+WKu2ooRJydIhHkSBjvtgr3FfPEScryO9O4NPijUZUE1Y1jDnIXBqPci6wMSLA2B15Y9N66bZ2jC8O2/9qeiBVGyiuiI+lDuG6TPizlAyVbfvUJYGAOQwJG+3OtIYeKqnt/T61lmM8BnvNYLwnB9MbAVdbXk9pIk0EhjljPEjgYI/qPjRN3ZDPEgwc9qWSIVfBG/erRkpHNKDgex+FfFlhq2mhrqeC2uIzh0ZgvzGacPrWkLz1K0H+qK8Kspzb3KkZOTvWjA41BHI7ipTjTGjK0emtr2ijlqlr/vrg1vRn5anan/AFK8zC5roTJxSUNZ6AqZq9IjjlVUTA9aLiIxT0KmfJGeIbda8q1uBraS4MwAfj4j3JZic/TavX4sc688/aVHb28NrGi/xZnZwc7gdR9aMfQSZh4IzNOXfc7YHan1rCFUGlOlr5szNjYU3BYYAFTyvdHRhWrCfdxnJz6VxWOcY2FQjVjVywsTnG1ROg6cYrgZR2+tfNCc11LZiMgH6Vgli8PQ18wQ9aibWTptXPIkX1rGKLiJSPd3pJqMJj94Dka0qwkg8QoHUrXiiYY36VbHKmRyRtGcVQGDr03rR2J8y1U9etZxVK4Han2ikvbMD904q+Tw4o+h6JgGurH1qxRUwuaiWo1ETHvRsLNnY1OHR7+XGLaTHquKNg0K+JOFUY/9gK6eDObml+kFLcGMHevMv2jqw1m3V2YkQZCk7KMnl9M161DodwTjzYx8WrB/tU8NXEQsdRjYSeY3s7cP3TzGfz+lDi4vYVOMvGY/TrcW9sCebDJJoxZ4lPPPwGaT3t84by4CCE248c/hS9pLiQ5Z5CfiaTqvbZbu46SNpFdWYxxTBcdxijY5LWYAxyLgdjzrFWVnrE5X2SG6k4thwgkH67VsNI8PLwRp4ksnsPPfghuYZVBDYzh13AzSvAvxjL5L/UXlIVO8i+tVvfWcBESP5sp5Ki8R/Km8XgHSpLloZNVc8J3VHTix69vpSvX/AAzeNJNYeHY447a3ISYtLia4bhDEliMFd8YBA25VlgX6wv5L/ELrnXYIGKyeXGezvuPkMmh18S2xIXjjI+Dj+VLZfB3iCLOdIuWx1jUMPyNDv4c1qMFm0m9UAZJ9nbYfSqLFAk8+T+mot9Rt7kAoQRyyGBH9vnVlxbGWBioOcViLdpIJRJG3C36jsfStfp2tQpConR2RwMMu5Hoe9JLFW4lYZr1Izk0Sh3UjDK2DTLQ1It5Dyyw/Sh9ZjaDVrmEjhYNwkeuaZadB5Nsq9TuaMn9SSX2DVFXKmRyqKLtREa7VCyp6uJpU91GDbbjpUld2AwApI3HOhtOtL2ePN6UhKnHm7ASjowHT4UxNrbxplL1S47sADXp9sUeP1SfgMoZXyTtnvXlfjHU9Wvr64sry4KRRTMkURwqJvgMQN+R5mvYIkt/LIeSJmJBwJBtj1rF/tHbTfYLa1lgX2udj5ciEEIg2IJ54JPL0qEsnJ2zpx4+KpHjs6vAJW4oxlcCIem21UpkIuFxnfejbMGGUK0YDvxZUjkQeX5Uyd5DMWiRY+IAEn4861lWqF9ldahbyh7UMJApCkJkqPTI2ogXmoTyrHez3DoBsJGJGd8bfM0fGUVieMsx5sxO9dd0MihsE4IUc/wD9H9B8T6UrdI0Y26B4oZmXiUgsBxYAH/M+tR1O8uzerNaPPGrRxsQjnZlGD+mR6Gmdm6I+V39QOVV3BW2mEbbKfejI+8nb4qfqPhUcWRt0zrz4UoqUQJfEfiCGPhW9lAPVwpP519J4m1+QI8moSKsf4OFQT0zjnSXXSs2pMVwQihc89+f867Pdme3ij4EVI1AGBz+NdJycQPBMpVRk8thkGtBpFtcppkwW282USBkB+6R1/M0JYLHkZjZpHbhUIK3OiWot7XByWc5LHrSZJ8YlscOUqMVdq97rfmOSWl998889c05iQAAYrl1bRnWr+dy/DG42Qc9u9XQmOVFkiLFD+IYORzFQlKyvW0rLY0q9Fr6KPar1SpgBrnxNq1y5L3Db+tD/AL21A87l/rVZjGa6EFNbESouXV9QXlcP9aA167nu3sprli+AyAn60YIwasOnjUdNuLUf91f4kR65HT50LHxtKWxAYJrq2EqtiYEhjjnjkT15Y3FB8WpK/C0eFH3g6mnWkuJLYqftIcEVdLAj5LjIPKqdzXqC8Cb0xDxXLSDjkwo+5Gfeb4nkB+dHW8MomLv78jqFwOSjoBTGCzjU8SKB8qkbg28ymO340X7ZVveB7460ssjlopDCo7CrGwlKg+Wc9iKI1K186OOOe1+wcnaibe+2HC2ds7dK+S91ZbgtPZwrBxYVmlyzDvjGKgrTs66T0Zi90BRISqlweTA7/Pv86GXw2xfBeVQTywta2VeNjKFIUn7NWwQRswOd8fSq90kQfx4MX6JoNvb++659D1+J/ltWgZQGyuwxXIkWNccvnUZNo8ZJ6ZqTm5PYygoLRn76RF0vUGUfxfMZmOOmcCqtNhEFjCj/AGyONvQtvUNX4S8lrEffuZ+Aj02JqZuB5jY5ZwPhVEDI0oUMFAHWrNgKXC5NS9pNE5irKmvhil6LqD3fsqW5aTDEKHU5Cgk9ewNAtrkiEgW8r4/CBT8JEuSNCMVfZStHdoynBBG/beswuuyk4NpOPkP6020q4mvblEhiJfBYqdsAcyew9aDhKjKSDdZ05NO8Rztb+7BdxiZUH3STuPrmqlUEji7Vora1h8VaWr2/BLcWyExtFKpPLPCRnlWaJPAcdam7OqErOyzBFxH8MjrQ4VixYZzV7IqrkkVWZYlPCHUtywCKyQ1thsJaFV2+1vmmKqJ0XblSf2iJ1VZn4CB+Ib0dBdlQvD5fB0BJyfnRGUWFhHAPUVbCNuJMr3BoZ9RMcJJtJccgyLxAn9a+0u/FzIyMjRnswwaVoNtMYGTC7nFQZsgHsa5KgVAPXFUzXdtYoJ7wt7PDhpeEZPDncD1qa9Hk9WDXGnolzJcyIPMc+62enb6VFbK2/wAlfzqXiDxx4RvYYv3bbXlvJHkY8gcLD197nSFfFllxc5gPWL+9dHCSOGWVSdmg9htT/hY+DGuNp1sRsGX4NSZfFdgeckg/0jU/+qdNP/kuPjE1bjL+C8kXS+F47iUy+1TwZ/yjg/XpU4PDtjZReXBGRncsxyzfE08I2qspTWxaQqXSIC24NRTwzMt0bi112e3dxwkLGPs9RnIpuEqapitbXhqQ40aS20lG9mHvM3HI55yNyyf6VktZtlttUnRB/DdvMj+B3/LcfKnS5G1KfEFxDH7MrnErMQp9P/tI02Vg6YoeJZ3IYBh0B6VZDaPkBViYDoy1KHnkjY8xRsOC2QeHB2pbo6EVeSxUKYI1weg50ytjKwAAWMDriqxIxPuq3xFExcbEBlYD1FayqbCPKUMSx42Axk0C1ssV9xjrimEStxZJ2FVzoASc9Ofeptmav0jI/LsOdI/EEQutGnZ5WjTjQcQXi69qYTyZIiTmedCa4VTRJIvxFf1FNDUkLPcWjB6hp82mzLHPwlZF44pFOUlXuD/LmDzoXKfiH1r0DQLf94eGryGZQ5sWEkZIzw5OCPmP0qptOgPOJP8AaK7HOjzXDZjbeW0RSJ4PNOftCUrXLu604wMsVnKkpHuv7RxAb9R1rYDSbbiysSK3cKKjqGlTXUSJbtZW5XPE3saEv8Tj+VDmrBxZqCc1HFfBgalUih8MVMCq84qwEJu54R67UQEhgMSdlG5PoKxPiGdru/V+Q4wFHYZrYT5a0ODnj5kdv/tYjW5vZYRIRlhIAB32OKaKKxWrDYpwshB5A4zR8bBcHNZ3S5nmgHmHLEnNMFmmjHADxAdDzqLWy61s0FvOCMEAjPbrRomJ2BA33J+7WVTUTEfeVt+xoiLVXO0cTH1JAxSuJRTRqDMkcWeLZRzNKLjUTK5SPfsOtCMbu8A8yTyoh0HWuZhtl4UBweZO7OaWgthMTrEplkOc8/U9AKReJtRYotsh4nzxMF79h+lFXl97NH5jn+J/hp+H1+NE+BPD76zrQ1O7UmC2biXPJ5On05/SqQjuxJy1RsvCnh/93+G2t7leGe8Tin7qSNh8qz9xbSW87wyqVdDgj/hr0UrwilGvaWt1D7QgCyx8zj7S/wBjVpKzmaMYsUgbPEmOxQ5+uanw+mPlRTwGF+CUMpxkYHMdxRA0t5ovNtpUmHVfssp+BpKYvFn/2Q==';
const CSS = `
.surya-root{--s-bg:#0B1120;--s-surface:#141E35;--s-surface2:#1B2947;--s-line:#2C3D66;--s-gold:#F0B14A;--s-text:#F3F6FB;--s-muted:#C9D2E3;--s-fine:#B9C5DA;--s-up:#4CD6A0;--s-down:#FF7A68;--s-purple:#C9A6FF;
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans Devanagari',sans-serif;font-size:14.5px;line-height:1.5;color:var(--s-text);}
.surya-root *{box-sizing:border-box;}
.surya-fab{position:fixed;right:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:2147483000;width:96px;height:96px;padding:0;border:0;background:transparent;cursor:pointer;
  filter:drop-shadow(0 6px 14px rgba(0,0,0,.55));transition:transform .2s;-webkit-tap-highlight-color:transparent;}
.surya-fab:hover{transform:translateY(-2px) scale(1.04);} .surya-fab:focus-visible{outline:2px solid #fff;outline-offset:2px;border-radius:50%;}
.surya-fab svg{width:100%;height:100%;display:block;overflow:visible;}
.surya-fab .s-ring{animation:surya-glow 2.6s ease-in-out infinite;}
@keyframes surya-glow{0%,100%{stroke-opacity:1;}50%{stroke-opacity:.45;}}
.surya-panel{position:fixed;right:18px;bottom:calc(112px + env(safe-area-inset-bottom,0px));z-index:2147483001;width:400px;max-width:calc(100vw - 24px);height:min(620px,calc(100vh - 136px));
  background:var(--s-bg);border:1px solid var(--s-line);border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.6);display:none;flex-direction:column;overflow:hidden;}
.surya-panel.open{display:flex;animation:surya-in .22s ease-out;}
@keyframes surya-in{from{opacity:0;transform:translateY(12px) scale(.98);}to{opacity:1;transform:none;}}
.s-head{display:flex;align-items:center;gap:9px;padding:11px 10px 10px 12px;background:linear-gradient(135deg,#1d2a4a,#141E35);border-bottom:1px solid var(--s-line);}
.s-av{width:40px;height:40px;border-radius:50%;object-fit:cover;flex:none;border:2px solid var(--s-gold);}
.s-title{flex:1;min-width:0;} .s-title b{font-family:Georgia,serif;font-size:17px;color:var(--s-gold);letter-spacing:.3px;display:block;line-height:1.2;} .s-title div{font-size:12.5px;color:var(--s-muted);}
.s-seg{display:flex;border:1px solid var(--s-line);border-radius:10px;overflow:hidden;flex:none;}
.s-seg button{background:transparent;border:0;color:var(--s-text);font-size:12.5px;font-weight:600;padding:6px 8px;cursor:pointer;min-width:34px;}
.s-seg button+button{border-left:1px solid var(--s-line);}
.s-seg button.on{background:var(--s-gold);color:#1a1200;}
.s-icon{background:transparent;border:1px solid var(--s-line);color:var(--s-text);border-radius:10px;height:31px;min-width:31px;padding:0 6px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;flex:none;}
.s-icon:hover{border-color:var(--s-gold);} .s-icon.on{background:var(--s-gold);color:#1a1200;border-color:var(--s-gold);}
.s-body{flex:1;overflow-y:auto;padding:14px 12px 6px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth;}
.s-msg{max-width:94%;padding:10px 12px;border-radius:14px;word-wrap:break-word;}
.s-bot{background:var(--s-surface);border:1px solid var(--s-line);border-top-left-radius:4px;align-self:flex-start;color:var(--s-text);}
.s-user{background:linear-gradient(135deg,#F0B14A,#D08F2A);color:#1a1200;border-top-right-radius:4px;align-self:flex-end;font-weight:600;}
.s-user .s-tag{display:block;font-size:11.5px;font-weight:700;opacity:.8;margin-top:2px;}
.s-row{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px dashed rgba(201,210,227,.28);font-size:14px;}
.s-row:last-of-type{border-bottom:0;} .s-row>span{color:var(--s-muted);} .s-row b span:not(.s-fine){color:inherit;} .s-row b{font-weight:700;text-align:right;color:var(--s-text);}
.s-big{font-size:17px;} .up{color:var(--s-up)!important;} .down{color:var(--s-down)!important;} .gold{color:var(--s-gold)!important;} .purple{color:var(--s-purple)!important;}
.s-fine{font-size:13px;color:var(--s-fine);margin-top:6px;line-height:1.45;}
.s-warn{margin-top:8px;padding:8px 10px;border-radius:9px;background:rgba(255,122,104,.14);border:1px solid rgba(255,122,104,.45);font-size:13.5px;color:var(--s-text);}
.s-list{margin:6px 0 0;padding-left:18px;} .s-list li{margin:3px 0;} .s-list a{color:#A9CCFF;}
.s-ex{list-style:none;padding:0;} .s-ex li{cursor:pointer;padding:7px 10px;margin:6px 0;border:1px solid var(--s-line);border-radius:10px;background:var(--s-surface2);font-size:14px;color:var(--s-text);}
.s-ex li:hover{border-color:var(--s-gold);}
.s-tbl{width:100%;border-collapse:collapse;margin-top:6px;font-size:13.5px;} .s-tbl th,.s-tbl td{padding:5px 4px;text-align:right;border-bottom:1px dashed rgba(201,210,227,.28);color:var(--s-text);}
.s-tbl th:first-child,.s-tbl td:first-child{text-align:left;color:var(--s-muted);} .s-tbl th{color:var(--s-muted);font-weight:600;} .s-tot td{font-weight:700;color:var(--s-text)!important;} .s-best td{color:var(--s-up)!important;}
.s-past td{opacity:.6;text-decoration:line-through;}
.s-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;}
.s-act{background:transparent;border:1px solid var(--s-gold);color:var(--s-gold);border-radius:999px;padding:6px 12px;font-size:13px;font-weight:600;cursor:pointer;}
.s-act:hover{background:var(--s-gold);color:#1a1200;}
.s-chips{display:flex;gap:6px;overflow-x:auto;padding:7px 12px 8px;scrollbar-width:none;} .s-chips::-webkit-scrollbar{display:none;}
.s-chip{flex:none;background:var(--s-surface2);border:1px solid var(--s-line);color:var(--s-text);border-radius:999px;padding:7px 12px;font-size:13px;cursor:pointer;white-space:nowrap;}
.s-chip:hover{border-color:var(--s-gold);}
.s-foot{display:flex;gap:8px;align-items:center;padding:10px 12px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--s-line);background:var(--s-surface);}
.s-input{flex:1;min-width:0;background:var(--s-bg);border:1px solid var(--s-line);color:var(--s-text);border-radius:12px;padding:10px 12px;font-size:15px;font-family:inherit;outline:none;}
.s-input::placeholder{color:#9DAAC2;opacity:1;}
.s-input:focus{border-color:var(--s-gold);}
.s-btn{flex:none;width:44px;height:44px;border-radius:12px;border:1px solid var(--s-line);background:var(--s-bg);color:var(--s-text);cursor:pointer;display:flex;align-items:center;justify-content:center;}
.s-btn svg{width:21px;height:21px;} .s-send{background:var(--s-gold);border-color:var(--s-gold);color:#1a1200;}
.s-mic.rec{background:var(--s-down);border-color:var(--s-down);color:#fff;animation:surya-pulse 1.2s infinite;}
@keyframes surya-pulse{0%{box-shadow:0 0 0 0 rgba(255,122,104,.6);}100%{box-shadow:0 0 0 12px rgba(255,122,104,0);}}
.s-typing{display:inline-flex;gap:4px;} .s-typing i{width:7px;height:7px;border-radius:50%;background:var(--s-muted);animation:surya-dot 1s infinite;} .s-typing i:nth-child(2){animation-delay:.15s;} .s-typing i:nth-child(3){animation-delay:.3s;}
@keyframes surya-dot{0%,80%,100%{opacity:.3;}40%{opacity:1;}}
.s-voicehint{font-size:12.5px;color:var(--s-fine);padding:0 12px 6px;}
@media (max-width:600px){
  .surya-panel{right:0;left:0;bottom:0;width:100%;max-width:100%;height:90vh;height:90dvh;border-radius:18px 18px 0 0;}
  .surya-root.is-open .surya-fab{display:none;}
  .surya-fab{width:84px;height:84px;}
  .s-input{font-size:16px;}
  .s-title div{display:none;}
}
@media (prefers-reduced-motion:reduce){.surya-fab .s-ring,.s-mic.rec{animation:none;}}
`;

const FAB_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <clipPath id="surya-av-clip"><circle cx="50" cy="43" r="31"/></clipPath>
    <linearGradient id="surya-cres-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE3A0"/><stop offset=".55" stop-color="#F3B546"/><stop offset="1" stop-color="#D0801C"/></linearGradient>
    <path id="surya-arc" d="M 5 50 A 45 44.5 0 0 0 95 50"/>
  </defs>
  <circle cx="50" cy="43" r="33.5" fill="#0B1120"/>
  <image href="${AVATAR}" x="19" y="12" width="62" height="62" clip-path="url(#surya-av-clip)" preserveAspectRatio="xMidYMid slice"/>
  <circle class="s-ring" cx="50" cy="43" r="32.5" fill="none" stroke="#F3B546" stroke-width="2.6"/>
  <path d="M 2 50 A 48 48 0 0 0 98 50 A 48 29 0 0 1 2 50 Z" fill="url(#surya-cres-g)" stroke="#7A3E06" stroke-width=".9"/>
  <text font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="10" font-weight="900" fill="#2A1200" letter-spacing="1"><textPath href="#surya-arc" startOffset="50%" text-anchor="middle">ASK SURYA</textPath></text>
</svg>`;
const MIC  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l16-8-6 16-2-7-8-1z"/></svg>';

let root, panel, body, input, micBtn, spkBtn, chipsEl, segEl, fab;
let speakAlways = false;
try { speakAlways = localStorage.getItem('surya-speak') === '1'; } catch(e){}

const CHIPS = {
  en: ['Live price','Market bias','Is market open?','Nifty today','Reliance technical','Compare TCS and Infosys','Invest ₹50,000','My holdings P&L','Tax on ₹1 lakh profit held 14 months','Help'],
  hi: ['अभी का भाव','बाज़ार का मूड','क्या बाज़ार खुला है?','निफ्टी का भाव','रिलायंस टेक्निकल','50000 लगाऊँ तो कितने यूनिट','मेरी होल्डिंग्स','1 लाख मुनाफ़े पर टैक्स 14 महीने','मदद'],
  hn: ['aaj ka bhav','market ka mood','market khula hai?','nifty ka level','reliance technical','tcs vs infosys','50000 lagau to kitne units','meri holdings','1 lakh profit pe tax 14 mahine','help'],
};
function chips(){ chipsEl.innerHTML = CHIPS[TEXTLANG].map(c => `<button type="button" class="s-chip">${esc(c)}</button>`).join(''); }
function placeholder(){ return TEXTLANG === 'hi' ? 'पूछिए… जैसे "रिलायंस का भाव"' : TEXTLANG === 'hn' ? 'Poochho… jaise "tcs ka price"' : 'Ask Surya… e.g. "Reliance price"'; }

function addMsg(html, who, tag){
  const d = document.createElement('div');
  d.className = 's-msg ' + (who === 'user' ? 's-user' : 's-bot');
  if (who === 'user'){ d.textContent = html; if (tag){ const t = document.createElement('span'); t.className = 's-tag'; t.textContent = tag; d.appendChild(t); } }
  else d.innerHTML = html;
  body.appendChild(d); body.scrollTop = body.scrollHeight;
  return d;
}
function plain(html){ const t = document.createElement('div'); t.innerHTML = html; t.querySelectorAll('.s-acts,.s-fine').forEach(x => x.remove()); return t.innerText; }

function botReply(res, speech){
  const d = addMsg(res.html, 'bot');
  d.setAttribute('lang', LANG === 'hi' ? 'hi' : 'en');
  if (res.actions && res.actions.length){
    const box = document.createElement('div'); box.className = 's-acts';
    res.actions.forEach(a => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 's-act'; b.textContent = a.label;
      b.onclick = () => { if (a.ask) { ask(a.ask); return; } const out = a.run(); if (out) { addMsg(esc(out), 'bot'); if (speakAlways) speak(out, LANG); } };
      box.appendChild(b);
    });
    d.appendChild(box);
  }
  body.scrollTop = body.scrollHeight;
  d.querySelectorAll('[data-ask]').forEach(li => li.addEventListener('click', () => ask(li.getAttribute('data-ask'))));
  if (speech) speak(speech.text, speech.lang);
}

let busy = 0;
async function ask(q, voice){
  q = String(q||'').trim(); if (!q) return;
  const detected = voice ? detectLang(q) : null;
  const lang = voice ? detected : TEXTLANG;
  const tag = voice ? '🎤 ' + ({ en:'English', hi:'हिंदी', hn:'Hinglish' }[detected]) : '';
  addMsg(q, 'user', tag);
  const t = addMsg('<span class="s-typing"><i></i><i></i><i></i></span>', 'bot');
  busy++;
  let res;
  try { res = await answer(q, lang); }
  catch(e){ console.error('[Surya]', e); LANG = lang; res = { html: L('Sorry — something went wrong. Please try again.','माफ़ कीजिए — कुछ गड़बड़ हुई। फिर से कोशिश करें।','Sorry — kuch gadbad hui. Dobara try karo.') }; }
  t.remove(); busy--;
  let speech = null;
  if (voice || speakAlways){
    // Hinglish questions are answered on screen in Hinglish but read aloud in Hindi
    const sayLang = lang === 'hn' ? 'hi' : lang;
    let sayRes = res;
    if (sayLang !== lang){ try { sayRes = await answer(q, sayLang); } catch(e){ sayRes = res; } }
    speech = { text: sayRes.say || plain(sayRes.html), lang: sayLang };
  }
  LANG = lang;
  botReply(res, speech);
}

// ---- voice out ----
function pickVoice(lang){
  if (!('speechSynthesis' in window)) return null;
  const vs = speechSynthesis.getVoices();
  const want = lang === 'hi' ? ['hi-IN','hi'] : ['en-IN','en-GB','en-US','en'];
  for (const w of want){ const v = vs.find(v => v.lang && v.lang.replace('_','-').toLowerCase().startsWith(w.toLowerCase())); if (v) return v; }
  return null;
}
function speak(text, lang){
  if (!('speechSynthesis' in window) || !text) return;
  try {
    speechSynthesis.cancel();
    const hi = lang === 'hi';
    let t = text.replace(/\s+/g,' ').replace(/₹\s?/g, hi ? ' रुपये ' : ' rupees ').replace(/%/g, hi ? ' प्रतिशत' : ' percent')
                .replace(/→/g, hi ? ' से ' : ' to ').replace(/×/g, ' times ').replace(/[·|]/g, ', ').replace(/(\d),(?=\d)/g,'$1');
    const u = new SpeechSynthesisUtterance(t.slice(0, 700));
    const v = pickVoice(hi ? 'hi' : 'en');
    if (v) u.voice = v;
    u.lang = v ? v.lang : (hi ? 'hi-IN' : 'en-IN');
    u.rate = 1.02;
    speechSynthesis.speak(u);
  } catch(e){}
}

// ---- voice in (language auto-detected) ----
// Chrome's hi-IN recogniser understands Hindi, English and mixed
// Hinglish speech — Hindi words come back in Devanagari, English words
// in Latin script — so one recogniser covers all three and detectLang()
// works out which language was actually spoken.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recording = false;
function toggleMic(){
  if (!SR){ LANG = TEXTLANG; addMsg(L('Voice input isn\'t supported in this browser — try Chrome or Edge.','इस ब्राउज़र में आवाज़ इनपुट उपलब्ध नहीं — Chrome या Edge आज़माएँ।','Is browser mein voice input nahi hai — Chrome ya Edge try karo.'), 'bot'); return; }
  if (recording){ try { rec.stop(); } catch(e){} return; }
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch(e){}
  rec = new SR();
  rec.lang = 'hi-IN';
  rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
  let finalText = '';
  rec.onstart = () => { recording = true; micBtn.classList.add('rec'); input.placeholder = 'Listening… / सुन रहा हूँ…'; };
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++){
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
    }
    input.value = (finalText + ' ' + interim).trim();
  };
  rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed'){ LANG = TEXTLANG; addMsg(L('Microphone permission was blocked. Allow it from the browser\'s address bar and try again.','माइक्रोफ़ोन की अनुमति नहीं मिली। ब्राउज़र में अनुमति दें और फिर कोशिश करें।','Mic permission block hai. Browser mein allow karke dobara try karo.'), 'bot'); } };
  rec.onend = () => {
    recording = false; micBtn.classList.remove('rec'); input.placeholder = placeholder();
    const q = (finalText || input.value).trim();
    if (q){ input.value = ''; ask(q, true); }
  };
  try { rec.start(); } catch(e){ recording = false; }
}

function setTextLang(l){
  TEXTLANG = l; try { localStorage.setItem('surya-text-lang', l); } catch(e){}
  segEl.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.l === l));
  input.placeholder = placeholder(); chips();
  root.querySelector('.s-title div').textContent = l === 'hi' ? 'शेयर बाज़ार सहायक' : l === 'hn' ? 'Stock market sahayak' : 'Stock market assistant';
  root.querySelector('.s-voicehint').textContent = l === 'hi' ? '🎤 आवाज़: हिंदी / English / Hinglish अपने आप पहचानी जाती है' : l === 'hn' ? '🎤 Voice: Hindi / English / Hinglish apne aap detect' : '🎤 Voice: Hindi / English / Hinglish detected automatically';
}

function openPanel(){
  panel.classList.add('open'); root.classList.add('is-open');
  fab.setAttribute('aria-expanded','true');
  if (!body.children.length){ LANG = TEXTLANG; botReply(hHelp(true)); }
  setTimeout(() => { if (window.innerWidth > 600) input.focus(); }, 60);
}
function closePanel(){
  panel.classList.remove('open'); root.classList.remove('is-open'); fab.setAttribute('aria-expanded','false');
  try { if (recording) rec.stop(); speechSynthesis.cancel(); } catch(e){}
}

function build(){
  const st = document.createElement('style'); st.id = 'surya-css'; st.textContent = CSS; document.head.appendChild(st);
  root = document.createElement('div'); root.className = 'surya-root'; root.id = 'surya-root';
  root.innerHTML = `
    <div class="surya-panel" role="dialog" aria-label="Surya assistant">
      <div class="s-head">
        <img class="s-av" src="${AVATAR}" alt="Surya">
        <div class="s-title"><b>Surya · सूर्य</b><div>Stock market assistant</div></div>
        <div class="s-seg" role="group" aria-label="Text language">
          <button type="button" data-l="en" title="English">EN</button><button type="button" data-l="hi" title="हिंदी">हिं</button><button type="button" data-l="hn" title="Hinglish">HI-EN</button>
        </div>
        <button type="button" class="s-icon s-spk" title="Read every answer aloud" aria-label="Read answers aloud">🔊</button>
        <button type="button" class="s-icon s-x" title="Close" aria-label="Close">✕</button>
      </div>
      <div class="s-body" aria-live="polite"></div>
      <div class="s-chips"></div>
      <div class="s-voicehint"></div>
      <form class="s-foot" autocomplete="off">
        <input class="s-input" type="text" enterkeyhint="send" aria-label="Your question">
        <button type="button" class="s-btn s-mic" title="Speak (auto language)" aria-label="Speak">${MIC}</button>
        <button type="submit" class="s-btn s-send" title="Send" aria-label="Send">${SEND}</button>
      </form>
    </div>
    <button type="button" class="surya-fab" aria-label="Ask Surya" aria-expanded="false" title="Ask Surya">${FAB_SVG}</button>`;
  document.body.appendChild(root);
  panel = root.querySelector('.surya-panel'); body = root.querySelector('.s-body'); input = root.querySelector('.s-input');
  micBtn = root.querySelector('.s-mic'); spkBtn = root.querySelector('.s-spk'); chipsEl = root.querySelector('.s-chips');
  segEl = root.querySelector('.s-seg'); fab = root.querySelector('.surya-fab');

  spkBtn.classList.toggle('on', speakAlways);
  if (!SR){ micBtn.style.display = 'none'; root.querySelector('.s-voicehint').style.display = 'none'; }
  setTextLang(TEXTLANG);
  if (!SR) root.querySelector('.s-voicehint').style.display = 'none';

  fab.addEventListener('click', () => panel.classList.contains('open') ? closePanel() : openPanel());
  root.querySelector('.s-x').addEventListener('click', closePanel);
  root.querySelector('.s-foot').addEventListener('submit', e => { e.preventDefault(); const q = input.value; input.value = ''; ask(q); });
  micBtn.addEventListener('click', toggleMic);
  spkBtn.addEventListener('click', () => { speakAlways = !speakAlways; spkBtn.classList.toggle('on', speakAlways); try { localStorage.setItem('surya-speak', speakAlways?'1':'0'); } catch(e){} if (!speakAlways) try { speechSynthesis.cancel(); } catch(e){} });
  segEl.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTextLang(b.dataset.l); });
  chipsEl.addEventListener('click', e => { const c = e.target.closest('.s-chip'); if (c) ask(c.textContent); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('open')) closePanel(); });
  if ('speechSynthesis' in window){ try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; } catch(e){} }
}

// Public hook (also handy for testing from the console)
window.Surya = { ask: (q, voice) => { if (!panel) build(); openPanel(); return ask(q, voice); }, answer: (q, lang) => answer(q, lang), open: () => openPanel(), close: () => closePanel(), detectLang: s => detectLang(s) };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
