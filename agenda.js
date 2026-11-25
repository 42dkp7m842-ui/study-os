// A template occurrence keeps its source identity even after a move.
const categories=['筋トレ','有酸素運動','FAR','国徴','学習予備','仕事','睡眠','デート','外出','食事','入浴','休憩','その他'];
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
function dayItems(date){
  const edits=state.agendaEdits||{};
  const events=state.events.filter(e=>e.date===date).map(e=>({...e,id:'event/'+e.id,category:e.category||'その他',fixed:true,manual:true}));
  const moves=(state.blockMoves||[]).filter(m=>m.date===date).map(m=>({...m,id:m.origin+'/legacy/'+m.key,name:m.subject,category:m.kind==='buffer'?'学習予備':m.subject,fixed:true,legacy:true}));
  return [...baseDay(date),...events,...moves].filter(e=>!edits[e.id]).concat(Object.values(edits).filter(e=>!e.deleted&&e.date===date)).sort((a,b)=>a.start.localeCompare(b.start));
}
function studyBlocks(date){
  return dayItems(date).filter(e=>studyCategory(e.category)).map(e=>[e.start,e.end,e.category==='学習予備'?'予備':e.category,e.category==='学習予備'?'buffer':'required']);
}
function usableStudyParts(date,start,end,subject,kind){
  const entries=dayItems(date).filter(e=>studyCategory(e.category));
  const chosen=entries.find(e=>e.start===start&&e.end===end&&(kind==='buffer'?e.category==='学習予備':e.category===subject));
  const priority=e=>(e.custom||e.legacy?0:2)+(e.category==='学習予備'?1:0);
  const earlier=entries.filter(e=>chosen&&e.id!==chosen.id&&(priority(e)<priority(chosen)||priority(e)===priority(chosen)&&e.id<chosen.id));
  return freeParts(date,mins(start),mins(end),earlier.map(e=>[mins(e.start),mins(e.end)]));
}
function fixedParts(date){
  return dayItems(date).filter(e=>!studyCategory(e.category)).map(e=>[mins(e.start),mins(e.end)]);
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
  if(!save()){state.agendaEdits=JSON.parse(before);state.agendaUndo=old;return false;}
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
function restoreItem(id){
  if(agendaWrite(()=>delete state.agendaEdits[id]))render();
}
function dayEditor(date){
  const items=dayItems(date),exceptions=Object.values(state.agendaEdits||{}).filter(e=>e.origin===date&&(e.deleted||e.date!==date));
  const parts=freeDay(date);
  const sleep=dayItems(shift(date,1)).filter(e=>e.category==='睡眠'&&e.start==='00:00').reduce((a,e)=>Math.max(a,mins(e.end)),0)+items.filter(e=>e.category==='睡眠'&&e.end==='24:00').reduce((a,e)=>Math.max(a,1440-mins(e.start)),0);
  const warnings=[];
  for(const [i,e] of items.entries())for(const other of items.slice(i+1)){
    if(e.end>other.start&&e.start<other.end&&(!studyCategory(e.category)||e.custom)&&(!studyCategory(other.category)||other.custom))warnings.push(esc(e.name)+'・'+esc(other.name)+' '+other.start+'〜'+(other.end<e.end?other.end:e.end));
  }
  const rows=items.map((e,i)=>'<button type="button" class="agenda-row" data-category="'+esc(e.category)+'" onclick="editItem(\''+date+'\','+i+')"><b>'+esc(e.start)+'–'+esc(e.end)+'</b> '+esc(e.name)+'<small>'+esc(e.category)+' · '+(e.deleted?'解除':e.fixed?'固定':'固定解除')+' · ' +esc(e.status||'予定')+'</small></button>').join('');
  return '<section class="card"><details><summary>'+date+'（'+names[dow(date)]+'）の予定編集・空き時間</summary>'+rows+'<p class="fine">空き '+parts.map(([a,b])=>hh(a)+'–'+hh(b)).join('、')+'</p><p>翌朝までの睡眠 '+fmt(sleep)+'</p>'+(sleep<420?'<p class="notice">7時間に不足します。就寝を'+fmt(420-sleep)+'早めるか、翌朝の起床を遅らせ、重なる運動・入浴の時間を編集してください。</p>':'')+warnings.map(w=>'<p class="notice">重複 '+w+'。予定をタップして調整してください。</p>').join('')+'<div class="actions"><button onclick="editItem(\''+date+'\')">予定を追加</button><button class="secondary" onclick="standard(\''+date+'\')">標準に戻す</button>'+(state.agendaUndo!=null?'<button class="secondary" onclick="agendaUndo()">直前の編集を取消</button>':'')+'</div>'+exceptions.map((e,i)=>'<p>'+esc(e.name)+' · '+(e.deleted?'今回解除':'振替先 '+e.date)+' <button onclick="restoreException(\''+date+'\','+i+')">復元</button></p>') .join('')+'</details></section>';
}
function restoreException(date,i){
  const e=Object.values(state.agendaEdits||{}).filter(e=>e.origin===date&&(e.deleted||e.date!==date))[i];if(!e)return;
  if(e.deleted&&e.id.startsWith('manual/')){
    if(agendaWrite(()=>{state.agendaEdits[e.id]={...e,deleted:false};}))render();
  }else restoreItem(e.id);
}
function editItem(date,i,generated){
  const e=generated||(i==null?{id:'manual/'+uid(),origin:date,date,name:'',category:'その他',start:'18:00',end:'19:00',fixed:true,manual:true}:dayItems(date)[i]);
  if(!e)return;
  const dialog=document.createElement('dialog');
  dialog.className='agenda-dialog';
  const form=document.createElement('form');dialog.append(form);
  form.innerHTML='<h3>予定の編集</h3><label>日付<input name="date" required type="date"></label><label>カテゴリー<select name="category">'+categories.map(c=>'<option>'+c+'</option>').join('')+'</select></label><label>予定名<input name="name" maxlength="240"></label><div class="grid"><label>開始<input name="start" required type="time"></label><label>終了（24:00可）<input name="end" required pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00"></label></div><label>所要時間（分）<input name="duration" type="number" min="1" max="1440"></label><label>メモ<textarea name="memo"></textarea></label><label><input type="checkbox" name="fixed"> 固定</label><label>実施状況<select name="status"><option>予定</option><option>実施済</option><option>未実施</option></select></label><label>実際の時間（分）<input name="actual" type="number" min="0" max="1440"></label><label>未実施の理由<input name="reason"></label><p class="fine" id="agendaFree"></p><p role="alert" id="agendaWarning"></p><div class="actions"><button>保存</button><button type="button" class="secondary" data-action="close">閉じる</button></div>';
  const f=form.elements;
  for(const k of ['date','name','start','end','category','status','actual','reason','memo'])f[k].value=e[k]??(k==='status'?'予定':'');
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
    if(state.agendaEdits?.[e.id]&&!e.id.startsWith('manual/'))action('標準予定に復元',()=>{if(agendaWrite(()=>delete state.agendaEdits[e.id]))finish();});
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
    const conflicts=dayItems(data.date).filter(x=>x.id!==e.id&&x.start<data.end&&x.end>data.start&&(!studyCategory(x.category)||studyCategory(data.category)||x.custom||x.legacy));
    if(changed&&conflicts.length){$('agendaWarning').textContent='重複 '+conflicts.map(x=>x.start+'〜'+x.end+' '+x.name).join('、');return;}
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
function timetable(date,slots){
  const items=dayItems(date);
  const rows=items.flatMap((e,i)=>{
    if(studyCategory(e.category)&&e.category!=='学習予備')return [];
    const parts=e.category==='学習予備'?gaps([...fixedParts(date),...slots.filter(s=>s.date===date).map(s=>[mins(s.start),mins(s.end)])],mins(e.start),mins(e.end)):[[mins(e.start),mins(e.end)]];
    return parts.map(([a,b])=>({start:hh(a),end:hh(b),name:e.name,category:e.category,label:(e.fixed?'固定':'固定解除')+' · '+(e.status||'予定'),index:i}));
  });
  for(const slot of slots.filter(s=>s.date===date)){
    const index=items.findIndex(e=>studyCategory(e.category)&&e.start<=slot.start&&e.end>=slot.end);
    const block=items[index];
    rows.push({...slot,name:block?.custom&&block.category!=='学習予備'?block.name+'｜'+slot.title:slot.title,category:slot.subject,label:({required:'学習枠',buffer:'通常予備',emergency:'日曜緊急予備',available:'振替'})[slot.kind],index});
  }
  for(const [a,b] of gaps(rows.map(r=>[mins(r.start),mins(r.end)])))rows.push({start:hh(a),end:hh(b),name:'空き時間'});
  return rows.sort((a,b)=>a.start.localeCompare(b.start)).map(r=>r.category?'<button class="agenda-row" data-category="'+esc(r.category)+'" onclick="'+(r.index>=0?'editItem(\''+date+'\','+r.index+')':'editRecovery(\''+date+'\',\''+r.start+'\',\''+r.end+'\',\''+r.subject+'\')')+'"><b>'+r.start+'–'+r.end+'</b> '+esc(r.name)+'<small>'+esc(r.category)+' · '+esc(r.label)+'</small></button>':'<p class="fine">'+r.start+'–'+r.end+' 空き時間</p>').join('');
}
function editRecovery(date,start,end,subject){
  editItem(date,null,{id:[date,'recovery',start,end,subject].join('/'),date,origin:date,start,end,name:subject,category:subject,fixed:true,recovery:{date,start,end}});
}
