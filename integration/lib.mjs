// Utilidades compartidas por los scripts de integración (sin dependencias).
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

export const THEME_DIRS = ['assets', 'blocks', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates'];

/** Lista recursiva de archivos (rutas relativas con «/»). */
export function walk(dir, base = dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out.sort();
}

/** JSON de Shopify: admite un comentario /* … *\/ inicial (plantillas, settings_data). */
export function readJsonLoose(path) {
  const text = readFileSync(path, 'utf8');
  const stripped = text.replace(/^\uFEFF?\s*\/\*[\s\S]*?\*\/\s*/, '');
  return JSON.parse(stripped);
}

export function copyTree(src, dst) {
  for (const rel of walk(src)) {
    const from = join(src, rel);
    const to = join(dst, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
}

/** Acepta una carpeta de tema o un ZIP (descomprime en una carpeta temporal). Devuelve la raíz del tema. */
export function resolveTheme(input) {
  if (!input || !existsSync(input)) throw new Error(`No existe: ${input}`);
  let root = input;
  if (statSync(input).isFile()) {
    const tmp = join(tmpdir(), 'sidonia-theme-' + Date.now());
    mkdirSync(tmp, { recursive: true });
    execFileSync('unzip', ['-q', '-o', input, '-d', tmp]);
    root = tmp;
  }
  if (!existsSync(join(root, 'layout', 'theme.liquid'))) {
    // ZIP con una carpeta contenedora
    const subs = readdirSync(root).filter((n) => existsSync(join(root, n, 'layout', 'theme.liquid')));
    if (subs.length === 1) root = join(root, subs[0]);
  }
  if (!existsSync(join(root, 'layout', 'theme.liquid')) || !existsSync(join(root, 'config', 'settings_schema.json'))) {
    throw new Error(`${input} no parece un tema de Shopify (faltan layout/theme.liquid o config/settings_schema.json)`);
  }
  return root;
}

export function extractSchema(text) {
  const m = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return { __invalid: e.message };
  }
}

export function grepFiles(root, files, regex, max = 6) {
  const hits = [];
  for (const rel of files) {
    if (!/\.(liquid|json|js|css)$/.test(rel)) continue;
    const lines = readFileSync(join(root, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (regex.test(line) && hits.filter((h) => h.file === rel).length < max) {
        hits.push({ file: rel, line: i + 1, text: line.trim().slice(0, 160) });
      }
    });
  }
  return hits;
}

export function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMerge(target[k], v);
    } else target[k] = v;
  }
  return target;
}

export { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, join, relative, dirname };
