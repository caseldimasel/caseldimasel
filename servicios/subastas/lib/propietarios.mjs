/* SIDONIA · El propietario de cada coche que vende Sidonia, sacado de su historia («Carlos lleva toda la vida…»).
 * Panel › Propietarios: recorre los productos de Sidonia (vendor «Sidonia») y, a los que no lo tienen, les pone el
 * metacampo custom.propietario. La ficha lo enseña («Propietario: Carlos · Venta gestionada por Sidonia») y la tarjeta
 * también. Lo que no sale bien se corrige a mano en Shopify › Productos › el coche › Propietario.
 */

// Nombres de pila habituales (sin «Mercedes», que casi siempre es la marca)
const NOMBRES = new Set('Aarón Abel Abraham Adolfo Adrián Agustín Alba Alberto Alejandra Alejandro Alfonso Alfredo Alicia Almudena Álvaro Amparo Ana Andrea Andrés Ángel Ángela Ángeles Antonia Antonio Arturo Asier Aurora Beatriz Begoña Belén Benito Bernardo Blanca Borja Bruno Camila Carla Carlos Carmen Carolina Catalina Cayetana Cayetano César Clara Claudia Concepción Cristian Cristina Cristóbal Daniel Daniela David Diana Diego Dolores Domingo Eduardo Elena Elisa Emilio Enrique Ernesto Esperanza Esteban Esther Eugenia Eugenio Eva Federico Felipe Félix Fernando Fermín Francisca Francisco Gabriel Gabriela Gerardo Germán Gloria Gonzalo Gregorio Guillermo Gustavo Héctor Hugo Ignacio Íñigo Iñaki Inés Inmaculada Irene Isaac Isabel Ismael Iván Jaime Javier Jesús Joaquín Jordi Jorge José Josefa Josep Juan Juana Julia Julián Julio Laura Leire Leonardo Leopoldo Lola Lorena Lorenzo Lourdes Lucas Lucía Luis Luisa Manuel Manuela Marcos Margarita María Mariano Marina Mario Marta Martín Martina Mateo Matías Mercedes Micaela Miguel Mónica Nacho Natalia Nicolás Nieves Noelia Nuria Óscar Pablo Paco Paloma Patricia Paula Pedro Pepe Pilar Rafael Ramiro Ramón Raquel Raúl Ricardo Roberto Rocío Rodrigo Rosa Rosario Rubén Salvador Samuel Sandra Santiago Sara Sebastián Sergio Silvia Sofía Sonia Susana Teresa Tomás Valentín Valentina Verónica Vicente Víctor Virginia Xavier Yolanda'.split(' '));
// Palabras que pueden abrir una historia y no son un nombre
const NO_NOMBRE = new Set('Se La El Los Las Un Una Y Es Este Esta Estos Estas Hoy Durante Hace Estamos Su Sus En Con Lo Le A Al Desde Cuando Si No Nos Os Pocas Pero Para Por Como Aunque Tras Ya Nunca Siempre Aquí Ahora Hay Era Fue Mercedes'.split(' '));
// Verbos o palabras que suelen ir justo detrás del nombre del dueño al empezar la historia («Pau ya ha tenido…»)
const DETRAS = 'siempre|ya|es|lleva|vive|compró|tiene|ha|había|le|se|quería|quiso|encontró|conoció|decidió|heredó|fue|era|estaba|nunca|lo|la|y|llevaba|soñaba|soñó|trabaja|está|vio|descubrió';

/** El nombre del propietario en la historia de un producto (descripción HTML), o '' si no se nombra */
export function propietarioDeHistoria(html) {
  const texto = String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
  const m = texto.match(/Historia(.*?)(Ficha técnica|$)/i);
  const historia = (m ? m[1] : texto).trim();
  const conocido = (historia.match(/[A-ZÁÉÍÓÚÑ][a-záéíóúñüç]+/g) || []).find((p) => NOMBRES.has(p) && !NO_NOMBRE.has(p));
  if (conocido) return conocido;
  // Un nombre menos habitual al empezar: «Pau ya ha tenido…», «A François le…»
  const inicio = historia.match(new RegExp(`^(?:A |Para )?([A-ZÁÉÍÓÚÑ][a-záéíóúñüç]+)\\s+(?:${DETRAS})\\b`));
  return inicio && !NO_NOMBRE.has(inicio[1]) ? inicio[1] : '';
}

/** Recorre los productos de Sidonia y pone el propietario a los que no lo tienen. Devuelve el informe. */
export async function rellenarPropietarios(gql, { vendor = 'Sidonia', sobrescribir = false } = {}) {
  // El campo en Shopify, para poder verlo y cambiarlo en cada producto (si ya existe, Shopify lo dice y se sigue)
  await gql(`mutation($d: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $d) { userErrors { message } } }`,
    { d: { name: 'Propietario', namespace: 'custom', key: 'propietario', type: 'single_line_text_field', ownerType: 'PRODUCT', description: 'Dueño del coche (sale en la ficha y en la tarjeta)' } }).catch(() => null);
  const informe = [];
  const poner = [];
  let despues = null;
  do {
    const d = await gql(`query($q: String!, $despues: String) { products(first: 100, after: $despues, query: $q) {
      nodes { id handle title descriptionHtml propietario: metafield(namespace: "custom", key: "propietario") { value } }
      pageInfo { hasNextPage endCursor } } }`, { q: `vendor:'${vendor}'`, despues });
    for (const p of d.products.nodes) {
      const actual = p.propietario?.value || '';
      if (actual && !sobrescribir) { informe.push({ handle: p.handle, titulo: p.title, nombre: actual, estado: 'ya' }); continue; }
      const nombre = propietarioDeHistoria(p.descriptionHtml);
      informe.push({ handle: p.handle, titulo: p.title, nombre, estado: nombre ? 'nuevo' : 'sin' });
      if (nombre && nombre !== actual) poner.push({ ownerId: p.id, namespace: 'custom', key: 'propietario', type: 'single_line_text_field', value: nombre });
    }
    despues = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (despues);
  for (let i = 0; i < poner.length; i += 25) {
    const r = await gql(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`, { m: poner.slice(i, i + 25) });
    const errs = r.metafieldsSet.userErrors;
    if (errs.length) throw new Error(`Shopify: ${errs.map((e) => e.message).join(' · ')}`);
  }
  return informe;
}
