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

function loadRecommendationHistory() {
  try {
    return JSON.parse(
      localStorage.getItem('bm_recommendation_history_v1') || '[]'
    );
  } catch (error) {
    return [];
  }
}

function saveRecommendationHistory(data, result) {
  if (!data || !result) return [];

  const history = loadRecommendationHistory();

  const entry = {
    id: `${data.parsedAt || Date.now()}|${result.action}`,
    capturedAt: data.parsedAt || new Date().toISOString(),
    action: result.action || 'Unknown',
    confidence: result.decisionConfidence ?? null,
    dataConfidence: result.dataConfidence ?? null,
    risk: result.risk || null,
    portfolioValue: result.currentValue || data.totalPortfolio || 0,
    projectedImprovement:
      result.portfolioPlan?.projectedImprovement || 0,
    improvementPct:
      result.portfolioPlan?.improvementPct || 0,
    selectedCommodities:
      result.portfolioPlan?.selected?.map(item => item.name) || [],
      selectedCommodityKeys:
  result.portfolioPlan?.selected?.map(item => item.key) || [],
    tradesRequired:
  result.portfolioPlan?.trades?.length || 0,

startPrices: Object.fromEntries(
  (data.commodities || []).map(item => [
    item.key,
    Number(item.price) || 0
  ])
)
  };

  const latest = history[0];

const sameAction =
  latest?.action === entry.action;

const sameSelected =
  JSON.stringify(latest?.selectedCommodityKeys || []) ===
  JSON.stringify(entry.selectedCommodityKeys || []);

const sameTrades =
  latest?.tradesRequired === entry.tradesRequired;

const sameImprovement =
  Math.abs(
    (latest?.improvementPct || 0) -
    (entry.improvementPct || 0)
  ) < 0.01;

const sameConfidence =
  Math.abs(
    (latest?.confidence || 0) -
    (entry.confidence || 0)
  ) < 3;

const minutesSinceLatest = latest
  ? (
      new Date(entry.capturedAt).getTime() -
      new Date(latest.capturedAt).getTime()
    ) / 60000
  : Infinity;

const isNearDuplicate =
  latest &&
  sameAction &&
  sameSelected &&
  sameTrades &&
  sameImprovement &&
  sameConfidence &&
  minutesSinceLatest < 30;

if (!isNearDuplicate && !history.some(item => item.id === entry.id)) {
  history.unshift(entry);
}

  const trimmedHistory = history.slice(0, 500);

  localStorage.setItem(
    'bm_recommendation_history_v1',
    JSON.stringify(trimmedHistory)
  );

  return trimmedHistory;
}

function clearRecommendationHistory() {
  localStorage.removeItem('bm_recommendation_history_v1');
}

function updateRecommendationOutcomes(data) {
  if (!data?.commodities?.length) return [];

  const history = loadRecommendationHistory();
  const now = new Date(data.parsedAt || Date.now()).getTime();

  const currentPrices = Object.fromEntries(
    data.commodities.map(item => [item.key, Number(item.price) || 0])
  );

  history.forEach(entry => {
    if (!entry.startPrices || entry.outcomeStatus === 'final') return;

    const ageMinutes =
      (now - new Date(entry.capturedAt).getTime()) / 60000;

    if (ageMinutes < 30) {
      entry.outcome = 'Pending';
      entry.outcomeStatus = 'pending';
      return;
    }

    const selectedKeys = (entry.selectedCommodityKeys || []).length
  ? entry.selectedCommodityKeys
  : Object.keys(entry.startPrices || {});

const changes = selectedKeys
  .map(key => {
    const startPrice = entry.startPrices?.[key];
    const currentPrice = currentPrices[key];

    if (!(startPrice > 0 && currentPrice > 0)) return null;

    return (currentPrice - startPrice) / startPrice;
  })
  .filter(value => Number.isFinite(value));

    if (!changes.length) return;

    const averageChange =
      changes.reduce((sum, value) => sum + value, 0) /
      changes.length;

    entry.actualChangePct = averageChange;
    entry.lastEvaluatedAt = data.parsedAt || new Date().toISOString();

    if (averageChange >= 0.02) {
      entry.outcome = 'Successful';
      entry.outcomeStatus = 'final';
    } else if (averageChange <= -0.02) {
      entry.outcome = 'Unsuccessful';
      entry.outcomeStatus = 'final';
    } else {
      entry.outcome = 'Still developing';
      entry.outcomeStatus = 'pending';
    }
  });

  localStorage.setItem(
    'bm_recommendation_history_v1',
    JSON.stringify(history)
  );

  return history;
}