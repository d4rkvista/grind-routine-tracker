'use strict';
// Minimal headless Templater runtime: runs Obsidian Templater templates outside Obsidian.
// Supports <% %>, <%* %>, whitespace control (<%_ _%> <%- -%>), tp.date, tp.file, tp.system
// (non-interactive defaults), tp.user scripts, tp.frontmatter, tp.config and `moment`.
const fs = require('fs');
const path = require('path');
const moment = require('moment');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function compile(src, name) {
  const re = /<%([-_])?\s*([*~+])?([\s\S]*?)([-_])?%>/g;
  const segs = [];
  let last = 0, m;
  while ((m = re.exec(src))) {
    segs.push({ t: 'lit', v: src.slice(last, m.index) });
    segs.push({ t: m[2] === '*' ? 'exec' : 'out', v: m[3], lt: m[1], rt: m[4] });
    last = re.lastIndex;
  }
  segs.push({ t: 'lit', v: src.slice(last) });
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.t === 'lit') continue;
    const prev = segs[i - 1], next = segs[i + 1];
    if (s.lt === '_') prev.v = prev.v.replace(/\s+$/, '');
    else if (s.lt === '-') prev.v = prev.v.replace(/\r?\n$/, '');
    if (s.rt === '_') next.v = next.v.replace(/^\s+/, '');
    else if (s.rt === '-') next.v = next.v.replace(/^\r?\n/, '');
  }
  let body = 'let tR = "";\n';
  for (const s of segs) {
    if (s.t === 'lit') { if (s.v) body += 'tR += ' + JSON.stringify(s.v) + ';\n'; }
    else if (s.t === 'out') { if (s.v.trim()) body += 'tR += __out(await (' + s.v + '\n));\n'; }
    else body += s.v + '\n;\n';
  }
  body += 'return tR;';
  try {
    return new AsyncFunction('tp', 'moment', 'app', '__out', body);
  } catch (e) {
    throw new Error(`Template "${name}" has a syntax error: ${e.message}`);
  }
}

function walkMd(dir, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, out);
    else if (e.name.toLowerCase().endsWith('.md')) out.push(p);
  }
  return out;
}

function findInVault(vault, link) {
  let name = String(link).trim().replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
  if (!name.toLowerCase().endsWith('.md')) name += '.md';
  const direct = path.join(vault, name);
  if (fs.existsSync(direct)) return direct;
  const base = path.basename(name).toLowerCase();
  return walkMd(vault).find(p => path.basename(p).toLowerCase() === base) || null;
}

function loadUserScripts(vault, folder) {
  const user = {};
  if (!folder) return user;
  const dir = path.join(vault, folder);
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.js')); } catch { return user; }
  for (const f of files) {
    try {
      const full = path.join(dir, f);
      delete require.cache[require.resolve(full)];
      user[path.basename(f, '.js')] = require(full);
    } catch (e) { /* skip broken user script */ }
  }
  return user;
}

const appStub = {
  vault: { getName: () => '', adapter: {} },
  workspace: { getActiveFile: () => null },
  metadataCache: { getFileCache: () => null },
};

/**
 * Render a Templater template.
 * ctx: { vault, templatePath (abs), fileRel (vault-relative target path), now (moment), userScriptsFolder }
 * returns { content, renameTo, moveTo }
 */
async function renderTemplate(ctx) {
  const state = { renameTo: null, moveTo: null, hooks: [] };
  const fileRel = ctx.fileRel.replace(/\\/g, '/');
  const title = path.basename(fileRel, '.md');
  const folderRel = path.dirname(fileRel).replace(/\\/g, '/');
  const templateRel = path.relative(ctx.vault, ctx.templatePath).replace(/\\/g, '/');
  const now = () => ctx.now.clone();
  const F = 'YYYY-MM-DD';
  const ref = (reference, rf) => (reference ? moment(reference, rf) : now());
  const shift = (m, off) => {
    if (typeof off === 'number') m.add(off, 'days');
    else if (typeof off === 'string' && off.trim()) m.add(moment.duration(off));
    return m;
  };

  const tp = {
    date: {
      now: (format = F, offset, reference, rf) => shift(ref(reference, rf), offset).format(format),
      tomorrow: (format = F) => now().add(1, 'day').format(format),
      yesterday: (format = F) => now().subtract(1, 'day').format(format),
      weekday: (format = F, weekday = 0, reference, rf) => ref(reference, rf).weekday(weekday).format(format),
    },
    file: {
      title,
      content: '',
      tags: [],
      cursor: () => '',
      cursor_append: () => '',
      selection: () => '',
      creation_date: (format = 'YYYY-MM-DD HH:mm') => moment().format(format),
      last_modified_date: (format = 'YYYY-MM-DD HH:mm') => moment().format(format),
      folder: (absolute = false) => (absolute ? folderRel : path.basename(folderRel)),
      path: (relative = false) => (relative ? fileRel : path.join(ctx.vault, fileRel)),
      exists: async p => fs.existsSync(path.join(ctx.vault, p)),
      find_tfile: name => {
        const p = findInVault(ctx.vault, name);
        return p ? { path: path.relative(ctx.vault, p).replace(/\\/g, '/'), basename: path.basename(p, '.md') } : null;
      },
      include: async link => {
        const target = link && link.path ? path.join(ctx.vault, link.path) : findInVault(ctx.vault, link);
        if (!target) throw new Error(`tp.file.include: cannot find ${link}`);
        const src = fs.readFileSync(target, 'utf8');
        return compile(src, target)(tp, moment, appStub, v => (v == null ? '' : String(v)));
      },
      rename: async n => { state.renameTo = n; tp.file.title = n; },
      move: async p => { state.moveTo = p; },
      create_new: async () => null,
    },
    frontmatter: {},
    system: {
      prompt: async (msg, def) => (def == null ? '' : def),
      suggester: async (texts, items) => (Array.isArray(items) && items.length ? items[0] : null),
      multi_suggester: async () => [],
      clipboard: async () => '',
    },
    web: { daily_quote: async () => '', random_picture: async () => '', request: async () => '' },
    hooks: { on_all_templates_executed: cb => state.hooks.push(cb) },
    config: {
      template_file: { path: templateRel, basename: path.basename(templateRel, '.md') },
      target_file: { path: fileRel, basename: title },
      active_file: null,
      run_mode: 0,
    },
    user: loadUserScripts(ctx.vault, ctx.userScriptsFolder),
    obsidian: {},
    app: appStub,
  };

  const src = fs.readFileSync(ctx.templatePath, 'utf8');
  const fn = compile(src, templateRel);
  let content;
  try {
    content = await fn(tp, moment, appStub, v => (v == null ? '' : String(v)));
  } catch (e) {
    throw new Error(`Template "${templateRel}" failed: ${e.message}`);
  }
  for (const h of state.hooks) { try { await h(); } catch { /* ignore */ } }
  return { content, renameTo: state.renameTo, moveTo: state.moveTo };
}

module.exports = { renderTemplate, compile, walkMd };
