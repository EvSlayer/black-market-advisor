window.BM_PARSER_VERSION='v10-leaderboard-ranking';
/* Black Market Advisor HTML parser.
   Extracts market prices, portfolio data, active events, current user identity,
   leaderboard standings, and ranking context from the same captured page. */

function parseProfileIdFromHref(href){
  const value=String(href||'');
  const match=value.match(/[?&]id=(\d+)/i);
  return match?match[1]:null;
}

function parseGangIdFromHref(href){
  const match=String(href||'').match(/\/gang\/(\d+)/i);
  return match?match[1]:null;
}

function parseSignedPercent(text){
  const n=Number(String(text||'').replace(/[%+,]/g,'').trim());
  return Number.isFinite(n)?n/100:null;
}

function parseTimeRemainingMinutes(text){
  const value=String(text||'').toLowerCase();
  let total=0;
  const days=value.match(/(\d+(?:\.\d+)?)\s*d(?:ay)?s?/);
  const hours=value.match(/(\d+(?:\.\d+)?)\s*h(?:ou)?rs?/);
  const minutes=value.match(/(\d+(?:\.\d+)?)\s*m(?:in)?(?:ute)?s?/);
  if(days) total+=Number(days[1])*1440;
  if(hours) total+=Number(hours[1])*60;
  if(minutes) total+=Number(minutes[1]);
  return Number.isFinite(total)&&total>0?Math.round(total):null;
}

function parseCurrentUser(doc){
  const container=doc.querySelector('.user-info-name');
  const profileLink=container?.querySelector('a[href*="/profile?id="]')||null;
  const gangLink=container?.querySelector('a[href^="/gang/"]')||null;

  return {
    profileId:parseProfileIdFromHref(profileLink?.getAttribute('href')),
    name:profileLink?.textContent.replace(/\s+/g,' ').trim()||'',
    gangId:parseGangIdFromHref(gangLink?.getAttribute('href')),
    rawText:container?.textContent.replace(/\s+/g,' ').trim()||''
  };
}

function parseLeaderboard(doc,currentUser){
  const rows=[];

  doc.querySelectorAll('.bm-leaderboard table tr').forEach(row=>{
    const cells=[...row.querySelectorAll('td')];
    if(cells.length<4) return;

    const rank=Number(cells[0].textContent.trim());
    const profileLink=cells[1].querySelector('a[href*="/profile?id="]');
    const gangLink=cells[1].querySelector('a[href^="/gang/"]');
    const profileId=parseProfileIdFromHref(profileLink?.getAttribute('href'));
    const player=profileLink?.textContent.replace(/\s+/g,' ').trim()||'';
    const portfolio=cleanNum(cells[2].textContent);
    const gainPct=parseSignedPercent(cells[3].textContent);
    const style=String(row.getAttribute('style')||'').toLowerCase().replace(/\s+/g,'');
    const boldFallback=style.includes('font-weight:bold');

    if(!Number.isFinite(rank)||!player||!Number.isFinite(portfolio)||portfolio<=0) return;

    rows.push({
      rank,
      player,
      profileId,
      gangId:parseGangIdFromHref(gangLink?.getAttribute('href')),
      portfolio,
      gainPct,
      isCurrentUser:currentUser?.profileId
        ? profileId===currentUser.profileId
        : boldFallback
    });
  });

  return rows.sort((a,b)=>a.rank-b.rank);
}

function buildRankingContext(leaderboard,currentUser,totalPortfolio){
  const rows=[...(leaderboard||[])].sort((a,b)=>a.rank-b.rank);
  let index=rows.findIndex(row=>row.isCurrentUser);

  if(index<0 && currentUser?.profileId){
    index=rows.findIndex(row=>row.profileId===currentUser.profileId);
  }

  if(index<0 && Number.isFinite(totalPortfolio) && totalPortfolio>0){
    index=rows.findIndex(row=>Math.abs(row.portfolio-totalPortfolio)<=1);
  }

  if(index<0) return {
    current:null,
    above:null,
    below:null,
    gapToAbove:null,
    gapToPass:null,
    leadOverBelow:null,
    requiredPctToPass:null
  };

  const current=rows[index];
  const above=index>0?rows[index-1]:null;
  const below=index<rows.length-1?rows[index+1]:null;
  const gapToAbove=above?Math.max(0,above.portfolio-current.portfolio):0;
  const gapToPass=above?gapToAbove+1:0;
  const leadOverBelow=below?Math.max(0,current.portfolio-below.portfolio):0;

  return {
    current,
    above,
    below,
    gapToAbove,
    gapToPass,
    leadOverBelow,
    requiredPctToPass:current.portfolio>0?gapToPass/current.portfolio:0,
    cushionPct:current.portfolio>0?leadOverBelow/current.portfolio:0
  };
}

function parseBlackMarket(html){
  const doc=new DOMParser().parseFromString(String(html||''),'text/html');
  const text=doc.body?.innerText||doc.documentElement?.innerText||'';
  const parsedAt=new Date().toISOString();

  const commodities=[];
  doc.querySelectorAll('.bm-card[data-commodity]').forEach(card=>{
    const key=card.getAttribute('data-commodity');
    const name=card.querySelector('.bm-card-name')?.textContent.trim()||nameFor(key);
    const price=cleanNum(card.getAttribute('data-price')||card.querySelector('.bm-card-price')?.textContent);
    let history=[];

    const canvas=card.querySelector('canvas[data-prices]');
    if(canvas){
      try{
        history=JSON.parse(
          String(canvas.getAttribute('data-prices')||'[]').replaceAll('&quot;','"')
        ).map(Number).filter(x=>Number.isFinite(x)&&x>0);
      }catch(error){
        history=[];
      }
    }

    const changeText=card.querySelector('.bm-card-change')?.textContent.trim()||'';
    if(key) commodities.push({key,name,price,history,changeText});
  });

  const events=[...doc.querySelectorAll('.bm-event')]
    .map(node=>node.textContent.replace(/\s+/g,' ').trim())
    .filter(Boolean);

  const tradesRemaining=(()=>{
    const match=text.match(/Trade Panel\s*[—-]\s*(\d+)\s+trades remaining/i);
    return match?Number(match[1]):null;
  })();

  const timeRemaining=(()=>{
    const headings=[...doc.querySelectorAll('h1,h2,h3,.content_h')]
      .map(node=>node.textContent.replace(/\s+/g,' ').trim());
    const line=headings.find(value=>/week ends in:/i.test(value))
      || text.match(/Week ends in:\s*([^\n]+)/i)?.[0]
      || '';
    return String(line).replace(/^.*?Week ends in:\s*/i,'').trim();
  })();

  const cash=cleanNum(doc.querySelector('#bm-trade-form')?.getAttribute('data-cash'))
    ||(()=>{
      const match=text.match(/\bCash\s*\$([\d,]+)/i);
      return match?cleanNum(match[1]):0;
    })();

  const holdings=[];
  doc.querySelectorAll('#bm-commodity option[data-held]').forEach(option=>{
    const held=cleanNum(option.getAttribute('data-held'));
    if(held>0){
      holdings.push({
        key:option.value,
        name:nameFor(option.value),
        qty:held,
        price:cleanNum(option.getAttribute('data-price'))
      });
    }
  });

  doc.querySelectorAll('.bm-portfolio table tr').forEach(row=>{
    const cells=[...row.querySelectorAll('td')].map(cell=>cell.textContent.trim());
    if(cells.length<5||/^(cash|total)$/i.test(cells[0])) return;

    const key=keyForName(cells[0]);
    const detail={
      key,
      name:cells[0],
      qty:cleanNum(cells[1]),
      avgBuy:cleanNum(cells[2]),
      current:cleanNum(cells[3]),
      value:cleanNum(cells[4]),
      pl:cells.length>=6?cleanNum(cells[5]):0
    };

    const existing=holdings.find(item=>item.key===key);
    if(existing) Object.assign(existing,detail);
    else if(detail.qty>0||detail.value>0) holdings.push(detail);
  });

  const recentTrades=[];
  const tradeTables=[...doc.querySelectorAll('table')].filter(table=>
    /Action\s*Commodity\s*Qty\s*Price\s*Total/i.test(
      table.innerText.replace(/\n/g,' ')
    )
  );

  tradeTables.forEach(table=>{
    table.querySelectorAll('tr').forEach((row,index)=>{
      if(index===0) return;
      const cells=[...row.querySelectorAll('td')].map(cell=>cell.textContent.trim());
      if(cells.length>=5){
        recentTrades.push({
          action:cells[0],
          commodity:cells[1],
          qty:cleanNum(cells[2]),
          price:cleanNum(cells[3]),
          total:cleanNum(cells[4])
        });
      }
    });
  });

  const calculatedPortfolio=cash+holdings.reduce(
    (sum,h)=>sum+(h.value||h.qty*(h.current||h.price)||0),
    0
  );

  const totalPortfolio=(()=>{
    const totalRow=[...doc.querySelectorAll('.bm-portfolio table tr')].find(row=>
      /^Total$/i.test(row.querySelector('td')?.textContent.trim()||'')
    );

    if(totalRow){
      const moneyCell=[...totalRow.querySelectorAll('td')]
        .map(cell=>cell.textContent.trim())
        .find(value=>/\$[\d,]+/.test(value));
      const amount=cleanNum(moneyCell);
      if(amount>0) return amount;
    }

    return calculatedPortfolio;
  })();

  const currentUser=parseCurrentUser(doc);
  const leaderboard=parseLeaderboard(doc,currentUser);
  const ranking=buildRankingContext(leaderboard,currentUser,totalPortfolio);

  return {
    timeRemaining,
    timeRemainingMinutes:parseTimeRemainingMinutes(timeRemaining),
    tradesRemaining,
    cash,
    totalPortfolio,
    events,
    commodities,
    holdings,
    recentTrades,
    currentUser,
    leaderboard,
    ranking,
    parsedAt
  };
}