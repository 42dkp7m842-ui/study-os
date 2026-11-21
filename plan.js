const PLAN_START='2026-11-22';
const FIRST_DAY=[['08:00','09:15','FAR','required'],['09:30','10:05','国徴','required']];
function migratePlan(data) {
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
  if(weekStart(date)<weekStart(PLAN_START))return {FAR:0,国徴:0};
  if(weekStart(date)===weekStart(PLAN_START))return {FAR:75,国徴:35};
  return weeklyTargets;
}
function orderedPlanTasks(subject) {
  // Completed items retain their place on the timeline so marking a task
  // complete cannot shift a later lesson into a previously scheduled slot.
  const tasks=state.tasks.filter(t=>t.subject===subject && !/^lecture-0-[1-6]$/.test(t.id));
  if(subject!=='FAR')return tasks;
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
function weekIntervals(date) {
  const w=weekly(date),slots=[],lost=[];
  for(const day of w.cap)for(const b of day.slots){
    if(b.kind!=='required')continue;
    for(const [start,end] of b.parts)slots.push({date:day.date,start,end,subject:b.subject,kind:b.kind});
    if(b.minutes>b.free)lost.push({subject:b.subject,minutes:b.minutes-b.free});
  }
  function recover(day,parts,kind) {
    for(const [start,end] of parts){
      let cursor=start;
      while(cursor<end && lost.length){
        const need=lost[0],minutes=Math.min(end-cursor,need.minutes);
        slots.push({date:day,start:cursor,end:cursor+minutes,subject:need.subject,kind});
        cursor+=minutes;need.minutes-=minutes;
        if(!need.minutes)lost.shift();
      }
    }
  }
  for(const day of w.cap)for(const b of day.slots)if(b.kind==='buffer')recover(day.date,b.parts,'buffer');
  recover(w.sun,w.sunParts,'emergency');
  return slots.sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start);
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
    <p>模試予定：${dates.join('・')}（各240分、学習枠に分割）。国徴は週2時間で理論の再現と反復。</p>
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
    for(const [gap,left] of reviewCycle)reviews[task.subject].push({task,left,due:shift(base,gap),label:gap+'日後復習'});
    reviews[task.subject].sort((a,b)=>a.due.localeCompare(b.due));
  }
  for(const t of state.tasks)if(firstLog.has(t.id)&&reviews[t.subject])enroll(t,firstLog.get(t.id));
  const drills=state.tasks.filter(t=>t.subject==='FAR'&&['mcq','tbs'].includes(t.kind));
  const mock=mockDays().map((due,i)=>({due,left:240,label:'模試'+(i+1)+'｜時間を計って総合演習'}));
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
    if(subject==='国徴')label='理論を白紙から再現';
    const key=subject+label+kind,index=rotations.get(key)||0;
    rotations.set(key,index+1);
    return {task:pool[index%pool.length],label,left:60};
  }
  for(let week=weekStart(PLAN_START);week<=endWeek;week=shift(week,7)){
    const intervals=weekIntervals(week);
    for(const slot of intervals){
      if(slot.subject==='FAR'&&slot.date>=state.settings.farExam)continue;
      const queue=queues[slot.subject],due=reviews[slot.subject];
      let cursor=slot.start;
      while(cursor<slot.end){
        const simulation=slot.subject==='FAR'&&mock.find(m=>m.due<=slot.date&&m.left);
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
  return planned.concat(state.tasks);
}
