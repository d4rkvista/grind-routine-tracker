'use strict';
// Statistics computed purely from the Obsidian daily notes (the notes are the source of truth).
const moment = require('moment');

const F = 'YYYY-MM-DD';
const dur = t => (t.start != null && t.end != null ? t.end - t.start : (t.study ? 60 : 0));

function computeStats(notes, today, cfg) {
  const thr = +cfg.streakThreshold || 60;
  const dates = Object.keys(notes).sort();
  let first = cfg.startDate && moment(cfg.startDate, F, true).isValid() ? cfg.startDate : dates[0] || today;
  if (first > today) first = today;

  const days = [];
  let run = 0, best = 0;
  for (let m = moment(first, F); m.format(F) <= today; m.add(1, 'day')) {
    const date = m.format(F);
    const tasks = (notes[date] || []).filter(t => !t.cancelled);
    const exists = date in notes;
    const total = tasks.length, done = tasks.filter(t => t.done).length;
    const pct = exists && total ? Math.round((done / total) * 100) : null;
    const studyPlanned = tasks.filter(t => t.study).reduce((a, t) => a + dur(t), 0);
    const studyDone = tasks.filter(t => t.study && t.done).reduce((a, t) => a + dur(t), 0);
    const qualifies = pct != null && pct >= thr;
    if (qualifies) run++;
    else if (date !== today) run = 0; // today isn't over yet: it can't break the streak
    best = Math.max(best, run);
    days.push({ date, dow: m.isoWeekday(), exists, total, done, pct, studyPlanned, studyDone, qualifies, perfect: pct === 100, streak: run });
  }
  const todayRec = days[days.length - 1];
  const todayTasks = (notes[today] || []).filter(t => !t.cancelled);
  const need = Math.max(0, Math.ceil((thr / 100) * todayTasks.length) - todayTasks.filter(t => t.done).length);

  // average daily completion; a day with no note counts as 0% (today only once it has a note)
  const avgPct = arr => { const a = arr.filter(d => d.exists || d.date !== today); return a.length ? Math.round(a.reduce((s, d) => s + (d.pct ?? 0), 0) / a.length) : 0; };
  const lastN = n => days.slice(-n);

  const weeks = [];
  const wk0 = moment(today, F).startOf('isoWeek');
  for (let i = 11; i >= 0; i--) {
    const s = wk0.clone().subtract(i, 'weeks'), e = s.clone().add(6, 'days');
    const arr = days.filter(d => d.date >= s.format(F) && d.date <= e.format(F));
    weeks.push({ start: s.format(F), week: s.format('D MMM'), pct: avgPct(arr), logged: arr.filter(d => d.exists).length,
      studyDoneH: +(arr.reduce((a, d) => a + d.studyDone, 0) / 60).toFixed(1), studyPlannedH: +(arr.reduce((a, d) => a + d.studyPlanned, 0) / 60).toFixed(1) });
  }

  const all = [];
  for (const d of days) for (const t of (notes[d.date] || []).filter(t => !t.cancelled)) all.push({ ...t, date: d.date, dow: d.dow });
  const groupBy = (arr, keyFn) => {
    const g = {};
    for (const t of arr) { const k = keyFn(t); if (k == null) continue; (g[k] = g[k] || { key: k, total: 0, done: 0 }); g[k].total++; if (t.done) g[k].done++; }
    return Object.values(g).map(x => ({ ...x, pct: Math.round((x.done / x.total) * 100) }));
  };
  const bucket = t => (t.start == null ? null : t.start < 720 ? 'Morning' : t.start < 1020 ? 'Afternoon' : 'Evening');
  const tod = groupBy(all, bucket);
  const timeOfDay = ['Morning', 'Afternoon', 'Evening'].map(k => tod.find(x => x.key === k) || { key: k, total: 0, done: 0, pct: 0 });
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekday = DOW.map((n, i) => { const arr = days.filter(d => d.dow === i + 1 && d.exists && d.date !== today); return { key: n, pct: avgPct(arr), days: arr.length }; });

  return {
    threshold: thr, days, today: todayRec, currentStreak: todayRec ? todayRec.streak : 0, bestStreak: best, need,
    last7Pct: avgPct(lastN(7)), prev7Pct: avgPct(days.slice(-14, -7)), last30Pct: avgPct(lastN(30)),
    weeks, timeOfDay, weekday,
    totals: {
      tasksDone: all.filter(t => t.done).length,
      studyH: +(all.filter(t => t.done && t.study).reduce((a, t) => a + dur(t), 0) / 60).toFixed(1),
      perfectDays: days.filter(d => d.perfect).length, daysLogged: days.filter(d => d.exists).length, daysTracked: days.length,
      streakDays: days.filter(d => d.qualifies).length,
    },
  };
}

module.exports = { computeStats };
