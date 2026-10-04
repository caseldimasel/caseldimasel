#!/usr/bin/env node
// Genera, a partir de tools/brands.json, el snippet de marcas del tema y las listas de ayuda para el administrador.
// Uso: node tools/generate-brands.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const b = JSON.parse(readFileSync(join(root, 'tools/brands.json'), 'utf8'));
for (const k of ['cars', 'boats', 'cars_popular', 'boats_popular']) {
  for (const n of b[k]) if (/[|{}%]/.test(n)) throw new Error(`Nombre de marca no válido: ${n}`);
}
const snippet = `{%- comment -%}
  Listas de marcas (coches y barcos) separadas por «|». GENERADO por tools/generate-brands.mjs desde tools/brands.json: no editar a mano.
  Parámetro: kind = cars | boats | cars_popular | boats_popular
{%- endcomment -%}
{%- case kind -%}
  {%- when 'cars' -%}${b.cars.join('|')}
  {%- when 'boats' -%}${b.boats.join('|')}
  {%- when 'cars_popular' -%}${b.cars_popular.join('|')}
  {%- when 'boats_popular' -%}${b.boats_popular.join('|')}
{%- endcase -%}
`;
writeFileSync(join(root, 'theme/snippets/brand-list.liquid'), snippet);
mkdirSync(join(root, 'docs/ejemplos'), { recursive: true });
writeFileSync(join(root, 'docs/ejemplos/marcas-coches.txt'), b.cars.join('\n') + '\n');
writeFileSync(join(root, 'docs/ejemplos/marcas-barcos.txt'), b.boats.join('\n') + '\n');
console.log(`Marcas: ${b.cars.length} de coches y ${b.boats.length} de barcos`);
