function defaultAssumptionsFrom(data){
  const saved = JSON.parse(localStorage.getItem('bm_assumptions')||'{}');
  const out={};
  COMMODITIES.forEach(([key,name])=>{
    const c=data?.commodities?.find(x=>x.key===key);
    const hist=c?.history||[];
    out[key] = saved[key] || {min:'', avg:'', max:'', buy:'', sell:''};
    if(!out[key].auto){ out[key].auto = {min: quantile(hist,.05)||Math.min(...hist,c?.price||0), avg: quantile(hist,.50)||c?.price||0, max: quantile(hist,.95)||Math.max(...hist,c?.price||0)}; }
  });
  return out;
}
function renderAssumptions(data){
  const box=document.getElementById('assumptions'); box.innerHTML='';
  const assumptions=defaultAssumptionsFrom(data);
  box.insertAdjacentHTML('beforeend','<label>Commodity</label><label>Min</label><label>Usual</label><label>Max</label><label>Buy Threshold</label><label>Sell Threshold</label>');
  COMMODITIES.forEach(([key,name])=>{
    const c=data?.commodities?.find(x=>x.key===key); const hist=c?.history||[];
    const autoMin=quantile(hist,.05)||''; const autoAvg=quantile(hist,.50)||''; const autoMax=quantile(hist,.95)||'';
    const autoBuy=quantile(hist,.12) || (autoMin ? autoMin*1.15 : '');
    const autoSell=quantile(hist,.88) || (autoMax ? autoMax*0.90 : '');
    const a=assumptions[key]||{};
    box.insertAdjacentHTML('beforeend',`<label>${name}<br><span class="mini">Auto range ${fmt(autoMin)} / ${fmt(autoAvg)} / ${fmt(autoMax)}<br>Suggested buy ≤ ${fmt(autoBuy)} · sell ≥ ${fmt(autoSell)}</span></label>
      <input data-a="${key}" data-f="min" value="${a.min||''}" placeholder="${Math.round(autoMin)||''}">
      <input data-a="${key}" data-f="avg" value="${a.avg||''}" placeholder="${Math.round(autoAvg)||''}">
      <input data-a="${key}" data-f="max" value="${a.max||''}" placeholder="${Math.round(autoMax)||''}">
      <input data-a="${key}" data-f="buy" value="${a.buy||''}" placeholder="${Math.round(autoBuy)||''}">
      <input data-a="${key}" data-f="sell" value="${a.sell||''}" placeholder="${Math.round(autoSell)||''}">`);
  });
  box.querySelectorAll('input').forEach(inp=>inp.addEventListener('change',saveAssumptions));
}
function getAssumptions(data){
  const out={};
  COMMODITIES.forEach(([key,name])=>{
    const c=data.commodities.find(x=>x.key===key); const hist=c?.history||[];
    out[key]={
      min: cleanNum(document.querySelector(`input[data-a="${key}"][data-f="min"]`)?.value) || quantile(hist,.05) || Math.min(...hist,c?.price||0),
      avg: cleanNum(document.querySelector(`input[data-a="${key}"][data-f="avg"]`)?.value) || quantile(hist,.50) || c?.price || 0,
      max: cleanNum(document.querySelector(`input[data-a="${key}"][data-f="max"]`)?.value) || quantile(hist,.95) || Math.max(...hist,c?.price||0),
      buy: cleanNum(document.querySelector(`input[data-a="${key}"][data-f="buy"]`)?.value) || quantile(hist,.12) || ((quantile(hist,.05)||c?.price||0)*1.15),
      sell: cleanNum(document.querySelector(`input[data-a="${key}"][data-f="sell"]`)?.value) || quantile(hist,.88) || ((quantile(hist,.95)||c?.price||0)*0.90)
    };
  });
  return out;
}
function saveAssumptions(){
  const saved={};
  document.querySelectorAll('#assumptions input').forEach(inp=>{ const k=inp.dataset.a,f=inp.dataset.f; saved[k]??={}; saved[k][f]=inp.value; });
  localStorage.setItem('bm_assumptions',JSON.stringify(saved));
}
function modeParams(){
  const mode=document.getElementById('mode').value;
  return mode==='aggressive'
    ? {minImprovePct:.02,minImproveDollar:.02,scorePenalty:4,label:'Aggressive',sellZone:.72,minProfitForCash:.75,maxUpsideForCash:.45,buyZone:.58,cashBuyZone:.50,extremeSwitchPct:.45,overExtendedProfit:1.40,overExtendedPos:.55,buyThresholdFactor:1.10}
    : mode==='conservative'
      ? {minImprovePct:.10,minImproveDollar:.08,scorePenalty:12,label:'Conservative',sellZone:.90,minProfitForCash:1.50,maxUpsideForCash:.22,buyZone:.38,cashBuyZone:.30,extremeSwitchPct:.75,overExtendedProfit:2.25,overExtendedPos:.72,buyThresholdFactor:1.00}
      : {minImprovePct:.05,minImproveDollar:.04,scorePenalty:8,label:'Balanced',sellZone:.82,minProfitForCash:1.00,maxUpsideForCash:.32,buyZone:.48,cashBuyZone:.40,extremeSwitchPct:.60,overExtendedProfit:1.75,overExtendedPos:.60,buyThresholdFactor:1.03};
}
function allocationMode(){
  return document.getElementById('allocationMode')?.value || 'split';
}
