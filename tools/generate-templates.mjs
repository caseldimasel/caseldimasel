#!/usr/bin/env node
// Genera theme/templates/*.json a partir de las definiciones de abajo.
// Las plantillas JSON de Shopify no heredan los bloques de los "presets", así que se escriben aquí
// una sola vez y se evitan divergencias. Uso: node tools/generate-templates.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'theme', 'templates');
mkdirSync(root, { recursive: true });

const out = (name, sections, order) => {
  const data = { sections, order: order ?? Object.keys(sections) };
  writeFileSync(join(root, name + '.json'), JSON.stringify(data, null, 2) + '\n');
};

const blocks = (prefix, list) => {
  const b = {};
  const order = [];
  list.forEach((item, i) => {
    const id = `${prefix}-${i + 1}`;
    b[id] = item;
    order.push(id);
  });
  return { blocks: b, block_order: order };
};

// ---------- Bloques reutilizables ----------
const steps = blocks('step', [
  { type: 'step', settings: { title: 'Nos cuentas qué tienes', text: 'Nos explicas qué es y qué lo hace especial. Cuanto más personal sea la historia, mejor.' } },
  { type: 'step', settings: { title: 'Valoramos si encaja', text: 'Miramos si encaja en Sidonia y acordamos contigo cómo trabajar.' } },
  { type: 'step', settings: { title: 'Grabamos y contamos su historia', text: 'Vamos a verla, la grabamos y preparamos un vídeo con una narración cuidada.' } },
  { type: 'step', settings: { title: 'La presentamos a nuestra comunidad', text: 'La publicamos y atendemos el interés que genere, según el servicio que contrates.' } }
]);

const criteria = blocks('criterion', [
  { type: 'criterion', settings: { title: 'Historia', text: 'Una vida detrás: quién la tuvo, qué ha vivido, por qué importa.' } },
  { type: 'criterion', settings: { title: 'Carácter', text: 'Personalidad propia, que se note al verla y al oírla.' } },
  { type: 'criterion', settings: { title: 'Diseño', text: 'Una forma de resolver las cosas que merece ser mirada.' } },
  { type: 'criterion', settings: { title: 'Singularidad', text: 'Algo que la distingue de otras piezas parecidas.' } },
  { type: 'criterion', settings: { title: 'Cuidado', text: 'Se nota que alguien se ha ocupado de ella.' } },
  { type: 'criterion', settings: { title: 'Procedencia', text: 'Un origen interesante que se pueda contar.' } }
]);

const q = (question, answer) => ({ type: 'question', settings: { question, answer: `<p>${answer}</p>` } });

const faqHome = blocks('q', [
  q('¿Qué piezas seleccionáis?', 'Piezas con historia, carácter, diseño, singularidad, cuidado o una procedencia interesante. No hace falta que sean caras ni antiguas: lo que importa es que haya algo que contar.'),
  q('¿Qué información necesitáis para estudiar mi pieza?', 'Qué es, dónde está, qué la hace especial, cuál es tu relación con ella y cómo prefieres que te contactemos. Puedes añadir un enlace a un vídeo, una carpeta o un anuncio existente. En esta fase no pedimos escrituras, DNI ni documentación sensible.'),
  q('¿Cómo es la grabación?', 'Vamos a ver la pieza y la grabamos para contar su historia. La fecha, el lugar y lo que necesitamos de ti lo acordamos contigo después de contactar.'),
  q('¿Cómo pido información sobre una pieza?', 'Desde su ficha puedes escribirnos por WhatsApp o por correo, o usar el formulario. Todos los canales incluyen el nombre y la referencia de la pieza.'),
  q('¿Qué ocurre después de contactar?', 'Revisamos tu mensaje y te respondemos por el canal que prefieras. Si la pieza encaja, hablamos de cómo trabajar juntos. Enviar la solicitud no implica ningún compromiso de venta por ninguna de las partes.')
]);

const faqBuyer = (thing, dataText) => blocks('q', [
  q('¿Qué significan Disponible, Reservado y Vendido?', 'Disponible: la pieza admite consultas. Reservado: de momento no está disponible. Vendido: ya tiene nuevo propietario y se conserva en el archivo para que veas cómo contamos cada historia.'),
  q('¿Qué datos aparecen en la ficha?', dataText),
  q('¿Cómo pregunto por ' + thing + '?', 'Desde su ficha puedes escribirnos por WhatsApp o por correo, o usar el formulario. Todos los canales incluyen el nombre y la referencia de la pieza, y puedes guardarla para volver a verla.')
]);
const faqGarage = faqBuyer('un coche', 'Los que han aportado el propietario o el equipo: año, kilometraje, cambio, combustible y otros. Si un dato no aparece es que todavía no lo conocemos: pregúntanos y lo comprobamos.');
const faqHarbor = faqBuyer('un barco', 'Los que han aportado el propietario o el equipo: constructor, año, eslora, motorización y otros. Si un dato no aparece es que todavía no lo conocemos: pregúntanos y lo comprobamos.');
const faqEstate = faqBuyer('una casa', 'Los que han aportado el propietario o el equipo: superficie, dormitorios, tipo de inmueble y otros. La ubicación se muestra de forma aproximada; no publicamos la dirección exacta. Si un dato no aparece, pregúntanos.');

const faq = (b, heading = 'Preguntas frecuentes') => ({ type: 'faq', settings: { heading }, ...b });
const ownerCta = () => ({ type: 'owner-cta', settings: {} });

// ---------- Inicio ----------
out('index', {
  hero: { type: 'hero', settings: {} },
  divisions: { type: 'divisions', settings: {} },
  selection: { type: 'featured-listings', settings: {} },
  how: { type: 'how-we-sell', settings: {}, ...steps },
  story: { type: 'featured-story', settings: {} },
  community: { type: 'community', settings: {} },
  criteria: { type: 'selection-criteria', settings: {}, ...criteria },
  testimonials: { type: 'testimonials', settings: {} },
  cta: ownerCta(),
  faq: faq(faqHome)
}, ['hero', 'divisions', 'selection', 'how', 'story', 'community', 'criteria', 'testimonials', 'cta', 'faq']);

// ---------- Colecciones ----------
out('collection', {
  main: { type: 'main-collection', settings: { category: '', show_description: true } },
  cta: ownerCta()
});
out('collection.garage', {
  main: { type: 'main-collection', settings: { category: 'garage', show_description: true } },
  faq: faq(faqGarage),
  cta: ownerCta()
}, ['main', 'faq', 'cta']);
out('collection.harbor', {
  main: { type: 'main-collection', settings: { category: 'harbor', show_description: true } },
  faq: faq(faqHarbor),
  cta: ownerCta()
}, ['main', 'faq', 'cta']);
out('collection.estate', {
  main: { type: 'main-collection', settings: { category: 'estate', show_description: true } },
  faq: faq(faqEstate),
  cta: ownerCta()
}, ['main', 'faq', 'cta']);
out('collection.archive', {
  main: { type: 'main-collection', settings: { category: '', archive: true, show_description: true } }
});

// ---------- Fichas ----------
const productSections = (faqBlocks) => ({
  main: { type: 'main-product', settings: {} },
  story: { type: 'product-story', settings: {} },
  specs: { type: 'product-specs', settings: {} },
  timeline: { type: 'product-timeline', settings: {} },
  inquiry: { type: 'product-inquiry', settings: {} },
  related: { type: 'related-listings', settings: {} },
  faq: faq(faqBlocks)
});
const productOrder = ['main', 'story', 'specs', 'timeline', 'inquiry', 'related', 'faq'];
out('product', productSections(faqHome), productOrder);
out('product.garage', productSections(faqGarage), productOrder);
out('product.harbor', productSections(faqHarbor), productOrder);
out('product.estate', productSections(faqEstate), productOrder);

// ---------- Páginas ----------
out('page', { main: { type: 'main-page', settings: { show_title: true } } });

out('page.legal', { main: { type: 'main-page', settings: { show_title: true } } });

out('page.sell', {
  header: {
    type: 'page-header',
    settings: {
      eyebrow: 'Para propietarios',
      text: 'Sidonia ayuda a propietarios a vender coches, barcos y casas que tienen carácter, historia y personalidad. Seleccionamos lo que publicamos, vamos a grabarlo y contamos su historia ante una comunidad que sepa apreciarlo.',
      button_label: 'Cuéntanos su historia',
      button_url: '#solicitud',
      show_breadcrumbs: true
    }
  },
  story: { type: 'featured-story', settings: { heading: 'Así presentamos una pieza' } },
  how: { type: 'how-we-sell', settings: { show_sell_cta: false, show_how_link: true }, ...steps },
  community: { type: 'community', settings: {} },
  criteria: { type: 'selection-criteria', settings: {}, ...criteria },
  form: { type: 'sell-form', settings: {} },
  faq: faq(faqHome)
}, ['header', 'story', 'how', 'community', 'criteria', 'form', 'faq']);

out('page.how-it-works', {
  header: { type: 'page-header', settings: { eyebrow: 'Para propietarios', text: 'Cómo trabajamos, de la primera conversación a la presentación de tu pieza.', show_breadcrumbs: true } },
  how: { type: 'how-we-sell', settings: {}, ...steps },
  story: { type: 'featured-story', settings: {} },
  criteria: { type: 'selection-criteria', settings: {}, ...criteria },
  faq: faq(faqHome),
  cta: ownerCta()
}, ['header', 'how', 'story', 'criteria', 'faq', 'cta']);

out('page.about', {
  header: { type: 'page-header', settings: { eyebrow: 'Sobre Sidonia', text: 'Una plataforma con criterio editorial, tecnología útil y sensibilidad humana para coches, barcos y casas con carácter.', show_breadcrumbs: true } },
  text: { type: 'rich-text', settings: { heading: 'Qué es Sidonia', text: '<p>Sidonia ayuda a propietarios a vender coches, barcos y casas que tienen carácter, historia y personalidad. Descubrimos qué hace especial cada pieza, vamos a grabarla y la presentamos con una narración cuidada ante una comunidad que pueda apreciarla.</p><p>Edita este texto desde el personalizador con la historia y los valores reales de Sidonia.</p>', width: 'narrow' } },
  criteria: { type: 'selection-criteria', settings: {}, ...criteria },
  team: { type: 'team', settings: {} },
  community: { type: 'community', settings: {} },
  cta: ownerCta()
}, ['header', 'text', 'criteria', 'team', 'community', 'cta']);

out('page.favorites', {
  main: { type: 'main-favorites', settings: {} }
});

out('page.contact', {
  header: { type: 'page-header', settings: { eyebrow: 'Contacto', text: 'Elige el canal que prefieras. Si no estás seguro, el formulario siempre funciona.', show_breadcrumbs: true } },
  main: { type: 'main-contact', settings: {} }
}, ['header', 'main']);

out('page.wanted', {
  header: { type: 'page-header', settings: { eyebrow: 'Busco algo', show_breadcrumbs: true } },
  form: { type: 'wanted-form', settings: {} }
}, ['header', 'form']);

// ---------- Resto ----------
out('search', { main: { type: 'main-search', settings: {} } });
out('404', { main: { type: 'main-404', settings: {} } });
out('cart', { main: { type: 'main-cart', settings: {} } });
out('blog', { main: { type: 'main-blog', settings: {} } });
out('article', { main: { type: 'main-article', settings: {} } });
out('list-collections', { main: { type: 'main-list-collections', settings: {} } });
out('password', { main: { type: 'main-password', settings: {} } });

console.log('Plantillas generadas en', root);
