// =====================================================================
// SURYA — the NIFTYBEES app's built-in calculation assistant.
//
// Runs 100% in the browser: no API key, no server, no running cost.
// Answers investment / days / returns / charges / MTF questions in
// English, Hindi (Devanagari) and Hinglish, typed or spoken.
//
// It deliberately REUSES the app's own formulas and live state
// (legBreakdown, BROKERS, computeBreakevenExitPrice,
// computeExitPriceForTargetPct, livePrice, holdingsMode…) so an answer
// from Surya can never disagree with the calculator on the same page.
// Loaded after app.js (WordPress) or after the inline app script
// (GitHub Pages copy) — both expose those as global bindings.
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
// ---------------------------------------------------------------------
let LANG = 'en';                     // language of the CURRENT reply
let PREF = 'auto';                   // user's chosen language: auto|en|hi|hn
let lastDetected = 'en';
try { PREF = localStorage.getItem('surya-lang') || 'auto'; } catch(e){}

const L = (en, hi, hn) => LANG === 'hi' ? hi : LANG === 'hn' ? (hn != null ? hn : en) : en;

const HN_WORDS = /\b(kya|kitna|kitne|kitni|hai|hain|hoga|hogi|karu|karun|karoon|karna|mera|meri|mere|aaj|abhi|din|saal|mahine|paise|rupaye|lagau|lagaun|lagana|lagaye|bechu|bechun|becho|kharidu|kharidun|kharida|munafa|fayda|faida|nuksan|nuksaan|batao|bata|bataye|chahiye|milega|milegi|kaisa|kaise|kab|kaunsa|kaunsi|bhav|bhaav|ka|ki|ke|ko|se|pe|par|mein|mai|tak|baad|wala|wali|agar|toh|to\s+kitna|sakta|sakte|ho|raha|rahi)\b/gi;
function detectLang(s){
  if (/[\u0900-\u097F]/.test(s)) return 'hi';
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
  sellBef:  /(\bsell\S*|\bsold|\bbech\S*|बेच\S*|\bexit|\btarget|\bnikal\S*|\bto\b|\btak\b|तक|\bthen)\D{0,12}$/,
  buyAft:   /^\s*(pe|par|पर|@|at)?\s*(liye|liya|lia|le liye|kharid\S*|खरीद\S*|लिए|लिया|liye the|buy\S*|bought|entry)/,
  sellAft:  /^\s*(pe|par|पर|@|at)?\s*(bech\S*|बेच\S*|sell\S*|sold|nikal\S*|निकाल\S*|exit|target)/,
  investBef:/(\binvest\S*|\blaga\S*|लगा\S*|\bnivesh|निवेश|\bcapital|\bwith|\bpaas|पास)\s*(rs\s*)?$/,
};

function extract(raw){
  let s = normalize(raw);
  const d = extractDates(s);
  s = d.rest;
  const E = { amounts:[], units:[], prices:[], pcts:[], nums:[], dur:{days:0,weeks:0,months:0,years:0,has:false},
              dates:d.dates, hasToday:d.hasToday, s, raw };
  const ref = APP.live() || 280;
  const re = /(\d+(?:\.\d+)?)/g; let m;
  while ((m = re.exec(s))){
    const v = parseFloat(m[1]);
    const a = s.slice(re.lastIndex, re.lastIndex + 24);
    const b = s.slice(Math.max(0, m.index - 24), m.index);
    if (RX.pct.test(a))    { E.pcts.push(v); continue; }
    if (RX.days.test(a))   { E.dur.days += v; E.dur.has = true; continue; }
    if (RX.weeks.test(a))  { E.dur.weeks += v; E.dur.has = true; continue; }
    if (RX.months.test(a)) { E.dur.months += v; E.dur.has = true; continue; }
    if (RX.years.test(a))  { E.dur.years += v; E.dur.has = true; continue; }
    if (RX.units.test(a) || RX.qtyAt.test(a)) { E.units.push(v); continue; }
    const rupee = RX.rupeeAft.test(a) || RX.rupeeBef.test(b);
    const atP   = RX.atBef.test(b) || RX.atAft.test(a) || RX.buyAft.test(a) || RX.sellAft.test(a);
    const role  = RX.sellAft.test(a) ? 'exit' : RX.buyAft.test(a) ? 'entry' : RX.sellBef.test(b) ? 'exit' : RX.buyBef.test(b) ? 'entry' : null;
    const inRange = v >= ref*0.5 && v <= ref*2;
    if (RX.investBef.test(b) && !inRange) { E.amounts.push(v); continue; }
    if ((atP || role) && v <= ref*5 && v >= ref*0.2) { E.prices.push({ v, role }); continue; }
    if (inRange && !RX.investBef.test(b)) { E.prices.push({ v, role }); continue; }
    if (rupee || v >= 1000) { E.amounts.push(v); continue; }
    E.nums.push(v);
  }
  // roles: explicit first, then order
  const entry = E.prices.find(p => p.role === 'entry') || E.prices.find(p => p.role !== 'exit');
  const exit  = E.prices.find(p => p.role === 'exit' && p !== entry) || E.prices.find(p => p !== entry);
  E.entry = entry ? entry.v : null;
  E.exit  = exit  ? exit.v  : null;
  E.years = E.dur.years + E.dur.months/12 + E.dur.weeks/52 + E.dur.days/365;
  E.days  = E.dur.days + E.dur.weeks*7 + E.dur.months*30 + E.dur.years*365;
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

const GLOSSARY = [
  { rx:/\bmtf\b|margin trading/, en:'<b>MTF (Margin Trading Facility)</b> — you pay ~20%, the broker lends ~80% (5× position) and charges daily interest (Angel One 14.99%, Kotak Pro 9.69%, Kotak Std 14.99% p.a.). Profit and loss are both 5× bigger, and interest keeps eating the gain each day you hold.',
    hi:'<b>MTF (मार्जिन ट्रेडिंग सुविधा)</b> — आप ~20% देते हैं, ब्रोकर ~80% उधार देता है (5× पोज़िशन) और रोज़ ब्याज लेता है (Angel One 14.99%, Kotak Pro 9.69%, Kotak Std 14.99% सालाना)। लाभ और हानि दोनों 5× होते हैं, और हर दिन ब्याज मुनाफ़ा घटाता है।',
    hn:'<b>MTF</b> — aap ~20% dete ho, broker ~80% udhaar deta hai (5× position) aur roz interest leta hai (Angel One 14.99%, Kotak Pro 9.69%, Kotak Std 14.99%). Profit aur loss dono 5× hote hain, aur har din interest profit khata hai.' },
  { rx:/\bstt\b|securities transaction/, en:'<b>STT (Securities Transaction Tax)</b> — a government tax: 0.1% on both buy and sell for delivery/MTF; 0.025% on the sell side only for intraday.',
    hi:'<b>STT (सिक्योरिटीज़ ट्रांज़ैक्शन टैक्स)</b> — सरकारी टैक्स: डिलीवरी/MTF में खरीद और बिक्री दोनों पर 0.1%; इंट्राडे में केवल बिक्री पर 0.025%।',
    hn:'<b>STT</b> — sarkari tax: delivery/MTF mein buy aur sell dono pe 0.1%; intraday mein sirf sell pe 0.025%.' },
  { rx:/break ?even|ब्रेकईवन|barabar/, en:'<b>Breakeven</b> — the exit price where your net P&L is exactly zero after every charge (and MTF interest). Sell above it for a real profit.',
    hi:'<b>ब्रेकईवन</b> — वह बिक्री भाव जहाँ सारे चार्ज (और MTF ब्याज) के बाद शुद्ध लाभ/हानि शून्य हो। इससे ऊपर बेचने पर असली मुनाफ़ा।',
    hn:'<b>Breakeven</b> — wo exit price jahan saare charges (aur MTF interest) ke baad net P&L zero ho. Isse upar becho to asli profit.' },
  { rx:/gift ?nifty|\bgift\b/, en:'<b>GIFT Nifty</b> — Nifty futures traded at GIFT City almost round the clock. Its gap vs. yesterday\'s Nifty close hints at how the market may open; it has the highest weight (3.0) in this app\'s bias score.',
    hi:'<b>GIFT निफ्टी</b> — GIFT City में लगभग चौबीसों घंटे चलने वाला निफ्टी फ्यूचर्स। कल के निफ्टी क्लोज़ से इसका गैप बताता है कि बाज़ार कैसे खुल सकता है; इस ऐप के बायस स्कोर में इसका वज़न सबसे ज़्यादा (3.0) है।',
    hn:'<b>GIFT Nifty</b> — GIFT City mein lagbhag 24 ghante chalne wala Nifty futures. Kal ke close se iska gap batata hai market kaise khul sakta hai; bias score mein sabse zyada weight (3.0).' },
  { rx:/\bvix\b/, en:'<b>India VIX</b> — the market\'s "fear gauge" (expected Nifty volatility). A rising VIX counts against the bias score here.',
    hi:'<b>India VIX</b> — बाज़ार का "डर मापक" (निफ्टी की अपेक्षित अस्थिरता)। VIX बढ़ना यहाँ बायस स्कोर के ख़िलाफ़ गिना जाता है।',
    hn:'<b>India VIX</b> — market ka "fear gauge". VIX badhna bias score ke khilaaf gina jata hai.' },
  { rx:/pre.?open/, en:'<b>NSE pre-open</b> — the 9:00–9:08 AM IST call auction that discovers the opening price. Only available in that window.',
    hi:'<b>NSE प्री-ओपन</b> — सुबह 9:00–9:08 बजे की नीलामी जो ओपनिंग भाव तय करती है। केवल उसी समय उपलब्ध।',
    hn:'<b>NSE pre-open</b> — subah 9:00–9:08 ka auction jo opening price tay karta hai. Sirf usi time milta hai.' },
  { rx:/intraday|delivery|डिलीवरी|इंट्राडे/, en:'<b>Delivery vs Intraday</b> — delivery shares land in your demat (STT 0.1% both sides, ₹23.60 DP charge on sell). Intraday is squared off the same day (STT 0.025% on sell only, no DP charge) — cheaper charges, but no overnight holding.',
    hi:'<b>डिलीवरी बनाम इंट्राडे</b> — डिलीवरी में शेयर डीमैट में आते हैं (STT दोनों तरफ़ 0.1%, बिक्री पर ₹23.60 DP चार्ज)। इंट्राडे उसी दिन बंद होता है (STT सिर्फ़ बिक्री पर 0.025%, DP नहीं) — सस्ता, पर रात भर होल्ड नहीं।',
    hn:'<b>Delivery vs Intraday</b> — delivery mein shares demat mein aate hain (STT dono side 0.1%, sell pe ₹23.60 DP). Intraday usi din band (STT sirf sell pe 0.025%, DP nahi) — sasta, par overnight hold nahi.' },
  { rx:/\bdp\b/, en:'<b>DP charge</b> — ₹23.60 (incl. GST) flat per sell of delivery holdings, charged by the depository.',
    hi:'<b>DP चार्ज</b> — डिलीवरी होल्डिंग बेचने पर हर बार ₹23.60 (GST सहित)।', hn:'<b>DP charge</b> — delivery holding bechne pe har baar ₹23.60 (GST sahit).' },
  { rx:/niftybees|nifty bees|\betf\b/, en:'<b>NIFTYBEES</b> — Nippon India\'s Nifty 50 ETF, traded like a share on NSE. It tracks the Nifty 50 index.',
    hi:'<b>NIFTYBEES</b> — निप्पॉन इंडिया का निफ्टी 50 ETF, जो NSE पर शेयर की तरह ट्रेड होता है और निफ्टी 50 को ट्रैक करता है।',
    hn:'<b>NIFTYBEES</b> — Nippon India ka Nifty 50 ETF, NSE pe share ki tarah trade hota hai.' },
  { rx:/cagr/, en:'<b>CAGR</b> — compound annual growth rate: the steady yearly return that turns the start value into the end value. Ask e.g. <i>"1 lakh to 1.6 lakh in 4 years CAGR"</i>.',
    hi:'<b>CAGR</b> — चक्रवृद्धि वार्षिक वृद्धि दर: वह स्थिर सालाना रिटर्न जो शुरुआती राशि को अंतिम राशि बनाता है।', hn:'<b>CAGR</b> — wo steady saalana return jo start value ko end value banata hai.' },
  { rx:/\bsip\b/, en:'<b>SIP</b> — a fixed amount invested every month. Ask e.g. <i>"SIP 5000 for 10 years at 12%"</i>.',
    hi:'<b>SIP</b> — हर महीने एक तय राशि का निवेश। पूछें जैसे <i>"SIP 5000, 10 साल, 12%"</i>।', hn:'<b>SIP</b> — har mahine fixed amount invest. Poochho jaise <i>"SIP 5000 10 saal 12%"</i>.' },
  { rx:/signal|confidence|ema|rsi/, en:'<b>30–60 min signal</b> — built from the last 30 min of trend (35%), volume buildup (30%), EMA 9/21 gap acceleration (25%) and an RSI(14) guard (10%). BUY ≥ +30, SELL ≤ −30, else HOLD. A statistical read, not advice.',
    hi:'<b>30–60 मिनट सिग्नल</b> — पिछले 30 मिनट के ट्रेंड (35%), वॉल्यूम (30%), EMA 9/21 गैप (25%) और RSI(14) (10%) से। +30 से ऊपर BUY, −30 से नीचे SELL, बाकी HOLD। सलाह नहीं।',
    hn:'<b>30–60 min signal</b> — last 30 min ka trend (35%), volume (30%), EMA 9/21 gap (25%), RSI(14) guard (10%). +30 upar BUY, −30 neeche SELL, warna HOLD.' },
  { rx:/bias|score/, en:'<b>Bias score</b> — weighted lean from GIFT Nifty (3.0), NSE pre-open (2.5), US (1.5), Asia (1.0), USD/INR (0.5) and VIX (0.5). Above +0.35 = bullish, below −0.35 = bearish. You can tune weights on the page.',
    hi:'<b>बायस स्कोर</b> — GIFT निफ्टी (3.0), प्री-ओपन (2.5), अमेरिका (1.5), एशिया (1.0), USD/INR (0.5), VIX (0.5) का भारित झुकाव। +0.35 से ऊपर तेजी, −0.35 से नीचे मंदी।',
    hn:'<b>Bias score</b> — GIFT (3.0), pre-open (2.5), US (1.5), Asia (1.0), USD/INR (0.5), VIX (0.5) ka weighted lean. +0.35 upar bullish, −0.35 neeche bearish.' },
];
function glossaryHit(s){ return GLOSSARY.find(g => g.rx.test(s)); }

function hHelp(greet){
  const intro = greet
    ? L('Namaste! I\'m <b>Surya</b> ☀️ — I do the maths on this page for you.','नमस्ते! मैं <b>सूर्य</b> ☀️ हूँ — इस पेज का हर हिसाब मैं कर दूँगा।','Namaste! Main <b>Surya</b> ☀️ hoon — is page ka saara hisaab main kar dunga.')
    : L('Here\'s what I can work out:','मैं ये हिसाब कर सकता हूँ:','Main ye hisaab kar sakta hoon:');
  const ex = LANG === 'hi'
    ? ['अभी का भाव क्या है?','50000 लगाऊँ तो कितने यूनिट आएँगे?','500 यूनिट 280 पर लिए, 292 पर बेचूँ तो मुनाफ़ा?','2% मुनाफ़े के लिए किस भाव पर बेचूँ?','MTF 1 लाख 10 दिन का ब्याज','15 अगस्त से आज तक कितने दिन?','SIP 5000 हर महीने 12% 10 साल']
    : LANG === 'hn'
    ? ['aaj ka bhav kya hai','50000 lagau to kitne units','500 units 280 pe liye 292 pe becha to profit?','2% profit ke liye kis price pe bechu','MTF 1 lakh 10 din ka interest','15 aug se aaj tak kitne din','SIP 5000 har mahine 12% 10 saal']
    : ['What\'s the live price?','Invest ₹50,000 — how many units?','500 units at 280, sell at 292 — profit?','Exit price for 2% net profit','MTF ₹1 lakh for 10 days interest','Days since 15 Aug','SIP ₹5,000/month at 12% for 10 years','3% in 20 days annualised','Compare broker charges on ₹2 lakh'];
  return { html: `${intro}<ul class="s-list s-ex">${ex.map(e => `<li data-ask="${esc(e)}">${esc(e)}</li>`).join('')}</ul><div class="s-fine">${L('Type or tap 🎤 — English, हिंदी or Hinglish.','लिखें या 🎤 दबाकर बोलें — English, हिंदी या Hinglish।','Likho ya 🎤 dabake bolo — English, हिंदी ya Hinglish.')}</div>` };
}

// ---------------------------------------------------------------------
// 7. Router
// ---------------------------------------------------------------------
const K = {
  greet:   /^\s*(hi+|hello|hey|namaste|namaskar|hola|good (morning|evening|afternoon)|नमस्ते|नमस्कार|हेलो|हाय)\s*[!.]?\s*(surya|सूर्य)?\s*$/,
  help:    /\b(help|madad|what can you|how to use|kaise use|examples?)\b|मदद|क्या कर सकते/,
  explain: /\b(what is|what's|whats|kya hai|kya hota|kya hoti|meaning|matlab|explain|samjhao|samjha|define)\b|क्या है|क्या होता|मतलब|समझाओ|समझाइए/,
  sip:     /\bsip\b|monthly invest|har mahine|हर महीने|\bper month\b|\bmonthly\b|प्रति माह|मासिक/,
  cagr:    /\bcagr\b|annuali[sz]|saalana|सालाना|per annum|yearly return|\bp\.?a\b|वार्षिक/,
  double:  /\bdouble\b|dugna|doguna|dogna|दोगुना|दुगना|दुगुना/,
  fv:      /compound|chakravridhi|चक्रवृद्धि|kitna ban|kitna ho ja|कितना बन|कितना हो|future value|\bgrow|\bbecome|banega|ban jayega|बनेगा|हो जाएगा|\bfd\b|maturity/,
  days:    /kitne din|how many days|\bdays? (between|since|until|till|left|from)\b|कितने दिन|din bache|trading days|kaunsi date|which date|what date|\bafter \d+ days|\bdin baad\b|\bdays? later|\bbaad\b|बाद|\bago\b|pehle|पहले|कितने हफ्ते|how many weeks/,
  mtf:     /\bmtf\b|margin|leverage|interest|byaj|biyaj|ब्याज|\b5x\b|उधार/,
  be:      /break ?even|no loss|no profit|barabar|बराबर|nuksan na|loss na|cost cover|ब्रेकईवन|ब्रेक ईवन/,
  target:  /\btarget|chahiye|चाहिए|\bke liye\b|के लिए|exit price for|kis price|किस भाव|kis bhav|kab bechu|kab bechun|at what price|which price|what price should/,
  pnl:     /profit|loss|p ?& ?l|\bpnl\b|munafa|munafe|fayda|faida|nuksan|nuksaan|मुनाफ|फायदा|फ़ायदा|नुकसान|\breturn|kamai|कमाई|kitna milega|कितना मिलेगा|\bgain|\bsold|\bsell|bech|बेच/,
  invest:  /invest|lagau|lagaun|lagana|\blaga|लगा|kitne units|how many units|kitne share|buy with|kharid sakta|kharid sakte|खरीद सकत|निवेश|nivesh|कितने यूनिट|कितने शेयर|kitne unit/,
  charges: /charge|brokerage|\bstt\b|\bfees?\b|\btax|\bgst\b|stamp|kharcha|खर्च|शुल्क|चार्ज|ब्रोकरेज/,
  compare: /compare|\bvs\b|versus|better broker|sasta|सस्ता|kaunsa broker|which broker|best broker|तुलना/,
  price:   /price|\bbhav|bhaav|भाव|\brate\b|kya chal|\bltp\b|\blive\b|abhi kitna|current|कीमत|keemat|kimat|daam|दाम|रेट/,
  bias:    /bias|market|mood|\bgift|\bvix\b|\bdow\b|nasdaq|nikkei|hang seng|\basia|dollar|\busd|sentiment|bullish|bearish|pre.?open|\bgap\b|khulega|खुलेगा|बाज़ार|बाजार|bazaar|bazar|मार्केट/,
  signal:  /signal|buy or sell|should i (buy|sell)|kharidu|kharidun|bechu|bechun|खरीदूं|खरीदूँ|बेचूं|बेचूँ|30 ?min|60 ?min|next hour|prediction|projection|forecast|\bweek\b|hafte|हफ्ते|\btrend|confidence|सिग्नल/,
  holdings:/holding|meri position|my position|mera p ?& ?l|my p ?& ?l|my pnl|मेरी होल्डिंग|मेरा|calculator (me|mein|में)/,
  news:    /\bnews\b|khabar|खबर|ख़बर|headline|samachar|समाचार/,
};

function answer(raw){
  const q = String(raw || '').trim();
  lastDetected = detectLang(q);
  LANG = PREF === 'auto' ? lastDetected : PREF;
  if (!q) return hHelp(true);
  const E = extract(q);
  const s = E.s;
  const has = k => K[k].test(s);
  const nums = E.amounts.length + E.units.length + E.prices.length + E.pcts.length + E.nums.length;

  if (has('greet')) return hHelp(true);
  if (has('help') && nums === 0) return hHelp(false);
  const g = glossaryHit(s);
  if (g && has('explain') && nums === 0) return { html: g[LANG] || g.en };

  if (has('double') && E.pcts.length) return hDouble(E);
  if (has('sip') && (E.amounts.length || E.nums.length) && !has('mtf')) return hSip(E);
  if (has('cagr') || (has('pnl') && E.amounts.length >= 2 && E.days && !E.prices.length)) {
    if ((E.amounts.length >= 2 && E.years) || (E.pcts.length && (E.days || E.dates.length)) || (E.amounts.length >= 2 && E.days)) return hCagr(E);
  }
  if (has('be') && !has('explain')) return hBreakevenOrTarget(E, false);
  if (E.pcts.length && has('target') && !E.years) return hBreakevenOrTarget(E, true);
  if (has('mtf') && !has('explain')) return hMtf(E);
  if (has('mtf') && has('explain') && g) return { html: g[LANG] || g.en };
  if ((has('days') || E.dates.length) && !E.prices.length && !(E.amounts.length && E.pcts.length && E.years)) return hDays(E);
  if (has('be')) return hBreakevenOrTarget(E, false);
  if (E.pcts.length && has('target') && !E.years) return hBreakevenOrTarget(E, true);
  if (has('compare')) return hCompare(E);
  if (has('charges') && !(E.exit && E.entry)) return hCharges(E);
  if (E.amounts.length && E.pcts.length && E.years && !E.prices.length) return hFv(E);
  if (E.entry && (E.units.length || E.amounts.length || E.nums.length) && (E.exit || has('pnl'))) return hPnl(E);
  if (E.units.length && (E.entry || E.exit)) return hPnl(E);
  if (E.amounts.length && (has('invest') || has('pnl') || nums === 1 || E.entry)) return hInvest(E);
  if (E.pcts.length && (has('target') || has('pnl')) && !E.years) return hBreakevenOrTarget(E, true);
  if (E.units.length && has('pnl')) return hPnl(E);
  if (has('pnl') && E.prices.length) return hPnl(E);
  if (has('holdings')) return hHoldings();
  if (has('news')) return hNews();
  if (has('signal')) return hSignal();
  if (has('price') && !has('bias')) return hPrice();
  if (has('bias')) return hBias();
  if (has('price')) return hPrice();
  if (g) return { html: g[LANG] || g.en };
  if (has('pnl')) return hHoldings();
  if (has('help')) return hHelp(false);
  return { html: L('I didn\'t quite catch that. I work with numbers from this page — try one of these:','मैं समझ नहीं पाया। मैं इस पेज के आँकड़ों से हिसाब करता हूँ — इनमें से कोई आज़माएँ:','Samajh nahi aaya. Main is page ke numbers se hisaab karta hoon — ye try karo:') + hHelp(false).html.replace(/^[^<]{0,}/, '') };
}

// ---------------------------------------------------------------------
// 8. UI
// ---------------------------------------------------------------------
const CSS = `
.surya-root{--s-bg:#0B1120;--s-surface:#121B30;--s-surface2:#182543;--s-line:#233257;--s-gold:#D4A24C;--s-text:#E8ECF4;--s-muted:#7C8AA5;--s-up:#3FB68B;--s-down:#E2604F;--s-purple:#B98AFF;
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans Devanagari',sans-serif;font-size:14px;line-height:1.45;color:var(--s-text);}
.surya-root *{box-sizing:border-box;}
.surya-fab{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:2147483000;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;
  background:radial-gradient(circle at 35% 30%,#FFE08A,#F0A83A 55%,#C9701E);box-shadow:0 6px 22px rgba(240,168,58,.45),0 0 0 3px rgba(11,17,32,.9);display:flex;align-items:center;justify-content:center;transition:transform .2s;}
.surya-fab:hover{transform:scale(1.06);} .surya-fab:focus-visible{outline:2px solid #fff;outline-offset:3px;}
.surya-fab svg{width:34px;height:34px;} .surya-fab .rays{transform-origin:24px 24px;animation:surya-spin 18s linear infinite;}
@keyframes surya-spin{to{transform:rotate(360deg);}}
.surya-tip{position:fixed;right:88px;bottom:calc(32px + env(safe-area-inset-bottom,0px));z-index:2147483000;background:var(--s-surface);border:1px solid var(--s-gold);color:var(--s-text);padding:7px 12px;border-radius:14px;font-size:13px;
  box-shadow:0 4px 14px rgba(0,0,0,.4);white-space:nowrap;opacity:0;transform:translateX(8px);transition:all .35s;pointer-events:none;}
.surya-tip.show{opacity:1;transform:none;}
.surya-panel{position:fixed;right:18px;bottom:calc(90px + env(safe-area-inset-bottom,0px));z-index:2147483001;width:380px;max-width:calc(100vw - 24px);height:min(600px,calc(100vh - 120px));
  background:var(--s-bg);border:1px solid var(--s-line);border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.6);display:none;flex-direction:column;overflow:hidden;}
.surya-panel.open{display:flex;animation:surya-in .22s ease-out;}
@keyframes surya-in{from{opacity:0;transform:translateY(12px) scale(.98);}to{opacity:1;transform:none;}}
.s-head{display:flex;align-items:center;gap:10px;padding:12px 12px 10px 14px;background:linear-gradient(135deg,#1a2440,#121B30);border-bottom:1px solid var(--s-line);}
.s-head .s-av{width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#FFE08A,#F0A83A 55%,#C9701E);display:flex;align-items:center;justify-content:center;flex:none;}
.s-head .s-av svg{width:22px;height:22px;}
.s-title{flex:1;min-width:0;} .s-title b{font-family:Georgia,serif;font-size:16px;color:var(--s-gold);letter-spacing:.3px;} .s-title div{font-size:11.5px;color:var(--s-muted);}
.s-icon{background:transparent;border:1px solid var(--s-line);color:var(--s-text);border-radius:10px;height:30px;min-width:30px;padding:0 7px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;}
.s-icon:hover{border-color:var(--s-gold);} .s-icon.on{background:var(--s-gold);color:#1a1200;border-color:var(--s-gold);}
.s-lang{appearance:none;-webkit-appearance:none;background:var(--s-surface);border:1px solid var(--s-line);color:var(--s-text);border-radius:10px;height:30px;padding:0 8px;font-size:12px;cursor:pointer;}
.s-body{flex:1;overflow-y:auto;padding:14px 12px 6px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth;}
.s-msg{max-width:92%;padding:10px 12px;border-radius:14px;word-wrap:break-word;}
.s-bot{background:var(--s-surface);border:1px solid var(--s-line);border-top-left-radius:4px;align-self:flex-start;}
.s-user{background:linear-gradient(135deg,#D4A24C,#B8842F);color:#1a1200;border-top-right-radius:4px;align-self:flex-end;font-weight:500;}
.s-row{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed rgba(124,138,165,.25);font-size:13px;}
.s-row:last-of-type{border-bottom:0;} .s-row>span{color:var(--s-muted);} .s-row b span:not(.s-fine){color:inherit;} .s-row b{font-weight:600;text-align:right;}
.s-big{font-size:16px;} .up{color:var(--s-up)!important;} .down{color:var(--s-down)!important;} .gold{color:var(--s-gold)!important;} .purple{color:var(--s-purple)!important;}
.s-fine{font-size:11.5px;color:var(--s-muted);margin-top:6px;}
.s-warn{margin-top:8px;padding:7px 9px;border-radius:9px;background:rgba(226,96,79,.12);border:1px solid rgba(226,96,79,.35);font-size:12.5px;}
.s-list{margin:6px 0 0;padding-left:18px;} .s-list li{margin:3px 0;} .s-list a{color:#9CC3FF;}
.s-ex{list-style:none;padding:0;} .s-ex li{cursor:pointer;padding:6px 9px;margin:5px 0;border:1px solid var(--s-line);border-radius:10px;background:var(--s-surface2);font-size:13px;}
.s-ex li:hover{border-color:var(--s-gold);}
.s-tbl{width:100%;border-collapse:collapse;margin-top:6px;font-size:12.5px;} .s-tbl th,.s-tbl td{padding:4px 3px;text-align:right;border-bottom:1px dashed rgba(124,138,165,.25);}
.s-tbl th:first-child,.s-tbl td:first-child{text-align:left;color:var(--s-muted);} .s-tbl th{color:var(--s-muted);font-weight:500;} .s-tot td{font-weight:700;color:var(--s-text)!important;} .s-best td{color:var(--s-up)!important;}
.s-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
.s-act{background:transparent;border:1px solid var(--s-gold);color:var(--s-gold);border-radius:999px;padding:5px 11px;font-size:12px;cursor:pointer;}
.s-act:hover{background:var(--s-gold);color:#1a1200;}
.s-chips{display:flex;gap:6px;overflow-x:auto;padding:6px 12px 8px;scrollbar-width:none;} .s-chips::-webkit-scrollbar{display:none;}
.s-chip{flex:none;background:var(--s-surface);border:1px solid var(--s-line);color:var(--s-text);border-radius:999px;padding:6px 11px;font-size:12px;cursor:pointer;white-space:nowrap;}
.s-chip:hover{border-color:var(--s-gold);}
.s-foot{display:flex;gap:8px;align-items:center;padding:10px 12px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--s-line);background:var(--s-surface);}
.s-input{flex:1;min-width:0;background:var(--s-bg);border:1px solid var(--s-line);color:var(--s-text);border-radius:12px;padding:10px 12px;font-size:15px;font-family:inherit;outline:none;}
.s-input:focus{border-color:var(--s-gold);}
.s-btn{flex:none;width:42px;height:42px;border-radius:12px;border:1px solid var(--s-line);background:var(--s-bg);color:var(--s-text);cursor:pointer;display:flex;align-items:center;justify-content:center;}
.s-btn svg{width:20px;height:20px;} .s-send{background:var(--s-gold);border-color:var(--s-gold);color:#1a1200;}
.s-mic.rec{background:var(--s-down);border-color:var(--s-down);color:#fff;animation:surya-pulse 1.2s infinite;}
@keyframes surya-pulse{0%{box-shadow:0 0 0 0 rgba(226,96,79,.6);}100%{box-shadow:0 0 0 12px rgba(226,96,79,0);}}
.s-typing{display:inline-flex;gap:4px;} .s-typing i{width:6px;height:6px;border-radius:50%;background:var(--s-muted);animation:surya-dot 1s infinite;} .s-typing i:nth-child(2){animation-delay:.15s;} .s-typing i:nth-child(3){animation-delay:.3s;}
@keyframes surya-dot{0%,80%,100%{opacity:.25;}40%{opacity:1;}}
@media (max-width:600px){
  .surya-panel{right:0;left:0;bottom:0;width:100%;max-width:100%;height:88vh;height:88dvh;border-radius:18px 18px 0 0;}
  .surya-panel.open ~ .surya-fab,.surya-root.is-open .surya-fab{display:none;}
  .s-input{font-size:16px;}
}
@media (prefers-reduced-motion:reduce){.surya-fab .rays,.s-mic.rec{animation:none;}}
`;

const SUN = `<svg viewBox="0 0 48 48" aria-hidden="true"><g class="rays" stroke="#7A3E06" stroke-width="3" stroke-linecap="round">${
  Array.from({length:8},(_,i)=>{const a=i*Math.PI/4,x1=24+Math.cos(a)*15,y1=24+Math.sin(a)*15,x2=24+Math.cos(a)*21,y2=24+Math.sin(a)*21;return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;}).join('')
}</g><circle cx="24" cy="24" r="10" fill="#FFF3C4" stroke="#7A3E06" stroke-width="2.5"/></svg>`;
const MIC  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l16-8-6 16-2-7-8-1z"/></svg>';

let root, panel, body, input, micBtn, spkBtn, chipsEl, langSel, tipEl;
let speakAlways = false, lastViaVoice = false;
try { speakAlways = localStorage.getItem('surya-speak') === '1'; } catch(e){}

function chips(){
  const set = PREF === 'hi' || (PREF==='auto' && lastDetected==='hi')
    ? ['अभी का भाव','बाज़ार का मूड','50000 लगाऊँ तो कितने यूनिट','मेरी होल्डिंग्स','MTF 1 लाख 10 दिन ब्याज','SIP 5000 12% 10 साल','मदद']
    : PREF === 'hn' || (PREF==='auto' && lastDetected==='hn')
    ? ['aaj ka bhav','market ka mood','50000 lagau to kitne units','meri holdings','MTF 1 lakh 10 din interest','SIP 5000 12% 10 saal','help']
    : ['Live price','Market bias','30–60 min signal','Invest ₹50,000','My holdings P&L','MTF ₹1 lakh 10 days','Compare brokers ₹1 lakh','Help'];
  chipsEl.innerHTML = set.map(c => `<button type="button" class="s-chip">${esc(c)}</button>`).join('');
}

function addMsg(html, who){
  const d = document.createElement('div');
  d.className = 's-msg ' + (who === 'user' ? 's-user' : 's-bot');
  if (who === 'user') d.textContent = html; else d.innerHTML = html;
  body.appendChild(d); body.scrollTop = body.scrollHeight;
  return d;
}

function botReply(res){
  const d = addMsg(res.html, 'bot');
  d.setAttribute('lang', LANG === 'hi' ? 'hi' : 'en');
  if (res.actions && res.actions.length){
    const box = document.createElement('div'); box.className = 's-acts';
    res.actions.forEach(a => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 's-act'; b.textContent = a.label;
      b.onclick = () => { const out = a.run(); if (out) { addMsg(esc(out), 'bot'); speak(out); } };
      box.appendChild(b);
    });
    d.appendChild(box);
  }
  body.scrollTop = body.scrollHeight;
  d.querySelectorAll('[data-ask]').forEach(li => li.addEventListener('click', () => ask(li.getAttribute('data-ask'))));
  if (speakAlways || lastViaVoice) speak(d.innerText.replace(/(Load into calculator|कैलकुलेटर में भरें|Calculator mein bharo)[\s\S]{0,}/,''));
  lastViaVoice = false;
}

function ask(q, viaVoice){
  q = String(q||'').trim(); if (!q) return;
  lastViaVoice = !!viaVoice;
  addMsg(q, 'user');
  const t = addMsg('<span class="s-typing"><i></i><i></i><i></i></span>', 'bot');
  setTimeout(() => {
    t.remove();
    let res;
    try { res = answer(q); } catch(e){ console.error('[Surya]', e); res = { html: L('Sorry — something went wrong with that calculation. Try rephrasing?','माफ़ कीजिए — हिसाब में गड़बड़ हुई। दोबारा अलग तरह से पूछें?','Sorry — hisaab mein gadbad hui. Dobara alag tarah poochho?') }; }
    botReply(res);
    if (PREF === 'auto') chips();
  }, 260);
}

// ---- voice out ----
function pickVoice(lang){
  if (!('speechSynthesis' in window)) return null;
  const vs = speechSynthesis.getVoices();
  const want = lang === 'hi' ? ['hi-IN','hi'] : ['en-IN','en-GB','en-US','en'];
  for (const w of want){ const v = vs.find(v => v.lang && v.lang.replace('_','-').toLowerCase().startsWith(w.toLowerCase())); if (v) return v; }
  return null;
}
function speak(text){
  if (!('speechSynthesis' in window) || !text) return;
  try {
    speechSynthesis.cancel();
    let t = text.replace(/\s+/g,' ').replace(/₹\s?/g, LANG==='hi' ? ' रुपये ' : ' rupees ').replace(/%/g, LANG==='hi' ? ' प्रतिशत' : ' percent')
                .replace(/→/g, LANG==='hi' ? ' से ' : ' to ').replace(/×/g, ' times ').replace(/[·|]/g, ', ').replace(/(\d),(?=\d)/g,'$1');
    const u = new SpeechSynthesisUtterance(t.slice(0, 900));
    const v = pickVoice(LANG === 'hi' ? 'hi' : 'en');
    if (v) u.voice = v;
    u.lang = v ? v.lang : (LANG === 'hi' ? 'hi-IN' : 'en-IN');
    u.rate = 1.02;
    speechSynthesis.speak(u);
  } catch(e){}
}

// ---- voice in ----
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recording = false;
function toggleMic(){
  if (!SR){ addMsg(L('Voice input isn\'t supported in this browser — try Chrome or Edge.','इस ब्राउज़र में आवाज़ इनपुट उपलब्ध नहीं — Chrome या Edge आज़माएँ।','Is browser mein voice input nahi hai — Chrome ya Edge try karo.'), 'bot'); return; }
  if (recording){ try { rec.stop(); } catch(e){} return; }
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch(e){}
  rec = new SR();
  const useHi = PREF === 'hi' || (PREF === 'auto' && lastDetected === 'hi');
  rec.lang = useHi ? 'hi-IN' : 'en-IN';
  rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
  let finalText = '';
  rec.onstart = () => { recording = true; micBtn.classList.add('rec'); input.placeholder = useHi ? 'बोलिए…' : 'Listening… (Hindi? switch to हिंदी)'; };
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++){
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
    }
    input.value = (finalText + ' ' + interim).trim();
  };
  rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') addMsg(L('Microphone permission was blocked. Allow it in the browser\'s address bar and try again.','माइक्रोफ़ोन की अनुमति नहीं मिली। ब्राउज़र में अनुमति दें और फिर कोशिश करें।','Mic permission block hai. Browser mein allow karke dobara try karo.'), 'bot'); };
  rec.onend = () => {
    recording = false; micBtn.classList.remove('rec'); input.placeholder = placeholder();
    const q = (finalText || input.value).trim();
    if (q){ input.value = ''; ask(q, true); }
  };
  try { rec.start(); } catch(e){ recording = false; }
}

function placeholder(){
  return PREF === 'hi' ? 'पूछिए… जैसे "50000 लगाऊँ तो?"' : PREF === 'hn' ? 'Poochho… jaise "50000 lagau to?"' : 'Ask Surya… e.g. "invest 50k"';
}

function openPanel(){
  panel.classList.add('open'); root.classList.add('is-open');
  fab.setAttribute('aria-expanded','true');
  if (tipEl) tipEl.classList.remove('show');
  if (!body.children.length){ LANG = PREF === 'auto' ? 'en' : PREF; botReply(hHelp(true)); }
  setTimeout(() => { if (window.innerWidth > 600) input.focus(); }, 60);
}
function closePanel(){
  panel.classList.remove('open'); root.classList.remove('is-open'); fab.setAttribute('aria-expanded','false');
  try { if (recording) rec.stop(); speechSynthesis.cancel(); } catch(e){}
}

let fab;
function build(){
  const st = document.createElement('style'); st.id = 'surya-css'; st.textContent = CSS; document.head.appendChild(st);
  root = document.createElement('div'); root.className = 'surya-root'; root.id = 'surya-root';
  root.innerHTML = `
    <div class="surya-panel" role="dialog" aria-label="Surya assistant">
      <div class="s-head">
        <div class="s-av">${SUN}</div>
        <div class="s-title"><b>Surya · सूर्य</b><div>Calculation assistant</div></div>
        <select class="s-lang" aria-label="Language">
          <option value="auto">Auto</option><option value="en">English</option><option value="hi">हिंदी</option><option value="hn">Hinglish</option>
        </select>
        <button type="button" class="s-icon s-spk" title="Read answers aloud" aria-label="Read answers aloud">🔊</button>
        <button type="button" class="s-icon s-x" title="Close" aria-label="Close">✕</button>
      </div>
      <div class="s-body" aria-live="polite"></div>
      <div class="s-chips"></div>
      <form class="s-foot" autocomplete="off">
        <input class="s-input" type="text" enterkeyhint="send" aria-label="Your question">
        <button type="button" class="s-btn s-mic" title="Speak" aria-label="Speak">${MIC}</button>
        <button type="submit" class="s-btn s-send" title="Send" aria-label="Send">${SEND}</button>
      </form>
    </div>
    <div class="surya-tip">${'Ask Surya ☀️ — हिसाब पूछें'}</div>
    <button type="button" class="surya-fab" aria-label="Open Surya assistant" aria-expanded="false">${SUN}</button>`;
  document.body.appendChild(root);
  panel = root.querySelector('.surya-panel'); body = root.querySelector('.s-body'); input = root.querySelector('.s-input');
  micBtn = root.querySelector('.s-mic'); spkBtn = root.querySelector('.s-spk'); chipsEl = root.querySelector('.s-chips');
  langSel = root.querySelector('.s-lang'); fab = root.querySelector('.surya-fab'); tipEl = root.querySelector('.surya-tip');

  langSel.value = PREF; input.placeholder = placeholder();
  spkBtn.classList.toggle('on', speakAlways);
  if (!SR) micBtn.style.display = 'none';
  chips();

  fab.addEventListener('click', () => panel.classList.contains('open') ? closePanel() : openPanel());
  root.querySelector('.s-x').addEventListener('click', closePanel);
  root.querySelector('.s-foot').addEventListener('submit', e => { e.preventDefault(); const q = input.value; input.value = ''; ask(q); });
  micBtn.addEventListener('click', toggleMic);
  spkBtn.addEventListener('click', () => { speakAlways = !speakAlways; spkBtn.classList.toggle('on', speakAlways); try { localStorage.setItem('surya-speak', speakAlways?'1':'0'); } catch(e){} if (!speakAlways) try { speechSynthesis.cancel(); } catch(e){} });
  langSel.addEventListener('change', () => { PREF = langSel.value; try { localStorage.setItem('surya-lang', PREF); } catch(e){} input.placeholder = placeholder(); chips(); });
  chipsEl.addEventListener('click', e => { const c = e.target.closest('.s-chip'); if (c) ask(c.textContent); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('open')) closePanel(); });
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => {};

  // one-time nudge
  let seen = false; try { seen = sessionStorage.getItem('surya-tip') === '1'; } catch(e){}
  if (!seen){ setTimeout(() => { tipEl.classList.add('show'); setTimeout(() => tipEl.classList.remove('show'), 5000); }, 2500); try { sessionStorage.setItem('surya-tip','1'); } catch(e){} }
}

// Public hook (also handy for testing from the console)
window.Surya = { ask: q => { if (!panel) build(); openPanel(); ask(q); }, answer: q => answer(q), open: () => openPanel(), close: () => closePanel() };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
