'use strict';
/* Grind: routine tracker UI. The Obsidian notes are the only data store; the server reads/writes them. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let S = null, busy = false;
const V = { tab: 'today', date: null, month: null, week: null, range: 30, habit: 'All', tsub: 'All', tstat: 'all', tq: '', tAS: false };

const CAT_COL = { Maths: '#5b9cff', Physics: '#a78bfa', Chemistry: '#3ce6b0', CS: '#f472b6', German: '#f2b33d', Study: '#38bdf8',
  Cardio: '#f05d5d', College: '#8b9592', Internship: '#c7cfcc', Read: '#facc15', Sleep: '#818cf8', Church: '#e879f9', Other: '#7b8582' };
const STUDY = new Set(['Maths', 'Physics', 'Chemistry', 'CS', 'German', 'Study']);
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="#04140e" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---------- date helpers (local, no timezone drift) ----------
const D = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const add = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return iso(d); };
const monday = s => { const d = D(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const fmt = (s, o) => D(s).toLocaleDateString('en-GB', o);
const fmtMin = m => { if (m == null) return ''; m = ((m % 1440) + 1440) % 1440; let h = Math.floor(m / 60), mi = m % 60; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${String(mi).padStart(2, '0')} ${ap}`; };
const hrs = m => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), mm = m % 60; return h ? `${h}h ${mm}m` : `${mm}m`; };
const dur = t => (t.start != null && t.end != null ? t.end - t.start : (t.study ? 60 : 0));
const tasksOf = d => (S.notes[d] || []).filter(t => !t.cancelled);
const has = d => d in S.notes;
const pctOf = arr => (arr.length ? Math.round((arr.filter(t => t.done).length / arr.length) * 100) : null);
// average daily % over a list of dates; past days without a note count as 0, future days are ignored
const avgDays = (dates, filt = () => true) => {
  const v = [];
  for (const d of dates) {
    if (d > S.today) continue;
    if (!has(d)) { if (d < S.today) v.push(0); continue; }
    const p = pctOf(tasksOf(d).filter(filt));
    if (p != null) v.push(p);
  }
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};
const range = (a, n) => Array.from({ length: n }, (_, i) => add(a, i));

// ---------- api ----------
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
async function load(silent) {
  try {
    const first = !S;
    S = await api('/api/state');
    if (first) { V.date = S.today; V.month = S.today.slice(0, 7); V.week = monday(S.today); }
    render();
    if (first && S.created) toast(`Created today's note`, `${S.created.rel} · from ${tplName(S.created.used)}`, 'ok');
    if (S.autoRevised && S.autoRevised.length) topicToast(`${S.autoRevised.length} topic${S.autoRevised.length === 1 ? '' : 's'} moved to revision`, S.autoRevised);
  } catch (e) { if (!silent) toast('Could not load', e.message, 'err'); }
}
const tplName = p => String(p || '').replace(/^.*\//, '').replace(/\.md$/, '');

function toast(title, sub, kind = '', actions = []) {
  const d = document.createElement('div'); d.className = 'toast ' + kind;
  d.innerHTML = `<b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}${actions.length ? `<div class="tb">${actions.map((a, i) => `<button data-a="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}`;
  d.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { actions[+b.dataset.a].fn(); d.remove(); });
  $('#toasts').appendChild(d);
  const ms = actions.length ? 9000 : 4200;
  setTimeout(() => { d.style.transition = 'all .3s'; d.style.opacity = 0; }, ms); setTimeout(() => d.remove(), ms + 400);
}
const topicLabel = c => { const t = (S.topics || []).find(x => x.id === c.id); return t ? `${t.short} ${t.title}` : (c.title || c.file); };
function topicToast(title, changes) {
  if (!changes || !changes.length) return;
  const names = changes.map(topicLabel);
  toast(title, names.slice(0, 4).join(' · ') + (names.length > 4 ? ` +${names.length - 4} more` : ''), 'ok', [{ label: 'Undo', fn: () => undoTopics(changes) }]);
}
async function undoTopics(changes) {
  try { S = await api('/api/topic-undo', { changes }); render(); toast('Undone', `${S.undone} checklist line${S.undone === 1 ? '' : 's'} restored`); }
  catch (e) { toast('Undo failed', e.message, 'err'); }
}
async function topicAction(ids, action) {
  if (busy) return; busy = true;
  const wasRevise = ids.every(id => (S.topics.find(t => t.id === id) || {}).status === 'revise');
  try { S = await api('/api/topic', { ids, action }); render(); topicToast(action === 'practised' && wasRevise ? 'Revised · #revise removed' : ACT_DONE[action] || 'Updated', S.topicChanges); }
  catch (e) { toast('Could not update the checklist', e.message, 'err'); await load(true); }
  busy = false;
}

// one tick → write [x]/[ ] into the note, then refresh everything from disk
async function setDone(date, t, done) {
  const before = S.stats.today || {};
  const r = await api('/api/toggle', { date, line: t.line, text: t.text, done });
  S = r;
  if (done) topicToast('Marked practised in your checklist', S.topicChanges);
  const after = S.stats.today || {};
  if (date === S.today && done) {
    if (after.perfect && !before.perfect) toast('Perfect day', 'Every block ticked.', 'ok');
    else if (after.qualifies && !before.qualifies) toast(`Streak secured · ${S.stats.currentStreak} day${S.stats.currentStreak === 1 ? '' : 's'}`, `${S.stats.threshold}% of today done.`, 'ok');
  }
}
async function toggleOne(date, t) {
  if (busy) return; busy = true;
  try { await setDone(date, t, !t.done); render(); } catch (e) { toast('Could not save to Obsidian', e.message, 'err'); await load(true); }
  busy = false;
}

// ---------- svg helpers ----------
function ring(p, size, stroke, label) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r, v = Math.max(0, Math.min(100, p || 0));
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" style="transform:rotate(-90deg)">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#151a1b" stroke-width="${stroke}"/>
    <circle class="v" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#3ce6b0" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${v ? (C * v) / 100 : 0} ${C}" opacity="${v ? 1 : 0}"/></svg>
    <div class="c" style="font-size:${Math.round(size / 4.6)}px">${label ?? (p == null ? '–' : p + '%')}</div></div>`;
}
function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const lo = Math.min(p1[1], p2[1]), hi = Math.max(p1[1], p2[1]);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.max(lo, Math.min(hi, p1[1] + (p2[1] - p0[1]) / 6))];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.max(lo, Math.min(hi, p2[1] - (p3[1] - p1[1]) / 6))];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}
// area chart: vals = [{x label, v (0-100 or null)}]
function area(vals, { w = 1000, h = 220, labelEvery = 5, id = 'a' } = {}) {
  const padL = 30, padB = 22, n = vals.length, step = (w - padL - 8) / Math.max(1, n - 1);
  const pts = []; vals.forEach((p, i) => { if (p.v != null) pts.push([padL + i * step, 8 + (h - 8) * (1 - p.v / 100)]); });
  let s = `<svg viewBox="0 0 ${w} ${h + padB}" width="100%"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3ce6b0" stop-opacity=".42"/><stop offset="1" stop-color="#3ce6b0" stop-opacity="0"/></linearGradient></defs>`;
  for (const g of [0, 50, 100]) { const y = 8 + (h - 8) * (1 - g / 100); s += `<line x1="${padL}" x2="${w}" y1="${y}" y2="${y}" stroke="#151a1b"/><text x="0" y="${y + 3.5}">${g}%</text>`; }
  if (pts.length) {
    const line = smoothPath(pts);
    s += `<path d="${line} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z" fill="url(#${id})"/>`;
    s += `<path class="glow" d="${line}" fill="none" stroke="#3ce6b0" stroke-width="2.6" stroke-linecap="round"/>`;
    const L = pts[pts.length - 1]; s += `<circle cx="${L[0]}" cy="${L[1]}" r="4.5" fill="#3ce6b0" class="glow"/>`;
  }
  vals.forEach((p, i) => { if (i % labelEvery === 0 || i === n - 1) s += `<text x="${padL + i * step}" y="${h + 17}" text-anchor="${i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'}">${esc(p.x)}</text>`; });
  return s + '</svg>';
}
function multiLine(series, labels, { w = 520, h = 150 } = {}) {
  const padL = 30, n = labels.length, step = (w - padL - 8) / Math.max(1, n - 1);
  let s = `<svg viewBox="0 0 ${w} ${h + 22}" width="100%">`;
  for (const g of [0, 50, 100]) { const y = 6 + (h - 6) * (1 - g / 100); s += `<line x1="${padL}" x2="${w}" y1="${y}" y2="${y}" stroke="#151a1b"/><text x="0" y="${y + 3.5}">${g}%</text>`; }
  for (const se of series) {
    const pts = []; se.v.forEach((v, i) => { if (v != null) pts.push([padL + i * step, 6 + (h - 6) * (1 - v / 100)]); });
    s += `<path d="${smoothPath(pts)}" fill="none" stroke="${se.c}" stroke-width="2.2" stroke-linecap="round" style="filter:drop-shadow(0 0 4px ${se.c}88)"/>`;
  }
  labels.forEach((l, i) => { if (i % 2 === 0 || i === n - 1) s += `<text x="${padL + i * step}" y="${h + 17}" text-anchor="${i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'}">${esc(l)}</text>`; });
  return s + '</svg>';
}

// ---------- header ----------
function renderTop() {
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === V.tab));
  const st = S.stats, t = st.today, el = $('#streak');
  const risk = t && !t.qualifies && st.currentStreak > 0;
  el.className = 'chip' + (st.currentStreak > 0 ? ' live' : '') + (risk ? ' risk' : '');
  el.innerHTML = `🔥 ${st.currentStreak}`;
  el.title = `Current streak ${st.currentStreak} · best ${st.bestStreak}. A day counts at ${st.threshold}%+.`;
}

// ---------- TODAY ----------
function nowMin(date) {
  const d = new Date(); let m = d.getHours() * 60 + d.getMinutes();
  if (iso(d) !== date) m += 1440; // after midnight but before the rollover hour
  return m;
}
function renderToday() {
  const st = S.stats, date = V.date, isToday = date === S.today, past = date < S.today;
  const tasks = tasksOf(date), done = tasks.filter(t => t.done).length, p = pctOf(tasks);
  const n = isToday ? nowMin(date) : null;
  const state = t => {
    if (past) return { late: !t.done };
    if (!isToday || t.start == null) return {};
    const end = t.end ?? t.start + 30;
    return { now: n >= t.start && n < end, late: n >= end };
  };
  const need = Math.max(0, Math.ceil((st.threshold / 100) * tasks.length) - done);
  let notes = '';
  if (S.error) notes += `<div class="note err">${esc(S.error)}</div>`;
  if (isToday && tasks.length && need > 0) notes += st.currentStreak > 0
    ? `<div class="note warn">🔥 ${need} more to keep your ${st.currentStreak}-day streak. The day ends at ${fmtMin(S.config.rolloverHour * 60)}.</div>`
    : `<div class="note warn">${need} more today to start a streak.</div>`;

  const rows = has(date) ? (tasks.length ? tasks.map((t, i) => {
    const s = state(t), c = CAT_COL[t.cat] || CAT_COL.Other;
    const time = t.start != null ? (t.end != null ? `${fmtMin(t.start)} – ${fmtMin(t.end)}` : fmtMin(t.start)) : '';
    return `<div class="trow ${t.done ? 'done' : ''} ${s.now ? 'now' : ''} ${s.late ? 'late' : ''}" data-i="${i}">
      <div class="ck">${CHECK}</div><div class="tm">${time}</div>
      <div class="lb">${esc(t.label)}${s.now ? '<span class="badge now">NOW</span>' : ''}${s.late && !t.done && isToday ? '<span class="badge late">LATE</span>' : ''}</div>
      <div class="tag"><span class="dot" style="background:${c}"></span>${esc(t.cat)}</div></div>`;
  }).join('') : `<div class="empty">This note has no checkboxes.</div>`)
    : `<div class="empty">No note for this day.<div style="margin-top:14px"><button class="btn solid" id="create">Create from ${esc(tplName(S.activeTemplate))}</button></div></div>`;

  // now / next
  let up = '';
  if (isToday) {
    const cur = tasks.find(t => state(t).now), nxt = tasks.find(t => !t.done && t.start != null && t.start > n);
    if (cur) {
      const end = cur.end ?? cur.start + 30, pr = Math.round(((n - cur.start) / (end - cur.start)) * 100);
      up = `<div class="card upnext"><div class="cap mint">Now</div><div class="t">${esc(cur.label)}</div><div class="bar"><i style="width:${pr}%"></i></div><div class="kv" style="border:0;padding-bottom:0"><span class="mut">${fmtMin(cur.start)} – ${fmtMin(end)}</span><span class="mut">${hrs(end - n)} left</span></div></div>`;
    } else if (nxt) up = `<div class="card upnext"><div class="cap">Up next</div><div class="t">${esc(nxt.label)}</div><div class="mut">${fmtMin(nxt.start)} · in ${hrs(nxt.start - n)}</div></div>`;
  }
  const wk = range(monday(S.today), 7), lwk = range(add(monday(S.today), -7), 7);
  const tw = avgDays(wk) ?? 0, lw = avgDays(lwk) ?? 0, dlt = tw - lw;
  const sp = wk.reduce((a, d) => a + tasksOf(d).filter(t => t.study).reduce((x, t) => x + dur(t), 0), 0);
  const sd = wk.reduce((a, d) => a + tasksOf(d).filter(t => t.study && t.done).reduce((x, t) => x + dur(t), 0), 0);
  const msg = !tasks.length ? '' : p === 100 ? 'Perfect day.' : need === 0 ? `Streak day secured. ${tasks.length - done} left for a perfect day.` : `${need} more for a streak day.`;

  $('#main').innerHTML = `<div class="page">
    <div class="ph"><div><div class="datehead"><h1>${isToday ? 'Today' : esc(fmt(date, { weekday: 'long' }))}</h1>
      <div class="nav"><button id="prev">‹</button><button id="next" ${date >= add(S.today, 7) ? 'disabled' : ''}>›</button>${!isToday ? '<button id="tod" style="width:auto;padding:0 10px;font-size:12px">Today</button>' : ''}</div></div>
      <div class="sub">${esc(fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}${past ? ' · past' : date > S.today ? ' · upcoming' : ''}</div></div></div>
    <div class="todaygrid">
      <div>${notes}<div class="tlist">${rows}</div></div>
      <div class="side">
        <div class="card"><div class="ringwrap">${ring(p, 112, 10)}<div><div class="mid">${done}<span class="mut" style="font-size:16px"> / ${tasks.length}</span></div><div class="mut" style="margin-top:4px">${msg}</div></div></div></div>
        ${up}
        ${revCard()}
        <div class="card"><div class="cap" style="margin-bottom:4px">This week</div>
          <div class="kv"><span>Completion</span><b>${tw}%</b></div>
          <div class="kv"><span>vs last week</span><b class="${dlt >= 0 ? 'mint' : 'red'}">${dlt >= 0 ? '+' : ''}${dlt}%</b></div>
          <div class="kv"><span>Study done</span><b>${hrs(sd)} <span class="mut" style="font-size:12px;font-family:Inter">/ ${hrs(sp)}</span></b></div>
          <div class="kv"><span>Streak</span><b>🔥 ${st.currentStreak} <span class="mut" style="font-size:12px;font-family:Inter">best ${st.bestStreak}</span></b></div>
        </div>
      </div></div></div>`;
  $('#prev').onclick = () => { V.date = add(date, -1); render(); };
  $('#next').onclick = () => { V.date = add(date, 1); render(); };
  if ($('#tod')) $('#tod').onclick = () => { V.date = S.today; render(); };
  if ($('#create')) $('#create').onclick = () => createNote(date);
  document.querySelectorAll('[data-rev]').forEach(b => b.onclick = () => topicAction([b.dataset.rev], 'practised'));
  if ($('#allrev')) $('#allrev').onclick = () => { V.tab = 'topics'; V.tstat = 'revise'; V.tsub = 'All'; render(); };
  document.querySelectorAll('.trow').forEach(el => el.onclick = () => { el.classList.toggle('done'); el.classList.add('flash'); toggleOne(date, tasks[+el.dataset.i]); });
}
async function createNote(date) {
  try { S = await api('/api/create', { date }); render(); toast("Note created", `${date} · ${tplName(S.activeTemplate)}`, "ok"); }
  catch (e) { toast('Could not create note', e.message, 'err'); }
}

// ---------- HABITS (monthly grid) ----------
function habitStreak(cat) {
  const dates = Object.keys(S.notes).sort(), first = dates[0] || S.today;
  let n = 0;
  for (let d = S.today; d >= first; d = add(d, -1)) {
    if (!has(d)) { if (d === S.today) continue; break; }
    const ts = tasksOf(d).filter(t => t.cat === cat);
    if (!ts.length) continue;
    if (ts.every(t => t.done)) n++;
    else if (d === S.today) continue;
    else break;
  }
  return n;
}
function renderHabits() {
  const [y, m] = V.month.split('-').map(Number);
  const nDays = new Date(y, m, 0).getDate(), dates = range(`${V.month}-01`, nDays);
  // habit rows = task types seen this month, ordered by usual time of day
  const info = {};
  for (const d of dates) for (const t of tasksOf(d)) { const o = (info[t.cat] = info[t.cat] || { starts: [] }); if (t.start != null) o.starts.push(t.start); }
  const cats = Object.keys(info).sort((a, b) => {
    const av = x => (info[x].starts.length ? info[x].starts.reduce((p, c) => p + c, 0) / info[x].starts.length : 9999);
    return av(a) - av(b);
  });
  const cols = `minmax(150px,190px) repeat(${nDays},minmax(22px,1fr)) 150px`;
  let g = `<div class="hgrid" style="grid-template-columns:${cols}">`;
  // trend line aligned with the day columns
  const daily = dates.map(d => (d > S.today ? null : has(d) ? pctOf(tasksOf(d)) : (d < S.today ? 0 : null)));
  const W = nDays * 20, H = 70, pts = [];
  daily.forEach((v, i) => { if (v != null) pts.push([i * 20 + 10, 6 + (H - 12) * (1 - v / 100)]); });
  g += `<div class="cap" style="align-self:end;padding-bottom:6px">Daily %</div><div style="grid-column:2 / span ${nDays};height:${H}px"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}">
    <defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3ce6b0" stop-opacity=".28"/><stop offset="1" stop-color="#3ce6b0" stop-opacity="0"/></linearGradient></defs>
    ${pts.length > 1 ? `<path d="${smoothPath(pts)} L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z" fill="url(#hg)"/><path class="glow" d="${smoothPath(pts)}" fill="none" stroke="#3ce6b0" stroke-width="2" vector-effect="non-scaling-stroke"/>` : ''}</svg></div>`;
  const monthAvg = avgDays(dates);
  g += `<div style="display:flex;justify-content:flex-end;align-items:end;height:${H}px"><div class="avgbox"><div class="cap" style="font-size:9.5px">Avg</div><div class="num">${monthAvg ?? '–'}${monthAvg != null ? '%' : ''}</div></div></div>`;
  // header
  g += `<div class="cap" style="padding:6px 0">Habit</div>`;
  for (const d of dates) { const dw = D(d).getDay(); g += `<div class="hdr ${d === S.today ? 'tod' : ''} ${dw === 0 || dw === 6 ? 'we' : ''}">${+d.slice(8)}<br>${'SMTWTFS'[dw]}</div>`; }
  g += `<div class="hstat cap" style="font-size:9.5px"><span>%</span><span>🔥</span><span>✓</span></div><div class="hline"></div>`;
  // rows
  for (const c of cats) {
    let tot = 0, dn = 0, row = `<div class="hname"><span class="dot" style="background:${CAT_COL[c] || CAT_COL.Other};box-shadow:0 0 8px ${CAT_COL[c] || CAT_COL.Other}"></span>${esc(c)}</div>`;
    for (const d of dates) {
      const tc = d === S.today ? ' tcol' : '';
      if (d > S.today) { row += `<div class="cell${tc}">${!has(d) || tasksOf(d).some(t => t.cat === c) ? '<div class="circ fut"></div>' : '<div class="circ off"></div>'}</div>`; continue; }
      if (!has(d)) { row += `<div class="cell${tc}"><div class="circ nonote" title="${d}: no note"></div></div>`; continue; }
      const ts = tasksOf(d).filter(t => t.cat === c);
      if (!ts.length) { row += `<div class="cell${tc}"><div class="circ off"></div></div>`; continue; }
      const k = ts.filter(t => t.done).length; tot += ts.length; dn += k;
      const cls = k === ts.length ? 'full' : k ? 'part' : d < S.today ? 'miss' : '';
      row += `<div class="cell${tc}"><div class="circ click ${cls}" style="--p:${Math.round((k / ts.length) * 100)}%" data-d="${d}" data-c="${esc(c)}" title="${esc(fmt(d, { weekday: 'short', day: 'numeric', month: 'short' }))}\n${ts.map(t => (t.done ? '✓ ' : '○ ') + t.label).join('\n')}"></div></div>`;
    }
    const pc = tot ? Math.round((dn / tot) * 100) : 0, sk = habitStreak(c);
    row += `<div class="hstat"><span>${tot ? pc + '%' : '–'}</span><span style="color:${sk ? '#ffc56b' : 'var(--dim)'}">${sk}</span><span class="mint">${dn}</span></div>`;
    g += `<div class="hrow">${row}</div><div class="hline"></div>`;
  }
  g += '</div>';
  const label = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  $('#main').innerHTML = `<div class="page">
    <div class="ph"><div><h1>Habits</h1><div class="sub">Monthly summary · every block from your Routine notes, grouped by type</div></div><div class="sp"></div>
      <div class="pill"><button id="mp">‹</button><span>${esc(label)}</span><button id="mn">›</button></div></div>
    <div class="card hab">${cats.length ? g : '<div class="empty">No notes this month.</div>'}
      <div class="legendrow"><span><span class="circ full"></span>all done</span><span><span class="circ part" style="--p:50%"></span>some done</span><span><span class="circ miss"></span>missed</span><span><span class="circ nonote"></span>no note that day</span><span><span class="circ off" style="width:5px;height:5px"></span>not scheduled</span><span class="dim">🔥 = days in a row fully done · ✓ = ticks this month · click a circle to tick</span></div></div></div>`;
  $('#mp').onclick = () => { const d = new Date(y, m - 2, 1); V.month = iso(d).slice(0, 7); render(); };
  $('#mn').onclick = () => { const d = new Date(y, m, 1); V.month = iso(d).slice(0, 7); render(); };
  document.querySelectorAll('.circ.click').forEach(el => el.onclick = () => habitClick(el.dataset.d, el.dataset.c));
}
// a habit cell may hold several tasks (e.g. two Read blocks): tick the next undone one; if all done, untick all
async function habitClick(d, c) {
  if (busy) return; busy = true;
  try {
    const ts = tasksOf(d).filter(t => t.cat === c);
    const next = ts.find(t => !t.done);
    if (next) await setDone(d, next, true);
    else for (const t of ts) { const cur = tasksOf(d).find(x => x.text === t.text); if (cur) await setDone(d, cur, false); }
    render();
  } catch (e) { toast('Could not save to Obsidian', e.message, 'err'); await load(true); }
  busy = false;
}

// ---------- WEEK ----------
function renderWeek() {
  const days = range(V.week, 7), end = days[6];
  const pcts = days.map(d => (has(d) ? pctOf(tasksOf(d)) : null));
  const wAvg = avgDays(days);
  const bars = days.map((d, i) => `<div class="b ${d === S.today ? 'tod' : ''}"><div class="tr" title="${d}: ${pcts[i] ?? '–'}%"><i style="height:${pcts[i] ?? 0}%"></i></div><div class="lb">${esc(fmt(d, { weekday: 'short' }))}</div></div>`).join('');
  // 8-week trend: overall vs study vs everything else
  const wks = Array.from({ length: 8 }, (_, i) => add(V.week, -7 * (7 - i)));
  const ser = [
    { n: 'Overall', c: '#3ce6b0', v: wks.map(w => avgDays(range(w, 7))) },
    { n: 'Study', c: '#a78bfa', v: wks.map(w => avgDays(range(w, 7), t => STUDY.has(t.cat))) },
    { n: 'Routine', c: '#f05d5d', v: wks.map(w => avgDays(range(w, 7), t => !STUDY.has(t.cat))) },
  ];
  const cols = days.map(d => {
    const ts = tasksOf(d), p = has(d) ? pctOf(ts) : null;
    const body = has(d)
      ? (ts.length ? ts.map((t, i) => `<div class="witem ${t.done ? 'done' : ''}" data-d="${d}" data-i="${i}"><div class="ck">${CHECK}</div><div><span class="wl">${esc(t.label)}</span>${t.start != null ? `<span class="wt">${fmtMin(t.start)}</span>` : ''}</div></div>`).join('') : '<div class="none">No checkboxes</div>')
      : `<div class="none">${d < S.today ? 'No note · missed' : 'No note yet'}<div style="margin-top:10px"><button class="btn" data-create="${d}">Create</button></div></div>`;
    return `<div class="wday ${d === S.today ? 'tod' : ''}"><div class="dn">${esc(fmt(d, { weekday: 'long' }))}</div><div class="dd">${esc(fmt(d, { day: '2-digit', month: '2-digit', year: 'numeric' }))}</div>
      ${ring(p, 92, 8)}<div class="cap">Tasks</div>${body}</div>`;
  }).join('');
  $('#main').innerHTML = `<div class="page">
    <div class="ph"><div><h1>Task tracker</h1><div class="sub">Week view · tick here or in Obsidian</div></div><div class="sp"></div>
      <div class="pill"><button id="wp">‹</button><span>${esc(fmt(V.week, { day: '2-digit', month: 'short' }))} – ${esc(fmt(end, { day: '2-digit', month: 'short', year: 'numeric' }))}</span><button id="wn">›</button></div>
      ${V.week !== monday(S.today) ? '<button class="btn" id="wt">This week</button>' : ''}</div>
    <div class="wtop">
      <div class="card"><div class="cap">Overall progress</div><div style="display:flex;gap:26px;align-items:center"><div class="wbars" style="flex:1">${bars}</div>
        <div style="text-align:center">${ring(wAvg, 130, 11)}<div class="mut" style="font-size:12px;margin-top:8px">week average</div></div></div></div>
      <div class="card"><div style="display:flex;align-items:center"><div class="cap">Weekly trend · 8 weeks</div><div style="flex:1"></div>
        ${ser.map(s => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--mut);margin-left:12px"><span class="dot" style="background:${s.c}"></span>${s.n}</span>`).join('')}</div>
        ${multiLine(ser, wks.map(w => fmt(w, { day: 'numeric', month: 'short' })))}</div>
    </div>
    <div class="wdays">${cols}</div></div>`;
  $('#wp').onclick = () => { V.week = add(V.week, -7); render(); };
  $('#wn').onclick = () => { V.week = add(V.week, 7); render(); };
  if ($('#wt')) $('#wt').onclick = () => { V.week = monday(S.today); render(); };
  document.querySelectorAll('[data-create]').forEach(b => b.onclick = () => createNote(b.dataset.create));
  document.querySelectorAll('.witem').forEach(el => el.onclick = () => { el.classList.toggle('done'); toggleOne(el.dataset.d, tasksOf(el.dataset.d)[+el.dataset.i]); });
}

// ---------- INSIGHTS ----------
const heatCol = p => p == null ? '#0f1314' : p >= 100 ? '#3ce6b0' : p >= 75 ? '#2bb88c' : p >= 50 ? '#1f8a69' : p >= 25 ? '#175c47' : p > 0 ? '#11392d' : '#2a1416';
function renderInsights() {
  const st = S.stats, N = V.range, dates = range(add(S.today, -(N - 1)), N);
  const all = new Set(); for (const d of Object.keys(S.notes)) for (const t of tasksOf(d)) all.add(t.cat);
  const cats = [...all].sort();
  const hf = V.habit === 'All' ? () => true : t => t.cat === V.habit;
  const series = dates.map(d => {
    let v = null;
    if (has(d)) { v = pctOf(tasksOf(d).filter(hf)); }
    else if (d < S.today && V.habit === 'All') v = 0;
    else if (d < S.today) v = 0;
    return { x: fmt(d, { day: 'numeric', month: 'short' }), v };
  });
  const vals = series.map(s => s.v).filter(v => v != null);
  const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  const wk = range(monday(S.today), 7), lwk = range(add(monday(S.today), -7), 7);
  const tw = avgDays(wk, hf) ?? 0, lw = avgDays(lwk, hf) ?? 0, dl = tw - lw;
  // leaderboard over the range
  const lead = cats.map(c => { const ts = dates.flatMap(d => tasksOf(d).filter(t => t.cat === c)); return { c, n: ts.length, p: pctOf(ts) ?? 0 }; }).filter(x => x.n).sort((a, b) => b.p - a.p || b.n - a.n);
  const streaks = cats.map(c => ({ c, s: habitStreak(c) })).sort((a, b) => b.s - a.s).slice(0, 6);
  // study hours per week
  const W = st.weeks.slice(-8), mx = Math.max(1, ...W.map(w => Math.max(w.studyPlannedH, w.studyDoneH)));
  let sh = `<svg viewBox="0 0 520 170" width="100%">`;
  for (const g of [0, .5, 1]) { const y = 6 + 140 * (1 - g); sh += `<line x1="30" x2="520" y1="${y}" y2="${y}" stroke="#151a1b"/><text x="0" y="${y + 3.5}">${Math.round(mx * g)}h</text>`; }
  W.forEach((w, i) => { const bw = 490 / W.length, x = 34 + i * bw + bw * .2, a = 140 * (w.studyPlannedH / mx), b = 140 * (w.studyDoneH / mx);
    sh += `<rect x="${x}" y="${146 - a}" width="${bw * .6}" height="${a}" rx="5" fill="#141919"><title>planned ${w.studyPlannedH}h</title></rect><rect x="${x}" y="${146 - b}" width="${bw * .6}" height="${b}" rx="5" fill="#3ce6b0" class="glow"><title>done ${w.studyDoneH}h</title></rect><text x="${x + bw * .3}" y="164" text-anchor="middle">${esc(w.week)}</text>`; });
  sh += '</svg>';
  // heatmap, 53 weeks
  const first = Object.keys(S.notes).sort()[0] || S.today;
  let start = monday(first); const minStart = add(monday(S.today), -52 * 7), maxStart = add(monday(S.today), -25 * 7);
  if (start < minStart) start = minStart; if (start > maxStart) start = maxStart;
  const nW = Math.round((D(monday(S.today)) - D(start)) / 6048e5) + 1;
  let heat = '';
  for (let w = 0; w < nW; w++) {
    const ws = add(start, w * 7), dd = D(ws);
    let col = `<div class="mo">${dd.getDate() <= 7 ? esc(fmt(ws, { month: 'short' })) : ''}</div>`;
    for (let i = 0; i < 7; i++) {
      const d = add(ws, i);
      if (d > S.today || d < first) col += `<div class="c out"></div>`;
      else if (!has(d)) col += `<div class="c none" title="${d}: no note"></div>`;
      else { const p = pctOf(tasksOf(d)); col += `<div class="c ${d === S.today ? 'tod' : ''}" style="background:${heatCol(p)}" title="${d}: ${p ?? 0}%"></div>`; }
    }
    heat += `<div class="col">${col}</div>`;
  }
  const hb = (arr, sub) => arr.map(x => `<div class="hb"><span>${esc(x.key)}</span><div class="tr"><i style="width:${x.pct}%"></i></div><span class="n">${x.pct}%${sub ? ` <span class="dim" style="font-family:Inter;font-size:11px">${sub(x)}</span>` : ''}</span></div>`).join('');

  $('#main').innerHTML = `<div class="page">
    <div class="ph"><div><h1>Insights</h1><div class="sub">Read from every note in your Routine folder</div></div></div>
    <div class="card ihero"><div class="top2"><div><div class="cap">${V.habit === 'All' ? 'Overall consistency' : esc(V.habit)}</div><div class="big" style="margin-top:8px">${avg}%</div><div class="mut" style="margin-top:4px">average over the last ${N} days</div></div><div class="sp"></div>
      <div style="display:grid;gap:10px;justify-items:end"><div class="seg" id="rng">${[7, 30, 90].map(r => `<button data-r="${r}" class="${r === N ? 'on' : ''}">${r}D</button>`).join('')}</div>
      <div class="chips" id="hab">${['All', ...cats].map(c => `<button data-h="${esc(c)}" class="${c === V.habit ? 'on' : ''}">${c !== 'All' ? `<span class="dot" style="background:${CAT_COL[c] || CAT_COL.Other}"></span>` : ''}${esc(c)}</button>`).join('')}</div></div></div>
      ${area(series, { labelEvery: N <= 7 ? 1 : N <= 30 ? 5 : 15, id: 'ia' })}</div>
    <div class="i3">
      <div class="card"><div class="cap">This week</div><div class="mid" style="margin-top:10px">${tw}%</div></div>
      <div class="card"><div class="cap">vs last week</div><div class="mid ${dl >= 0 ? 'mint' : 'red'}" style="margin-top:10px">${dl >= 0 ? '+' : ''}${dl}%</div><div class="mut" style="font-size:12px">last week ${lw}%</div></div>
      <div class="card"><div class="cap">Streak</div><div class="mid" style="margin-top:10px">🔥 ${st.currentStreak}</div><div class="mut" style="font-size:12px">best ${st.bestStreak} · a day counts at ${st.threshold}%+</div></div>
    </div>
    <div class="i2">
      <div class="card lead"><div class="cap" style="margin-bottom:6px">Habit leaderboard · ${N} days</div>
        ${lead.map((x, i) => `<div class="row"><span class="rk">${i + 1}</span><span style="display:flex;gap:8px;align-items:center"><span class="dot" style="background:${CAT_COL[x.c] || CAT_COL.Other}"></span>${esc(x.c)}</span><div class="tr"><i style="width:${x.p}%"></i></div><span class="pc">${x.p}%</span></div>`).join('') || '<div class="mut">No data</div>'}</div>
      <div class="card"><div class="cap" style="margin-bottom:6px">Running streaks</div>
        ${streaks.map(x => `<div class="kv"><span style="display:flex;gap:8px;align-items:center"><span class="dot" style="background:${CAT_COL[x.c] || CAT_COL.Other}"></span>${esc(x.c)}</span><b style="color:${x.s ? '#ffc56b' : 'var(--dim)'}">🔥 ${x.s}</b></div>`).join('')}</div>
    </div>
    <div class="i2b">
      <div class="card"><div class="cap" style="margin-bottom:8px">Study hours per week · done vs planned</div>${sh}</div>
      <div class="card"><div class="cap">When you follow through · all time</div>${hb(st.timeOfDay, x => `${x.done}/${x.total}`)}<div style="height:8px"></div>${hb(st.weekday, x => `${x.days}d`)}</div>
    </div>
    <div class="card"><div class="cap" style="margin-bottom:10px">Consistency · every day since your first note</div><div class="heat" style="grid-template-columns:22px repeat(${nW},16px)"><div class="col"><div class="mo"></div>${['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map(x => `<div class="dl">${x}</div>`).join('')}</div>${heat}</div>
      <div class="hlegend">Less ${[0, 10, 30, 60, 80, 100].map(p => `<i style="background:${heatCol(p)}"></i>`).join('')} More<span style="margin-left:14px">outlined = no note that day</span></div></div>
    <div class="mut" style="font-size:12px;margin-top:14px">${st.totals.tasksDone} tasks ticked · ${st.totals.studyH} study hours · ${st.totals.perfectDays} perfect day${st.totals.perfectDays === 1 ? "" : "s"} · ${st.totals.daysLogged} notes over ${st.totals.daysTracked} days</div>
  </div>`;
  document.querySelectorAll('#rng button').forEach(b => b.onclick = () => { V.range = +b.dataset.r; render(); });
  document.querySelectorAll('#hab button').forEach(b => b.onclick = () => { V.habit = b.dataset.h; render(); });
}

// ---------- SETTINGS ----------
function renderSettings() {
  const c = S.config, T = S.templates, setup = !!S.needsSetup;
  const opt = (v, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(tplName(v))}</option>`;
  const vaultField = `<div class="field"><label>Obsidian vault<small>The folder that contains <code>.obsidian</code>. Paste it from Explorer's address bar.</small></label><input type="text" id="s_vault" placeholder="C:/Users/you/Documents/My Vault" value="${esc(c.vault)}"></div>`;
  if (setup) {
    $('#main').innerHTML = `<div class="page"><div class="ph"><div><h1>Set up Grind</h1><div class="sub">Grind reads and writes your Obsidian notes. Nothing leaves this computer.</div></div></div>
      <div class="card set"><div class="note warn">${esc(S.setupReason || 'Choose your Obsidian vault')}</div>${vaultField}
      <div style="margin-top:16px"><button class="btn solid" id="s_save">Use this vault</button></div></div></div>`;
    $('#s_save').onclick = async () => {
      try { S = await api('/api/config', { vault: $('#s_vault').value.trim() }); if (!S.needsSetup) { V.tab = 'today'; V.date = S.today; V.month = S.today.slice(0, 7); V.week = monday(S.today); } render(); if (!S.needsSetup) toast('Vault connected', S.vaultName, 'ok'); }
      catch (e) { toast('That folder is not an Obsidian vault', e.message, 'err'); }
    };
    return;
  }
  const auto = `<option value="" ${!c.template ? 'selected' : ''}>Auto${S.activeTemplate ? ` (${esc(tplName(S.activeTemplate))})` : ''}</option>`;
  $('#main').innerHTML = `<div class="page"><div class="ph"><div><h1>Settings</h1></div></div><div class="card set">
    ${vaultField}
    <div class="field"><label>Daily template<small>Templater template used to create the day's note when you open the app. Auto = the vault's Daily Notes template, else one with "daily" in its name</small></label><select id="s_tpl">${auto}${T.map(t => opt(t, c.template)).join('')}</select></div>
    <div class="field"><label>Fallback template<small>Used when the main one gives no checkboxes for that date</small></label><select id="s_fb"><option value="">(none)</option>${T.map(t => opt(t, c.fallbackTemplate)).join('')}</select></div>
    <div class="field"><label>Preview<small>What the template produces for today</small></label><div><button class="btn" id="s_prev">Render preview</button><div id="prevOut"></div></div></div>
    <div class="field"><label>Streak bar<small>% of a day's tasks needed for it to count</small></label><input type="number" id="s_thr" min="1" max="100" value="${c.streakThreshold}" style="width:100px"></div>
    <div class="field"><label>Day ends at<small>Before this hour still counts as the previous day</small></label><select id="s_roll" style="width:160px">${Array.from({ length: 12 }, (_, h) => `<option value="${h}" ${h === +c.rolloverHour ? 'selected' : ''}>${h === 0 ? 'Midnight' : h + ':00 AM'}</option>`).join('')}</select></div>
    <div class="field"><label>Stats start date<small>Ignore notes before this (blank = all)</small></label><input type="text" id="s_start" placeholder="YYYY-MM-DD" value="${esc(c.startDate)}" style="width:160px"></div>
    <div class="field"><label>Topic checklists folder<small>Notes named *checklist*.md in this vault folder</small></label><input type="text" id="s_cl" value="${esc(c.checklistFolder)}" style="width:200px"></div>
    <div class="field"><label>Revise after<small>Days after a topic's last #studied / #practised date before #revise is added</small></label><div><input type="number" id="s_rev" min="1" max="365" value="${c.reviseAfterDays}" style="width:100px"> <span class="mut">days</span></div></div>
    <div class="field"><label>Link routine to topics<small>Ticking a routine task that names a topic (e.g. "Chem 25.1 past Qs") marks it #practised</small></label><label style="font-weight:400"><input type="checkbox" id="s_link" ${c.routineToTopics ? 'checked' : ''}> On</label></div>
    <div style="margin-top:16px"><button class="btn solid" id="s_save">Save</button></div>
    <div class="field" style="margin-top:22px;border-top:1px solid var(--line)"><label>Rebuild a day's note<small>Re-renders it from the template. Ticks on unchanged tasks are kept; the old file is saved as .md.bak</small></label>
      <div style="display:flex;gap:8px"><input type="text" id="s_rdate" value="${S.today}" style="width:150px"><button class="btn warn" id="s_regen">Rebuild</button></div></div>
  </div></div>`;
  const val = () => ({ template: $('#s_tpl').value, fallbackTemplate: $('#s_fb').value, streakThreshold: +$('#s_thr').value, rolloverHour: +$('#s_roll').value, startDate: $('#s_start').value.trim(), vault: $('#s_vault').value.trim(), checklistFolder: $('#s_cl').value.trim(), reviseAfterDays: +$('#s_rev').value, routineToTopics: $('#s_link').checked });
  const tplOf = () => $('#s_tpl').value || S.activeTemplate;
  $('#s_save').onclick = async () => { try { S = await api('/api/config', val()); render(); toast('Saved', '', 'ok'); } catch (e) { toast('Save failed', e.message, 'err'); } };
  $('#s_prev').onclick = async () => {
    try { const r = await api('/api/preview', { template: tplOf(), date: S.today }); $('#prevOut').innerHTML = `<div class="mut" style="margin-top:10px">Using <b>${esc(tplName(r.used))}</b> · ${r.tasks.length} tasks</div><div class="prev">${esc(r.content)}</div>`; }
    catch (e) { $('#prevOut').innerHTML = `<div class="note err" style="margin-top:10px">${esc(e.message)}</div>`; }
  };
  $('#s_regen').onclick = async () => {
    const d = $('#s_rdate').value.trim();
    if (!confirm(`Rebuild ${d} from "${tplName(tplOf())}"? Ticks on unchanged tasks are kept; a .bak copy is saved.`)) return;
    try { await api('/api/config', val()); S = await api('/api/regenerate', { date: d, template: tplOf() }); V.tab = 'today'; V.date = d; render(); toast('Rebuilt', d, 'ok'); } catch (e) { toast('Rebuild failed', e.message, 'err'); }
  };
}

function render() {
  if (!S) return;
  if (S.needsSetup) V.tab = 'settings'; // nothing to show until a vault is chosen
  renderTop();
  ({ today: renderToday, habits: renderHabits, week: renderWeek, topics: renderTopics, insights: renderInsights, settings: renderSettings })[V.tab]();
}

// ---------- wiring ----------
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { V.tab = b.dataset.tab; render(); $('#main').scrollTop = 0; });
$('#quit').onclick = async () => { try { await api('/api/quit'); } catch {} window.close(); };
addEventListener('keydown', e => {
  if (e.target.matches('input,select') || !S) return;
  const k = { 1: 'today', 2: 'habits', 3: 'week', 4: 'topics', 5: 'insights' }[e.key];
  if (k) { V.tab = k; render(); }
  if (V.tab === 'today' && e.key === 'ArrowLeft') { V.date = add(V.date, -1); render(); }
  if (V.tab === 'today' && e.key === 'ArrowRight' && V.date < add(S.today, 7)) { V.date = add(V.date, 1); render(); }
});
// heartbeat: the server exits shortly after this window closes
setInterval(() => fetch('/api/ping').catch(() => {}), 3000); fetch('/api/ping').catch(() => {});
// pick up ticks made in Obsidian, keep NOW/LATE markers fresh
const quiet = () => S && !busy && V.tab !== 'settings' && !document.querySelector('input:focus,select:focus');
addEventListener('focus', () => { if (quiet()) load(true); });
setInterval(() => { if (quiet() && document.visibilityState === 'visible') load(true); }, 30000);
load();
