// Smart-player simulation, run inside the page. Returns per-minute stats.
window.simRun = function(f, minutes, opts){
  opts = opts || {};
  try{localStorage.clear()}catch(e){}
  RF.startGame({name:'Sim',f,lvl:1,xp:0,credits:120,iron:0,lumen:0,shards:1,hpPot:5,fpPot:3,wT:0,wP:0,aT:0,aP:0,wp:0,kills:0,pk:0,deaths:0,wins:0,bounty:null,tut:9},null);
  const P=RF.P; P.auto=true;
  const ANG={aether:-Math.PI/2,ferros:Math.PI*5/6,chrome:Math.PI/6}, C={x:2100,y:2050};
  const BASE={x:C.x+Math.cos(ANG[f])*1600,y:C.y+Math.sin(ANG[f])*1600};
  const ZD=l=>l<4?470:l<8?710:l<12?920:l<17?1110:1300;
  const out=[]; let skillT=0, sk=0;
  const rows=[];
  for(let sec=0; sec<minutes*60; sec++){
    RF.step(1, 1/30);
    if(P.dead) continue;
    // every 20s: shop + reposition
    if(sec%20===0){
      for(let i=0;i<3;i++){ if(P.iron<120) P.iron+=1; }           // light mining while hunting
      RF.doAct('tier:w'); RF.doAct('tier:a');
      if(P.hpPot<8 && P.credits>300) RF.doAct('buy:hp:5');
      if(P.fpPot<4 && P.credits>300) RF.doAct('buy:fp:5');
      const r=ZD(P.lvl), db=Math.hypot(P.x-BASE.x,P.y-BASE.y), toC=Math.atan2(C.y-BASE.y,C.x-BASE.x);
      if(Math.abs(db-r)>200 || P.hp<P.maxHp*.3){ const a=toC+(Math.random()-.5)*1.6; P.x=BASE.x+Math.cos(a)*r; P.y=BASE.y+Math.sin(a)*r; P.target=null; P.engage=false; }
    }
    // skills
    if(P.target && P.engage && !P.dead){ if(f==='aether'&&P.hp<P.maxHp*.6) RF.useSkill(1); else RF.useSkill(sk%3); sk++; }
    if(sec%60===59){
      const ais=RF.ais, by=(k,role)=>{const l=ais.filter(a=>a.f===k&&(role==='hunt'?a.role==='hunt':a.role!=='hunt')).map(a=>a.lvl);return l.length?+(l.reduce((s,v)=>s+v,0)/l.length).toFixed(1):0;};
      rows.push({min:(sec+1)/60,lvl:P.lvl,xp:Math.round(P.xp/RF.xpNeed(P.lvl)*100),deaths:P.deaths,kills:P.kills,pk:P.pk,wT:P.wT,
        botHunt:by(f,'hunt'),botWar:by(f,'war'),enemyHunt:Math.max(...['ferros','aether','chrome'].filter(k=>k!==f).map(k=>by(k,'hunt'))),enemyWar:Math.max(...['ferros','aether','chrome'].filter(k=>k!==f).map(k=>by(k,'war')))});
    }
  }
  return rows;
};
