'use strict';
// Routine Tracker — local app. Runs only while its window is open; never autostarts.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const moment = require('moment');
const { renderTemplate, walkMd } = require('./lib/templater');
const { parseTasks, toggleInContent } = require('./lib/notes');
const { computeStats } = require('./lib/stats');
const CL = require('./lib/checklists');

const APP = __dirname;
const CONFIG_FILE = process.env.RT_CONFIG || path.join(APP, 'config.json');
const LOCK_FILE = process.env.RT_LOCK || path.join(APP, '.running');
const LOG_FILE = path.join(APP, 'app.log');
const PUB = path.join(APP, 'public');

const log = (...a) => { try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${a.join(' ')}\n`); } catch {} };

const DEFAULTS = {
  vault: '',                // absolute path to your Obsidian vault (set in Settings on first run)
  template: '',             // Templater template for daily notes (blank = auto-pick one with "daily" in its name)
  fallbackTemplate: '',     // used when the main template produces no checkboxes for a date (blank = none)
  rolloverHour: 3,          // before 3 AM still counts as the previous day
  streakThreshold: 60,      // % of a day's tasks needed to keep the streak
  startDate: '',            // ignore notes before this (blank = all)
  checklistFolder: 'Exams', // topic checklists (*checklist*.md) whose lines carry #studied / #practised / #revise tags
  reviseAfterDays: 14,       // a topic gets #revise once its latest #studied/#practised date is this old
  routineToTopics: true,     // ticking a routine task that names a topic ("Chem 25.1 ...") marks that topic #practised
};

const readJson = (f, d) => { try { return { ...d, ...JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch { return { ...d }; } };
const loadConfig = () => readJson(CONFIG_FILE, DEFAULTS);
const saveConfig = c => fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2));
// a vault is usable once it's an existing folder with an .obsidian config folder
const vaultOk = cfg => !!cfg.vault && path.isAbsolute(cfg.vault) && fs.existsSync(path.join(cfg.vault, '.obsidian'));
function needVault(cfg) { if (!vaultOk(cfg)) throw new Error('Choose your Obsidian vault in Settings first'); }

function dailyCfg(vault) {
  const d = readJson(path.join(vault, '.obsidian/daily-notes.json'), { folder: '', format: 'YYYY-MM-DD' });
  return { folder: d.folder || '', format: d.format || 'YYYY-MM-DD' };
}
function templaterCfg(vault) {
  return readJson(path.join(vault, '.obsidian/plugins/templater-obsidian/data.json'), { templates_folder: 'Templates', user_scripts_folder: '' });
}
function listTemplates(vault) {
  if (!vault) return [];
  const tf = templaterCfg(vault).templates_folder || 'Templates';
  return walkMd(path.join(vault, tf)).map(p => path.relative(vault, p).replace(/\\/g, '/')).sort();
}
// the template actually used: the configured one, else the vault's Daily Notes template, else one named *daily*, else the first
function primaryTemplate(cfg) {
  const list = listTemplates(cfg.vault);
  if (cfg.template && list.includes(cfg.template)) return cfg.template;
  const dn = readJson(path.join(cfg.vault, '.obsidian/daily-notes.json'), {}).template;
  if (dn) { const rel = /\.md$/i.test(dn) ? dn : dn + '.md'; if (list.includes(rel)) return rel; }
  return list.find(t => /daily/i.test(path.basename(t))) || list[0] || null;
}
function logicalToday(cfg) {
  const m = moment();
  if (m.hour() < (+cfg.rolloverHour || 0)) m.subtract(1, 'day');
  return m.format('YYYY-MM-DD');
}
function notePaths(cfg, date) {
  const dc = dailyCfg(cfg.vault);
  const rel = path.posix.join(dc.folder, moment(date, 'YYYY-MM-DD').format(dc.format) + '.md');
  return { rel, abs: path.join(cfg.vault, rel) };
}

async function render(cfg, tplRel, date) {
  const { rel } = notePaths(cfg, date);
  const t = moment();
  const now = moment(date, 'YYYY-MM-DD').hour(t.hour()).minute(t.minute()).second(t.second());
  const r = await renderTemplate({
    vault: cfg.vault, templatePath: path.join(cfg.vault, tplRel), fileRel: rel, now,
    userScriptsFolder: templaterCfg(cfg.vault).user_scripts_folder,
  });
  return r.content;
}
// Render the chosen template; if it has no checkboxes for this date (date-windowed), use the fallback.
async function renderWithFallback(cfg, date, tplOverride) {
  const primary = tplOverride || primaryTemplate(cfg);
  if (!primary) throw new Error('No Templater templates found in this vault');
  let content = await render(cfg, primary, date), used = primary;
  if (!parseTasks(content).length && cfg.fallbackTemplate && cfg.fallbackTemplate !== primary) {
    content = await render(cfg, cfg.fallbackTemplate, date); used = cfg.fallbackTemplate;
  }
  return { content, used };
}

async function ensureNote(cfg, date) {
  const p = notePaths(cfg, date);
  if (fs.existsSync(p.abs)) return { created: false, ...p };
  const { content, used } = await renderWithFallback(cfg, date);
  fs.mkdirSync(path.dirname(p.abs), { recursive: true });
  fs.writeFileSync(p.abs, content, { flag: 'wx' });
  log('created', p.rel, 'from', used);
  return { created: true, used, ...p };
}

function readDay(cfg, date) {
  const p = notePaths(cfg, date);
  if (!fs.existsSync(p.abs)) return { date, exists: false, path: p.rel, tasks: [] };
  const content = fs.readFileSync(p.abs, 'utf8');
  return { date, exists: true, path: p.rel, tasks: parseTasks(content) };
}

function allNotes(cfg) {
  const dc = dailyCfg(cfg.vault);
  const dir = path.join(cfg.vault, dc.folder);
  const out = {};
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch {}
  for (const f of files) {
    const m = moment(path.basename(f, '.md'), dc.format, true);
    if (!m.isValid()) continue;
    try { out[m.format('YYYY-MM-DD')] = parseTasks(fs.readFileSync(path.join(dir, f), 'utf8')); } catch {}
  }
  return out;
}

async function fullState(date, extra = {}) {
  const cfg = loadConfig();
  const today = logicalToday(cfg);
  if (!vaultOk(cfg)) {
    // first run (or the vault moved): nothing to read yet, the UI opens Settings
    return {
      config: cfg, templates: [], activeTemplate: null, today, topics: [], autoRevised: [], vaultName: '', now: moment().format('YYYY-MM-DD HH:mm:ss'),
      day: { date: date || today, exists: false, path: '', tasks: [] }, created: null, stats: computeStats({}, today, cfg), notes: {},
      needsSetup: true, setupReason: cfg.vault ? `No Obsidian vault found at ${cfg.vault}` : 'Choose your Obsidian vault to get started', ...extra,
    };
  }
  let created = null;
  try { const r = await ensureNote(cfg, today); if (r.created) created = r; }
  catch (e) { extra.error = 'Could not create today\'s note: ' + e.message; log('create error', e.stack); }
  const d = date || today;
  const notes = allNotes(cfg);
  const stats = computeStats(notes, today, cfg);
  const slim = {};
  for (const [k, ts] of Object.entries(notes)) slim[k] = ts.map(t => ({ line: t.line, text: t.text, label: t.label, cat: t.cat, study: t.study, done: t.done, cancelled: t.cancelled, start: t.start, end: t.end }));
  let topics = [], autoRevised = [];
  try {
    autoRevised = CL.autoRevise(cfg.vault, cfg.checklistFolder, today, +cfg.reviseAfterDays || 14);
    for (const c of autoRevised) log('auto #revise', c.file, c.title);
    topics = CL.loadTopics(cfg.vault, cfg.checklistFolder);
  } catch (e) { extra.error = (extra.error ? extra.error + ' · ' : '') + 'Topics: ' + e.message; log('topics error', e.stack); }
  return {
    config: cfg, templates: listTemplates(cfg.vault), activeTemplate: primaryTemplate(cfg), today, topics, autoRevised, vaultName: path.basename(cfg.vault), now: moment().format('YYYY-MM-DD HH:mm:ss'),
    day: readDay(cfg, d), created, stats, notes: slim, ...extra,
  };
}

// ---------- lifetime: the server lives exactly as long as its window ----------
// Primary: the app window is our own browser process; when it exits (you closed the window), we exit.
// Minimising / leaving it in the background never stops it.
// Fallback (only if we can't track the window process): page heartbeat with a long timeout.
let lastPing = Date.now();
let gotPing = false;
let trackedWindow = false;
const START = Date.now();
function shutdown(why) {
  log('exit:', why);
  try { if (fs.readFileSync(LOCK_FILE, 'utf8').includes(String(process.pid))) fs.unlinkSync(LOCK_FILE); } catch {}
  process.exit(0);
}
setInterval(() => {
  if (trackedWindow) return;
  if (gotPing && Date.now() - lastPing > 180000) shutdown('window closed (no heartbeat for 3 min)');
  if (!gotPing && Date.now() - START > 180000) shutdown('window never connected');
}, 5000);

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const body = req => new Promise(r => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const validDate = d => typeof d === 'string' && moment(d, 'YYYY-MM-DD', true).isValid();

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/api/ping') { lastPing = Date.now(); gotPing = true; return send(res, 200, { ok: true }); }
    if (u.pathname === '/api/state') {
      const d = u.searchParams.get('date');
      return send(res, 200, await fullState(validDate(d) ? d : null));
    }
    if (u.pathname === '/api/toggle' && req.method === 'POST') {
      const b = await body(req);
      const cfg = loadConfig();
      needVault(cfg);
      if (!validDate(b.date)) return send(res, 400, { error: 'bad date' });
      const { abs } = notePaths(cfg, b.date);
      const content = fs.readFileSync(abs, 'utf8');
      fs.writeFileSync(abs, toggleInContent(content, b.line, b.text, !!b.done));
      log('toggle', b.date, b.done ? '[x]' : '[ ]', b.text);
      const topicChanges = [];
      if (b.done && cfg.routineToTopics && b.date <= logicalToday(cfg)) {
        try {
          const task = parseTasks(fs.readFileSync(abs, 'utf8')).find(t => t.text === b.text);
          const topics = CL.loadTopics(cfg.vault, cfg.checklistFolder);
          for (const id of task ? CL.matchLines(task.label, topics) : []) {
            const t = topics.find(x => x.id === id);
            if (t.practised && t.practised >= b.date) continue; // never move a date backwards
            const c = CL.applyAction(cfg.vault, id, 'practised', b.date);
            if (c) topicChanges.push({ ...c, title: t.title, subject: t.subject });
          }
          if (topicChanges.length) log('routine -> #practised', topicChanges.map(c => c.title).join(' | '));
        } catch (e) { log('topic link error', e.stack); }
      }
      return send(res, 200, await fullState(b.date, { topicChanges }));
    }
    if (u.pathname === '/api/create' && req.method === 'POST') {
      const b = await body(req);
      if (!validDate(b.date)) return send(res, 400, { error: 'bad date' });
      const cfg = loadConfig();
      needVault(cfg);
      await ensureNote(cfg, b.date);
      return send(res, 200, await fullState(b.date));
    }
    if (u.pathname === '/api/regenerate' && req.method === 'POST') {
      // Rebuild a day's note from the template, keeping ticks on tasks whose text is unchanged.
      const b = await body(req);
      if (!validDate(b.date)) return send(res, 400, { error: 'bad date' });
      const cfg = loadConfig();
      needVault(cfg);
      const { abs } = notePaths(cfg, b.date);
      const old = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
      const doneSet = new Set(parseTasks(old).filter(t => t.done).map(t => t.text));
      let { content } = await renderWithFallback(cfg, b.date, b.template);
      for (const t of parseTasks(content)) if (doneSet.has(t.text)) content = toggleInContent(content, t.line, t.text, true);
      if (old) fs.writeFileSync(abs + '.bak', old);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      log('regenerated', b.date);
      return send(res, 200, await fullState(b.date));
    }
    if (u.pathname === '/api/topic' && req.method === 'POST') {
      const b = await body(req);
      const cfg = loadConfig();
      needVault(cfg);
      const date = validDate(b.date) ? b.date : logicalToday(cfg);
      const changes = [];
      for (const id of (Array.isArray(b.ids) ? b.ids : [b.id])) { const c = CL.applyAction(cfg.vault, String(id), String(b.action), date); if (c) changes.push(c); }
      log('topic', b.action, changes.map(c => c.file + ':' + c.line).join(','));
      return send(res, 200, await fullState(null, { topicChanges: changes }));
    }
    if (u.pathname === '/api/topic-undo' && req.method === 'POST') {
      const b = await body(req);
      const cfg = loadConfig();
      needVault(cfg);
      let n = 0;
      for (const c of (b.changes || []).slice().reverse()) if (CL.restore(cfg.vault, c)) n++;
      log('topic undo', n);
      return send(res, 200, await fullState(b.date && validDate(b.date) ? b.date : null, { undone: n }));
    }
    if (u.pathname === '/api/preview' && req.method === 'POST') {
      const b = await body(req);
      const cfg = loadConfig();
      needVault(cfg);
      const r = await renderWithFallback(cfg, validDate(b.date) ? b.date : logicalToday(cfg), b.template);
      return send(res, 200, { ...r, tasks: parseTasks(r.content) });
    }
    if (u.pathname === '/api/config' && req.method === 'POST') {
      const b = await body(req);
      const cfg = loadConfig();
      for (const k of Object.keys(DEFAULTS)) if (k in b) cfg[k] = b[k];
      // accept a pasted Explorer path: strip quotes, use forward slashes, drop a trailing slash
      cfg.vault = String(cfg.vault || '').trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/').replace(/\/+$/, '');
      if (cfg.vault && !vaultOk(cfg)) return send(res, 400, { error: `No Obsidian vault at "${cfg.vault}" (expected a folder that contains .obsidian)` });
      const tpls = listTemplates(cfg.vault);
      if (cfg.template && !tpls.includes(cfg.template)) cfg.template = '';
      if (cfg.fallbackTemplate && !tpls.includes(cfg.fallbackTemplate)) cfg.fallbackTemplate = '';
      cfg.rolloverHour = Math.max(0, Math.min(11, +cfg.rolloverHour || 0));
      cfg.streakThreshold = Math.max(1, Math.min(100, +cfg.streakThreshold || 60));
      cfg.reviseAfterDays = Math.max(1, Math.min(365, Math.round(+cfg.reviseAfterDays || 14)));
      cfg.routineToTopics = !!cfg.routineToTopics;
      cfg.checklistFolder = String(cfg.checklistFolder || 'Exams').trim() || 'Exams';
      saveConfig(cfg);
      return send(res, 200, await fullState(null));
    }
    if (u.pathname === '/api/quit') { send(res, 200, { ok: true }); return setTimeout(() => shutdown('quit button'), 200); }

    // static
    let f = u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname);
    const abs = path.normalize(path.join(PUB, f));
    if (!abs.startsWith(PUB) || !fs.existsSync(abs)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    log('error', u.pathname, e.stack);
    send(res, 500, { error: e.message });
  }
});

function findBrowser() {
  const c = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ];
  return c.find(p => fs.existsSync(p));
}
function openWindow(url) {
  if (process.argv.includes('--no-window')) return;
  const b = findBrowser();
  if (!b) { spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref(); return; }
  const prof = path.join(APP, '.window-profile');
  const child = spawn(b, [`--app=${url}`, `--user-data-dir=${prof}`, '--window-size=1340,900', '--no-first-run',
    '--no-default-browser-check', '--disable-sync', '--disable-background-mode',
    // keep the page fully alive when minimised / behind other windows
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-features=Translate,IntensiveWakeUpThrottling,CalculateNativeWinOcclusion'], { stdio: 'ignore' });
  trackedWindow = true;
  const t0 = Date.now();
  child.on('error', e => { trackedWindow = false; log('browser error', e.message); });
  child.on('exit', () => {
    if (Date.now() - t0 > 5000) return setTimeout(() => shutdown('window closed'), 800);
    // exited instantly = handed off to an already-open window of this profile; we can't track it, use heartbeat
    trackedWindow = false; lastPing = Date.now();
    log('window process handed off; using heartbeat fallback');
  });
}

function ping(port) {
  return new Promise(r => {
    const q = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout: 1500 }, s => { s.resume(); r(s.statusCode === 200); });
    q.on('error', () => r(false)); q.on('timeout', () => { q.destroy(); r(false); });
  });
}

(async () => {
  // Single instance: if already running, just open another window onto it.
  try {
    const { port } = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (port && (await ping(port))) { openWindow(`http://127.0.0.1:${port}/`); return setTimeout(() => process.exit(0), 3000); }
  } catch {}
  const port = +(process.env.RT_PORT || 0);
  server.listen(port, '127.0.0.1', () => {
    const p = server.address().port;
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ port: p, pid: process.pid }));
    log('started on', p);
    console.log(`Routine Tracker on http://127.0.0.1:${p}/`);
    openWindow(`http://127.0.0.1:${p}/`);
  });
})();
