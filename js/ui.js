function renderRecommendationExplanation(result) {
  const why = [];
  const whyNot = [];
  const plan = result?.portfolioPlan;

  if (!plan) return;

  if (result.action === 'REBALANCE PORTFOLIO') {
    why.push('The proposed portfolio has a meaningful expected advantage over the current mix.');
    why.push('Each commodity remains within the 33% allocation cap.');
    why.push('The expected improvement is large enough to justify the required trades.');
  }

  if (result.action === 'HOLD CURRENT MIX') {
    why.push('Your current portfolio is already close to the best available allocation.');
    why.push('Rebalancing would not add enough expected value to justify using scarce trades.');
    why.push('Holding avoids unnecessary churn and preserves trades for a stronger opportunity.');
  }

  if (result.action === 'WAIT IN CASH') {
    why.push('Not enough commodities currently meet their buy thresholds.');
    why.push('Keeping cash available avoids forcing a weak entry.');
    why.push('Cash preserves flexibility for a better market update.');
  }

  if (plan.selected?.length) {
    why.push(
      `Best qualifying opportunities: ${plan.selected
        .map(item => item.name)
        .join(', ')}.`
    );
  }

  if (plan.lossNotes?.length) {
    why.push(...plan.lossNotes);
  }

 if (plan.trades?.length) {
  whyNot.push(
    `The best candidate rebalance would require ${plan.trades.length} trade${plan.trades.length === 1 ? '' : 's'}, making it too costly relative to its expected benefit.`
  );
}

 if (plan.projectedImprovement <= 0) {
  whyNot.push(
    'The best candidate rebalance is projected to perform no better than your current portfolio.'
  );
} else {
  whyNot.push(
    `The best candidate rebalance is projected to improve the portfolio by ${fmt(plan.projectedImprovement)}, but that is not enough to justify using ${plan.trades.length} trade${plan.trades.length === 1 ? '' : 's'}.`
  );
}



   if (plan.cashPct > 0) {
  whyNot.push(
    `${Math.round(plan.cashPct * 100)}% intentionally remains in cash because no additional commodities currently meet the buy criteria.`
  );
}

  if (result.eventMemory?.rawEvents?.length) {
    whyNot.push('Active market events may continue affecting prices for several updates.');
  }

  if (!why.length) {
    why.push('This recommendation produced the strongest overall balance of value, risk, and trade efficiency.');
  }

  if (!whyNot.length) {
    whyNot.push('Market prices can still move differently from their historical patterns.');
  }

  document.getElementById('whyList').innerHTML =
    why.map(item => `<li>${item}</li>`).join('');

  document.getElementById('whyNotList').innerHTML =
    whyNot.map(item => `<li>${item}</li>`).join('');
}

function renderConfidenceBreakdown(result) {
  const items = [];
  const plan = result?.portfolioPlan;

  if (!result || !plan) return;

  const add = (label, value, positive = true) => {
    items.push({ label, value, positive });
  };

  if (result.dataConfidence >= 75) {
    add('Strong historical data coverage', '+12', true);
  } else if (result.dataConfidence >= 50) {
    add('Moderate historical data coverage', '+6', true);
  } else {
    add('Limited historical data', '-10', false);
  }

  if (plan.meaningfulRebalance) {
    add('Projected improvement clears the trade threshold', '+14', true);
  } else {
    add('Projected improvement does not clearly justify trading', '-8', false);
  }

  if (plan.trades.length === 0) {
    add('No trades required', '+8', true);
  } else if (plan.trades.length <= 2) {
    add('Low trade cost', '+4', true);
  } else {
    add(`Best candidate requires ${plan.trades.length} trades`, '-6', false);
  }

  if (plan.overBudget) {
    add('Plan exceeds the available trade budget', '-12', false);
  }

  if (plan.lossNotes?.length) {
    add('Loss-protection rules are active', '+5', true);
  }

  if (result.eventMemory?.rawEvents?.length) {
    const reliableSignals = result.commodityOptions?.some(
      option => option.eventSignal?.confidence >= 0.45
    );

    if (reliableSignals) {
      add('Repeated event history supports the analysis', '+7', true);
    } else {
      add('Active events have limited historical evidence', '-7', false);
    }
  }

  if (result.action === 'HOLD CURRENT MIX') {
    add('Current mix is already close to the optimized allocation', '+10', true);
  }

  if (result.action === 'WAIT IN CASH') {
    add('Cash avoids forcing weak entries', '+8', true);
  }

  const rows = items.map(item => `
    <div class="confidence-row">
      <span>${item.label}</span>
      <strong class="${item.positive ? 'good' : 'bad'}">
        ${item.value}
      </strong>
    </div>
  `).join('');

  document.getElementById('confidenceBreakdown').innerHTML = `
    <div class="confidence-total">
      <span>Confidence in ${result.action}</span>
      <strong>${result.decisionConfidence}%</strong>
    </div>
    ${rows}
    <div class="mini" style="margin-top:10px">
      These values explain the main factors behind the confidence level; they are not a direct arithmetic formula.
    </div>
  `;
}

function renderDeveloperDiagnostics(result) {
  const box = document.getElementById('developerDiagnostics');

  if (!box || !result) return;

  const plan = result.portfolioPlan;
  const rows = [];

  rows.push(['Action', result.action || '—']);
  rows.push(['Decision confidence', `${result.decisionConfidence ?? 0}%`]);
  rows.push(['Data confidence', `${result.dataConfidence ?? 0}%`]);
  rows.push(['Risk', result.risk || '—']);
  rows.push(['Sell pressure', result.sellPressure || '—']);
  rows.push(['Portfolio value', fmt(result.currentValue)]);
  rows.push(['Trade reserve', plan?.tradeReserve ?? '—']);
  rows.push(['Actionable trade budget', plan?.actionableTradeBudget ?? '—']);
  rows.push(['Trades in plan', plan?.trades?.length ?? 0]);
  rows.push(['Projected current mix', fmt(plan?.projectedCurrent)]);
  rows.push([
  plan?.meaningfulRebalance
    ? 'Projected recommended mix'
    : 'Projected candidate allocation',
  fmt(plan?.projectedPlan)
]);
  rows.push([
    'Projected improvement',
    `${fmt(plan?.projectedImprovement)} (${pct(plan?.improvementPct || 0)})`
  ]);
  rows.push(['Gain per trade', fmt(plan?.gainPerTrade)]);
  rows.push([
    'Meaningful rebalance',
    plan?.meaningfulRebalance ? 'Yes' : 'No'
  ]);
  rows.push([
    'Opportunity-cost decision',
    plan?.opportunityCostDecision || '—'
  ]);
  rows.push([
    'Event occurrences stored',
    result.eventMemory?.occurrences ?? 0
  ]);
  rows.push([
    'Event snapshots stored',
    result.eventMemory?.snapshots ?? 0
  ]);

  const commodityRows = (result.commodityOptions || [])
    .sort((a, b) => b.score - a.score)
    .map(option => `
      <tr>
        <td>${option.name}</td>
        <td class="num">${Math.round(option.score)}</td>
        <td class="num">${fmt(option.price)}</td>
        <td class="num">${fmt(option.buyThreshold)}</td>
        <td class="num">${fmt(option.sellThreshold)}</td>
        <td>${option.inManualBuyZone ? 'Yes' : 'No'}</td>
        <td>${option.inSellZone ? 'Yes' : 'No'}</td>
        <td class="num">${pct(option.upsidePct || 0)}</td>
        <td class="num">${pct(option.eventAdjustment || 0)}</td>
      </tr>
    `)
    .join('');




  box.innerHTML = `
    <table>
      ${rows.map(([label, value]) => `
        <tr>
          <th>${label}</th>
          <td class="num">${value}</td>
        </tr>
      `).join('')}
    </table>

    <h3 style="margin:18px 0 8px">Commodity diagnostics</h3>

    <div style="overflow-x:auto">
      <table>
        <tr>
          <th>Commodity</th>
          <th class="num">Score</th>
          <th class="num">Price</th>
          <th class="num">Buy threshold</th>
          <th class="num">Sell threshold</th>
          <th>Buy zone</th>
          <th>Sell zone</th>
          <th class="num">Upside</th>
          <th class="num">Event adjustment</th>
        </tr>
        ${commodityRows}
      </table>
    </div>
  `;
}

function renderRecommendationHistory() {
  const box = document.getElementById('recommendationHistory');
  if (!box) return;

  const history = loadRecommendationHistory();

  if (!history.length) {
  box.innerHTML = '';
  return;
}

  box.innerHTML = `
    <div style="overflow-x:auto">
      <table>
        <tr>
          <th>Date</th>
          <th>Action</th>
          <th class="num">Confidence</th>
          <th class="num">Portfolio</th>
          <th>Selected commodities</th>
          <th class="num">Projected improvement</th>
          <th class="num">Trades</th>
          <th>Outcome</th>
        </tr>
        ${history.slice(0, 25).map(entry => `
          <tr>
            <td>${new Date(entry.capturedAt).toLocaleString()}</td>
            <td><strong>${entry.action}</strong></td>
            <td class="num">${entry.confidence ?? '—'}%</td>
            <td class="num">${fmt(entry.portfolioValue)}</td>
            <td>${entry.selectedCommodities?.length
              ? entry.selectedCommodities.join(', ')
              : 'None'}</td>
            <td class="num ${entry.projectedImprovement >= 0 ? 'good' : 'bad'}">
              ${fmt(entry.projectedImprovement)}
              (${pct(entry.improvementPct || 0)})
            </td>
            <td class="num">${entry.tradesRequired ?? 0}</td>

            <td>
  <strong class="${
    entry.outcome === 'Successful'
      ? 'good'
      : entry.outcome === 'Unsuccessful'
        ? 'bad'
        : 'warn'
  }">
    ${entry.outcome || 'Pending'}
  </strong>
  ${
    Number.isFinite(entry.actualChangePct)
      ? `<br><span class="mini">${pct(entry.actualChangePct)}</span>`
      : ''
  }
</td>

          </tr>
        `).join('')}
      </table>
    </div>

    <div class="mini" style="margin-top:10px">
      Showing the 25 most recent recommendations. Up to 500 are stored locally in this browser.
    </div>
  `;
}

function renderPositionSwitchOutlook(data, result) {
  const select = document.getElementById('positionSwitchSelect');
  const box = document.getElementById('positionSwitchOutlook');
  const summary = document.getElementById('positionSwitchSummary');

  if (!select || !box || !result) return;

  const holdings = result.positionAssessments || [];
  const options = result.commodityOptions || [];
  const cap = result.portfolioPlan?.cap || 0.33;
  const portfolioValue = result.currentValue || data.totalPortfolio || 0;
  const capDollars = portfolioValue * cap;

  if (!holdings.length) {
    select.innerHTML = '<option value="">No meaningful holdings found</option>';
    box.innerHTML = '<div class="mini">No meaningful positions are available to compare.</div>';
    if (summary) summary.innerHTML = '';
    return;
  }

  const previousValue = select.value;
  select.innerHTML = holdings.map(position => `
    <option value="${position.key}">${position.name} — ${fmt(position.value)}</option>
  `).join('');
  select.value = holdings.some(position => position.key === previousValue) ? previousValue : holdings[0].key;

  const renderSelectedPosition = () => {
    const holding = holdings.find(position => position.key === select.value);
    if (!holding) return;
    const currentOption = options.find(option => option.key === holding.key);
    if (!currentOption) {
      box.innerHTML = '<div class="mini">Unable to analyze this holding.</div>';
      return;
    }

    const holdTargetValue = holding.qty * currentOption.target;
    const currentByKey = Object.fromEntries(holdings.map(position => [position.key, position.value || 0]));
    const comparisons = options
      .filter(option => option.key !== holding.key)
      .map(option => {
        const existingValue = currentByKey[option.key] || 0;
        const availableRoom = Math.max(0, capDollars - existingValue);
        const amountInvested = Math.min(holding.value, availableRoom);
        const qty = option.price > 0 ? Math.floor(amountInvested / option.price) : 0;
        const spent = qty * option.price;
        const leftoverCash = holding.value - spent;
        const switchTargetValue = qty * option.target + leftoverCash;
        const difference = switchTargetValue - holdTargetValue;
        return {
          key: option.key,
          name: option.name,
          qty,
          switchTargetValue,
          difference,
          improvementPct: holdTargetValue > 0 ? difference / holdTargetValue : 0,
          inBuyZone: option.inManualBuyZone,
          realizesLoss: holding.avgBuy > 0 && holding.current < holding.avgBuy,
          capLimited: amountInvested < holding.value - 1,
          leftoverCash
        };
      })
      .filter(comparison => comparison.qty > 0)
      .sort((a, b) => b.difference - a.difference);

    const bestSwitch = comparisons[0] || null;
    const bestActionableSwitch = comparisons.find(comparison =>
      comparison.difference > 0 && comparison.inBuyZone && comparison.improvementPct >= 0.08
    ) || null;
    const holdIsBest = !bestSwitch || bestSwitch.difference <= 0;

    if (summary) {
      if (holdIsBest) {
        summary.className = 'position-switch-summary best-hold';
        summary.innerHTML = `
          <div class="decision-label">Best Decision</div>
          <div class="decision-action">✅ HOLD ${holding.name}</div>
          <div class="decision-metric">Expected value: <strong>${fmt(holdTargetValue)}</strong></div>
          <ul><li>Every legal 33%-capped switch performs worse than holding.</li><li>No trades required.</li></ul>`;
      } else if (bestActionableSwitch) {
        summary.className = 'position-switch-summary best-switch';
        summary.innerHTML = `
          <div class="decision-label">Switch Now</div>
          <div class="decision-action">🔄 SELL ${holding.name}<br>BUY ${bestActionableSwitch.name}</div>
          <div class="decision-metric">Expected improvement: <strong>${fmt(bestActionableSwitch.difference)}</strong> (${pct(bestActionableSwitch.improvementPct)})</div>
          <ul><li>The replacement is inside its buy zone.</li><li>The expected edge clears the 8% actionability threshold.</li><li>The purchase is limited to the room available under the 33% cap.</li><li>${bestActionableSwitch.leftoverCash > 1 ? `${fmt(bestActionableSwitch.leftoverCash)} remains in cash.` : 'No material cash remains.'}</li></ul>`;
      } else {
        summary.className = 'position-switch-summary best-hold';
        summary.innerHTML = `
          <div class="decision-label">Best Alternative, But Not Yet</div>
          <div class="decision-action">⏳ HOLD ${holding.name} FOR NOW</div>
          <div class="decision-metric">Best legal switch: <strong>${bestSwitch ? bestSwitch.name : 'None'}</strong></div>
          <ul>${bestSwitch ? `<li>Projected improvement: <strong>${fmt(bestSwitch.difference)}</strong> (${pct(bestSwitch.improvementPct)}).</li>` : ''}<li>The best switch is not both inside its buy zone and at least 8% better than holding.</li><li>All comparisons respect the 33% cap.</li></ul>`;
      }
    }

    const cashDifference = holding.value - holdTargetValue;
    box.innerHTML = `
      <div class="mini" style="margin-bottom:12px">Current position: <strong>${holding.name}</strong><br>Current value: ${fmt(holding.value)}<br>Estimated value if held to target: ${fmt(holdTargetValue)}<br>Maximum value allowed in any replacement: ${fmt(capDollars)}</div>
      <div style="overflow-x:auto"><table class="switch-outlook-table">
        <tr><th>Rank</th><th>Recommendation</th><th class="num">Hold Outlook</th><th class="num">Switch Outlook</th><th class="num">Improvement</th><th>Entry</th><th>Cap / Cash</th><th>Risk</th></tr>
        <tr class="switch-hold-row"><td>${holdIsBest ? '🥇' : '—'}</td><td><strong>Hold ${holding.name}</strong></td><td class="num">${fmt(holdTargetValue)}</td><td class="num">${fmt(holdTargetValue)}</td><td class="num">—</td><td>Current position</td><td>Within current mix</td><td>0 trades</td></tr>
        ${comparisons.map((comparison, index) => `
          <tr ${index === 0 && !holdIsBest ? 'class="switch-best-row"' : ''}>
            <td>${index === 0 ? (holdIsBest ? '1.' : '🥇') : `${index + 1}.`}</td>
            <td class="${index === 0 ? 'switch-best' : ''}"><strong>Sell ${holding.name}</strong><br>Buy ${comparison.name}</td>
            <td class="num">${fmt(holdTargetValue)}</td><td class="num">${fmt(comparison.switchTargetValue)}</td>
            <td class="num ${comparison.difference >= 0 ? 'good' : 'bad'}"><strong>${fmt(comparison.difference)}</strong><br><span class="mini">${pct(comparison.improvementPct)}</span></td>
            <td class="${comparison.inBuyZone ? 'good' : 'warn'}">${comparison.inBuyZone ? 'Buy zone' : 'Above buy zone'}</td>
            <td>${comparison.capLimited ? `Cap-limited · ${fmt(comparison.leftoverCash)} cash` : 'Full position can move'}</td>
            <td class="${comparison.realizesLoss ? 'switch-warning' : ''}">${comparison.realizesLoss ? `Locks in ${fmt(Math.max(0, (holding.avgBuy - holding.current) * holding.qty))} loss · 2 trades` : '2 trades'}</td>
          </tr>`).join('')}
        <tr><td>—</td><td><strong>Sell ${holding.name}</strong><br>Keep Cash</td><td class="num">${fmt(holdTargetValue)}</td><td class="num">${fmt(holding.value)}</td><td class="num ${cashDifference >= 0 ? 'good' : 'bad'}"><strong>${fmt(cashDifference)}</strong><br><span class="mini">${pct(holdTargetValue > 0 ? cashDifference / holdTargetValue : 0)}</span></td><td>Cash</td><td>100% cash</td><td class="${holding.avgBuy > 0 && holding.current < holding.avgBuy ? 'switch-warning' : ''}">${holding.avgBuy > 0 && holding.current < holding.avgBuy ? 'Locks in current loss · 1 trade' : 'No market upside while waiting · 1 trade'}</td></tr>
      </table></div>
      <div class="mini" style="margin-top:10px">These estimates apply only to the selected position. Replacement purchases are capped so the full portfolio remains within the 33% maximum per commodity.</div>`;
  };

  select.onchange = renderSelectedPosition;
  renderSelectedPosition();
}





function render(data, result){
  const currentName = result.portfolioOpt ? 'your current mix' : (result.currentOpt?.name || 'Cash');
  const pplan=result.portfolioPlan;
  
const actionableTrades = result.action === 'REBALANCE PORTFOLIO' ? (pplan.trades || []) : [];
const tradeByKey = Object.fromEntries(
  actionableTrades.map(trade => [trade.key, trade])
);

const allocationActions = pplan.allocations
  .filter(allocation => allocation.key !== '__cash')
  .map(allocation => {
    const trade = tradeByKey[allocation.key];

    if (trade?.action === 'BUY') return `BUY ${allocation.name}`;
    if (trade?.action === 'SELL DOWN') return `TRIM ${allocation.name}`;
    if (trade?.action === 'SELL') return `SELL ${allocation.name}`;

    return `HOLD ${allocation.name}`;
  });

const soldPositions = actionableTrades
  .filter(trade => trade.action === 'SELL')
  .map(trade => `SELL ${trade.name}`);

const recommendationActions = [...allocationActions, ...soldPositions];

const recText = result.action === 'REBALANCE PORTFOLIO'
  ? `My take: ${recommendationActions.join(', ')}. Keep any unused allocation in cash rather than forcing a weak entry.`
  : result.action === 'HOLD CURRENT MIX'
    ? `My take: hold your current positions and make no trades right now. The candidate rebalance does not add enough expected value to justify using scarce trades.`
    : `My take: wait in cash. Fewer than three commodities currently qualify as clean buys, so the optimizer is preserving the unused allocation.`;
  
  const bestAlt = result.bestSwitch;
  const riskClass = result.risk==='Low'?'good':result.risk==='Medium'?'warn':'bad';
  document.getElementById('recBox').innerHTML = `<div class="rec-title">Current Market Assessment</div><div class="rec-action">${result.action}</div><div class="human">${recText}</div>
    <div class="metrics"><div class="metric"><div class="k">Confidence in ${result.action}</div><div class="v">${result.decisionConfidence}%</div></div><div class="metric"><div class="k">Data confidence</div><div class="v">${result.dataConfidence}%</div></div><div class="metric"><div class="k">Risk if you do nothing</div><div class="v ${riskClass}">${result.risk}</div></div><div class="metric"><div class="k">Sell pressure</div><div class="v">${result.sellPressure || 'N/A'}</div></div></div>`;
  
  
const displayedAllocations =
  result.action === 'HOLD CURRENT MIX'
    ? (result.positionAssessments || []).map(position => ({
        key: position.key,
        name: position.name || position.option?.name,
        pct: position.portfolioPct || 0,
        dollars: position.value || 0,
        price: position.current || position.option?.price || 0,
        buyThreshold: position.option?.buyThreshold || 0,
        reason: 'Current holding'
      })).concat(
        data.cash > 0
          ? [{
              key: '__cash',
              name: 'Cash',
              pct: result.currentValue > 0 ? data.cash / result.currentValue : 0,
              dollars: data.cash,
              reason: 'Current cash balance'
            }]
          : []
      )
    : pplan.allocations;

const allocHtml = displayedAllocations.map(a => {


  const trade = tradeByKey[a.key];

  let actionLabel = '';

if (result.action === 'REBALANCE PORTFOLIO') {
  if (a.key === '__cash') {
    actionLabel = 'KEEP';
  } else if (trade?.action === 'BUY') {
    actionLabel = 'BUY';
  } else if (trade?.action === 'SELL DOWN') {
    actionLabel = 'TRIM';
  } else {
    actionLabel = 'HOLD';
  }
}

  const actionClass =
    actionLabel === 'BUY'
      ? 'good'
      : actionLabel === 'TRIM'
        ? 'warn'
        : '';

  return `
    <div class="alloc-card">
      <div class="alloc-name">
        ${a.name}
        
${actionLabel ? `
  <span class="alloc-action ${actionLabel.toLowerCase()}">
    ${actionLabel}
  </span>
` : ''}

      </div>

      <div class="alloc-pct">${Math.round(a.pct * 100)}%</div>
      <div>${fmt(a.dollars)}</div>

     <div class="alloc-reason">
  ${
    
a.key === '__cash'
  ? result.action === 'HOLD CURRENT MIX'
    ? 'Current cash balance.'
    : pplan.meaningfulRebalance
      ? 'Cash reserve · Remaining allocation after recommended trades.'
      : 'Held intentionally · No additional commodity currently qualifies for investment.'
      : result.action === 'HOLD CURRENT MIX'
  ? `Current price: ${fmt(a.price)} · Buy threshold: ${fmt(a.buyThreshold)}`
  : `${a.reason} · Current ${fmt(a.price)} · Buy threshold ${fmt(a.buyThreshold)}`
  }
</div>

    </div>
  `;
}).join('');


  const lossHtml=(pplan.lossNotes||[]).length ? `<div class="warn" style="margin-top:12px"><strong>Loss protection:</strong><ul>${pplan.lossNotes.map(x=>`<li>${x}</li>`).join('')}</ul></div>` : '';
  const isActionablePlan = result.action === 'REBALANCE PORTFOLIO' && pplan.meaningfulRebalance;
  const tradeHtml = isActionablePlan && pplan.trades.length
    ? `<h3 style="margin:16px 0 6px">Immediate trade plan (${pplan.trades.length} trade${pplan.trades.length===1?'':'s'})</h3><ul>${pplan.trades.map(t=>`<li><strong>${t.action}</strong> ${t.name}: about ${fmt(t.dollars)}${t.qty?` (~${t.qty.toLocaleString()} units)`:''}${t.atLoss?' <span class="bad">(realizes a loss)</span>':''}</li>`).join('')}</ul>`
    : `<div class="good" style="margin-top:12px"><strong>No immediate trades recommended.</strong></div><div class="mini" style="margin-top:8px">Continue holding the current portfolio shown above.</div>`;
  const budgetHtml = pplan.meaningfulRebalance
  ? `<div class="mini" style="margin-top:12px"><strong>Trade discipline:</strong> This recommendation uses ${pplan.recommendedTrades.length} of your ${pplan.tradesRemaining} remaining trades, leaving ${Math.max(0, pplan.tradesRemaining - pplan.recommendedTrades.length)} available today.${pplan.overBudget ? ` ${pplan.deferredTrades.length} lower-priority trade(s) deferred.` : ''}</div>`
  : `<div class="mini" style="margin-top:12px"><strong>Trade discipline:</strong> You have ${pplan.tradesRemaining} trades remaining today. The advisor recommends conserving them for a stronger opportunity.</div>`;
  const oppClass=pplan.meaningfulRebalance?'good':'warn';
  const opportunityHtml = pplan.meaningfulRebalance
  ? `<div class="mini" style="margin-top:12px"><strong>Opportunity cost:</strong> <span class="${oppClass}">${pplan.opportunityCostDecision}</span><br>Projected current mix: ${fmt(pplan.projectedCurrent)}<br>Projected recommended mix: ${fmt(pplan.projectedPlan)}<br>Expected improvement: ${fmt(pplan.projectedImprovement)} (${pct(pplan.improvementPct)})<br>Trades required: ${pplan.recommendedTrades.length}<br>Expected gain per trade: ${fmt(pplan.gainPerTrade)}<br>Minimum edge required: ${pct(pplan.requiredOverallPct)} overall and about ${fmt(pplan.requiredGainPerTrade)} per trade.</div>`
  : `<div class="mini" style="margin-top:12px"><strong>Opportunity cost:</strong> <span class="${oppClass}">${pplan.opportunityCostDecision}</span><br>Projected current mix: ${fmt(pplan.projectedCurrent)}<br>Projected candidate allocation: ${fmt(pplan.projectedPlan)}<br>Expected improvement if rebalanced: ${fmt(pplan.projectedImprovement)} (${pct(pplan.improvementPct)})<br>Candidate trades required: ${pplan.candidateTrades.length}<br>Expected gain per candidate trade: ${fmt(pplan.gainPerTrade)}<br>Minimum edge required: ${pct(pplan.requiredOverallPct)} overall and about ${fmt(pplan.requiredGainPerTrade)} per trade.</div>`;
  const planLabel =
  result.action === 'REBALANCE PORTFOLIO'
    ? '<div class="good" style="margin-bottom:12px"><strong>Recommended Portfolio</strong></div>'
    : '<div class="good" style="margin-bottom:12px"><strong>Current Portfolio</strong></div>';
  document.getElementById('portfolioPlan').innerHTML=`${planLabel}<div class="alloc-grid">${allocHtml}</div>${tradeHtml}${lossHtml}${budgetHtml}${opportunityHtml}<div class="mini" style="margin-top:12px">
  ${
    result.action === 'HOLD CURRENT MIX'
      ? 'The advisor recommends continuing to hold this portfolio. No rebalance currently provides enough expected benefit to justify using trades.'
      : 'Maximum recommended allocation per commodity: 33%. Cash is intentional when fewer than three commodities meet their buy thresholds.'
  }
</div>`;
  const pros=[]; const cons=[];
  if(result.positionAssessments?.length){
    pros.push(`Meaningful positions analyzed: ${result.positionAssessments.map(p=>`${p.option.name} (${pct(p.portfolioPct)})`).join(', ')}.`);
  }
  if(result.action === 'HOLD CURRENT MIX'){
    pros.push('Holding the current mix costs 0 trades.');
    pros.push('The candidate rebalance does not clear the opportunity-cost threshold.');
    if(pplan.projectedImprovement <= 0){
      pros.push(`Holding is projected to outperform the candidate rebalance by ${fmt(Math.abs(pplan.projectedImprovement))}.`);
    }
    cons.push('A stronger future buy-zone setup could eventually justify rebalancing.');
    if(pplan.cashPct > 0) cons.push(`${Math.round(pplan.cashPct*100)}% of the candidate allocation would remain in cash.`);
  } else if(result.action === 'REBALANCE PORTFOLIO'){
    pros.push(`The capped rebalance is projected to improve the outlook by ${fmt(pplan.projectedImprovement)} (${pct(pplan.improvementPct)}).`);
    pros.push('Every recommended allocation remains at or below 33%.');
    cons.push(`The plan uses ${pplan.trades.length} trade${pplan.trades.length===1?'':'s'}.`);
    cons.push('Projected targets are estimates and are not guaranteed.');
  } else {
    pros.push('Cash preserves flexibility and avoids forcing weak entries.');
    cons.push('Cash has no market upside while waiting.');
  }
  if(pplan.lossNotes?.length) pros.push(...pplan.lossNotes);
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
    const overlapNote = data.events.length > 1 ? '<br><em>Overlapping active events mean this movement cannot yet be attributed to this event alone.</em>' : '';
    return `<li><strong>${e}</strong><br><span class="mini">Tracked occurrence count: ${occurrenceCount}.<br>${historyText}${overlapNote}</span></li>`;
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
        const isThreshold = isValidMoney(thresholdTrigger) && usefulTrigger===thresholdTrigger;
        const prefix = isThreshold ? 'Buy-zone trigger' : 'Portfolio-switch trigger';
        const reason = isThreshold ? 'reaches the advisor buy threshold' : 'could make a capped switch worth reviewing';
        waiting.push(`${prefix}: ${o.name} at or below ${fmt(usefulTrigger)} ${reason}.`);
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
  document.getElementById('alternativesTable').innerHTML = `<caption style="text-align:left;padding-bottom:10px" class="mini"><strong>Theoretical single-option comparisons.</strong> Commodity rows ignore the 33% cap and are not trade recommendations; use the primary portfolio plan for actionable advice.</caption><tr><th>Rank</th><th>Option</th><th class="num">Current</th><th class="num">Target</th><th class="num">Expected portfolio</th><th class="num">Extra vs now</th><th class="num">Vs hold</th><th class="num">Trades</th><th class="num">Score</th></tr>` + result.options.map((o,i)=>{
    const isCurrent = o.key===result.currentOpt?.key || o.type==='portfolio';
    const vsHoldText = isCurrent ? '—' : fmt(o.vsHold);
    const vsHoldClass = isCurrent ? '' : (o.vsHold>=0?'good':'bad');
    const label = o.type==='cash' ? 'Sell to Cash / Wait' : (o.type==='split' ? 'Theoretical 50/50 ' + o.legA.name + ' / ' + o.legB.name : (isCurrent ? o.name : 'Theoretical all-in: ' + o.name));
    const currentCell = o.type==='cash' ? '—' : (o.type==='split' ? '50/50' : fmt(o.price));
    const targetCell = o.type==='cash' ? '—' : (o.type==='split' ? fmt(o.legA.target)+' / '+fmt(o.legB.target) : fmt(o.target));
    return `<tr class="${i===0?'rank1':''}"><td>${i+1}</td><td>${label}</td><td class="num">${currentCell}</td><td class="num">${targetCell}</td><td class="num">${fmt(o.expectedValue)}</td><td class="num ${o.extraVsNow>=0?'good':'bad'}">${fmt(o.extraVsNow)}</td><td class="num ${vsHoldClass}">${vsHoldText}</td><td class="num">${o.tradesNeeded}</td><td class="num">${Math.round(o.score)}</td></tr>`
  }).join('');
  document.getElementById('marketTable').innerHTML = `<tr><th>Commodity</th><th class="num">Current</th><th class="num">Buy Threshold</th><th>Entry Status</th><th class="num">Sell Threshold</th><th>Exit Status</th><th>Event Signal</th><th>Price Rarity</th><th class="num">Hist Low</th><th class="num">Hist Median</th><th class="num">Hist High</th><th class="num">Est Target</th><th class="num">Upside Left</th></tr>` + data.commodities.map(c=>{ const hist=c.history||[]; const o=result.options.find(x=>x.key===c.key); const inZone=!!o?.inManualBuyZone; const nearZone=!inZone && isValidMoney(o?.buyThreshold) && c.price <= o.buyThreshold*1.15; const status=inZone?'BUY ZONE':nearZone?'WATCH':'TOO HIGH'; const statusClass=inZone?'good':nearZone?'warn':'bad'; const sellReached=!!o?.inSellZone; const nearSell=!sellReached && isValidMoney(o?.sellThreshold) && c.price >= o.sellThreshold*0.92; const exitStatus=sellReached?'SELL ZONE':nearSell?'SELL REVIEW':'HOLD ZONE'; const exitClass=sellReached?'good':nearSell?'warn':''; const sorted=[...hist,c.price].sort((a,b)=>a-b); const percentile=sorted.length?sorted.filter(x=>x<=c.price).length/sorted.length:.5; const rarity=percentile<=.10?'Very Low':percentile<=.25?'Low':percentile>=.90?'Very High':percentile>=.75?'High':'Typical'; const es=o?.eventSignal; const eventText=es&&es.confidence>=.45?`${es.effect>=0?'Bullish':'Bearish'} ${pct(Math.abs(es.effect))}<br><span class="mini">${Math.round(es.confidence*100)}% evidence confidence</span>`:(data.events.length?'Learning':'None'); const eventClass=es&&es.confidence>=.45?(es.effect>=0?'good':'bad'):''; return `<tr><td>${c.name}</td><td class="num">${fmt(c.price)}</td><td class="num">${fmt(o?.buyThreshold)}</td><td class="${statusClass}"><strong>${status}</strong></td><td class="num">${fmt(o?.sellThreshold)}</td><td class="${exitClass}"><strong>${exitStatus}</strong></td><td class="${eventClass}"><strong>${eventText}</strong></td><td><strong>${rarity}</strong> (${Math.round(percentile*100)}th pct)</td><td class="num">${fmt(Math.min(...hist,c.price))}</td><td class="num">${fmt(quantile(hist,.5)||c.price)}</td><td class="num">${fmt(Math.max(...hist,c.price))}</td><td class="num">${fmt(o?.target)}</td><td class="num ${o?.upsidePct>=0?'good':'bad'}">${pct(o?.upsidePct||0)}</td></tr>`; }).join('');
  document.getElementById('debug').textContent = JSON.stringify({data,result},null,2);

renderRecommendationExplanation(result);
renderConfidenceBreakdown(result);
renderDeveloperDiagnostics(result);
renderRecommendationHistory();
renderPositionSwitchOutlook(data, result);

}


