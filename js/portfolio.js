const PURCHASE_EXCLUSIONS_STORAGE_KEY='bm_purchase_exclusions_v1';

function normalizePurchaseExclusionKeys(keys){
  const allowed=new Set(
    (typeof COMMODITIES!=='undefined' && Array.isArray(COMMODITIES))
      ? COMMODITIES.map(([key])=>key)
      : []
  );

  return [...new Set((keys||[])
    .map(String)
    .filter(key=>!allowed.size || allowed.has(key))
  )];
}

function loadPurchaseExclusions(){
  try{
    const parsed=JSON.parse(localStorage.getItem(PURCHASE_EXCLUSIONS_STORAGE_KEY)||'[]');
    return normalizePurchaseExclusionKeys(Array.isArray(parsed)?parsed:[]);
  }catch(error){
    return [];
  }
}

function savePurchaseExclusions(keys){
  const normalized=normalizePurchaseExclusionKeys(keys);
  localStorage.setItem(PURCHASE_EXCLUSIONS_STORAGE_KEY,JSON.stringify(normalized));
  return normalized;
}

function setPurchaseExclusion(key,excluded){
  const keys=new Set(loadPurchaseExclusions());
  if(excluded) keys.add(key);
  else keys.delete(key);
  return savePurchaseExclusions([...keys]);
}

function clearPurchaseExclusions(){
  localStorage.removeItem(PURCHASE_EXCLUSIONS_STORAGE_KEY);
  return [];
}

function purchaseExclusionNames(keys){
  return normalizePurchaseExclusionKeys(keys).map(nameFor);
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

function buildPortfolioPlan(data, commodityOptions, currentValue, holdingValues, config={}){
  const cap=.50, tolerance=.012;
  const tradesRemaining = Number.isFinite(data.tradesRemaining) ? data.tradesRemaining : 12;
  const tradeReserve = Math.min(3, Math.max(1, Math.floor(tradesRemaining*.25)));
  const actionableTradeBudget = Math.max(0, tradesRemaining-tradeReserve);
  const currentByKey=Object.fromEntries(holdingValues.map(h=>[h.key,h.value||0]));
  const optionByKey=Object.fromEntries(commodityOptions.map(o=>[o.key,o]));

  const savedExclusions=config.useSavedExclusions===false
    ? []
    : loadPurchaseExclusions();
  const requestedExclusions=normalizePurchaseExclusionKeys(config.excludedKeys||[]);
  const excludedKeys=new Set(
    config.replaceExclusions
      ? requestedExclusions
      : [...savedExclusions,...requestedExclusions]
  );
  const excludedNames=[...excludedKeys].map(nameFor);

  const eventBlocked=commodityOptions.filter(o=>o.buyBlockedByEvent);
  const userExcluded=commodityOptions.filter(o=>excludedKeys.has(o.key));
  const eligible=commodityOptions
    .filter(o=>
      o.actionableBuyZone &&
      !o.inSellZone &&
      !o.buyBlockedByEvent &&
      !excludedKeys.has(o.key)
    )
    .sort((a,b)=> (b.score-a.score) || (b.upsidePct-a.upsidePct));

  // Loss protection: do not dump an underwater position merely to chase the newest
  // buy-zone candidate. A loss position is preserved unless the replacement's
  // expected growth multiple is materially better or the holding itself is in a
  // sell/danger zone.
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

  const preserveHolding=(h,o,reason)=>{
    if(allocations.some(a=>a.key===h.key)) return;
    const pct=Math.min(
      cap,
      Math.max(0,(h.value||0)/Math.max(1,currentValue)),
      1-used
    );
    if(pct<=.0001) return;

    allocations.push({
      key:h.key,
      name:h.name,
      pct,
      dollars:currentValue*pct,
      price:o?.price||h.current,
      target:o?.target,
      buyThreshold:o?.buyThreshold,
      sellThreshold:o?.sellThreshold,
      reason
    });
    used+=pct;
  };

  // Preserve protected loss positions first.
  for(const h of holdingValues
    .filter(h=>protectedLossKeys.has(h.key))
    .sort((a,b)=>(b.value||0)-(a.value||0))){
    preserveHolding(
      h,
      optionByKey[h.key],
      'Protected loss position; no clearly superior replacement'
    );
  }

  // Event blocks and user exclusions prevent NEW buying. They do not automatically
  // force a sale of an existing holding unless separate sell-zone logic applies.
  const eventHoldKeys=new Set();
  const eventNotes=[];
  const exclusionHoldKeys=new Set();
  const exclusionNotes=[];

  for(const h of holdingValues){
    const o=optionByKey[h.key];
    if(!o || o.inSellZone) continue;

    if(o.buyBlockedByEvent){
      eventHoldKeys.add(h.key);
      eventNotes.push(
        `${h.name}: no new buying while ${o.eventBlockReason||'active event risk remains unresolved'}.`
      );
      preserveHolding(
        h,
        o,
        'Hold only; active event risk blocks additional buying'
      );
    }

    if(excludedKeys.has(h.key)){
      exclusionHoldKeys.add(h.key);
      exclusionNotes.push(
        `${h.name}: excluded from new purchases by your strategy setting.`
      );
      preserveHolding(
        h,
        o,
        'Hold only; excluded from new purchases by user'
      );
    }
  }

  const selected=[];
  for(const o of eligible){
    if(allocations.some(a=>a.key===o.key)) continue;
    if(selected.length>=3 || used>=.99) break;
    const alloc=Math.min(cap,1-used);
    if(alloc<=0) break;

    allocations.push({
      key:o.key,
      name:o.name,
      pct:alloc,
      dollars:currentValue*alloc,
      price:o.price,
      target:o.target,
      buyThreshold:o.buyThreshold,
      sellThreshold:o.sellThreshold,
      reason:o.price<=o.buyThreshold
        ? 'Inside actionable buy zone'
        : 'Best qualifying opportunity'
    });
    selected.push(o);
    used+=alloc;
  }

  // Count preserved holdings as selected portfolio components for display/logic.
  for(const a of allocations){
    const o=optionByKey[a.key];
    if(o && !selected.some(x=>x.key===o.key)) selected.push(o);
  }

  const cashPct=Math.max(0,1-used);
  if(cashPct>.0001){
    const reasons=[];
    if(eventBlocked.length){
      reasons.push(`${eventBlocked.map(o=>o.name).join(', ')} blocked by active event risk`);
    }
    if(userExcluded.length){
      reasons.push(`${userExcluded.map(o=>o.name).join(', ')} excluded from new purchases`);
    }
    if(!reasons.length && eligible.length<3){
      reasons.push('no additional commodity meets its actionable buy threshold');
    }
    if(!reasons.length){
      reasons.push('the 50% commodity cap leaves a reserve');
    }

    allocations.push({
      key:'__cash',
      name:'Cash',
      pct:cashPct,
      dollars:currentValue*cashPct,
      reason:reasons.join('; ')
    });
  }

  const targetByKey=Object.fromEntries(allocations.map(a=>[a.key,a.dollars]));
  let trades=[];

  for(const h of holdingValues){
    const target=targetByKey[h.key]||0;
    const diff=(h.value||0)-target;
    if(diff>currentValue*tolerance){
      const atLoss=!!(h.avgBuy && h.current && h.current<h.avgBuy);
      if(atLoss && protectedLossKeys.has(h.key)) continue;
      if(eventHoldKeys.has(h.key) && target>0) continue;
      if(exclusionHoldKeys.has(h.key) && target>0) continue;
      trades.push({
        action:target>0?'SELL DOWN':'SELL',
        name:h.name,
        dollars:diff,
        key:h.key,
        atLoss
      });
    }
  }

  for(const a of allocations.filter(a=>a.key!=='__cash')){
    const have=currentByKey[a.key]||0;
    const diff=a.dollars-have;
    if(diff>currentValue*tolerance){
      // A preserved event-blocked or excluded holding may remain in the plan,
      // but it must never generate an additional BUY.
      if(eventHoldKeys.has(a.key) || exclusionHoldKeys.has(a.key)) continue;
      trades.push({
        action:'BUY',
        name:a.name,
        dollars:diff,
        key:a.key,
        qty:Math.floor(diff/a.price)
      });
    }
  }

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

  const overBudget=candidateTrades.length>actionableTradeBudget;
  const deferredTrades=overBudget ? candidateTrades.slice(actionableTradeBudget) : [];
  const executableCandidateTrades=candidateTrades.slice(0,actionableTradeBudget);
  const recommendedTrades=meaningfulRebalance ? executableCandidateTrades : [];
  trades=candidateTrades;

  const currentMixDistance=
    allocations.reduce(
      (sum,a)=>sum+Math.abs((currentByKey[a.key]||0)-a.dollars),
      0
    ) +
    holdingValues
      .filter(h=>!targetByKey[h.key])
      .reduce((sum,h)=>sum+(h.value||0),0);
  const nearPlan=currentMixDistance <= currentValue*.05;

  let headline='WAIT IN CASH';
  if(selected.length && (nearPlan || !meaningfulRebalance)) headline='HOLD CURRENT MIX';
  else if(selected.length && actionableTradeBudget>0) headline='REBALANCE PORTFOLIO';
  else if(selected.length) headline='HOLD CURRENT MIX';

  return {
    cap,
    allocations,
    trades,
    candidateTrades,
    recommendedTrades,
    selected,
    eligible,
    eligibleCount:eligible.length,
    cashPct,
    nearPlan,
    headline,
    tradesRemaining,
    tradeReserve,
    actionableTradeBudget,
    overBudget,
    deferredTrades,
    projectedCurrent,
    projectedPlan,
    projectedImprovement,
    improvementPct,
    gainPerTrade,
    meaningfulRebalance,
    requiredOverallPct,
    requiredGainPerTradePct,
    requiredGainPerTrade,
    opportunityCostDecision,
    protectedLossKeys:[...protectedLossKeys],
    lossNotes,
    eventBlocked,
    eventBlockedNames:eventBlocked.map(o=>o.name),
    eventHoldKeys:[...eventHoldKeys],
    eventNotes,
    excludedKeys:[...excludedKeys],
    excludedNames,
    userExcluded,
    exclusionHoldKeys:[...exclusionHoldKeys],
    exclusionNotes,
    hypothetical:Boolean(config.hypothetical)
  };
}