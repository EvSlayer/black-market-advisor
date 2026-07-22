function analyzeHtml(html, sourceLabel=''){
  const err=document.getElementById('error');
  err.classList.add('hidden');
  try{
    if(!html || !html.trim()) throw new Error('Paste the page HTML first.');
    document.getElementById('htmlInput').value = html;
    const data=parseBlackMarket(html);
    if(!data.commodities.length) throw new Error('No commodity cards found. Make sure this is the Black Market page HTML.');
    const memoryStats = updateMarketMemory(data);
    renderAssumptions(data);
    const result=analyze(data);
    updateAdvisorState(data, result);
    updateRecommendationOutcomes(data);
    saveRecommendationHistory(data, result);
    render(data,result);
    checkDiscordBuyZoneAlerts(result);
    renderMoveRecords(data);
    lastData=data;
    lastResult=result;
    document.getElementById('results').classList.remove('hidden');
    document.getElementById('saveSnapshotBtn').disabled=false;
    document.getElementById('parseStatus').textContent=`Parsed ${data.commodities.length} commodities${sourceLabel ? ' from '+sourceLabel : ''}. Memory: ${memoryStats.totalPoints.toLocaleString()} price points (${memoryStats.totalAdded} new).`;
  }
  catch(e){ err.textContent=e.message; err.classList.remove('hidden'); }
}

let monitorCountdownTimer = null;

function startMonitorCountdown(nextRefreshAt) {
  const nextScanEl = document.getElementById('monitorNextScan');

  if (!nextScanEl || !nextRefreshAt) {
    return;
  }

  if (monitorCountdownTimer) {
    clearInterval(monitorCountdownTimer);
  }

  function updateCountdown() {
    const remaining =
      new Date(nextRefreshAt).getTime() - Date.now();

    if (remaining <= 0) {
      nextScanEl.textContent = 'Refreshing...';
      clearInterval(monitorCountdownTimer);
      monitorCountdownTimer = null;
      return;
    }

    const totalSeconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    nextScanEl.textContent =
      `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }

  updateCountdown();
  monitorCountdownTimer = setInterval(updateCountdown, 1000);
}

function startAutoMonitorReceiver() {
  window.addEventListener('message', (event) => {
    const payload = event.data;

    if (
      !payload ||
      payload.type !== 'BM_ADVISOR_CAPTURE' ||
      !payload.html
    ) {
      return;
    }

    const connectionEl = document.getElementById('monitorConnectionStatus');
    const lastScanEl = document.getElementById('monitorLastScan');
    const sourceEl = document.getElementById('monitorCaptureSource');

    if (connectionEl) {
      connectionEl.textContent = 'Connected';
    }

    if (lastScanEl) {
      const capturedDate = payload.capturedAt
        ? new Date(payload.capturedAt)
        : new Date();

      lastScanEl.textContent = capturedDate.toLocaleString();
    }

    if (sourceEl) {
      try {
        const sourceUrl = new URL(payload.source);
        sourceEl.textContent = sourceUrl.pathname;
      } catch (error) {
        sourceEl.textContent = payload.source || 'Black Market';
      }
    }

    if (payload.nextRefreshAt) {
  startMonitorCountdown(payload.nextRefreshAt);
}
    
    analyzeHtml(payload.html, 'game page');

    try {
      window.focus();
    } catch (error) {
      console.warn('Unable to focus advisor window:', error);
    }
  });
}

let lastData=null, lastResult=null;
document.getElementById('analyzeBtn').onclick=()=>{
  analyzeHtml(document.getElementById('htmlInput').value.trim());
};
document.getElementById('mode').onchange=()=>{ if(lastData){ lastResult=analyze(lastData); render(lastData,lastResult); } };
document.getElementById('allocationMode').onchange=()=>{ if(lastData){ lastResult=analyze(lastData); render(lastData,lastResult); } };
document.getElementById('clearBtn').onclick=()=>{ document.getElementById('htmlInput').value=''; document.getElementById('results').classList.add('hidden'); document.getElementById('parseStatus').textContent=''; };
document.getElementById('resetAssumptionsBtn').onclick=()=>{ localStorage.removeItem('bm_assumptions'); renderAssumptions(lastData); if(lastData){ lastResult=analyze(lastData); render(lastData,lastResult); } };
document.getElementById('resetMemoryBtn').onclick=()=>{ resetMarketMemory(); if(lastData){ lastData=parseBlackMarket(document.getElementById('htmlInput').value.trim()); updateMarketMemory(lastData); renderAssumptions(lastData); lastResult=analyze(lastData); render(lastData,lastResult); } document.getElementById('parseStatus').textContent='Price memory reset.'; };
document.getElementById('resetEventMemoryBtn').onclick=()=>{ localStorage.removeItem('bm_event_memory_v4'); if(lastData){ lastResult=analyze(lastData); render(lastData,lastResult); } document.getElementById('parseStatus').textContent='Event memory reset.'; };
const askBtn=document.getElementById('askAdvisorBtn'); if(askBtn) askBtn.onclick=()=>submitAdvisorQuestion();
const qBox=document.getElementById('advisorQuestion'); if(qBox) qBox.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter') submitAdvisorQuestion();});
document.querySelectorAll('.advisor-chip').forEach(button=>button.addEventListener('click',()=>{
  const category=button.dataset.category||'auto';
  const select=document.getElementById('advisorCategory');
  if(select && category!=='auto'){
    select.value=category;
    localStorage.setItem('bm_advisor_question_category',category);
    select.dispatchEvent(new Event('change'));
  }
  submitAdvisorQuestion(button.textContent,category);
}));
document.getElementById('saveSnapshotBtn').onclick=()=>{ if(!lastData) return; const snaps=JSON.parse(localStorage.getItem('bm_snapshots')||'[]'); snaps.push({data:lastData,result:lastResult}); localStorage.setItem('bm_snapshots',JSON.stringify(snaps)); document.getElementById('parseStatus').textContent=`Snapshot saved locally (${snaps.length}).`; };
function rerunAdvisorForStrategySettings(){
  if(!lastData) return;
  lastResult=analyze(lastData);
  updateAdvisorState(lastData,lastResult);
  render(lastData,lastResult);
  renderMoveRecords(lastData);
}

function renderPurchaseExclusionSettings(){
  const box=document.getElementById('purchaseExclusions');
  if(!box || typeof COMMODITIES==='undefined') return;

  const excluded=new Set(
    typeof loadPurchaseExclusions==='function'
      ? loadPurchaseExclusions()
      : []
  );

  box.innerHTML='';

  for(const [key,name] of COMMODITIES){
    const label=document.createElement('label');
    label.style.cssText='display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid #34415a;border-radius:10px;background:#101722;cursor:pointer;';

    const input=document.createElement('input');
    input.type='checkbox';
    input.dataset.purchaseExclusion=key;
    input.checked=excluded.has(key);

    const text=document.createElement('span');
    text.textContent=name;

    input.addEventListener('change',()=>{
      if(typeof setPurchaseExclusion==='function'){
        setPurchaseExclusion(key,input.checked);
      }
      rerunAdvisorForStrategySettings();
    });

    label.append(input,text);
    box.appendChild(label);
  }
}

const clearPurchaseExclusionsButton=
  document.getElementById('clearPurchaseExclusionsBtn');

clearPurchaseExclusionsButton?.addEventListener('click',()=>{
  if(typeof clearPurchaseExclusions==='function'){
    clearPurchaseExclusions();
  }
  renderPurchaseExclusionSettings();
  rerunAdvisorForStrategySettings();
});

renderAssumptions(null);
renderPurchaseExclusionSettings();
startAutoMonitorReceiver();

const developerToggle = document.getElementById('developerModeToggle');

if (developerToggle) {
  const savedDeveloperMode =
    localStorage.getItem('bm_developer_mode') === 'true';

  developerToggle.checked = savedDeveloperMode;
  document.body.classList.toggle('developer-mode', savedDeveloperMode);

  developerToggle.addEventListener('change', () => {
    const enabled = developerToggle.checked;

    localStorage.setItem('bm_developer_mode', String(enabled));
    document.body.classList.toggle('developer-mode', enabled);
  });
}

const clearHistoryButton = document.getElementById('clearRecommendationHistoryBtn');

if (clearHistoryButton) {
  clearHistoryButton.addEventListener('click', () => {
    const confirmed = window.confirm(
      'Clear all saved recommendation history? This cannot be undone.'
    );

    if (!confirmed) return;

    clearRecommendationHistory();
    renderRecommendationHistory();
  });
}

const discordEnabledInput =
  document.getElementById('discordAlertsEnabled');

const discordWebhookInput =
  document.getElementById('discordWebhookUrl');

const testDiscordButton =
  document.getElementById('testDiscordWebhookBtn');

const discordStatus =
  document.getElementById('discordWebhookStatus');

const savedDiscordSettings = loadDiscordSettings();

if (discordEnabledInput) {
  discordEnabledInput.checked = !!savedDiscordSettings.enabled;
}

if (discordWebhookInput) {
  discordWebhookInput.value = savedDiscordSettings.webhookUrl || '';
}

function persistDiscordSettings() {
  saveDiscordSettings({
    enabled: !!discordEnabledInput?.checked,
    webhookUrl: discordWebhookInput?.value.trim() || ''
  });
}

discordEnabledInput?.addEventListener(
  'change',
  persistDiscordSettings
);

discordWebhookInput?.addEventListener(
  'change',
  persistDiscordSettings
);

testDiscordButton?.addEventListener('click', async () => {
  persistDiscordSettings();

  if (discordStatus) {
    discordStatus.textContent = 'Sending test alert...';
    discordStatus.className = 'mini';
  }

  try {
    await sendDiscordTestAlert();

    if (discordStatus) {
      discordStatus.textContent =
        'Test alert sent successfully.';
      discordStatus.className = 'mini good';
    }
  } catch (error) {
    if (discordStatus) {
      discordStatus.textContent =
        `Unable to send alert: ${error.message}`;
      discordStatus.className = 'mini bad';
    }
  }
});