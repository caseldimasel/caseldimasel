#!/usr/bin/env node
// Genera docs/12-registro-de-archivos.md (registro de archivos del tema y de las herramientas).
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = join(root, 'theme');
const ls = (d) => readdirSync(join(T, d)).sort();
const size = (f) => (statSync(f).size / 1024).toFixed(1) + ' KB';

const firstComment = (text) => {
  const m = /\{%-?\s*comment\s*-?%\}([\s\S]*?)\{%-?\s*endcomment\s*-?%\}/.exec(text);
  if (!m) return '';
  return m[1].split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
};
const schemaName = (text) => {
  const m = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(text);
  try {
    return JSON.parse(m[1]).name;
  } catch {
    return '';
  }
};
const assets = {
  'sd-base.css': 'Reinicio, tipografía, utilidades, botones, chips, formularios, tabla de datos (usa los tokens)',
  'sd-components.css': 'Cabecera, menús, cajones, pie, tarjetas, vídeo, filtros, paginación, avisos',
  'sd-sections.css': 'Hero, secciones de la home, ficha, formularios, contacto, favoritos',
  'sd-core.js': 'Espacio de nombres, configuración, utilidades, avisos accesibles, diálogos',
  'sd-analytics.js': 'Adaptador de analítica opcional (lista blanca, consentimiento, sin datos personales)',
  'sd-favorites.js': 'Favoritos locales, `<sd-save>`, `<sd-fav-count>`, `<sd-favorites-page>`',
  'sd-video.js': 'Reproductor modal, reproductor de ficha, previsualización, proveedores externos, un solo audio',
  'sd-header.js': 'Cajón de navegación, buscador y búsqueda predictiva',
  'sd-forms.js': 'Validación y envío mejorado de formularios; formulario de propietarios en 3 pasos',
  'sd-facets.js': 'Filtros y orden por AJAX con estado en URL; «Cargar más»; restauración de posición',
  'sd-product.js': 'Compartir y barra fija de contacto en móvil'
};

const out = [`# 12 · Registro de archivos

Generado con \`node tools/list-files.mjs\`. La carpeta \`theme/\` es lo único que se sube a Shopify (el ZIP \`dist/sidonia-theme-<versión>.zip\` contiene su contenido en la raíz).

## Estructura del repositorio

| Carpeta | Contenido | ¿Va en el ZIP? |
|---|---|---|
| \`theme/\` | El tema: \`layout\`, \`templates\`, \`sections\`, \`snippets\`, \`assets\`, \`config\`, \`locales\` | **Sí** |
| \`docs/\` | Documentación en español | No |
| \`tools/\` | Validador, generadores, intérprete y servidor de previsualización, pruebas, bandas | No |
| \`dist/\` | ZIP generado y su suma SHA-256 | — |

## Raíz del tema

| Archivo | Para qué sirve |
|---|---|
| \`layout/theme.liquid\` | Estructura HTML, cabecera/pie por grupos de secciones, scripts, \`content_for_header\` y \`content_for_layout\` |
| \`layout/password.liquid\` | Página de contraseña (para previsualizar sin publicar) |
| \`config/settings_schema.json\` | Ajustes globales editables (${ls('config').length} archivos en \`config\`) |
| \`config/settings_data.json\` | Valores por defecto (vacío: se aplican los del schema) |
| \`locales/es.default.json\` | Todas las cadenas de interfaz (español de España) |
| \`sections/header-group.json\`, \`footer-group.json\` | Grupos de secciones de cabecera y pie |

## Plantillas (\`templates/\`)

${ls('templates').map((f) => '`' + f + '`').join(' · ')}

Las plantillas JSON se generan con \`node tools/generate-templates.mjs\`. \`product.card.liquid\` es la vista alternativa que usa Favoritos.

## Secciones (\`sections/\`)

| Archivo | Nombre en el editor |
|---|---|
${ls('sections').filter((f) => f.endsWith('.liquid')).map((f) => `| \`${f}\` | ${schemaName(readFileSync(join(T, 'sections', f), 'utf8'))} |`).join('\n')}

## Snippets (\`snippets/\`)

| Archivo | Descripción |
|---|---|
${ls('snippets').map((f) => `| \`${f}\` | ${firstComment(readFileSync(join(T, 'snippets', f), 'utf8')).replace(/\|/g, '/')} |`).join('\n')}

## Assets (\`assets/\`)

| Archivo | Tamaño | Descripción |
|---|---|---|
${ls('assets').map((f) => `| \`${f}\` | ${size(join(T, 'assets', f))} | ${assets[f] || ''} |`).join('\n')}

## Herramientas (\`tools/\`, fuera del ZIP)

| Archivo | Para qué sirve |
|---|---|
| \`validate-theme.mjs\` | Validador estático (JSON, schemas, Liquid, referencias, traducciones, contraste) |
| \`generate-templates.mjs\` | Genera \`theme/templates/*.json\` |
| \`build-locale.mjs\` + \`locale/es.flat.txt\` | Compila las cadenas a \`theme/locales/es.default.json\` |
| \`build-zip.mjs\` | Crea el ZIP del tema y su SHA-256 |
| \`compute-bands.mjs\` + \`bands.config.json\` | Calcula bandas de filtro |
| \`list-files.mjs\` | Genera este registro |
| \`preview/\` | Intérprete de Liquid de pruebas, datos de prueba, servidor de previsualización y capturas |
| \`tests/\` | Pruebas end-to-end en Chromium y generador del informe |
`];
writeFileSync(join(root, 'docs/12-registro-de-archivos.md'), out.join('\n'));
console.log('docs/12-registro-de-archivos.md generado');
