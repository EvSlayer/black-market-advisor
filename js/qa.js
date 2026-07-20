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
    body=`The case is based on the current entry, not a promise about the next tick. ${o.name} is ${entryLabel(o)}, at ${fmt(o.price)} versus a buy threshold of ${fmt(o.buyThreshold)}, and has an estimated target of ${fmt(o.target)} (${pct(upside)} upside). It ranks #${rank||'—'} among commodities. ${expectedAtTarget?`As an uncapped thought experiment, full exposure at this price would have a target-equivalent value near ${fmt(expectedAtTarget)}. That is not a recommendation: the actionable portfolio remains limited to 33% per commodity and must pass the trade-cost test.`:''}`;
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
      (c.history||[]).filter(v=>Number.isFinite(Number(v)) && Number(v)>0).length
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

function commodityPriceSeries(data,result,key){
  const c=commodityFromData(data,key);
  const o=optionForKey(result,key);

  // Prefer the longest history available. The current price is appended only
  // when it is not already the final point.
  const candidates=[
    validPriceSeries(c?.history),
    validPriceSeries(o?.history)
  ].sort((a,b)=>b.length-a.length);

  const series=[...(candidates[0]||[])];
  const current=Number(c?.price ?? o?.price ?? 0);
  if(Number.isFinite(current) && current>0 && series[series.length-1]!==current){
    series.push(current);
  }
  return series;
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
  return {
    series,sorted,current,high,low,average,median,percentile,
    points:series.length,highIndex,lowIndex,
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

function historicalPriceAnswer(q,entities,data,result){
  if(!entities?.length) return null;
  const entity=entities[0];
  const stats=historicalStatsFor(data,result,entity.key);
  if(!stats) return {
    title:`No recorded price history for ${entity.name}`,
    body:'The advisor does not currently have usable captured prices for this commodity.',
    evidence:'The advisor only reports prices it has actually received; it does not invent missing history.'
  };

  const wantsHigh=/highest|all[ -]?time high|record high|peak|maximum|ever been/.test(q) && !/change|rise|jump|gain/.test(q);
  const wantsLow=/lowest|all[ -]?time low|record low|bottom|minimum/.test(q) && !/change|fall|drop|loss/.test(q);
  const wantsAverage=/average|mean|typical/.test(q);
  const wantsMedian=/median/.test(q);
  const wantsPercentile=/percentile|how cheap|how expensive/.test(q);
  const wantsSummary=/history|statistics?|stats?|summary/.test(q);
  const threshold=extractAskedPrice(q);
  const asksAbove=/above|over|higher than|crossed|hit/.test(q);
  const asksBelow=/below|under|lower than/.test(q);
  const asksCount=/how many times|times has|times did/.test(q);
  const currentPctOfHigh=stats.currentVsHigh*100;

  if(threshold && (asksAbove || asksBelow)){
    const matches=stats.series.filter(v=>asksBelow ? v<threshold : v>threshold).length;
    const relation=asksBelow?'below':'above';
    return {
      title:`${entity.name}: recorded prices ${relation} ${fmt(threshold)}`,
      body:asksCount
        ? `${entity.name} appears ${matches} time${matches===1?'':'s'} ${relation} ${fmt(threshold)} in the captured price points available to this advisor.`
        : `${matches>0?'Yes':'No'}—the advisor ${matches>0?'has':'has not'} recorded ${entity.name} ${relation} ${fmt(threshold)} in its available history.${matches>0?` It occurred in ${matches} captured point${matches===1?'':'s'}.`:''}`,
      evidence:`${stats.points} captured price points · Recorded range ${fmt(stats.low)}–${fmt(stats.high)}. Captures are observations, not guaranteed evenly spaced intervals.`
    };
  }

  if(wantsHigh){
    return {
      title:`Highest recorded price: ${entity.name}`,
      body:`The highest price available to this advisor is <strong>${fmt(stats.high)}</strong>. The current price is ${fmt(stats.current)}, which is ${currentPctOfHigh.toFixed(1)}% of that recorded high.`,
      evidence:`Based on ${stats.points} captured price points · Recorded low ${fmt(stats.low)} · Average ${fmt(stats.average)}. “Recorded high” means the highest price the advisor has seen, not a guaranteed game-wide maximum.`
    };
  }

  if(wantsLow){
    return {
      title:`Lowest recorded price: ${entity.name}`,
      body:`The lowest price available to this advisor is <strong>${fmt(stats.low)}</strong>. The current price is ${fmt(stats.current)}, or ${pct(stats.currentVsLow)} above that recorded low.`,
      evidence:`Based on ${stats.points} captured price points · Recorded high ${fmt(stats.high)} · Median ${fmt(stats.median)}.`
    };
  }

  if(wantsAverage && !wantsMedian){
    return {
      title:`Average recorded price: ${entity.name}`,
      body:`The arithmetic average of the available captured prices is <strong>${fmt(stats.average)}</strong>. The current price is ${fmt(stats.current)}, ${stats.current>=stats.average?pct(stats.current/stats.average-1)+' above':pct(1-stats.current/stats.average)+' below'} that average.`,
      evidence:`${stats.points} captured price points · Median ${fmt(stats.median)} · Range ${fmt(stats.low)}–${fmt(stats.high)}.`
    };
  }

  if(wantsMedian){
    return {
      title:`Median recorded price: ${entity.name}`,
      body:`The median captured price is <strong>${fmt(stats.median)}</strong>. Half of the available observations are at or below it and half are at or above it.`,
      evidence:`Current ${fmt(stats.current)} · Average ${fmt(stats.average)} · ${stats.points} captured price points.`
    };
  }

  if(wantsPercentile){
    return {
      title:`Historical position: ${entity.name}`,
      body:`At ${fmt(stats.current)}, ${entity.name} is around the <strong>${Math.round(stats.percentile*100)}th percentile</strong> of the available captured history. In plain terms, about ${Math.round(stats.percentile*100)}% of recorded prices were at or below the current price.`,
      evidence:`Recorded low ${fmt(stats.low)} · Median ${fmt(stats.median)} · High ${fmt(stats.high)} · ${stats.points} points.`
    };
  }

  if(wantsSummary){
    return {
      title:`Recorded price statistics: ${entity.name}`,
      body:`Current: <strong>${fmt(stats.current)}</strong><br>Highest recorded: <strong>${fmt(stats.high)}</strong><br>Lowest recorded: <strong>${fmt(stats.low)}</strong><br>Average: <strong>${fmt(stats.average)}</strong><br>Median: <strong>${fmt(stats.median)}</strong><br>Current percentile: <strong>${Math.round(stats.percentile*100)}th</strong>.`,
      evidence:`Calculated from ${stats.points} captured price points. Missing scans remain gaps, and the values describe the advisor’s observed history rather than the game’s official lifetime record.`
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
      evidence:'The active interface limits a single commodity to 50% of the portfolio.'
    };
  }

  if(/50%|50 percent|fifty percent|portfolio cap|maximum per commodity/.test(q)){
    return {
      title:'50% portfolio cap',
      body:'The advisor allows no more than 50% of the portfolio in one commodity. The rule reduces single-commodity risk while still allowing a strong position. Any remainder can be spread among other qualifying commodities or held as cash.',
      evidence:'Current portfolio rule: 50% maximum per commodity.'
    };
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
      body:'You can ask about page sections, current commodities, comparisons, active events, thresholds, cash, trade cost, portfolio allocations, saved history, confidence, and holding versus switching. Historical questions are also supported, such as “What is the highest Uranium has been?”, “What is Pills’ average price?”, “Has Art been above $30k?”, and “Show me Uranium statistics.”',
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
function askAdvisor(question){
  const q=normalizeQuestion(question);
  if(!q) return {title:'Ask me something about the advisor or current assessment.',body:'For example: “How long is the sparkline?”, “Explain Move Records,” “Why Pills?”, or “Is this worth the trades?”',evidence:''};

  const knowledgeAnswer=advisorKnowledgeAnswer(q,lastData,lastResult);
  if(knowledgeAnswer) return knowledgeAnswer;

  if(!lastData || !lastResult) return {title:'Analyze the market first.',body:'That question needs a current Black Market snapshot. General help questions about the advisor can be answered without one.',evidence:''};

  let entities=findQuestionEntities(q);
  if(!entities.length && advisorLastEntity && /it|its|that|this commodity|same one/.test(q)){
    entities=[{key:advisorLastEntity,name:nameFor(advisorLastEntity)}];
  }
  if(entities.length) advisorLastEntity=entities[0].key;

  // Price-history intent must run before recommendation and move-record intent.
  // “Highest uranium has ever been” means price level, while “largest uranium
  // rise” means consecutive-point movement.
  if(isHistoricalPriceQuestion(q)){
    const historyAnswer=historicalPriceAnswer(q,entities,lastData,lastResult);
    if(historyAnswer) return historyAnswer;
  }

  const specificEventAnswer=specificEventKnowledgeAnswer(q,lastResult,lastData);
  if(specificEventAnswer) return specificEventAnswer;

  if(/largest|biggest|record|highest.*change|most.*change|largest.*percent|biggest.*percent|ever.*drop|ever.*rise/.test(q)){
    const moveAns=moveRecordAnswer(q,entities,lastData);
    if(moveAns) return moveAns;
  }
  if(/33%|33 percent|thirty three|over the cap|max is 33|maximum.*33/.test(q)) return capAnswer(lastResult);
  if(/worth.*trade|trade.*worth|too many trade|trades left|opportunity cost|wasting.*trade/.test(q)){
    const p=lastResult.portfolioPlan;
    const candidateTrades=p.candidateTrades||p.trades||[];
    const recommendedTrades=p.recommendedTrades||[];
    const planLabel=p.meaningfulRebalance?'recommended rebalance':'candidate rebalance';
    return {title:p.opportunityCostDecision,body:`The ${planLabel} uses ${candidateTrades.length} trade${candidateTrades.length===1?'':'s'} with ${p.tradesRemaining} left today and reserves ${p.tradeReserve}. The projected difference is ${fmt(p.projectedImprovement)} (${pct(p.improvementPct)}), or about ${fmt(p.gainPerTrade)} per candidate trade. ${p.meaningfulRebalance?`It clears the advisor’s opportunity-cost test, so ${recommendedTrades.length} trade${recommendedTrades.length===1?' is':'s are'} actionable now.`:'It does not clear the advisor’s opportunity-cost test, so the candidate was rejected and zero trades are recommended.'}`,evidence:`Minimum edge: ${pct(p.requiredOverallPct)} overall and ${fmt(p.requiredGainPerTrade)} per trade.`};
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
    const isActionable=p.meaningfulRebalance && lastResult.action==='REBALANCE PORTFOLIO';
    const decisionText=isActionable
      ? `The recommended capped mix projects ${fmt(p.projectedPlan)} versus ${fmt(p.projectedCurrent)} for the current mix, a difference of ${fmt(p.projectedImprovement)} (${pct(p.improvementPct)}).`
      : `The optimizer tested a capped candidate mix projecting ${fmt(p.projectedPlan)} versus ${fmt(p.projectedCurrent)} for the current mix, a difference of ${fmt(p.projectedImprovement)} (${pct(p.improvementPct)}). Because that candidate did not justify the trades, it was rejected; the actionable recommendation is ${lastResult.action} with zero immediate trades.`;
    return {title:`Why the advisor says “${lastResult.action}”`,body:`The decision is built from qualifying buy zones, the 33% cap, current holdings, realized-loss protection, active event evidence, and limited trades. ${decisionText}`,evidence:`Confidence in ${lastResult.action}: ${lastResult.decisionConfidence}% · Data confidence ${lastResult.dataConfidence}% · Risk ${lastResult.risk}.`};
  }
  return {title:'I need a more specific market question.',body:'I could not confidently identify the intent. Name a commodity, event, comparison, historical statistic, or decision concern. The advisor will not convert an unclear question into a buy recommendation.',evidence:'Examples: “Highest recorded Uranium price?”, “What does Police raid on the docks do?”, “Art vs Uranium?”, “Is this worth two trades?”, or “Uranium is falling—still buy?”'};
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