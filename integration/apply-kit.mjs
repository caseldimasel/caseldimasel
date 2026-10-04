#!/usr/bin/env node
// Aplica el kit Sidonia sobre una copia de un tema (Impact o el anfitrión de pruebas) SIN tocar el original.
//
//   node integration/apply-kit.mjs --base impact/original --out impact/sidonia [--replace index.json,search.json,404.json] [--update]
//   --update: la base ya tiene el kit (p. ej. un duplicado integrado y editado): sobrescribe solo los archivos sidonia-*
//             y las plantillas del kit; nunca settings_data.json ni el resto de Impact.
//
// Qué hace (y nada más):
//   1. Copia el tema base completo a --out (el original no se modifica).
//   2. Añade assets, secciones y snippets sidonia-* y las plantillas NUEVAS del kit. Si un archivo ya existe
//      en el tema base, se detiene y lo lista como conflicto (salvo plantillas indicadas en --replace).
//   3. Fusiona las traducciones del kit bajo la clave «sidonia» del idioma por defecto y de es.json.
//   4. Añade los grupos de ajustes «Sidonia · …» a settings_schema.json (sin tocar los existentes;
//      falla si un id ya existe fuera de los grupos Sidonia).
//   5. Inserta {% render 'sidonia-head' %} antes de </head> y {% render 'sidonia-body-end' %} antes de </body>
//      en layout/theme.liquid, entre marcas (idempotente).
//   6. Aplica los parches de integration/patches/*.mjs si existen (se escriben tras la auditoría).
//   7. NUNCA modifica config/settings_data.json.
//   8. Escribe <out>.CAMBIOS.md (registro) y <out>.diff (diferencias con el original).
import { walk, readJsonLoose, resolveTheme, copyTree, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, join, dirname } from './lib.mjs';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'kit');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'integration', 'manifest.json'), 'utf8'));

const args = process.argv.slice(2);
const arg = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const baseInput = arg('--base');
const out = arg('--out');
const replace = (arg('--replace', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const quiet = args.includes('--quiet');
const update = args.includes('--update'); // vuelve a aplicar el kit sobre un tema ya integrado: sobrescribe SOLO archivos del kit
if (!baseInput || !out) {
  console.error('Uso: node integration/apply-kit.mjs --base <tema-o-zip> --out <carpeta> [--replace index.json,search.json,404.json]');
  process.exit(1);
}

const base = resolveTheme(baseInput);
const log = { created: [], replaced: [], modified: [], kept: [], conflicts: [], notes: [] };
const say = (m) => {
  if (!quiet) console.log(m);
};

if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyTree(base, out);
const baseFiles = walk(base);

/* ---------- 2. archivos del kit ---------- */
for (const dir of MANIFEST.copy) {
  for (const rel of walk(join(KIT, dir))) {
    const target = `${dir}/${rel}`;
    if (baseFiles.includes(target)) {
      if (update && rel.startsWith('sidonia-')) {
        writeFileSync(join(out, target), readFileSync(join(KIT, dir, rel)));
        log.replaced.push(target);
        continue;
      }
      log.conflicts.push(target);
      continue;
    }
    mkdirSync(dirname(join(out, target)), { recursive: true });
    writeFileSync(join(out, target), readFileSync(join(KIT, dir, rel)));
    log.created.push(target);
  }
}
for (const name of MANIFEST.templates.new) {
  const target = `templates/${name}`;
  if (baseFiles.includes(target)) {
    if (replace.includes(name) || update) log.replaced.push(target);
    else {
      log.conflicts.push(target);
      continue;
    }
  } else log.created.push(target);
  writeFileSync(join(out, target), readFileSync(join(KIT, 'templates', name)));
}
for (const name of MANIFEST.templates.replace) {
  const target = `templates/${name}`;
  if (!replace.includes(name)) {
    log.notes.push(`${target}: se conserva la del tema base (pásala en --replace para usar la del kit)`);
    continue;
  }
  if (baseFiles.includes(target)) log.replaced.push(target);
  else log.created.push(target);
  writeFileSync(join(out, target), readFileSync(join(KIT, 'templates', name)));
}

if (log.conflicts.length) {
  console.error('\nCONFLICTOS: estos archivos del kit ya existen en el tema base. No se ha sobrescrito nada.');
  log.conflicts.forEach((c) => console.error('  - ' + c));
  console.error('Resuélvelos (renombrar en el kit o decidir el reemplazo) y vuelve a ejecutar.');
  process.exit(2);
}

/* ---------- 3. traducciones ---------- */
const kitLocale = JSON.parse(readFileSync(join(KIT, MANIFEST.locales.source), 'utf8'));
const locs = walk(join(out, 'locales')).filter((f) => f.endsWith('.json') && !f.includes('.schema.'));
const defaultLocale = locs.find((f) => f.endsWith('.default.json'));
const targets = new Set();
if (defaultLocale) targets.add(defaultLocale);
if (locs.includes('es.json')) targets.add('es.json');
if (!targets.size) {
  writeFileSync(join(out, 'locales', 'es.default.json'), JSON.stringify(kitLocale, null, 2) + '\n');
  log.created.push('locales/es.default.json');
}
for (const f of targets) {
  const p = join(out, 'locales', f);
  const data = readJsonLoose(p);
  data[MANIFEST.locales.namespace] = kitLocale[MANIFEST.locales.namespace];
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  log.modified.push(`locales/${f} (clave «${MANIFEST.locales.namespace}» añadida o actualizada)`);
}
if (defaultLocale && !/^es\./.test(defaultLocale)) {
  log.notes.push(`El idioma por defecto es ${defaultLocale}: las cadenas «sidonia» se han copiado en español también ahí. Si se publica otro idioma, tradúcelas en Contenido > Traducciones.`);
}

/* ---------- 4. ajustes ---------- */
const schemaPath = join(out, 'config', 'settings_schema.json');
const schema = readJsonLoose(schemaPath);
const kitGroups = JSON.parse(readFileSync(join(KIT, MANIFEST.settings.source), 'utf8'));
const kitNames = kitGroups.map((g) => g.name);
const kept = schema.filter((g) => !kitNames.includes(g.name));
const existingIds = new Set(kept.flatMap((g) => (g.settings || []).map((s) => s.id).filter(Boolean)));
const clash = kitGroups.flatMap((g) => g.settings.map((s) => s.id).filter((id) => id && existingIds.has(id)));
if (clash.length) {
  console.error('Ids de ajustes duplicados con el tema base: ' + clash.join(', '));
  process.exit(3);
}
writeFileSync(schemaPath, JSON.stringify(kept.concat(kitGroups), null, 2) + '\n');
log.modified.push(`config/settings_schema.json (+${kitGroups.length} grupos Sidonia · ${kitGroups.reduce((n, g) => n + g.settings.filter((s) => s.id).length, 0)} ajustes)`);

/* ---------- 5. layout ---------- */
const layoutPath = join(out, MANIFEST.layout.file);
let layout = readFileSync(layoutPath, 'utf8');
for (const part of ['head', 'body']) {
  const conf = MANIFEST.layout[part];
  const block = `<!-- ${conf.marker} -->{%- render '${conf.snippet}' -%}<!-- /${conf.marker} -->`;
  const re = new RegExp(`<!-- ${conf.marker} -->[\\s\\S]*?<!-- /${conf.marker} -->`);
  if (re.test(layout)) layout = layout.replace(re, block);
  else {
    const idx = layout.toLowerCase().lastIndexOf(conf.before.toLowerCase());
    if (idx === -1) {
      console.error(`No se encuentra ${conf.before} en ${MANIFEST.layout.file}`);
      process.exit(4);
    }
    layout = layout.slice(0, idx) + block + '\n' + layout.slice(idx);
  }
}
writeFileSync(layoutPath, layout);
log.modified.push(`${MANIFEST.layout.file} (render de sidonia-head y sidonia-body-end entre marcas)`);

/* ---------- 6. parches ---------- */
const patchDir = join(ROOT, 'integration', 'patches');
const patches = existsSync(patchDir) ? readdirSync(patchDir).filter((f) => f.endsWith('.mjs')).sort() : [];
for (const p of patches) {
  const mod = await import(pathToFileURL(join(patchDir, p)).href);
  if (typeof mod.apply !== 'function') continue;
  if (mod.appliesTo && !mod.appliesTo(out)) {
    log.notes.push(`parche ${p}: no aplica a este tema base`);
    continue;
  }
  const r = await mod.apply(out);
  (r && r.modified ? r.modified : []).forEach((m) => log.modified.push(`${m} (parche ${p})`));
}
if (!patches.length) log.notes.push('Sin parches específicos de Impact todavía: se escriben tras la auditoría (integration/patches/README.md).');

/* ---------- 7. settings_data.json ---------- */
log.kept.push('config/settings_data.json (no se modifica: conserva logos, contactos, secciones y personalizaciones)');

/* ---------- 8. registro y diff ---------- */
const stamp = new Date().toISOString();
const md = `# Cambios aplicados por apply-kit

- Fecha: ${stamp}
- Base: \`${baseInput}\`
- Salida: \`${out}\`
- Plantillas reemplazadas por decisión: ${replace.join(', ') || 'ninguna'}

## Creados (${log.created.length})
${log.created.map((f) => '- `' + f + '`').join('\n')}

## Reemplazados (${log.replaced.length})
${log.replaced.map((f) => '- `' + f + '`').join('\n') || '- ninguno'}

## Modificados (${log.modified.length})
${log.modified.map((f) => '- ' + f).join('\n')}

## Conservados sin cambios
${log.kept.map((f) => '- ' + f).join('\n')}
- Resto de archivos del tema base: ${baseFiles.length - log.replaced.length - 3} archivos idénticos.

## Notas
${log.notes.map((n) => '- ' + n).join('\n') || '- ninguna'}
`;
writeFileSync(out.replace(/\/$/, '') + '.CAMBIOS.md', md);
try {
  const diff = execFileSync('diff', ['-ruN', base, out], { encoding: 'utf8', maxBuffer: 1 << 28 });
  writeFileSync(out.replace(/\/$/, '') + '.diff', diff);
} catch (e) {
  // diff devuelve 1 cuando hay diferencias: es lo esperado
  writeFileSync(out.replace(/\/$/, '') + '.diff', String(e.stdout || ''));
}
say(`Kit aplicado: ${log.created.length} creados · ${log.replaced.length} reemplazados · ${log.modified.length} modificados → ${out}`);
say(`Registro: ${out.replace(/\/$/, '')}.CAMBIOS.md · Diferencias: ${out.replace(/\/$/, '')}.diff`);
