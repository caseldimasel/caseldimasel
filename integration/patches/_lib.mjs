// Utilidades comunes de los parches de Impact. Reglas:
//  - Cada cambio se busca por un ANCLA EXACTA tomada de Impact 7.2.0 (auditoría del 4/10/2026). Si el ancla
//    no aparece el número de veces esperado, el parche se detiene: nunca se aplica «a ciegas» a otra versión.
//  - Cada inserción va entre marcas «sidonia:<id>» para que sea idempotente, visible en el diff y fácil de quitar.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const VERIFIED = '7.2.0';

export function themeInfo(dir) {
  try {
    const raw = readFileSync(join(dir, 'config', 'settings_schema.json'), 'utf8').replace(/^﻿?\s*\/\*[\s\S]*?\*\/\s*/, '');
    return JSON.parse(raw).find((g) => g.name === 'theme_info') || {};
  } catch {
    return {};
  }
}

/** true si el tema es Impact 7.x (la versión verificada es 7.2.0; en otra 7.x las anclas deciden). */
export function isImpact7(dir) {
  const i = themeInfo(dir);
  return /^impact$/i.test(String(i.theme_name || '').trim()) && /^7\./.test(String(i.theme_version || ''));
}

export const mark = (id) => `{%- comment -%}sidonia:${id}{%- endcomment -%}`;
export const markEnd = (id) => `{%- comment -%}/sidonia:${id}{%- endcomment -%}`;

/** Sustituye cada aparición de `anchor` (deben ser exactamente `expected`) por `replacement`. */
export function replaceExact(src, anchor, replacement, expected, where) {
  const n = src.split(anchor).length - 1;
  if (n !== expected) throw new Error(`${where}: el ancla aparece ${n} veces (se esperaban ${expected}). ¿Versión de Impact distinta de ${VERIFIED}?\n  Ancla: ${anchor.slice(0, 160)}`);
  return src.split(anchor).join(replacement);
}

/** Edita un archivo del tema si no lleva ya la marca del parche. */
export function editFile(dir, rel, id, fn) {
  const p = join(dir, rel);
  if (!existsSync(p)) throw new Error(`no existe ${rel}`);
  const src = readFileSync(p, 'utf8');
  if (src.includes(`sidonia:${id}`)) return false;
  const out = fn(src);
  if (out === src) throw new Error(`${rel}: el parche ${id} no ha cambiado nada`);
  writeFileSync(p, out);
  return true;
}

export function readJsonLoose(p) {
  const raw = readFileSync(p, 'utf8');
  const m = /^﻿?\s*(\/\*[\s\S]*?\*\/)\s*/.exec(raw);
  return { header: m ? m[1] : '', data: JSON.parse(m ? raw.slice(m[0].length) : raw) };
}
export function writeJsonKeepHeader(p, header, data) {
  writeFileSync(p, (header ? header + '\n' : '') + JSON.stringify(data, null, 2) + '\n');
}
