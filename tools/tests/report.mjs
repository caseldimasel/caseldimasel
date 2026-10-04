#!/usr/bin/env node
// Genera docs/09-informe-de-pruebas.md a partir de la última ejecución (tools/tests/last-run.json),
// del validador y de los datos medidos. Uso: node tools/tests/e2e.mjs && node tools/tests/report.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'last-run.json'), 'utf8'));
let val;
try {
  val = JSON.parse(execFileSync('node', [join(root, 'tools/validate-theme.mjs'), '--json'], { encoding: 'utf8' }));
} catch (e) {
  val = JSON.parse(e.stdout);
}
const assets = readdirSync(join(root, 'theme/assets')).map((f) => [f, statSync(join(root, 'theme/assets', f)).size]);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

const groups = {};
for (const r of run.results) {
  const g = r.name.startsWith('Sin desbordes') ? 'Responsive' : null;
  (groups[g || 'General'] = groups[g || 'General'] || []).push(r);
}

const lines = [];
lines.push(`# 09 · Informe de pruebas

> Generado el ${run.at.slice(0, 10)} con \`node tools/tests/e2e.mjs && node tools/tests/report.mjs\`. **Léelo entero antes de fiarte de las marcas verdes**: describe qué se ha probado, con qué y qué NO se ha podido probar.

## 1. Cómo se ha probado

| Capa | Herramienta | Qué demuestra |
|---|---|---|
| Estructura, JSON, schemas, Liquid (balance de etiquetas, filtros, referencias), traducciones, contraste de la paleta | \`tools/validate-theme.mjs\` (propio) | El tema es coherente y no tiene referencias rotas |
| Plantillas Liquid renderizadas | \`tools/preview/liquid.mjs\` (**intérprete propio**, no el de Shopify) + datos de prueba \`tools/preview/store.mjs\` | Que las plantillas producen el HTML esperado con datos de ejemplo |
| Comportamiento en navegador | Chromium (Playwright) contra la previsualización local, 5 anchos | Layout, JS, vídeo, filtros, favoritos, formularios, accesibilidad básica |

Resultado de la última ejecución: **${run.total - run.failed} de ${run.total} pruebas correctas**; validador: **${val.errors.length} errores**, ${val.warnings.length} avisos informativos.

## 2. Lo que NO se ha podido hacer en esta entrega

Estas limitaciones son del entorno de desarrollo (sin acceso a Internet salvo el repositorio) y **no están resueltas**:

1. **Shopify Theme Check y Shopify CLI no se han ejecutado** (no se pudo instalar nada desde npm). Sustituto parcial: \`validate-theme.mjs\`, que **no** cubre todas las reglas de Theme Check. Ejecuta \`shopify theme check --path theme\` y corrige lo que aparezca.
2. **La documentación vigente de Shopify no se pudo consultar** (shopify.dev bloqueado). Todo lo que depende de ella está en la tabla del apartado 5 como «por verificar».
3. **El HTML de las pruebas lo genera un intérprete propio**, no el motor de Shopify. Puede diferir en detalles (formateo de números, espacios, filtros no usados). No se ha instalado ni probado el tema en una tienda real.
4. **No se ha comprobado la recepción real de formularios** (el correo de la tienda, las etiquetas de cliente, el comportamiento ante errores en páginas que no son \`/contact\`, la pantalla anti-spam de Shopify). El servidor de pruebas simula esas respuestas.
5. **No se ha probado el bloqueo de compra** (\`/cart/add\`, enlaces de carrito, checkout) porque no hay tienda.
6. **Solo Chromium.** No se ha probado en Safari/WebKit, Firefox ni en dispositivos reales. Los anchos 360, 390, 768, 1024 y 1440 son ventanas de Chromium, no móviles reales (táctil, teclado virtual, barra de navegador, \`safe-area\`).
7. **Accesibilidad**: auditoría automática propia (idioma, landmarks, ids, etiquetas, nombres, alt, encabezados, foco, contraste calculado). **No se ha probado con lector de pantalla** (VoiceOver, NVDA, TalkBack) ni con una herramienta como axe o Lighthouse. Objetivo WCAG 2.2 AA: **no certificado**.
8. **Rendimiento**: solo se midió CLS local (0,000) y se comprobó que no hay terceros ni vídeos en listados. **LCP e INP no se han medido** (no hay Lighthouse ni red real). Las metas (LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1) son objetivos a medir en la tienda, no resultados.
9. **Reducción de movimiento, ahorro de datos y bloqueo de autoplay** se probaron con emulación de Chromium; la detección de ahorro de datos (\`navigator.connection\`) no existe en todos los navegadores.
10. **El tema se subió a Shopify cero veces**: la validación de subida (límites de nombres, tipos de ajustes, fuentes por defecto) no se ha ejecutado.

## 3. Resultados de las pruebas de navegador

| Resultado | Prueba | Detalle |
|---|---|---|`);
for (const r of run.results) lines.push(`| ${r.ok ? '✔' : '✘'} | ${r.name.replace(/\|/g, '\\|')} | ${(r.ok ? r.info : r.error || '').toString().replace(/\|/g, '\\|')} |`);

lines.push(`
## 4. Validador estático y contraste

Contraste calculado de la paleta por defecto (WCAG, fórmula de luminancia relativa). Los colores de división usados como **texto** se oscurecen automáticamente si no llegan a 4,5:1.

| Pareja | Ratio | Mínimo | Resultado |
|---|---|---|---|`);
for (const c of val.contrast) lines.push(`| ${c.name} | ${c.ratio}:1 | ${c.min}:1 | ${c.ok ? 'cumple' : 'NO cumple'} |`);
lines.push(`
${val.info.map((i) => '- ' + i).join('\n')}

Peso de los recursos propios (sin comprimir; el CDN de Shopify los sirve comprimidos):

| Recurso | Tamaño |
|---|---|
${assets.map(([f, s]) => `| ${f} | ${kb(s)} |`).join('\n')}

Avisos del validador (informativos): ${val.warnings.length ? val.warnings.map((w) => w.msg.slice(0, 120)).join(' · ') : 'ninguno'}.

## 5. Hechos de Shopify por verificar (no se pudo consultar la documentación)

Son suposiciones razonables sobre las que se ha construido el tema. **Compruébalas al subirlo**; cada fila dice dónde se rompería algo si no se cumple.

| # | Suposición | Si no se cumple |
|---|---|---|
| 1 | El nombre de sección (\`name\`) admite hasta 25 caracteres y los ajustes usados son válidos (\`page\`, \`video_url\` con \`accept\`, \`font_picker\` con \`assistant_n4\`, \`link_list\` con \`main-menu\`/\`footer\`) | La subida del ZIP se rechaza con un mensaje que indica el archivo |
| 2 | \`collection.filters\` / \`search.filters\` devuelven los filtros configurados en Search & Discovery, incluidos filtros de metacampos de texto | No hay filtros: revisa la configuración de la app |
| 3 | Los metacampos de texto con opciones se pueden usar en colecciones inteligentes y filtros | Usar etiquetas en su lugar |
| 4 | La Section Rendering API (\`?section_id=\`) devuelve la sección con los filtros de la URL, y también con \`page=\` | Los filtros recargan la página completa (el tema ya hace esa alternativa) |
| 5 | \`/products/<handle>?view=card\` renderiza \`templates/product.card.liquid\` junto a una plantilla \`product.json\` | La página de Favoritos mostraría «Pieza retirada» en todas: sustituir por otra vía |
| 6 | Un metacampo \`file_reference\` de vídeo expone \`sources\` (formato, altura, url, mime) y \`preview_image\` en Liquid | No habría vídeo: usar medios del producto (ya hay alternativa) |
| 7 | \`metafield_tag\` / \`metafield_text\` funcionan sobre texto enriquecido y de varias líneas | La historia no se vería; usar el texto plano |
| 8 | La lista de referencias a metaobjetos (\`timeline\`) permite \`entry.period.value\` | La cronología quedaría vacía |
| 9 | \`{% form 'contact' %}\` en páginas de producto/página personalizada: tras éxito vuelve a la misma página con \`posted_successfully?\`; tras error, la renderiza con \`form.errors\` y los valores conservados | El JS detecta respuestas no esperadas y envía de forma nativa, pero hay que verlo |
| 10 | \`contact[tags]\` añade etiquetas al cliente | Quitar el campo oculto o gestionar etiquetas con Flow |
| 11 | \`Shopify.customerPrivacy.analyticsProcessingAllowed()\` está disponible tras \`Shopify.loadFeatures(consent-tracking-api)\` | La analítica (apagada por defecto) no enviaría nada: es el comportamiento seguro |
| 12 | \`/search/suggest?section_id=predictive-search\` con \`resources[options][unavailable_products]=last\` incluye productos sin stock | Sin sugerencias: quitar el parámetro |
| 13 | Los productos sin existencias siguen apareciendo en colecciones y búsqueda | Revisar Search & Discovery → Configuración |
| 14 | \`image.presentation.focal_point\` está disponible en imágenes de producto y de ajustes | El recorte usaría el centro |
| 15 | El precio de variante 0,00 y el inventario 0 impiden la compra y el producto sigue siendo visible | Revisar \`05\` |

## 6. Comprobaciones en Shopify antes de publicar (checklist)

- [ ] El ZIP se sube sin errores y aparece sin publicar.
- [ ] \`shopify theme check --path theme\`: cero errores.
- [ ] Una pieza de prueba rotulada [PRUEBA] por categoría: la ficha muestra sus datos y oculta los vacíos.
- [ ] \`POST /cart/add.js\` con la variante de una pieza devuelve error de agotado.
- [ ] Un formulario de cada tipo llega al correo de la tienda con pieza, referencia, categoría y URL; el cliente queda etiquetado.
- [ ] Filtrar por una marca que solo existe en la página 2 devuelve esas piezas; atrás/adelante y recarga conservan el estado.
- [ ] Favoritos: guardar, recargar, vender una pieza y comprobar «Vendido» en la página de favoritos.
- [ ] WhatsApp y email abren con el texto correcto en móvil real.
- [ ] Vídeo vertical en iPhone (Safari): reproduce, el sonido solo tras el toque, pantalla completa.
- [ ] Lector de pantalla (VoiceOver/NVDA): cabecera, tarjetas, filtros, modal de vídeo, formularios.
- [ ] Lighthouse móvil en home, colección y ficha: LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1.
- [ ] Editor de temas: cargar, editar, mover y eliminar cada sección sin errores de consola.
`);
writeFileSync(join(root, 'docs/09-informe-de-pruebas.md'), lines.join('\n'));
console.log('docs/09-informe-de-pruebas.md generado');
