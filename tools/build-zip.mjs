#!/usr/bin/env node
// Empaqueta SOLO la carpeta theme/ en dist/sidonia-theme-<versión>.zip con las carpetas del tema en la raíz.
// No incluye documentación, herramientas, pruebas ni datos de prueba. Requiere el comando «zip».
// En Windows: Compress-Archive -Path theme\* -DestinationPath sidonia-theme.zip (las carpetas deben quedar en la raíz).
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'theme/config/settings_schema.json'), 'utf8'));
const version = schema[0].theme_version;
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });
const out = join(dist, `sidonia-theme-${version}.zip`);
if (existsSync(out)) rmSync(out);
// -D: sin entradas de carpeta (solo archivos); -9: compresión máxima; rutas relativas a theme/
execFileSync('zip', ['-r', '-X', '-D', '-9', '-q', out, '.', '-x', '*.DS_Store'], { cwd: join(root, 'theme') });

const listing = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' }).trim().split('\n');
for (const need of ['layout/theme.liquid', 'config/settings_schema.json', 'templates/index.json', 'locales/es.default.json']) {
  if (!listing.includes(need)) {
    console.error('Falta en el ZIP:', need);
    process.exit(1);
  }
}
const tops = [...new Set(listing.map((p) => p.split('/')[0]))].sort();
const allowed = ['assets', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates'];
const extra = tops.filter((t) => !allowed.includes(t));
if (extra.length) {
  console.error('El ZIP contiene elementos inesperados en la raíz:', extra.join(', '));
  process.exit(1);
}
const sum = createHash('sha256').update(readFileSync(out)).digest('hex');
writeFileSync(out + '.sha256', `${sum}  sidonia-theme-${version}.zip\n`);
console.log(`ZIP: ${out}\nArchivos: ${listing.filter((l) => !l.endsWith('/')).length} · carpetas raíz: ${tops.join(', ')}\nTamaño: ${(statSync(out).size / 1024).toFixed(1)} KB · SHA-256 ${sum}`);
