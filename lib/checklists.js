'use strict';
// Academic topics, read from and written to the exam checklists in the vault (Exams/*checklist*.md).
// One checklist line = one topic. State lives in tags on the line, dated like the overview asks:
//   #unstudied              not covered yet (can also sit on a ## heading and apply to every line under it)
//   #ontrack                being taught in class now
//   #studied (YYYY-MM-DD)   taught / studied on that date -> needs practice
//   #practice               content known, needs question volume -> needs practice
//   #examtechnique          ability there, exam format is the gap -> needs practice
//   #practised (YYYY-MM-DD) last practised / revised on that date
//   #revise (YYYY-MM-DD)    needs revision; added automatically once the studied/practised date is old enough
//   [x]                     completed
const fs = require('fs');
const path = require('path');
const moment = require('moment');

const F = 'YYYY-MM-DD';
const TASK = /^(\s*[-*+]\s+)\[([^\]])\]\s+(.*)$/;
const TAGS = ['unstudied', 'ontrack', 'studied', 'practice', 'practised', 'revise', 'examtechnique'];
const TAG_RE = /#(unstudied|ontrack|studied|practice|practiced|practised|revise|examtechnique)\b(?:\s*\((\d{4}-\d{2}-\d{2})\))?/gi;
const SUBJECTS = [
  { key: 'Chemistry', short: 'Chem', re: /\bchem(?:istry)?\b/i, code: '9701' },
  { key: 'Physics', short: 'Phy', re: /\bphy(?:s|sics)?\b/i, code: '9702' },
  { key: 'Mathematics', short: 'Maths', re: /\bmaths?\b|\bmathematics\b/i, code: '9709' },
  { key: 'Computer Science', short: 'CS', re: /\bcs\b|\bcomputer science\b/i, code: '9618' },
];
const STATUS_ORDER = ['revise', 'practice', 'practised', 'ontrack', 'unstudied', 'none', 'done'];

function readTags(text) {
  const tags = {};
  for (const m of text.matchAll(TAG_RE)) {
    let k = m[1].toLowerCase(); if (k === 'practiced') k = 'practised';
    if (!(k in tags) || (m[2] && (!tags[k] || m[2] > tags[k]))) tags[k] = m[2] || tags[k] || null;
  }
  return tags;
}
const stripTags = text => text.replace(TAG_RE, '').replace(/\s{2,}/g, ' ').trim();

function checklistFiles(vault, folder) {
  const dir = path.join(vault, folder || 'Exams');
  let fs_ = [];
  try { fs_ = fs.readdirSync(dir).filter(f => /checklist.*\.md$/i.test(f)); } catch { return []; }
  return fs_.map(f => path.join(dir, f));
}
function subjectOfFile(abs, content) {
  const b = path.basename(abs);
  return SUBJECTS.find(s => b.includes(s.code)) || SUBJECTS.find(s => s.re.test(b)) || SUBJECTS.find(s => s.re.test(content.slice(0, 400))) || null;
}

function statusOf(done, tags, inherited) {
  if (tags.revise !== undefined) return 'revise';
  if (done) return 'done';
  if (tags.practised !== undefined) return 'practised';
  if (tags.studied !== undefined || tags.practice !== undefined || tags.examtechnique !== undefined) return 'practice';
  if (tags.ontrack !== undefined) return 'ontrack';
  if (tags.unstudied !== undefined || inherited.unstudied !== undefined) return 'unstudied';
  if (inherited.ontrack !== undefined) return 'ontrack';
  if (inherited.examtechnique !== undefined || inherited.practice !== undefined) return 'practice';
  return 'none';
}

function parseFile(vault, abs) {
  const content = fs.readFileSync(abs, 'utf8');
  const sub = subjectOfFile(abs, content);
  const rel = path.relative(vault, abs).replace(/\\/g, '/');
  const lines = content.split(/\r?\n/);
  const out = [];
  let section = '', secTags = {}, inFront = lines[0] === '---';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (inFront) { if (i > 0 && l === '---') inFront = false; continue; }
    const h = l.match(/^#{1,6}\s+(.*)$/);
    if (h) { section = stripTags(h[1]); secTags = readTags(h[1]); continue; }
    const m = l.match(TASK);
    if (!m) continue;
    const done = /x/i.test(m[2]);
    const text = m[3];
    const tags = readTags(text);
    const title = stripTags(text);
    const nm = title.match(/^(\d+(?:\.\d+)?)(?:\s*[–-]\s*\d+(?:\.\d+)?)?\s+/);
    const isAS = /assumed from as|\bAS\b/i.test(section) && !/A Level/i.test(section);
    const last = [tags.studied, tags.practised].filter(Boolean).sort().pop() || null;
    out.push({
      id: `${rel}#${i}`, file: rel, line: i, raw: text, done, title, num: nm ? nm[1] : null,
      name: nm ? title.slice(nm[0].length) : title, section, isAS,
      subject: sub ? sub.key : 'Other', short: sub ? sub.short : '?',
      tags, studied: tags.studied || null, practised: tags.practised || null, revise: tags.revise === undefined ? null : (tags.revise || ''),
      last, status: statusOf(done, tags, secTags),
    });
  }
  return out;
}

function loadTopics(vault, folder) {
  const all = [];
  for (const f of checklistFiles(vault, folder)) { try { all.push(...parseFile(vault, f)); } catch { /* unreadable file */ } }
  const rank = s => { const i = SUBJECTS.findIndex(x => x.key === s); return i < 0 ? 99 : i; };
  return all.map((t, i) => [t, i]).sort((a, b) => rank(a[0].subject) - rank(b[0].subject) || a[1] - b[1]).map(x => x[0]);
}

// ---------- line editing ----------
function editLine(vault, id, mutate) {
  const [rel, ln] = [id.slice(0, id.lastIndexOf('#')), +id.slice(id.lastIndexOf('#') + 1)];
  const abs = path.normalize(path.join(vault, rel));
  if (!abs.startsWith(path.normalize(vault)) || !fs.existsSync(abs)) throw new Error('Checklist not found: ' + rel);
  const content = fs.readFileSync(abs, 'utf8');
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const m = lines[ln] && lines[ln].match(TASK);
  if (!m) throw new Error('Topic line moved — reopen the page');
  const before = lines[ln];
  const r = mutate({ prefix: m[1], mark: m[2], text: m[3] });
  const after = `${r.prefix}[${r.mark}] ${r.text}`;
  if (after === before) return null;
  lines[ln] = after;
  fs.writeFileSync(abs, lines.join(eol));
  return { id, file: rel, line: ln, before, after };
}
const removeTags = (text, names) => text.replace(TAG_RE, (all, k) => (names.includes(k.toLowerCase() === 'practiced' ? 'practised' : k.toLowerCase()) ? '' : all)).replace(/\s{2,}/g, ' ').trimEnd();
const addTag = (text, name, date) => `${text.trimEnd()} #${name}${date ? ` (${date})` : ''}`;

// actions a user can take on a topic
function applyAction(vault, id, action, date) {
  return editLine(vault, id, l => {
    let t = l.text, mark = l.mark;
    switch (action) {
      case 'unstudied': t = addTag(removeTags(t, ['unstudied', 'ontrack', 'studied', 'practice', 'practised', 'revise', 'examtechnique']), 'unstudied'); break;
      case 'ontrack': t = addTag(removeTags(t, ['unstudied', 'ontrack', 'revise']), 'ontrack'); break;
      case 'studied': t = addTag(removeTags(t, ['unstudied', 'ontrack', 'studied']), 'studied', date); break;
      case 'practised': // also used for "revised": refreshes the date and clears #revise
        t = addTag(removeTags(t, ['unstudied', 'ontrack', 'practice', 'practised', 'revise']), 'practised', date); break;
      case 'revise': t = addTag(removeTags(t, ['revise']), 'revise', date); break;
      case 'unrevise': t = removeTags(t, ['revise']); break;
      case 'done': mark = 'x'; break;
      case 'undone': mark = ' '; break;
      default: throw new Error('Unknown action ' + action);
    }
    return { prefix: l.prefix, mark, text: t };
  });
}
function restore(vault, change) {
  const abs = path.normalize(path.join(vault, change.file));
  const content = fs.readFileSync(abs, 'utf8');
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  if (lines[change.line] !== change.after) return false;
  lines[change.line] = change.before;
  fs.writeFileSync(abs, lines.join(eol));
  return true;
}

// daily check: a topic whose latest #studied/#practised date is older than `days` gets #revise (today)
function autoRevise(vault, folder, today, days) {
  const changes = [];
  for (const t of loadTopics(vault, folder)) {
    if (!t.last || t.revise !== null) continue;
    if (moment(today, F).diff(moment(t.last, F), 'days') < days) continue;
    const c = editLine(vault, t.id, l => ({ ...l, text: addTag(l.text, 'revise', today) }));
    if (c) changes.push({ ...c, title: t.title, subject: t.subject });
  }
  return changes;
}

// ---------- routine task -> checklist lines ----------
const nv = s => s.split('.').map(Number);
const cmp = (a, b) => { const A = nv(a), B = nv(b); for (let i = 0; i < Math.max(A.length, B.length); i++) { const d = (A[i] || 0) - (B[i] || 0); if (d) return d; } return 0; };
function matchLines(label, topics) {
  const hits = new Set();
  for (const sub of SUBJECTS) {
    const m = label.match(sub.re);
    if (!m) continue;
    let rest = label.slice(m.index + m[0].length);
    for (const o of SUBJECTS) if (o !== sub) { const k = rest.search(o.re); if (k >= 0) rest = rest.slice(0, k); }
    rest = rest.replace(/\bP\s?\d\b/gi, ' ');
    const cand = topics.filter(t => t.subject === sub.key && t.num && !t.isAS);
    for (const r of rest.matchAll(/(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?/g)) {
      const a = r[1], b = r[2] || r[1];
      const exactish = x => cand.some(t => t.num === x);
      for (const t of cand) {
        const major = t.num.split('.')[0];
        let hit;
        if (!a.includes('.') && !b.includes('.')) hit = +major >= +a && +major <= +b && +b - +a <= 20;            // "26", "23-28"
        else if (a.includes('.') && (exactish(a) || exactish(b))) hit = cmp(t.num, a) >= 0 && cmp(t.num, b.includes('.') ? b : a) <= 0; // "25.1", "28.2-28.3", "3.1-3.5"
        else hit = major === a.split('.')[0] && +major === Math.floor(+a);                                       // "28.1" when the list only has "28"
        if (hit) hits.add(t.id);
      }
    }
  }
  return [...hits];
}

function summary(topics) {
  const by = {};
  for (const t of topics) {
    const s = (by[t.subject] = by[t.subject] || { subject: t.subject, short: t.short, total: 0 });
    s.total++; s[t.status] = (s[t.status] || 0) + 1;
  }
  return Object.values(by);
}

module.exports = { loadTopics, applyAction, autoRevise, matchLines, restore, summary, STATUS_ORDER, readTags, stripTags };
