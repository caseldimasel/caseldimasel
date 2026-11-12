#!/usr/bin/env node
// Empaqueta un tema integrado (carpetas en la RAÍZ del ZIP) listo para «Añadir tema > Subir archivo ZIP».
//   node integration/build-zip.mjs --theme impact/sidonia --name impact-sidonia
// Comprueba antes: kit sin errores (tools/check-kit.mjs), estructura de tema, sin archivos de desarrollo.
// Requiere el comando «zip» (macOS y Linux lo traen; en Windows usa WSL o Compress-Archive con las
// carpetas del tema en la raíz).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonLoose } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const theme = arg('--theme');
const name = arg('--name', 'tema-sidonia');
const distDir = arg('--dist', join(ROOT, 'dist'));
if (!theme || !existsSync(join(theme, 'layout', 'theme.liquid'))) {
  console.error('Uso: node integration/build-zip.mjs --theme <carpeta-del-tema> [--name nombre]');
  process.exit(1);
}

try {
  execFileSync('node', [join(ROOT, 'tools', 'check-kit.mjs'), '--quiet'], { stdio: 'pipe' });
} catch (e) {
  console.error('tools/check-kit.mjs encontró errores; no se crea el ZIP:\n' + String(e.stdout || e.stderr || '').slice(0, 3000));
  process.exit(1);
}

const schema = readJsonLoose(join(theme, 'config', 'settings_schema.json'));
const info = schema.find((g) => g.name === 'theme_info') || {};
const version = (info.theme_version || '0').replace(/[^0-9a-z.-]/gi, '');
mkdirSync(distDir, { recursive: true });
const out = join(distDir, `${name}-${version}.zip`);
if (existsSync(out)) rmSync(out);
execFileSync('zip', ['-r', '-X', '-D', '-9', '-q', out, '.', '-x', '*.DS_Store', '-x', '.*', '-x', '*/.*'], { cwd: theme });

const listing = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' }).trim().split('\n');
const allowed = ['assets', 'blocks', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates'];
const tops = [...new Set(listing.map((p) => p.split('/')[0]))].sort();
const extra = tops.filter((t) => !allowed.includes(t));
if (extra.length) {
  console.error('Elementos inesperados en la raíz del ZIP: ' + extra.join(', '));
  process.exit(1);
}
for (const need of ['layout/theme.liquid', 'config/settings_schema.json', 'config/settings_data.json']) {
  if (!listing.includes(need)) {
    console.error('Falta en el ZIP: ' + need);
    process.exit(1);
  }
}
const sum = createHash('sha256').update(readFileSync(out)).digest('hex');
writeFileSync(out + '.sha256', `${sum}  ${name}-${version}.zip\n`);
console.log(`ZIP: ${out} · ${listing.length} archivos · ${(statSync(out).size / 1024).toFixed(1)} KB · SHA-256 ${sum}`);
