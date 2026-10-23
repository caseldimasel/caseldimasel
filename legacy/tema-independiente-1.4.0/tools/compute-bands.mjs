#!/usr/bin/env node
// Calcula las bandas de filtro (sidonia.*_band) a partir de los datos numéricos de cada pieza.
// Entrada: CSV con cabecera. Columnas reconocidas: handle, year, mileage_km, length_m, area_value, bedrooms, price_amount, price_mode.
// Salida: CSV con handle + una columna por banda calculable. Las celdas sin dato (o con precio no publicado) quedan vacías.
// Uso: node tools/compute-bands.mjs piezas.csv > bandas.csv
// El resultado sirve para pegarlo en el administrador, importarlo con la herramienta de importación que uséis
// o alimentar una automatización (Shopify Flow). Ver docs/04-colecciones-y-filtros.md.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, 'bands.config.json'), 'utf8'));
const file = process.argv[2];
if (!file) {
  console.error('Uso: node tools/compute-bands.mjs piezas.csv > bandas.csv');
  process.exit(1);
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const [head, ...body] = parseCSV(readFileSync(file, 'utf8'));
const idx = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
const bandNames = Object.keys(cfg._origen).filter((b) => cfg._origen[b] in idx);
const out = [['handle', ...bandNames].map(esc).join(',')];

for (const r of body) {
  const cells = bandNames.map((b) => {
    const raw = (r[idx[cfg._origen[b]]] || '').trim().replace(',', '.');
    if (raw === '') return '';
    const n = Number(raw);
    if (!isFinite(n)) return '';
    if (b === 'price_band' && 'price_mode' in idx && !/^publicado$/i.test((r[idx.price_mode] || '').trim())) return '';
    const band = cfg[b].find((x) => x.max === null || n <= x.max);
    return band ? band.label : '';
  });
  out.push([idx.handle !== undefined ? r[idx.handle] : '', ...cells].map((v) => esc(v ?? '')).join(','));
}
console.log(out.join('\n'));
