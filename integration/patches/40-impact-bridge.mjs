// Impact 7.x · puente de medidas y paleta (integration/impact/snippets/sidonia-impact-bridge.liquid).
//  - Copia el snippet al tema.
//  - Lo renderiza en layout/theme.liquid justo antes de </head> (después de sidonia-head), entre marcas.
//  - Añade el grupo de ajustes «Sidonia · Integración con Impact» (sin tocar los grupos de Impact).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isImpact7, readJsonLoose, writeJsonKeepHeader } from './_lib.mjs';

export const appliesTo = isImpact7;

const GROUP = {
  name: 'Sidonia · Integración con Impact',
  settings: [
    {
      type: 'paragraph',
      content: 'Une el kit Sidonia con Impact. La cabecera transparente usa el mecanismo propio de Impact: actívala en el bloque «Sidonia · Hero y búsqueda» y elige el logo blanco en Cabecera > Cabecera transparente.'
    },
    {
      type: 'checkbox',
      id: 'sidonia_impact_palette',
      label: 'Aplicar la paleta piedra a todo el tema',
      info: 'Usa los colores de «Sidonia · Colores» para el fondo, texto, cabecera, pie, cajones, tarjetas y botón principal de Impact. Desactívalo para volver a «Ajustes del tema > Colores».',
      default: true
    }
  ]
};

export function apply(dir, ctx) {
  const modified = [];
  const created = [];
  const target = join(dir, 'snippets', 'sidonia-impact-bridge.liquid');
  const existed = existsSync(target);
  writeFileSync(target, readFileSync(join(ctx.root, 'integration', 'impact', 'snippets', 'sidonia-impact-bridge.liquid')));
  (existed ? modified : created).push('snippets/sidonia-impact-bridge.liquid');

  const layoutPath = join(dir, 'layout', 'theme.liquid');
  let layout = readFileSync(layoutPath, 'utf8');
  const block = "<!-- sidonia:impact -->{%- render 'sidonia-impact-bridge' -%}<!-- /sidonia:impact -->";
  const re = /<!-- sidonia:impact -->[\s\S]*?<!-- \/sidonia:impact -->/;
  if (re.test(layout)) layout = layout.replace(re, block);
  else {
    const idx = layout.toLowerCase().lastIndexOf('</head>');
    if (idx === -1) throw new Error('layout/theme.liquid sin </head>');
    layout = layout.slice(0, idx) + block + '\n' + layout.slice(idx);
  }
  writeFileSync(layoutPath, layout);
  modified.push('layout/theme.liquid (render de sidonia-impact-bridge entre marcas)');

  const schemaPath = join(dir, 'config', 'settings_schema.json');
  const { header, data } = readJsonLoose(schemaPath);
  const kept = data.filter((g) => g.name !== GROUP.name);
  const ids = new Set(kept.flatMap((g) => (g.settings || []).map((s) => s.id)));
  if (ids.has('sidonia_impact_palette')) throw new Error('sidonia_impact_palette ya existe en otro grupo');
  writeJsonKeepHeader(schemaPath, header, kept.concat([GROUP]));
  modified.push('config/settings_schema.json (+ grupo «Sidonia · Integración con Impact»)');
  return { modified, created };
}
