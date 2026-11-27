const PLAN_START='2026-11-22';
const FIRST_DAY=[['08:00','09:15','FAR','required'],['09:30','10:05','国徴','required']];
function migratePlan(data) {
  if(!data.settings.taxDateMigrated){
    if(data.settings.taxExam==='2027-08-01')data.settings.taxExam='';
    data.settings.taxDateMigrated=true;
  }
  if(!data.settings.taxAug5Migrated){
    if(!data.settings.taxExam)data.settings.taxExam='2027-08-05';
    data.settings.taxAug5Migrated=true;
  }
  for(const task of data.tasks) {
    const match=/^tax-(theory|problem)-\d+-(\d+)$/.exec(task.id);
    if(!match)continue;
    const label=match[1]==='theory'?'理論':'問題';
    const oldLabel='｜'+label+(Number(match[2])+1)+'（仮ラベル）';
    if(task.name.endsWith(oldLabel))task.name=task.name.slice(0,-oldLabel.length)+'｜'+label+match[2]+'（仮ラベル）';
  }
  return data;
}
function planTargets(date) {
  if(weekDays(date)[6]>=accountingStart)return {FAR:weekStart(date)<state.settings.farExam?1260:0,国徴:0};
  if(weekStart(date)<weekStart(PLAN_START))return {FAR:0,国徴:0};
  if(weekStart(date)===weekStart(PLAN_START))return {FAR:75,国徴:35};
  if(weekDays(date).some(taxOnlyDay)){
    return weekDays(date).reduce((totals,day)=>{
      if(taxOnlyDay(day)){
        const type=['sunday','office','office','office','remote','remote','saturday'][dow(day)];
        totals.国徴+=taxMinutes(day,type);
      }else if(day<state.settings.farExam){
        for(const [start,end,subject,kind] of templateBlocks(day))if(kind==='required')totals[subject]+=mins(end)-mins(start);
      }
      return totals;
    },{FAR:0,国徴:0});
  }
  return weeklyTargets;
}
function orderedPlanTasks(subject) {
  // Completed items retain their place on the timeline so marking a task
  // complete cannot shift a later lesson into a previously scheduled slot.
  const tasks=state.tasks.filter(t=>t.subject===subject && !/^lecture-0-[1-6]$/.test(t.id));
  if(subject==='国徴')return taxMaterials(tasks);
  const lessons=tasks.filter(t=>t.kind==='lecture');
  const exercises=tasks.filter(t=>t.kind==='mcq'||t.kind==='tbs');
  const pending=new Map(exercises.map(t=>[t,Math.max(0,Number(t.minutes)||0)]));
  const ordered=[];
  function appendPractice(kind,budget) {
    for(const task of exercises){
      if(task.kind!==kind || !pending.get(task))continue;
      const minutes=Math.min(budget,pending.get(task));
      ordered.push({...task,minutes});
      pending.set(task,pending.get(task)-minutes);
      budget-=minutes;
      if(!budget)break;
    }
  }
  for(const lesson of lessons){
    ordered.push(lesson);
    // Keep the initial Sunday and Monday morning as previously scheduled.
    if(lesson.id==='lecture-0-7')continue;
    appendPractice('mcq',lesson.id==='lecture-0-8'?15:30);
    appendPractice('tbs',15);
  }
  for(const task of tasks){
    if(task.kind==='lecture')continue;
    if(!pending.has(task))ordered.push(task);
    else if(pending.get(task)>0)ordered.push({...task,minutes:pending.get(task)});
  }
  return ordered;
}
function weeklyRecovery(cap, sun, sunParts, carry) {
  const slots=[], lost=[];
  for(const day of cap)for(const block of day.slots){
    if(block.kind!=='required')continue;
    for(const [start,end] of block.parts)slots.push({date:day.date,start,end,subject:block.subject,kind:block.kind});

  }
  const targets=planTargets(sun);
  for(const subject of ['FAR','国徴']){
    const allocated=slots.filter(s=>s.subject===subject).reduce((n,s)=>n+s.end-s.start,0);
    if(subject==='国徴'&&sun>=accountingStart)continue;
    const deficit=Math.max(0,targets[subject]+(carry[subject]||0)-allocated);
    if(deficit)lost.push({subject,minutes:deficit});
  }
  const lostMinutes=lost.reduce((total,block)=>total+block.minutes,0);
  function recover(date, parts, kind, limit=Infinity) {
    let used=0;
    const excluded=Object.values(state.agendaEdits||{}).filter(e=>e.recovery?.date===date).map(e=>[mins(e.recovery.start),mins(e.recovery.end)]);
    for(const [start,end] of parts.flatMap(([a,b])=>gaps(excluded,a,b))){
      let cursor=start;
      while(cursor<end&&used<limit){
        const need=lost.find(block=>block.minutes>0 && (block.subject!=='国徴'||date<accountingStart) && date<(block.subject==='FAR'?state.settings.farExam:taxEnd()));
        if(!need)break;
        const minutes=Math.min(end-cursor,need.minutes,limit-used);
        slots.push({date,start:cursor,end:cursor+minutes,subject:need.subject,kind});
        cursor+=minutes;
        need.minutes-=minutes;
        used+=minutes;
      }
    }
    return used;
  }
  let availableUsed=0, bufferUsed=0;
  for(const day of cap.slice(0,6))availableUsed+=recover(day.date,availableTimeParts(day.date),'available');
  for(const day of cap.slice(0,6))for(const block of day.slots){
    if(block.kind==='buffer')bufferUsed+=recover(day.date,block.parts,'buffer',180-bufferUsed);
  }
  const occupied=slots.filter(slot=>slot.date===sun&&slot.kind==='available').map(slot=>[slot.start,slot.end]);
  const remainingSun=sunParts.flatMap(([start,end])=>freeParts(sun,start,end,occupied));
  let sundayBookkeeping=null, recoveryParts=remainingSun;
  const id=sun+'/bookkeeping';
  if(sun>=accountingStart && !state.agendaEdits?.[id] && lost.some(b=>b.minutes>0&&sun<(b.subject==='FAR'?state.settings.farExam:taxEnd()))){
    const total=remainingSun.reduce((n,[a,b])=>n+b-a,0);
    const fit=remainingSun.find(([a,b])=>b-a>=20);
    if(total>20&&fit){
      const start=fit[0],end=start+20;
      sundayBookkeeping={id,date:sun,origin:sun,start:hh(start),end:hh(end),name:'スタディング｜簿記論の個別問題 2問',category:'簿記論',fixed:true};
      recoveryParts=remainingSun.flatMap(([a,b])=>gaps([[start,end]],a,b));
    }
  }
  const recovered=recover(sun,recoveryParts,'emergency');
  if(!recovered)sundayBookkeeping=null;
  const sunUsed=recovered+(sundayBookkeeping?20:0);
  const uncovered=lostMinutes-availableUsed-bufferUsed-recovered;
  return {sundayBookkeeping,remaining:Object.fromEntries(lost.map(b=>[b.subject,b.minutes])),slots,lost:lostMinutes,availableUsed,bufferUsed,sunUsed,uncovered};
}
function weekIntervals(date) {
  return weekly(date).slots.sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start);
}
const reviewCycle=[[1,15],[3,20],[7,25],[14,30]];
const farPhases=[
  ['2027-01-01','講義の未消化分を終え、論点別MCQを解き直す'],
  ['2027-02-01','全範囲のMCQを一巡し、誤答を再テスト'],
  ['2027-03-01','主要TBSを解き、後半は弱点を再演習'],
  ['2027-04-01','模試・総合演習と誤答の最終確認']
];
function mockDays(){
  const exam=state.settings.farExam;
  const saturdayBefore=d=>shift(d,-((dow(d)+1)%7));
  return [14,7].map(days=>saturdayBefore(shift(exam,-days)));
}
function roadmap(){
  const dates=mockDays();
  return `<details class="card"><summary>1月からFAR受験までの計画</summary>
    ${farPhases.map(([d,title])=>`<p><button class="secondary" onclick="selected='${d}';go('week')">${Number(d.slice(5,7))}月の予定</button>　${title}</p>`).join('')}
    <p>模試予定：${dates.join('・')}（各240分、学習枠に分割）。</p>
    <p>復習は初回の学習記録日（未記録は予定日）から1・3・7・14日後。各15・20・25・30分を同じ科目の枠で確保し、空きが足りない分は次の枠へ送ります。</p></details>`;
}
function planSlots(date) {
  const endWeek=weekStart(date),out=[];
  if(endWeek<weekStart(PLAN_START))return out;
  const entries=subject=>orderedPlanTasks(subject).map(task=>({task,left:Math.max(0,Number(task.minutes)||0)})).filter(e=>e.left);
  const queues={FAR:entries('FAR'),国徴:entries('国徴')};
  const reviews={FAR:[],国徴:[]},seen=new Set(),firstLog=new Map();
  for(const log of state.logs){
    if(log.date>=PLAN_START && (!firstLog.has(log.taskId)||log.date<firstLog.get(log.taskId)))firstLog.set(log.taskId,log.date);
  }
  function enroll(task,day){
    if(seen.has(task.id))return;
    seen.add(task.id);
    const base=firstLog.get(task.id)||day;
    const cycle=task.subject==='国徴'&&task.kind==='problem'?[[1,5],[3,10],[7,10],[14,15]]:reviewCycle;
    for(const [gap,left] of cycle)reviews[task.subject].push({task,left,due:shift(base,gap),label:gap+'日後復習'});
    reviews[task.subject].sort((a,b)=>a.due.localeCompare(b.due));
  }
  for(const t of state.tasks)if(firstLog.has(t.id)&&reviews[t.subject])enroll(t,firstLog.get(t.id));
  const drills=state.tasks.filter(t=>t.subject==='FAR'&&['mcq','tbs'].includes(t.kind));
  const mock=mockDays().map((due,i)=>({due,left:240,label:'模試'+(i+1)+'｜時間を計って総合演習'}));
  const papers=taxPapers();
  const rotations=new Map();
  function drill(day,subject){
    let kind='mcq',label='章別MCQ・誤答の解き直し';
    if(day>='2027-02-01'){label='全範囲MCQ・初見と誤答の再テスト';}
    if(day>='2027-03-01'){kind='tbs';label='主要TBS・解答手順の再現';}
    if(day>='2027-03-15'){kind=(dow(day)%2?'mcq':'tbs');label='弱点再演習';}
    if(day>='2027-04-01'){kind=(dow(day)%2?'mcq':'tbs');label='総合演習・誤答の最終確認';}
    let pool=subject==='FAR'?drills.filter(t=>t.kind===kind):state.tasks.filter(t=>t.subject===subject&&t.kind==='theory');
    if(subject==='FAR' && day>='2027-03-15'){
      const scores=new Map();
      for(const log of state.logs)if(log.date<day && log.accuracy!=null){
        const old=scores.get(log.taskId);
        if(!old||log.date>=old.date)scores.set(log.taskId,log);
      }
      const weak=pool.filter(t=>scores.has(t.id)&&Number(scores.get(t.id).accuracy)<80);
      if(weak.length)pool=weak;
    }
    if(subject==='国徴'){
      const kind=dow(day)%2?'problem':'theory';
      pool=state.tasks.filter(t=>t.subject===subject&&t.kind===kind);
      const weak=pool.filter(t=>state.logs.some(l=>l.taskId===t.id&&l.date<day&&l.accuracy!=null&&l.accuracy<80));
      if(weak.length)pool=weak;
      label=kind==='theory'?'理論を白紙から再現':'テーマ問題・誤答再演習';
    }
    const key=subject+label+kind,index=rotations.get(key)||0;
    rotations.set(key,index+1);
    return {task:pool[index%pool.length],label,left:60};
  }
  for(let week=weekStart(PLAN_START);week<=endWeek;week=shift(week,7)){
    const intervals=weekIntervals(week);
    for(const slot of intervals){
      if(slot.subject==='FAR'&&slot.date>=state.settings.farExam||slot.subject==='国徴'&&slot.date>=taxEnd())continue;
      const queue=queues[slot.subject],due=reviews[slot.subject];
      let cursor=slot.start;
      while(cursor<slot.end){
        const simulation=(slot.subject==='FAR'?mock:papers).find(m=>m.due<=slot.date&&m.left);
        const review=due[0]?.due<=slot.date?due[0]:null;
        // Keep the opening lecture on Monday morning; its review can use the evening block.
        const defer=slot.date==='2026-11-23'&&slot.start<720&&slot.subject==='FAR';
        const entry=simulation||(!defer&&review)||queue[0]||drill(slot.date,slot.subject);
        const task=entry.task;
        const minutes=Math.min(entry.left,slot.end-cursor);
        const title=entry.label?(task?entry.label+'｜'+task.name:entry.label):task.name;
        if(week===endWeek)out.push({...slot,start:hh(cursor),end:hh(cursor+minutes),title,id:task?.id||(simulation?'mock-'+simulation.due:null),repeat:!!entry.label,due:entry.due});
        entry.left-=minutes;cursor+=minutes;
        if(entry===queue[0]){
          enroll(task,slot.date);
          if(!entry.left)queue.shift();
        }else if(entry===review&&!entry.left)due.shift();
      }
    }
  }
  return out;
}
function refreshApp(){
  const url=new URL(location.href);
  url.searchParams.set('update',Date.now());
  location.replace(url.href);
}

function manualTasks(slots){
  const planned=slots.filter(s=>s.id).map(s=>({id:s.id,value:'slot-'+s.start,name:s.start+' '+s.title,title:s.title,planStart:s.start,subject:s.subject}));
  return planned.concat(state.tasks.filter(t=>selected<accountingStart||t.subject!=='国徴'),selected>=accountingStart?[{id:'studying-boki',subject:'簿記論',name:'スタディング｜簿記論 個別問題'},{id:'studying-zai',subject:'財務諸表論',name:'スタディング｜財務諸表論 理論暗記ツール'}]:[]);
}

function taxOnlyDay(date){return date>state.settings.farExam;}
function taxEnd(){return state.settings.taxExam||'2027-09-01';}
function taxMinutes(date,type){
  if(date>=taxEnd()||type==='off'||type==='sunday')return 0;
  const phase=date<'2027-06-07'?0:date<'2027-07-05'?1:2;
  const minutes={office:[30,90,120],remote:[75,135,180],saturday:[240,420,480],holiday:[240,420,480]};
  return minutes[type]?.[phase]||0;
}
function taxBlocks(date,type){
  let budget=taxMinutes(date,type);
  if(!budget)return [];
  const times=type==='office'?[['06:00',60],['20:00',60]]:type==='remote'?[['06:30',120],['19:45',90]]:[['07:30',120],['09:45',120],['12:45',120],['15:00',120]];
  const blocks=[];
  for(const [start,limit] of times){
    if(!budget)break;
    const n=Math.min(limit,budget);blocks.push([start,hh(mins(start)+n),'国徴','required']);budget-=n;
  }
  if(type==='remote')blocks.push(['21:45','22:15','予備','buffer']);
  if(type==='saturday'||type==='holiday')blocks.push(['18:30','20:30','予備','buffer']);
  return blocks;
}
function taxMaterials(tasks){
  const theory=tasks.filter(t=>t.kind==='theory'),problems=tasks.filter(t=>t.kind==='problem');
  const order=theory.slice(0,25);
  for(let i=0;i<Math.max(theory.length-25,problems.length);i++){
    if(theory[i+25])order.push(theory[i+25]);
    if(problems[i])order.push(problems[i]);
  }
  return order.concat(tasks.filter(t=>!['theory','problem','past'].includes(t.kind)));
}
function taxPapers(){
  const end=state.settings.taxExam||'2027-08-01';
  const last=shift(end,-1);
  const saturday=shift(last,-((dow(last)+1)%7));
  const papers=state.tasks.filter(t=>t.subject==='国徴'&&t.kind==='past');
  return papers.flatMap((task,i)=>{
    const due=shift(saturday,-7*(papers.length-1-i));
    return [{task,due,left:Number(task.minutes)||120,label:'過去問・時間を計って答案作成'},
      {task,due,left:60,label:'採点・不足した根拠と語句を書き直す'}];
  });
}
function taxRoadmap(){
  return `<details class="card"><summary>国税徴収法｜8月までの独学計画</summary>
    <p>試験日：${state.settings.taxExam==='2027-08-05'?'2027年8月5日（仮）':esc(state.settings.taxExam||'2027年8月・日付未定')}。理論テキスト・テーマ問題・過去問を使います。</p>
    ${[[shift(state.settings.farExam,1),'FAR後〜6/6：週8時間'],['2027-06-07','6/7〜7/4：週16時間'],['2027-07-05','7/5以降：週20時間']].map(([date,label])=>`<p><button class="secondary" onclick="selected='${date}';go('week')">${label}</button></p>`).join('')}
    <p>理論は見出しと要件を白紙から再現し、テーマ問題で事例に適用。過去問は直近に登録した5年分を週1回、答案作成と採点に分けます。</p>
    <p>日程未定の間は7月末に過去問を終え、8月は復習を継続します。「設定」で試験日を入力すると過去問の日程と最終学習日が変わります。</p></details>`;
}
function weekly(date){
  const end=weekStart(date);
  if(weekCache.has(end))return weekCache.get(end);
  let carry={FAR:0,国徴:0};
  for(let w=end<weekStart(PLAN_START)?end:weekStart(PLAN_START);w<=end;w=shift(w,7)){
    if(!weekCache.has(w))weekCache.set(w,computeWeek(w,carry));
    carry=weekCache.get(w).remaining;
  }
  return weekCache.get(end);
}
