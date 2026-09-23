
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
async function fetchPreopen(){
  setBadge('preopen','pending');
  try{
    const r = await fetchViaProxy('https://www.nseindia.com/api/market-data-pre-open?key=NIFTY');
    const j = await r.json();
    // The Nifty 50 index itself is never a row inside j.data — that array is
    // only the 50 individual constituent stocks. NSE reports the index's own
    // pre-open change in a separate top-level "niftyPreopenStatus" object.
    // Looking for the index inside j.data (the old code) always threw "no
    // index row in response", which is why this card never once loaded.
    const row = j.niftyPreopenStatus;
    if(!row || row.pChange===undefined || row.pChange===null) throw new Error('no index row in response');
    const pc = parseFloat(row.pChange);
    data.preopen = pc;
    document.getElementById('val-preopen').innerHTML = trendArrow(pc) + (pc>0?'+':'')+pc.toFixed(2)+'%';
    document.getElementById('val-preopen').className = 'card-value ' + (pc>0?'bull':pc<0?'bear':'flat');
    renderBreadth(j.advances, j.declines, j.unchanged);
    const windowOpen = String(row.status||'').toUpperCase()==='OPEN';
    setBadge('preopen','live', windowOpen ? 'Nifty 50 pre-open indicative move' : 'Last pre-open reading — window is closed now (~9:00–9:08 AM IST)');
  }catch(e){
    document.getElementById('breadth-box').style.display = 'none';
    setBadge('preopen','failed', 'Blocked/failed ('+e.message+')');
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

function setHoldingsSlotCount(){
  const n = parseInt(document.getElementById('holdings-slot-count').value, 10);
  for(let i=1; i<=5; i++){
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
// reliable table structure survives). Strategy: scan line by line for rows
// that look like an order (mention NIFTYBEES, or a BUY/SELL keyword) and
// contain at least two numbers; pick the number in NIFTYBEES's plausible
// price range (₹50–₹2000) as price, and the smallest remaining whole number
// as quantity. Falls back to a whole-text "Qty:" / "Avg Price:" label scan
// if no row-level match is found. Returns up to 5 orders (matches the app's
// slot limit).
function parseOrderScreenshotText(text){
  const cleaned = (text || '').replace(/[|]/g, ' ');
  const lines = cleaned.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const orders = [];
  let anyBuy = false, anySell = false;

  for(const line of lines){
    const hasBuy = /\bBUY\b/i.test(line);
    const hasSell = /\bSELL\b/i.test(line);
    if(hasBuy) anyBuy = true;
    if(hasSell) anySell = true;
    const mentionsSymbol = /niftybees/i.test(line);
    if(!mentionsSymbol && !hasBuy && !hasSell) continue;

    const nums = (line.match(/[0-9][0-9,]*\.?[0-9]*/g) || [])
      .map(s => parseFloat(s.replace(/,/g, '')))
      .filter(n => !isNaN(n));
    if(nums.length < 2) continue;

    const priceCandidates = nums.filter(n => n >= 50 && n <= 2000);
    if(priceCandidates.length === 0) continue;
    const price = priceCandidates[priceCandidates.length - 1];
    const qtyCandidates = nums.filter(n => n !== price && Number.isInteger(n) && n > 0 && n < 100000);
    if(qtyCandidates.length === 0) continue;
    const qty = qtyCandidates[0];

    orders.push({ qty, price, side: (hasSell && !hasBuy) ? 'sell' : 'buy' });
    if(orders.length >= 5) break;
  }

  if(orders.length === 0){
    const qtyMatch = cleaned.match(/qty\.?\s*[:\-]?\s*([\d,]{1,6})/i) || cleaned.match(/quantity\.?\s*[:\-]?\s*([\d,]{1,6})/i);
    const priceMatch = cleaned.match(/avg\.?\s*(?:trade\s*)?price\.?\s*[:\-]?\s*₹?\s*([\d,]+\.?\d{0,2})/i)
                     || cleaned.match(/\bprice\.?\s*[:\-]?\s*₹?\s*([\d,]+\.?\d{0,2})/i);
    if(qtyMatch && priceMatch){
      const qty = parseInt(qtyMatch[1].replace(/,/g, ''), 10);
      const price = parseFloat(priceMatch[1].replace(/,/g, ''));
      if(qty > 0 && price > 0){
        orders.push({ qty, price, side: (anySell && !anyBuy) ? 'sell' : 'buy' });
      }
    }
  }

  return orders;
}

async function handleHoldingsUpload(event){
  const file = event.target.files && event.target.files[0];
  if(!file) return;
  const statusEl = document.getElementById('holdings-upload-status');
  statusEl.style.display = 'block';
  statusEl.className = 'upload-status pending';
  statusEl.textContent = 'Reading screenshot…';
  showCalcPopup('Reading screenshot…');
  try{
    if(typeof Tesseract === 'undefined'){
      throw new Error('OCR engine failed to load — check your connection and try again, or enter the values manually below.');
    }
    const { data: { text } } = await Tesseract.recognize(file, 'eng');
    showCalcPopup('Calculating…');
    const orders = parseOrderScreenshotText(text);
    if(orders.length === 0){
      statusEl.className = 'upload-status failed';
      statusEl.textContent = "Couldn't read quantity/price clearly from this screenshot — try a clearer or closer-cropped image, or enter the values manually below.";
      return;
    }
    const sideIsSell = orders[0].side === 'sell';
    setHoldingsMode(sideIsSell ? 'short' : 'long');
    const n = Math.min(orders.length, 5);
    document.getElementById('holdings-slot-count').value = String(n);
    setHoldingsSlotCount();
    for(let i=0; i<5; i++){
      const row = document.querySelector(`.holdings-row[data-slot="${i+1}"]`);
      if(i < n){
        row.querySelector('.h-units').value = orders[i].qty;
        row.querySelector('.h-price').value = orders[i].price;
      } else {
        row.querySelector('.h-units').value = '';
        row.querySelector('.h-price').value = '';
      }
    }
    const summary = orders.map(o => `${o.qty} @ ₹${o.price.toFixed(2)}`).join(', ');
    statusEl.className = 'upload-status ok';
    statusEl.textContent = 'Detected from screenshot (' + (sideIsSell?'Sell':'Buy') + '): ' + summary + ' — double-check against your screenshot; the fields below stay editable if anything looks off.';
    computeHoldings();
  }catch(e){
    statusEl.className = 'upload-status failed';
    statusEl.textContent = 'Could not read this image — ' + e.message;
  }finally{
    hideCalcPopup();
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

  let html = `
    <div class="hs-avg-label">${avgLabel} (${modeLabel}, ${brokerLabel})</div>
    <div class="hs-avg">₹${avgPrice.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
    <div class="hs-breakeven">Breakeven exit price${isMTF?' (covers charges + interest)':' (covers charges)'}: <span class="gold">₹${breakevenPrice.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
  `;
  if(hasTargetPct){
    if(targetExitPrice > 0){
      html += `<div class="hs-target-exit">Exit price for ${targetPct>0?'+':''}${targetPct}% net profit (after all fees${isMTF?' + interest':''} &amp; taxes): <span class="grn">₹${targetExitPrice.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`;
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
