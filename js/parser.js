function parseBlackMarket(html){
  const doc = new DOMParser().parseFromString(html,'text/html');
  const text = doc.body?.innerText || doc.documentElement.innerText || '';
  const commodities = [];
  doc.querySelectorAll('.bm-card[data-commodity]').forEach(card=>{
    const key = card.getAttribute('data-commodity');
    const name = card.querySelector('.bm-card-name')?.textContent.trim() || nameFor(key);
    const price = cleanNum(card.getAttribute('data-price') || card.querySelector('.bm-card-price')?.textContent);
    let history = [];
    const canvas = card.querySelector('canvas[data-prices]');
    if(canvas){
      try { history = JSON.parse(canvas.getAttribute('data-prices').replaceAll('&quot;','"')).map(Number); }
      catch(e){ history = []; }
    }
    const changeText = card.querySelector('.bm-card-change')?.textContent.trim() || '';
    commodities.push({key,name,price,history,changeText});
  });
  const events = [...doc.querySelectorAll('.bm-event')].map(e=>e.textContent.replace(/\s+/g,' ').trim());
  const tradesRemaining = (()=>{ const m = text.match(/Trade Panel\s*[—-]\s*(\d+)\s+trades remaining/i); return m?Number(m[1]):null; })();
  const timeRemaining = doc.querySelector('h2.content_h')?.textContent.match(/Week ends in:\s*(.*)$/i)?.[1] || '';
  const cash = cleanNum(doc.querySelector('#bm-trade-form')?.getAttribute('data-cash')) || (()=>{ const m=text.match(/Cash\s*\$([\d,]+)/i); return m?cleanNum(m[1]):0; })();
  const holdings = [];
  doc.querySelectorAll('#bm-commodity option[data-held]').forEach(opt=>{
    const held = cleanNum(opt.getAttribute('data-held'));
    if(held>0) holdings.push({key:opt.value,name:nameFor(opt.value),qty:held,price:cleanNum(opt.getAttribute('data-price'))});
  });
  // Better holding details from portfolio table when available.
  doc.querySelectorAll('.bm-portfolio table tr').forEach(tr=>{
    const tds=[...tr.querySelectorAll('td')].map(td=>td.textContent.trim());
    if(tds.length>=6 && !/cash|total/i.test(tds[0])){
      const key=keyForName(tds[0]);
      const existing=holdings.find(h=>h.key===key);
      const data={key,name:tds[0],qty:cleanNum(tds[1]),avgBuy:cleanNum(tds[2]),current:cleanNum(tds[3]),value:cleanNum(tds[4]),pl:cleanNum(tds[5])};
      if(existing) Object.assign(existing,data); else holdings.push(data);
    }
  });
  const recentTrades=[];
  const tradeTables=[...doc.querySelectorAll('table')].filter(t=>/Action\s*Commodity\s*Qty\s*Price\s*Total/i.test(t.innerText.replace(/\n/g,' ')));
  tradeTables.forEach(table=>table.querySelectorAll('tr').forEach((tr,i)=>{
    if(i===0) return; const t=[...tr.querySelectorAll('td')].map(td=>td.textContent.trim());
    if(t.length>=5) recentTrades.push({action:t[0], commodity:t[1], qty:cleanNum(t[2]), price:cleanNum(t[3]), total:cleanNum(t[4])});
  }));
  const calculatedPortfolio = cash + holdings.reduce((s,h)=>s+(h.value || h.qty*h.current || h.qty*h.price),0);
  const totalPortfolio = (()=>{
    // Prefer the actual Total row inside My Portfolio. A broad regex can accidentally grab the trade panel Total ($612).
    const totalRow = [...doc.querySelectorAll('.bm-portfolio table tr')].find(tr=>{
      const first = tr.querySelector('td')?.textContent.trim() || '';
      return /^Total$/i.test(first);
    });
    if(totalRow){
      const cells=[...totalRow.querySelectorAll('td')].map(td=>td.textContent.trim());
      const moneyCell=cells.find(x=>/\$[\d,]+/.test(x));
      const n=cleanNum(moneyCell);
      if(n>0) return n;
    }
    return calculatedPortfolio;
  })();
  return {timeRemaining,tradesRemaining,cash,totalPortfolio,events,commodities,holdings,recentTrades,parsedAt:new Date().toISOString()};
}

