function advisorRecentPriceTrend(commodity, points=8){
  const source=(
    commodity?.sparkHistory?.length
      ? commodity.sparkHistory
      : commodity?.history||[]
  )
    .map(Number)
    .filter(value=>Number.isFinite(value)&&value>0);

  if(source.length<2){
    return {pct:0,label:'insufficient recent history',points:source.length};
  }

  const end=Number(commodity?.price||source[source.length-1]);
  const start=source[Math.max(0,source.length-1-Math.max(1,points))];
  const pctChange=start>0 ? end/start-1 : 0;

  return {
    pct:pctChange,
    label:pctChange<=-.025?'falling':pctChange>=.025?'rising':'mostly flat',
    points:source.length
  };
}

function analyze(data){
  const assumptions=getAssumptions(data), params=modeParams();
  const eventMemory = updateEventMemory(data);
  const purchaseExclusionKeys=new Set(
    typeof loadPurchaseExclusions==='function'
      ? loadPurchaseExclusions()
      : []
  );
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
    const recentTrend = advisorRecentPriceTrend(c,8);

    // Hard block: a directly targeted bearish event remains active.
    // Caution block: a directly targeted ambiguous event has multiple active
    // copies and the current price is still falling.
    const hardEventBlock=Boolean(eventSignal.activeTargetedBearish);
    const cautionEventBlock=Boolean(
      eventSignal.activeTargetedCaution &&
      recentTrend.pct<=-.02
    );
    const buyBlockedByEvent=hardEventBlock||cautionEventBlock;
    const blockingEvent=(
      eventSignal.blockingSignals?.[0] ||
      eventSignal.cautionSignals?.[0] ||
      null
    );
    const eventBlockLevel=hardEventBlock?'hard':cautionEventBlock?'caution':'none';
    const copies=Number(
      blockingEvent?.activeCopies ||
      eventSignal.maxActiveCopies ||
      1
    );
    const eventBlockReason = buyBlockedByEvent
      ? hardEventBlock
        ? `${blockingEvent?.name||'Active targeted bearish event'} remains active${copies>1?` (${copies} copies)`:''}`
        : `${blockingEvent?.name||'Active targeted event'} has ${copies} active copies while the recent price trend is still falling`
      : '';

    const purchaseExcluded=purchaseExclusionKeys.has(c.key);

    // Thresholds remain useful for diagnostics, but event and user guards control
    // whether a price is actually actionable.
    const learnedEventAdj = eventSignal.confidence>=.45
      ? Math.max(-.12,Math.min(.10,eventSignal.effect*.55))
      : 0;
    const eventAdj = hardEventBlock
      ? Math.max(-.25,Math.min(-.15,eventSignal.effect*.75))
      : cautionEventBlock
        ? Math.min(-.10,learnedEventAdj)
        : learnedEventAdj;

    const buyThreshold = baseBuyThreshold * (1 + eventAdj);
    const sellThreshold = baseSellThreshold * (1 + eventAdj*.65);
    const sellThresholdRatio = sellThreshold > 0 ? c.price / sellThreshold : 0;
    const inSellZone = isValidMoney(sellThreshold) && c.price >= sellThreshold;
    const buyThresholdRatio = buyThreshold > 0 ? c.price / buyThreshold : Infinity;
    const priceInBuyZone = isValidMoney(buyThreshold) && c.price <= buyThreshold * params.buyThresholdFactor;
    const actionableBuyZone =
      priceInBuyZone &&
      !buyBlockedByEvent &&
      !purchaseExcluded;
    // Keep the legacy property aligned with what is actually buyable.
    const inManualBuyZone = actionableBuyZone;
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
    if(hardEventBlock) score -= 35;
    else if(cautionEventBlock) score -= 24;
    if(purchaseExcluded) score -= 40;
    score = Math.max(0,Math.min(100,score));
    return {
      type:'commodity',
      key:c.key,
      name:c.name,
      price:c.price,
      history:hist,
      target,
      min,
      avg,
      baseBuyThreshold,
      baseSellThreshold,
      buyThreshold,
      sellThreshold,
      eventSignal,
      eventAdjustment:eventAdj,
      recentTrend,
      buyBlockedByEvent,
      hardEventBlock,
      cautionEventBlock,
      eventBlockLevel,
      eventBlockReason,
      purchaseExcluded,
      purchaseExclusionReason:purchaseExcluded?'Excluded from new purchases by user':'',
      sellThresholdRatio,
      inSellZone,
      buyThresholdRatio,
      priceInBuyZone,
      inManualBuyZone,
      actionableBuyZone,
      heldQty:held?.qty||0,
      avgBuy:held?.avgBuy||0,
      tradesNeeded,
      buyQty,
      expectedValue,
      improvement,
      improvementPct,
      upsidePct,
      pos,
      rareHigh,
      score
    };
  });
  const splitOptions = [];
  if(allocationMode()==='split'){
    const splitCandidates = commodityOptions
      .filter(o=>!currentHolding || o.key!==currentHolding.key)
      .filter(o=>!o.buyBlockedByEvent && !o.purchaseExcluded)
      .filter(o=>o.actionableBuyZone || o.pos <= Math.max(params.buyZone+.10,.58))
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
      if(o.buyBlockedByEvent) o.decisionRank -= currentValue*0.75;
      if(o.purchaseExcluded) o.decisionRank -= currentValue*0.90;
    }
  });
  options.sort((a,b)=>b.decisionRank-a.decisionRank || b.expectedValue-a.expectedValue || b.score-a.score);

  const best = options[0];
  const bestSwitch = commodityOptions
    .filter(o=>!o.buyBlockedByEvent && !o.purchaseExcluded)
    .filter(o=>!(meaningfulHoldings.length===1 && currentHolding && o.key===currentHolding.key))
    .sort((a,b)=>b.expectedValue-a.expectedValue || b.score-a.score)[0];
  const bestGrowth = options
    .filter(o=>!['cash','portfolio'].includes(o.type))
    .filter(o=>!o.buyBlockedByEvent && !o.purchaseExcluded)
    .filter(o=>!(meaningfulHoldings.length===1 && currentHolding && o.key===currentHolding.key))
    .sort((a,b)=>b.decisionRank-a.decisionRank || b.expectedValue-a.expectedValue || b.score-a.score)[0] || bestSwitch;
  const thresholdDollar = currentValue * params.minImproveDollar;
  const thresholdPct = params.minImprovePct;
  const rawSwitchCompelling = !!(bestSwitch && bestSwitch.vsHold > thresholdDollar && (bestSwitch.vsHold/currentValue) > thresholdPct);

  // A separate cash/take-profit trigger. This fires when the current holding is rich enough
  // to review, even if there is another theoretical switch with upside. This prevents
  // "sell winner and force-buy the next best thing" when the replacement is not in a good entry zone.
  const inSellZone = !!(currentOpt && (currentOpt.pos >= params.sellZone || currentOpt.price >= currentOpt.target*params.sellZone));
  const profitWorthProtecting = !!(currentOpt && currentOpt.avgBuy && currentProfitPct >= params.minProfitForCash);
  const upsideLimited = !!(currentOpt && currentRemainingUpside <= params.maxUpsideForCash);
  const replacementInBuyZone = !!(bestSwitch && bestSwitch.actionableBuyZone);
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
  const bestCashBuyIsClean = !!(bestSwitch && bestSwitch.actionableBuyZone);

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
  const portfolioPlan = buildPortfolioPlan(
    data,
    commodityOptions,
    currentValue,
    holdingValues,
    {excludedKeys:[...purchaseExclusionKeys]}
  );
  // The 50%-cap portfolio plan is the single source of truth for public advice.
  // Legacy single-stock analysis remains available only as explicitly theoretical support.
  const legacyDecision = {action, chosen, risk: null, sellPressure, edge, edgePct};
  action = portfolioPlan.headline;
  const recommendedTrades = portfolioPlan.recommendedTrades || [];
  const actionableImprovement = portfolioPlan.meaningfulRebalance ? portfolioPlan.projectedImprovement : 0;
  const actionableImprovementPct = portfolioPlan.meaningfulRebalance ? portfolioPlan.improvementPct : 0;

  if(action==='REBALANCE PORTFOLIO') {
    decisionConfidence = Math.max(60, Math.min(94, 60 + portfolioPlan.selected.length*9 + Math.min(7, recommendedTrades.length)));
  } else if(action==='HOLD CURRENT MIX') {
    decisionConfidence = Math.max(68, decisionConfidence||68);
  } else if(action==='WAIT IN CASH') {
    decisionConfidence = Math.max(58, Math.min(88, 62 + (3-portfolioPlan.selected.length)*6));
  }

  const pressureRank = {None:0,Low:1,Medium:2,'Medium-High':3,High:4};
  const portfolioSellPressure = positionAssessments.reduce((highest,p)=>
    pressureRank[p.sellPressure] > pressureRank[highest] ? p.sellPressure : highest, 'None');
  const risk = action==='WAIT IN CASH'
    ? 'Medium'
    : action==='REBALANCE PORTFOLIO'
      ? (portfolioPlan.overBudget ? 'High' : portfolioPlan.improvementPct < .12 ? 'Medium' : 'Low')
      : pressureRank[portfolioSellPressure] >= 3 ? 'Medium' : 'Low';
  sellPressure = portfolioSellPressure;

  const dataPoints = Math.max(...data.commodities.map(c=>c.history?.length||0),0);
  const dataConfidence = Math.round(Math.max(15, Math.min(92, 20 + dataPoints*0.9)));
  const primaryDecision = {
    action,
    recommendedTrades,
    actionableImprovement,
    actionableImprovementPct,
    risk,
    sellPressure,
    selected: action==='REBALANCE PORTFOLIO' ? portfolioPlan.selected : positionAssessments.map(p=>p.option),
    candidatePlan: {
      allocations: portfolioPlan.allocations,
      trades: portfolioPlan.candidateTrades || portfolioPlan.trades || [],
      projectedImprovement: portfolioPlan.projectedImprovement,
      improvementPct: portfolioPlan.improvementPct,
      opportunityCostDecision: portfolioPlan.opportunityCostDecision
    }
  };

  const eventBlockedOptions=commodityOptions.filter(o=>o.buyBlockedByEvent);
  const purchaseExcludedOptions=commodityOptions.filter(o=>o.purchaseExcluded);

  return {options,commodityOptions,splitOptions,cashOption,currentOpt,best,bestSwitch,bestGrowth,chosen,legacyDecision,primaryDecision,recommendedTrades,actionableImprovement,actionableImprovementPct,action,currentValue,params,allocationMode:allocationMode(),decisionConfidence,dataConfidence,risk,thresholdDollar,thresholdPct,baselineExpected,currentProfitPct,currentRemainingUpside,cashCompelling,switchCompelling,rawSwitchCompelling,replacementInBuyZone,replacementExtremeEdge,currentOverExtended,sellPressure,bestCashBuyIsClean,holdingValues,meaningfulHoldings,ignoredDust,dustThreshold,majorThresholdPct,positionAssessments,portfolioOpt,dominantHolding,portfolioPlan,eventMemory,eventBlockedOptions,purchaseExclusions:[...purchaseExclusionKeys],purchaseExcludedOptions};
}