// Reporting uses the same dated study logs as the timer and manual entry.
const reviewFields = {summary:'要約', cause:'原因・仮説', action:'次週の対策', measure:'検証指標'};
const weeklyTargets = {FAR:1260, 国徴:120};
function loggedMinutes(logs) {
  return logs.reduce((sum, entry) => sum + (Number(entry.minutes) || 0), 0);
}
function progressRow(label, actual, target) {
  const percent = target ? Math.round(actual * 100 / target) : null;
  return `<div class="progress-row"><div class="row"><b>${label}</b><strong>${percent === null ? '予定なし' : percent+'%'}</strong></div>
    <progress aria-label="${label}" max="100" value="${Math.min(100,percent || 0)}"></progress>
    <small>実績 ${fmt(actual)} ／ 目標 ${fmt(target)}</small></div>`;
}
function dayProgress(slots, actual) {
  const target = slots.reduce((sum, slot) => sum + mins(slot.end) - mins(slot.start), 0);
  return progressRow('この日の達成率', actual, target);
}
function calendarMonth(offset) {
  const month = new Date(selected.slice(0,7)+'-01T12:00:00');
  month.setMonth(month.getMonth()+offset);
  selectDate(iso(month));
}
function selectDate(date) {
  selected = date;
  render();
}
function calendarView() {
  const month = selected.slice(0,7);
  const first = month+'-01';
  const totals = {};
  for (const log of state.logs) totals[log.date]=(totals[log.date]||0)+Number(log.minutes);
  const dates = [];
  for (let date=first; date.startsWith(month); date=shift(date,1)) {
    const min=totals[date]||0;
    dates.push(`<button class="cal-day ${min?'recorded':''}" aria-pressed="${date===selected}" aria-label="${date}、実績${min}分" onclick="selectDate('${date}')"><b>${Number(date.slice(8))}</b><small>${min ? min+'分' : dayItems(date).filter(e=>exercise(e.category)).map(e=>e.category==='筋トレ'?'筋':'有').join('')||'　'}</small></button>`);
  }
  const logs=state.logs.filter(l=>l.date===selected);
  const events=state.events.filter(e=>e.date===selected);
  return `<h2>学習カレンダー</h2><section class="card"><div class="row"><button class="secondary" aria-label="前月" onclick="calendarMonth(-1)">‹</button><h3>${month.replace('-','年')}月</h3><button class="secondary" aria-label="翌月" onclick="calendarMonth(1)">›</button></div>
    <div class="month-grid">${['月','火','水','木','金','土','日'].map(n=>'<small>'+n+'</small>').join('')}${'<i></i>'.repeat((dow(first)+6)%7)}${dates.join('')}</div>
    <div class="actions"><button class="secondary" onclick="selectDate(today())">今日に戻る</button></div></section>
    <section class="card"><div class="row"><h3>${selected.slice(5)}（${names[dow(selected)]}）</h3><b>${fmt(loggedMinutes(logs))}</b></div>
    ${logs.map(l=>`<div class="line"><b>${esc(l.title||state.tasks.find(t=>t.id===l.taskId)?.name||l.subject)}</b><small>${esc(l.subject)} · ${Number(l.minutes)}分${l.accuracy!=null?' · 正答率 '+Number(l.accuracy)+'%':''}</small>${l.reason?'<p>'+esc(l.reason)+'</p>':''}</div>`).join('') || '<p class="muted">学習記録はありません。</p>'}
    ${dayEditor(selected)}
    <div class="actions"><button onclick="go('day')">この日の記録を開く</button><button class="secondary" onclick="go('review')">この週を分析</button></div></section>`;
}
function weeklyCharts(week,logs) {
  const targets=planTargets(week.dates[0]);
  const totals=week.dates.map(date=>loggedMinutes(logs.filter(l=>l.date===date)));
  const max=Math.max(1,...totals);
  return `<section class="progress-row">${progressRow('週間達成率',loggedMinutes(logs),targets.FAR+targets.国徴)}
    ${Object.entries(targets).filter(([,n])=>n>0).map(([subject,target])=>progressRow(subject,loggedMinutes(logs.filter(l=>l.subject===subject)),target)).join('')}
    <h3>曜日別の学習時間</h3><div class="chart">${totals.map((minutes,i)=>`<div><small>${minutes}分</small><div class="column"><i style="height:${minutes/max*100}%"></i></div><b>${names[dow(week.dates[i])]}</b></div>`).join('')}</div></section>`;
}
function reviewArchive() {
  const week=weekStart(selected);
  const reviews=state.reviews.filter(r=>(r.week||weekStart(r.date))===week).slice().reverse();
  return `<section class="card"><h3>AI週次レビュー</h3><p class="muted">「ChatGPT分析用をコピー」を押してChatGPTに貼り付け、返答のJSONをここに保存します。</p>
    <label for="reviewNote">ChatGPTの返答</label><textarea id="reviewNote" placeholder="分析結果のJSONを貼り付け"></textarea>
    <div class="actions"><button onclick="saveAnalysis()">この週に保存</button></div>
    ${reviews.map(r=>r.analysis?Object.entries(reviewFields).map(([key,label])=>`<div class="analysis-field"><b>${label}</b><p>${esc(r.analysis[key])}</p></div>`).join('')+'<hr>':`<details><summary>${esc(r.date)} の保存メモ</summary><p class="analysis-text">${esc(r.text)}</p></details>`).join('')||'<p class="fine">この週の分析はまだありません。</p>'}</section>`;
}
function saveAnalysis() {
  const raw=$('reviewNote').value.trim();
  if(!raw)return alert('分析結果を貼り付けてください。');
  let entry;
  const json=raw.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'');
  if(json.startsWith('{') || raw.startsWith('```')) {
    try {
      const analysis=JSON.parse(json);
      if(!Object.keys(reviewFields).every(k=>typeof analysis[k]==='string'&&analysis[k].trim()))throw Error();
      entry={analysis};
    } catch {return alert('summary、cause、action、measure の4項目を文章で含むJSONを貼り付けてください。');}
  } else entry={text:raw};
  mutate(()=>state.reviews.push({id:uid(),date:today(),week:weekStart(selected),...entry}));
}
