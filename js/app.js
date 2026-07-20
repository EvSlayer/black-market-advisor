const COMMODITIES = [
  ['counterfeit_bills','Counterfeit Bills'],['stolen_electronics','Stolen Electronics'],['prescription_pills','Prescription Pills'],['uncut_cocaine','Uncut Cocaine'],['military_hardware','Military Hardware'],['exotic_animals','Exotic Animals'],['enriched_uranium','Enriched Uranium'],['stolen_art','Stolen Art']
];
const isValidMoney = n => Number.isFinite(Number(n)) && Number(n) > 0;
const fmt = n => Number.isFinite(Number(n)) ? (Number(n) < 0 ? '-$' : '$') + Math.abs(Math.round(Number(n))).toLocaleString() : '—';
const pct = n => (n>=0?'+':'') + (n*100).toFixed(1) + '%';
const cleanNum = s => Number(String(s||'').replace(/[^0-9.-]/g,'')) || 0;
const quantile = (arr,q) => { if(!arr.length) return 0; const a=[...arr].sort((x,y)=>x-y); const pos=(a.length-1)*q; const lo=Math.floor(pos), hi=Math.ceil(pos); return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo); };
const nameFor = key => (COMMODITIES.find(x=>x[0]===key)||[key,key])[1];
const keyForName = name => (COMMODITIES.find(x=>x[1].toLowerCase()===String(name).toLowerCase())||[])[0] || String(name).toLowerCase().replace(/\s+/g,'_');


function loadMarketMemory(){
  try { return JSON.parse(localStorage.getItem('bm_market_memory_v1') || '{"commodities":{},"captures":[]}'); }
  catch(e){ return {commodities:{},captures:[]}; }
}
function saveMarketMemory(mem){
  try { localStorage.setItem('bm_market_memory_v1', JSON.stringify(mem)); } catch(e){}
}
function findOverlap(existing, incoming){
  const max = Math.min(existing.length, incoming.length);
  for(let k=max; k>0; k--){
    let ok=true;
    for(let i=0;i<k;i++){
      if(Number(existing[existing.length-k+i]) !== Number(incoming[i])){ ok=false; break; }
    }
    if(ok) return k;
  }
  return 0;
}
function mergePriceSeries(existing, incoming){
  const old = (existing||[]).map(Number).filter(Number.isFinite);
  const inc = (incoming||[]).map(Number).filter(Number.isFinite);
  if(!inc.length) return {series:old, added:0, duplicate:false};
  if(!old.length) return {series:inc, added:inc.length, duplicate:false};
  const overlap = findOverlap(old, inc);
  if(overlap === inc.length) return {series:old, added:0, duplicate:true};
  const merged = old.concat(inc.slice(overlap));
  return {series:merged, added:inc.length-overlap, duplicate:false};
}
function updateMarketMemory(data){
  const mem = loadMarketMemory();
  mem.commodities ||= {};
  mem.captures ||= [];
  let totalAdded = 0;
  data.commodities.forEach(c=>{
    const entry = mem.commodities[c.key] || {
      name:c.name,
      prices:[],
      captures:0,
      lastPrice:null,
      firstCapturedAt:data.parsedAt,
      lastCapturedAt:data.parsedAt
    };
    const incoming = (c.history && c.history.length) ? c.history : [c.price];
    const merged = mergePriceSeries(entry.prices, incoming);
    entry.name = c.name;
    entry.prices = merged.series;
    entry.lastPrice = c.price;

    // Older saved-memory versions did not store the first capture date.
    // Recover the best available boundary from retained capture metadata.
    if(!entry.firstCapturedAt){
      entry.firstCapturedAt =
        mem.captures?.[0]?.capturedAt ||
        entry.lastCapturedAt ||
        data.parsedAt;
    }

    entry.lastCapturedAt = data.parsedAt;
    entry.captures = (entry.captures || 0) + 1;
    mem.commodities[c.key] = entry;
    c.sparkHistory = c.history || [];
    c.memoryHistory = entry.prices || [];
    c.history = entry.prices && entry.prices.length ? entry.prices : c.sparkHistory;
    totalAdded += merged.added;
  });
  mem.captures.push({capturedAt:data.parsedAt, events:data.events||[], prices:Object.fromEntries(data.commodities.map(c=>[c.key,c.price])), tradesRemaining:data.tradesRemaining, totalPortfolio:data.totalPortfolio});
  if(mem.captures.length > 1000) mem.captures = mem.captures.slice(-1000);
  saveMarketMemory(mem);
  const entries = Object.values(mem.commodities);
  const points = entries.reduce((s,e)=>s+(e.prices?.length||0),0);
  const firstDates = entries.map(e=>Date.parse(e.firstCapturedAt)).filter(Number.isFinite);
  const lastDates = entries.map(e=>Date.parse(e.lastCapturedAt)).filter(Number.isFinite);
  const firstCapturedAt = firstDates.length ? new Date(Math.min(...firstDates)).toISOString() : null;
  const lastCapturedAt = lastDates.length ? new Date(Math.max(...lastDates)).toISOString() : null;
  const savedDays = firstCapturedAt && lastCapturedAt
    ? Math.max(0,(Date.parse(lastCapturedAt)-Date.parse(firstCapturedAt))/86400000)
    : 0;
  data.memoryStats = {
    totalAdded,
    totalPoints:points,
    captures:mem.captures.length,
    firstCapturedAt,
    lastCapturedAt,
    savedDays
  };
  return data.memoryStats;
}
function applyMarketMemoryWithoutSaving(data){
  const mem = loadMarketMemory();
  data.commodities.forEach(c=>{
    const entry = mem.commodities?.[c.key];
    if(entry?.prices?.length){
      const merged = mergePriceSeries(entry.prices, c.history || []);
      c.sparkHistory = c.history || [];
      c.memoryHistory = merged.series;
      c.history = merged.series;
    }
  });
  return data;
}
function resetMarketMemory(){
  localStorage.removeItem('bm_market_memory_v1');
}
function movementStats(series){
  const a=(series||[]).map(Number).filter(x=>Number.isFinite(x)&&x>0);
  let maxRise=null,maxFall=null;
  for(let i=1;i<a.length;i++){
    const from=a[i-1],to=a[i];
    if(!from) continue;
    const change=(to-from)/from;
    const rec={from,to,change,index:i};
    if(change>=0 && (!maxRise || change>maxRise.change)) maxRise=rec;
    if(change<0 && (!maxFall || change<maxFall.change)) maxFall=rec;
  }
  return {maxRise,maxFall,points:a.length};
}
function allMoveRecords(data){
  return (data?.commodities||[]).map(c=>({key:c.key,name:c.name,...movementStats(c.history||[])}));
}

function parseBlackMarket(html){
  const doc = new DOMParser().parseFromString(html,'text/html');
  const text = doc.body?.innerText || doc.documentElement.innerText || '';
  const commodities = [];
  doc.querySelectorAll('.bm-card[data-commodity]').forEach(card=>{
    const key = card.getAttribute('data-commodity');
    const name = card.querySelector('.bm-card-name')?.textContent.trim() || nameFor(key);
    const price = cleanNum(card.getAttribute('data-price') || card.querySelector('.bm-card-price')?.textContent);
    let history = [];
    const canvas = card.querySelector('canvas[data-prices]');
    if(canvas){
      try { history = JSON.parse(canvas.getAttribute('data-prices').replaceAll('&quot;','"')).map(Number); }
      catch(e){ history = []; }
    }
    const changeText = card.querySelector('.bm-card-change')?.textContent.trim() || '';
    commodities.push({key,name,price,history,changeText});
  });
  const events = [...doc.querySelectorAll('.bm-event')].map(e=>e.textContent.replace(/\s+/g,' ').trim());
  const tradesRemaining = (()=>{ const m = text.match(/Trade Panel\s*[—-]\s*(\d+)\s+trades remaining/i); return m?Number(m[1]):null; })();
  const timeRemaining = doc.querySelector('h2.content_h')?.textContent.match(/Week ends in:\s*(.*)$/i)?.[1] || '';
  const cash = cleanNum(doc.querySelector('#bm-trade-form')?.getAttribute('data-cash')) || (()=>{ const m=text.match(/Cash\s*\$([\d,]+)/i); return m?cleanNum(m[1]):0; })();
  const holdings = [];
  doc.querySelectorAll('#bm-commodity option[data-held]').forEach(opt=>{
    const held = cleanNum(opt.getAttribute('data-held'));
    if(held>0) holdings.push({key:opt.value,name:nameFor(opt.value),qty:held,price:cleanNum(opt.getAttribute('data-price'))});
  });
  // Better holding details from portfolio table when available.
  doc.querySelectorAll('.bm-portfolio table tr').forEach(tr=>{
    const tds=[...tr.querySelectorAll('td')].map(td=>td.textContent.trim());
    if(tds.length>=6 && !/cash|total/i.test(tds[0])){
      const key=keyForName(tds[0]);
      const existing=holdings.find(h=>h.key===key);
      const data={key,name:tds[0],qty:cleanNum(tds[1]),avgBuy:cleanNum(tds[2]),current:cleanNum(tds[3]),value:cleanNum(tds[4]),pl:cleanNum(tds[5])};
      if(existing) Object.assign(existing,data); else holdings.push(data);
    }
  });
  const recentTrades=[];
  const tradeTables=[...doc.querySelectorAll('table')].filter(t=>/Action\s*Commodity\s*Qty\s*Price\s*Total/i.test(t.innerText.replace(/\n/g,' ')));
  tradeTables.forEach(table=>table.querySelectorAll('tr').forEach((tr,i)=>{
    if(i===0) return; const t=[...tr.querySelectorAll('td')].map(td=>td.textContent.trim());
    if(t.length>=5) recentTrades.push({action:t[0], commodity:t[1], qty:cleanNum(t[2]), price:cleanNum(t[3]), total:cleanNum(t[4])});
  }));
  const calculatedPortfolio = cash + holdings.reduce((s,h)=>s+(h.value || h.qty*h.current || h.qty*h.price),0);
  const totalPortfolio = (()=>{
    // Prefer the actual Total row inside My Portfolio. A broad regex can accidentally grab the trade panel Total ($612).
    const totalRow = [...doc.querySelectorAll('.bm-portfolio table tr')].find(tr=>{
      const first = tr.querySelector('td')?.textContent.trim() || '';
      return /^Total$/i.test(first);
    });
    if(totalRow){
      const cells=[...totalRow.querySelectorAll('td')].map(td=>td.textContent.trim());
      const moneyCell=cells.find(x=>/\$[\d,]+/.test(x));
      const n=cleanNum(moneyCell);
      if(n>0) return n;
    }
    return calculatedPortfolio;
  })();
  return {timeRemaining,tradesRemaining,cash,totalPortfolio,events,commodities,holdings,recentTrades,parsedAt:new Date().toISOString()};
}

function defaultAssumptionsFrom(data){
  const saved = JSON.parse(localStorage.getItem('bm_assumptions')||'{}');
  const out={};
  COMMODITIES.forEach(([key,name])=>{
    const c=data?.commodities?.find(x=>x.key===key);
    const hist=c?.history||[];
    out[key] = saved[key] || {min:'', avg:'', max:'', buy:'', sell:''};
    if(!out[key].auto){ out[key].auto = {min: quantile(hist,.05)||Math.min(...hist,c?.price||0), avg: quantile(hist,.50)||c?.price||0, max: quantile(hist,.95)||Math.max(...hist,c?.price||0)}; }
  });
  return out;
}
function renderAssumptions(data){
  const box=document.getElementById('assumptions'); box.innerHTML='';
  const assumptions=defaultAssumptionsFrom(data);
  box.insertAdjacentHTML('beforeend','<label>Commodity</label><label>Min</label><label>Usual</label><label>Max</label><label>Buy Threshold</label><label>Sell Threshold</label>');
  COMMODITIES.forEach(([key,name])=>{
    const c=data?.commodities?.find(x=>x.key===key); const hist=c?.history||[];
    const autoMin=quantile(hist,.05)||''; const autoAvg=quantile(hist,.50)||''; const autoMax=quantile(hist,.95)||'';
    const autoBuy=quantile(hist,.12) || (autoMin ? autoMin*1.15 : '');
    const autoSell=quantile(hist,.88) || (autoMax ? autoMax*0.90 : '');
    const a=assumptions[key]||{};
    box.insertAdjacentHTML('beforeend',`<label>${name}<br><span class="mini">Auto range ${fmt(autoMin)} / ${fmt(autoAvg)} / ${fmt(autoMax)}<br>Suggested buy ≤ ${fmt(autoBuy)} · sell ≥ ${fmt(autoSell)}</span></label>
      <input data-a="${key}" data-f="min" value="${a.min||''}" placeholder="${Math.round(autoMin)||''}">
      <input data-a="${key}" data-f="avg" value="${a.avg||''}" placeholder="${Math.round(autoAvg)||''}">
      <input data-a="${key}" data-f="max" value="${a.max||''}" placeholder="${Math.round(autoMax)||''}">
      <input data-a="${key}" data-f="buy" value="${a.buy||''}" placeholder="${Math.round(autoBuy)||''}">
      <input data-a="${key}" data-f="sell" value="${a.sell||''}" placeholder="${Math.round(autoSell)||''}">`);
  });
  box.querySelectorAll('input').forEach(inp=>inp.addEventListener('change',saveAssumptions));
}
function getAssumptions(data){
  const out={};
  COMMODITIES.forEach(([key,name])=>{
    const c=data.commodities.find(x=>x.key===key); const hist=c?.history||[];
    out[key]={
      min: cleanNum(document.querySelector(`input[data-a="${key}"][data-f="min"]`)?.value) || quantile(hist,.05) || Math.min(...hist,c?.price||0),
      avg: cleanNum(document.querySelector(`input[data-a="${key}"][data-f="avg"]`)?.value) || quantile(hist,.50) || c?.price || 0,
      max: cleanNum(document.querySelector(`input[data-a="${key}"][data-f="max"]`)?.value) || quantile(hist,.95) || Math.max(...hist,c?.price||0),
      buy: cleanNum(document.querySelector(`input[data-a="${key}"][data-f="buy"]`)?.value) || quantile(hist,.12) || ((quantile(hist,.05)||c?.price||0)*1.15),
      sell: cleanNum(document.querySelector(`input[data-a="${key}"][data-f="sell"]`)?.value) || quantile(hist,.88) || ((quantile(hist,.95)||c?.price||0)*0.90)
    };
  });
  return out;
}
function saveAssumptions(){
  const saved={};
  document.querySelectorAll('#assumptions input').forEach(inp=>{ const k=inp.dataset.a,f=inp.dataset.f; saved[k]??={}; saved[k][f]=inp.value; });
  localStorage.setItem('bm_assumptions',JSON.stringify(saved));
}
function modeParams(){
  const mode=document.getElementById('mode').value;
  return mode==='aggressive'
    ? {minImprovePct:.02,minImproveDollar:.02,scorePenalty:4,label:'Aggressive',sellZone:.72,minProfitForCash:.75,maxUpsideForCash:.45,buyZone:.58,cashBuyZone:.50,extremeSwitchPct:.45,overExtendedProfit:1.40,overExtendedPos:.55,buyThresholdFactor:1.10}
    : mode==='conservative'
      ? {minImprovePct:.10,minImproveDollar:.08,scorePenalty:12,label:'Conservative',sellZone:.90,minProfitForCash:1.50,maxUpsideForCash:.22,buyZone:.38,cashBuyZone:.30,extremeSwitchPct:.75,overExtendedProfit:2.25,overExtendedPos:.72,buyThresholdFactor:1.00}
      : {minImprovePct:.05,minImproveDollar:.04,scorePenalty:8,label:'Balanced',sellZone:.82,minProfitForCash:1.00,maxUpsideForCash:.32,buyZone:.48,cashBuyZone:.40,extremeSwitchPct:.60,overExtendedProfit:1.75,overExtendedPos:.60,buyThresholdFactor:1.03};
}
function allocationMode(){
  return document.getElementById('allocationMode')?.value || 'split';
}
function makeSplitOption(a,b,currentValue,cashIfLiquidated,currentHolding){
  if(!a || !b || a.key===b.key) return null;
  const half = Math.floor(cashIfLiquidated/2);
  const qtyA = Math.floor(half / a.price);
  const spentA = qtyA * a.price;
  const remainingForB = cashIfLiquidated - spentA;
  const qtyB = Math.floor(remainingForB / b.price);
  const spentB = qtyB * b.price;
  const leftover = cashIfLiquidated - spentA - spentB;
  if(qtyA <= 0 || qtyB <= 0) return null;
  const expectedValue = qtyA*a.target + qtyB*b.target + leftover;
  const improvement = expectedValue - currentValue;
  const improvementPct = currentValue ? improvement/currentValue : 0;
  const tradesNeeded = currentHolding ? 3 : 2;
  const worstPos = Math.max(a.pos,b.pos);
  const avgScore = (a.score+b.score)/2;
  const balanceBonus = Math.max(0, 12 - Math.abs(a.expectedValue-b.expectedValue)/Math.max(a.expectedValue,b.expectedValue,1)*40);
  let score = Math.max(0, Math.min(100, avgScore + balanceBonus - tradesNeeded*2));
  return {
    type:'split', key:`__split_${a.key}_${b.key}`, name:`50/50 ${a.name} / ${b.name}`,
    legA:a, legB:b, price:null, history:[], target:null, min:null, avg:null,
    heldQty:0, avgBuy:0, tradesNeeded, buyQty:0, qtyA, qtyB,
    expectedValue, improvement, improvementPct, upsidePct:improvementPct,
    pos:worstPos, rareHigh:Math.max(a.rareHigh||0,b.rareHigh||0), score
  };
}

function normalizeEventName(text){
  return String(text||'').replace(/\s*\([^)]*ago\)\s*$/i,'').trim();
}
function parseEventAgeMinutes(text){
  const s=String(text||'');
  let m=s.match(/\((\d+)m ago\)/i); if(m) return Number(m[1]);
  m=s.match(/\((\d+)h ago\)/i); if(m) return Number(m[1])*60;
  m=s.match(/\((\d+)d ago\)/i); if(m) return Number(m[1])*1440;
  return 0;
}
function eventTargetKey(name){
  const m=String(name||'').match(/[—-]\s*(.+?)\s+affected$/i);
  return m ? keyForName(m[1]) : null;
}
function clonePrices(data){
  return Object.fromEntries((data.commodities||[]).map(c=>[c.key,Number(c.price)||0]));
}
function nearestSampleAfter(samples,startMs,minMinutes){
  const target=startMs+minMinutes*60000;
  const valid=(samples||[]).filter(s=>new Date(s.at).getTime()>=target).sort((a,b)=>new Date(a.at)-new Date(b.at));
  return valid[0]||null;
}
function summarizeEventOccurrences(mem){
  const windows=[15,60,180,360,720,1440];
  const profiles={};
  for(const occ of mem.occurrences||[]){
    const name=occ.name; profiles[name] ||= {name,targetKey:occ.targetKey||null,occurrences:0,windows:{}};
    const p=profiles[name]; p.occurrences++;
    const startMs=new Date(occ.startAt).getTime();
    for(const w of windows){
      const sample=nearestSampleAfter(occ.samples,startMs,w); if(!sample) continue;
      p.windows[w] ||= {};
      for(const [key,startPrice] of Object.entries(occ.startPrices||{})){
        const endPrice=sample.prices?.[key];
        if(!(startPrice>0 && endPrice>0)) continue;
        const change=(endPrice-startPrice)/startPrice;
        p.windows[w][key] ||= [];
        p.windows[w][key].push(change);
      }
    }
  }
  for(const p of Object.values(profiles)){
    p.summary={};
    for(const [w,byKey] of Object.entries(p.windows)){
      p.summary[w]={};
      for(const [key,vals] of Object.entries(byKey)){
        const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
        const positive=vals.filter(v=>v>0).length/vals.length;
        const consistency=Math.max(positive,1-positive);
        p.summary[w][key]={avg,positive,consistency,n:vals.length};
      }
    }
  }
  return profiles;
}
function inferEventStartPrices(data, ageMinutes){
  const inferred={};
  const steps=Math.max(0,Math.round((Number(ageMinutes)||0)/15));
  for(const c of data.commodities||[]){
    const hist=(c.history||[]).map(Number).filter(x=>Number.isFinite(x)&&x>0);
    if(!hist.length){ inferred[c.key]=c.price; continue; }
    // Sparkline points represent consecutive 15-minute updates and normally end
    // with the current price. Walk backward by the event's displayed age.
    const idx=Math.max(0,hist.length-1-steps);
    inferred[c.key]=hist[idx]||c.price;
  }
  return inferred;
}
function updateEventMemory(data){
  const storageKey='bm_event_memory_v4';
  let mem;
  try{ mem=JSON.parse(localStorage.getItem(storageKey)||'{"occurrences":[],"snapshots":[]}'); }
  catch(e){ mem={occurrences:[],snapshots:[]}; }
  mem.occurrences ||= []; mem.snapshots ||= [];
  const now=new Date(data.parsedAt||new Date().toISOString());
  const prices=clonePrices(data);
  const rawEvents=(data.events||[]).map(raw=>({raw,name:normalizeEventName(raw),ageMinutes:parseEventAgeMinutes(raw)})).filter(e=>e.name);
  const snapshotSig=rawEvents.map(e=>e.name).sort().join('|')+'|'+Object.values(prices).join(',');
  if(!mem.snapshots.some(x=>x.signature===snapshotSig)){
    mem.snapshots.push({at:now.toISOString(),events:rawEvents.map(e=>e.name),prices,signature:snapshotSig});
    if(mem.snapshots.length>2000) mem.snapshots=mem.snapshots.slice(-2000);
  }
  for(const ev of rawEvents){
    const inferredStart=new Date(now.getTime()-ev.ageMinutes*60000);
    // Reuse an occurrence while the event remains continuous. If it vanished for >8h,
    // treat a later appearance as a new occurrence.
    let occ=[...mem.occurrences].reverse().find(o=>o.name===ev.name && (now-new Date(o.lastSeenAt||o.startAt))<=8*3600000);
    const inferredStartPrices=inferEventStartPrices(data,ev.ageMinutes);
    if(!occ){
      occ={id:ev.name+'|'+inferredStart.toISOString(),name:ev.name,targetKey:eventTargetKey(ev.name),startAt:inferredStart.toISOString(),firstCapturedAt:now.toISOString(),lastSeenAt:now.toISOString(),startPrices:inferredStartPrices,samples:[],backfilledFromHistory:true};
      mem.occurrences.push(occ);
    } else if(!occ.backfilledFromHistory && ev.ageMinutes>=15){
      // Upgrade occurrences created by older advisor versions, which incorrectly
      // used the first captured/current price as the event-start price.
      occ.startAt=inferredStart.toISOString();
      occ.startPrices=inferredStartPrices;
      occ.backfilledFromHistory=true;
    }
    occ.lastSeenAt=now.toISOString();
    occ.samples ||= [];
    const sig=Object.values(prices).join(',');
    if(!occ.samples.some(s=>s.signature===sig)) occ.samples.push({at:now.toISOString(),prices,overlaps:rawEvents.map(e=>e.name).filter(n=>n!==ev.name),signature:sig});
  }
  if(mem.occurrences.length>500) mem.occurrences=mem.occurrences.slice(-500);
  localStorage.setItem(storageKey,JSON.stringify(mem));
  const profiles=summarizeEventOccurrences(mem);
  const active={};
  for(const ev of rawEvents){
    const p=profiles[ev.name];
    if(p) active[ev.name]=p;
  }
  return {occurrences:mem.occurrences.length,snapshots:mem.snapshots.length,profiles,active,rawEvents};
}
function getEventSignal(eventMemory, commodityKey){
  const signals=[];
  for(const [name,p] of Object.entries(eventMemory?.active||{})){
    // Prefer a 6h result, then 3h, 12h, 1h. Require at least two independent occurrences.
    let stat=null, window=null;
    for(const w of [360,180,720,60,1440]){
      const x=p.summary?.[w]?.[commodityKey];
      if(x && x.n>=2){ stat=x; window=w; break; }
    }
    if(!stat) continue;
    const targeted=!p.targetKey || p.targetKey===commodityKey;
    if(!targeted && p.targetKey) continue;
    const confidence=Math.min(1,(stat.n/5))*stat.consistency;
    signals.push({name,avg:stat.avg,n:stat.n,consistency:stat.consistency,confidence,window,targeted:!!p.targetKey});
  }
  if(!signals.length) return {effect:0,confidence:0,signals:[]};
  const weight=signals.reduce((s,x)=>s+x.confidence,0)||1;
  const effect=signals.reduce((s,x)=>s+x.avg*x.confidence,0)/weight;
  const confidence=Math.min(1,signals.reduce((s,x)=>s+x.confidence,0)/signals.length);
  return {effect,confidence,signals};
}
function buildPortfolioPlan(data, commodityOptions, currentValue, holdingValues){
  const cap=.33, tolerance=.012;
  const tradesRemaining = Number.isFinite(data.tradesRemaining) ? data.tradesRemaining : 10;
  const tradeReserve = Math.min(3, Math.max(1, Math.floor(tradesRemaining*.25)));
  const actionableTradeBudget = Math.max(0, tradesRemaining-tradeReserve);
  const currentByKey=Object.fromEntries(holdingValues.map(h=>[h.key,h.value||0]));
  const optionByKey=Object.fromEntries(commodityOptions.map(o=>[o.key,o]));

  const eligible=commodityOptions
    .filter(o=>o.inManualBuyZone && !o.inSellZone)
    .sort((a,b)=> (b.score-a.score) || (b.upsidePct-a.upsidePct));

  // Loss protection: do not dump an underwater position merely to chase the newest
  // buy-zone candidate. A loss position is preserved unless the replacement's
  // expected growth multiple is materially better or the holding itself is in a
  // sell/danger zone. This is not treating the purchase price as magic; it is a
  // churn-control rule designed around the 10-trades-per-day limit.
  const bestEligible=eligible[0]||null;
  const protectedLossKeys=new Set();
  const lossNotes=[];
  for(const h of holdingValues){
    const o=optionByKey[h.key];
    if(!o || !h.avgBuy || !h.current || h.current>=h.avgBuy) continue;
    const currentMultiple=o.price>0 ? o.target/o.price : 1;
    const replacementMultiple=bestEligible?.price>0 ? bestEligible.target/bestEligible.price : 1;
    const materiallyBetter=replacementMultiple >= currentMultiple*1.25;
    if(!o.inSellZone && !materiallyBetter){
      protectedLossKeys.add(h.key);
      const loss=(h.avgBuy-h.current)*(h.qty||0);
      lossNotes.push(`${h.name} is below average buy; preserving it avoids locking about ${fmt(Math.max(0,loss))} of loss without a clearly superior replacement.`);
    }
  }

  const allocations=[];
  let used=0;
  // Preserve protected loss positions first, capped at the game's 33% rule.
  for(const h of holdingValues.filter(h=>protectedLossKeys.has(h.key)).sort((a,b)=>(b.value||0)-(a.value||0))){
    const o=optionByKey[h.key];
    const pct=Math.min(cap, Math.max(0,(h.value||0)/Math.max(1,currentValue)), 1-used);
    if(pct<=.0001) continue;
    allocations.push({key:h.key,name:h.name,pct,dollars:currentValue*pct,price:o?.price||h.current,target:o?.target,buyThreshold:o?.buyThreshold,sellThreshold:o?.sellThreshold,reason:'Protected loss position; no clearly superior replacement'});
    used+=pct;
  }

  const selected=[];
  for(const o of eligible){
    if(allocations.some(a=>a.key===o.key)) continue;
    if(selected.length>=3 || used>=.99) break;
    const alloc=Math.min(cap,1-used);
    if(alloc<=0) break;
    allocations.push({key:o.key,name:o.name,pct:alloc,dollars:currentValue*alloc,price:o.price,target:o.target,buyThreshold:o.buyThreshold,sellThreshold:o.sellThreshold,reason:o.price<=o.buyThreshold?'Inside buy zone':'Best qualifying opportunity'});
    selected.push(o);
    used+=alloc;
  }
  // Count protected holdings as selected portfolio components for display/logic.
  for(const a of allocations){
    const o=optionByKey[a.key];
    if(o && !selected.some(x=>x.key===o.key)) selected.push(o);
  }

  const cashPct=Math.max(0,1-used);
  if(cashPct>.0001) allocations.push({key:'__cash',name:'Cash',pct:cashPct,dollars:currentValue*cashPct,reason:eligible.length<3?'No additional commodity meets its buy threshold':'33% cap leaves a reserve'});
  const targetByKey=Object.fromEntries(allocations.map(a=>[a.key,a.dollars]));
  let trades=[];
  for(const h of holdingValues){
    const target=targetByKey[h.key]||0;
    const diff=(h.value||0)-target;
    if(diff>currentValue*tolerance){
      const atLoss=!!(h.avgBuy && h.current && h.current<h.avgBuy);
      if(atLoss && protectedLossKeys.has(h.key)) continue;
      trades.push({action:target>0?'SELL DOWN':'SELL',name:h.name,dollars:diff,key:h.key,atLoss});
    }
  }
  for(const a of allocations.filter(a=>a.key!=='__cash')){
    const have=currentByKey[a.key]||0;
    const diff=a.dollars-have;
    if(diff>currentValue*tolerance) trades.push({action:'BUY',name:a.name,dollars:diff,key:a.key,qty:Math.floor(diff/a.price)});
  }

  // Evaluate whether the rebalance is actually worth scarce daily trades.
  const projectedCurrent = (data.cash||0) + holdingValues.reduce((sum,h)=>{
    const o=optionByKey[h.key];
    return sum + (o && o.price>0 ? (h.value||0)*(o.target/o.price) : (h.value||0));
  },0);
  const projectedPlan = allocations.reduce((sum,a)=>{
    if(a.key==='__cash') return sum+a.dollars;
    const o=optionByKey[a.key];
    return sum + (o && o.price>0 ? a.dollars*(o.target/o.price) : a.dollars);
  },0);
  const projectedImprovement=projectedPlan-projectedCurrent;
  const improvementPct=currentValue?projectedImprovement/currentValue:0;
  const gainPerTrade=trades.length?projectedImprovement/trades.length:0;

  // Opportunity-cost test: a mathematically better portfolio is not automatically
  // worth spending scarce trades on. The required edge rises with the number of
  // trades consumed, while still allowing a truly exceptional switch through.
  const requiredOverallPct = Math.max(.08, trades.length*.03);
  const requiredGainPerTradePct = .04;
  const requiredGainPerTrade = currentValue*requiredGainPerTradePct;
  const exceptionalEdge = improvementPct>=.25;
  const meaningfulRebalance = trades.length>0 &&
    improvementPct>=requiredOverallPct &&
    (gainPerTrade>=requiredGainPerTrade || exceptionalEdge);
  const opportunityCostDecision = !trades.length
    ? 'No trade needed'
    : meaningfulRebalance
      ? 'Worth the trades'
      : 'Not worth the trades yet';

  // Never recommend a plan that exceeds today's available trades. Also preserve a
  // small reserve so the advisor does not burn all 10 trades early in the day.
  const overBudget=trades.length>actionableTradeBudget;
  const deferredTrades=overBudget ? trades.slice(actionableTradeBudget) : [];
  if(overBudget) trades=trades.slice(0,actionableTradeBudget);

  const currentMixDistance=allocations.reduce((s,a)=>s+Math.abs((currentByKey[a.key]||0)-a.dollars),0) + holdingValues.filter(h=>!targetByKey[h.key]).reduce((s,h)=>s+(h.value||0),0);
  const nearPlan=currentMixDistance <= currentValue*.05;
  let headline='WAIT IN CASH';
  if(selected.length && (nearPlan || !meaningfulRebalance)) headline='HOLD CURRENT MIX';
  else if(selected.length && actionableTradeBudget>0) headline='REBALANCE PORTFOLIO';
  else if(selected.length) headline='HOLD CURRENT MIX';
  return {cap,allocations,trades,selected,eligibleCount:eligible.length,cashPct,nearPlan,headline,tradesRemaining,tradeReserve,actionableTradeBudget,overBudget,deferredTrades,projectedCurrent,projectedPlan,projectedImprovement,improvementPct,gainPerTrade,meaningfulRebalance,requiredOverallPct,requiredGainPerTradePct,requiredGainPerTrade,opportunityCostDecision,protectedLossKeys:[...protectedLossKeys],lossNotes};
}
function analyze(data){
  const assumptions=getAssumptions(data), params=modeParams();
  const eventMemory = updateEventMemory(data);
  const currentValue = data.totalPortfolio || (data.cash + data.holdings.reduce((s,h)=>s+(h.value||h.qty*(h.current||h.price)),0));

  // Treat tiny leftover holdings as dust. The game can leave you with 1 share of
  // something useless; that should not become the "current holding" and confuse
  // the advisor into telling you to switch into the thing you already mostly own.
  const holdingValues = data.holdings.map(h=>{
    const commodity = data.commodities.find(c=>c.key===h.key);
    const currentPrice = h.current || h.price || commodity?.price || 0;
    const value = h.value || (h.qty||0) * currentPrice;
    return {...h,current:currentPrice,value};
  }).sort((a,b)=>(b.value||0)-(a.value||0));
  const majorThresholdPct = 0.03; // positions at or above 3% are analyzed independently
  const dustThreshold = Math.max(1000, currentValue * majorThresholdPct);
  const meaningfulHoldings = holdingValues.filter(h=>(h.value||0) >= dustThreshold);
  const ignoredDust = holdingValues.filter(h=>(h.value||0) < dustThreshold);
  const currentHolding = meaningfulHoldings.length===1 ? meaningfulHoldings[0] : null;
  const dominantHolding = meaningfulHoldings[0] || null;
  const cashIfLiquidated = currentValue;

  const commodityOptions = data.commodities.map(c=>{
    const a=assumptions[c.key]; const target=Math.max(a.max,c.price); const min=a.min||Math.min(...c.history,c.price); const avg=a.avg||quantile(c.history,.5)||c.price;
    const baseBuyThreshold = a.buy || quantile(c.history||[],.12) || min*1.15;
    const baseSellThreshold = a.sell || quantile(c.history||[],.88) || target*0.90;
    const eventSignal = getEventSignal(eventMemory,c.key);
    // Event adjustments stay intentionally modest and only activate after repeated,
    // consistent observations. Bearish events demand a cheaper entry and make us
    // more willing to protect gains; bullish events allow a slightly higher entry
    // and a little more room before selling.
    const eventAdj = eventSignal.confidence>=.45 ? Math.max(-.12,Math.min(.10,eventSignal.effect*.55)) : 0;
    const buyThreshold = baseBuyThreshold * (1 + eventAdj);
    const sellThreshold = baseSellThreshold * (1 + eventAdj*.65);
    const sellThresholdRatio = sellThreshold > 0 ? c.price / sellThreshold : 0;
    const inSellZone = isValidMoney(sellThreshold) && c.price >= sellThreshold;
    const buyThresholdRatio = buyThreshold > 0 ? c.price / buyThreshold : Infinity;
    const inManualBuyZone = isValidMoney(buyThreshold) && c.price <= buyThreshold * params.buyThresholdFactor;
    const held = holdingValues.find(h=>h.key===c.key);
    const same = !!(meaningfulHoldings.length===1 && currentHolding && c.key===currentHolding.key);
    const otherMajorCount = meaningfulHoldings.filter(h=>h.key!==c.key).length;
    const alreadyHasTarget = meaningfulHoldings.some(h=>h.key===c.key);
    const meaningfulCash = data.cash >= currentValue * .01;
    const tradesNeeded = same && !meaningfulCash ? 0 : otherMajorCount + ((alreadyHasTarget && !meaningfulCash) ? 0 : 1);
    const buyQty = Math.floor(cashIfLiquidated / c.price);
    const leftover = cashIfLiquidated - buyQty*c.price;
    const expectedValue = buyQty*target + leftover;
    const improvement = expectedValue - currentValue;
    const improvementPct = currentValue? improvement/currentValue : 0;
    const upsidePct = c.price ? (target-c.price)/c.price : 0;
    const pos = target>min ? (c.price-min)/(target-min) : .5;
    const hist = c.history||[]; const rareHigh = hist.length ? hist.filter(x=>x>=target*.9).length / hist.length : 0;
    let score = 50 + Math.min(35,upsidePct*18) + Math.min(25,improvementPct*90) - tradesNeeded*params.scorePenalty - Math.max(0,pos-.75)*25;
    if(same) score += 7;
    if(eventSignal.confidence>=.45) score += Math.max(-10,Math.min(10,eventSignal.effect*100*eventSignal.confidence*.8));
    score = Math.max(0,Math.min(100,score));
    return {type:'commodity',key:c.key,name:c.name,price:c.price,history:hist,target,min,avg,baseBuyThreshold,baseSellThreshold,buyThreshold,sellThreshold,eventSignal,eventAdjustment:eventAdj,sellThresholdRatio,inSellZone,buyThresholdRatio,inManualBuyZone,heldQty:held?.qty||0,avgBuy:held?.avgBuy||0,tradesNeeded,buyQty,expectedValue,improvement,improvementPct,upsidePct,pos,rareHigh,score};
  });
  const splitOptions = [];
  if(allocationMode()==='split'){
    const splitCandidates = commodityOptions
      .filter(o=>!currentHolding || o.key!==currentHolding.key)
      .filter(o=>o.inManualBuyZone || o.pos <= Math.max(params.buyZone+.10,.58))
      .sort((a,b)=>b.expectedValue-a.expectedValue || b.score-a.score);
    const topA = splitCandidates[0];
    const topB = splitCandidates.find(o=>topA && o.key!==topA.key);
    if(topA && topB){
      const closeEnough = topB.expectedValue >= topA.expectedValue * .82 || topB.score >= topA.score - 12 || topB.pos < topA.pos;
      if(closeEnough){
        const split = makeSplitOption(topA, topB, currentValue, cashIfLiquidated, currentHolding);
        if(split) splitOptions.push(split);
      }
    }
  }
  const positionAssessments = meaningfulHoldings.map(h=>{
    const o=commodityOptions.find(x=>x.key===h.key);
    if(!o) return null;
    const profitPct = h.avgBuy ? ((o.price-h.avgBuy)/h.avgBuy) : 0;
    let pressure='Low';
    if(o.pos >= Math.min(.96, params.sellZone+.10) || o.upsidePct <= params.maxUpsideForCash/2) pressure='High';
    else if(o.pos >= params.sellZone || o.upsidePct <= params.maxUpsideForCash) pressure='Medium-High';
    else if(o.pos >= Math.max(.58, params.sellZone-.18)) pressure='Medium';
    return {...h, option:o, portfolioPct:currentValue?h.value/currentValue:0, profitPct, sellPressure:pressure};
  }).filter(Boolean);
  const minorCurrentValue = ignoredDust.reduce((s,h)=>s+(h.value||0),0);
  const baselineExpected = data.cash + minorCurrentValue + positionAssessments.reduce((s,p)=>s + (p.qty||0)*p.option.target,0);
  const portfolioOpt = meaningfulHoldings.length>1 ? {
    type:'portfolio',key:'__portfolio',name:'Hold current mix',price:null,target:null,min:null,avg:null,history:[],
    tradesNeeded:0,buyQty:0,expectedValue:baselineExpected,improvement:baselineExpected-currentValue,
    improvementPct:currentValue?(baselineExpected-currentValue)/currentValue:0,upsidePct:currentValue?(baselineExpected-currentValue)/currentValue:0,
    pos:positionAssessments.length?positionAssessments.reduce((s,p)=>s+p.option.pos*p.portfolioPct,0)/Math.max(.0001,positionAssessments.reduce((s,p)=>s+p.portfolioPct,0)):.5,
    rareHigh:0,score:Math.round(positionAssessments.reduce((s,p)=>s+p.option.score*p.portfolioPct,0)/Math.max(.0001,positionAssessments.reduce((s,p)=>s+p.portfolioPct,0)))
  } : null;
  const currentOpt = portfolioOpt || (currentHolding ? commodityOptions.find(o=>o.key===currentHolding.key) : null);

  // Explicit cash option: sell current holding and wait for a better entry.
  // This is not a "growth" option; it is a risk-control / profit-lock option.
  const currentProfitPct = currentOpt?.avgBuy ? ((currentOpt.price - currentOpt.avgBuy) / currentOpt.avgBuy) : 0;
  const currentRemainingUpside = currentOpt?.upsidePct ?? 0;
  const cashScoreRaw = meaningfulHoldings.length
    ? 38 + Math.min(28, Math.max(0,currentProfitPct)*10) + Math.min(30, Math.max(0,currentOpt?.pos||0)*30) - Math.min(18, Math.max(0,currentRemainingUpside)*22)
    : 45;
  const cashOption = {
    type:'cash', key:'__cash', name:'Cash / Wait', price:1, history:[], target:null, min:null, avg:null,
    heldQty:0, avgBuy:0, tradesNeeded: meaningfulHoldings.length, buyQty:0,
    expectedValue: currentValue, improvement:0, improvementPct:0, upsidePct:0,
    pos: currentOpt?.pos ?? 0, rareHigh:0, score:Math.max(0,Math.min(100,cashScoreRaw)),
    currentProfitPct, currentRemainingUpside
  };

  const options = [...(portfolioOpt?[portfolioOpt]:[]), ...commodityOptions, ...splitOptions, cashOption];

  // Decision ranking: expected dollars come first for buy/switch options, while cash gets a fair
  // risk-control score but should not beat a clearly superior growth opportunity.
  options.forEach(o=>{
    o.vsHold = o.expectedValue - baselineExpected;
    o.extraVsNow = o.expectedValue - currentValue;
    if(o.type==='cash'){
      o.decisionRank = o.score/100 * currentValue * 0.50;
    } else {
      const splitDiversificationBonus = o.type==='split' ? currentValue*0.015 : 0;
      o.decisionRank = o.expectedValue - (o.tradesNeeded * currentValue * 0.01) + (o.score/100) * currentValue * 0.02 + splitDiversificationBonus;
    }
  });
  options.sort((a,b)=>b.decisionRank-a.decisionRank || b.expectedValue-a.expectedValue || b.score-a.score);

  const best = options[0];
  const bestSwitch = commodityOptions.filter(o=>!(meaningfulHoldings.length===1 && currentHolding && o.key===currentHolding.key)).sort((a,b)=>b.expectedValue-a.expectedValue || b.score-a.score)[0];
  const bestGrowth = options.filter(o=>!['cash','portfolio'].includes(o.type) && !(meaningfulHoldings.length===1 && currentHolding && o.key===currentHolding.key)).sort((a,b)=>b.decisionRank-a.decisionRank || b.expectedValue-a.expectedValue || b.score-a.score)[0] || bestSwitch;
  const thresholdDollar = currentValue * params.minImproveDollar;
  const thresholdPct = params.minImprovePct;
  const rawSwitchCompelling = !!(bestSwitch && bestSwitch.vsHold > thresholdDollar && (bestSwitch.vsHold/currentValue) > thresholdPct);

  // A separate cash/take-profit trigger. This fires when the current holding is rich enough
  // to review, even if there is another theoretical switch with upside. This prevents
  // "sell winner and force-buy the next best thing" when the replacement is not in a good entry zone.
  const inSellZone = !!(currentOpt && (currentOpt.pos >= params.sellZone || currentOpt.price >= currentOpt.target*params.sellZone));
  const profitWorthProtecting = !!(currentOpt && currentOpt.avgBuy && currentProfitPct >= params.minProfitForCash);
  const upsideLimited = !!(currentOpt && currentRemainingUpside <= params.maxUpsideForCash);
  const replacementInBuyZone = !!(bestSwitch && bestSwitch.inManualBuyZone);
  const replacementExtremeEdge = !!(bestSwitch && (bestSwitch.vsHold/currentValue) >= params.extremeSwitchPct);
  const switchCompelling = !!(rawSwitchCompelling && (replacementInBuyZone || replacementExtremeEdge));
  // Also allow cash to win when the current position is massively profitable and already
  // well above the middle of its range, even if it still has some theoretical upside left.
  // This catches the practical "lock gains, don't force-buy yet" case.
  const currentOverExtended = !!(currentOpt && currentProfitPct >= params.overExtendedProfit && currentOpt.pos >= params.overExtendedPos);

  // Sell pressure is deliberately gradual. A big profit alone is not enough to sell;
  // we mainly care about how close the current holding is to its observed/estimated ceiling.
  // This avoids selling winners too early while still warning when greed risk rises.
  let sellPressure = 'None';
  if(currentOpt){
    if(currentOpt.inSellZone || currentOpt.pos >= Math.min(.96, params.sellZone + .10) || currentRemainingUpside <= params.maxUpsideForCash/2) sellPressure = 'High';
    else if((isValidMoney(currentOpt.sellThreshold) && currentOpt.price >= currentOpt.sellThreshold*0.92) || currentOpt.pos >= params.sellZone || currentRemainingUpside <= params.maxUpsideForCash) sellPressure = 'Medium-High';
    else if(currentOpt.pos >= Math.max(.58, params.sellZone - .18) || currentOverExtended) sellPressure = 'Medium';
    else sellPressure = 'Low';
  }

  // Cash should only win when the current holding is truly in a sell/review zone and
  // the replacement is not a clean entry. Do not sell just because the position is profitable.
  const cashCompelling = !!(meaningfulHoldings.length===1 && currentHolding && profitWorthProtecting && (inSellZone || upsideLimited) && (!switchCompelling || !replacementInBuyZone));

  // If you are already in cash, buying is optional. Do not pressure-buy a mediocre/high entry
  // just because it is mathematically better than earning $0 in cash.
  const bestCashBuyIsClean = !!(bestSwitch && bestSwitch.inManualBuyZone);

  let action='DO NOTHING', chosen=currentOpt||cashOption||best;

  if(!meaningfulHoldings.length){
    if(bestCashBuyIsClean){
      chosen = (bestGrowth && bestGrowth.type==='split' && bestGrowth.expectedValue >= (bestSwitch?.expectedValue||0)*.96) ? bestGrowth : bestSwitch;
      action = chosen.type==='split' ? 'SPLIT BUY' : 'BUY ' + chosen.name.toUpperCase();
    } else {
      action='WAIT IN CASH';
      chosen=cashOption;
    }
  } else if(switchCompelling){
    chosen = (bestGrowth && bestGrowth.type==='split' && bestGrowth.expectedValue >= bestSwitch.expectedValue*.96) ? bestGrowth : bestSwitch;
    action = chosen.type==='split'
      ? 'CONSIDER SPLIT BUY'
      : ((bestSwitch.vsHold/currentValue) > thresholdPct*2 || bestSwitch.vsHold > thresholdDollar*2
        ? 'STRONGLY CONSIDER SWITCHING'
        : 'CONSIDER SWITCHING');
  } else if(cashCompelling){
    chosen=cashOption;
    action = (currentOpt.pos >= params.sellZone + .10 || currentRemainingUpside <= params.maxUpsideForCash/2)
      ? 'STRONGLY CONSIDER SELLING TO CASH'
      : 'CONSIDER SELLING TO CASH';
  } else if(bestSwitch && bestSwitch.vsHold > 0){
    action='TOO CLOSE TO CALL';
    chosen=currentOpt;
  }

  // Keep the chosen recommendation visible at the top of the alternatives table.
  if(chosen){
    options.sort((a,b)=> (a.key===chosen.key ? -1 : b.key===chosen.key ? 1 : (b.decisionRank-a.decisionRank || b.expectedValue-a.expectedValue || b.score-a.score)));
  }

  const edge = bestSwitch && currentOpt ? bestSwitch.vsHold : 0;
  const edgePct = currentValue ? edge/currentValue : 0;
  let decisionConfidence;
  if(action==='TOO CLOSE TO CALL'){
    // If it is too close to call, the confidence should communicate uncertainty, not certainty.
    // Cap it so the UI does not say "Too close" with 90%+ confidence.
    decisionConfidence = Math.round(Math.max(45, Math.min(64, 56 + Math.min(8, Math.abs(edgePct)*20) - (replacementInBuyZone?4:0))));
  } else if(action==='WAIT IN CASH'){
    decisionConfidence = Math.round(Math.max(52, Math.min(86, 68 + (bestCashBuyIsClean? -12 : 8) + (bestSwitch ? Math.max(0,bestSwitch.pos-params.cashBuyZone)*20 : 0))));
  } else if(action.includes('CASH')){
    // Cash confidence is about profit protection + lack of a clean replacement, not raw upside
    // of the best theoretical switch.
    decisionConfidence = Math.round(Math.max(50, Math.min(92,
      58 + Math.min(18, Math.max(0,currentProfitPct)*6) +
      Math.min(12, Math.max(0,currentOpt?.pos||0)*12) +
      (replacementInBuyZone ? -10 : 8) +
      (currentRemainingUpside <= params.maxUpsideForCash ? 8 : -2)
    )));
  } else {
    const confidenceBase = action==='DO NOTHING' ? 74 : 62;
    decisionConfidence = Math.round(Math.max(45, Math.min(96, confidenceBase + Math.abs(edgePct)*160 - ((chosen?.tradesNeeded||0)*2))));
  }
  const portfolioPlan = buildPortfolioPlan(data, commodityOptions, currentValue, holdingValues);
  // The new rules make the 33%-cap portfolio plan the primary recommendation.
  // Legacy single-stock analysis remains below as supporting detail.
  action = portfolioPlan.headline;
  if(action==='REBALANCE PORTFOLIO') decisionConfidence = Math.max(60, Math.min(94, 60 + portfolioPlan.selected.length*9 + Math.min(7, portfolioPlan.trades.length)));
  else if(action==='HOLD CURRENT MIX') decisionConfidence = Math.max(68, decisionConfidence||68);
  else if(action==='WAIT IN CASH') decisionConfidence = Math.max(58, Math.min(88, 62 + (3-portfolioPlan.selected.length)*6));

  const dataPoints = Math.max(...data.commodities.map(c=>c.history?.length||0),0);
  const dataConfidence = Math.round(Math.max(15, Math.min(92, 20 + dataPoints*0.9)));
  const risk = action.includes('CASH') ? 'Medium' : chosen.pos>.95 ? 'High' : (chosen.pos>.85 || Math.abs(edge/currentValue)<.03 ? 'Medium' : 'Low');
  return {options,commodityOptions,splitOptions,cashOption,currentOpt,best,bestSwitch,bestGrowth,chosen,action,currentValue,params,allocationMode:allocationMode(),decisionConfidence,dataConfidence,risk,thresholdDollar,thresholdPct,baselineExpected,currentProfitPct,currentRemainingUpside,cashCompelling,switchCompelling,rawSwitchCompelling,replacementInBuyZone,replacementExtremeEdge,currentOverExtended,sellPressure,bestCashBuyIsClean,meaningfulHoldings,ignoredDust,dustThreshold,majorThresholdPct,positionAssessments,portfolioOpt,dominantHolding,portfolioPlan,eventMemory};
}
function render(data, result){
  const currentName = result.portfolioOpt ? 'your current mix' : (result.currentOpt?.name || 'Cash');
  const pplan=result.portfolioPlan;
  const picks=pplan.selected.map(x=>x.name);
  const recText = result.action==='REBALANCE PORTFOLIO'
    ? `My take: rebalance across ${picks.join(', ')} with no commodity above 33%. Any unfilled allocation should remain in cash rather than forcing a weak entry.`
    : result.action==='HOLD CURRENT MIX'
      ? `My take: hold the current mix. It is already close to the best 33%-capped allocation available at this moment.`
      : `My take: wait in cash. Fewer than three commodities currently qualify as clean buys, so the optimizer is preserving the unused allocation.`;
  const bestAlt = result.bestSwitch;
  const riskClass = result.risk==='Low'?'good':result.risk==='Medium'?'warn':'bad';
  document.getElementById('recBox').innerHTML = `<div class="rec-title">Current Market Assessment</div><div class="rec-action">${result.action}</div><div class="human">${recText}</div>
    <div class="metrics"><div class="metric"><div class="k">Decision confidence</div><div class="v">${result.decisionConfidence}%</div></div><div class="metric"><div class="k">Data confidence</div><div class="v">${result.dataConfidence}%</div></div><div class="metric"><div class="k">Risk if you do nothing</div><div class="v ${riskClass}">${result.risk}</div></div><div class="metric"><div class="k">Sell pressure</div><div class="v">${result.sellPressure || 'N/A'}</div></div></div>`;
  const allocHtml=pplan.allocations.map(a=>`<div class="alloc-card"><div class="alloc-name">${a.name}</div><div class="alloc-pct">${Math.round(a.pct*100)}%</div><div>${fmt(a.dollars)}</div><div class="alloc-reason">${a.reason}${a.key!=='__cash' ? ` · Current ${fmt(a.price)} · Buy threshold ${fmt(a.buyThreshold)}` : ''}</div></div>`).join('');
  const lossHtml=(pplan.lossNotes||[]).length ? `<div class="warn" style="margin-top:12px"><strong>Loss protection:</strong><ul>${pplan.lossNotes.map(x=>`<li>${x}</li>`).join('')}</ul></div>` : '';
  const tradeHtml=pplan.trades.length ? `<h3 style="margin:16px 0 6px">Immediate trade plan (${pplan.trades.length} trade${pplan.trades.length===1?'':'s'})</h3><ul>${pplan.trades.map(t=>`<li><strong>${t.action}</strong> ${t.name}: about ${fmt(t.dollars)}${t.qty?` (~${t.qty.toLocaleString()} units)`:''}${t.atLoss?' <span class="bad">(realizes a loss)</span>':''}</li>`).join('')}</ul>` : '<div class="good" style="margin-top:12px"><strong>No immediate trades recommended.</strong></div>';
  const budgetHtml=`<div class="mini" style="margin-top:12px"><strong>Trade discipline:</strong> ${pplan.tradesRemaining} trades left today; advisor reserves ${pplan.tradeReserve}, leaving ${pplan.actionableTradeBudget} available for this plan.${pplan.overBudget?` ${pplan.deferredTrades.length} lower-priority trade(s) deferred.`:''}</div>`;
  const oppClass=pplan.meaningfulRebalance?'good':'warn';
  const opportunityHtml=`<div class="mini" style="margin-top:12px"><strong>Opportunity cost:</strong> <span class="${oppClass}">${pplan.opportunityCostDecision}</span><br>Projected current mix: ${fmt(pplan.projectedCurrent)}<br>Projected proposed mix: ${fmt(pplan.projectedPlan)}<br>Expected improvement: ${fmt(pplan.projectedImprovement)} (${pct(pplan.improvementPct)})<br>Trades required: ${pplan.trades.length}<br>Expected gain per trade: ${fmt(pplan.gainPerTrade)}<br>Minimum edge required: ${pct(pplan.requiredOverallPct)} overall and about ${fmt(pplan.requiredGainPerTrade)} per trade.</div>`;
  document.getElementById('portfolioPlan').innerHTML=`<div class="alloc-grid">${allocHtml}</div>${tradeHtml}${lossHtml}${budgetHtml}${opportunityHtml}<div class="mini" style="margin-top:12px">Maximum recommended allocation per commodity: 33%. Cash is intentional when fewer than three stocks meet their buy thresholds.</div>`;
  const pros=[]; const cons=[];
  if(result.positionAssessments?.length){
    pros.push(`Meaningful positions analyzed: ${result.positionAssessments.map(p=>`${p.option.name} (${pct(p.portfolioPct)})`).join(', ')}.`);
    pros.push('Holding the current mix costs 0 trades.');
  }
  if(result.best.key===result.currentOpt?.key) pros.push('Your current portfolio mix is ranked #1 right now.');
  if(bestAlt){
    const diff = bestAlt.expectedValue - (result.currentOpt?.expectedValue||result.currentValue);
    const diffPct = result.currentValue ? diff/result.currentValue : 0;
    cons.push(`Best buy/switch alternative: ${bestAlt.name}, expected difference ${fmt(diff)} (${pct(diffPct)} vs current portfolio).`);
    if(isValidMoney(bestAlt.buyThreshold)){
      const thresholdText = bestAlt.price <= bestAlt.buyThreshold*result.params.buyThresholdFactor ? 'inside' : 'above';
      cons.push(`${bestAlt.name} is ${thresholdText} its buy zone: current ${fmt(bestAlt.price)}, buy threshold ${fmt(bestAlt.buyThreshold)}.`);
    }
    if(bestAlt.tradesNeeded) cons.push(`Switching costs ${bestAlt.tradesNeeded} trades.`);
  }
  if(result.positionAssessments?.length===1 && result.currentOpt && result.currentOpt.avgBuy){
    pros.push(`${result.currentOpt.name} is up ${pct(result.currentProfitPct)} from your average buy.`);
    const remainingPerShare = Math.max(0, result.currentOpt.target - result.currentOpt.price);
    const remainingPortfolio = remainingPerShare * (result.currentOpt.heldQty || 0);
    if(result.currentOpt.inSellZone){
      pros.push(`${result.currentOpt.name} has reached its sell threshold of ${fmt(result.currentOpt.sellThreshold)}.`);
    } else if(isValidMoney(result.currentOpt.sellThreshold)){
      cons.push(`${result.currentOpt.name} is below its sell threshold: current ${fmt(result.currentOpt.price)} vs ${fmt(result.currentOpt.sellThreshold)}.`);
    }
    cons.push(`Waiting for the estimated target could add about ${fmt(remainingPortfolio)} (${pct(result.currentOpt.upsidePct)}) to this position, but that upside is not guaranteed.`);
    if(result.sellPressure && result.sellPressure!=='None') cons.push(`Sell pressure is ${result.sellPressure}: profit is strong, but remaining upside vs ceiling still matters.`);
  }
  if(result.action==='WAIT IN CASH'){
    pros.push('Cash is being treated as a valid position, not a failure to invest.');
    if(bestAlt) cons.push(`${bestAlt.name} is the best buy candidate, but its entry is not clean enough yet.`);
  } else if(result.chosen.type==='split'){
    pros.push(`Split reduces the risk of picking wrong between ${result.chosen.legA.name} and ${result.chosen.legB.name}.`);
    cons.push(`Split uses ${result.chosen.tradesNeeded} trades and may underperform if one commodity clearly wins.`);
  } else if(result.chosen.type==='cash'){
    pros.push('Selling to cash locks in the current portfolio value and preserves flexibility.');
    cons.push('Cash has no upside while you wait for a better entry.');
  } else if(result.chosen.pos>.75) {
    cons.push(`${result.chosen.name} is already high in its estimated range.`);
  } else {
    pros.push(`${result.chosen.name} still has room to its estimated target.`);
  }
  const activeEventSignals=result.commodityOptions.flatMap(o=>(o.eventSignal?.signals||[]).map(sig=>({...sig,commodity:o.name,effect:o.eventSignal.effect,confidence:o.eventSignal.confidence,adjustment:o.eventAdjustment}))).filter((x,i,a)=>a.findIndex(y=>y.name===x.name&&y.commodity===x.commodity)===i);
  const meaningfulEventSignals=activeEventSignals.filter(x=>x.confidence>=.45);
  if(meaningfulEventSignals.length){
    meaningfulEventSignals.slice(0,3).forEach(x=>{
      const eventDir=x.effect>=0?'bullish':'bearish';
      const eventMove=`${x.effect>=0?'up':'down'} ${(Math.abs(x.effect)*100).toFixed(1)}%`;
      const text=`${x.name} has historically been ${eventDir} for ${x.commodity} (${eventMove} average, ${x.n} observations).`;
      (x.effect>=0?pros:cons).push(text);
    });
  } else if(data.events.length){
    cons.push('Active events are being tracked, but there is not enough repeated history yet to assign a reliable bullish or bearish effect.');
  }
  if(result.decisionConfidence<65) cons.push('Confidence is limited because the top options are close.');
  document.getElementById('pros').innerHTML=pros.map(x=>`<li>${x}</li>`).join('');
  document.getElementById('cons').innerHTML=cons.map(x=>`<li>${x}</li>`).join('');
  const majorRows = result.positionAssessments?.length ? result.positionAssessments.map(p=>`<tr><th>${p.option.name}</th><td class="num">${fmt(p.value)} (${pct(p.portfolioPct)}) · ${p.sellPressure} sell pressure</td></tr>`).join('') : '';
  const dustNote = result.ignoredDust?.length ? `<tr><th>Minor holdings (&lt;${Math.round(result.majorThresholdPct*100)}%)</th><td class="num">${result.ignoredDust.map(h=>`${h.name}: ${fmt(h.value)} (${pct(result.currentValue?h.value/result.currentValue:0)})`).join('<br>')}</td></tr>` : '';
  document.getElementById('positionBox').innerHTML = `<table><tr><th>Portfolio</th><td class="num">${fmt(result.currentValue)}</td></tr><tr><th>Cash</th><td class="num">${fmt(data.cash)}</td></tr>${majorRows}${dustNote}<tr><th>Trades left</th><td class="num">${data.tradesRemaining ?? 'Unknown'}</td></tr><tr><th>Week ends in</th><td class="num">${data.timeRemaining || 'Unknown'}</td></tr></table>`;
  document.getElementById('eventsBox').innerHTML = data.events.length ? `<ul>${data.events.map(e=>{
    const n=normalizeEventName(e); const p=result.eventMemory?.profiles?.[n];
    const occurrenceCount=p?.occurrences||1;
    const rows=[];
    for(const [key,label] of COMMODITIES){
      let stat=null,window=null;
      for(const w of [360,180,720,60,1440]){ const x=p?.summary?.[w]?.[key]; if(x&&x.n>=1){stat=x;window=w;break;} }
      if(!stat) continue;
      const direction=Math.abs(stat.avg)<0.0005?'neutral':(stat.avg>0?'bullish':'bearish');
      const conf=stat.n>=5&&stat.consistency>=.75?'High':stat.n>=3&&stat.consistency>=.67?'Medium':'Low';
      const moveText=direction==='neutral'?'flat':`${direction==='bullish'?'up':'down'} ${(Math.abs(stat.avg)*100).toFixed(1)}%`;
      rows.push(`${label}: ${direction} — ${moveText} over ${window>=60?Math.round(window/60)+'h':window+'m'} (${stat.n} occurrence${stat.n===1?'':'s'}, ${conf.toLowerCase()} confidence)`);
    }
    const historyText=rows.length?rows.slice(0,4).join('<br>'):'Not enough completed event history yet. The advisor is recording prices at 15m, 1h, 3h, 6h, 12h, and 24h.';
    return `<li><strong>${e}</strong><br><span class="mini">Tracked occurrence count: ${occurrenceCount}.<br>${historyText}</span></li>`;
  }).join('')}</ul><div class="mini" style="margin-top:10px">Event effects only adjust scores and buy/sell thresholds after repeated, consistent observations. Unknown events reduce certainty rather than forcing a direction.</div>` : '<div class="mini">No events detected.</div>';
  const waiting=[];
  const currentExpected = result.currentOpt?.expectedValue || result.currentValue;
  const required = currentExpected * (1 + result.params.minImprovePct);
  result.options
    .filter(o=>!['portfolio','cash'].includes(o.type) && o.key!==result.currentOpt?.key)
    .slice(0,6)
    .forEach(o=>{
      // Break-even buy price where switching to this commodity would become worth reviewing.
      // Guard against invalid assumptions so failed calculations never display as $0.
      const trigger = (isValidMoney(result.currentValue) && isValidMoney(o.target) && isValidMoney(required))
        ? (result.currentValue * o.target / required)
        : NaN;
      const thresholdTrigger = isValidMoney(o.buyThreshold) ? o.buyThreshold : NaN;
      const usefulTrigger = isValidMoney(thresholdTrigger) && thresholdTrigger < o.price
        ? thresholdTrigger
        : trigger;
      if(isValidMoney(usefulTrigger) && usefulTrigger < o.price && usefulTrigger > o.min * 0.50){
        const reason = isValidMoney(thresholdTrigger) && usefulTrigger===thresholdTrigger ? 'reaches its buy threshold' : 'could become mathematically interesting';
        waiting.push(`${o.name} at or below ${fmt(usefulTrigger)} ${reason}.`);
      }
    });
  if(result.positionAssessments?.length===1 && result.currentOpt){
    const sellZone = result.currentOpt.sellThreshold || result.currentOpt.target * 0.9;
    if(isValidMoney(sellZone) && sellZone > result.currentOpt.price){
      waiting.push(`${result.currentOpt.name} at or above ${fmt(sellZone)} reaches its sell threshold.`);
    }
  }
  if(!waiting.length){
    waiting.push('No clear price triggers yet. Add estimated min/avg/max values or capture more snapshots.');
  }
  waiting.push('A new market event could change the assessment.');
  document.getElementById('waitingFor').innerHTML = `<ul>${waiting.slice(0,5).map(x=>`<li>${x}</li>`).join('')}</ul>`;
  document.getElementById('alternativesTable').innerHTML = `<tr><th>Rank</th><th>Option</th><th class="num">Current</th><th class="num">Target</th><th class="num">Expected portfolio</th><th class="num">Extra vs now</th><th class="num">Vs hold</th><th class="num">Trades</th><th class="num">Score</th></tr>` + result.options.map((o,i)=>{
    const isCurrent = o.key===result.currentOpt?.key || o.type==='portfolio';
    const vsHoldText = isCurrent ? '—' : fmt(o.vsHold);
    const vsHoldClass = isCurrent ? '' : (o.vsHold>=0?'good':'bad');
    const label = o.type==='cash' ? 'Sell to Cash / Wait' : (o.type==='split' ? 'Split Buy ' + o.legA.name + ' / ' + o.legB.name : (isCurrent?'Hold ':'Switch to ') + o.name);
    const currentCell = o.type==='cash' ? '—' : (o.type==='split' ? '50/50' : fmt(o.price));
    const targetCell = o.type==='cash' ? '—' : (o.type==='split' ? fmt(o.legA.target)+' / '+fmt(o.legB.target) : fmt(o.target));
    return `<tr class="${i===0?'rank1':''}"><td>${i+1}</td><td>${label}</td><td class="num">${currentCell}</td><td class="num">${targetCell}</td><td class="num">${fmt(o.expectedValue)}</td><td class="num ${o.extraVsNow>=0?'good':'bad'}">${fmt(o.extraVsNow)}</td><td class="num ${vsHoldClass}">${vsHoldText}</td><td class="num">${o.tradesNeeded}</td><td class="num">${Math.round(o.score)}</td></tr>`
  }).join('');
  document.getElementById('marketTable').innerHTML = `<tr><th>Commodity</th><th class="num">Current</th><th class="num">Buy Threshold</th><th>Entry Status</th><th class="num">Sell Threshold</th><th>Exit Status</th><th>Event Signal</th><th>Price Rarity</th><th class="num">Hist Low</th><th class="num">Hist Median</th><th class="num">Hist High</th><th class="num">Est Target</th><th class="num">Upside Left</th></tr>` + data.commodities.map(c=>{ const hist=c.history||[]; const o=result.options.find(x=>x.key===c.key); const inZone=!!o?.inManualBuyZone; const nearZone=!inZone && isValidMoney(o?.buyThreshold) && c.price <= o.buyThreshold*1.15; const status=inZone?'BUY ZONE':nearZone?'WATCH':'TOO HIGH'; const statusClass=inZone?'good':nearZone?'warn':'bad'; const sellReached=!!o?.inSellZone; const nearSell=!sellReached && isValidMoney(o?.sellThreshold) && c.price >= o.sellThreshold*0.92; const exitStatus=sellReached?'SELL ZONE':nearSell?'SELL REVIEW':'HOLD ZONE'; const exitClass=sellReached?'good':nearSell?'warn':''; const sorted=[...hist,c.price].sort((a,b)=>a-b); const percentile=sorted.length?sorted.filter(x=>x<=c.price).length/sorted.length:.5; const rarity=percentile<=.10?'Very Low':percentile<=.25?'Low':percentile>=.90?'Very High':percentile>=.75?'High':'Typical'; const es=o?.eventSignal; const eventText=es&&es.confidence>=.45?`${es.effect>=0?'Bullish':'Bearish'} ${pct(Math.abs(es.effect))}<br><span class="mini">${Math.round(es.confidence*100)}% evidence confidence</span>`:(data.events.length?'Learning':'None'); const eventClass=es&&es.confidence>=.45?(es.effect>=0?'good':'bad'):''; return `<tr><td>${c.name}</td><td class="num">${fmt(c.price)}</td><td class="num">${fmt(o?.buyThreshold)}</td><td class="${statusClass}"><strong>${status}</strong></td><td class="num">${fmt(o?.sellThreshold)}</td><td class="${exitClass}"><strong>${exitStatus}</strong></td><td class="${eventClass}"><strong>${eventText}</strong></td><td><strong>${rarity}</strong> (${Math.round(percentile*100)}th pct)</td><td class="num">${fmt(Math.min(...hist,c.price))}</td><td class="num">${fmt(quantile(hist,.5)||c.price)}</td><td class="num">${fmt(Math.max(...hist,c.price))}</td><td class="num">${fmt(o?.target)}</td><td class="num ${o?.upsidePct>=0?'good':'bad'}">${pct(o?.upsidePct||0)}</td></tr>`; }).join('');
  document.getElementById('debug').textContent = JSON.stringify({data,result},null,2);
}


const ADVISOR_ALIASES = {
  counterfeit_bills:['counterfeit bills','counterfeit bill','counterfeit cash','fake cash','fake money','bills','counterfeit'],
  stolen_electronics:['stolen electronics','electronics','electronic'],
  prescription_pills:['prescription pills','prescription pill','pills','pill'],
  uncut_cocaine:['uncut cocaine','cocaine','coke'],
  military_hardware:['military hardware','military','hardware'],
  exotic_animals:['exotic animals','exotic animal','animals','animal'],
  enriched_uranium:['enriched uranium','uranium'],
  stolen_art:['stolen art','stolen arts','arts','art']
};
let advisorLastEntity = null;
function normalizeQuestion(q){
  return String(q||'').toLowerCase().replace(/[’']/g,"'").replace(/[^a-z0-9%$?.!\s-]/g,' ').replace(/\s+/g,' ').trim();
}
function findQuestionEntities(q){
  const n=normalizeQuestion(q); const hits=[];
  for(const [key,aliases] of Object.entries(ADVISOR_ALIASES)){
    const hit=aliases.find(a=>n.includes(a));
    if(hit) hits.push({key,name:nameFor(key),alias:hit});
  }
  return hits;
}
function optionForKey(result,key){ return result?.commodityOptions?.find(o=>o.key===key) || result?.options?.find(o=>o.key===key); }
function pricePercentile(o){
  const arr=[...(o?.history||[]),Number(o?.price||0)].filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b);
  if(!arr.length) return .5;
  return arr.filter(x=>x<=o.price).length/arr.length;
}
function recentTrend(o,points=4){
  const h=(o?.history||[]).filter(x=>Number.isFinite(x)&&x>0);
  if(h.length<2) return {pct:0,label:'insufficient history'};
  const end=Number(o.price||h[h.length-1]); const start=h[Math.max(0,h.length-points)];
  const p=start?end/start-1:0;
  return {pct:p,label:p>.03?'rising':p<-.03?'falling':'mostly flat'};
}
function entryLabel(o){
  if(!o) return 'unknown';
  if(o.inManualBuyZone) return 'inside its buy zone';
  if(isValidMoney(o.buyThreshold) && o.price<=o.buyThreshold*1.15) return 'near its buy zone';
  return 'above its buy zone';
}
function exitLabel(o){
  if(!o) return 'unknown';
  if(o.inSellZone) return 'inside its sell zone';
  if(isValidMoney(o.sellThreshold) && o.price>=o.sellThreshold*.92) return 'near its sell-review zone';
  return 'below its sell-review zone';
}
function rankOfOption(result,key){
  const rows=(result?.commodityOptions||[]).slice().sort((a,b)=>b.score-a.score);
  const i=rows.findIndex(o=>o.key===key); return i<0?null:i+1;
}
function capAnswer(result){
  const bad=(result?.portfolioPlan?.allocations||[]).filter(a=>a.key!=='__cash' && a.pct>.33001);
  if(bad.length) return {title:'You found an allocation bug.',body:`The 33% limit is hard. ${bad.map(a=>`${a.name} is shown at ${Math.round(a.pct*100)}%`).join(', ')}. Anything above 33% should be reduced to 33%, with the remainder kept as cash or assigned to another qualifying commodity.`,evidence:'The optimizer should never allocate more than 33.0% to one commodity.'};
  return {title:'The current plan respects the 33% cap.',body:'No commodity in the recommended allocation is above 33%. A displayed 34% should only be cash—the leftover created because three 33% positions total 99%.',evidence:'Commodity cap: 33%; cash is not a commodity and may hold the remaining 1% or more.'};
}
function explainCommodity(o,result,q){
  const trend=recentTrend(o); const perc=pricePercentile(o); const rank=rankOfOption(result,o.key);
  const upside=o.target&&o.price?o.target/o.price-1:0;
  const expectedAtTarget=result?.currentValue && o.price ? result.currentValue*(o.target/o.price) : 0;
  const event=o.eventSignal;
  const eventText=event?.confidence>=.45 ? ` Event history currently reads ${event.effect>=0?'bullish':'bearish'} (${pct(Math.abs(event.effect))}) with ${Math.round(event.confidence*100)}% evidence confidence.` : ' Event direction is still being learned and is not driving the recommendation strongly.';
  const whyBuy = /(why|really|for real|worth|invest|buy|going in|go in)/.test(q);
  const falling = /(trend|trending|fall|falling|down|dropping|drop more|lower)/.test(q);
  const worst = /(worst|weak|yield|return|underperform)/.test(q);
  let title=`Assessment: ${o.name}`;
  let body='';
  if(worst){
    body=`Past yield alone is not the reason to buy it. The advisor is evaluating the entry now: ${o.name} is ${entryLabel(o)}, ranks #${rank||'—'} by the current model, and has ${pct(upside)} upside to the estimated target. A historically weak commodity should only receive allocation after stronger qualifying opportunities reach the 33% cap—or if its current entry is unusually cheap.`;
  } else if(falling){
    body=`Your concern is valid. ${o.name} is ${trend.label} over the latest captured points (${pct(trend.pct)}), and the current price is around the ${Math.round(perc*100)}th percentile of saved history. ${entryLabel(o)}. The advisor should not buy merely because the target is high; the entry threshold, event signal, and trade cost must still justify it.${whyBuy && !o.inManualBuyZone?' At this price I would treat it as a watch, not an automatic buy.':''}`;
  } else {
    body=`The case is based on the current entry, not a promise about the next tick. ${o.name} is ${entryLabel(o)}, at ${fmt(o.price)} versus a buy threshold of ${fmt(o.buyThreshold)}, and has an estimated target of ${fmt(o.target)} (${pct(upside)} upside). It ranks #${rank||'—'} among commodities. ${expectedAtTarget?`If the whole current portfolio were hypothetically exposed at this price, the target-equivalent value would be about ${fmt(expectedAtTarget)}—but the 33% rule limits the actual allocation.`:''}`;
  }
  const evidence=`Current ${fmt(o.price)} · Buy threshold ${fmt(o.buyThreshold)} · Sell threshold ${fmt(o.sellThreshold)} · Historical percentile ${Math.round(perc*100)}th · Recent trend ${trend.label} ${pct(trend.pct)}.${eventText}`;
  return {title,body,evidence};
}
function compareCommodities(a,b,result){
  const ra=rankOfOption(result,a.key), rb=rankOfOption(result,b.key);
  const au=a.target/a.price-1, bu=b.target/b.price-1;
  const aZone=entryLabel(a), bZone=entryLabel(b);
  const better=(a.score>=b.score?a:b), other=better===a?b:a;
  return {title:`${a.name} vs ${b.name}`,body:`Right now the model prefers ${better.name}, but the reason matters: ${a.name} is ${aZone} with ${pct(au)} target upside and ranks #${ra}; ${b.name} is ${bZone} with ${pct(bu)} target upside and ranks #${rb}. The stronger choice is not automatically the one with the larger theoretical target—it should also have the cleaner entry, stronger evidence, and enough expected edge to justify the trades.`,evidence:`Scores: ${a.name} ${Math.round(a.score)}, ${b.name} ${Math.round(b.score)}. Current prices: ${fmt(a.price)} vs ${fmt(b.price)}.`};
}
function matchActiveEventFromQuestion(q,result,data){
  const active=(result?.eventMemory?.rawEvents||[]).map(e=>({name:e.name,raw:e.raw,ageMinutes:e.ageMinutes||0}));
  if(!active.length) return null;
  const words=x=>normalizeQuestion(x).split(/\s+/).filter(w=>w.length>=4 && !['event','ago','hits','street','streets','affected'].includes(w));
  let best=null,bestScore=0;
  for(const ev of active){
    const score=words(ev.name).filter(w=>q.includes(w)).length;
    if(score>bestScore){best=ev;bestScore=score;}
  }
  return bestScore?best:active[0];
}
function latestActiveOccurrence(result,eventName){
  return [...(result?.eventMemory?.profiles?.[eventName]?result.eventMemory.occurrences||[]:[])];
}
function closestEventStat(profile,key,ageMinutes){
  if(!profile) return null;
  const windows=[15,60,180,360,720,1440];
  const eligible=windows.filter(w=>w<=Math.max(15,ageMinutes||0)).sort((a,b)=>b-a);
  for(const w of [...eligible,...windows.filter(w=>!eligible.includes(w))]){
    const x=profile.summary?.[w]?.[key];
    if(x) return {...x,window:w};
  }
  return null;
}
function eventVersusWaitAnswer(q,entities,result,data){
  const ev=matchActiveEventFromQuestion(q,result,data);
  const o=entities.length ? optionForKey(result,entities[0].key) : null;
  if(!ev || !o) return null;
  const profile=result.eventMemory?.profiles?.[ev.name];
  const stat=closestEventStat(profile,o.key,ev.ageMinutes);
  const trend=recentTrend(o,5);
  const normalThreshold=o.baseBuyThreshold||o.buyThreshold;
  const adjustedThreshold=o.buyThreshold;
  const affected=eventTargetKey(ev.name)===o.key || new RegExp(o.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i').test(ev.name);
  const reliableBearish=!!(stat && stat.n>=2 && stat.avg<-.02 && stat.consistency>=.65);
  const reliableBullish=!!(stat && stat.n>=2 && stat.avg>.02 && stat.consistency>=.65);
  const stillFalling=trend.pct<-.03;
  const insideNormal=o.price<=normalThreshold;
  const insideAdjusted=o.price<=adjustedThreshold;
  const unaffected=(result.commodityOptions||[]).filter(x=>x.key!==o.key && x.inManualBuyZone && !(x.eventSignal?.confidence>=.45 && x.eventSignal.effect<0)).sort((a,b)=>b.score-a.score);
  const alt=unaffected[0];
  let verdict,reason;
  if(reliableBearish && (!insideAdjusted || stillFalling)){
    verdict='Wait or buy only a partial allocation.';
    reason=`The event has a repeatable bearish record for ${o.name}, and ${stillFalling?'the latest captured movement is still falling':'the event-adjusted entry has not become compelling enough'}. Reaching the normal buy threshold alone is not sufficient during a persistent negative event.`;
  } else if(!stat || stat.n<2){
    verdict=insideAdjusted && !stillFalling?'A cautious partial buy is defensible.':'Wait for more event evidence.';
    reason=`This event does not yet have enough independent occurrences to estimate its full effect reliably. ${stillFalling?'The price is still moving down, so waiting avoids trying to catch a falling market.':'The current entry is attractive, but uncertainty remains high.'}`;
  } else if(reliableBullish){
    verdict=insideAdjusted?'Buying now is supported by both price and event history.':'Watch rather than chase.';
    reason=`The event history has been bullish for ${o.name}, but the buy threshold still controls whether the entry is clean.`;
  } else {
    verdict=insideAdjusted?'Buy zone reached, but use normal trade discipline.':'Wait for the event-adjusted threshold.';
    reason='The event effect is mixed or weak, so it should not override the normal entry rules.';
  }
  const altText=alt?` The strongest currently qualifying alternative without a meaningful bearish event signal is ${alt.name} at ${fmt(alt.price)}.`:' No clearly superior unaffected commodity is currently inside its buy zone.';
  const age=ev.ageMinutes>=1440?`${(ev.ageMinutes/1440).toFixed(1)} days`:ev.ageMinutes>=60?`${(ev.ageMinutes/60).toFixed(ev.ageMinutes%60?1:0)} hours`:`${ev.ageMinutes} minutes`;
  const historical=stat?`${stat.avg>=0?'+' : ''}${pct(stat.avg)} over ${stat.window>=60?Math.round(stat.window/60)+'h':stat.window+'m'} across ${stat.n} occurrence${stat.n===1?'':'s'} (${Math.round(stat.consistency*100)}% directional consistency)`:'not enough completed history';
  return {
    title:`${o.name}: buy now or wait for “${ev.name}”?`,
    body:`<strong>${verdict}</strong> ${reason}${altText}`,
    evidence:`Event age ${age} · Current ${fmt(o.price)} · Normal buy threshold ${fmt(normalThreshold)} · Event-adjusted threshold ${fmt(adjustedThreshold)} · Recent movement ${pct(trend.pct)} · Event history ${historical}${affected?' · Event explicitly targets this commodity':''}.`
  };
}

function eventDirectionQuestionAnswer(q,entities,result,data){
  const ev=matchActiveEventFromQuestion(q,result,data);
  const o=entities.length ? optionForKey(result,entities[0].key) : null;
  if(!ev || !o) return null;
  const profile=result.eventMemory?.profiles?.[ev.name];
  const stat=closestEventStat(profile,o.key,ev.ageMinutes);
  if(!stat) return {
    title:`${o.name}: event direction is not known yet`,
    body:`The advisor found “${ev.name}”, but it does not yet have a completed observation window for ${o.name}. It should not label the event bullish or bearish until a measurable price change exists.`,
    evidence:`Event age ${ev.ageMinutes} minutes · Current ${fmt(o.price)}.`
  };
  const move=stat.avg;
  const direction=move>0.002?'bullish':move<-.002?'bearish':'neutral';
  const plain=move>0.002?`rose ${pct(Math.abs(move))}`:move<-.002?`fell ${pct(Math.abs(move))}`:'was essentially flat';
  const asksMismatch=/showing|positive|negative|decreas|drop|fell|rose|bullish|bearish|sign|wrong/.test(q);
  let body=`Across the tracked ${stat.window>=60?Math.round(stat.window/60)+'-hour':stat.window+'-minute'} window, ${o.name} ${plain}. That makes the measured event effect <strong>${direction}</strong>.`;
  if(asksMismatch) body+=` If the card shows a positive number beside “bearish,” that is a display/sign mismatch; the direction should follow the actual signed move, not the absolute value.`;
  return {
    title:`${o.name} during “${ev.name}”`,
    body,
    evidence:`Signed change ${move>=0?'+':''}${pct(move)} · ${stat.n} tracked occurrence${stat.n===1?'':'s'} · ${Math.round(stat.consistency*100)}% directional consistency.`
  };
}

function askAdvisor(question){
  if(!lastData || !lastResult) return {title:'Analyze the market first.',body:'Load a current Black Market snapshot before asking a data-based question.',evidence:''};
  const q=normalizeQuestion(question);
  if(!q) return {title:'Ask me something about the current assessment.',body:'For example: “Why Pills?”, “Could Art drop more?”, or “Is this worth the trades?”',evidence:''};
  let entities=findQuestionEntities(q);
  if(!entities.length && advisorLastEntity) entities=[{key:advisorLastEntity,name:nameFor(advisorLastEntity)}];
  if(entities.length) advisorLastEntity=entities[0].key;
  if(/largest|biggest|record|highest.*change|most.*change|largest.*percent|biggest.*percent|ever.*drop|ever.*rise/.test(q)){
    const moveAns=moveRecordAnswer(q,entities,lastData);
    if(moveAns) return moveAns;
  }
  if(/33%|33 percent|thirty three|over the cap|max is 33|maximum.*33/.test(q)) return capAnswer(lastResult);
  if(/worth.*trade|trade.*worth|too many trade|trades left|opportunity cost|wasting.*trade/.test(q)){
    const p=lastResult.portfolioPlan;
    return {title:p.opportunityCostDecision,body:`The proposed plan uses ${p.trades.length} trade${p.trades.length===1?'':'s'} with ${p.tradesRemaining} left today and reserves ${p.tradeReserve}. The projected improvement is ${fmt(p.projectedImprovement)} (${pct(p.improvementPct)}), or about ${fmt(p.gainPerTrade)} per trade. ${p.meaningfulRebalance?'That clears the advisor’s opportunity-cost test.':'That does not clear the advisor’s opportunity-cost test, so waiting is preferred.'}`,evidence:`Minimum edge: ${pct(p.requiredOverallPct)} overall and ${fmt(p.requiredGainPerTrade)} per trade.`};
  }
  if(/cash|do nothing|wait|stay out|owning nothing/.test(q) && !entities.length){
    const qualifying=lastResult.commodityOptions.filter(o=>o.inManualBuyZone).sort((a,b)=>b.score-a.score);
    return {title:qualifying.length?'Cash is optional, not a failure state.':'Wait in cash is valid.',body:qualifying.length?`${qualifying.length} commodities are currently inside their buy zones. The best is ${qualifying[0].name}, but cash should remain allocated wherever no clean opportunity exists or where another trade would not clear the opportunity-cost threshold.`:'No commodity currently qualifies strongly enough to force a purchase. The advisor should preserve cash until a buy threshold is reached.',evidence:`Cash ${fmt(lastData.cash)} · Clean buy-zone candidates: ${qualifying.map(o=>o.name).join(', ')||'none'}.`};
  }
  if(/event|news|customs|crackdown|raid|supplier|heist|glut|keep dropping|continue to drop|full extent|unaffected|no events|buy now or wait/.test(q)){
    if(/showing|positive|negative|decreas|drop|fell|rose|bullish|bearish|sign|wrong/.test(q)){
      const directionAnswer=eventDirectionQuestionAnswer(q,entities,lastResult,lastData);
      if(directionAnswer) return directionAnswer;
    }
    const nuanced=eventVersusWaitAnswer(q,entities,lastResult,lastData);
    if(nuanced) return nuanced;
    const active=lastData.events||[];
    return {title:'Event assessment',body:active.length?`Active events: ${active.join('; ')}. Name a commodity and ask whether to buy now, wait for the event to develop, or choose an unaffected alternative. The advisor will compare the normal threshold, event-adjusted threshold, event age, current movement, repeated event history, and qualifying unaffected alternatives.`:'No active events were detected in the current snapshot.',evidence:`Tracked event profiles: ${Object.keys(lastResult.eventMemory?.profiles||{}).length}.`};
  }
  if(entities.length>=2){
    const a=optionForKey(lastResult,entities[0].key),b=optionForKey(lastResult,entities[1].key);
    if(a&&b) return compareCommodities(a,b,lastResult);
  }
  if(entities.length){
    const o=optionForKey(lastResult,entities[0].key);
    if(o) return explainCommodity(o,lastResult,q);
  }
  if(/why|recommend|suggest|plan|portfolio/.test(q)){
    const p=lastResult.portfolioPlan;
    return {title:`Why the advisor says “${lastResult.action}”`,body:`The plan is built from qualifying buy zones, the 33% cap, current holdings, realized-loss protection, active event evidence, and limited trades. It projects ${fmt(p.projectedPlan)} for the proposed mix versus ${fmt(p.projectedCurrent)} for the current mix, a difference of ${fmt(p.projectedImprovement)} (${pct(p.improvementPct)}).`,evidence:`Decision confidence ${lastResult.decisionConfidence}% · Data confidence ${lastResult.dataConfidence}% · Risk ${lastResult.risk}.`};
  }
  return {title:'Here is what the data can answer.',body:'I could not confidently identify the exact intent, but you can ask about a commodity by nickname, compare two commodities, challenge the 33% allocation, ask whether a switch is worth the trades, question a falling trend, or ask why cash is being held. Try naming the commodity or the specific concern.',evidence:'Examples: “Why pills?”, “Art vs Uranium?”, “Is this worth two trades?”, “Why not cash?”, “Uranium is falling—still buy?”'};
}
function renderMoveRecords(data){
  const table=document.getElementById('moveRecordsTable');
  if(!table) return;
  const rows=allMoveRecords(data);
  table.innerHTML=`<tr><th>Commodity</th><th class="num">Largest Rise</th><th>From → To</th><th class="num">Largest Fall</th><th>From → To</th><th class="num">Points</th></tr>`+rows.map(r=>`<tr><td>${r.name}</td><td class="num good">${r.maxRise?pct(r.maxRise.change):'—'}</td><td>${r.maxRise?`${fmt(r.maxRise.from)} → ${fmt(r.maxRise.to)}`:'—'}</td><td class="num bad">${r.maxFall?pct(r.maxFall.change):'—'}</td><td>${r.maxFall?`${fmt(r.maxFall.from)} → ${fmt(r.maxFall.to)}`:'—'}</td><td class="num">${r.points}</td></tr>`).join('');
  const rises=rows.filter(r=>r.maxRise).sort((a,b)=>b.maxRise.change-a.maxRise.change);
  const falls=rows.filter(r=>r.maxFall).sort((a,b)=>a.maxFall.change-b.maxFall.change);
  const box=document.getElementById('overallMoveRecords');
  if(box) box.innerHTML=`<strong>Overall record rise:</strong> ${rises[0]?`${rises[0].name} ${pct(rises[0].maxRise.change)} (${fmt(rises[0].maxRise.from)} → ${fmt(rises[0].maxRise.to)})`:'—'} &nbsp; · &nbsp; <strong>Overall record fall:</strong> ${falls[0]?`${falls[0].name} ${pct(falls[0].maxFall.change)} (${fmt(falls[0].maxFall.from)} → ${fmt(falls[0].maxFall.to)})`:'—'}`;
}
function moveRecordAnswer(q,entities,data){
  const records=allMoveRecords(data);
  const wantsRise=/rise|gain|increase|jump|spike|up|winner/.test(q);
  const wantsFall=/fall|drop|decrease|crash|down|loss/.test(q);
  let pool=records;
  if(entities?.length) pool=records.filter(r=>entities.some(e=>e.key===r.key));
  if(!pool.length) return null;
  if(wantsFall && !wantsRise){
    const r=pool.filter(x=>x.maxFall).sort((a,b)=>a.maxFall.change-b.maxFall.change)[0];
    if(!r) return null;
    return {title:`Largest observed drop: ${r.name}`,body:`The largest consecutive saved-point decline is ${pct(r.maxFall.change)}, from ${fmt(r.maxFall.from)} to ${fmt(r.maxFall.to)}.`,evidence:`Based on ${r.points} stored price points. This is an observed interval record, not a prediction.`};
  }
  if(wantsRise && !wantsFall){
    const r=pool.filter(x=>x.maxRise).sort((a,b)=>b.maxRise.change-a.maxRise.change)[0];
    if(!r) return null;
    return {title:`Largest observed rise: ${r.name}`,body:`The largest consecutive saved-point increase is ${pct(r.maxRise.change)}, from ${fmt(r.maxRise.from)} to ${fmt(r.maxRise.to)}.`,evidence:`Based on ${r.points} stored price points. This is an observed interval record, not a prediction.`};
  }
  const up=pool.filter(x=>x.maxRise).sort((a,b)=>b.maxRise.change-a.maxRise.change)[0];
  const down=pool.filter(x=>x.maxFall).sort((a,b)=>a.maxFall.change-b.maxFall.change)[0];
  const label=entities?.length?entities[0].name:'the stored market';
  return {title:`Largest observed moves for ${label}`,body:`Largest rise: ${up?`${pct(up.maxRise.change)} (${fmt(up.maxRise.from)} → ${fmt(up.maxRise.to)})`:'not enough data'}. Largest fall: ${down?`${pct(down.maxFall.change)} (${fmt(down.maxFall.from)} → ${fmt(down.maxFall.to)})`:'not enough data'}.`,evidence:`Consecutive saved market points; ${Math.max(...pool.map(x=>x.points),0)} points available.`};
}

function renderAdvisorAnswer(ans){
  const box=document.getElementById('advisorAnswer');
  if(!box) return;
  box.classList.remove('hidden');
  box.innerHTML=`<div class="answer-title">${ans.title}</div><div>${ans.body}</div>${ans.evidence?`<div class="advisor-evidence"><strong>Data behind the answer:</strong> ${ans.evidence}</div>`:''}`;
}
function submitAdvisorQuestion(text){
  const q=(text ?? (document.getElementById('advisorQuestion')?.value || '')).trim();
  if(document.getElementById('advisorQuestion')) document.getElementById('advisorQuestion').value=q;
  renderAdvisorAnswer(askAdvisor(q));
}

function analyzeHtml(html, sourceLabel=''){
  const err=document.getElementById('error');
  err.classList.add('hidden');
  try{
    if(!html || !html.trim()) throw new Error('Paste the page HTML first.');
    document.getElementById('htmlInput').value = html;
    const data=parseBlackMarket(html);
    if(!data.commodities.length) throw new Error('No commodity cards found. Make sure this is the Black Market page HTML.');
    const memoryStats = updateMarketMemory(data);
    renderAssumptions(data);
    const result=analyze(data);
    render(data,result);
    renderMoveRecords(data);
    lastData=data;
    lastResult=result;
    document.getElementById('results').classList.remove('hidden');
    document.getElementById('saveSnapshotBtn').disabled=false;
    document.getElementById('parseStatus').textContent=`Parsed ${data.commodities.length} commodities${sourceLabel ? ' from '+sourceLabel : ''}. Memory: ${memoryStats.totalPoints.toLocaleString()} price points (${memoryStats.totalAdded} new).`;
  }
  catch(e){ err.textContent=e.message; err.classList.remove('hidden'); }
}

function refreshBookmarklet(){
  const url=(document.getElementById('advisorUrl')?.value || location.href.split('#')[0]).trim();
  const js = `javascript:(()=>{const u=${JSON.stringify(url)};const html=document.documentElement.outerHTML;const w=window.open(u,'_blank');let n=0;const send=()=>{try{w.postMessage({type:'BM_ADVISOR_CAPTURE',html,source:location.href,capturedAt:new Date().toISOString()},'*')}catch(e){}if(++n<24)setTimeout(send,500)};setTimeout(send,800);})();`;
  const link=document.getElementById('bookmarkletLink');
  const box=document.getElementById('bookmarkletCode');
  if(link) link.href=js;
  if(box) box.textContent=js;
}

function tryImportFromBookmarklet(){
  window.addEventListener('message', (event)=>{
    const payload=event.data;
    if(!payload || payload.type!=='BM_ADVISOR_CAPTURE' || !payload.html) return;
    analyzeHtml(payload.html, 'game page');
    try{ window.focus(); }catch(e){}
  });
}

let lastData=null, lastResult=null;
document.getElementById('analyzeBtn').onclick=()=>{
  analyzeHtml(document.getElementById('htmlInput').value.trim());
};
document.getElementById('mode').onchange=()=>{ if(lastData){ lastResult=analyze(lastData); render(lastData,lastResult); } };
document.getElementById('allocationMode').onchange=()=>{ if(lastData){ lastResult=analyze(lastData); render(lastData,lastResult); } };
document.getElementById('clearBtn').onclick=()=>{ document.getElementById('htmlInput').value=''; document.getElementById('results').classList.add('hidden'); document.getElementById('parseStatus').textContent=''; };
document.getElementById('resetAssumptionsBtn').onclick=()=>{ localStorage.removeItem('bm_assumptions'); renderAssumptions(lastData); if(lastData){ lastResult=analyze(lastData); render(lastData,lastResult); } };
document.getElementById('resetMemoryBtn').onclick=()=>{ resetMarketMemory(); if(lastData){ lastData=parseBlackMarket(document.getElementById('htmlInput').value.trim()); updateMarketMemory(lastData); renderAssumptions(lastData); lastResult=analyze(lastData); render(lastData,lastResult); } document.getElementById('parseStatus').textContent='Price memory reset.'; };
document.getElementById('resetEventMemoryBtn').onclick=()=>{ localStorage.removeItem('bm_event_memory_v4'); if(lastData){ lastResult=analyze(lastData); render(lastData,lastResult); } document.getElementById('parseStatus').textContent='Event memory reset.'; };
const askBtn=document.getElementById('askAdvisorBtn'); if(askBtn) askBtn.onclick=()=>submitAdvisorQuestion();
const qBox=document.getElementById('advisorQuestion'); if(qBox) qBox.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter') submitAdvisorQuestion();});
document.querySelectorAll('.advisor-chip').forEach(b=>b.addEventListener('click',()=>submitAdvisorQuestion(b.textContent)));
document.getElementById('saveSnapshotBtn').onclick=()=>{ if(!lastData) return; const snaps=JSON.parse(localStorage.getItem('bm_snapshots')||'[]'); snaps.push({data:lastData,result:lastResult}); localStorage.setItem('bm_snapshots',JSON.stringify(snaps)); document.getElementById('parseStatus').textContent=`Snapshot saved locally (${snaps.length}).`; };
document.getElementById('advisorUrl').value=location.href.split('#')[0];
document.getElementById('advisorUrl').addEventListener('input',refreshBookmarklet);
document.getElementById('copyBookmarkletBtn').onclick=async()=>{
  refreshBookmarklet();
  const code=document.getElementById('bookmarkletCode').textContent;
  try{ await navigator.clipboard.writeText(code); document.getElementById('parseStatus').textContent='Bookmarklet copied.'; }
  catch(e){ document.getElementById('parseStatus').textContent='Could not copy automatically. Open “Show bookmarklet code” and copy it manually.'; }
};
refreshBookmarklet();
renderAssumptions(null);
tryImportFromBookmarklet();