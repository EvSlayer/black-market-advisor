window.BM_QA_VERSION='v10-dropdown-ranking';
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
  const n=normalizeQuestion(q);
  const hits=[];

  for(const [key,aliases] of Object.entries(ADVISOR_ALIASES)){
    let best=null;
    for(const alias of aliases){
      const index=n.indexOf(alias);
      if(index<0) continue;
      if(!best || index<best.index || (index===best.index && alias.length>best.alias.length)){
        best={alias,index};
      }
    }
    if(best) hits.push({key,name:nameFor(key),alias:best.alias,index:best.index});
  }

  return hits.sort((a,b)=>a.index-b.index);
}
function optionForKey(result,key){ return result?.commodityOptions?.find(o=>o.key===key) || result?.options?.find(o=>o.key===key); }
function pricePercentile(o){
  const arr=[...(o?.history||[]),Number(o?.price||0)].filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b);
  if(!arr.length) return .5;
  return arr.filter(x=>x<=o.price).length/arr.length;
}
function recentTrend(o,points=4){
  const commodity=(typeof lastData!=='undefined' ? lastData?.commodities : [])
    ?.find(c=>c.key===o?.key);
  const source=commodity?.sparkHistory?.length
    ? commodity.sparkHistory
    : (o?.sparkHistory?.length ? o.sparkHistory : o?.history||[]);
  const h=source.map(Number).filter(x=>Number.isFinite(x)&&x>0);
  if(h.length<2) return {pct:0,label:'insufficient recent history'};
  const end=Number(o?.price||h[h.length-1]);
  const start=h[Math.max(0,h.length-1-Math.max(1,points))];
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
function advisorCommodityCapPct(result){
  const planCap=Number(result?.portfolioPlan?.cap);
  if(Number.isFinite(planCap) && planCap>0 && planCap<=1) return planCap;

  const mode=String(document.getElementById('allocationMode')?.value||'').toLowerCase();
  if(mode.includes('50')) return .50;
  if(mode.includes('33')) return .33;

  return .33;
}

function capAnswer(result){
  const cap=advisorCommodityCapPct(result);
  const limitText=`${Math.round(cap*100)}%`;
  const bad=(result?.portfolioPlan?.allocations||[])
    .filter(a=>a.key!=='__cash' && Number(a.pct)>cap+.0001);

  if(bad.length){
    return {
      title:'You found an allocation bug.',
      body:`The current commodity limit is ${limitText}. ${bad.map(a=>`${a.name} is shown at ${Math.round(a.pct*100)}%`).join(', ')}. Any excess should remain cash or be assigned to another qualifying commodity.`,
      evidence:`Detected portfolio-plan cap: ${limitText}.`
    };
  }

  return {
    title:`The current plan respects the ${limitText} cap.`,
    body:`No commodity in the recommended allocation exceeds ${limitText}. Cash is not a commodity and may hold any remainder.`,
    evidence:`Detected portfolio-plan cap: ${limitText}.`
  };
}
function explainCommodity(o,result,q){
  const trend=recentTrend(o); const perc=pricePercentile(o); const rank=rankOfOption(result,o.key);
  const capText=`${Math.round(advisorCommodityCapPct(result)*100)}%`;
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
    body=`Past yield alone is not the reason to buy it. The advisor is evaluating the entry now: ${o.name} is ${entryLabel(o)}, ranks #${rank||'—'} by the current model, and has ${pct(upside)} upside to the estimated target. A historically weak commodity should only receive allocation after stronger qualifying opportunities reach the ${capText} cap—or if its current entry is unusually cheap.`;
  } else if(falling){
    body=`Your concern is valid. ${o.name} is ${trend.label} over the latest captured points (${pct(trend.pct)}), and the current price is around the ${Math.round(perc*100)}th percentile of saved history. ${entryLabel(o)}. The advisor should not buy merely because the target is high; the entry threshold, event signal, and trade cost must still justify it.${whyBuy && !o.inManualBuyZone?' At this price I would treat it as a watch, not an automatic buy.':''}`;
  } else {
    body=`The case is based on the current entry, not a promise about the next tick. ${o.name} is ${entryLabel(o)}, at ${fmt(o.price)} versus a buy threshold of ${fmt(o.buyThreshold)}, and has an estimated target of ${fmt(o.target)} (${pct(upside)} upside). It ranks #${rank||'—'} among commodities. ${expectedAtTarget?`As an uncapped thought experiment, full exposure at this price would have a target-equivalent value near ${fmt(expectedAtTarget)}. That is not a recommendation: the actionable portfolio remains limited to ${capText} per commodity and must pass the trade-cost test.`:''}`;
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
  return bestScore?best:null;
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


function advisorHistoryPointCount(data){
  return Math.max(
    0,
    ...(data?.commodities||[]).map(c=>
      (c.sparkHistory?.length ? c.sparkHistory : c.history||[])
        .filter(v=>Number.isFinite(Number(v)) && Number(v)>0).length
    )
  );
}


function validPriceSeries(values){
  return (values||[])
    .map(Number)
    .filter(v=>Number.isFinite(v) && v>0);
}

function commodityFromData(data,key){
  return (data?.commodities||[]).find(c=>c.key===key) || null;
}

function marketMemoryEntry(key){
  try{
    if(typeof loadMarketMemory==='function'){
      return loadMarketMemory()?.commodities?.[key] || null;
    }
    const mem=JSON.parse(localStorage.getItem('bm_market_memory_v1')||'{"commodities":{}}');
    return mem?.commodities?.[key] || null;
  }catch(e){
    return null;
  }
}

function commodityPriceSeries(data,result,key){
  const c=commodityFromData(data,key);
  const o=optionForKey(result,key);
  const memoryEntry=marketMemoryEntry(key);

  // Lifetime questions should prefer persistent advisor memory. The rolling
  // sparkline is used only as a fallback when no saved memory exists.
  const memoryPrices=validPriceSeries(memoryEntry?.prices);
  const fallbackCandidates=[
    validPriceSeries(c?.memoryHistory),
    validPriceSeries(c?.history),
    validPriceSeries(o?.history)
  ].sort((a,b)=>b.length-a.length);

  const series=[...(memoryPrices.length ? memoryPrices : (fallbackCandidates[0]||[]))];
  const current=Number(c?.price ?? o?.price ?? memoryEntry?.lastPrice ?? 0);
  if(Number.isFinite(current) && current>0 && series[series.length-1]!==current){
    series.push(current);
  }
  return series;
}

function savedHistoryMetadata(key,points){
  const entry=marketMemoryEntry(key);
  let firstAt=entry?.firstCapturedAt || null;
  let lastAt=entry?.lastCapturedAt || null;

  // Best-effort migration for memory created before date boundaries existed.
  if((!firstAt || !lastAt) && typeof loadMarketMemory==='function'){
    const captures=loadMarketMemory()?.captures||[];
    if(!firstAt) firstAt=captures[0]?.capturedAt||null;
    if(!lastAt) lastAt=captures[captures.length-1]?.capturedAt||null;
  }

  const firstMs=Date.parse(firstAt||'');
  const lastMs=Date.parse(lastAt||'');
  const days=Number.isFinite(firstMs)&&Number.isFinite(lastMs)&&lastMs>=firstMs
    ? (lastMs-firstMs)/86400000
    : null;

  return {
    firstAt,
    lastAt,
    days,
    points,
    captures:Number(entry?.captures||0),
    source:entry?.prices?.length ? 'persistent saved market history' : 'current available history'
  };
}

function savedHistoryDurationText(meta){
  if(Number.isFinite(meta?.days)){
    if(meta.days>=2) return `Recorded from ${Math.max(1,Math.round(meta.days))} days of saved market history`;
    if(meta.days>=1) return `Recorded from about ${meta.days.toFixed(1)} days of saved market history`;
    const hours=Math.max(0,meta.days*24);
    if(hours>=1) return `Recorded from about ${hours.toFixed(hours>=10?0:1)} hours of saved market history`;
  }
  return `Based on ${meta?.points||0} saved price points`;
}
function quantileSorted(sorted,p){
  if(!sorted.length) return null;
  const pos=(sorted.length-1)*Math.max(0,Math.min(1,p));
  const lo=Math.floor(pos), hi=Math.ceil(pos);
  if(lo===hi) return sorted[lo];
  return sorted[lo]+(sorted[hi]-sorted[lo])*(pos-lo);
}

function historicalStatsFor(data,result,key){
  const series=commodityPriceSeries(data,result,key);
  if(!series.length) return null;
  const sorted=[...series].sort((a,b)=>a-b);
  const sum=series.reduce((a,b)=>a+b,0);
  const current=series[series.length-1];
  const high=sorted[sorted.length-1];
  const low=sorted[0];
  const average=sum/series.length;
  const median=quantileSorted(sorted,.5);
  const percentile=sorted.filter(v=>v<=current).length/sorted.length;
  const highIndex=series.lastIndexOf(high);
  const lowIndex=series.lastIndexOf(low);
  const memoryMeta=savedHistoryMetadata(key,series.length);
  return {
    series,sorted,current,high,low,average,median,percentile,
    points:series.length,highIndex,lowIndex,memoryMeta,
    currentVsHigh:high?current/high:0,
    currentVsLow:low?current/low-1:0
  };
}

function extractAskedPrice(q){
  const m=q.match(/\$?\s*([\d,]+(?:\.\d+)?)\s*(k|m|b)?\b/i);
  if(!m) return null;
  let n=Number(m[1].replace(/,/g,''));
  const suffix=(m[2]||'').toLowerCase();
  if(suffix==='k') n*=1e3;
  if(suffix==='m') n*=1e6;
  if(suffix==='b') n*=1e9;
  return Number.isFinite(n) && n>0 ? n : null;
}

function isHistoricalPriceQuestion(q){
  return /highest|all[ -]?time high|record high|peak price|lowest|all[ -]?time low|record low|bottom price|average price|mean price|median price|typical price|price history|historical stats?|statistics?|percentile|how cheap|how expensive|ever (?:been|hit|reached|crossed|gone|traded)|(?:been|was|is) above|(?:been|was|is) below|how many times/.test(q);
}

function configuredMarketRange(key){
  let saved={};
  try{ saved=JSON.parse(localStorage.getItem('bm_assumptions')||'{}'); }catch(e){ saved={}; }

  const readValue=field=>{
    const input=document.querySelector(`input[data-a="${key}"][data-f="${field}"]`);
    const raw=input?.value ?? saved?.[key]?.[field] ?? '';
    const value=typeof cleanNum==='function' ? cleanNum(raw) : Number(String(raw).replace(/[^\d.-]/g,''));
    return Number.isFinite(value) && value>0 ? value : null;
  };

  return {min:readValue('min'),max:readValue('max')};
}

function savedCaptureSeries(key){
  try{
    const mem=typeof loadMarketMemory==='function'
      ? loadMarketMemory()
      : JSON.parse(localStorage.getItem('bm_market_memory_v1')||'{"captures":[]}');

    return (mem?.captures||[])
      .map(c=>({
        at:c?.capturedAt||null,
        price:Number(c?.prices?.[key])
      }))
      .filter(x=>x.at && Number.isFinite(x.price) && x.price>0)
      .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  }catch(e){
    return [];
  }
}

function formatAdvisorDate(value){
  const d=new Date(value);
  if(!Number.isFinite(d.getTime())) return 'unknown time';
  return d.toLocaleString(undefined,{
    month:'short',
    day:'numeric',
    year:d.getFullYear()!==new Date().getFullYear()?'numeric':undefined,
    hour:'numeric',
    minute:'2-digit'
  });
}

function historicalPriceAnswer(q,entities,data,result){
  if(!entities?.length) return null;

  const entity=entities[0];
  const stats=historicalStatsFor(data,result,entity.key);
  if(!stats){
    return {
      title:`No saved price history for ${entity.name}`,
      body:'The advisor does not currently have usable captured prices for this commodity.',
      evidence:'Only prices actually received by the advisor are reported.'
    };
  }

  const configured=configuredMarketRange(entity.key);
  const captures=savedCaptureSeries(entity.key);
  const wantsHigh=/highest|all[ -]?time high|record high|peak|maximum|ever been/.test(q) && !/change|rise|jump|gain/.test(q);
  const wantsLow=/lowest|all[ -]?time low|record low|bottom|minimum/.test(q) && !/change|fall|drop|loss/.test(q);
  const wantsAverage=/average|mean|typical/.test(q);
  const wantsMedian=/median/.test(q);
  const wantsPercentile=/percentile|how cheap|how expensive/.test(q);
  const wantsWhen=/when|what time|what date|last time/.test(q);
  const wantsSummary=/history|statistics?|stats?|summary/.test(q);
  const threshold=extractAskedPrice(q);
  const asksAbove=/above|over|higher than|crossed|hit/.test(q);
  const asksBelow=/below|under|lower than/.test(q);
  const asksCount=/how many times|times has|times did/.test(q);
  const currentPctOfHigh=stats.currentVsHigh*100;

  if(threshold && (asksAbove || asksBelow)){
    const relation=asksBelow?'below':'above';
    const savedMatches=stats.series.filter(v=>asksBelow?v<threshold:v>threshold).length;
    const captureMatches=captures.filter(x=>asksBelow?x.price<threshold:x.price>threshold);
    const last=captureMatches[captureMatches.length-1]||null;

    if(wantsWhen){
      return {
        title:`Last saved ${entity.name} price ${relation} ${fmt(threshold)}`,
        body:last
          ? `The latest timestamped capture ${relation} ${fmt(threshold)} was <strong>${fmt(last.price)}</strong> on <strong>${formatAdvisorDate(last.at)}</strong>.`
          : `The saved price series ${savedMatches?'contains':'does not contain'} values ${relation} ${fmt(threshold)}, but no timestamped capture is available for the latest matching point.`,
        evidence:`${savedHistoryDurationText(stats.memoryMeta)} · ${stats.points} saved price points · ${captures.length} timestamped captures.`
      };
    }

    return {
      title:`${entity.name}: saved prices ${relation} ${fmt(threshold)}`,
      body:asksCount
        ? `${entity.name} appears in ${savedMatches} saved price point${savedMatches===1?'':'s'} ${relation} ${fmt(threshold)}.`
        : `${savedMatches>0?'Yes':'No'}—the advisor ${savedMatches>0?'has':'has not'} saved ${entity.name} ${relation} ${fmt(threshold)}.${savedMatches>0?` It appears in ${savedMatches} saved point${savedMatches===1?'':'s'}.`:''}`,
      evidence:`${savedHistoryDurationText(stats.memoryMeta)} · Recorded range ${fmt(stats.low)}–${fmt(stats.high)} · Missing scans remain gaps.`
    };
  }

  if(wantsHigh){
    const exactCapture=[...captures].reverse().find(x=>x.price===stats.high);
    const knownText=configured.max && Math.abs(configured.max-stats.high)>=1
      ? ` Your configured known market maximum is <strong>${fmt(configured.max)}</strong>.`
      : '';
    const whenText=wantsWhen
      ? exactCapture
        ? ` It was timestamped on <strong>${formatAdvisorDate(exactCapture.at)}</strong>.`
        : ' The highest point was imported from saved price history without an exact timestamp.'
      : '';

    return {
      title:`Highest saved price: ${entity.name}`,
      body:`The highest price this advisor has saved is <strong>${fmt(stats.high)}</strong>. The current price is ${fmt(stats.current)}, which is ${currentPctOfHigh.toFixed(1)}% of that saved high.${knownText}${whenText}`,
      evidence:`${savedHistoryDurationText(stats.memoryMeta)} · ${stats.points} saved price points · Saved low ${fmt(stats.low)} · Average ${fmt(stats.average)}. Saved history and configured market knowledge are reported separately.`
    };
  }

  if(wantsLow){
    const exactCapture=[...captures].reverse().find(x=>x.price===stats.low);
    const knownText=configured.min && Math.abs(configured.min-stats.low)>=1
      ? ` Your configured known market minimum is <strong>${fmt(configured.min)}</strong>.`
      : '';
    const whenText=wantsWhen
      ? exactCapture
        ? ` It was timestamped on <strong>${formatAdvisorDate(exactCapture.at)}</strong>.`
        : ' The lowest point was imported from saved price history without an exact timestamp.'
      : '';

    return {
      title:`Lowest saved price: ${entity.name}`,
      body:`The lowest price this advisor has saved is <strong>${fmt(stats.low)}</strong>. The current price is ${fmt(stats.current)}, or ${pct(stats.currentVsLow)} above that saved low.${knownText}${whenText}`,
      evidence:`${savedHistoryDurationText(stats.memoryMeta)} · ${stats.points} saved price points · Saved high ${fmt(stats.high)} · Median ${fmt(stats.median)}.`
    };
  }

  if(wantsAverage && !wantsMedian){
    return {
      title:`Average saved price: ${entity.name}`,
      body:`The arithmetic average of the saved prices is <strong>${fmt(stats.average)}</strong>. The current price is ${fmt(stats.current)}, ${stats.current>=stats.average?pct(stats.current/stats.average-1)+' above':pct(1-stats.current/stats.average)+' below'} that average.`,
      evidence:`${savedHistoryDurationText(stats.memoryMeta)} · ${stats.points} saved price points · Median ${fmt(stats.median)} · Range ${fmt(stats.low)}–${fmt(stats.high)}.`
    };
  }

  if(wantsMedian){
    return {
      title:`Median saved price: ${entity.name}`,
      body:`The median saved price is <strong>${fmt(stats.median)}</strong>. Half of the available saved observations are at or below it and half are at or above it.`,
      evidence:`${savedHistoryDurationText(stats.memoryMeta)} · Current ${fmt(stats.current)} · Average ${fmt(stats.average)} · ${stats.points} saved points.`
    };
  }

  if(wantsPercentile){
    return {
      title:`Historical position: ${entity.name}`,
      body:`At ${fmt(stats.current)}, ${entity.name} is around the <strong>${Math.round(stats.percentile*100)}th percentile</strong> of saved history. About ${Math.round(stats.percentile*100)}% of saved prices were at or below the current price.`,
      evidence:`${savedHistoryDurationText(stats.memoryMeta)} · Saved low ${fmt(stats.low)} · Median ${fmt(stats.median)} · High ${fmt(stats.high)}.`
    };
  }

  if(wantsSummary || /how far back|how much history/.test(q)){
    const knownRange=[
      configured.min?`Configured minimum ${fmt(configured.min)}`:null,
      configured.max?`Configured maximum ${fmt(configured.max)}`:null
    ].filter(Boolean).join(' · ');

    return {
      title:`Saved price history: ${entity.name}`,
      body:`Current: <strong>${fmt(stats.current)}</strong><br>Highest saved: <strong>${fmt(stats.high)}</strong><br>Lowest saved: <strong>${fmt(stats.low)}</strong><br>Average: <strong>${fmt(stats.average)}</strong><br>Median: <strong>${fmt(stats.median)}</strong><br>Current percentile: <strong>${Math.round(stats.percentile*100)}th</strong>${knownRange?`<br>${knownRange}`:''}.`,
      evidence:`${savedHistoryDurationText(stats.memoryMeta)} · ${stats.points} saved price points · ${captures.length} timestamped captures. Missing scans remain gaps.`
    };
  }

  return null;
}
const EVENT_REASONING_THEMES = [
  {
    type:'Enforcement',
    test:/police|raid|crackdown|customs|seizure|arrest|patrol|inspection|task force|authorities|federal|sting/,
    direction:'Supply is more likely to tighten than expand, creating possible upward price pressure.',
    commodities:['counterfeit_bills','prescription_pills','uncut_cocaine','military_hardware','exotic_animals','stolen_art'],
    rationale:'Law-enforcement activity can interrupt trafficking, seize inventory, or make distribution riskier.'
  },
  {
    type:'Shipping / logistics',
    test:/dock|port|shipping|shipment|freight|cargo|border|route|transport|trucking|warehouse|delivery|canal/,
    direction:'Disrupted transport usually reduces near-term supply and can support prices; restored or expanded transport can do the opposite.',
    commodities:['prescription_pills','uncut_cocaine','military_hardware','exotic_animals','stolen_art','enriched_uranium','stolen_electronics'],
    rationale:'These commodities depend heavily on movement through ports, borders, warehouses, or long supply chains.'
  },
  {
    type:'Supply expansion',
    test:/glut|new supplier|surplus|floods? the market|overstock|large shipment|production boom|cheap supply/,
    direction:'More supply generally creates downward price pressure.',
    commodities:['prescription_pills','uncut_cocaine','military_hardware','stolen_electronics','enriched_uranium'],
    rationale:'Additional inventory gives buyers more options and weakens scarcity.'
  },
  {
    type:'Supply shortage',
    test:/shortage|scarcity|supplier disappears|factory closes|route blocked|embargo|strike|disruption|lost shipment/,
    direction:'Less supply generally creates upward price pressure.',
    commodities:['prescription_pills','uncut_cocaine','military_hardware','stolen_electronics','enriched_uranium'],
    rationale:'Restricted inventory increases scarcity until supply routes recover.'
  },
  {
    type:'Heist / theft',
    test:/heist|robbery|stolen collection|museum|gallery|vault|burglary|theft/,
    direction:'A fresh influx of stolen inventory can pressure the targeted market downward, while publicity or scarcity can later reverse the effect.',
    commodities:['stolen_art','stolen_electronics','counterfeit_bills'],
    rationale:'The immediate effect depends on whether the event adds sellable inventory or removes scarce goods from circulation.'
  },
  {
    type:'Celebrity / cultural demand',
    test:/celebrity|scandal|viral|fashion|collector|auction|movie|music|influencer|trend/,
    direction:'Demand can shift quickly, but the sign is ambiguous until the price response is observed.',
    commodities:['stolen_art','exotic_animals','stolen_electronics'],
    rationale:'Public attention can either increase desirability or make ownership riskier.'
  },
  {
    type:'Financial',
    test:/bank|currency|cash|inflation|counterfeit|treasury|financial|market panic|recession/,
    direction:'The likely direction depends on whether the event raises demand for alternative cash or increases detection and enforcement.',
    commodities:['counterfeit_bills'],
    rationale:'Currency confidence, liquidity, and anti-counterfeiting pressure directly affect fake-cash demand and risk.'
  },
  {
    type:'Technology / industrial demand',
    test:/technology|tech boom|reactor|nuclear|energy|defense contract|military buildup|electronics shortage|chip/,
    direction:'Higher industrial or strategic demand can create upward pressure on related scarce inputs.',
    commodities:['enriched_uranium','military_hardware','stolen_electronics'],
    rationale:'Strategic materials and equipment react to changes in industrial, energy, and defense demand.'
  }
];

function inferEventReasoning(eventName){
  const n=normalizeQuestion(eventName);
  const matches=EVENT_REASONING_THEMES.filter(t=>t.test.test(n));
  if(!matches.length){
    return {
      types:['Unclassified'],
      direction:'The wording does not support a reliable rule-based direction yet.',
      commodities:[],
      rationale:'The advisor should wait for measured price behavior rather than force a narrative.'
    };
  }
  const keys=[...new Set(matches.flatMap(m=>m.commodities))];
  return {
    types:matches.map(m=>m.type),
    direction:matches.map(m=>m.direction).join(' '),
    commodities:keys,
    rationale:matches.map(m=>m.rationale).join(' ')
  };
}

function formatEventAge(minutes){
  const m=Number(minutes||0);
  if(m>=1440) return `${(m/1440).toFixed(m%1440?1:0)} days`;
  if(m>=60) return `${(m/60).toFixed(m%60?1:0)} hours`;
  return `${m} minutes`;
}

function advisorKnowledgeAnswer(q,data,result){
  const pointCount=advisorHistoryPointCount(data);
  const updateMinutes=15;
  const representedMinutes=pointCount>1 ? (pointCount-1)*updateMinutes : 0;
  const representedHours=representedMinutes/60;
  const historyText=pointCount
    ? `${pointCount} visible price points, covering about ${representedHours.toFixed(representedHours%1?1:0)} hours from the first point to the latest point when updates arrive every 15 minutes`
    : `the visible price points supplied by the latest market capture`;

  if(/sparkline|price graph|history graph|little graph|mini graph/.test(q)){
    return {
      title:'Commodity sparkline',
      body:`The sparkline uses ${historyText}. It is a rolling in-game view, not the advisor’s complete saved history. Older captured prices can remain available through saved price memory and Move Records after they disappear from the sparkline.`,
      evidence:pointCount
        ? `Current capture: ${pointCount} points × 15-minute updates; first-to-last span is approximately ${representedHours.toFixed(2)} hours.`
        : 'The exact span is calculated from the number of history points in the current capture.'
    };
  }

  if(/market snapshot|snapshot at the bottom|snapshot section|market table/.test(q)){
    return {
      title:'Market Snapshot',
      body:'The Market Snapshot is primarily a current-state table from the latest capture. It shows each commodity’s current price and the recent rolling history supplied by the game. It is not itself a full 24-hour archive or a record of every price the advisor has ever seen.',
      evidence:`The latest snapshot can include ${pointCount||'the currently available'} rolling history points; longer-term captured history is stored separately.`
    };
  }

  if(/move records?|largest move|record rise|record fall/.test(q) && !/(what|which).*(largest|biggest)/.test(q)){
    return {
      title:'Move Records',
      body:'Move Records preserve the largest observed rise and fall between consecutive saved market captures. They are built from persistent saved price memory, so they can outlive the shorter rolling sparkline.',
      evidence:'Move Records describe observed past intervals; they do not predict the next update.'
    };
  }

  if(/automatic monitoring|monitoring section|capture source|last market scan|next scan|connection status/.test(q)){
    return {
      title:'Automatic Monitoring',
      body:'Automatic Monitoring reports whether the capture script is connected, when the last market scan arrived, where it came from, and when another scan is expected. The game tab and advisor tab generally need to remain open for automatic captures.',
      evidence:'This section reports capture status; it does not make trading decisions.'
    };
  }

  if(/paste page html|html input|manual capture|analyze market button/.test(q)){
    return {
      title:'Paste page HTML',
      body:'This is the manual fallback for loading market data. Paste the Black Market page HTML and choose Analyze Market. Automatic Monitoring normally fills this data for you when the capture script is connected.',
      evidence:'Manual paste and automatic capture feed the same analysis pipeline.'
    };
  }

  if(/developer mode|developer diagnostics|parsed json|debug/.test(q)){
    return {
      title:'Developer Mode',
      body:'Developer Mode reveals diagnostic details used to inspect how the advisor reached a result, including intermediate values and parsed data. It is intended for troubleshooting and does not change the market itself.',
      evidence:'Turning diagnostics on should explain the calculation; it should not independently alter the recommendation.'
    };
  }

  if(/recommended portfolio|portfolio plan|allocation section/.test(q)){
    return {
      title:'Recommended Portfolio',
      body:'Recommended Portfolio shows the advisor’s preferred capped allocation after considering clean entry zones, current holdings, cash, trade cost, limited trades, event evidence, and opportunity cost. A theoretical candidate can still be rejected when the expected improvement is too small.',
      evidence:`The current engine reports a ${Math.round(advisorCommodityCapPct(result)*100)}% maximum per commodity.`
    };
  }

  if(/33%|50%|33 percent|50 percent|thirty three|fifty percent|portfolio cap|maximum per commodity/.test(q)){
    return capAnswer(result);
  }

  if(/waiting for|waiting section|what am i waiting/.test(q)){
    return {
      title:'Waiting For…',
      body:'Waiting For… lists the market conditions that would make the current decision more attractive or change it—for example, a commodity reaching its buy threshold, a stronger event signal, a better alternative, or enough expected improvement to justify another trade.',
      evidence:'It is a watch list of decision triggers, not a guarantee that they will occur.'
    };
  }

  if(/current position|position box|my holdings section/.test(q)){
    return {
      title:'Current Position',
      body:'Current Position summarizes what you presently own, your cash, and how that mix compares with the advisor’s current assessment. It describes the starting point before any recommended trades.',
      evidence:'This section reflects the latest captured portfolio values.'
    };
  }

  if(/pros.*cons|pros and cons|why not list|counterargument/.test(q)){
    return {
      title:'Pros & Cons',
      body:'Pros & Cons separates evidence supporting the recommendation from risks and counterarguments. It is there to prevent a single score or attractive target from hiding uncertainty, trade cost, event risk, or a weak entry.',
      evidence:'The recommendation should be read together with both columns.'
    };
  }

  if(/top alternatives|alternatives table|other options/.test(q)){
    return {
      title:'Top Alternatives',
      body:'Top Alternatives ranks other commodities or allocations that were considered. It helps show whether the recommendation is clearly better than the next-best choice or only narrowly ahead.',
      evidence:'A high-ranked alternative is not automatically actionable unless it also clears entry and trade-cost requirements.'
    };
  }

  if(/position switch|switch outlook|switching position|hold versus switch/.test(q)){
    return {
      title:'Position Switch Outlook',
      body:'Position Switch Outlook compares keeping one current holding with selling it and moving that value into another commodity. It accounts for the expected difference, trade usage, current entry quality, and whether the switch is large enough to justify acting.',
      evidence:'A better theoretical destination can still be rejected when the gain is too small relative to the trades.'
    };
  }

  if(/confidence|data confidence|decision confidence|historical confidence|classification confidence/.test(q)){
    return {
      title:'Confidence',
      body:'Confidence describes how much evidence supports a conclusion. Data confidence reflects the amount and quality of captured history; historical event confidence reflects repeated outcomes and consistency; classification confidence reflects how strongly an event name matches a known event type. Confidence is not the probability of profit.',
      evidence:'More independent, directionally consistent observations generally increase confidence.'
    };
  }

  if(/buy threshold|buy zone|sell threshold|sell zone|sell review/.test(q)){
    return {
      title:'Buy and sell thresholds',
      body:'A buy threshold is the highest price the advisor considers a clean entry under the current assumptions. A sell threshold marks the area where taking profit or reviewing the position becomes reasonable. Events and saved history can adjust how cautiously those thresholds are interpreted.',
      evidence:'Crossing a threshold is an input to the decision, not an automatic order.'
    };
  }

  if(/saved price memory|price memory|long.?term history|older history|how far back.*history/.test(q)){
    return {
      title:'Saved price memory',
      body:'Saved price memory stores captured prices beyond the game’s rolling sparkline. It supports longer-term percentiles, trend context, and Move Records. It only knows captures the advisor actually received.',
      evidence:'Missing scans create gaps; the advisor does not invent prices for those intervals.'
    };
  }

  if(/notifications?|discord alerts?|test alert/.test(q)){
    return {
      title:'Notifications',
      body:'Notifications control Discord alerts from the advisor. The test button verifies that the alert path works. Enabling alerts does not change the recommendation; it only changes whether qualifying messages are sent.',
      evidence:'Alert delivery depends on the configured webhook and running alert service.'
    };
  }

  if(/ask the advisor|help mode|what can (you|the advisor) answer|how do i use.*advisor/.test(q)){
    return {
      title:'Ask the Advisor help',
      body:'Choose Auto-detect or select History, Comparison, Switch Decision, Exit Strategy, Entry Strategy, Events, Statistics, Portfolio, or Ranking. The selected category overrides automatic routing. Ranking uses the live leaderboard parsed from the Black Market page.',
      evidence:'Help questions are answered from the advisor’s built-in knowledge; market questions use the latest analyzed snapshot.'
    };
  }

  return null;
}

function specificEventKnowledgeAnswer(q,result,data){
  const rawEvents=result?.eventMemory?.rawEvents||[];
  if(!rawEvents.length) return null;

  const event=matchActiveEventFromQuestion(q,result,data);
  if(!event) return null;

  const eventWords=normalizeQuestion(event.name)
    .split(/\s+/)
    .filter(w=>w.length>=4 && !['event','ago','hits','street','streets','affected'].includes(w));

  const explicitMatch=eventWords.some(w=>q.includes(w));
  const asksWhat=/what does|what is|explain|tell me about|meaning|effect|likely affect|do\??$/.test(q);
  if(!explicitMatch || !asksWhat) return null;

  const activeProfile=result?.eventMemory?.active?.[event.name]||
    result?.eventMemory?.profiles?.[event.name]||
    null;

  const learnedType=activeProfile?.eventType||event.eventType||null;
  const learnedExpected=activeProfile?.expectedDirection||event.expectedDirection||null;
  const directTargetKey=eventTargetKey(event.name);
  const inferred=inferEventReasoning(event.name);
  const occurrenceCount=activeProfile?.occurrences||0;
  const classificationConfidence=
    activeProfile?.classificationConfidence ?? event.classificationConfidence ?? 0;

  const likelyKeys=directTargetKey
    ? [directTargetKey,...inferred.commodities.filter(k=>k!==directTargetKey)]
    : inferred.commodities;
  const likelyNames=likelyKeys.map(nameFor).filter(Boolean);
  const typeText=[learnedType,...inferred.types].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' / ') || 'Unclassified';

  let measuredText='';
  const profile=result?.eventMemory?.profiles?.[event.name];
  if(profile?.summary){
    const ranked=(result?.commodityOptions||[]).map(o=>{
      const stat=closestEventStat(profile,o.key,event.ageMinutes);
      return stat ? {name:o.name,...stat} : null;
    }).filter(Boolean).sort((a,b)=>Math.abs(b.avg)-Math.abs(a.avg)).slice(0,3);

    if(ranked.length){
      measuredText=` The strongest measured responses so far are ${ranked.map(x=>`${x.name} ${x.avg>=0?'+':''}${pct(x.avg)} over ${x.window>=60?Math.round(x.window/60)+'h':x.window+'m'} (${x.n} occurrence${x.n===1?'':'s'})`).join('; ')}.`;
    }
  }

  const learnedDirectionText=
    learnedExpected==='up' || String(learnedExpected).toLowerCase()==='bullish'
      ? 'The rule table currently expects upward pressure.'
      : learnedExpected==='down' || String(learnedExpected).toLowerCase()==='bearish'
        ? 'The rule table currently expects downward pressure.'
        : '';

  const commodityText=likelyNames.length
    ? `The commodities most plausibly exposed are <strong>${likelyNames.join(', ')}</strong>.`
    : 'No commodity can be identified confidently from the wording alone.';

  const confidencePlain=occurrenceCount>=3
    ? 'Repeated observations are beginning to matter more than the wording.'
    : occurrenceCount>=1
      ? 'History is still thin, so this remains a working interpretation.'
      : 'This is economic reasoning only until captured price behavior confirms or contradicts it.';

  return {
    title:event.name,
    body:`This looks like a <strong>${typeText}</strong> event. ${inferred.rationale} ${inferred.direction} ${learnedDirectionText} ${commodityText} ${confidencePlain}${measuredText}`,
    evidence:`Displayed age: ${formatEventAge(event.ageMinutes)} · Tracked occurrences: ${occurrenceCount} · Classification confidence: ${Math.round(classificationConfidence*100)}%. Rule-based reasoning and measured history are kept separate.`
  };
}

const ADVISOR_CATEGORIES = [
  ['auto','Auto-detect'],
  ['history','History'],
  ['comparison','Comparison'],
  ['switch','Switch Decision'],
  ['exit','Exit Strategy'],
  ['entry','Entry Strategy'],
  ['events','Events'],
  ['statistics','Statistics'],
  ['portfolio','Portfolio'],
  ['ranking','Ranking']
];

function advisorCategoryLabel(value){
  return ADVISOR_CATEGORIES.find(x=>x[0]===value)?.[1] || 'Auto-detect';
}

function detectAdvisorCategory(q,entities=[]){
  if(/rank|ranking|leaderboard|place\b|trailing|behind|ahead|catch|pass|overtake|protect.*rank|recuperate|recover.*gap|first place|second place|third place/.test(q)) return 'ranking';
  if(/should i sell.*(?:and|then).*(?:buy|move)|switch(?:ing)?\s+(?:from|out of|to)|move\s+(?:from|out of).*(?:to|into)|sell.*buy/.test(q)) return 'switch';
  if(/when should i sell|when.*take profit|take profits?|cash out|exit strategy|when.*exit|sell target|what price.*sell|time to sell/.test(q)) return 'exit';
  if(/should i buy|buy now|when should i buy|entry strategy|wait.*buy|buy.*wait|good entry|worth buying|invest in|drop more/.test(q)) return 'entry';
  if(/event|news|customs|crackdown|raid|supplier|heist|glut|scandal|shortage|shipping|docks?|police/.test(q)) return 'events';
  if(/average|mean|median|percentile|volatil|standard deviation|largest.*(?:rise|fall|move|change)|biggest.*(?:rise|fall|move|change)|statistics?|stats?|most expensive|cheapest|highest average|lowest average/.test(q)) return 'statistics';
  if(/highest|lowest|all[ -]?time|record high|record low|price history|ever been|when was|last time|how far back|how much history|been above|been below/.test(q)) return 'history';
  if(entities.length>=2 || /\bvs\b|versus|compare|which is better|better between/.test(q)) return 'comparison';
  if(/portfolio|allocation|cash|cap|33%|50%|trade|split|diversif|current mix|recommended plan/.test(q)) return 'portfolio';
  if(entities.length) return 'entry';
  return 'portfolio';
}

function holdingForKey(data,key){
  return (data?.holdings||[]).find(h=>h.key===key)||null;
}

function currentDominantEntity(data,result){
  const h=[...(data?.holdings||[])]
    .filter(x=>(x.value||x.qty*(x.current||x.price)||0)>0)
    .sort((a,b)=>(b.value||b.qty*(b.current||b.price||0))-(a.value||a.qty*(a.current||a.price||0)))[0];

  const key=h?.key || result?.dominantHolding?.key || result?.currentOpt?.key || null;
  return key ? {key,name:nameFor(key),index:-1} : null;
}

function sourceAndTargetEntities(q,entities,data,result){
  const ordered=[...(entities||[])].sort((a,b)=>(a.index??0)-(b.index??0));
  const sellPos=q.search(/\bsell\b|\bfrom\b|\bout of\b/);
  const buyPos=q.search(/\bbuy\b|\binto\b|\bswitch to\b|\bmove to\b/);

  let source=null,target=null;
  if(sellPos>=0) source=ordered.find(e=>(e.index??0)>sellPos && (buyPos<0 || (e.index??0)<buyPos))||null;
  if(buyPos>=0) target=ordered.find(e=>(e.index??0)>buyPos)||null;

  if(!source && ordered.length>=2) source=ordered[0];
  if(!target && ordered.length>=2) target=ordered.find(e=>e.key!==source?.key)||ordered[1];

  const dominant=currentDominantEntity(data,result);
  if(!source && target) source=dominant;
  if(!target && source){
    const best=(result?.commodityOptions||[])
      .filter(o=>o.key!==source.key)
      .sort((a,b)=>b.score-a.score)[0];
    if(best) target={key:best.key,name:best.name,index:-1};
  }

  return {source,target};
}

function comparisonCategoryAnswer(q,entities,data,result){
  if(entities.length<2){
    return {
      title:'Name two commodities to compare.',
      body:'Example: “Compare Enriched Uranium and Military Hardware.” Comparison explains the differences without automatically recommending a trade.',
      evidence:'The Comparison category requires two commodity names.'
    };
  }

  const a=optionForKey(result,entities[0].key);
  const b=optionForKey(result,entities[1].key);
  if(!a||!b) return null;

  const ans=compareCommodities(a,b,result);
  ans.body+=` <strong>This is a comparison, not a switch recommendation.</strong> Choose Switch Decision for an explicit yes/no/wait answer.`;
  return ans;
}

function switchDecisionAnswer(q,entities,data,result){
  const {source,target}=sourceAndTargetEntities(q,entities,data,result);
  if(!source || !target){
    return {
      title:'Name the position and destination.',
      body:'Example: “Should I sell Uranium and buy Military Hardware?”',
      evidence:'A switch decision needs a source holding and a proposed destination.'
    };
  }

  const sourceOpt=optionForKey(result,source.key);
  const targetOpt=optionForKey(result,target.key);
  if(!sourceOpt||!targetOpt) return null;

  const holding=holdingForKey(data,source.key);
  const plan=result?.portfolioPlan||{};
  const recommended=plan.recommendedTrades||[];
  const candidate=plan.candidateTrades||plan.trades||[];
  const recommendedSell=recommended.some(t=>/SELL/.test(String(t.action)) && t.key===source.key);
  const recommendedBuy=recommended.some(t=>/BUY/.test(String(t.action)) && t.key===target.key);
  const candidateSell=candidate.some(t=>/SELL/.test(String(t.action)) && t.key===source.key);
  const candidateBuy=candidate.some(t=>/BUY/.test(String(t.action)) && t.key===target.key);
  const protectedLoss=(plan.protectedLossKeys||[]).includes(source.key);
  const sourceUpside=sourceOpt.price>0?sourceOpt.target/sourceOpt.price-1:0;
  const targetUpside=targetOpt.price>0?targetOpt.target/targetOpt.price-1:0;
  const edge=targetUpside-sourceUpside;
  const tradesNeeded=(candidateSell?1:0)+(candidateBuy?1:0);
  let verdict,reason;

  if(!holding){
    verdict='NO ACTION';
    reason=`The captured portfolio does not show ${source.name} as a current holding, so there is nothing to sell from that position.`;
  }else if(recommendedSell && recommendedBuy){
    verdict='YES — SWITCH NOW';
    reason=`The authoritative capped portfolio plan explicitly recommends selling ${source.name} and buying ${target.name}. The candidate clears the opportunity-cost and trade-budget tests.`;
  }else if(protectedLoss){
    verdict='NO — HOLD THE SOURCE';
    reason=`${source.name} is protected by the realized-loss rule. The current model does not see enough additional edge in ${target.name} to justify locking in the loss.`;
  }else if(!targetOpt.inManualBuyZone){
    verdict='WAIT';
    reason=`${target.name} is ${entryLabel(targetOpt)}, so buying it now would chase the destination rather than enter cleanly.`;
  }else if(candidateSell && candidateBuy && !plan.meaningfulRebalance){
    verdict='NO — NOT WORTH THE TRADES YET';
    reason=`The optimizer considered this rotation, but its projected advantage did not clear the opportunity-cost test.`;
  }else if(targetOpt.score>sourceOpt.score && edge>.10){
    verdict='WAIT FOR CONFIRMATION';
    reason=`${target.name} is numerically stronger, but the current portfolio plan does not authorize the complete switch. Wait for the source to reach a sell condition or for the destination’s edge to become large enough to clear the trade test.`;
  }else{
    verdict='NO — KEEP THE CURRENT POSITION';
    reason=`The difference between the two positions is not strong enough to justify a sell-and-buy rotation right now.`;
  }

  return {
    title:`${verdict}: ${source.name} → ${target.name}`,
    body:`${reason} ${source.name} has ${pct(sourceUpside)} target upside and a score of ${Math.round(sourceOpt.score)}; ${target.name} has ${pct(targetUpside)} target upside and a score of ${Math.round(targetOpt.score)}.`,
    evidence:`Source ${fmt(sourceOpt.price)} · Destination ${fmt(targetOpt.price)} · Destination ${entryLabel(targetOpt)} · Relative target-upside edge ${pct(edge)} · Candidate trades ${tradesNeeded||'none'} · Portfolio decision: ${plan.opportunityCostDecision||result.action}.`
  };
}

function exitStrategyAnswer(q,entities,data,result){
  const entity=entities[0]||currentDominantEntity(data,result);
  if(!entity){
    return {title:'No current holding identified.',body:'Name the commodity you may sell.',evidence:'Exit Strategy requires a current position.'};
  }

  const o=optionForKey(result,entity.key);
  const h=holdingForKey(data,entity.key);
  if(!o) return null;

  const plan=result?.portfolioPlan||{};
  const sellTrade=(plan.recommendedTrades||[]).find(t=>/SELL/.test(String(t.action)) && t.key===entity.key);
  const candidateSell=(plan.candidateTrades||plan.trades||[]).find(t=>/SELL/.test(String(t.action)) && t.key===entity.key);
  const trend=recentTrend(o,5);
  const profitPct=h?.avgBuy>0 ? o.price/h.avgBuy-1 : null;
  const bearish=!!(o.eventSignal?.confidence>=.45 && o.eventSignal.effect<0);
  const replacement=(result?.commodityOptions||[])
    .filter(x=>x.key!==o.key && x.inManualBuyZone && !x.inSellZone)
    .sort((a,b)=>b.score-a.score)[0]||null;

  let action;
  if(sellTrade) action='SELL OR REDUCE NOW';
  else if(o.inSellZone) action='SELL REVIEW NOW';
  else if(isValidMoney(o.sellThreshold) && o.price>=o.sellThreshold*.92) action='PREPARE TO SELL';
  else action='HOLD FOR NOW';

  const triggers=[
    `price reaches the sell threshold of <strong>${fmt(o.sellThreshold)}</strong>`,
    `the event signal becomes reliably bearish${bearish?' (it is currently bearish)':''}`,
    `momentum weakens after a strong rise${trend.pct<-.03?' (recent momentum is already falling)':''}`,
    replacement?`${replacement.name} offers a clearly superior clean entry and the trade-cost test passes`:'a clearly superior replacement enters its buy zone',
    `the capped portfolio plan explicitly recommends reducing this position`
  ];

  const lossNote=profitPct===null?'':profitPct<0
    ? ` You are currently about ${pct(profitPct)} versus the average buy price, so selling also realizes a loss.`
    : ` You are currently about ${pct(profitPct)} versus the average buy price.`;

  return {
    title:`${action}: ${o.name}`,
    body:`Use these exit triggers rather than an arbitrary price guess:<br>• ${triggers.join('<br>• ')}.${lossNote}${candidateSell&&!sellTrade?' The model has considered a sale, but it is not yet an actionable trade.':''}`,
    evidence:`Current ${fmt(o.price)} · Sell threshold ${fmt(o.sellThreshold)} · ${exitLabel(o)} · Recent trend ${trend.label} ${pct(trend.pct)} · Sell pressure ${result.sellPressure||'N/A'} · Portfolio action ${result.action}.`
  };
}

function entryStrategyAnswer(q,entities,data,result){
  const entity=entities[0] || (() => {
    const best=(result?.commodityOptions||[]).slice().sort((a,b)=>b.score-a.score)[0];
    return best?{key:best.key,name:best.name}:null;
  })();

  if(!entity) return {title:'Name a commodity to evaluate.',body:'Example: “Should I buy Pills now?”',evidence:'Entry Strategy requires a commodity.'};

  const o=optionForKey(result,entity.key);
  if(!o) return null;

  const plan=result?.portfolioPlan||{};
  const buyTrade=(plan.recommendedTrades||[]).find(t=>/BUY/.test(String(t.action)) && t.key===o.key);
  const candidateBuy=(plan.candidateTrades||plan.trades||[]).find(t=>/BUY/.test(String(t.action)) && t.key===o.key);
  const trend=recentTrend(o,5);
  const bearish=!!(o.eventSignal?.confidence>=.45 && o.eventSignal.effect<0);
  let verdict,reason;

  if(buyTrade){
    verdict='BUY NOW — WITHIN THE PORTFOLIO CAP';
    reason='The current actionable portfolio plan includes this purchase and it clears the entry, opportunity-cost, and trade-budget tests.';
  }else if(!o.inManualBuyZone){
    verdict='WAIT';
    reason=`The price is above the clean buy threshold of ${fmt(o.buyThreshold)}.`;
  }else if(bearish && trend.pct<-.03){
    verdict='WAIT OR BUY ONLY A PARTIAL ALLOCATION';
    reason='The commodity is inside its normal buy zone, but both event evidence and recent movement are bearish.';
  }else if(candidateBuy && !plan.meaningfulRebalance){
    verdict='DO NOT FORCE THE BUY';
    reason='The optimizer considered buying it, but the overall portfolio improvement is not large enough to justify the trade yet.';
  }else if(o.inManualBuyZone){
    verdict='QUALIFYING ENTRY — WATCH THE PORTFOLIO PLAN';
    reason='The price is inside its buy zone, but the authoritative capped plan has not made it an immediate trade.';
  }else{
    verdict='WATCH';
    reason='The entry is not strong enough for an immediate purchase.';
  }

  return {
    title:`${verdict}: ${o.name}`,
    body:`${reason} Current target upside is ${pct(o.upsidePct||0)}, and it ranks #${rankOfOption(result,o.key)||'—'} among commodities.`,
    evidence:`Current ${fmt(o.price)} · Buy threshold ${fmt(o.buyThreshold)} · ${entryLabel(o)} · Recent trend ${trend.label} ${pct(trend.pct)} · Event evidence ${bearish?'bearish':'not strongly bearish'} · Portfolio action ${result.action}.`
  };
}

function priceSeriesVolatility(series){
  const a=validPriceSeries(series);
  if(a.length<3) return null;
  const returns=[];
  for(let i=1;i<a.length;i++){
    if(a[i-1]>0) returns.push(a[i]/a[i-1]-1);
  }
  if(returns.length<2) return null;
  const mean=returns.reduce((s,x)=>s+x,0)/returns.length;
  const variance=returns.reduce((s,x)=>s+(x-mean)**2,0)/(returns.length-1);
  return Math.sqrt(Math.max(0,variance));
}

function statisticsCategoryAnswer(q,entities,data,result){
  if(entities.length){
    const entity=entities[0];
    const stats=historicalStatsFor(data,result,entity.key);
    if(!stats) return null;
    const moves=movementStats(stats.series);
    const volatility=priceSeriesVolatility(stats.series);

    if(/largest|biggest|record.*(?:rise|fall|move|change)|most.*change/.test(q)){
      return moveRecordAnswer(q,entities,data);
    }

    return {
      title:`Saved statistics: ${entity.name}`,
      body:`Current: <strong>${fmt(stats.current)}</strong><br>Average: <strong>${fmt(stats.average)}</strong><br>Median: <strong>${fmt(stats.median)}</strong><br>Highest saved: <strong>${fmt(stats.high)}</strong><br>Lowest saved: <strong>${fmt(stats.low)}</strong><br>Current percentile: <strong>${Math.round(stats.percentile*100)}th</strong><br>Consecutive-point volatility: <strong>${volatility===null?'not enough data':pct(volatility)}</strong>.`,
      evidence:`${savedHistoryDurationText(stats.memoryMeta)} · ${stats.points} saved points · Largest rise ${moves.maxRise?pct(moves.maxRise.change):'N/A'} · Largest fall ${moves.maxFall?pct(moves.maxFall.change):'N/A'}.`
    };
  }

  const rows=(data?.commodities||[]).map(c=>{
    const stats=historicalStatsFor(data,result,c.key);
    if(!stats) return null;
    return {
      key:c.key,name:c.name,stats,
      volatility:priceSeriesVolatility(stats.series)||0
    };
  }).filter(Boolean);

  if(!rows.length) return null;

  let sorted,title,metric;
  if(/volatile|volatility/.test(q)){
    sorted=rows.sort((a,b)=>b.volatility-a.volatility);
    title='Most volatile saved markets';
    metric=x=>pct(x.volatility);
  }else if(/lowest average|cheapest average/.test(q)){
    sorted=rows.sort((a,b)=>a.stats.average-b.stats.average);
    title='Lowest average saved prices';
    metric=x=>fmt(x.stats.average);
  }else if(/highest average|most expensive|highest.*mean/.test(q)){
    sorted=rows.sort((a,b)=>b.stats.average-a.stats.average);
    title='Highest average saved prices';
    metric=x=>fmt(x.stats.average);
  }else{
    sorted=rows.sort((a,b)=>b.stats.percentile-a.stats.percentile);
    title='Cross-market saved statistics';
    metric=x=>`${Math.round(x.stats.percentile*100)}th percentile`;
  }

  return {
    title,
    body:sorted.slice(0,5).map((x,i)=>`${i+1}. <strong>${x.name}</strong> — ${metric(x)}`).join('<br>'),
    evidence:'Calculated only from prices saved by this advisor; missing scans remain gaps.'
  };
}

function portfolioCategoryAnswer(q,data,result){
  if(/33%|50%|33 percent|50 percent|cap|maximum per commodity/.test(q)) return capAnswer(result);

  const plan=result?.portfolioPlan||{};
  if(/worth.*trade|trade.*worth|too many trade|trades left|opportunity cost|wasting.*trade/.test(q)){
    const candidate=plan.candidateTrades||plan.trades||[];
    const recommended=plan.recommendedTrades||[];
    return {
      title:plan.opportunityCostDecision||result.action,
      body:`The candidate plan uses ${candidate.length} trade${candidate.length===1?'':'s'} with ${plan.tradesRemaining??data.tradesRemaining??'—'} left and reserves ${plan.tradeReserve??'—'}. It projects ${fmt(plan.projectedImprovement||0)} (${pct(plan.improvementPct||0)}) of improvement. ${plan.meaningfulRebalance?`${recommended.length} trade${recommended.length===1?' is':'s are'} actionable.`:'The candidate was rejected, so no immediate trades are recommended.'}`,
      evidence:`Required overall edge ${pct(plan.requiredOverallPct||0)} · Required gain per trade ${fmt(plan.requiredGainPerTrade||0)}.`
    };
  }

  if(/cash|stay out|wait|owning nothing/.test(q)){
    const qualifying=(result?.commodityOptions||[]).filter(o=>o.inManualBuyZone&&!o.inSellZone).sort((a,b)=>b.score-a.score);
    return {
      title:qualifying.length?'Cash remains a valid allocation.':'Wait in cash is valid.',
      body:qualifying.length
        ? `${qualifying.length} commodities are in buy zones, led by ${qualifying[0].name}. Cash should still cover any allocation that lacks a clean opportunity or would require a trade that fails the opportunity-cost test.`
        : 'No commodity currently qualifies strongly enough to force a purchase.',
      evidence:`Cash ${fmt(data.cash||0)} · Current portfolio action ${result.action} · Clean candidates ${qualifying.map(x=>x.name).join(', ')||'none'}.`
    };
  }

  const allocations=(plan.allocations||[]).map(a=>`${a.name} ${Math.round((a.pct||0)*100)}%`).join(', ');
  return {
    title:`Portfolio decision: ${result.action}`,
    body:`The authoritative recommendation comes from the capped portfolio plan, not an uncapped single-commodity thought experiment. ${allocations?`Current proposed allocation: ${allocations}.`:''}`,
    evidence:`Decision confidence ${result.decisionConfidence}% · Data confidence ${result.dataConfidence}% · Risk ${result.risk} · ${plan.opportunityCostDecision||''}.`
  };
}

function eventsCategoryAnswer(q,entities,data,result){
  const specific=specificEventKnowledgeAnswer(q,result,data);
  if(specific) return specific;

  if(/showing|positive|negative|decreas|drop|fell|rose|bullish|bearish|sign|wrong/.test(q)){
    const direction=eventDirectionQuestionAnswer(q,entities,result,data);
    if(direction) return direction;
  }

  const nuanced=eventVersusWaitAnswer(q,entities,result,data);
  if(nuanced) return nuanced;

  const active=data?.events||[];
  return {
    title:active.length?'Active market events':'No active event detected',
    body:active.length
      ? `Active events: ${active.join('; ')}. Ask what an event means, which commodities it may affect, or whether to buy a named commodity now or wait.`
      : 'The current market snapshot does not contain an active event.',
    evidence:`Tracked event profiles: ${Object.keys(result?.eventMemory?.profiles||{}).length}.`
  };
}

function rankingContextFromData(data){
  if(data?.ranking?.current) return data.ranking;

  const rows=[...(data?.leaderboard||[])].sort((a,b)=>a.rank-b.rank);
  const index=rows.findIndex(r=>r.isCurrentUser);
  if(index<0) return null;

  const current=rows[index];
  const above=index>0?rows[index-1]:null;
  const below=index<rows.length-1?rows[index+1]:null;
  const gapToPass=above?Math.max(0,above.portfolio-current.portfolio+1):0;

  return {
    current,above,below,
    gapToPass,
    gapToAbove:above?Math.max(0,above.portfolio-current.portfolio):0,
    leadOverBelow:below?Math.max(0,current.portfolio-below.portfolio):0,
    requiredPctToPass:current.portfolio>0?gapToPass/current.portfolio:0
  };
}

function rankingGoalFromQuestion(q,ranking){
  if(/protect|defend|hold.*rank|stay.*(?:place|rank)|avoid.*drop/.test(q)) return 'protect';
  if(/maximize|highest final|win|first place|go for first/.test(q)) return 'maximize';
  if(/catch|pass|overtake|trailing|behind|recuperate|recover|move up|next rank/.test(q)) return 'catch';
  return ranking?.current?.rank===1?'protect':'catch';
}

function rankingCategoryAnswer(q,data,result){
  const r=rankingContextFromData(data);
  if(!r?.current){
    return {
      title:'Current leaderboard position was not found.',
      body:'The parser needs the logged-in profile ID and a matching leaderboard row from the same Black Market capture.',
      evidence:`Parsed leaderboard rows: ${(data?.leaderboard||[]).length}.`
    };
  }

  const goal=rankingGoalFromQuestion(q,r);
  const plan=result?.portfolioPlan||{};
  const mode=String(document.getElementById('mode')?.value||'balanced');
  const timeText=data?.timeRemaining||'time remaining unavailable';
  const trades=data?.tradesRemaining;
  const candidates=(result?.commodityOptions||[])
    .filter(o=>o.inManualBuyZone&&!o.inSellZone)
    .sort((a,b)=>b.score-a.score)
    .slice(0,3);
  const candidateText=candidates.length
    ? candidates.map(x=>`${x.name} (${pct(x.upsidePct||0)} target upside)`).join(', ')
    : 'no clean buy-zone candidates';

  if(r.current.rank===1){
    return {
      title:'Ranking strategy: defend first place',
      body:`You are currently #1 with ${fmt(r.current.portfolio)}. ${r.below?`Your lead over ${r.below.player} is ${fmt(r.leadOverBelow)}.`:''} Do not add risk merely to increase an already winning score. Follow the normal capped portfolio plan and protect the lead unless a rebalance independently clears the opportunity-cost test.`,
      evidence:`Goal ${goal} · Time remaining ${timeText} · Mode ${mode} · Trades remaining ${Number.isFinite(trades)?trades:'unknown'} · Portfolio action ${result.action}.`
    };
  }

  const required=r.requiredPctToPass||0;
  const cushionPct=r.current.portfolio>0?(r.leadOverBelow||0)/r.current.portfolio:0;
  const urgency=required<=.03?'small':required<=.10?'moderate':'large';
  let strategy;

  if(goal==='protect'){
    strategy=`Protect the current rank. Your cushion over ${r.below?.player||'the player below'} is ${fmt(r.leadOverBelow||0)} (${pct(cushionPct)} of your portfolio). Avoid a speculative rotation unless the normal portfolio engine independently recommends it.`;
  }else{
    strategy=`To pass ${r.above?.player||'the player above'} at the current standings, you need about ${fmt(r.gapToPass)} of relative outperformance, equal to ${pct(required)} of your current portfolio. That is a ${urgency} gap.`;
    if(plan.meaningfulRebalance && (plan.recommendedTrades||[]).length){
      strategy+=` The current capped plan supports controlled aggression because it already clears the trade-cost test; use only its ${plan.recommendedTrades.length} recommended trade${plan.recommendedTrades.length===1?'':'s'}.`;
    }else{
      strategy+=` The current portfolio plan does not justify a rebalance, so do not force a high-risk move solely because of the leaderboard.`;
    }
  }

  return {
    title:`Ranking strategy: ${goal==='protect'?'protect #'+r.current.rank:'chase #'+(r.above?.rank||r.current.rank-1)}`,
    body:`You are <strong>#${r.current.rank}</strong> with <strong>${fmt(r.current.portfolio)}</strong>. ${strategy} Current clean opportunities: ${candidateText}. Remember that the player above can also gain, so ${pct(required)} is the minimum relative gap—not a guaranteed winning return.`,
    evidence:`Above: ${r.above?`${r.above.player} ${fmt(r.above.portfolio)}`:'none'} · Below: ${r.below?`${r.below.player} ${fmt(r.below.portfolio)}`:'none'} · Time remaining ${timeText} · Mode ${mode} · Trades remaining ${Number.isFinite(trades)?trades:'unknown'} · Portfolio decision ${result.action}.`
  };
}

function categoryPrompt(category){
  const examples={
    history:'Ask about a commodity’s saved high, low, date, threshold crossing, or history span.',
    comparison:'Name two commodities to compare.',
    switch:'Name the holding to sell and the commodity to buy.',
    exit:'Name the holding and ask when or whether to sell it.',
    entry:'Name the commodity and ask whether to buy now or wait.',
    events:'Name an active event or a commodity affected by it.',
    statistics:'Name a commodity or ask for a cross-market statistic such as volatility.',
    portfolio:'Ask about the capped allocation, cash, trades, or current plan.',
    ranking:'Ask how to catch the next rank, protect your position, or maximize final value.'
  };
  return {title:`More detail needed for ${advisorCategoryLabel(category)}.`,body:examples[category]||'Add a specific market question.',evidence:'The selected dropdown category controls the answer engine.'};
}

function routeAdvisorCategory(category,q,entities,data,result){
  if(category==='history') return historicalPriceAnswer(q,entities,data,result) || categoryPrompt(category);
  if(category==='comparison') return comparisonCategoryAnswer(q,entities,data,result) || categoryPrompt(category);
  if(category==='switch') return switchDecisionAnswer(q,entities,data,result) || categoryPrompt(category);
  if(category==='exit') return exitStrategyAnswer(q,entities,data,result) || categoryPrompt(category);
  if(category==='entry') return entryStrategyAnswer(q,entities,data,result) || categoryPrompt(category);
  if(category==='events') return eventsCategoryAnswer(q,entities,data,result) || categoryPrompt(category);
  if(category==='statistics') return statisticsCategoryAnswer(q,entities,data,result) || categoryPrompt(category);
  if(category==='portfolio') return portfolioCategoryAnswer(q,data,result) || categoryPrompt(category);
  if(category==='ranking') return rankingCategoryAnswer(q,data,result) || categoryPrompt(category);
  return null;
}

function decorateAdvisorAnswer(answer,category,selectedCategory){
  if(!answer) return answer;
  return {
    ...answer,
    category:advisorCategoryLabel(category),
    categorySource:selectedCategory&&selectedCategory!=='auto'?'selected':'auto-detected'
  };
}

function askAdvisor(question,selectedCategory='auto'){
  const q=normalizeQuestion(question);
  if(!q){
    return {
      title:'Ask me something about the advisor or current assessment.',
      body:'Choose a question type, then enter the details. Auto-detect remains available.',
      evidence:'Examples: “Highest Uranium price?”, “Should I sell Uranium and buy Military Hardware?”, or “How do I catch the next rank?”'
    };
  }

  const requested=String(selectedCategory||'auto').toLowerCase();
  const knowledgeAnswer=advisorKnowledgeAnswer(q,lastData,lastResult);
  if(requested==='auto' && knowledgeAnswer) return decorateAdvisorAnswer(knowledgeAnswer,'auto','auto');

  if(!lastData || !lastResult){
    if(knowledgeAnswer) return decorateAdvisorAnswer(knowledgeAnswer,'auto',requested);
    return {
      title:'Analyze the market first.',
      body:'This category needs a current Black Market snapshot.',
      evidence:'The Ranking category also requires the leaderboard and logged-in user identity from the captured page.'
    };
  }

  let entities=findQuestionEntities(q);
  if(!entities.length && advisorLastEntity && /it|its|that|this commodity|same one/.test(q)){
    entities=[{key:advisorLastEntity,name:nameFor(advisorLastEntity),index:-1}];
  }
  if(entities.length) advisorLastEntity=entities[0].key;

  const category=requested==='auto' ? detectAdvisorCategory(q,entities) : requested;
  const routed=routeAdvisorCategory(category,q,entities,lastData,lastResult);
  if(routed) return decorateAdvisorAnswer(routed,category,requested);

  const fallback=entities.length
    ? explainCommodity(optionForKey(lastResult,entities[0].key),lastResult,q)
    : {
        title:'I need a more specific market question.',
        body:'Name a commodity, event, comparison, decision, statistic, or ranking goal.',
        evidence:'The selected dropdown category controls which engine handles the question.'
      };

  return decorateAdvisorAnswer(fallback,category,requested);
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
  const category=ans.category
    ? `<div class="mini" style="margin-bottom:8px">Question type: <strong>${ans.category}</strong>${ans.categorySource?` (${ans.categorySource})`:''}</div>`
    : '';

  box.innerHTML=`${category}<div class="answer-title">${ans.title}</div><div>${ans.body}</div>${ans.evidence?`<div class="advisor-evidence"><strong>Data behind the answer:</strong> ${ans.evidence}</div>`:''}`;
}
function submitAdvisorQuestion(text,categoryOverride){
  const q=(text ?? (document.getElementById('advisorQuestion')?.value || '')).trim();
  const category=categoryOverride || document.getElementById('advisorCategory')?.value || 'auto';

  if(document.getElementById('advisorQuestion')) document.getElementById('advisorQuestion').value=q;
  renderAdvisorAnswer(askAdvisor(q,category));
}

function ensureAdvisorCategoryDropdown(){
  const question=document.getElementById('advisorQuestion');
  if(!question) return;

  const placeholders={
    auto:'Ask naturally; the advisor will select the answer engine.',
    history:'Example: When was Uranium last above $40,000?',
    comparison:'Example: Compare Uranium and Military Hardware.',
    switch:'Example: Should I sell Uranium and buy Military Hardware?',
    exit:'Example: When should I sell Uranium?',
    entry:'Example: Should I buy Pills now or wait?',
    events:'Example: What does Police raid on the docks do?',
    statistics:'Example: Which commodity has been most volatile?',
    portfolio:'Example: Is the current rebalance worth the trades?',
    ranking:'Example: I am trailing the next rank—how should I recover?'
  };

  let select=document.getElementById('advisorCategory');

  // Older index files do not contain the dropdown, so keep a JS fallback.
  if(!select){
    const chat=question.closest('.advisor-chat')||question.parentElement;
    if(!chat) return;

    const row=document.createElement('div');
    row.id='advisorCategoryRow';
    row.style.cssText='display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px 0;';

    const label=document.createElement('label');
    label.htmlFor='advisorCategory';
    label.textContent='Question type';
    label.style.cssText='font-weight:700;';

    select=document.createElement('select');
    select.id='advisorCategory';
    select.style.cssText='min-width:210px;max-width:100%;padding:10px 12px;border-radius:10px;background:#101722;color:inherit;border:1px solid #34415a;';

    for(const [value,text] of ADVISOR_CATEGORIES){
      const option=document.createElement('option');
      option.value=value;
      option.textContent=text;
      select.appendChild(option);
    }

    row.append(label,select);
    chat.parentElement?.insertBefore(row,chat);
  }

  const saved=localStorage.getItem('bm_advisor_question_category');
  if(ADVISOR_CATEGORIES.some(x=>x[0]===saved)) select.value=saved;

  const refreshPlaceholder=()=>{
    question.placeholder=placeholders[select.value]||placeholders.auto;
    localStorage.setItem('bm_advisor_question_category',select.value);
  };

  if(select.dataset.advisorCategoryBound!=='1'){
    select.addEventListener('change',refreshPlaceholder);
    select.dataset.advisorCategoryBound='1';
  }

  refreshPlaceholder();
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',ensureAdvisorCategoryDropdown,{once:true});
}else{
  ensureAdvisorCategoryDropdown();
}