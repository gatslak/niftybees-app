// ---------------- state ----------------
const WEIGHTS = {
  gift: 3.0, preopen: 2.5, us: 1.5, asia: 1.0, fx: 0.5, vix: 0.5
};
const data = { gift:null, preopen:null, us:null, asia:null, fx:null, vix:null };

// PRIMARY: your own Cloudflare Worker proxy. Unlike the shared public
// proxies below, this one is tied to your own Cloudflare account with a
// 100,000 requests/day free quota that nobody else can exhaust — so it
// can't be rate-limited or IP-blocked by other people's usage, which is
// exactly what was breaking the app before.
const PRIMARY_PROXY = url => 'https://niftybees-proxy.119ecw.workers.dev/?url=' + encodeURIComponent(url);

// FALLBACK ONLY: shared public CORS proxies, used solely if the Worker
// above is somehow unreachable. These are rate-limited per IP and shared
// globally, so they're unreliable by nature — kept purely as a safety net.
const PROXIES = [
  url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
  url => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url),
  url => 'https://proxy.corsfix.com/?' + url,
  url => 'https://cors.x2u.in/' + url,
];

// Small animated ▲/▼/● marker: green+bounces-up when positive, red+bounces-
// down when negative, gold/flat and still when exactly unchanged.
function trendArrow(pc){
  const svgOpen = '<svg class="trend-arrow TREND_CLASS" width="44" height="44" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">';
  if(pc > 0) return svgOpen.replace('TREND_CLASS','up') + '<path d="M12 21V5M5 12L12 4L19 12" stroke="currentColor" stroke-width="3.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  if(pc < 0) return svgOpen.replace('TREND_CLASS','down') + '<path d="M12 3V19M5 12L12 20L19 12" stroke="currentColor" stroke-width="3.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return svgOpen.replace('TREND_CLASS','flat') + '<line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="3.75" stroke-linecap="round"/></svg>';
}

function setBadge(id, state, msg){ // live | failed | pending
  const el = document.getElementById('badge-'+id);
  el.className = 'badge ' + state;
  el.textContent = state === 'live' ? 'live' : state === 'failed' ? 'unavailable' : 'pending';
  if(msg){
    const sub = document.getElementById('sub-'+id);
    if(sub) sub.textContent = msg;
  }
}

async function fetchRaw(url, ms=9000){
  // Deliberately not using AbortController/AbortSignal here — some sandboxed
  // preview environments relay fetch through postMessage, and AbortSignal
  // objects cannot be structured-cloned across that boundary, which throws
  // before the request even starts. A plain Promise.race timeout has no
  // such dependency and behaves identically in every environment. The one
  // tradeoff: the underlying request isn't actually cancelled on timeout,
  // it just stops being awaited — a negligible cost here.
  const fetchPromise = fetch(url, {cache: 'no-store'});
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('timeout after ' + ms + 'ms')), ms);
  });
  const r = await Promise.race([fetchPromise, timeoutPromise]);
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r;
}

// Appends a cache-busting timestamp so neither the browser nor an
// intermediate proxy/CDN ever serves a stale cached response for
// live price data.
function cacheBust(url){
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + '_cb=' + Date.now();
}

// Tries your own Cloudflare Worker first, then public proxies as backup.
async function fetchViaProxy(targetUrl, ms=7000){
  const bustedUrl = cacheBust(targetUrl);

  // 1. Your own Worker — should succeed essentially every time. It has a
  //    100k/day quota that only you use, so no shared-rate-limit issues.
  try{
    return await fetchRaw(PRIMARY_PROXY(bustedUrl), ms);
  }catch(primaryErr){
    // 2. Only if the Worker itself is unreachable, fall back to the public
    //    proxies in parallel as a last resort.
    const fallbacks = PROXIES.map(build => fetchRaw(build(bustedUrl), ms));
    try{
      return await Promise.any(fallbacks);
    }catch(aggregateError){
      const reasons = ['worker: ' + primaryErr.message,
                        ...((aggregateError.errors || []).map(e => e.message))].join('; ');
      throw new Error(reasons || 'all proxies failed');
    }
  }
}

// ---------------- GIFT Nifty (scrape) ----------------
async function fetchGift(){
  setBadge('gift','pending');
  try{
    const r = await fetchViaProxy('https://www.niftytrader.in/gift-nifty-live');
    const html = await r.text();
    const text = html.replace(/<[^>]+>/g,' ');
    const m = text.match(/Implied Nifty Open[\s\S]{0,120}?(-?\d[\d,]*\.?\d*)/);
    if(!m) throw new Error('pattern not found in page');
    const gap = parseFloat(m[1].replace(/,/g,''));
    data.gift = gap;
    document.getElementById('val-gift').textContent = (gap>0?'+':'')+gap.toFixed(1)+' pts';
    document.getElementById('val-gift').className = 'card-value ' + (gap>0?'bull':gap<0?'bear':'');

    // Also pull the live GIFT Nifty futures level and its own change, so you
    // can see where GIFT is actually trading — not just the derived gap.
    let subText = 'Implied Nifty 50 opening gap';
    const lvl = text.match(/GIFT\s*Nifty[\s\S]{0,80}?(\d{2},\d{3}\.\d{2}|\d{5}\.\d{2})/);
    const chg = text.match(/GIFT\s*Nifty[\s\S]{0,200}?\(\s*([+-]?\d+\.\d+)\s*%\s*\)/);
    if(lvl){
      const level = parseFloat(lvl[1].replace(/,/g,''));
      const pct = chg ? parseFloat(chg[1]) : null;
      const box = document.getElementById('gift-level-box');
      box.style.display = 'block';
      box.innerHTML = `
        <div class="gl-label">GIFT Nifty live level</div>
        <div class="gl-row">
          <span class="gl-value">${level.toLocaleString('en-IN',{minimumFractionDigits:2})}</span>
          ${pct!==null ? `<span class="gl-pct ${pct>0?'bull':pct<0?'bear':''}">${pct>0?'+':''}${pct.toFixed(2)}%</span>` : ''}
        </div>`;
      subText = 'Implied gap + live GIFT Nifty futures level';
    }
    setBadge('gift','live', subText);
  }catch(e){
    document.getElementById('gift-level-box').style.display = 'none';
    setBadge('gift','failed', 'Fetch failed ('+e.message+')');
  }
}
// ---------------- NSE pre-open (official) ----------------
// NSE's market-data-pre-open endpoint itself is time-gated: it only returns
// a real "niftyPreopenStatus" row during the actual ~9:00-9:08 AM IST
// pre-open session. Outside that ~8-minute window it responds 200 OK with
// an EMPTY payload ({"data":[],"msg":"No Data Found"}) — not blocked, not
// broken, just genuinely nothing to report yet/anymore for the day. Since
// a fresh page load has no memory of an earlier successful read, checking
// the app at any other time of day (i.e. almost all day, every day) always
// hit the catch block and showed "unavailable" — which is what looked like
// "never loads". Fixed by caching the last successfully-captured reading
// for today (IST) in localStorage the moment it's seen live, and falling
// back to that cached reading the rest of the day instead of erroring out.
const PREOPEN_CACHE_KEY = 'niftybees_preopen_cache_v1';
function istDateStr(){
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
}
function istTimeStr(){
  return new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Kolkata', hour:'2-digit', minute:'2-digit', hour12:false}).format(new Date());
}
function istHourMinNum(){
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Kolkata', hour:'2-digit', minute:'2-digit', hour12:false}).formatToParts(new Date());
  const h = parseInt(parts.find(p=>p.type==='hour').value,10);
  const m = parseInt(parts.find(p=>p.type==='minute').value,10);
  return h*60+m;
}
function savePreopenCache(pc, adv, dec, unch){
  try{
    localStorage.setItem(PREOPEN_CACHE_KEY, JSON.stringify({date: istDateStr(), pChange: pc, advances: adv, declines: dec, unchanged: unch, capturedAt: istTimeStr()}));
  }catch(e){ /* storage unavailable — cache is a convenience only, safe to skip */ }
}
function loadPreopenCache(){
  try{
    const raw = localStorage.getItem(PREOPEN_CACHE_KEY);
    if(!raw) return null;
    const obj = JSON.parse(raw);
    return (obj && obj.date === istDateStr()) ? obj : null;
  }catch(e){ return null; }
}
function showPreopenValue(pc){
  document.getElementById('val-preopen').innerHTML = trendArrow(pc) + (pc>0?'+':'')+pc.toFixed(2)+'%';
  document.getElementById('val-preopen').className = 'card-value ' + (pc>0?'bull':pc<0?'bear':'flat');
}
async function fetchPreopen(){
  setBadge('preopen','pending');
  try{
    const r = await fetchViaProxy('https://www.nseindia.com/api/market-data-pre-open?key=NIFTY');
    const j = await r.json();
    // The Nifty 50 index itself is never a row inside j.data — that array is
    // only the 50 individual constituent stocks. NSE reports the index's own
    // pre-open change in a separate top-level "niftyPreopenStatus" object.
    const row = j.niftyPreopenStatus;
    if(!row || row.pChange===undefined || row.pChange===null) throw new Error('window closed right now');
    const pc = parseFloat(row.pChange);
    data.preopen = pc;
    showPreopenValue(pc);
    renderBreadth(j.advances, j.declines, j.unchanged);
    savePreopenCache(pc, j.advances, j.declines, j.unchanged);
    const windowOpen = String(row.status||'').toUpperCase()==='OPEN';
    setBadge('preopen','live', windowOpen ? 'Nifty 50 pre-open indicative move' : 'Last pre-open reading — window is closed now (~9:00–9:08 AM IST)');
  }catch(e){
    // Expected outside the ~9:00-9:08 AM IST window — fall back to today's
    // cached reading (captured earlier today, this device) if we have one.
    const cached = loadPreopenCache();
    if(cached){
      data.preopen = cached.pChange;
      showPreopenValue(cached.pChange);
      renderBreadth(cached.advances, cached.declines, cached.unchanged);
      setBadge('preopen','live', `Last pre-open reading today, captured ${cached.capturedAt} IST — window is closed now`);
    } else {
      document.getElementById('breadth-box').style.display = 'none';
      const mins = istHourMinNum();
      if(mins < 540){ // before 9:00 AM IST
        setBadge('preopen','pending', "Opens ~9:00–9:08 AM IST — check back then.");
      } else {
        setBadge('preopen','failed', "No pre-open reading captured today on this device — the ~9:00–9:08 AM IST window already passed. It'll show up automatically if you have the page open during that window; otherwise check back tomorrow.");
      }
    }
  }
}

// Shows how many of the Nifty 50 constituents are up / down / flat in the
// pre-open session — a breadth read that often tells you more about the
// likely open than the index number alone (e.g. 50/0/0 is a far stronger
// signal than +0.6% on its own suggests).
function renderBreadth(adv, dec, unch){
  const a = Number(adv)||0, d = Number(dec)||0, u = Number(unch)||0;
  const total = a + d + u;
  const box = document.getElementById('breadth-box');
  if(!total){ box.style.display = 'none'; return; }
  box.style.display = 'block';
  const aPct = (a/total*100), dPct = (d/total*100), uPct = (u/total*100);
  box.innerHTML = `
    <div class="breadth-label">Pre-open breadth — ${total} Nifty 50 stocks</div>
    <div class="breadth-bar">
      <div class="bseg badv" style="width:${aPct}%"></div>
      <div class="bseg bunch" style="width:${uPct}%"></div>
      <div class="bseg bdec" style="width:${dPct}%"></div>
    </div>
    <div class="breadth-nums">
      <span class="bnum bull">${a} advancing</span>
      <span class="bnum bmuted">${u} unchanged</span>
      <span class="bnum bear">${d} declining</span>
    </div>`;
}
// ---------------- India VIX (official) ----------------
async function fetchVix(){
  setBadge('vix','pending');
  try{
    const r = await fetchViaProxy('https://www.nseindia.com/api/allIndices');
    const j = await r.json();
    const row = (j.data||[]).find(x=>(x.index||'').includes('VIX'));
    if(!row) throw new Error('no vix row in response');
    const pc = row.percentChange;
    data.vix = pc;
    document.getElementById('val-vix').textContent = row.last + ' (' + (pc>0?'+':'') + pc.toFixed(2) + '%)';
    document.getElementById('val-vix').className = 'card-value ' + (pc<0?'bull':pc>0?'bear':'');
    setBadge('vix','live');
  }catch(e){
    setBadge('vix','failed', e.message);
  }
}
// ---------------- Market-moving headlines (RSS) ----------------
// Informational only — not part of the weighted bias-lean score, so it's
// deliberately left out of WEIGHTS/labels/computeScore below.
function escNews(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// BBC's "Business" RSS is a general section feed — it mixes real
// market-moving stories (rates, budgets, earnings) with consumer/lifestyle
// pieces (restaurant tips, gadget launches, career advice) that have
// nothing to do with markets. ET Markets is already market-specific by
// nature, so only the BBC feed needs filtering. We pull a larger pool from
// BBC and keep only headlines matching finance/market keywords, falling
// back to the unfiltered pool if nothing matches (so the card never goes
// empty just because a slow news day used different wording).
const MARKET_KEYWORDS = /\b(stocks?|shares?|markets?|indices|index|nifty|sensex|nasdaq|dow jones|s&p|ftse|rupee|dollar|inflation|interest rate|rate hike|rate cut|fed|rbi|gdp|econom(y|ic|ics)|budget|borrowing|ipo|debut|earnings|revenue|profits?|tariffs?|trade war|bonds?|yields?|crude|oil price|recession|downturn|investors?|sell-?off|rally|plunge|crash|merger|acquisition|central bank|valued at)\b/i;

async function fetchNews(){
  setBadge('news','pending');
  const feeds = [
    {url:'http://feeds.bbci.co.uk/news/business/rss.xml', source:'BBC Business', take:2, poolSize:12, filterRelevant:true},
    {url:'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', source:'ET Markets', take:2, poolSize:2, filterRelevant:false}
  ];
  const parser = new DOMParser();
  const items = [];
  let anyFeedFailed = false;
  for(const f of feeds){
    try{
      const r = await fetchViaProxy(f.url);
      const text = await r.text();
      const xml = parser.parseFromString(text, 'text/xml');
      if(xml.querySelector('parsererror')) throw new Error('bad XML');
      const candidates = Array.from(xml.querySelectorAll('item')).slice(0, f.poolSize);
      let picked = candidates;
      if(f.filterRelevant){
        const relevant = candidates.filter(n => MARKET_KEYWORDS.test(n.querySelector('title')?.textContent || ''));
        picked = relevant.length ? relevant : candidates; // never show nothing over showing off-topic
      }
      picked.slice(0, f.take).forEach(n=>{
        const title = n.querySelector('title')?.textContent?.trim();
        const link = n.querySelector('link')?.textContent?.trim();
        if(title) items.push({title, link, source:f.source});
      });
    }catch(e){ anyFeedFailed = true; }
  }
  if(!items.length){
    document.getElementById('val-news').textContent = 'Headlines unavailable right now';
    setBadge('news','failed', 'All news sources failed to load');
    return;
  }
  document.getElementById('val-news').innerHTML = '<ul class="news-list">' +
    items.map(it => '<li>' + (it.link ? `<a href="${escNews(it.link)}" target="_blank" rel="noopener noreferrer">${escNews(it.title)}</a>` : escNews(it.title)) + `<span class="news-src">${escNews(it.source)}</span></li>`).join('') +
    '</ul>';
  setBadge('news','live', anyFeedFailed ? 'One source failed — showing what loaded' : 'Updates each refresh, not investment advice');
}
// ---------------- Global cues via Yahoo Finance ----------------
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function fetchYahooChart(symbol){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const r = await fetchViaProxy(url);
  const j = await r.json();
  if(!j || !j.chart || !Array.isArray(j.chart.result) || !j.chart.result[0]){
    // The proxy returned 200 OK but not real Yahoo data (its own error page,
    // a rate-limit notice, etc.) — surface a clear message instead of
    // crashing on "null is not an object" deep inside the parser.
    const reason = (j && j.chart && j.chart.error && j.chart.error.description) || 'unexpected response shape';
    throw new Error('proxy returned invalid data (' + reason + ')');
  }
  const result = j.chart.result[0];
  const closes = (result.indicators && result.indicators.quote && result.indicators.quote[0] &&
                  result.indicators.quote[0].close || []).filter(x=>x!=null);
  if(closes.length < 2 || !result.meta){
    throw new Error('incomplete price series in response');
  }
  const last = closes[closes.length-1], prev = closes[closes.length-2];
  return { last, prev, pct: (last-prev)/prev*100, meta: result.meta };
}
async function fetchYahooPct(symbol){
  return (await fetchYahooChart(symbol)).pct;
}

let livePrice = null;

function setPriceDisplay(price, prevClose, sourceLabel){
  livePrice = price;
  const pct = (price - prevClose) / prevClose * 100;
  document.getElementById('price-value').textContent = '₹' + price.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const pctEl = document.getElementById('price-pct');
  pctEl.textContent = (pct>0?'+':'')+pct.toFixed(2)+'%';
  pctEl.className = 'price-pct ' + (pct>0?'bull':pct<0?'bear':'');
  document.getElementById('sub-price').textContent = (prevClose ? 'Prev close ₹'+prevClose.toLocaleString('en-IN',{minimumFractionDigits:2}) : '') + (sourceLabel ? '  ·  '+sourceLabel : '');

  if(prevClose){
    document.getElementById('last-close-row').style.display = 'flex';
    document.getElementById('lc-value').textContent = '₹' + prevClose.toLocaleString('en-IN',{minimumFractionDigits:2});
    const lcPctEl = document.getElementById('lc-pct');
    lcPctEl.textContent = (pct>0?'+':'')+pct.toFixed(2)+'% since';
    lcPctEl.className = 'lc-pct ' + (pct>0?'bull':pct<0?'bear':'');
  }
  computeHoldings();
  return pct;
}

async function fetchNiftybeesPrice(){
  setBadge('price','pending');

  // Attempt 1: Yahoo Finance chart endpoint (via proxy)
  try{
    const c = await fetchYahooChart('NIFTYBEES.NS');
    const price = c.meta.regularMarketPrice ?? c.last;
    const prevClose = c.meta.previousClose ?? c.prev;
    if(!price || !prevClose) throw new Error('empty price from Yahoo');
    setPriceDisplay(price, prevClose, 'Yahoo Finance');
    setBadge('price','live');
    return;
  }catch(e1){
    // Attempt 2: NSE quote-equity endpoint (via proxy) as fallback
    try{
      const r = await fetchViaProxy('https://www.nseindia.com/api/quote-equity?symbol=NIFTYBEES');
      const j = await r.json();
      const price = j.priceInfo && j.priceInfo.lastPrice;
      const prevClose = j.priceInfo && j.priceInfo.previousClose;
      if(!price || !prevClose) throw new Error('empty price from NSE');
      setPriceDisplay(price, prevClose, 'NSE');
      setBadge('price','live');
      return;
    }catch(e2){
      setBadge('price','failed');
      document.getElementById('sub-price').textContent =
        'Both sources failed (Yahoo: '+e1.message+' · NSE: '+e2.message+') — enter LTP manually below';
    }
  }
}

function applyManualPrice(){
  const v = parseFloat(document.getElementById('manual-price').value);
  if(isNaN(v) || v<=0) return;
  livePrice = v;
  document.getElementById('price-value').textContent = '₹' + v.toLocaleString('en-IN',{minimumFractionDigits:2});
  document.getElementById('price-pct').textContent = '';
  document.getElementById('price-pct').className = 'price-pct';
  document.getElementById('sub-price').textContent = 'Manually entered';
  setBadge('price','live');
  computeHoldings();
}

let holdingsMode = 'long';       // 'long' | 'short'
let exitInputMode = 'price';     // 'price' | 'pct' — which exit input drives the calculation

function setExitMode(mode){
  exitInputMode = mode;
  document.getElementById('exit-mode-btn-price').classList.toggle('active', mode==='price');
  document.getElementById('exit-mode-btn-pct').classList.toggle('active', mode==='pct');
  document.getElementById('exit-price-row').style.display = mode==='price' ? 'flex' : 'none';
  document.getElementById('exit-pct-row').style.display = mode==='pct' ? 'flex' : 'none';
  computeHoldings();
}
let holdingsSubMode = 'delivery'; // 'delivery' | 'intraday' | 'mtf' — only meaningful when holdingsMode==='long'

function setHoldingsMode(mode){
  holdingsMode = mode;
  document.getElementById('holdings-mode-btn-long').classList.toggle('active', mode==='long');
  document.getElementById('holdings-mode-btn-short').classList.toggle('active', mode==='short');
  document.getElementById('holdings-submode-toggle').style.display = mode==='long' ? 'flex' : 'none';
  document.getElementById('holdings-short-note').style.display = mode==='short' ? 'block' : 'none';
  document.getElementById('holdings-price-label').textContent = mode==='long' ? 'Entry price (₹)' : 'Short-sale price (₹)';
  if(mode==='short'){
    document.getElementById('holdings-mtf-fields').classList.remove('show');
  } else {
    document.getElementById('holdings-mtf-fields').classList.toggle('show', holdingsSubMode==='mtf');
  }
  computeHoldings();
}

function setHoldingsSubMode(sub){
  holdingsSubMode = sub;
  ['delivery','intraday','mtf'].forEach(s => {
    document.getElementById('holdings-sub-btn-'+s).classList.toggle('active', s===sub);
  });
  document.getElementById('holdings-mtf-fields').classList.toggle('show', sub==='mtf');
  computeHoldings();
}

const MAX_HOLDINGS_SLOTS = 20;
function setHoldingsSlotCount(){
  const n = parseInt(document.getElementById('holdings-slot-count').value, 10);
  for(let i=1; i<=MAX_HOLDINGS_SLOTS; i++){
    document.querySelector(`.holdings-row[data-slot="${i}"]`).style.display = (i<=n) ? 'flex' : 'none';
  }
  computeHoldings();
}

function fmtCharge(n){
  return '₹' + n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
}

// Finds the exit price at which net P&L (after all charges, and MTF interest
// if applicable) is exactly zero. Charges are not linear in price (tiered
// brokerage), so this is solved numerically via bisection rather than algebra.
function computeBreakevenExitPrice(isLong, totalUnits, totalValue, entryChargesTotal, mtfInterest, brokerKey, isIntraday){
  if(!totalUnits || totalUnits<=0 || !totalValue) return 0;
  const exitIsBuy = !isLong; // long exits via sell, short exits via buy-back
  function netPnlAt(exitPrice){
    const exitValue = totalUnits*exitPrice;
    const exitCharges = legBreakdown(exitValue, exitIsBuy, brokerKey, isIntraday).total;
    const grossPnl = isLong ? (exitValue-totalValue) : (totalValue-exitValue);
    return grossPnl - entryChargesTotal - exitCharges - mtfInterest;
  }
  const avg = totalValue/totalUnits;
  let lo, hi;
  if(isLong){
    lo = avg; hi = avg*3;
    let tries = 0;
    while(netPnlAt(hi) < 0 && tries < 50){ hi *= 1.5; tries++; }
  } else {
    lo = avg*0.01; hi = avg;
    let tries = 0;
    while(netPnlAt(lo) < 0 && tries < 50){ lo *= 0.5; tries++; }
  }
  for(let i=0; i<60; i++){
    const mid = (lo+hi)/2;
    const val = netPnlAt(mid);
    if(isLong){
      if(val < 0) lo = mid; else hi = mid;
    } else {
      if(val < 0) hi = mid; else lo = mid;
    }
  }
  return (lo+hi)/2;
}

// Finds the exit price at which net P&L (after all charges, taxes, and MTF
// interest if applicable) equals a TARGET profit — expressed as a percentage
// of the capital actually put in (unleveraged, what you typed in). Same
// bisection approach as computeBreakevenExitPrice, just solving for a
// non-zero target instead of zero.
function computeExitPriceForTargetPct(isLong, totalUnits, totalValue, entryChargesTotal, mtfInterest, brokerKey, isIntraday, capital, targetPct){
  if(!totalUnits || totalUnits<=0 || !totalValue || !capital || !targetPct) return 0;
  const targetProfit = capital*(targetPct/100);
  const exitIsBuy = !isLong;
  function netPnlAt(exitPrice){
    const exitValue = totalUnits*exitPrice;
    const exitCharges = legBreakdown(exitValue, exitIsBuy, brokerKey, isIntraday).total;
    const grossPnl = isLong ? (exitValue-totalValue) : (totalValue-exitValue);
    return grossPnl - entryChargesTotal - exitCharges - mtfInterest;
  }
  const avg = totalValue/totalUnits;
  let lo, hi;
  if(isLong){
    lo = avg; hi = avg*3;
    let tries = 0;
    while(netPnlAt(hi) < targetProfit && tries < 60){ hi *= 1.5; tries++; }
  } else {
    lo = avg*0.001; hi = avg;
    let tries = 0;
    while(netPnlAt(lo) < targetProfit && tries < 60){ lo *= 0.5; tries++; }
  }
  for(let i=0; i<60; i++){
    const mid = (lo+hi)/2;
    const val = netPnlAt(mid);
    if(isLong){
      if(val < targetProfit) lo = mid; else hi = mid;
    } else {
      if(val < targetProfit) hi = mid; else lo = mid;
    }
  }
  return (lo+hi)/2;
}

// ---------------- order screenshot upload / OCR ----------------
// Heuristic parser over raw OCR text (Tesseract output is noisy — no
// reliable table structure survives, and real broker screens often print
// one order's symbol/side/qty/price across SEVERAL separate lines rather
// than a single row). Strategy: split the text into "blocks" — one block
// per order/holding, anchored on whichever marker line starts it (a BUY/SELL
// mention, or a symbol/ticker mention when neither appears) — then search
// each whole block (not just its anchor line) for qty and price using
// label-aware regexes first (Qty:, Avg Price: — tolerating ₹/Rs/INR/no
// symbol, and the label wording used by Zerodha/Groww/Upstox/ICICI Direct/
// HDFC Securities/5paisa/Angel One/Kotak Neo, not just one broker), falling
// back to a same-line two-number heuristic for compact single-line rows.
// Returns up to MAX_HOLDINGS_SLOTS orders, so a screenshot (or several,
// via the "+ Add more screenshots" flow) with multiple holdings/orders
// fills multiple slots and the app then computes ONE combined breakeven/
// target-profit exit price across all of them.
function extractQtyPriceFromBlock(blockText){
  let qty = null, price = null;

  const qtyMatch = blockText.match(/(?:executed|filled|traded)?\s*qty\.?\s*[:\-]?\s*([\d,]{1,6})/i)
                 || blockText.match(/quantity\.?\s*[:\-]?\s*([\d,]{1,6})/i)
                 || blockText.match(/\bqty\b\s+([\d,]{1,6})/i)
                 || blockText.match(/\bfilled\s*[:\-]?\s*([\d,]{1,6})/i)
                 // "930 /930 Shares" (or just "930 Shares" if the slash half
                 // didn't survive OCR) — Angel One / Kotak order-book style.
                 || blockText.match(/([\d,]{1,6})\s*(?:\/\s*[\d,]{1,6})?\s*shares/i)
                 // "930 ORDER AGAIN" — same screens, but OCR sometimes drops
                 // the "/930 Shares" part entirely and only the leading
                 // filled-quantity number survives next to the button label.
                 || blockText.match(/([\d,]{1,6})\s*order\s*again/i)
                 // Zerodha Console holdings table: "Qty. 30" or bare "30 30"
                 // (qty repeated as t1+total) right under a "Qty." header.
                 || blockText.match(/\bunits?\.?\s*[:\-]?\s*([\d,]{1,6})/i);
  if(qtyMatch) qty = parseInt(qtyMatch[1].replace(/,/g, ''), 10);

  const priceMatch = blockText.match(/avg\.?\s*(?:trade\s*)?(?:buy\s*|sell\s*)?price\.?\s*[:\-]?\s*(?:₹|rs\.?|inr\.?)?\s*([\d,]+\.?\d{0,2})/i)
                   || blockText.match(/avg\.?\s*(?:cost|rate)\.?\s*[:\-]?\s*(?:₹|rs\.?|inr\.?)?\s*([\d,]+\.?\d{0,2})/i)
                   || blockText.match(/(?:trade|net|buy|sell)\s*rate\.?\s*[:\-]?\s*(?:₹|rs\.?|inr\.?)?\s*([\d,]+\.?\d{0,2})/i)
                   || blockText.match(/\bprice\.?\s*[:\-]?\s*(?:₹|rs\.?|inr\.?)?\s*([\d,]+\.?\d{0,2})/i)
                   || blockText.match(/\brate\.?\s*[:\-]?\s*(?:₹|rs\.?|inr\.?)?\s*([\d,]+\.?\d{0,2})/i)
                   || blockText.match(/(?:₹|rs\.?|inr\.?)\s*([\d,]+\.\d{1,2})\b/i);
  if(priceMatch) price = parseFloat(priceMatch[1].replace(/,/g, ''));

  // No label at all (e.g. Angel One's Order Report just prints the bare
  // price next to the symbol, "NIFTYBEES 267.79") — fall back to the first
  // properly-decimalled number (X.XX) in NIFTYBEES's plausible price range.
  // Real prices always carry 2 decimals; dates, quantities and times don't,
  // so this is unambiguous even amid other noise numbers in the block.
  if(price === null){
    const decimalCandidates = (blockText.match(/\b\d{2,4}\.\d{2}\b/g) || [])
      .map(s => parseFloat(s))
      .filter(n => n >= 50 && n <= 2000);
    if(decimalCandidates.length) price = decimalCandidates[0];
  }

  if(qty !== null && price !== null) return { qty, price, fromLabels: true };

  // Fallback: no clear labels — look for a single line inside the block
  // with two+ numbers, one in NIFTYBEES's plausible price range (₹50–2000).
  const lines = blockText.split(/\n+/).map(l => l.trim()).filter(Boolean);
  for(const line of lines){
    const nums = (line.match(/[0-9][0-9,]*\.?[0-9]*/g) || [])
      .map(s => parseFloat(s.replace(/,/g, '')))
      .filter(n => !isNaN(n));
    if(nums.length < 2) continue;
    const priceCandidates = nums.filter(n => n >= 50 && n <= 2000);
    if(priceCandidates.length === 0) continue;
    const linePrice = price !== null ? price : priceCandidates[priceCandidates.length - 1];
    const qtyCandidates = nums.filter(n => n !== linePrice && Number.isInteger(n) && n > 0 && n < 100000);
    if(qtyCandidates.length === 0) continue;
    return { qty: qty !== null ? qty : qtyCandidates[0], price: linePrice, fromLabels: false };
  }

  return null;
}

function parseOrderScreenshotText(text){
  const cleaned = (text || '').replace(/[|]/g, ' ');
  const lines = cleaned.split(/\n+/).map(l => l.trim()).filter(Boolean);
  if(lines.length === 0) return [];

  // Anchor each new block on whichever marker reliably repeats once per
  // entry. When the symbol name appears (holdings/order-report screens),
  // use ONLY that as the anchor — BUY/SELL usually appears on its own line
  // a row or two below the symbol within the SAME entry, and treating both
  // as independent anchors would wrongly split one entry into two useless
  // half-blocks (price with no qty, qty with no price). Only fall back to
  // BUY/SELL as the anchor when the symbol name never appears at all.
  const symbolRe = /nifty\s*bees/i;
  const hasSymbolAnchors = lines.some(l => symbolRe.test(l));
  const isAnchor = hasSymbolAnchors
    ? (line) => symbolRe.test(line)
    : (line) => /\bBUY\b/i.test(line) || /\bSELL\b/i.test(line);

  // Group lines into blocks, each starting at an anchor line and running
  // until (not including) the next anchor line.
  let blocks = [];
  let current = [];
  for(const line of lines){
    if(isAnchor(line) && current.length){
      blocks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if(current.length) blocks.push(current);
  // Drop any leading block that never hit an anchor (pure header noise)
  // when there's more than one block to choose from.
  if(blocks.length > 1 && !blocks[0].some(isAnchor)) blocks.shift();

  const orders = [];
  for(const block of blocks){
    const blockText = block.join('\n');
    const found = extractQtyPriceFromBlock(blockText);
    if(!found || !(found.qty > 0) || !(found.price > 0)) continue;
    const hasBuy = /\bBUY\b/i.test(blockText);
    const hasSell = /\bSELL\b/i.test(blockText);
    const side = (hasSell && !hasBuy) ? 'sell' : 'buy'; // holdings w/o BUY/SELL wording default to long
    orders.push({ qty: found.qty, price: found.price, side });
    if(orders.length >= MAX_HOLDINGS_SLOTS) break;
  }

  if(orders.length > 0) return orders;

  // Last-resort fallback: whole-text single-order label scan (handles a
  // screenshot with no clean block boundaries at all).
  const anyBuy = /\bBUY\b/i.test(cleaned), anySell = /\bSELL\b/i.test(cleaned);
  const found = extractQtyPriceFromBlock(cleaned);
  if(found && found.qty > 0 && found.price > 0){
    orders.push({ qty: found.qty, price: found.price, side: (anySell && !anyBuy) ? 'sell' : 'buy' });
  }

  return orders;
}

function withTimeout(promise, ms, message){
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let holdingsUploadBusy = false;

async function handleHoldingsUpload(event){
  const files = event.target.files ? Array.from(event.target.files) : [];
  if(files.length === 0) return;
  await processHoldingsScreenshots(files);
  // Clear the input's selection so re-choosing the SAME file again later
  // (e.g. after editing slots) still fires a change event.
  event.target.value = '';
}

function processSelectedScreenshot(){
  const input = document.getElementById('holdings-upload-input');
  const files = input.files ? Array.from(input.files) : [];
  const statusEl = document.getElementById('holdings-upload-status');
  if(files.length === 0){
    statusEl.style.display = 'block';
    statusEl.className = 'upload-status failed';
    statusEl.textContent = 'Choose a screenshot first (tap "Choose File" above), then tap this button.';
    return;
  }
  if(holdingsUploadBusy){
    statusEl.style.display = 'block';
    statusEl.className = 'upload-status pending';
    statusEl.textContent = 'Still working on the previous screenshot — please wait a moment.';
    return;
  }
  processHoldingsScreenshots(files);
}

// Opens the same file picker again for additional screenshots — new
// selections are ADDED to whatever slots are already filled (never
// overwritten), so you can build up a full statement from several
// screenshots taken one at a time.
function addMoreScreenshots(){
  document.getElementById('holdings-upload-input').click();
}

function setUploadProgress(statusEl, label, pct){
  statusEl.style.display = 'block';
  statusEl.className = 'upload-status pending';
  const clamped = typeof pct === 'number' ? Math.max(0, Math.min(100, pct)) : null;
  statusEl.innerHTML =
    '<div class="upload-progress-label">' + label + (clamped !== null ? ' — ' + clamped + '%' : '') + '</div>' +
    '<div class="upload-progress-track"><div class="upload-progress-fill" style="width:' + (clamped !== null ? clamped : 4) + '%"></div></div>';
}

// Upscales small/low-res images and boosts contrast (grayscale + a simple
// linear stretch) before handing them to Tesseract — screenshots straight
// off a phone are often small enough, or low-contrast enough (dark app
// themes especially), that individual digits/letters get missed or
// confused with each other. This runs entirely client-side via <canvas>
// and measurably improves recognition across different brokers' apps and
// screenshot styles without needing any server-side processing.
async function preprocessImageForOCR(file){
  try{
    const bitmap = await createImageBitmap(file);
    const MIN_DIM = 1200;
    const scale = Math.max(1, MIN_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    // Grayscale first, then find the actual min/max luminance so the
    // contrast stretch adapts to each screenshot instead of using a fixed
    // guess — this is what makes it help both light and dark app themes.
    let min = 255, max = 0;
    const gray = new Uint8ClampedArray(w*h);
    for(let i=0, p=0; i<d.length; i+=4, p++){
      const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      gray[p] = g;
      if(g < min) min = g;
      if(g > max) max = g;
    }
    const range = Math.max(1, max - min);
    for(let i=0, p=0; i<d.length; i+=4, p++){
      const stretched = ((gray[p] - min) / range) * 255;
      d[i] = d[i+1] = d[i+2] = stretched;
    }
    ctx.putImageData(imgData, 0, 0);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    return blob || file;
  }catch(e){
    // Preprocessing is a best-effort enhancement — if the browser can't do
    // it (very old browser, huge image, etc.) just OCR the original file.
    return file;
  }
}

// Finds the first empty slot (1-indexed) so new screenshots APPEND rather
// than overwrite whatever's already been entered/read in earlier.
function firstEmptyHoldingsSlot(){
  for(let i=1; i<=MAX_HOLDINGS_SLOTS; i++){
    const row = document.querySelector(`.holdings-row[data-slot="${i}"]`);
    const u = row.querySelector('.h-units').value;
    const p = row.querySelector('.h-price').value;
    if(!(parseFloat(u)>0) || !(parseFloat(p)>0)) return i;
  }
  return MAX_HOLDINGS_SLOTS + 1; // full
}

async function processHoldingsScreenshots(files){
  if(holdingsUploadBusy) return;
  holdingsUploadBusy = true;
  const statusEl = document.getElementById('holdings-upload-status');
  const btn = document.getElementById('holdings-process-btn');
  if(btn) btn.disabled = true;
  showCalcPopup('Reading screenshot' + (files.length>1?'s':'') + '…');

  const allOrders = [];
  let anySide = null;
  const failedFiles = [];

  try{
    if(typeof Tesseract === 'undefined'){
      throw new Error('OCR engine failed to load — check your connection and try again, or enter the values manually below.');
    }
    for(let fi = 0; fi < files.length; fi++){
      const file = files[fi];
      const fileTag = files.length>1 ? `screenshot ${fi+1} of ${files.length}` : 'screenshot';
      setUploadProgress(statusEl, `Preparing ${fileTag}…`, 0);
      const preprocessed = await preprocessImageForOCR(file);
      try{
        const { data: { text } } = await withTimeout(
          Tesseract.recognize(preprocessed, 'eng', {
            logger: (m) => {
              if(m && m.status && typeof m.progress === 'number'){
                const pct = Math.round(m.progress * 100);
                const label = m.status.charAt(0).toUpperCase() + m.status.slice(1);
                showCalcPopup(`${label}… ${pct}% (${fileTag})`);
                setUploadProgress(statusEl, `${label}… (${fileTag})`, pct);
              }
            }
          }),
          30000,
          `OCR timed out on ${fileTag} — your connection may be slow, or try a smaller/clearer screenshot.`
        );
        const orders = parseOrderScreenshotText(text);
        if(orders.length === 0){
          failedFiles.push(fileTag);
        } else {
          if(anySide === null) anySide = orders[0].side;
          allOrders.push(...orders);
        }
      }catch(fileErr){
        failedFiles.push(fileTag + ' (' + fileErr.message + ')');
      }
    }

    showCalcPopup('Calculating…');
    setUploadProgress(statusEl, 'Calculating…', 100);

    if(allOrders.length === 0){
      statusEl.className = 'upload-status failed';
      statusEl.textContent = "Couldn't read quantity/price clearly from " + (files.length>1?'any of these screenshots':'this screenshot') + " — try clearer or closer-cropped images, or enter the values manually below.";
      return;
    }

    const sideIsSell = anySide === 'sell';
    setHoldingsMode(sideIsSell ? 'short' : 'long');

    let startSlot = firstEmptyHoldingsSlot();
    const spaceLeft = MAX_HOLDINGS_SLOTS - (startSlot - 1);
    const toFill = allOrders.slice(0, Math.max(0, spaceLeft));
    const overflow = allOrders.length - toFill.length;

    const endSlot = startSlot - 1 + toFill.length;
    document.getElementById('holdings-slot-count').value = String(Math.max(endSlot, parseInt(document.getElementById('holdings-slot-count').value,10) || 1));
    setHoldingsSlotCount();

    toFill.forEach((o, idx) => {
      const row = document.querySelector(`.holdings-row[data-slot="${startSlot + idx}"]`);
      row.querySelector('.h-units').value = o.qty;
      row.querySelector('.h-price').value = o.price;
    });

    const summary = toFill.map(o => `${o.qty} @ ₹${o.price.toFixed(2)}`).join(', ');
    let msg = 'Detected from ' + (files.length>1 ? files.length+' screenshots' : 'screenshot') + ' (' + (sideIsSell?'Sell':'Buy') + '): ' + summary + ' — double-check against your screenshot' + (files.length>1?'s':'') + '; the fields below stay editable if anything looks off.';
    if(overflow > 0) msg += ` (${overflow} more entr${overflow===1?'y':'ies'} read but skipped — only ${MAX_HOLDINGS_SLOTS} slots available.)`;
    if(failedFiles.length > 0) msg += ` Couldn't read: ${failedFiles.join(', ')}.`;
    statusEl.className = 'upload-status ok';
    statusEl.textContent = msg;
    computeHoldings();
  }catch(e){
    statusEl.className = 'upload-status failed';
    statusEl.textContent = 'Could not read this image — ' + e.message;
  }finally{
    hideCalcPopup();
    holdingsUploadBusy = false;
    if(btn) btn.disabled = false;
  }
}

function computeHoldings(){
  const n = parseInt(document.getElementById('holdings-slot-count').value, 10);
  const brokerKey = document.getElementById('holdings-broker').value;
  const isShort = (holdingsMode === 'short');
  const isMTF = (!isShort && holdingsSubMode === 'mtf');
  const isIntraday = isShort || (!isShort && holdingsSubMode === 'intraday'); // short always intraday; long+intraday too; delivery & MTF use delivery schedule
  const entryIsBuy = !isShort; // long enters via buy, short enters via sell
  const brokerLabel = BROKERS[brokerKey].label;
  document.getElementById('holdings-mtf-rate-readout').textContent = BROKERS[brokerKey].mtfRate + '%';

  // enteredUnits/enteredValue = what you type in — for every mode except MTF
  // this IS the actual position. For MTF, this is treated as YOUR money's
  // worth; the real (leveraged) position is 5x that, computed explicitly
  // below so the multiplication is visible rather than hidden in the math.
  let enteredUnits = 0, enteredValue = 0, slotsUsed = 0;

  for(let i=1; i<=n; i++){
    const row = document.querySelector(`.holdings-row[data-slot="${i}"]`);
    const u = parseFloat(row.querySelector('.h-units').value);
    const p = parseFloat(row.querySelector('.h-price').value);
    if(u>0 && p>0){
      enteredUnits += u;
      enteredValue += u*p;
      slotsUsed++;
    }
  }

  const el = document.getElementById('holdings-summary');
  if(slotsUsed===0 || enteredUnits===0){
    el.innerHTML = '<div class="calc-empty">Enter at least one slot to see your average price.</div>';
    return;
  }

  const avgPrice = enteredValue/enteredUnits; // price per unit is unaffected by leverage
  const leverageMult = isMTF ? 5 : 1;
  const totalUnits = enteredUnits * leverageMult;   // the REAL position size
  const totalValue = enteredValue * leverageMult;   // the REAL order/exposure value
  const capital = enteredValue;                     // your own money, always what you typed in
  const borrowed = isMTF ? enteredValue*4 : 0;

  // Charges apply per actual executed order — i.e. on the real (leveraged)
  // value of each slot for MTF, not on your unleveraged capital.
  const entryTotals = {brokerage:0, stt:0, exchange:0, sebi:0, ipft:0, stamp:0, dp:0, gst:0, total:0};
  for(let i=1; i<=n; i++){
    const row = document.querySelector(`.holdings-row[data-slot="${i}"]`);
    const u = parseFloat(row.querySelector('.h-units').value);
    const p = parseFloat(row.querySelector('.h-price').value);
    if(u>0 && p>0){
      const slotRealValue = u*p*leverageMult;
      const b = legBreakdown(slotRealValue, entryIsBuy, brokerKey, isIntraday);
      for(const k in entryTotals) entryTotals[k] += b[k];
    }
  }

  const avgLabel = holdingsMode==='long' ? 'Average entry price' : 'Average short-sale price';
  const mtfRate = BROKERS[brokerKey].mtfRate;
  const holdDays = isMTF ? (parseFloat(document.getElementById('holdings-mtf-days').value) || 0) : 0;
  const mtfInterest = isMTF ? borrowed*(mtfRate/100)*(holdDays/365) : 0;
  const dailyInterest = isMTF ? borrowed*(mtfRate/100)/365 : 0;
  const breakevenPrice = computeBreakevenExitPrice(holdingsMode==='long', totalUnits, totalValue, entryTotals.total, mtfInterest, brokerKey, isIntraday);
  const targetPct = parseFloat(document.getElementById('holdings-target-pct').value);
  const hasTargetPct = !isNaN(targetPct) && targetPct !== 0;
  const targetExitPrice = hasTargetPct ? computeExitPriceForTargetPct(holdingsMode==='long', totalUnits, totalValue, entryTotals.total, mtfInterest, brokerKey, isIntraday, capital, targetPct) : 0;

  let modeLabel = holdingsMode==='long' ? (holdingsSubMode==='mtf' ? 'Long · MTF (5×)' : holdingsSubMode==='intraday' ? 'Long · Intraday' : 'Long · Delivery') : 'Short · Intraday';

  const combinedNote = slotsUsed > 1 ? ` — combined across ${slotsUsed} entries` : '';
  let html = `
    <div class="hs-avg-label">${avgLabel} (${modeLabel}, ${brokerLabel})</div>
    <div class="hs-avg">₹${avgPrice.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
    <div class="hs-breakeven">Even exit price, no profit/loss${isMTF?' (covers charges + interest)':' (covers charges)'}${combinedNote}: <span class="gold">₹${breakevenPrice.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
  `;
  if(hasTargetPct){
    if(targetExitPrice > 0){
      html += `<div class="hs-target-exit">Target exit price for ${targetPct>0?'+':''}${targetPct}% net profit (after all fees${isMTF?' + interest':''} &amp; taxes)${combinedNote}: <span class="purple">₹${targetExitPrice.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`;
    } else {
      html += `<div class="hs-target-exit">Couldn't find a valid exit price for that target — try a smaller percentage.</div>`;
    }
  }

  if(isMTF){
    html += `
      <div class="hs-row"><span class="lbl">Your units (your money)</span><span class="val">${enteredUnits}</span></div>
      <div class="hs-row"><span class="lbl">Leveraged position</span><span class="val">${enteredUnits} × 5 = <strong>${totalUnits} units</strong></span></div>
      <div class="hs-row"><span class="lbl">Your capital</span><span class="val">${fmtCharge(capital)}</span></div>
      <div class="hs-row"><span class="lbl">Broker-funded (borrowed)</span><span class="val">${fmtCharge(borrowed)}</span></div>
      <div class="hs-row"><span class="lbl">Total position value (${slotsUsed} order${slotsUsed===1?'':'s'})</span><span class="val">${fmtCharge(totalValue)}</span></div>
    `;
  } else {
    html += `<div class="hs-row"><span class="lbl">${holdingsMode==='long'?'Total invested':'Total short proceeds'} (${totalUnits} units, ${slotsUsed} order${slotsUsed===1?'':'s'})</span><span class="val">${fmtCharge(totalValue)}</span></div>`;
  }

  let exitPrice, exitPriceIsLive, exitPriceLabel;
  if(exitInputMode === 'pct'){
    const pct = parseFloat(document.getElementById('holdings-exit-pct').value);
    if(!isNaN(pct)){
      exitPrice = avgPrice * (1 + pct/100);
      exitPriceIsLive = false;
      exitPriceLabel = `(${pct>=0?'+':''}${pct}% swing from avg)`;
    } else {
      exitPrice = null;
    }
  } else {
    const manualExit = parseFloat(document.getElementById('holdings-exit-price').value);
    exitPrice = manualExit>0 ? manualExit : livePrice;
    exitPriceIsLive = !(manualExit>0) && !!livePrice;
    exitPriceLabel = exitPriceIsLive ? '(live)' : '(your entry)';
  }

  if(exitPrice){
    const exitValue = totalUnits*exitPrice; // exit uses the REAL (leveraged) unit count
    const exitIsBuy = !entryIsBuy; // long exits via sell, short exits via buy-back
    const exitBreakdown = legBreakdown(exitValue, exitIsBuy, brokerKey, isIntraday);
    const grossPnl = holdingsMode==='long' ? (exitValue-totalValue) : (totalValue-exitValue);
    const totalCharges = entryTotals.total + exitBreakdown.total + mtfInterest;
    const netPnl = grossPnl - totalCharges;
    const netPct = (netPnl/capital)*100;
    const cls = netPnl>=0 ? 'bull' : 'bear';

    if(isMTF && dailyInterest>0){
      const netBeforeInterest = grossPnl - entryTotals.total - exitBreakdown.total;
      if(netBeforeInterest > 0){
        const maxDays = Math.floor(netBeforeInterest / dailyInterest);
        html += `<div class="breakeven-warning">
          \u26A0\uFE0F At this exit price, MTF interest alone erases the profit after
          <strong>~${maxDays} day${maxDays===1?'':'s'}</strong> of holding (₹${dailyInterest.toFixed(0)}/day on the borrowed ${fmtCharge(borrowed)}).
          Plan to exit before then.
        </div>`;
      } else {
        html += `<div class="breakeven-warning">\u26A0\uFE0F Charges alone already exceed the gross profit at this exit price — this doesn't clear costs even before interest.</div>`;
      }
    }

    html += `
      <div class="hs-row"><span class="lbl">Exit price used ${exitPriceLabel}</span><span class="val">₹${exitPrice.toLocaleString('en-IN',{minimumFractionDigits:2})}</span></div>
      <div class="hs-row"><span class="lbl">Gross P&amp;L</span><span class="val ${grossPnl>=0?'bull':'bear'}">${grossPnl>=0?'+':''}${fmtCharge(grossPnl)}</span></div>
    `;

    html += `<div class="breakup-title" style="margin-top:10px;">Entry charges — ${slotsUsed} separate order${slotsUsed===1?'':'s'} (${brokerLabel})</div><ul class="breakup-list">
      <li><span class="bk">Brokerage:</span> ${fmtCharge(entryTotals.brokerage)}</li>
      <li><span class="bk">STT:</span> ${fmtCharge(entryTotals.stt)}</li>
      <li><span class="bk">Exchange charge:</span> ${fmtCharge(entryTotals.exchange)}</li>
      <li><span class="bk">SEBI fee:</span> ${fmtCharge(entryTotals.sebi)}</li>
      <li><span class="bk">IPFT:</span> ${fmtCharge(entryTotals.ipft)}</li>
      <li><span class="bk">Stamp duty:</span> ${fmtCharge(entryTotals.stamp)}</li>
      ${entryTotals.dp>0 ? `<li><span class="bk">DP charge:</span> ${fmtCharge(entryTotals.dp)}</li>` : ''}
      <li><span class="bk">GST:</span> ${fmtCharge(entryTotals.gst)}</li>
      <li><span class="bk">Entry total:</span> ${fmtCharge(entryTotals.total)}</li>
    </ul>`;

    html += `<div class="breakup-title">Exit charges — 1 order (${brokerLabel})</div><ul class="breakup-list">
      <li><span class="bk">Brokerage:</span> ${fmtCharge(exitBreakdown.brokerage)}</li>
      <li><span class="bk">STT:</span> ${fmtCharge(exitBreakdown.stt)}</li>
      <li><span class="bk">Exchange charge:</span> ${fmtCharge(exitBreakdown.exchange)}</li>
      <li><span class="bk">SEBI fee:</span> ${fmtCharge(exitBreakdown.sebi)}</li>
      <li><span class="bk">IPFT:</span> ${fmtCharge(exitBreakdown.ipft)}</li>
      <li><span class="bk">Stamp duty:</span> ${fmtCharge(exitBreakdown.stamp)}</li>
      ${exitBreakdown.dp>0 ? `<li><span class="bk">DP charge:</span> ${fmtCharge(exitBreakdown.dp)}</li>` : ''}
      <li><span class="bk">GST:</span> ${fmtCharge(exitBreakdown.gst)}</li>
      <li><span class="bk">Exit total:</span> ${fmtCharge(exitBreakdown.total)}</li>
    </ul>`;

    if(isMTF){
      html += `<div class="breakup-title">MTF interest</div><ul class="breakup-list">
        <li><span class="bk">Rate:</span> ${mtfRate}% p.a. on ${fmtCharge(borrowed)} borrowed</li>
        <li><span class="bk">Daily interest:</span> ${fmtCharge(dailyInterest)}/day</li>
        <li><span class="bk">Holding period:</span> ${holdDays} day${holdDays===1?'':'s'}</li>
        <li><span class="bk">Interest cost:</span> ${fmtCharge(mtfInterest)}</li>
      </ul>`;
    }

    html += `
      <div class="hs-row" style="margin-top:8px;border-top:1px solid var(--line);padding-top:8px;"><span class="lbl">Total charges${isMTF?' (+interest)':''}</span><span class="val">-${fmtCharge(totalCharges)}</span></div>
      <div class="hs-row"><span class="lbl">Net return on ${isMTF?'your capital':'invested amount'}</span><span class="val ${cls}">${netPct>=0?'+':''}${netPct.toFixed(2)}%</span></div>
      <div class="hs-row hs-total-pnl"><span class="lbl">Total Net Profit &amp; Loss</span><span class="val ${cls}">${netPnl>=0?'+':''}${fmtCharge(netPnl)}</span></div>
    `;

    if(netPnl>=0){
      html += `<div class="disclaimer" style="margin-top:8px;">In profit by ${netPct.toFixed(2)}% after all charges${isMTF?' and interest':''} at this exit price.</div>`;
    } else {
      html += `<div class="disclaimer" style="margin-top:8px;">Still a net loss of ${Math.abs(netPct).toFixed(2)}% after charges${isMTF?' and interest':''} at this exit price — needs a better exit to clear costs.</div>`;
    }
  } else {
    html += `<div class="disclaimer" style="margin-top:8px;">Waiting for the live price above (or type an exit price) to show P&amp;L after charges.</div>`;
  }

  el.innerHTML = html;
}

async function fetchUS(){
  setBadge('us','pending');
  document.getElementById('val-us').textContent = 'Refreshing…';
  try{
    // Sequential, not Promise.all — Yahoo rejects rapid parallel requests
    // from one source (returns 404/429), which is what was making these two
    // cards fail while single-request cards like USD/INR succeeded.
    const dow = await fetchYahooPct('^DJI');
    await sleep(300);
    const nasdaq = await fetchYahooPct('^IXIC');
    const avg = (dow+nasdaq)/2;
    data.us = avg;
    document.getElementById('val-us').innerHTML = `<ul class="stat-list"><li>Dow ${dow>0?'+':''}${dow.toFixed(2)}%</li><li>Nasdaq ${nasdaq>0?'+':''}${nasdaq.toFixed(2)}%</li></ul>`;
    document.getElementById('val-us').className = 'card-value ' + (avg>0?'bull':avg<0?'bear':'');
    setBadge('us','live');
  }catch(e){ setBadge('us','failed'); document.getElementById('val-us').textContent = 'Failed: '+e.message; }
}
async function fetchAsia(){
  setBadge('asia','pending');
  document.getElementById('val-asia').textContent = 'Refreshing…';
  try{
    const nikkei = await fetchYahooPct('^N225');
    await sleep(300);
    const hsi = await fetchYahooPct('^HSI');
    const avg = (nikkei+hsi)/2;
    data.asia = avg;
    document.getElementById('val-asia').innerHTML = `<ul class="stat-list"><li>Nikkei ${nikkei>0?'+':''}${nikkei.toFixed(2)}%</li><li>HSI ${hsi>0?'+':''}${hsi.toFixed(2)}%</li></ul>`;
    document.getElementById('val-asia').className = 'card-value ' + (avg>0?'bull':avg<0?'bear':'');
    setBadge('asia','live');
  }catch(e){ setBadge('asia','failed'); document.getElementById('val-asia').textContent = 'Failed: '+e.message; }
}
async function fetchFx(){
  setBadge('fx','pending');
  document.getElementById('val-fx').textContent = 'Refreshing…';
  try{
    const c = await fetchYahooChart('INR=X');
    const rate = c.meta.regularMarketPrice ?? c.last;
    const prevRate = c.meta.previousClose ?? c.prev;
    const pc = prevRate ? (rate-prevRate)/prevRate*100 : c.pct;
    data.fx = pc;
    document.getElementById('val-fx').textContent = '₹'+rate.toFixed(2)+'  ·  '+(pc>0?'+':'')+pc.toFixed(2)+'% (rupee '+(pc>0?'weaker':'stronger')+')';
    document.getElementById('val-fx').className = 'card-value ' + (pc<0?'bull':pc>0?'bear':'');
    setBadge('fx','live');
  }catch(e){ setBadge('fx','failed'); document.getElementById('val-fx').textContent = 'Failed: '+e.message; }
}
// ---------------- scoring ----------------
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}

function computeScore(){
  let score=0, used=0;
  if(data.gift!==null){ const c = WEIGHTS.gift * clamp(data.gift/15,-1,1); score+=c; used+=WEIGHTS.gift; }
  if(data.preopen!==null){ const c = WEIGHTS.preopen * clamp(data.preopen/0.5,-1,1); score+=c; used+=WEIGHTS.preopen; }
  if(data.us!==null){ const c = WEIGHTS.us * clamp(data.us/1.0,-1,1); score+=c; used+=WEIGHTS.us; }
  if(data.asia!==null){ const c = WEIGHTS.asia * clamp(data.asia/1.0,-1,1); score+=c; used+=WEIGHTS.asia; }
  if(data.fx!==null){ const c = WEIGHTS.fx * clamp(-data.fx/0.3,-1,1); score+=c; used+=WEIGHTS.fx; }
  if(data.vix!==null){ const c = WEIGHTS.vix * clamp(-data.vix/5,-1,1); score+=c; used+=WEIGHTS.vix; }

  const norm = used ? score/used : 0;
  drawGauge(norm);

  const verdictEl = document.getElementById('verdictText');
  const scoreEl = document.getElementById('scoreLine');
  scoreEl.textContent = `score ${norm>=0?'+':''}${norm.toFixed(2)}  ·  ${used.toFixed(1)}/${(WEIGHTS.gift+WEIGHTS.preopen+WEIGHTS.us+WEIGHTS.asia+WEIGHTS.fx+WEIGHTS.vix).toFixed(1)} weight available`;

  if(used===0){
    verdictEl.textContent = 'No data yet';
    verdictEl.className = 'verdict neutral';
  } else if(norm > 0.35){
    verdictEl.textContent = 'Bullish lean';
    verdictEl.className = 'verdict bull';
  } else if(norm < -0.35){
    verdictEl.textContent = 'Bearish lean';
    verdictEl.className = 'verdict bear';
  } else {
    verdictEl.textContent = 'Neutral / flat lean';
    verdictEl.className = 'verdict neutral';
  }
}

function drawGauge(norm){
  const svg = document.getElementById('gaugeSvg');
  const cx=110, cy=110, r=95;
  const angle = -180 + (clamp(norm,-1,1)+1)/2*180; // -180..0 deg
  const rad = angle * Math.PI/180;
  const nx = cx + r*0.82*Math.cos(rad);
  const ny = cy + r*0.82*Math.sin(rad);

  const arcColor = 'url(#gaugeGrad)';
  svg.innerHTML = `
    <defs>
      <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="${getComputedStyle(document.documentElement).getPropertyValue('--bear')}"/>
        <stop offset="50%" stop-color="${getComputedStyle(document.documentElement).getPropertyValue('--gold')}"/>
        <stop offset="100%" stop-color="${getComputedStyle(document.documentElement).getPropertyValue('--bull')}"/>
      </linearGradient>
    </defs>
    <path d="M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}" fill="none" stroke="${arcColor}" stroke-width="10" stroke-linecap="round"/>
    <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="#E8ECF4" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="6" fill="#E8ECF4"/>
  `;
}

// ---------------- calculator ----------------
function fmtINR(n){
  const sign = n<0 ? '-' : '';
  return sign + '₹' + Math.abs(n).toLocaleString('en-IN',{maximumFractionDigits:0});
}

// Statutory/government-mandated charges are IDENTICAL across every Indian broker —
// STT, stamp duty, exchange transaction charges, SEBI turnover fee, IPFT, and GST
// rates are all set by the government/exchange, not the broker. Only brokerage
// itself and the MTF interest rate are broker-specific.
const BROKERS = {
  angelone: {
    label: 'Angel One',
    mtfRate: 14.99,
    deliveryBrokerage: (v) => Math.max(Math.min(0.001*v, 20), 5),
    intradayBrokerage: (v) => Math.max(Math.min(0.001*v, 20), 5),
    deliveryBrokerageDesc: '0.1% per order or ₹20, whichever is lower (min ₹5)',
    intradayBrokerageDesc: '0.1% per order or ₹20, whichever is lower (min ₹5)',
    planNote: null,
  },
  kotakneo_pro: {
    label: 'Kotak Neo (Trade Free Pro)',
    mtfRate: 9.69,
    // Trade Free Pro: 0.10% flat on delivery, ₹10-or-0.05%-whichever-lower on intraday.
    deliveryBrokerage: (v) => 0.001*v,
    intradayBrokerage: (v) => Math.min(10, 0.0005*v),
    deliveryBrokerageDesc: '0.10% per order, flat (no cap)',
    intradayBrokerageDesc: '0.05% per order or ₹10, whichever is lower',
    planNote: 'Trade Free Pro carries a ₹249 + GST monthly subscription fee, separate from per-trade charges — factor that in if you trade infrequently.',
  },
  kotakneo_std: {
    label: 'Kotak Neo (Trade Free Plan)',
    mtfRate: 14.99,
    // Standard Trade Free Plan: 0.20% flat on delivery, same ₹10-or-0.05% on intraday.
    deliveryBrokerage: (v) => 0.002*v,
    intradayBrokerage: (v) => Math.min(10, 0.0005*v),
    deliveryBrokerageDesc: '0.20% per order, flat (no cap)',
    intradayBrokerageDesc: '0.05% per order or ₹10, whichever is lower',
    planNote: 'No subscription fee on this plan, but delivery brokerage is double Trade Free Pro\u2019s rate and MTF interest is the higher standard rate.',
  },
};

// DELIVERY charge schedule (Long·Delivery, Long·MTF — MTF is still a delivery-style
// holding, just broker-financed, so delivery statutory rates apply either way).
// STT: 0.1% BOTH legs. Exchange txn: ~0.00307%. SEBI + IPFT: ₹10/crore each.
// Stamp duty: 0.015% on buy only. DP charge: flat ₹23.60 (incl. GST) on sell only.
// GST 18% on (brokerage + exchange txn charges + SEBI fee + IPFT).
// Returns every itemized charge component for ONE leg (one buy or one sell
// order) — used by both the main calculator and the Holdings section so
// the math is defined exactly once and can't drift between the two.
function legBreakdown(value, isBuy, brokerKey, isIntraday){
  const brokerageFn = isIntraday ? BROKERS[brokerKey].intradayBrokerage : BROKERS[brokerKey].deliveryBrokerage;
  const brokerage = brokerageFn(value);
  const exchange = 0.0000307*value;
  const sebi = (10/1e7)*value;
  const ipft = (10/1e7)*value;
  let stt, stamp, dp;
  if(isIntraday){
    stt = isBuy ? 0 : 0.00025*value;
    stamp = isBuy ? 0.00003*value : 0;
    dp = 0;
  } else {
    stt = 0.001*value;
    stamp = isBuy ? 0.00015*value : 0;
    dp = isBuy ? 0 : 23.60;
  }
  const gst = 0.18*(brokerage+exchange+sebi+ipft);
  const total = brokerage+stt+exchange+sebi+ipft+stamp+dp+gst;
  return {brokerage, stt, exchange, sebi, ipft, stamp, dp, gst, total};
}

function deliveryCharges(buyValue, sellValue, brokerKey){
  return legBreakdown(buyValue, true, brokerKey, false).total + legBreakdown(sellValue, false, brokerKey, false).total;
}

// INTRADAY charge schedule (Long·Intraday, Short·Intraday).
// STT: 0.025% on the SELL leg only. Stamp duty: 0.003% on the BUY leg only.
// No DP charge — intraday positions never settle into the demat account.
// Exchange, SEBI, IPFT, GST rates: same statutory rates as delivery.
function intradayChargesFor(buyValue, sellValue, brokerKey){
  return legBreakdown(buyValue, true, brokerKey, true).total + legBreakdown(sellValue, false, brokerKey, true).total;
}

function buildBreakupHTML(brokerKey, isIntraday, mtfRate){
  const b = BROKERS[brokerKey];
  const brokerageDesc = isIntraday ? b.intradayBrokerageDesc : b.deliveryBrokerageDesc;
  const rows = [
    ['Brokerage', brokerageDesc],
    ['STT', isIntraday ? '0.025% on the sell leg only' : '0.1% on both buy and sell legs'],
    ['Exchange transaction charge', '~0.00307% (NSE), both legs'],
    ['SEBI turnover fee', '₹10 per crore of traded value, both legs'],
    ['IPFT (NSE)', '₹10 per crore of traded value, both legs'],
    ['Stamp duty', isIntraday ? '0.003% on the buy leg only' : '0.015% on the buy leg only'],
  ];
  if(!isIntraday){
    rows.push(['DP charge', '₹23.60 flat (incl. GST), sell leg only']);
  }
  rows.push(['GST', '18% on (brokerage + exchange charge + SEBI fee + IPFT)']);
  if(mtfRate !== undefined){
    rows.push(['MTF interest', mtfRate + '% p.a. on the borrowed portion, accrued daily']);
  }
  let html = `<div class="breakup-title">${b.label} — full charge breakup</div><ul class="breakup-list">`;
  rows.forEach(([k,v]) => { html += `<li><span class="bk">${k}:</span> ${v}</li>`; });
  html += '</ul>';
  if(b.planNote){
    html += `<div class="breakup-note">${b.planNote}</div>`;
  }
  html += '<div class="breakup-note">STT, stamp duty, exchange charge, SEBI fee, IPFT and GST are government/exchange-mandated rates, identical across every Indian broker. Only brokerage and MTF interest are broker/plan-specific.</div>';
  return html;
}

// ---------------- weight sliders ----------------
function buildSliders(){
  const wrap = document.getElementById('weightSliders');
  const labels = {gift:'GIFT Nifty gap', preopen:'NSE pre-open', us:'US markets', asia:'Asia markets', fx:'USD/INR', vix:'India VIX'};
  wrap.innerHTML = Object.keys(WEIGHTS).map(k=>`
    <div class="weight-row">
      <span>${labels[k]}</span>
      <span>
        <input type="range" min="0" max="4" step="0.1" value="${WEIGHTS[k]}" oninput="WEIGHTS['${k}']=parseFloat(this.value); this.nextElementSibling.textContent=this.value; computeScore();">
        <span style="font-family:Georgia,'Times New Roman',serif;font-size:11px;color:var(--muted);margin-left:6px;">${WEIGHTS[k]}</span>
      </span>
    </div>`).join('');
}

// ---------------- run all ----------------
function showRefreshPopup(){
  document.getElementById('refresh-popup').classList.add('show');
}
function hideRefreshPopup(){
  document.getElementById('refresh-popup').classList.remove('show');
}
// Reuses the same spinning-logo popup for the order-screenshot OCR/calc step,
// just with different text, so it's the same "please wait" visual language
// as the live-data refresh — then restores the default text on hide.
function showCalcPopup(text){
  const popup = document.getElementById('refresh-popup');
  const span = popup.querySelector('span');
  if(span) span.textContent = text;
  popup.classList.add('show');
}
function hideCalcPopup(){
  const popup = document.getElementById('refresh-popup');
  popup.classList.remove('show');
  const span = popup.querySelector('span');
  if(span) span.textContent = 'Refreshing…';
}

let refreshInProgress = false;

async function runAll(){
  if(refreshInProgress){
    // A previous cycle is still running (can happen if the network is slow
    // enough that one cycle takes longer than the 15s auto-refresh
    // interval) — skip this tick rather than reset every badge back to
    // "pending" mid-attempt, which made things look stuck even when they
    // were actually progressing.
    return;
  }
  refreshInProgress = true;
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true; btn.textContent = 'Fetching…';
  showRefreshPopup();
  try{
    // Staggered rather than all-at-once. Yahoo in particular returns
    // 404/429 when it sees several near-simultaneous requests from the
    // same origin, which is why the multi-symbol cards (US, Asia) were
    // failing while single-request cards succeeded. A short gap between
    // each keeps every source happy; total cycle still well under the
    // 60s refresh interval.
    const tasks = [fetchNiftybeesPrice, fetchGift, fetchPreopen, fetchVix, fetchUS, fetchAsia, fetchFx, fetchNews, fetchAndRenderPrediction];
    for(const task of tasks){
      await task().catch(()=>{}); // individual failures already surface in their own card
      await sleep(250);
    }
    computeScore();
    document.getElementById('lastRun').textContent = 'Last run: ' + new Date().toLocaleString('en-IN', {hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'});
  } finally {
    btn.disabled = false; btn.textContent = 'Refresh all sources';
    setTimeout(hideRefreshPopup, 900); // keep it visible briefly even on a very fast refresh
    refreshInProgress = false;
  }
}

// =========================================================
// 30–60 MIN SIGNAL + DAY/WEEK READ
// Reuses fetchViaProxy()/PRIMARY_PROXY (same Yahoo pipeline as the price
// card above) against 5-minute intraday candles and a 3-month daily
// history, instead of the daily-only chart the price card uses.
// =========================================================
function predEma(arr, period){
  const k = 2/(period+1);
  const out = [arr[0]];
  for(let i=1;i<arr.length;i++) out.push(arr[i]*k + out[i-1]*(1-k));
  return out;
}
function predRsi(arr, period){
  const p = Math.min(period, arr.length-1);
  let gains=0, losses=0;
  for(let i=arr.length-p; i<arr.length; i++){
    const d = arr[i]-arr[i-1];
    if(d>=0) gains+=d; else losses-=d;
  }
  const avgG = gains/p, avgL = losses/p;
  if(avgL===0) return 100;
  return 100 - (100/(1+avgG/avgL));
}
function predStdevReturns(arr, n){
  const nn = Math.min(n, arr.length-1);
  const rets=[];
  for(let i=arr.length-nn; i<arr.length; i++) rets.push(Math.log(arr[i]/arr[i-1]));
  const mean = rets.reduce((a,b)=>a+b,0)/rets.length;
  const variance = rets.reduce((a,b)=>a+(b-mean)**2,0)/rets.length;
  return Math.sqrt(variance);
}
function predClip(v,lo,hi){ return Math.max(lo, Math.min(hi, v)); }
function predSma(arr,n){ return arr.slice(-n).reduce((a,b)=>a+b,0)/n; }

async function fetchIntradaySeries(symbol){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d`;
  const r = await fetchViaProxy(url);
  const j = await r.json();
  if(!j || !j.chart || !Array.isArray(j.chart.result) || !j.chart.result[0]) throw new Error('no intraday data');
  const q = j.chart.result[0].indicators && j.chart.result[0].indicators.quote && j.chart.result[0].indicators.quote[0];
  if(!q || !q.close) throw new Error('malformed intraday response');
  const closes=[], vols=[];
  for(let i=0;i<q.close.length;i++){
    if(q.close[i]!=null && q.volume[i]!=null){ closes.push(q.close[i]); vols.push(q.volume[i]); }
  }
  if(closes.length < 8) throw new Error('too few intraday bars yet (' + closes.length + ') — check back after market open');
  return { closes, vols };
}
async function fetchDailySeries(symbol){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`;
  const r = await fetchViaProxy(url);
  const j = await r.json();
  if(!j || !j.chart || !Array.isArray(j.chart.result) || !j.chart.result[0]) throw new Error('no daily history');
  const q = j.chart.result[0].indicators && j.chart.result[0].indicators.quote && j.chart.result[0].indicators.quote[0];
  const closes = (q && q.close || []).filter(x=>x!=null);
  if(closes.length < 25) throw new Error('too few daily bars (' + closes.length + ')');
  return closes;
}

const predFmt = v => '₹' + v.toLocaleString('en-IN',{minimumFractionDigits:2, maximumFractionDigits:2});

function renderShortTermSignal(closes, vols){
  const BAR_MIN = 5, LOOKBACK_BARS = Math.min(6, Math.floor(closes.length/2));
  const ema9 = predEma(closes,9), ema21 = predEma(closes,21);
  const last = closes[closes.length-1];
  const rsi14 = predRsi(closes,14);
  const lastIdx = closes.length-1, backIdx = lastIdx-LOOKBACK_BARS;

  const trendPct30 = (closes[lastIdx]-closes[backIdx])/closes[backIdx]*100;
  const trendScore = predClip(trendPct30/0.6,-1,1)*100;

  const volWindow = Math.min(LOOKBACK_BARS, Math.floor(vols.length/2));
  const recentAvgVol = vols.slice(-volWindow).reduce((a,b)=>a+b,0)/volWindow;
  const priorAvgVol = vols.slice(-2*volWindow,-volWindow).reduce((a,b)=>a+b,0)/(volWindow||1);
  const volBuildRatio = priorAvgVol ? recentAvgVol/priorAvgVol : 1;
  const trendSign = Math.sign(trendScore) || 1;
  const volScore = predClip((volBuildRatio-1)/0.35,-1,1)*100*trendSign;

  const gapNow = ema9[lastIdx]-ema21[lastIdx];
  const gapPrev = ema9[backIdx]-ema21[backIdx];
  const gapChangePct = (gapNow-gapPrev)/closes[backIdx]*100;
  const accelScore = predClip(gapChangePct/0.25,-1,1)*100;

  const rsiScore = rsi14>50 ? -predClip((rsi14-50)/25,0,1)*100 : predClip((50-rsi14)/25,0,1)*100;

  const composite = 0.35*trendScore + 0.30*volScore + 0.25*accelScore + 0.10*rsiScore;
  let signal, signalClass;
  if(composite>=30){ signal='BUY'; signalClass='buy'; }
  else if(composite<=-30){ signal='SELL'; signalClass='sell'; }
  else { signal='HOLD'; signalClass='hold'; }

  const agree = [trendScore,volScore,accelScore].filter(s=>Math.sign(s)===Math.sign(composite) && Math.abs(s)>10).length;
  const confidence = Math.round(predClip(46 + Math.abs(composite)*0.45 + agree*6, 30, 96));

  const DRIFT_DAMP = 0.55;
  const driftPerMinLog = Math.log(closes[lastIdx]/closes[backIdx]) / (LOOKBACK_BARS*BAR_MIN) * DRIFT_DAMP;
  const sigma5 = predStdevReturns(closes,20);
  function project(horizonMin){
    const mid = last*Math.exp(driftPerMinLog*horizonMin);
    const sigma = sigma5*Math.sqrt(horizonMin/BAR_MIN);
    return { mid, lo: mid*Math.exp(-sigma), hi: mid*Math.exp(sigma) };
  }
  const p30 = project(30), p60 = project(60);

  document.getElementById('predChip').className = 'pred-chip '+signalClass;
  const arrow = signal==='BUY' ? '▲' : signal==='SELL' ? '▼' : '—';
  document.getElementById('predChip').innerHTML = '<span>'+arrow+'</span> '+signal;
  document.getElementById('predConf').textContent = confidence+'%';
  const miniChip = document.getElementById('predMiniChip');
  if(miniChip){
    miniChip.className = 'pred-mini-chip '+signalClass;
    miniChip.innerHTML = '<span>'+arrow+'</span> '+signal;
  }
  const miniConf = document.getElementById('predMiniConf');
  if(miniConf) miniConf.textContent = 'Confidence '+confidence+'%';
  document.getElementById('predPx').textContent = predFmt(last);
  document.getElementById('predAsOf').textContent = 'last 5-min bar · ' + new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});

  function fillTile(bandId, midId, p){
    const change = (p.mid-last)/last*100;
    document.getElementById(bandId).innerHTML = predFmt(p.lo)+'<span class="sep">–</span>'+predFmt(p.hi);
    const midEl = document.getElementById(midId);
    midEl.className = 'mid '+signalClass;
    midEl.textContent = '→ ' + predFmt(p.mid) + ' (' + (change>=0?'+':'') + change.toFixed(2) + '%) projected';
  }
  fillTile('predBand30','predMid30',p30);
  fillTile('predBand60','predMid60',p60);

  function barFill(score){
    const w = Math.min(50, Math.abs(score)/2);
    const cls = score>=0 ? 'buy' : 'sell';
    const left = score>=0 ? '50%' : (50-w)+'%';
    return '<div class="pred-ind-bar-fill '+cls+'" style="left:'+left+'; width:'+w+'%;"></div>';
  }
  function readLabel(score, kind){
    const dir = score>10 ? 'buy' : score<-10 ? 'sell' : 'hold';
    const texts = {
      trend:{buy:'Sustained rise over the last 30 min', sell:'Sustained fall over the last 30 min', hold:'Roughly flat over the last 30 min'},
      vol:{buy:'Volume building behind the move', sell:'Volume building behind the move', hold:'Volume steady, no real buildup'},
      accel:{buy:'EMA gap widening — move still building', sell:'EMA gap widening — move still building', hold:'EMA gap flat — momentum not building'},
      rsi:{buy:'Oversold — guard easing toward buy', sell:'Overbought — guard trimming toward sell', hold:'Neutral zone, no extreme'}
    };
    return {dir, text:texts[kind][dir]};
  }
  const rows = [
    {name:'Trend buildup (30 min)', weight:'35% weight', score:trendScore, kind:'trend', extra:(trendPct30>=0?'+':'')+trendPct30.toFixed(2)+'% / 30 min'},
    {name:'Volume buildup', weight:'30% weight', score:volScore, kind:'vol', extra:volBuildRatio.toFixed(2)+'× prior 30 min'},
    {name:'Trend acceleration', weight:'25% weight', score:accelScore, kind:'accel', extra:(gapChangePct>=0?'+':'')+gapChangePct.toFixed(3)+'% gap Δ'},
    {name:'RSI guard', weight:'10% weight', score:rsiScore, kind:'rsi', extra:'RSI '+rsi14.toFixed(0)}
  ];
  document.getElementById('predBreakdown').innerHTML = rows.map(r=>{
    const rl = readLabel(r.score, r.kind);
    return '<div class="pred-ind-row"><div class="pred-ind-head"><span class="pred-ind-name">'+r.name+'</span><span class="pred-ind-weight">'+r.weight+' · '+r.extra+'</span></div>'
      + '<div class="pred-ind-read '+rl.dir+'">'+rl.text+'</div>'
      + '<div class="pred-ind-bar-track"><div class="pred-ind-bar-mid"></div>'+barFill(r.score)+'</div></div>';
  }).join('');

  // ---- chart: history + projection cone with BUY/SELL markers ----
  const svg = document.getElementById('predChartSvg');
  const W=480, H=228, padL=44, padR=10, padT=26, padB=20;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const totalSlots = closes.length+12;
  const allVals = closes.concat(ema9).concat(ema21).concat([p30.lo,p30.hi,p30.mid,p60.lo,p60.hi,p60.mid,last]);
  const minV=Math.min(...allVals), maxV=Math.max(...allVals);
  const pad=(maxV-minV)*0.08 || 0.5;
  const lo=minV-pad, hi=maxV+pad;
  const x = i => padL + (i/(totalSlots-1))*plotW;
  const y = v => padT + (1-(v-lo)/(hi-lo))*plotH;
  const pathOf = arr => arr.map((v,i)=>(i===0?'M':'L')+x(i).toFixed(1)+','+y(v).toFixed(1)).join(' ');

  let svgContent='';
  for(let t=0;t<=3;t++){
    const v = lo+(hi-lo)*t/3, yy=y(v);
    svgContent += '<line x1="'+padL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+yy.toFixed(1)+'" stroke="#233257" stroke-width="1" />';
    svgContent += '<text x="4" y="'+(yy+3).toFixed(1)+'" font-size="9.5" fill="#7C8AA5" font-family="Georgia,serif">'+v.toFixed(1)+'</text>';
  }
  const nowX = x(closes.length-1);
  svgContent += '<line x1="'+nowX.toFixed(1)+'" y1="'+padT+'" x2="'+nowX.toFixed(1)+'" y2="'+(H-padB)+'" stroke="#233257" stroke-width="1" stroke-dasharray="2,3" />';
  const histLabelIdx = [0, Math.floor(closes.length*0.55), closes.length-1];
  histLabelIdx.forEach(i=>{
    const minsAgo=(closes.length-1-i)*BAR_MIN;
    const lbl = minsAgo===0 ? 'now' : '-'+minsAgo+'m';
    svgContent += '<text x="'+(x(i)-10).toFixed(1)+'" y="'+(H-4)+'" font-size="9.5" fill="#7C8AA5" font-family="Georgia,serif">'+lbl+'</text>';
  });
  svgContent += '<text x="'+(x(closes.length-1+6)-10).toFixed(1)+'" y="'+(H-4)+'" font-size="9.5" fill="#7C8AA5" font-family="Georgia,serif">+30m</text>';
  svgContent += '<text x="'+(x(closes.length-1+12)-10).toFixed(1)+'" y="'+(H-4)+'" font-size="9.5" fill="#7C8AA5" font-family="Georgia,serif">+60m</text>';

  const x30=x(closes.length-1+6), x60=x(closes.length-1+12);
  const coneColor = signal==='BUY' ? '#20E3A2' : signal==='SELL' ? '#FF5C4D' : '#4FBBFF';
  const conePath = 'M '+nowX.toFixed(1)+','+y(last).toFixed(1)
    + ' L '+x30.toFixed(1)+','+y(p30.hi).toFixed(1)
    + ' L '+x60.toFixed(1)+','+y(p60.hi).toFixed(1)
    + ' L '+x60.toFixed(1)+','+y(p60.lo).toFixed(1)
    + ' L '+x30.toFixed(1)+','+y(p30.lo).toFixed(1)+' Z';
  svgContent += '<path d="'+conePath+'" fill="'+coneColor+'" opacity="0.16" />';
  const midPath = 'M '+nowX.toFixed(1)+','+y(last).toFixed(1)
    + ' L '+x30.toFixed(1)+','+y(p30.mid).toFixed(1)
    + ' L '+x60.toFixed(1)+','+y(p60.mid).toFixed(1);
  svgContent += '<path d="'+midPath+'" fill="none" stroke="'+coneColor+'" stroke-width="2" stroke-dasharray="5,4" />';

  svgContent += '<path d="'+pathOf(ema21)+'" fill="none" stroke="#4FBBFF" stroke-width="1.6" opacity="0.95" />';
  svgContent += '<path d="'+pathOf(ema9)+'" fill="none" stroke="#F0BB4E" stroke-width="1.6" />';
  svgContent += '<path d="'+pathOf(closes)+'" fill="none" stroke="#E8ECF4" stroke-width="2" />';

  const arrowGlyph = signal==='BUY' ? '▲' : signal==='SELL' ? '▼' : '—';
  function marker(cx, cy, label, big){
    const r = big ? 9 : 7;
    let shape;
    if(signal==='HOLD'){
      shape = '<rect x="'+(cx-r).toFixed(1)+'" y="'+(cy-2.5).toFixed(1)+'" width="'+(r*2).toFixed(1)+'" height="5" rx="2" fill="'+coneColor+'" stroke="#0B1120" stroke-width="1.5" />';
    } else if(signal==='BUY'){
      shape = '<polygon points="'+cx.toFixed(1)+','+(cy-r).toFixed(1)+' '+(cx-r).toFixed(1)+','+(cy+r*0.7).toFixed(1)+' '+(cx+r).toFixed(1)+','+(cy+r*0.7).toFixed(1)+'" fill="'+coneColor+'" stroke="#0B1120" stroke-width="1.5" stroke-linejoin="round" />';
    } else {
      shape = '<polygon points="'+cx.toFixed(1)+','+(cy+r).toFixed(1)+' '+(cx-r).toFixed(1)+','+(cy-r*0.7).toFixed(1)+' '+(cx+r).toFixed(1)+','+(cy-r*0.7).toFixed(1)+'" fill="'+coneColor+'" stroke="#0B1120" stroke-width="1.5" stroke-linejoin="round" />';
    }
    const labelY = signal==='SELL' ? cy+r+12 : cy-r-6;
    const tag = label ? '<text x="'+cx.toFixed(1)+'" y="'+labelY.toFixed(1)+'" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="'+(big?11:9.5)+'" fill="'+coneColor+'">'+label+'</text>' : '';
    return shape+tag;
  }
  svgContent += marker(nowX, y(last), signal, true);
  svgContent += marker(x30, y(p30.mid), arrowGlyph, false);
  svgContent += marker(x60, y(p60.mid), arrowGlyph, false);
  svg.innerHTML = svgContent;
}

function renderLongTermRead(dailyCloses, todayPx){
  const sma20 = predSma(dailyCloses,20), sma50 = predSma(dailyCloses,50);
  const dailyRsi = predRsi(dailyCloses,14);
  const prevClose = dailyCloses[dailyCloses.length-1];

  const todayChangePct = (todayPx-prevClose)/prevClose*100;
  const vsSma20 = (todayPx-sma20)/sma20*100;
  const dayRsiScore = dailyRsi>50 ? -predClip((dailyRsi-50)/25,0,1)*100 : predClip((50-dailyRsi)/25,0,1)*100;
  const dayScore = 0.5*predClip(todayChangePct/0.8,-1,1)*100 + 0.35*predClip(vsSma20/1.0,-1,1)*100 + 0.15*dayRsiScore;

  const weekTrendPct = (dailyCloses[dailyCloses.length-1]-dailyCloses[dailyCloses.length-6])/dailyCloses[dailyCloses.length-6]*100;
  const vsSma50 = (dailyCloses[dailyCloses.length-1]-sma50)/sma50*100;
  const crossTilt = (sma20-sma50)/sma50*100;
  const weekScore = 0.45*predClip(weekTrendPct/2.5,-1,1)*100 + 0.30*predClip(vsSma50/2.0,-1,1)*100 + 0.25*predClip(crossTilt/1.0,-1,1)*100;

  function biasOf(score){
    if(score>=25) return {label:'Bullish', arrow:'▲'};
    if(score<=-25) return {label:'Bearish', arrow:'▼'};
    return {label:'Neutral', arrow:'—'};
  }
  function fillTile(biasId, barId, rationaleId, sparkId, score, rationale, sparkArr){
    const b = biasOf(score);
    document.getElementById(biasId).innerHTML = '<span class="arrow">'+b.arrow+'</span>'+b.label;
    const bar = document.getElementById(barId);
    const w = Math.min(50, Math.abs(score)/2);
    bar.style.left = (score>=0 ? '50%' : (50-w)+'%');
    bar.style.width = w+'%';
    document.getElementById(rationaleId).textContent = rationale;
    const svg = document.getElementById(sparkId);
    const W=200,H=30,pad=3;
    const mn=Math.min(...sparkArr), mx=Math.max(...sparkArr);
    const xs = i => pad+(i/(sparkArr.length-1))*(W-2*pad);
    const ys = v => pad+(1-(v-mn)/((mx-mn)||1))*(H-2*pad);
    const d = sparkArr.map((v,i)=>(i===0?'M':'L')+xs(i).toFixed(1)+','+ys(v).toFixed(1)).join(' ');
    svg.innerHTML = '<path d="'+d+'" fill="none" stroke="#B98AFF" stroke-width="1.8" opacity="0.9" />'
      + '<circle cx="'+xs(sparkArr.length-1).toFixed(1)+'" cy="'+ys(sparkArr[sparkArr.length-1]).toFixed(1)+'" r="2.5" fill="#B98AFF" />';
  }
  fillTile('predDayBias','predDayBar','predDayRationale','predDaySpark', dayScore,
    (todayChangePct>=0?'+':'')+todayChangePct.toFixed(2)+"% vs. yesterday's close, "+(vsSma20>=0?'above':'below')+' the 20-day average, RSI '+dailyRsi.toFixed(0)+'.',
    dailyCloses.slice(-15).concat([todayPx]));
  fillTile('predWeekBias','predWeekBar','predWeekRationale','predWeekSpark', weekScore,
    (weekTrendPct>=0?'+':'')+weekTrendPct.toFixed(2)+'% over 5 days, '+(vsSma50>=0?'above':'below')+' the 50-day average, 20d/50d gap '+(crossTilt>=0?'+':'')+crossTilt.toFixed(2)+'%.',
    dailyCloses.slice(-30));
}

async function fetchAndRenderPrediction(){
  setBadge('pred','pending');
  try{
    const { closes, vols } = await fetchIntradaySeries('NIFTYBEES.NS');
    renderShortTermSignal(closes, vols);
    await sleep(200);
    const dailyCloses = await fetchDailySeries('NIFTYBEES.NS');
    renderLongTermRead(dailyCloses, closes[closes.length-1]);
    setBadge('pred','live');
  }catch(e){
    setBadge('pred','failed', 'Signal unavailable — ' + e.message);
    document.getElementById('predChip').className = 'pred-chip hold';
    document.getElementById('predChip').textContent = 'Unavailable';
    const miniChip = document.getElementById('predMiniChip');
    if(miniChip){ miniChip.className = 'pred-mini-chip hold'; miniChip.textContent = 'Unavailable'; }
    const miniConf = document.getElementById('predMiniConf');
    if(miniConf) miniConf.textContent = 'Confidence --';
  }
}

buildSliders();
drawGauge(0);
runAll();
setInterval(runAll, 60000); // auto-refresh every 60 seconds — was 15s, which combined with racing multiple proxies per data point was very likely bursting past free proxy rate limits

(function(){
  const btn = document.getElementById('predToggleBtn');
  const details = document.getElementById('predDetails');
  if(!btn || !details) return;
  btn.addEventListener('click', function(){
    const expanded = details.classList.toggle('expanded');
    btn.classList.toggle('expanded', expanded);
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    const lbl = btn.querySelector('.lbl');
    if(lbl) lbl.textContent = expanded ? 'Hide Details' : 'Detailed View';
  });
})();