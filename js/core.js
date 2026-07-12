const COMMODITIES = [
  ['counterfeit_bills','Counterfeit Bills'],['stolen_electronics','Stolen Electronics'],['prescription_pills','Prescription Pills'],['uncut_cocaine','Uncut Cocaine'],['military_hardware','Military Hardware'],['exotic_animals','Exotic Animals'],['enriched_uranium','Enriched Uranium'],['stolen_art','Stolen Art']
];
const isValidMoney = n => Number.isFinite(Number(n)) && Number(n) > 0;
const fmt = n => Number.isFinite(Number(n)) ? (Number(n) < 0 ? '-$' : '$') + Math.abs(Math.round(Number(n))).toLocaleString() : '—';
const pct = n => (n>=0?'+':'') + (n*100).toFixed(1) + '%';
const cleanNum = s => Number(String(s||'').replace(/[^0-9.-]/g,'')) || 0;
const quantile = (arr,q) => { if(!arr.length) return 0; const a=[...arr].sort((x,y)=>x-y); const pos=(a.length-1)*q; const lo=Math.floor(pos), hi=Math.ceil(pos); return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo); };
const nameFor = key => (COMMODITIES.find(x=>x[0]===key)||[key,key])[1];
const keyForName = name => (COMMODITIES.find(x=>x[1].toLowerCase()===String(name).toLowerCase())||[])[0] || String(name).toLowerCase().replace(/\s+/g,'_');


