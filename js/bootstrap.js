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
    saveRecommendationHistory(data, result);
    render(data,result);
    renderMoveRecords(data);
    lastData=data;
    lastResult=result;
    document.getElementById('results').classList.remove('hidden');
    document.getElementById('saveSnapshotBtn').disabled=false;
    document.getElementById('parseStatus').textContent=`Parsed ${data.commodities.length} commodities${sourceLabel ? ' from '+sourceLabel : ''}. Memory: ${memoryStats.totalPoints.toLocaleString()} price points (${memoryStats.totalAdded} new).`;
  }
  catch(e){ err.textContent=e.message; err.classList.remove('hidden'); }
}

function refreshBookmarklet(){
  const url=(document.getElementById('advisorUrl')?.value || location.href.split('#')[0]).trim();
  const js = `javascript:(()=>{const u=${JSON.stringify(url)};const html=document.documentElement.outerHTML;const w=window.open(u,'_blank');let n=0;const send=()=>{try{w.postMessage({type:'BM_ADVISOR_CAPTURE',html,source:location.href,capturedAt:new Date().toISOString()},'*')}catch(e){}if(++n<24)setTimeout(send,500)};setTimeout(send,800);})();`;
  const link=document.getElementById('bookmarkletLink');
  const box=document.getElementById('bookmarkletCode');
  if(link) link.href=js;
  if(box) box.textContent=js;
}

function tryImportFromBookmarklet(){
  window.addEventListener('message', (event)=>{
    const payload=event.data;
    if(!payload || payload.type!=='BM_ADVISOR_CAPTURE' || !payload.html) return;
    analyzeHtml(payload.html, 'game page');
    try{ window.focus(); }catch(e){}
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
document.querySelectorAll('.advisor-chip').forEach(b=>b.addEventListener('click',()=>submitAdvisorQuestion(b.textContent)));
document.getElementById('saveSnapshotBtn').onclick=()=>{ if(!lastData) return; const snaps=JSON.parse(localStorage.getItem('bm_snapshots')||'[]'); snaps.push({data:lastData,result:lastResult}); localStorage.setItem('bm_snapshots',JSON.stringify(snaps)); document.getElementById('parseStatus').textContent=`Snapshot saved locally (${snaps.length}).`; };
document.getElementById('advisorUrl').value=location.href.split('#')[0];
document.getElementById('advisorUrl').addEventListener('input',refreshBookmarklet);
document.getElementById('copyBookmarkletBtn').onclick=async()=>{
  refreshBookmarklet();
  const code=document.getElementById('bookmarkletCode').textContent;
  try{ await navigator.clipboard.writeText(code); document.getElementById('parseStatus').textContent='Bookmarklet copied.'; }
  catch(e){ document.getElementById('parseStatus').textContent='Could not copy automatically. Open “Show bookmarklet code” and copy it manually.'; }
};
refreshBookmarklet();
renderAssumptions(null);
tryImportFromBookmarklet();

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