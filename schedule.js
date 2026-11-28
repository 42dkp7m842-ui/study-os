const dayLabels={start:'学習開始日',office:'出社',remote:'リモート',saturday:'土曜学習',holiday:'祝日',off:'学習なし',sunday:'日曜予備'};
Object.assign(dayLabels,{sundayStudy:'日曜学習',other:'その他'});
function blocks(date){return studyBlocks(date);}
function movementPanel(date){return '<details class="move-panel"><summary>利用可能な学習枠を登録</summary>'+availableTimePanel(date)+'</details>';}
function changeDayType(type){mutate(()=>{state.days[selected]??={};state.days[selected].type=type;});}
function availableTimes(date) {
  return state.days[date]?.availableTimes || [];
}

function availableTimeParts(date, ranges = combinedRanges([...availableTimes(date),...releasedTimes(date)])) {
  const occupied = blocks(date).map(([start,end]) => [mins(start), mins(end)]);
  return ranges.flatMap(({start,end}) => freeParts(date, mins(start), mins(end), occupied));
}

function availableTimePanel(date) {
  const ranges = availableTimes(date);
  const editable = date >= today() && date >= PLAN_START && date < taxEnd();
  return `<h3>空いた時間を登録</h3>
    <p class="fine">表示中の日に追加します。同じ週の予定で失われた必須学習枠を、登録した空き時間から優先して補います。残った時間は空けておきます。</p>
    ${ranges.map(({start,end}, index) => `<div class="row"><span>${esc(start)}〜${esc(end)}</span>
      <button type="button" class="secondary" onclick="removeAvailableTime(${index})" aria-label="${esc(start)}から${esc(end)}の空き時間を取り消す">取消</button></div>`).join('')}
    ${editable ? `<div class="grid">
      <div><label for="availableStart">空き時間の開始</label><input id="availableStart" type="time"></div>
      <div><label for="availableEnd">空き時間の終了</label><input id="availableEnd" type="time"></div>
    </div><div class="actions"><button type="button" onclick="addAvailableTime()">空き時間を登録して再計算</button></div>`
    : '<p class="fine">今日以降の学習期間内の日付を選んでください。</p>'}`;
}

function addAvailableTime() {
  const start = $('availableStart').value;
  const end = $('availableEnd').value;
  if (!start || !end || start >= end) return alert('開始・終了時刻を同じ日で指定してください。');
  const ranges = availableTimes(selected);
  if (ranges.some(range => start < range.end && end > range.start)) {
    return alert('登録済みの空き時間と重なっています。');
  }
  if (!availableTimeParts(selected, [{start,end}]).length) {
    return alert('既存の予定や学習枠と重なり、使える時間がありません。');
  }
  mutate(() => {
    state.days[selected] ??= {};
    state.days[selected].availableTimes = [...ranges, {start,end}].sort((a,b) => a.start.localeCompare(b.start));
  });
  document.querySelector('.move-panel').open = true;
}

function removeAvailableTime(index) {
  mutate(() => {
    state.days[selected].availableTimes = availableTimes(selected).filter((_,i) => i !== index);
  });
  document.querySelector('.move-panel').open = true;
}

function missedPanel(date){
  const records=(state.missedTimes||[]).filter(r=>r.date===date);
  const rows=records.map(r=>`<div class="line"><b>${esc(r.start)}〜${esc(r.end)}</b> ${esc(r.name||r.reason||'未実行時間')}<small>${esc(r.summary)}</small></div>`).join('');
  return `<details class="card"><summary>できなかった時間を登録・振替</summary>
    <p class="fine">この日に実行できなかった部分だけ指定してください。学習は予備枠へ、運動・簿記論などは次の空き時間へ振り替えます。</p>
    <div class="grid"><label>開始<input type="time" id="missStart"></label><label>終了<input type="time" id="missEnd"></label></div>
    <label>この時間に入っていた予定名（任意）<input id="missReason" placeholder="例：残業、急な外出"></label>
    <button onclick="registerMissed()">振替先を確認</button>${rows}</details>`;
}
function registerMissed(){
  const date=selected,start=$('missStart').value,end=$('missEnd').value;
  if(!start||!end||start>=end)return alert('開始・終了時刻を確認してください。');
  const records=state.missedTimes||[];
  if(records.some(r=>r.date===date&&r.start<end&&r.end>start))return alert('登録済みの未実行時間と重なっています。');
  const hits=e=>overlap(mins(start),mins(end),mins(e.start),mins(e.end));
  const previous=weekly(date);
  const study=previous.slots.filter(s=>s.date===date).reduce((n,s)=>n+overlap(mins(start),mins(end),s.start,s.end),0);
  const others=dayItems(date).filter(e=>hits(e)&&!studyCategory(e.category)&&!['睡眠','仕事'].includes(e.category)&&e.status!=='実施済');
  if(!study&&!others.length)return alert('指定時間に振替対象の予定がありません。');
  const now=new Date(),clock=hh(now.getHours()*60+now.getMinutes());
  const resume=[date+' '+end,today()+' '+clock].sort().at(-1);
  const record={date,start,end,resume,reason:$('missReason').value.trim(),study,summary:''};
  // Keep allocations before the restart time, including earlier recovery sessions.
  record.earlierSlots=[];
  for(let week=weekStart(date);week<=weekStart(resume.slice(0,10))&&week<taxEnd();week=shift(week,7)){
    for(const slot of weekly(week).slots){
      if(slot.kind==='required'||slot.date>resume.slice(0,10))continue;
      const until=slot.date===resume.slice(0,10)?Math.min(slot.end,mins(resume.slice(11))):slot.end;
      if(until>slot.start)record.earlierSlots.push({...slot,end:until});
    }
  }
  const original=state;
  state=JSON.parse(JSON.stringify(original));
  try{
    state.missedTimes=[...(state.missedTimes||[]),record];state.agendaEdits??={};
    const messages=[];
    weekCache.clear();
    for(const e of others){
      const duration=hits(e),a=mins(e.start),b=mins(e.end);
      const parts=gaps([[mins(start),mins(end)]],a,b);
      state.agendaEdits[e.id]={...e,deleted:true};
      for(const [i,[x,y]] of parts.entries()){
        const id=i===0?e.id:'manual/'+uid();
        state.agendaEdits[id]={...e,id,start:hh(x),end:hh(y),custom:true};
      }
      weekCache.clear();
      let destination;
      for(let day=resume.slice(0,10),i=0;i<14;i++,day=shift(day,1)){
        if(!dow(day))continue;
        const busy=dayItems(day).map(v=>[mins(v.start),mins(v.end)]).concat(weekly(day).slots.filter(s=>s.date===day).map(s=>[s.start,s.end]));
        const floor=day===resume.slice(0,10)?mins(resume.slice(11)):0;
        const fit=gaps(busy,floor,1440).find(([x,y])=>y-x>=duration);
        if(fit){destination={date:day,start:hh(fit[0]),end:hh(fit[0]+duration)};break;}
      }
      if(destination){
        const id=parts.length?'manual/'+uid():e.id;
        state.agendaEdits[id]={...e,...destination,id,custom:true,status:'予定'};
        messages.push(e.name+' → '+destination.date+' '+destination.start+'〜'+destination.end);
      }else messages.push(e.name+' '+duration+'分：2週間以内に空きなし（要調整）');
      weekCache.clear();
    }
    const w=weekly(date);
    if(study){
      const changes=[];
      for(const slot of w.slots){
        const before=previous.slots.filter(s=>s.date===slot.date&&s.subject===slot.subject).map(s=>[s.start,s.end]);
        for(const [a,b] of gaps(before,slot.start,slot.end))changes.push(slot.date+' '+hh(a)+'〜'+hh(b));
      }
      messages.push('学習 '+study+'分を再計算'+(changes.length?' → '+changes.join('、'):'')+'。今週の未配分 '+fmt(w.uncovered));
    }
    record.summary=messages.join(' ／ ');
    if(!confirm(record.summary+'。保存しますか？')||!save())state=original;
  }catch(err){state=original;throw err;}finally{weekCache.clear();render();}
}
