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
  const candidateTrades = trades.slice();
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
  const gainPerTrade=candidateTrades.length?projectedImprovement/candidateTrades.length:0;

  // Opportunity-cost test: a mathematically better portfolio is not automatically
  // worth spending scarce trades on. The required edge rises with the number of
  // trades consumed, while still allowing a truly exceptional switch through.
  const requiredOverallPct = Math.max(.08, candidateTrades.length*.03);
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
  const overBudget=candidateTrades.length>actionableTradeBudget;
  const deferredTrades=overBudget ? candidateTrades.slice(actionableTradeBudget) : [];
  const executableCandidateTrades=candidateTrades.slice(0,actionableTradeBudget);
  const recommendedTrades=meaningfulRebalance ? executableCandidateTrades : [];
  // Keep `trades` as the candidate plan for backward-compatible diagnostics.
  // Public/actionable surfaces must use `recommendedTrades`.
  trades=candidateTrades;

  const currentMixDistance=allocations.reduce((s,a)=>s+Math.abs((currentByKey[a.key]||0)-a.dollars),0) + holdingValues.filter(h=>!targetByKey[h.key]).reduce((s,h)=>s+(h.value||0),0);
  const nearPlan=currentMixDistance <= currentValue*.05;
  let headline='WAIT IN CASH';
  if(selected.length && (nearPlan || !meaningfulRebalance)) headline='HOLD CURRENT MIX';
  else if(selected.length && actionableTradeBudget>0) headline='REBALANCE PORTFOLIO';
  else if(selected.length) headline='HOLD CURRENT MIX';
  return {cap,allocations,trades,candidateTrades,recommendedTrades,selected,eligibleCount:eligible.length,cashPct,nearPlan,headline,tradesRemaining,tradeReserve,actionableTradeBudget,overBudget,deferredTrades,projectedCurrent,projectedPlan,projectedImprovement,improvementPct,gainPerTrade,meaningfulRebalance,requiredOverallPct,requiredGainPerTradePct,requiredGainPerTrade,opportunityCostDecision,protectedLossKeys:[...protectedLossKeys],lossNotes};
}
