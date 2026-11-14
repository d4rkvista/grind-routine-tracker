'use strict';
/* Grind: Topics page. Data = the Exams/*checklist*.md lines and their tags (see lib/checklists.js). */
const ST = { revise: 'Revise', practice: 'Needs practice', practised: 'Practised', ontrack: 'Being taught', unstudied: 'Not taught', done: 'Completed', none: 'No tag' };
const ST_COL = { revise: '#f2b33d', practice: '#5b9cff', practised: '#3ce6b0', ontrack: '#a78bfa', unstudied: '#f05d5d', done: '#c7cfcc', none: '#2a3130' };
const ST_ORDER = ['revise', 'practice', 'practised', 'ontrack', 'unstudied', 'none', 'done'];
const SUBJ_COL = { Chemistry: '#3ce6b0', Physics: '#a78bfa', Mathematics: '#5b9cff', 'Computer Science': '#f472b6' };
const ACT_DONE = { practised: 'Marked practised', studied: 'Marked taught', ontrack: 'Marked being taught', unstudied: 'Marked not taught', revise: 'Added to revision', unrevise: 'Removed from revision', done: 'Marked completed', undone: 'Marked not completed' };
const pillSt = s => `<span class="st ${s}"><i></i>${ST[s]}</span>`;
const sd = d => (d ? fmt(d, { day: 'numeric', month: 'short' }) : '');
const ago = d => { if (!d) return ''; const n = Math.round((D(S.today) - D(d)) / 864e5); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n}d ago`; };
function revInfo(t) {
  if (t.revise !== null) return `<span class="soon">due${t.revise ? ' since ' + sd(t.revise) : ''}</span>`;
  if (!t.last) return '<span class="dim">—</span>';
  const left = (S.config.reviseAfterDays || 14) - Math.round((D(S.today) - D(t.last)) / 864e5);
  return left <= 3 ? `<span class="soon">in ${Math.max(left, 0)}d</span>` : `<span class="mut">in ${left}d</span>`;
}
const visTopics = () => (S.topics || []).filter(t => V.tAS || !t.isAS);

// small card on the Today page
function revCard() {
  const due = visTopics().filter(t => t.status === 'revise').sort((a, b) => ((a.last || '') < (b.last || '') ? -1 : 1));
  if (!due.length) return '';
  return `<div class="card revlist"><div style="display:flex;align-items:center"><div class="cap">Due for revision · ${due.length}</div><div style="flex:1"></div><button class="btn" id="allrev" style="padding:3px 9px;font-size:11.5px">All</button></div>
    ${due.slice(0, 5).map(t => `<div class="ri"><span class="dot" style="background:${SUBJ_COL[t.subject] || '#7b8582'}"></span><div class="x"><b>${esc(t.short)} ${esc(t.title)}</b><small>${t.last ? 'last ' + ago(t.last) : 'tagged #revise'}</small></div><button class="btn" data-rev="${esc(t.id)}">Revised</button></div>`).join('')}</div>`;
}

function primaryAction(t) {
  switch (t.status) {
    case 'revise': return ['practised', 'Revised'];
    case 'practice': return ['practised', 'Practised'];
    case 'practised': return ['practised', 'Practised again'];
    case 'ontrack': case 'unstudied': case 'none': return ['studied', 'Taught'];
    default: return null;
  }
}

function renderTopics() {
  const all = visTopics(), subjects = [...new Set(all.map(t => t.subject))];
  const inSub = all.filter(t => V.tsub === 'All' || t.subject === V.tsub);
  const cnt = s => inSub.filter(t => t.status === s).length;
  const q = V.tq.trim().toLowerCase();
  const rows = inSub.filter(t => (V.tstat === 'all' || t.status === V.tstat) && (!q || t.title.toLowerCase().includes(q) || t.section.toLowerCase().includes(q)));
  if (V.tstat !== 'all') rows.sort((a, b) => ((a.last || '9') < (b.last || '9') ? -1 : 1));

  const sumCard = (s, label, sub) => `<div class="card ${V.tstat === s ? 'on' : ''}" data-ts="${s}"><div class="cap">${label}</div><div class="mid" style="margin-top:8px;color:${ST_COL[s]}">${cnt(s)}</div><div class="mut" style="font-size:12px">${sub}</div></div>`;
  const subjCards = subjects.map(sb => {
    const ts = all.filter(t => t.subject === sb), n = ts.length || 1;
    const seg = ST_ORDER.map(s => { const k = ts.filter(t => t.status === s).length; return k ? `<i style="width:${(k / n) * 100}%;background:${ST_COL[s]}" title="${ST[s]}: ${k}"></i>` : ''; }).join('');
    const covered = ts.filter(t => ['revise', 'practice', 'practised', 'done'].includes(t.status)).length;
    return `<div class="card ${V.tsub === sb ? 'on' : ''}" style="cursor:pointer" data-sb="${esc(sb)}"><div style="display:flex;align-items:baseline"><div class="h" style="font-weight:700;font-size:15px">${esc(sb)}</div><div style="flex:1"></div><b class="num">${Math.round((covered / n) * 100)}%</b></div>
      <div class="stack">${seg}</div><div class="slegend"><span>${covered}/${ts.length} covered</span><span>${ts.filter(t => t.status === 'revise').length} to revise</span><span>${ts.filter(t => t.status === 'done').length} completed</span></div></div>`;
  }).join('');

  let body = '', lastG = '';
  for (const t of rows) {
    const g = V.tstat === 'all' ? `${t.subject}|${t.section}` : '';
    if (g && g !== lastG) { body += `<tr class="grp"><td colspan="7"><span class="g1">${esc(t.subject)}</span><span class="g2">${esc(t.section)}</span></td></tr>`; lastG = g; }
    const pa = primaryAction(t);
    const opts = [['', '⋯'], ['studied', 'Taught (today)'], ['practised', 'Practised (today)'], ['revise', 'Add to revision'], ['unrevise', 'Remove from revision'], ['ontrack', 'Being taught'], ['unstudied', 'Not taught'], [t.done ? 'undone' : 'done', t.done ? 'Not completed' : 'Completed']];
    body += `<tr class="row ${t.done ? 'isdone' : ''}"><td style="width:30px"><div class="ck ${t.done ? 'on' : ''}" data-cmp="${esc(t.id)}" title="Completed = you can do past-paper questions on it unaided">${CHECK}</div></td>
      <td><span class="tt">${esc(t.title)}</span>${V.tstat !== 'all' ? `<div class="mut" style="font-size:11.5px">${esc(t.subject)} · ${esc(t.section)}</div>` : ''}</td>
      <td>${pillSt(t.status)}</td><td class="dt">${t.studied ? sd(t.studied) : ''}</td>
      <td class="dt">${t.practised ? `${sd(t.practised)} <span class="dim">· ${ago(t.practised)}</span>` : ''}</td><td class="dt">${revInfo(t)}</td>
      <td><div class="acts">${pa ? `<button class="btn ${t.status === 'revise' ? 'solid' : ''}" data-act="${pa[0]}" data-id="${esc(t.id)}">${pa[1]}</button>` : ''}<select data-menu="${esc(t.id)}" title="More">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div></td></tr>`;
  }

  $('#main').innerHTML = `<div class="page">
    <div class="ph"><div><h1>Topics</h1><div class="sub">From your Exams checklists · a topic gets <b>#revise</b> automatically ${S.config.reviseAfterDays} days after its last #studied / #practised date</div></div></div>
    <div class="tsum">${sumCard('revise', 'Due for revision', 'oldest first')}${sumCard('practice', 'Needs practice', '#studied · #practice · #examtechnique')}${sumCard('ontrack', 'Being taught', '#ontrack')}${sumCard('done', 'Completed', `of ${inSub.length} topics`)}</div>
    <div class="subj">${subjCards}</div>
    <div class="tctl"><div class="chips" id="tsub" style="justify-content:flex-start">${['All', ...subjects].map(c => `<button data-v="${esc(c)}" class="${c === V.tsub ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>
      <div class="seg" id="tstat">${['all', ...ST_ORDER].map(s => `<button data-v="${s}" class="${s === V.tstat ? 'on' : ''}">${s === 'all' ? 'All' : ST[s]}${s === 'all' ? '' : ` <span class="dim">${cnt(s)}</span>`}</button>`).join('')}</div>
      <div style="flex:1"></div><label class="mut" style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" id="tas" ${V.tAS ? 'checked' : ''}> AS topics</label><input type="search" id="tq" placeholder="Search topics" value="${esc(V.tq)}"></div>
    <div class="card" style="padding:4px 10px 10px">${rows.length ? `<table class="ttable"><thead><tr><th></th><th>Topic</th><th>Status</th><th>Taught</th><th>Last practised</th><th>Revision</th><th></th></tr></thead><tbody>${body}</tbody></table>` : '<div class="empty">Nothing here.</div>'}</div>
  </div>`;

  document.querySelectorAll('[data-ts]').forEach(c => c.onclick = () => { V.tstat = V.tstat === c.dataset.ts ? 'all' : c.dataset.ts; render(); });
  document.querySelectorAll('[data-sb]').forEach(c => c.onclick = () => { V.tsub = V.tsub === c.dataset.sb ? 'All' : c.dataset.sb; render(); });
  document.querySelectorAll('#tsub button').forEach(b => b.onclick = () => { V.tsub = b.dataset.v; render(); });
  document.querySelectorAll('#tstat button').forEach(b => b.onclick = () => { V.tstat = b.dataset.v; render(); });
  $('#tas').onchange = e => { V.tAS = e.target.checked; render(); };
  $('#tq').oninput = e => { V.tq = e.target.value; const pos = e.target.selectionStart; render(); const el = $('#tq'); el.focus(); el.setSelectionRange(pos, pos); };
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => topicAction([b.dataset.id], b.dataset.act));
  document.querySelectorAll('[data-menu]').forEach(sel => sel.onchange = () => { if (sel.value) topicAction([sel.dataset.menu], sel.value); });
  document.querySelectorAll('[data-cmp]').forEach(c => c.onclick = () => { const t = S.topics.find(x => x.id === c.dataset.cmp); topicAction([t.id], t.done ? 'undone' : 'done'); });
}
