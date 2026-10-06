#!/usr/bin/env node
// Compila tools/locale/es.flat.txt a theme/locales/es.default.json (JSON anidado).
// Uso: node tools/build-locale.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'locale', 'es.flat.txt');
const outDir = join(here, '..', 'theme', 'locales');
mkdirSync(outDir, { recursive: true });

const tree = {};
const seen = new Set();
let n = 0;
for (const [i, raw] of readFileSync(src, 'utf8').split('\n').entries()) {
  const line = raw.trimEnd();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq < 1) throw new Error(`Línea ${i + 1} inválida: ${line}`);
  const key = line.slice(0, eq).trim();
  const value = line.slice(eq + 1);
  if (seen.has(key)) throw new Error(`Clave duplicada: ${key}`);
  seen.add(key);
  const parts = key.split('.');
  let node = tree;
  parts.forEach((p, idx) => {
    if (idx === parts.length - 1) {
      if (typeof node[p] === 'object') throw new Error(`Conflicto hoja/rama en ${key}`);
      node[p] = value;
    } else {
      if (node[p] === undefined) node[p] = {};
      if (typeof node[p] !== 'object') throw new Error(`Conflicto hoja/rama en ${key}`);
      node = node[p];
    }
  });
  n++;
}
const file = join(outDir, 'es.default.json');
writeFileSync(file, JSON.stringify(tree, null, 2) + '\n');
console.log(`${n} cadenas -> ${file}`);
