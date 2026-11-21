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
    appendPractice('mcq',30);
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
function planSlots(date) {
  const endWeek=weekStart(date),out=[];
  if(endWeek<weekStart(PLAN_START))return out;
  const entries=subject=>orderedPlanTasks(subject).map(task=>({task,left:Math.max(0,Number(task.minutes)||0)}));
  const queues={FAR:entries('FAR'),国徴:entries('国徴')};
  for(let week=weekStart(PLAN_START);week<=endWeek;week=shift(week,7)){
    if(!queues.FAR.length && !queues.国徴.length)week=endWeek;
    for(const slot of weekIntervals(week)){
      const queue=queues[slot.subject];
      let cursor=slot.start;
      while(cursor<slot.end){
        const entry=queue[0],task=entry?.task;
        const minutes=task?Math.min(entry.left,slot.end-cursor):slot.end-cursor;
        if(minutes>0 && week===endWeek)out.push({...slot,start:hh(cursor),end:hh(cursor+minutes),title:task?.name||'教材を追加してください',id:task?.id||null});
        if(task){entry.left-=minutes;if(entry.left<=0)queue.shift();}
        cursor+=Math.max(0,minutes);
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
