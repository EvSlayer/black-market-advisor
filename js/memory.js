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
    const entry = mem.commodities[c.key] || {name:c.name, prices:[], captures:0, lastPrice:null};
    const incoming = (c.history && c.history.length) ? c.history : [c.price];
    const merged = mergePriceSeries(entry.prices, incoming);
    entry.name = c.name;
    entry.prices = merged.series;
    entry.lastPrice = c.price;
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
  const points = Object.values(mem.commodities).reduce((s,e)=>s+(e.prices?.length||0),0);
  data.memoryStats = {totalAdded, totalPoints:points, captures:mem.captures.length};
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

