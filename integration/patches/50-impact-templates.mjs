// Impact 7.x · plantillas y grupos de secciones del duplicado.
//  1. index.json, search.json y 404.json: apply-kit los sustituye por los del kit (decisión de --replace). Aquí se
//     AÑADEN al final las secciones que tenía la tienda, con el prefijo «impact_» y desactivadas («disabled»): no se
//     pierde nada y se pueden reactivar o borrar desde el editor.
//  2. sections/footer-group.json: añade «Sidonia · Pie» (categorías, comunidad y redes) delante del pie de Impact.
//  3. sections/header-group.json, dos ajustes de la cabecera de Impact (valores anteriores en el registro):
//     - «Cabecera fija» (enable_sticky = true): sin ella la cabecera se va con el desplazamiento y no puede pasar a
//       piedra sólida al superar el hero, como pide el briefing.
//     - Diseño «logo a la izquierda, navegación en línea» (layout = logo_left_navigation_inline): la disposición de
//       JamesEdition (logo, categorías, acciones a la derecha) y evita que seis enlaces + «Vender con Sidonia» se
//       partan en dos líneas con el logo centrado.
//     Ambos se revierten desde el editor (sección Cabecera).
// Nunca toca config/settings_data.json.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isImpact7, readJsonLoose, writeJsonKeepHeader } from './_lib.mjs';

export const appliesTo = isImpact7;

export function apply(dir, ctx) {
  const modified = [];
  const notes = [];
  for (const name of ['index.json', 'search.json', '404.json']) {
    const outPath = join(dir, 'templates', name);
    const basePath = join(ctx.base, 'templates', name);
    if (!existsSync(outPath) || !existsSync(basePath)) continue;
    const out = readJsonLoose(outPath);
    const base = readJsonLoose(basePath);
    const isKit = out.data.order.every((k) => /^sidonia|^impact_/.test(out.data.sections[k].type) || k.startsWith('impact_'));
    if (!isKit || out.data.order.some((k) => k.startsWith('impact_'))) continue; // plantilla de la tienda o ya fusionada
    let added = 0;
    for (const key of base.data.order) {
      const id = `impact_${key}`;
      if (out.data.sections[id]) continue;
      out.data.sections[id] = { ...base.data.sections[key], disabled: true };
      out.data.order.push(id);
      added++;
    }
    if (out.data.order.length > 25) throw new Error(`templates/${name}: ${out.data.order.length} secciones (máximo 25)`);
    writeJsonKeepHeader(outPath, out.header, out.data);
    modified.push(`templates/${name} (+${added} secciones originales de la tienda, desactivadas, prefijo impact_)`);
  }

  const footerPath = join(dir, 'sections', 'footer-group.json');
  if (existsSync(footerPath)) {
    const f = readJsonLoose(footerPath);
    if (!Object.values(f.data.sections).some((s) => s.type === 'sidonia-footer-band')) {
      f.data.sections.sidonia_footer_band = { type: 'sidonia-footer-band', settings: {} };
      f.data.order.unshift('sidonia_footer_band');
      writeJsonKeepHeader(footerPath, f.header, f.data);
      modified.push('sections/footer-group.json (+ «Sidonia · Pie» delante del pie de Impact)');
    }
  }

  const headerPath = join(dir, 'sections', 'header-group.json');
  if (existsSync(headerPath)) {
    const h = readJsonLoose(headerPath);
    const key = Object.keys(h.data.sections).find((k) => h.data.sections[k].type === 'header');
    const st = key && h.data.sections[key].settings;
    const want = { enable_sticky: true, layout: 'logo_left_navigation_inline' };
    const changes = st ? Object.entries(want).filter(([k, v]) => st[k] !== v) : [];
    if (changes.length) {
      const log = changes.map(([k, v]) => `${k}: ${JSON.stringify(st[k])} → ${JSON.stringify(v)}`).join(', ');
      changes.forEach(([k, v]) => (st[k] = v));
      writeJsonKeepHeader(headerPath, h.header, h.data);
      modified.push(`sections/header-group.json (${log})`);
      notes.push(`Cabecera del duplicado: ${log}. Se revierte en el editor (sección Cabecera).`);
    }
  }
  return { modified, notes };
}
