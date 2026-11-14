'use strict';
// Parse checkbox tasks out of daily notes and toggle them in place.
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([^\]])\]\s+(.*)$/;

const T = '(\\d{1,2})(?::(\\d{2}))?\\s*([AaPp]\\.?\\s?[Mm]\\.?)?';
const RANGE_RE = new RegExp(T + '\\s*(?:-|–|—|to)\\s*' + T, 'g');
const SINGLE_RE = /(\d{1,2})(?::(\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)(?![a-z])|(\d{1,2}):(\d{2})/g;

const mer = s => (s ? (/p/i.test(s) ? 'pm' : 'am') : null);
function toMin(h, m, md) {
  h = +h; m = +(m || 0);
  if (m > 59) return null;
  if (md) {
    if (h < 1 || h > 12) return null;
    h = md === 'am' ? h % 12 : (h % 12) + 12;
  } else {
    if (h > 23) return null;
    if (h <= 6) h += 12; // bare "4:30" in a study timetable means afternoon
  }
  return h * 60 + m;
}

function parseTime(text) {
  let best = null;
  for (const m of text.matchAll(RANGE_RE)) {
    const [all, h1, m1, a1, h2, m2, a2] = m;
    if (!(m1 || a1 || m2 || a2)) continue;
    let md1 = mer(a1), md2 = mer(a2);
    if (!md1 && md2) md1 = md2;
    if (!md2 && md1) md2 = md1;
    let s = toMin(h1, m1, md1), e = toMin(h2, m2, md2);
    if (s == null || e == null) continue;
    if (!a1 && md1 && s > e) s -= 720; // "11:00-1:00 PM" -> 11 AM
    if (a1 && md1 === 'am' && +h1 === 12 && md2 === 'pm') s = 720; // "12:00 AM-1:00 PM" typo -> noon
    if (e <= s) e += 1440;
    best = { start: s, end: e, index: m.index, length: all.length };
  }
  if (best) return best;
  for (const m of text.matchAll(SINGLE_RE)) {
    let s;
    if (m[3]) s = toMin(m[1], m[2], mer(m[3]));
    else s = toMin(m[4], m[5], null);
    if (s == null) continue;
    best = { start: s, end: null, index: m.index, length: m[0].length };
  }
  return best;
}

const CATS = [
  ['Maths', /\bmath/i],
  ['Physics', /\bphy/i],
  ['Chemistry', /\bchem/i],
  ['CS', /\bcs\b|computer|\bp4\b|programming|pseudocode/i],
  ['German', /german|deutsch/i],
  ['Cardio', /cardio|\brun\b|gym|workout|exercise|walk/i],
  ['College', /college|school|\bclass\b|lecture/i],
  ['Internship', /internship|\bwork\b|\bjob\b/i],
  ['Read', /\bread/i],
  ['Sleep', /sleep|\bbed\b/i],
  ['Church', /church|prayer|\bmass\b/i],
  ['Study', /study|revise|revision|past q|test|practice|homework/i],
];
const STUDY_CATS = new Set(['Maths', 'Physics', 'Chemistry', 'CS', 'German', 'Study']);

function categorize(text) {
  for (const [c, re] of CATS) if (re.test(text)) return c;
  return 'Other';
}

function cleanMd(s) {
  return s
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function parseTasks(content) {
  const lines = content.split(/\r?\n/);
  const tasks = [];
  let inFront = lines[0] === '---';
  for (let i = 0; i < lines.length; i++) {
    if (inFront) { if (i > 0 && lines[i] === '---') inFront = false; continue; }
    const m = lines[i].match(TASK_RE);
    if (!m) continue;
    const mark = m[2];
    const text = m[3];
    const tm = parseTime(text);
    let label = text;
    if (tm) label = (text.slice(0, tm.index) + text.slice(tm.index + tm.length)).replace(/[\s\-–—@,:(]+$/, '').trim();
    label = cleanMd(label) || cleanMd(text);
    const cat = categorize(text);
    tasks.push({
      line: i,
      text,
      label,
      cat,
      study: STUDY_CATS.has(cat),
      done: mark === 'x' || mark === 'X',
      cancelled: mark === '-',
      start: tm ? tm.start : null,
      end: tm ? tm.end : null,
    });
  }
  return tasks;
}

function toggleInContent(content, line, text, done) {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  let idx = -1;
  const m0 = lines[line] && lines[line].match(TASK_RE);
  if (m0 && m0[3] === text) idx = line;
  else idx = lines.findIndex(l => { const m = l.match(TASK_RE); return m && m[3] === text; });
  if (idx < 0) throw new Error('Task not found in note (was it edited in Obsidian?)');
  const m = lines[idx].match(TASK_RE);
  lines[idx] = `${m[1]}[${done ? 'x' : ' '}] ${m[3]}`;
  return lines.join(eol);
}

module.exports = { parseTasks, parseTime, toggleInContent, categorize, STUDY_CATS };
