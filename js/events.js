function normalizeEventName(text){
  return String(text||'').replace(/\s*\([^)]*ago\)\s*$/i,'').trim();
}
function parseEventAgeMinutes(text){
  const s=String(text||'');
  let m=s.match(/\((\d+)m ago\)/i); if(m) return Number(m[1]);
  m=s.match(/\((\d+)h ago\)/i); if(m) return Number(m[1])*60;
  m=s.match(/\((\d+)d ago\)/i); if(m) return Number(m[1])*1440;
  return 0;
}
function eventTargetKey(name){
  const m=String(name||'').match(/[—-]\s*(.+?)\s+affected$/i);
  return m ? keyForName(m[1]) : null;
}
function clonePrices(data){
  return Object.fromEntries((data.commodities||[]).map(c=>[c.key,Number(c.price)||0]));
}
function nearestSampleAfter(samples,startMs,minMinutes){
  const target=startMs+minMinutes*60000;
  const valid=(samples||[]).filter(s=>new Date(s.at).getTime()>=target).sort((a,b)=>new Date(a.at)-new Date(b.at));
  return valid[0]||null;
}
function summarizeEventOccurrences(mem){
  const windows=[15,60,180,360,720,1440];
  const profiles={};
  for(const occ of mem.occurrences||[]){
    const name=occ.name; profiles[name] ||= {name,targetKey:occ.targetKey||null,occurrences:0,windows:{}};
    const p=profiles[name]; p.occurrences++;
    const startMs=new Date(occ.startAt).getTime();
    for(const w of windows){
      const sample=nearestSampleAfter(occ.samples,startMs,w); if(!sample) continue;
      p.windows[w] ||= {};
      for(const [key,startPrice] of Object.entries(occ.startPrices||{})){
        const endPrice=sample.prices?.[key];
        if(!(startPrice>0 && endPrice>0)) continue;
        const change=(endPrice-startPrice)/startPrice;
        p.windows[w][key] ||= [];
        p.windows[w][key].push(change);
      }
    }
  }
  for(const p of Object.values(profiles)){
    p.summary={};
    for(const [w,byKey] of Object.entries(p.windows)){
      p.summary[w]={};
      for(const [key,vals] of Object.entries(byKey)){
        const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
        const positive=vals.filter(v=>v>0).length/vals.length;
        const consistency=Math.max(positive,1-positive);
        p.summary[w][key]={avg,positive,consistency,n:vals.length};
      }
    }
  }
  return profiles;
}
function inferEventStartPrices(data, ageMinutes){
  const inferred={};
  const steps=Math.max(0,Math.round((Number(ageMinutes)||0)/15));
  for(const c of data.commodities||[]){
    const hist=(c.history||[]).map(Number).filter(x=>Number.isFinite(x)&&x>0);
    if(!hist.length){ inferred[c.key]=c.price; continue; }
    // Sparkline points represent consecutive 15-minute updates and normally end
    // with the current price. Walk backward by the event's displayed age.
    const idx=Math.max(0,hist.length-1-steps);
    inferred[c.key]=hist[idx]||c.price;
  }
  return inferred;
}
function updateEventMemory(data){
  const storageKey='bm_event_memory_v4';
  let mem;
  try{ mem=JSON.parse(localStorage.getItem(storageKey)||'{"occurrences":[],"snapshots":[]}'); }
  catch(e){ mem={occurrences:[],snapshots:[]}; }
  mem.occurrences ||= []; mem.snapshots ||= [];
  const now=new Date(data.parsedAt||new Date().toISOString());
  const prices=clonePrices(data);
  const rawEvents=(data.events||[]).map(raw=>({raw,name:normalizeEventName(raw),ageMinutes:parseEventAgeMinutes(raw)})).filter(e=>e.name);
  const snapshotSig=rawEvents.map(e=>e.name).sort().join('|')+'|'+Object.values(prices).join(',');
  if(!mem.snapshots.some(x=>x.signature===snapshotSig)){
    mem.snapshots.push({at:now.toISOString(),events:rawEvents.map(e=>e.name),prices,signature:snapshotSig});
    if(mem.snapshots.length>2000) mem.snapshots=mem.snapshots.slice(-2000);
  }
  for(const ev of rawEvents){
    const inferredStart=new Date(now.getTime()-ev.ageMinutes*60000);
    // Reuse an occurrence while the event remains continuous. If it vanished for >8h,
    // treat a later appearance as a new occurrence.
    let occ=[...mem.occurrences].reverse().find(o=>o.name===ev.name && (now-new Date(o.lastSeenAt||o.startAt))<=8*3600000);
    const inferredStartPrices=inferEventStartPrices(data,ev.ageMinutes);
    if(!occ){
      occ={id:ev.name+'|'+inferredStart.toISOString(),name:ev.name,targetKey:eventTargetKey(ev.name),startAt:inferredStart.toISOString(),firstCapturedAt:now.toISOString(),lastSeenAt:now.toISOString(),startPrices:inferredStartPrices,samples:[],backfilledFromHistory:true};
      mem.occurrences.push(occ);
    } else if(!occ.backfilledFromHistory && ev.ageMinutes>=15){
      // Upgrade occurrences created by older advisor versions, which incorrectly
      // used the first captured/current price as the event-start price.
      occ.startAt=inferredStart.toISOString();
      occ.startPrices=inferredStartPrices;
      occ.backfilledFromHistory=true;
    }
    occ.lastSeenAt=now.toISOString();
    occ.samples ||= [];
    const sig=Object.values(prices).join(',');
    if(!occ.samples.some(s=>s.signature===sig)) occ.samples.push({at:now.toISOString(),prices,overlaps:rawEvents.map(e=>e.name).filter(n=>n!==ev.name),signature:sig});
  }
  if(mem.occurrences.length>500) mem.occurrences=mem.occurrences.slice(-500);
  localStorage.setItem(storageKey,JSON.stringify(mem));
  const profiles=summarizeEventOccurrences(mem);
  const active={};
  for(const ev of rawEvents){
    const p=profiles[ev.name];
    if(p) active[ev.name]=p;
  }
  return {occurrences:mem.occurrences.length,snapshots:mem.snapshots.length,profiles,active,rawEvents};
}
function getEventSignal(eventMemory, commodityKey){
  const signals=[];
  for(const [name,p] of Object.entries(eventMemory?.active||{})){
    // Prefer a 6h result, then 3h, 12h, 1h. Require at least two independent occurrences.
    let stat=null, window=null;
    for(const w of [360,180,720,60,1440]){
      const x=p.summary?.[w]?.[commodityKey];
      if(x && x.n>=2){ stat=x; window=w; break; }
    }
    if(!stat) continue;
    const targeted=!p.targetKey || p.targetKey===commodityKey;
    if(!targeted && p.targetKey) continue;
    const confidence=Math.min(1,(stat.n/5))*stat.consistency;
    signals.push({name,avg:stat.avg,n:stat.n,consistency:stat.consistency,confidence,window,targeted:!!p.targetKey});
  }
  if(!signals.length) return {effect:0,confidence:0,signals:[]};
  const weight=signals.reduce((s,x)=>s+x.confidence,0)||1;
  const effect=signals.reduce((s,x)=>s+x.avg*x.confidence,0)/weight;
  const confidence=Math.min(1,signals.reduce((s,x)=>s+x.confidence,0)/signals.length);
  return {effect,confidence,signals};
}
