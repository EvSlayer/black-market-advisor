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


