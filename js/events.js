const EVENT_TYPE_RULES = [
  {
    type: "Supply Increase",
    expectedDirection: "down",
    baseConfidence: 0.9,
    patterns: [
      /new supplier/i,
      /supplier found/i,
      /production increased/i,
      /factory reopened/i,
      /new shipment/i,
      /surplus/i,
      /oversupply/i,
      /stockpile discovered/i,
      /supply glut/i,
      /glut hits the streets/i
    ]
  },
  {
    type: "Supply Decrease",
    expectedDirection: "up",
    baseConfidence: 0.9,
    patterns: [
      /supplier arrested/i,
      /supplier shut down/i,
      /factory fire/i,
      /factory closed/i,
      /shortage/i,
      /production halted/i,
      /shipment seized/i,
      /supply disrupted/i
    ]
  },
  {
    type: "Demand Increase",
    expectedDirection: "up",
    baseConfidence: 0.85,
    patterns: [
      /high demand/i,
      /demand surges/i,
      /record demand/i,
      /viral/i,
      /celebrity endorsement/i,
      /festival/i,
      /trend catches on/i
    ]
  },
  {
    type: "Demand Decrease",
    expectedDirection: "down",
    baseConfidence: 0.85,
    patterns: [
      /boycott/i,
      /recall/i,
      /demand drops/i,
      /demand falls/i,
      /loses popularity/i,
      /public backlash/i,
      /celebrity scandal/i
    ]
  },
  {
    type: "Enforcement",
    expectedDirection: null,
    baseConfidence: 0.7,
    patterns: [
      /customs/i,
      /police/i,
      /raid/i,
      /crackdown/i,
      /authorities/i,
      /investigation/i,
      /border control/i,
      /security tightened/i
    ]
  },
  {
    type: "Theft or Heist",
    expectedDirection: null,
    baseConfidence: 0.65,
    patterns: [
      /heist/i,
      /museum/i,
      /theft/i,
      /robbery/i,
      /stolen/i,
      /warehouse break-in/i
    ]
  },
  {
    type: "Regulatory",
    expectedDirection: null,
    baseConfidence: 0.6,
    patterns: [
      /new law/i,
      /legislation/i,
      /regulation/i,
      /ban announced/i,
      /legalized/i,
      /government/i
    ]
  }
];

function classifyEvent(name) {
  const normalized = String(name || "").trim();

  for (const rule of EVENT_TYPE_RULES) {
    if (rule.patterns.some(pattern => pattern.test(normalized))) {
      return {
        type: rule.type,
        expectedDirection: rule.expectedDirection,
        classificationConfidence: rule.baseConfidence,
        matched: true
      };
    }
  }

  return {
    type: "Unknown",
    expectedDirection: null,
    classificationConfidence: 0.25,
    matched: false
  };
}

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
  const normalized=normalizeEventName(name);

  const validatedKey=value=>{
    const key=keyForName(value);
    if(!key) return null;

    if(typeof COMMODITIES!=='undefined' && Array.isArray(COMMODITIES)){
      return COMMODITIES.some(([commodityKey])=>commodityKey===key) ? key : null;
    }

    return key;
  };

  // Original event format: “Event name — Commodity affected”.
  const affectedMatch=normalized.match(/[—-]\s*(.+?)\s+affected$/i);
  if(affectedMatch){
    const key=validatedKey(affectedMatch[1]);
    if(key) return key;
  }

  // Current game format: “Supply glut hits the streets: Exotic Animals”.
  // Only accept the suffix when it resolves to a known commodity so ordinary
  // punctuation in an event name cannot create a false target.
  const colonMatch=normalized.match(/:\s*([^:]+?)\s*$/);
  if(colonMatch){
    const key=validatedKey(colonMatch[1]);
    if(key) return key;
  }

  return null;
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
    const classification=classifyEvent(occ.name);
    const eventType=occ.eventType||classification.type;
    const expectedDirection=
      occ.expectedDirection ?? classification.expectedDirection;
    const classificationConfidence=
      Number.isFinite(occ.classificationConfidence)
        ? occ.classificationConfidence
        : classification.classificationConfidence;
    const classificationMatched=
      typeof occ.classificationMatched==="boolean"
        ? occ.classificationMatched
        : classification.matched;

    const name=occ.name;

    profiles[name] ||= {
      name,
      targetKey:occ.targetKey||null,
      eventType,
      expectedDirection,
      classificationConfidence,
      classificationMatched,
      occurrences:0,
      windows:{}
    };

    const p=profiles[name];
    p.occurrences++;

    const startMs=new Date(occ.startAt).getTime();

    for(const w of windows){
      const sample=nearestSampleAfter(occ.samples,startMs,w);
      if(!sample) continue;

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

        p.summary[w][key]={
          avg,
          positive,
          consistency,
          n:vals.length
        };
      }
    }
  }

  return profiles;
}

function summarizeEventTypes(mem) {
  const windows = [15, 60, 180, 360, 720, 1440];
  const profiles = {};

  for (const occ of mem.occurrences || []) {
    const eventType = occ.eventType || "Unknown";

    profiles[eventType] ||= {
      eventType,
      occurrences: 0,
      windows: {}
    };

    const profile = profiles[eventType];
    profile.occurrences++;

    const startMs = new Date(occ.startAt).getTime();

    for (const windowMinutes of windows) {
      const sample = nearestSampleAfter(
        occ.samples,
        startMs,
        windowMinutes
      );

      if (!sample) continue;

      profile.windows[windowMinutes] ||= {};

      for (const [commodityKey, startPrice] of Object.entries(
        occ.startPrices || {}
      )) {
        const endPrice = sample.prices?.[commodityKey];

        if (!(startPrice > 0 && endPrice > 0)) continue;

        const change = (endPrice - startPrice) / startPrice;

        profile.windows[windowMinutes][commodityKey] ||= [];
        profile.windows[windowMinutes][commodityKey].push(change);
      }
    }
  }

  for (const profile of Object.values(profiles)) {
    profile.summary = {};

    for (const [windowMinutes, byCommodity] of Object.entries(
      profile.windows
    )) {
      profile.summary[windowMinutes] = {};

      for (const [commodityKey, values] of Object.entries(byCommodity)) {
        const average =
          values.reduce((total, value) => total + value, 0) /
          values.length;

        const positiveRate =
          values.filter(value => value > 0).length /
          values.length;

        const consistency = Math.max(
          positiveRate,
          1 - positiveRate
        );

        profile.summary[windowMinutes][commodityKey] = {
          avg: average,
          positive: positiveRate,
          consistency,
          n: values.length
        };
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
function dedupeRawEvents(events){
  const byName=new Map();

  for(const event of events){
    const existing=byName.get(event.name);

    // When the page repeats the same normalized event with different ages,
    // keep the youngest active copy for display and active-signal processing.
    if(!existing || event.ageMinutes<existing.ageMinutes){
      byName.set(event.name,event);
    }
  }

  return [...byName.values()];
}

function updateEventMemory(data){
  const storageKey='bm_event_memory_v4';
  let mem;
  try{ mem=JSON.parse(localStorage.getItem(storageKey)||'{"occurrences":[],"snapshots":[]}'); }
  catch(e){ mem={occurrences:[],snapshots:[]}; }
  mem.occurrences ||= []; mem.snapshots ||= [];
  const now=new Date(data.parsedAt||new Date().toISOString());
  const prices=clonePrices(data);
  const parsedEvents = (data.events || [])
    .map(raw => {
      const name = normalizeEventName(raw);
      const classification = classifyEvent(name);

      return {
        raw,
        name,
        ageMinutes: parseEventAgeMinutes(raw),
        targetKey: eventTargetKey(name),
        eventType: classification.type,
        expectedDirection: classification.expectedDirection,
        classificationConfidence: classification.classificationConfidence,
        classificationMatched: classification.matched
      };
    })
    .filter(event => event.name);

  const rawEvents = dedupeRawEvents(parsedEvents);
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
      occ = {
  id: ev.name + "|" + inferredStart.toISOString(),
  name: ev.name,
  targetKey: eventTargetKey(ev.name),

  eventType: ev.eventType,
  expectedDirection: ev.expectedDirection,
  classificationConfidence: ev.classificationConfidence,
  classificationMatched: ev.classificationMatched,

  startAt: inferredStart.toISOString(),
  firstCapturedAt: now.toISOString(),
  lastSeenAt: now.toISOString(),
  startPrices: inferredStartPrices,
  samples: [],
  backfilledFromHistory: true
};
      mem.occurrences.push(occ);
    } else if(!occ.backfilledFromHistory && ev.ageMinutes>=15){
      // Upgrade occurrences created by older advisor versions, which incorrectly
      // used the first captured/current price as the event-start price.
      occ.startAt=inferredStart.toISOString();
      occ.startPrices=inferredStartPrices;
      occ.backfilledFromHistory=true;
    }
    occ.lastSeenAt=now.toISOString();
    occ.eventType = ev.eventType;
occ.expectedDirection = ev.expectedDirection;
occ.classificationConfidence = ev.classificationConfidence;
occ.classificationMatched = ev.classificationMatched;
    occ.samples ||= [];
    const sig=Object.values(prices).join(',');
    if(!occ.samples.some(s=>s.signature===sig)) occ.samples.push({at:now.toISOString(),prices,overlaps:rawEvents.map(e=>e.name).filter(n=>n!==ev.name),signature:sig});
  }
  if(mem.occurrences.length>500) mem.occurrences=mem.occurrences.slice(-500);
  localStorage.setItem(storageKey,JSON.stringify(mem));
  const profiles = summarizeEventOccurrences(mem);
const typeProfiles = summarizeEventTypes(mem);
const active = {};
  for(const ev of rawEvents){
    const p=profiles[ev.name];

    active[ev.name]={
      ...(p||{
        name:ev.name,
        targetKey:ev.targetKey||eventTargetKey(ev.name),
        occurrences:0,
        windows:{},
        summary:{}
      }),
      eventType:ev.eventType,
      expectedDirection:ev.expectedDirection,
      classificationConfidence:ev.classificationConfidence,
      classificationMatched:ev.classificationMatched,
      ageMinutes:ev.ageMinutes,
      raw:ev.raw
    };
  }
  return {
  occurrences: mem.occurrences.length,
  snapshots: mem.snapshots.length,
  profiles,
  typeProfiles,
  active,
  rawEvents
};
}

function getEventSignal(eventMemory, commodityKey) {
  const signals = [];

  for (const event of eventMemory?.rawEvents || []) {
    const exactProfile = eventMemory?.active?.[event.name];
    const typeProfile = eventMemory?.typeProfiles?.[event.eventType];

    let stat = null;
    let window = null;
    let source = null;

    // First choice: exact event history
    if (exactProfile) {
      for (const w of [360, 180, 720, 60, 1440]) {
        const candidate = exactProfile.summary?.[w]?.[commodityKey];

        if (candidate && candidate.n >= 2) {
          stat = candidate;
          window = w;
          source = "exact";
          break;
        }
      }
    }

    // Fallback: broader event-type history
    if (!stat && typeProfile) {
      for (const w of [360, 180, 720, 60, 1440]) {
        const candidate = typeProfile.summary?.[w]?.[commodityKey];

        if (candidate && candidate.n >= 3) {
          stat = candidate;
          window = w;
          source = "type";
          break;
        }
      }
    }

    const targetKey = event.targetKey || eventTargetKey(event.name);
    const appliesToCommodity = !targetKey || targetKey === commodityKey;

    if (!appliesToCommodity && targetKey) continue;

    const directionPrior =
      event.expectedDirection === "down" ? -0.12 :
      event.expectedDirection === "up" ? 0.10 :
      0;

    const isDirectTarget = Boolean(targetKey && targetKey === commodityKey);

    // If there is no usable history yet, classification still matters for an
    // explicitly targeted event. A known supply glut should not be treated as
    // neutral merely because the advisor has not observed several prior copies.
    if (!stat) {
      const classificationWeight = isDirectTarget ? 0.75 : 0.35;

      signals.push({
        name: event.name,
        eventType: event.eventType,
        expectedDirection: event.expectedDirection,
        classificationConfidence: event.classificationConfidence,
        classificationMatched: event.classificationMatched,

        avg: directionPrior,
        effect: directionPrior,
        n: 0,
        consistency: 0,
        historicalConfidence: 0,
        confidence: Math.min(
          1,
          event.classificationConfidence * classificationWeight
        ),

        ageMinutes: event.ageMinutes || 0,
        targetKey,
        window: null,
        source: "classification",
        targeted: isDirectTarget,
        activeTargetedBearish:
          isDirectTarget &&
          event.expectedDirection === "down" &&
          event.classificationConfidence >= 0.70,
        activeTargetedBullish:
          isDirectTarget &&
          event.expectedDirection === "up" &&
          event.classificationConfidence >= 0.70
      });

      continue;
    }

    const sampleConfidence = Math.min(1, stat.n / 8);
    const historicalConfidence =
      sampleConfidence * stat.consistency;

    const sourceMultiplier =
      source === "exact" ? 1 : 0.82;

    const combinedConfidence =
      (
        historicalConfidence * 0.75 +
        event.classificationConfidence * 0.25
      ) * sourceMultiplier;

    // Let measured history lead, while retaining a small directional prior
    // from a high-confidence classification. This prevents one noisy sample from
    // completely reversing the economic meaning of a directly targeted event.
    const measuredWeight = Math.min(0.90, 0.65 + historicalConfidence * 0.25);
    const blendedEffect =
      stat.avg * measuredWeight +
      directionPrior * (1 - measuredWeight);

    const strongContraryHistory =
      stat.n >= 3 &&
      stat.consistency >= 0.70 &&
      (
        (event.expectedDirection === "down" && stat.avg > 0.03) ||
        (event.expectedDirection === "up" && stat.avg < -0.03)
      );

    signals.push({
      name: event.name,
      eventType: event.eventType,
      expectedDirection: event.expectedDirection,
      classificationConfidence: event.classificationConfidence,
      classificationMatched: event.classificationMatched,

      avg: stat.avg,
      effect: blendedEffect,
      n: stat.n,
      consistency: stat.consistency,
      historicalConfidence,
      confidence: Math.min(1, combinedConfidence),

      ageMinutes: event.ageMinutes || 0,
      targetKey,
      window,
      source,
      targeted: isDirectTarget,
      strongContraryHistory,
      activeTargetedBearish:
        isDirectTarget &&
        event.expectedDirection === "down" &&
        event.classificationConfidence >= 0.70 &&
        !strongContraryHistory,
      activeTargetedBullish:
        isDirectTarget &&
        event.expectedDirection === "up" &&
        event.classificationConfidence >= 0.70 &&
        !strongContraryHistory
    });
  }

  if (!signals.length) {
    return {
      effect: 0,
      confidence: 0,
      classificationConfidence: 0,
      historicalConfidence: 0,
      source: null,
      signals: []
    };
  }

  const weight =
    signals.reduce((sum, signal) => sum + signal.confidence, 0) || 1;

  const effect =
    signals.reduce(
      (sum, signal) =>
        sum + Number(signal.effect ?? signal.avg ?? 0) * signal.confidence,
      0
    ) / weight;

  const confidence = Math.min(
    1,
    signals.reduce(
      (sum, signal) => sum + signal.confidence,
      0
    ) / signals.length
  );

  const classificationConfidence =
    signals.reduce(
      (sum, signal) =>
        sum + signal.classificationConfidence,
      0
    ) / signals.length;

  const historicalConfidence =
    signals.reduce(
      (sum, signal) =>
        sum + signal.historicalConfidence,
      0
    ) / signals.length;

  const bestSignal = [...signals].sort(
    (a, b) => b.confidence - a.confidence
  )[0];

  const activeTargetedBearish = signals.some(
    signal => signal.activeTargetedBearish
  );
  const activeTargetedBullish = signals.some(
    signal => signal.activeTargetedBullish
  );
  const blockingSignals = signals.filter(
    signal => signal.activeTargetedBearish
  );
  const youngestAgeMinutes = signals.length
    ? Math.min(...signals.map(signal => Number(signal.ageMinutes || 0)))
    : null;

  return {
    effect,
    confidence,
    classificationConfidence,
    historicalConfidence,
    source: bestSignal?.source || null,
    eventType: bestSignal?.eventType || "Unknown",
    expectedDirection:
      bestSignal?.expectedDirection || null,
    activeTargetedBearish,
    activeTargetedBullish,
    blockingSignals,
    youngestAgeMinutes,
    signals
  };
}