// Genera las plantillas JSON del kit (kit/templates/*.json) a partir de una única definición.
// Uso: node tools/build-templates.mjs          (escribe kit/templates/*.json)
//      node tools/build-templates.mjs --check  (no escribe; sale con 1 si alguna plantilla difiere)
// Las plantillas solo usan secciones sidonia-*; su reconciliación con las de Impact se decide
// en la auditoría (ver integration/manifest.json y docs/02-instalacion.md).
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'kit', 'templates');
mkdirSync(OUT, { recursive: true });

const HEADER = '/*\n * ------------------------------------------------------------\n * Plantilla del kit Sidonia para Impact. Generada por tools/build-templates.mjs.\n * Edítala desde el editor de temas; si regeneras, se pierden los cambios hechos aquí a mano.\n * ------------------------------------------------------------\n */\n';

function blocks(type, list) {
  const out = { blocks: {}, block_order: [] };
  list.forEach((settings, i) => {
    const id = `${type}_${i + 1}`;
    out.blocks[id] = { type, settings };
    out.block_order.push(id);
  });
  return out;
}

const STEPS = blocks('step', [
  { title: 'Nos cuentas qué tienes', text: 'Qué es, dónde está y, sobre todo, qué lo hace especial para ti.' },
  { title: 'Valoramos si encaja', text: 'Lo estudiamos con calma y, si encaja en Sidonia, acordamos el proceso contigo.' },
  { title: 'Grabamos su historia', text: 'Vamos a verlo, lo grabamos y contamos su historia con una narración cuidada.' },
  { title: 'La presentamos', text: 'La mostramos a nuestra comunidad y atendemos el interés que genera, según el servicio contratado.' }
]);

const CRITERIA = blocks('criterion', [
  { title: 'Historia', text: 'Una vida vivida que merece ser contada.' },
  { title: 'Carácter', text: 'Algo que la hace reconocible entre muchas.' },
  { title: 'Diseño', text: 'Una forma pensada con intención.' },
  { title: 'Singularidad', text: 'Una pieza que no se encuentra en cualquier esquina.' },
  { title: 'Cuidado', text: 'Alguien la ha mantenido con atención.' },
  { title: 'Procedencia', text: 'Un origen o un recorrido interesante.' }
]);

const FAQ_GENERAL = [
  { question: '¿Qué tipo de piezas seleccionáis?', answer: '<p>Coches, barcos y casas con historia, carácter, diseño, cuidado o una procedencia interesante. No depende del precio ni de la antigüedad: valoramos qué hace especial a cada pieza y si podemos contarla bien.</p>', category: 'all' },
  { question: '¿Qué información necesitáis para estudiar mi pieza?', answer: '<p>Para empezar basta con lo esencial: qué es, dónde está, qué la hace especial y cómo contactar contigo. Si tienes fotos, vídeos o un anuncio publicado, puedes pegar el enlace. En esta fase no pedimos documentación personal.</p>', category: 'all' },
  { question: '¿Cómo es la grabación?', answer: '<p>Si la pieza encaja, acordamos contigo cómo y cuándo grabarla y escuchar su historia. Los detalles concretos se hablan contigo antes.</p>', category: 'all' },
  { question: '¿Cómo pido información sobre una pieza?', answer: '<p>Desde cada ficha puedes escribirnos por WhatsApp, por correo o con el formulario. El mensaje incluye la referencia de la pieza para que sepamos de cuál hablas.</p>', category: 'all' },
  { question: '¿Qué ocurre después de contactar?', answer: '<p>El equipo de Sidonia revisa tu mensaje y te contesta por el canal que prefieras. Si eres propietario, enviar la solicitud inicia una valoración de encaje: no implica aceptación ni compromiso de venta.</p>', category: 'all' }
];

const faq = (scope = 'auto', extra = {}) => ({ type: 'sidonia-faq', settings: { scope, ...extra }, ...blocks('question', FAQ_GENERAL) });
const ownerCta = (preselect = 'auto') => ({ type: 'sidonia-owner-cta', settings: { preselect } });

function template(sections) {
  const out = { sections: {}, order: [] };
  for (const [id, sec] of sections) {
    out.sections[id] = sec;
    out.order.push(id);
  }
  return out;
}

const T = {};

T['index'] = template([
  ['hero', { type: 'sidonia-hero', settings: { transparent_header: true, height: 'tall' } }],
  ['divisions', { type: 'sidonia-divisions', settings: { show_count: true } }],
  ['selection', { type: 'sidonia-listings', settings: { heading: 'Selección disponible', fallback_handle: 'destacadas', limit: 8, layout: 'grid', link_label: 'Ver todas las piezas' } }],
  ['how', { type: 'sidonia-how-we-sell', settings: { background: 'alt' }, ...STEPS }],
  ['story', { type: 'sidonia-story', settings: {} }],
  ['community', { type: 'sidonia-community', settings: {} }],
  ['criteria', { type: 'sidonia-criteria', settings: { background: 'surface' }, ...CRITERIA }],
  ['testimonials', { type: 'sidonia-testimonials', settings: {} }],
  ['owner_cta', ownerCta('none')],
  ['faq', faq('all')]
]);

T['collection.sidonia'] = template([['main', { type: 'sidonia-catalog', settings: { show_tabs: true } }], ['owner_cta', ownerCta('none')]]);
for (const key of ['garage', 'harbor', 'estate']) {
  T[`collection.${key}`] = template([
    ['main', { type: 'sidonia-catalog', settings: { show_tabs: true, show_community: false } }],
    ['faq', faq('auto', { heading: 'Preguntas frecuentes' })],
    ['owner_cta', ownerCta('auto')]
  ]);
  T[`product.${key}`] = template([
    ['main', { type: 'sidonia-listing', settings: { mobile_bar: true } }],
    ['story', { type: 'sidonia-listing-story', settings: {} }],
    ['specs', { type: 'sidonia-listing-specs', settings: {} }],
    ['details', { type: 'sidonia-listing-details', settings: {} }],
    ['timeline', { type: 'sidonia-listing-timeline', settings: {} }],
    ['inquiry', { type: 'sidonia-listing-inquiry', settings: {} }],
    ['related', { type: 'sidonia-listing-related', settings: {} }],
    ['owner_cta', ownerCta('auto')]
  ]);
}
T['collection.sold'] = template([['main', { type: 'sidonia-catalog', settings: { archive: true, show_tabs: false } }]]);
T['search'] = template([['main', { type: 'sidonia-catalog', settings: {} }]]);
T['404'] = template([['main', { type: 'sidonia-not-found', settings: {} }]]);

T['page.sell'] = template([
  ['header', { type: 'sidonia-page-header', settings: { eyebrow: 'Vender con Sidonia', heading: '¿Tienes algo que merece ser contado?', text: 'Seleccionamos coches, barcos y casas con alma. Cuéntanos qué tienes y estudiaremos si encaja.' } }],
  ['form', { type: 'sidonia-sell-form', settings: {} }],
  ['how', { type: 'sidonia-how-we-sell', settings: { show_ctas: false, background: 'alt' }, ...STEPS }],
  ['faq', faq('all')]
]);
T['page.how-it-works'] = template([
  ['header', { type: 'sidonia-page-header', settings: { eyebrow: 'Cómo vendemos', text: 'Descubrimos qué hace especial a cada pieza, la grabamos y contamos su historia para encontrar a quien sepa apreciarla.' } }],
  ['how', { type: 'sidonia-how-we-sell', settings: { heading: 'Paso a paso', show_more: false, background: 'bg' }, ...STEPS }],
  ['criteria', { type: 'sidonia-criteria', settings: { background: 'surface' }, ...CRITERIA }],
  ['story', { type: 'sidonia-story', settings: {} }],
  ['faq', faq('all')],
  ['owner_cta', ownerCta('none')]
]);
T['page.sidonia-about'] = template([
  ['header', { type: 'sidonia-page-header', settings: { eyebrow: 'Sobre Sidonia', show_page_content: true } }],
  ['criteria', { type: 'sidonia-criteria', settings: { background: 'surface' }, ...CRITERIA }],
  ['community', { type: 'sidonia-community', settings: { background: 'bg' } }],
  ['testimonials', { type: 'sidonia-testimonials', settings: {} }],
  ['owner_cta', ownerCta('none')]
]);
T['page.favorites'] = template([['main', { type: 'sidonia-favorites', settings: {} }]]);
T['page.sidonia-contact'] = template([
  ['header', { type: 'sidonia-page-header', settings: { eyebrow: 'Contacto' } }],
  ['form', { type: 'sidonia-contact-form', settings: { mode: 'general' } }]
]);
T['page.wanted'] = template([
  ['header', { type: 'sidonia-page-header', settings: { eyebrow: 'Cuéntanos qué buscas', text: 'Si buscas un coche, un barco o una casa con carácter, cuéntanoslo. Lo revisa el equipo de Sidonia.' } }],
  ['form', { type: 'sidonia-contact-form', settings: { mode: 'wanted', heading: 'Qué buscas', button: 'Enviar' } }]
]);

if (process.argv.includes('--check')) {
  const stale = Object.entries(T).filter(([name, data]) => {
    const f = join(OUT, `${name}.json`);
    return !existsSync(f) || readFileSync(f, 'utf8') !== HEADER + JSON.stringify(data, null, 2) + '\n';
  });
  stale.forEach(([name]) => console.log(`Desactualizada: kit/templates/${name}.json`));
  process.exit(stale.length ? 1 : 0);
}
for (const [name, data] of Object.entries(T)) {
  writeFileSync(join(OUT, `${name}.json`), HEADER + JSON.stringify(data, null, 2) + '\n');
}
console.log(`Plantillas generadas: ${Object.keys(T).length} en kit/templates/`);
