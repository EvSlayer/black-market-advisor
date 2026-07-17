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
