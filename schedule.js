const dayLabels={start:'学習開始日',office:'出社',remote:'リモート',saturday:'土曜学習',holiday:'祝日',off:'学習なし',sunday:'日曜予備'};
function datedBlocks(date) {
  const moves=state.blockMoves||[];
  const originals=templateBlocks(date).map(([start,end,subject,kind])=>({
    origin:date, key:[start,end,subject,kind].join('|'), date,start,end,subject,kind
  }));
  return originals.filter(b=>!moves.some(m=>m.origin===date&&m.key===b.key))
    .concat(moves.filter(m=>m.date===date))
    .sort((a,b)=>a.start.localeCompare(b.start));
}
function blocks(date) {
  return datedBlocks(date).map(b=>[b.start,b.end,b.subject,b.kind]);
}
function movementPanel(date) {
  const options=datedBlocks(date).map((b,i)=>[ 'b'+i, b.start+'–'+b.end+' '+b.subject ]);
  state.events.filter(e=>e.date===date).forEach((e,i)=>options.push(['e'+i,e.start+'–'+e.end+' '+e.name]));
  const moveForm=options.length?`<label for="moveItem">移動する枠</label><select id="moveItem" onchange="fillMovement()">${options.map(([v,label])=>`<option value="${v}">${esc(label)}</option>`).join('')}</select>
    <label for="moveDate">移動先の日付</label><input id="moveDate" type="date" value="${date}">
    <label for="moveStart">移動先の開始時刻</label><input id="moveStart" type="time" value="${(datedBlocks(date)[0]||state.events.find(e=>e.date===date)).start}">
    <p class="fine">元の長さを保って移動します。保存すると教材の割り当てと予備枠を再計算します。</p>
    <button onclick="applyMovement()">移動して再計算</button>`:'<p class="muted">この日に移動できる学習枠・予定はありません。</p>';
  return `<details class="move-panel"><summary>学習枠・予定を移動</summary>${moveForm}${availableTimePanel(date)}</details>`;
}
function selectedMovement() {
  const value=$('moveItem').value;
  const isBlock=value[0]==='b';
  const list=isBlock?datedBlocks(selected):state.events.filter(e=>e.date===selected);
  return {isBlock,item:list[Number(value.slice(1))]};
}
function fillMovement() {
  $('moveStart').value=selectedMovement().item.start;
}
function applyMovement() {
  const {isBlock,item}=selectedMovement(),date=$('moveDate').value,start=$('moveStart').value;
  if(isBlock&&date<PLAN_START)return alert('学習枠は11月22日以降に移動してください。');
  if(!item||!date||!start)return alert('移動先の日付と開始時刻を指定してください。');
  const from=mins(start),until=from+mins(item.end)-mins(item.start);
  if(until>1440)return alert('終了が翌日になります。同じ日で終了する時刻を選んでください。');
  const end=hh(until);
  if(overlapsBath(date,start,end))return alert('22:00〜22:30はお風呂の固定時間です。');
  const conflicts=e=>overlap(from,until,mins(e.start),mins(e.end))>0;
  if(state.events.some(e=>e!==item&&e.date===date&&conflicts(e)))return alert('移動先に別の予定があります。');
  if(isBlock&&datedBlocks(date).some(b=>!(item.origin===b.origin&&item.key===b.key)&&conflicts(b)))return alert('移動先に別の学習枠があります。');
  mutate(()=>{
    if(isBlock){
      const moves=(state.blockMoves||[]).filter(m=>m.origin!==item.origin||m.key!==item.key);
      const originalRestored=date===item.origin && templateBlocks(date).some(b=>b.join('|')===item.key && b[0]===start);
      if(!originalRestored)moves.push({...item,date,start,end});
      state.blockMoves=moves;
    }else Object.assign(item,{date,start,end});
    selected=date;
  });
}
function changeDayType(type) {
  const old=state.days[selected]?.type;
  state.days[selected]??={};
  state.days[selected].type=type;
  const slots=datedBlocks(selected);
  if(slots.some((b,i)=>i&&b.start<slots[i-1].end)){
    if(old)state.days[selected].type=old;else delete state.days[selected].type;
    render();return alert('変更後の基本枠と移動済みの枠が重なります。先に移動済みの枠を空き時間に移してください。');
  }
  save();render();
}

function availableTimes(date) {
  return state.days[date]?.availableTimes || [];
}

function availableTimeParts(date, ranges = availableTimes(date)) {
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

function hasBath(date) {
  return ['office','remote','saturday','holiday','sunday'].includes(typeOf(date));
}
function overlapsBath(date,start,end) {
  return hasBath(date) && start < '22:30' && end > '22:00';
}
function bathRow(date) {
  return hasBath(date) ? '<div class="slot"><b>22:00–22:30</b><small>お風呂（固定）</small></div>' : '';
}
