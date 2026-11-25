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
