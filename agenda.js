// A template occurrence keeps its source identity even after a move.
const accountingStart='2026-11-28';
const categories=['筋トレ','有酸素運動','FAR','簿記論','財務諸表論','学習予備','仕事','睡眠','デート','外出','食事','入浴','休憩','その他'];
const exerciseCategory=d=>['','有酸素運動','筋トレ','有酸素運動','','筋トレ','筋トレ'][dow(d)];
const studyCategory=c=>['FAR','国徴','学習予備'].includes(c);
const exercise=c=>c==='筋トレ'||c==='有酸素運動';
function baseDay(date){
  const type=typeOf(date),office=type==='office',sport=exerciseCategory(date);
  const list=[];
  function add(key,start,end,category,name=category){list.push({id:date+'/'+key,date,origin:date,start,end,name,category,fixed:true});}
  if(sport)add('sport',office?'21:00':'20:00',office?'22:30':'21:30',sport);
  add('bath',office&&sport?'22:30':'22:00',office&&sport?'23:00':'22:30','入浴','お風呂');
  add('wake','00:00','06:00','睡眠'); add('bed','23:00','24:00','睡眠');
  if(office||type==='remote')add('work','09:00','18:00','仕事');
  if(date>=accountingStart&&dow(date)!==0){
    const start=type==='remote'?'08:30':'07:00';
    add('bookkeeping',start,hh(mins(start)+20),'簿記論','スタディング｜簿記論の個別問題 2問');
  }
  const counts={};
  for(const [start,end,subject,kind] of templateBlocks(date)){
    const group=subject+kind;
    counts[group]=(counts[group]||0)+1;
    const key='study-'+group+counts[group];
    const legacy=[start,end,subject,kind].join('|');
    if(!(state.blockMoves||[]).some(m=>m.origin===date&&m.key===legacy))add(key,start,end,kind==='buffer'?'学習予備':subject);
  }
  return list;
}
function storedDayItems(date){
  const edits=state.agendaEdits||{};
  const events=state.events.filter(e=>e.date===date).map(e=>({...e,id:'event/'+e.id,category:e.category||'その他',fixed:true,manual:true}));
  const moves=(state.blockMoves||[]).filter(m=>m.date===date).map(m=>({...m,id:m.origin+'/legacy/'+m.key,name:m.subject,category:m.kind==='buffer'?'学習予備':m.subject,fixed:true,legacy:true}));
  const missed=(state.missedTimes||[]).filter(r=>r.date===date).map(r=>({
    id:'missed/'+date+'/'+r.start,date,origin:date,start:r.start,end:r.end,
    category:'振替元',name:r.name||r.reason||'未実行時間',fixed:true,missed:true
  }));
  return [...baseDay(date),...events,...moves,...missed].filter(e=>!edits[e.id]).concat(Object.values(edits).filter(e=>!e.deleted&&e.date===date)).filter(e=>date<accountingStart||e.category!=='国徴').sort((a,b)=>a.start.localeCompare(b.start));
}
function dayItems(date){
  const items=storedDayItems(date);
  if(date<accountingStart||dow(date)!==0)return items;
  const booking=weekly(date).sundayBookkeeping;
  if(booking)items.push(booking);
  return items.sort((a,b)=>a.start.localeCompare(b.start));
}
function studyBlocks(date){
  return storedDayItems(date).filter(e=>studyCategory(e.category)).map(e=>[e.start,e.end,e.category==='学習予備'?'予備':e.category,e.category==='学習予備'?'buffer':'required']);
}
function usableStudyParts(date,start,end,subject,kind){
  const entries=storedDayItems(date).filter(e=>studyCategory(e.category));
  const chosen=entries.find(e=>e.start===start&&e.end===end&&(kind==='buffer'?e.category==='学習予備':e.category===subject));
  const priority=e=>(e.custom||e.legacy?0:2)+(e.category==='学習予備'?1:0);
  const earlier=entries.filter(e=>chosen&&e.id!==chosen.id&&(priority(e)<priority(chosen)||priority(e)===priority(chosen)&&e.id<chosen.id));
  return freeParts(date,mins(start),mins(end),earlier.map(e=>[mins(e.start),mins(e.end)]));
}
function fixedParts(date){
  return storedDayItems(date).filter(e=>!studyCategory(e.category)).map(e=>[mins(e.start),mins(e.end)]);
}
function gaps(items,start=0,end=1440){
  let cursor=start;const out=[];
  for(const [a,b] of items.slice().sort((x,y)=>x[0]-y[0])){
    if(b<=cursor||a>=end)continue;
    if(a>cursor)out.push([cursor,a]);
    cursor=Math.max(cursor,b);
  }
  if(cursor<end)out.push([cursor,end]);
  return out;
}
function freeDay(date,except){
  return gaps(dayItems(date).filter(e=>e.id!==except).map(e=>[mins(e.start),mins(e.end)]));
}
function releasedTimes(date){
  return baseDay(date).filter(e=>exercise(e.category)&&state.agendaEdits?.[e.id]).map(({start,end})=>({start,end}));
}
function combinedRanges(ranges){
  const merged=[];
  for(const {start,end} of ranges.slice().sort((a,b)=>a.start.localeCompare(b.start))){
    const last=merged.at(-1);
    if(last&&last.end>=start){if(end>last.end)last.end=end;}else merged.push({start,end});
  }
  return merged;
}
function agendaWrite(fn){
  const before=JSON.stringify(state.agendaEdits||{});
  state.agendaEdits??={};fn();
  const old=state.agendaUndo;
  state.agendaUndo=before;
  if(!save()){state.agendaEdits=JSON.parse(before);state.agendaUndo=old;syncStudyLogs();return false;}
  return true;
}
function agendaUndo(){
  if(state.agendaUndo==null)return;
  const previous=state.agendaUndo,edits=state.agendaEdits;
  state.agendaEdits=JSON.parse(previous);delete state.agendaUndo;
  if(!save()){state.agendaEdits=edits;state.agendaUndo=previous;}
  render();
}
function standard(date){
  if(!confirm(date+' の個別編集・手動追加・実施情報を解除します。この日に関係する振替も元に戻しますか？'))return;
  agendaWrite(()=>{for(const [id,e] of Object.entries(state.agendaEdits))if(e.date===date||e.origin===date)delete state.agendaEdits[id];});render();
}
function conflictsFor(item){
  return dayItems(item.date).filter(other=>other.id!==item.id&&other.start<item.end&&other.end>item.start&&
    (!studyCategory(other.category)||studyCategory(item.category)||other.custom||other.legacy));
}
function restoreItem(id){
  const old=state.agendaEdits?.[id];
  if(!old)return false;
  const manual=id.startsWith('manual/');
  const original=manual?(old.deleted?{...old,deleted:false}:old.initial):null;
  // Preview the standard occurrence against current commitments before saving.
  const originalEdits=state.agendaEdits;
  state.agendaEdits={...originalEdits};
  delete state.agendaEdits[id];
  let target,conflicts;
  try{
    target=original||dayItems(old.origin).find(e=>e.id===id);
    conflicts=target?conflictsFor(target):[];
  }finally{state.agendaEdits=originalEdits;}
  if(conflicts.length){
    alert('復元先で重複：'+conflicts.map(e=>e.start+'〜'+e.end+' '+e.name).join('、')+'。先に重なる予定を編集してください。');return false;
  }
  if(manual&&!original)return false;
  const ok=agendaWrite(()=>{
    if(manual)state.agendaEdits[id]={...original,initial:old.initial,custom:true};
    else delete state.agendaEdits[id];
  });
  if(ok)render();
  return ok;
}
function dayEditor(date){
  const items=dayItems(date),exceptions=Object.values(state.agendaEdits||{}).filter(e=>e.origin===date&&(e.deleted||e.date!==date));
  const parts=freeDay(date);
  const sleep=dayItems(shift(date,1)).filter(e=>e.category==='睡眠'&&e.start==='00:00').reduce((a,e)=>Math.max(a,mins(e.end)),0)+items.filter(e=>e.category==='睡眠'&&e.end==='24:00').reduce((a,e)=>Math.max(a,1440-mins(e.start)),0);
  const warnings=[];
  for(const [i,e] of items.entries())for(const other of items.slice(i+1)){
    if(e.end>other.start&&e.start<other.end&&(!studyCategory(e.category)||e.custom)&&(!studyCategory(other.category)||other.custom))warnings.push(esc(e.name)+'・'+esc(other.name)+' '+other.start+'〜'+(other.end<e.end?other.end:e.end));
  }
  const rows=items.map((e,i)=>'<button type="button" class="agenda-row secondary" data-category="'+esc(e.category)+'" onclick="editItem(\''+date+'\','+i+')"><b>'+esc(e.start)+'–'+esc(e.end)+'</b> '+esc(e.name)+'<small>'+esc(e.category)+' · '+(e.deleted?'解除':e.fixed?'固定':'固定解除')+' · ' +esc(e.status||'予定')+'</small></button>').join('');
  return '<section class="card"><details><summary>'+date+'（'+names[dow(date)]+'）の予定編集・空き時間</summary>'+rows+'<p class="fine">空き '+parts.map(([a,b])=>hh(a)+'–'+hh(b)).join('、')+'</p><p>翌朝までの睡眠 '+fmt(sleep)+'</p>'+(sleep<420?'<p class="notice">7時間に不足します。就寝を'+fmt(420-sleep)+'早めるか、翌朝の起床を遅らせ、重なる運動・入浴の時間を編集してください。</p>':'')+warnings.map(w=>'<p class="notice">重複 '+w+'。予定をタップして調整してください。</p>').join('')+'<div class="actions"><button onclick="editItem(\''+date+'\')">予定を追加</button><button class="secondary" onclick="standard(\''+date+'\')">標準に戻す</button>'+(state.agendaUndo!=null?'<button class="secondary" onclick="agendaUndo()">直前の編集を取消</button>':'')+'</div>'+exceptions.map((e,i)=>'<p>'+esc(e.name)+' · '+(e.deleted?'今回解除':'振替先 '+e.date)+' <button onclick="restoreException(\''+date+'\','+i+')">復元</button></p>') .join('')+'</details></section>';
}
function restoreException(date,i){
  const e=Object.values(state.agendaEdits||{}).filter(e=>e.origin===date&&(e.deleted||e.date!==date))[i];if(!e)return;
  restoreItem(e.id);
}
function editItem(date,i,generated){
  const e=generated||(i==null?{id:'manual/'+uid(),origin:date,date,name:'',category:'その他',start:'18:00',end:'19:00',fixed:true,manual:true}:dayItems(date)[i]);
  if(!e)return;
  if(e.missed){
    const record=state.missedTimes.find(r=>r.date===date&&r.start===e.start);
    const name=prompt('この時間に入っていた予定名',e.name);
    if(name!==null)mutate(()=>{record.name=name.trim()||record.reason||'未実行時間';});
    return;
  }
  const dialog=document.createElement('dialog');
  dialog.className='agenda-dialog';
  const form=document.createElement('form');dialog.append(form);
  form.innerHTML='<h3>予定の編集</h3><label>日付<input name="date" required type="date"></label><label>カテゴリー<select name="category">'+categories.map(c=>'<option>'+c+'</option>').join('')+'</select></label><label>予定名<input name="name" maxlength="240"></label><div class="grid"><label>開始<input name="start" required type="time"></label><label>終了（24:00可）<input name="end" required pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00"></label></div><label>所要時間（分）<input name="duration" type="number" min="1" max="1440"></label><label>メモ<textarea name="memo"></textarea></label><label><input type="checkbox" name="fixed"> 固定</label><label>実施状況<select name="status"><option>予定</option><option>実施済</option><option>未実施</option></select></label><label>実際の時間（分）<input name="actual" type="number" min="0" max="1440"></label><label>未実施の理由<input name="reason"></label><p class="fine" id="agendaFree"></p><p role="alert" id="agendaWarning"></p><div class="actions"><button>保存</button><button type="button" class="secondary" data-action="close">閉じる</button></div>';
  const f=form.elements;
  for(const k of ['date','name','start','end','category','status','actual','reason','memo'])f[k].value=e[k]??(k==='status'?'予定':'');
  if(e.status==='一部実施'){
    f.status.add(new Option('一部実施','一部実施'));f.status.value='一部実施';
  }
  f.fixed.checked=e.fixed;f.duration.value=mins(e.end)-mins(e.start);
  function hints(){if(f.date.value)$('agendaFree').textContent='移動先の空き時間 '+freeDay(f.date.value,e.id).map(([a,b])=>hh(a)+'〜'+hh(b)).join('、');}
  function length(){if(f.start.value&&f.end.validity.valid)f.duration.value=mins(f.end.value)-mins(f.start.value);}
  f.date.onchange=hints;f.start.onchange=length;f.end.onchange=length;
  f.duration.onchange=()=>{const end=mins(f.start.value)+Number(f.duration.value);if(end<=1440)f.end.value=hh(end);};
  function finish(){dialog.close();dialog.remove();render();}
  form.querySelector('[data-action="close"]').onclick=finish;
  function action(label,fn){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;b.onclick=fn;form.append(b);}
  if(i!=null||generated){
    action('今回のみ削除',()=>{if(agendaWrite(()=>state.agendaEdits[e.id]={...e,deleted:true}))finish();});
    if(state.agendaEdits?.[e.id]&&!e.id.startsWith('manual/'))action('標準予定に復元',()=>{if(restoreItem(e.id))finish();});
  }
  form.onsubmit=ev=>{
    ev.preventDefault();
    const data={...e,date:f.date.value,start:f.start.value,end:f.end.value,category:f.category.value,name:f.name.value.trim()||f.category.value,memo:f.memo.value,status:f.status.value,reason:f.reason.value,fixed:f.fixed.checked};
    if(i==null&&!generated)data.origin=data.date;
    const n=mins(data.end)-mins(data.start);
    if(n<=0||n!==Number(f.duration.value)){ $('agendaWarning').textContent='開始・終了・所要時間を確認してください。';return;}
    data.actual=f.actual.value===''?null:Number(f.actual.value);
    if(exercise(data.category)&&data.status==='実施済'&&data.actual==null){$('agendaWarning').textContent='移動・着替えを除く実際の運動時間を入力してください。';return;}
    const changed=i==null||['start','end','date','category'].some(k=>data[k]!==e[k]);
    const conflicts=conflictsFor(data);
    if(changed&&conflicts.length){$('agendaWarning').textContent='重複 '+conflicts.map(x=>x.start+'〜'+x.end+' '+x.name).join('、');return;}
    if(data.id.startsWith('manual/')&&!data.initial)data.initial={...data};
    if(agendaWrite(()=>state.agendaEdits[e.id]={...data,custom:true}))finish();
  };
  dialog.oncancel=()=>dialog.remove();document.body.append(dialog);dialog.showModal();hints();
}
function exerciseStats(dates){
  const rows=dates.flatMap(dayItems).filter(e=>exercise(e.category));
  const changes=Object.values(state.agendaEdits||{}).filter(e=>exercise(e.category));
  return {planned:rows.length,done:rows.filter(e=>e.status==='実施済').length,minutes:rows.reduce((n,e)=>n+(e.status==='実施済'?Number(e.actual)||0:0),0),types:Object.fromEntries(['筋トレ','有酸素運動'].map(c=>[c,rows.filter(e=>e.category===c&&e.status==='実施済').length])),cancelled:changes.filter(e=>e.deleted&&dates.includes(e.origin)).length,moved:changes.filter(e=>!e.deleted&&e.origin!==e.date&&dates.includes(e.date)).length,added:rows.filter(e=>e.id.startsWith('manual/')).length,missed:rows.filter(e=>e.status==='未実施').map(e=>({date:e.date,name:e.name,reason:e.reason}))};
}
function exerciseReview(date){
  const month=[];for(let d=date.slice(0,7)+'-01';d.startsWith(date.slice(0,7));d=shift(d,1))month.push(d);
  return [weekDays(date),month].map((dates,i)=>{
    const s=exerciseStats(dates);
    return '<div class="card"><h3>'+(i?'月間':'週間')+'運動実績</h3>'+['筋トレ','有酸素運動'].map(c=>{
      const goal=dates.filter(d=>exerciseCategory(d)===c).length;
      return '<p>'+c+' '+s.types[c]+' / '+goal+'回 · 目標達成率 '+Math.round(s.types[c]*100/goal)+'%</p>';
    }).join('')+'<p>変更後の予定 '+s.done+' / '+s.planned+'回（'+(s.planned?Math.round(s.done*100/s.planned)+'%':'予定なし')+'） · 運動 '+s.minutes+'分</p><small>解除 '+s.cancelled+'回 · 振替 '+s.moved+'回 · 追加 '+s.added+'回 · 未実施 '+s.missed.length+'回</small></div>';
  }).join('');
}
function lessonStatusKey(date,slot){
  return JSON.stringify([date,slot.start,slot.subject,slot.id,slot.title]);
}
function studyProgress(date,row,taskId,choice){
  const planned=mins(row.end)-mins(row.start);
  const actual=state.logs.filter(l=>!l.autoKey&&l.date===date&&l.planStart===row.start&&l.taskId===taskId)
    .reduce((sum,l)=>sum+Number(l.minutes),0);
  const status=choice==='実施済'?'実施済':actual>=planned?'実施済':actual>0?'一部実施':choice==='一部実施'?'予定':choice||'予定';
  return {planned,actual,status};
}
function timetableEntry(date,row,item){
  const lesson=row.subject!==undefined;
  const separate=lesson||item?.missed;
  const key=lesson?lessonStatusKey(date,row):item.id;
  const choice=separate?state.scheduleStatus?.[key]:item.status;
  const study=lesson||accountingSubjects.includes(row.category);
  const taskId=lesson?row.id:row.category==='簿記論'?'studying-boki':'studying-zai';
  const progress=study?studyProgress(date,row,taskId,choice):null;
  const status=progress?.status||choice||'予定';
  const marks=study?{'予定':'○','一部実施':'◐','実施済':'✓','未実施':'−'}:{'予定':'○','実施済':'✓','未実施':'−'};
  const detail=progress?.actual?` · 実績 ${progress.actual}分 / 予定 ${progress.planned}分${status==='一部実施'?' · 残り '+(progress.planned-progress.actual)+'分':''}`:'';
  const options=Object.entries(marks).map(([value,mark])=>
    `<option value="${value}" ${status===value?'selected':''}>${mark} ${value}</option>`
  ).join('');
  const edit=row.index>=0
    ? `editItem('${date}',${row.index})`
    : `editRecovery('${date}','${row.start}','${row.end}','${row.subject}')`;
  return `<div class="timetable-entry" data-status="${esc(status)}">
    <button class="agenda-row secondary" data-category="${esc(row.category)}" onclick="${edit}">
      <b class="entry-time">${row.start}–${row.end}</b>
      <span class="entry-title">${esc(row.name)}</span>
      <small>${esc(row.category)} · ${esc(row.label)}${detail}</small>
    </button>
    <select class="quick-status" aria-label="${esc(row.name)}の実施状況" data-date="${date}" data-item="${separate?'':esc(item.id)}" data-key="${esc(key)}" data-start="${row.start}" data-end="${row.end}" data-task="${esc(taskId)}" data-subject="${esc(row.category)}" data-title="${esc(row.name)}" onchange="saveTimetableStatus(this)">${options}</select>
  </div>`;
}
function saveTimetableStatus(field){
  const {date,item,key}=field.dataset;
  const value=field.value;
  if(!['予定','一部実施','実施済','未実施'].includes(value))return;
  const priorLogs=state.logs.slice();
  if(value==='一部実施'){
    const {start,end,task,subject,title}=field.dataset;
    const progress=studyProgress(date,{start,end},task);
    if(!progress.actual){
      const input=prompt('実際に勉強した時間（分）を入力してください。');
      const minutes=Number(input);
      if(input===null||!Number.isInteger(minutes)||minutes<=0||minutes>=progress.planned){
        if(input!==null)alert('1分以上、予定時間未満で入力してください。');
        render();return;
      }
      state.logs.push({id:uid(),date,taskId:task,planStart:start,subject,title,minutes,accuracy:null,reason:'',created:Date.now()});
    }
  }
  if(item){
    const entry=dayItems(date).find(e=>e.id===item);
    if(!entry)return;
    if(!agendaWrite(()=>{state.agendaEdits[item]={...entry,status:value};}))state.logs=priorLogs;
  }else{
    state.scheduleStatus??={};
    const previous=state.scheduleStatus[key];
    if(value==='実施済'&&key.startsWith('[')){
      const slot=planSlots(date).find(s=>s.date===date&&lessonStatusKey(date,s)===key);
      if(slot){state.lessonRecords??={};state.lessonRecords[key]=lessonRecord(date,slot);}
    }
    state.scheduleStatus[key]=value;
    if(!save()){
      state.logs=priorLogs;
      if(previous===undefined)delete state.scheduleStatus[key];else state.scheduleStatus[key]=previous;
      syncStudyLogs();
    }
  }
  const open=[...document.querySelectorAll('#app details')].map(d=>d.open);
  const y=window.scrollY;
  render();
  document.querySelectorAll('#app details').forEach((d,i)=>{if(i<open.length)d.open=open[i];});
  window.scrollTo(0,y);
}
function timetable(date,slots){
  const items=dayItems(date);
  const rows=items.flatMap((e,i)=>{
    if(studyCategory(e.category)&&e.category!=='学習予備')return [];
    const parts=e.category==='学習予備'?gaps([...fixedParts(date),...slots.filter(s=>s.date===date).map(s=>[mins(s.start),mins(s.end)])],mins(e.start),mins(e.end)):[[mins(e.start),mins(e.end)]];
    return parts.map(([a,b])=>({start:hh(a),end:hh(b),name:e.name,category:e.category,label:e.fixed?'固定':'固定解除',index:i}));
  });
  for(const slot of slots.filter(s=>s.date===date)){
    const index=items.findIndex(e=>studyCategory(e.category)&&e.start<=slot.start&&e.end>=slot.end);
    const block=items[index];
    rows.push({...slot,name:block?.custom&&block.category!=='学習予備'?block.name+'｜'+slot.title:slot.title,category:slot.subject,label:({required:'学習枠',buffer:'通常予備',emergency:'日曜緊急予備',available:'振替'})[slot.kind],index});
  }
  for(const [a,b] of gaps(rows.map(r=>[mins(r.start),mins(r.end)])))rows.push({start:hh(a),end:hh(b),name:'空き時間'});
  return rows.sort((a,b)=>a.start.localeCompare(b.start)).map(row=>row.category
    ? timetableEntry(date,row,items[row.index])
    : `<p class="fine timetable-gap">${row.start}–${row.end} 空き時間</p>`
  ).join('');
}
function editRecovery(date,start,end,subject){
  editItem(date,null,{id:[date,'recovery',start,end,subject].join('/'),date,origin:date,start,end,name:subject,category:subject,fixed:true,recovery:{date,start,end}});
}

// Timetable marks and actual measurements share the existing dated study log.
const accountingSubjects=['簿記論','財務諸表論'];
function lessonRecord(date,slot){
  return {date,planStart:slot.start,minutes:mins(slot.end)-mins(slot.start),subject:slot.subject,taskId:slot.id,title:slot.title};
}
function syncStudyLogs(){
  const wanted=new Map(),weeks=new Map();
  function lessons(date){
    const week=weekStart(date);
    if(!weeks.has(week))weeks.set(week,planSlots(date));
    return weeks.get(week).filter(s=>s.date===date);
  }
  state.lessonRecords??={};
  for(const [key,status] of Object.entries(state.scheduleStatus||{})){
    if(status!=='実施済'||!key.startsWith('['))continue;
    let record=state.lessonRecords[key];
    if(!record){
      let parts;try{parts=JSON.parse(key);}catch{continue;}
      if(!Array.isArray(parts)||parts.length!==5||!/^\d{4}-\d{2}-\d{2}$/.test(parts[0]))continue;
      const slot=lessons(parts[0]).find(s=>lessonStatusKey(parts[0],s)===key);
      if(slot)record=state.lessonRecords[key]=lessonRecord(parts[0],slot);
    }
    if(record)wanted.set(key,record);
  }
  for(const e of Object.values(state.agendaEdits||{})){
    if(e.deleted||e.status!=='実施済')continue;
    if(accountingSubjects.includes(e.category)){
      const taskId=e.category==='簿記論'?'studying-boki':'studying-zai';
      wanted.set(e.id,{date:e.date,planStart:e.start,minutes:e.actual??(mins(e.end)-mins(e.start)),subject:e.category,taskId,title:e.name});
    }else if(['FAR','国徴'].includes(e.category)){
      for(const s of lessons(e.date).filter(s=>s.subject===e.category&&s.start>=e.start&&s.end<=e.end)){
        const key=lessonStatusKey(e.date,s);
        if(!state.scheduleStatus?.[key])wanted.set(key,lessonRecord(e.date,s));
      }
    }
  }
  const manual=state.logs.filter(l=>!l.autoKey),old=new Map(state.logs.filter(l=>l.autoKey).map(l=>[l.autoKey,l]));
  const automatic=[];
  for(const [key,record] of wanted){
    const same=manual.some(l=>l.date===record.date&&l.taskId===record.taskId&&l.planStart===record.planStart);
    if(same)continue;
    automatic.push({...record,id:old.get(key)?.id||uid(),autoKey:key,accuracy:null,reason:'',created:old.get(key)?.created||Date.now()});
  }
  state.logs=manual.concat(automatic);
  weekCache.clear();
}
