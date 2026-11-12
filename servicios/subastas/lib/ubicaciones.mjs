/* SIDONIA · La ubicación de cada anuncio, sacada de su descripción, para la tarjeta («📍 Madrid») y el filtro
 * «Localización». Panel › Ubicaciones: recorre todos los productos y, a los que no la tienen, les pone el metacampo
 * custom.provincia (lo que leen la tarjeta y el filtro) y la etiqueta con la provincia (por ejemplo «Madrid»).
 *
 * Las reglas son las del filtro del tema (snippets/sidonia-filters.liquid y assets/sidonia-filters.js):
 *   - «📍 Ubicación: Madrid», «📍 Localización: Sitges» o «📍 Madrid» (pocas palabras); «📍 Origen: …», no;
 *   - una línea «Ubicación: …» o «Localización: …», o «Ubicación» sola con el sitio en la línea de debajo;
 *   - del sitio se saca la provincia («Pozuelo de Alarcón» → Madrid, «Marbella» → Málaga).
 */

export const PROVINCIAS = {
  madrid: 'Madrid', majadahonda: 'Madrid', pozuelo: 'Madrid', aranjuez: 'Madrid', alcobendas: 'Madrid', 'las rozas': 'Madrid',
  boadilla: 'Madrid', 'la moraleja': 'Madrid', 'san sebastián de los reyes': 'Madrid', 'tres cantos': 'Madrid', getafe: 'Madrid',
  'alcalá de henares': 'Madrid', 'collado villalba': 'Madrid', torrelodones: 'Madrid', 'villaviciosa de odón': 'Madrid',
  barcelona: 'Barcelona', sitges: 'Barcelona', sabadell: 'Barcelona', terrassa: 'Barcelona', badalona: 'Barcelona',
  bilbao: 'Vizcaya', vizcaya: 'Vizcaya', bizkaia: 'Vizcaya', getxo: 'Vizcaya',
  valencia: 'Valencia', sevilla: 'Sevilla', 'málaga': 'Málaga', malaga: 'Málaga', marbella: 'Málaga', mijas: 'Málaga',
  'ojén': 'Málaga', butibamba: 'Málaga', estepona: 'Málaga', benalmádena: 'Málaga', fuengirola: 'Málaga',
  ibiza: 'Islas Baleares', eivissa: 'Islas Baleares', mallorca: 'Islas Baleares', palma: 'Islas Baleares', menorca: 'Islas Baleares',
  baleares: 'Islas Baleares', formentera: 'Islas Baleares',
  sotogrande: 'Cádiz', conil: 'Cádiz', 'cádiz': 'Cádiz', cadiz: 'Cádiz', 'puerto de santa maría': 'Cádiz', jerez: 'Cádiz', tarifa: 'Cádiz',
  toledo: 'Toledo', consuegra: 'Toledo', tarragona: 'Tarragona', salou: 'Tarragona',
  santander: 'Cantabria', liencres: 'Cantabria', cantabria: 'Cantabria', pamplona: 'Navarra', navarra: 'Navarra',
  'ávila': 'Ávila', avila: 'Ávila', tenerife: 'Santa Cruz de Tenerife', segovia: 'Segovia', valladolid: 'Valladolid',
  'la rioja': 'La Rioja', 'logroño': 'La Rioja', 'gijón': 'Asturias', gijon: 'Asturias', oviedo: 'Asturias', asturias: 'Asturias',
  'san sebastián': 'Guipúzcoa', 'san sebastian': 'Guipúzcoa', donostia: 'Guipúzcoa', 'guipúzcoa': 'Guipúzcoa', gipuzkoa: 'Guipúzcoa',
  lloret: 'Girona', girona: 'Girona', gerona: 'Girona', 'costa brava': 'Girona', zaragoza: 'Zaragoza', alicante: 'Alicante',
  'jávea': 'Alicante', javea: 'Alicante', denia: 'Alicante', 'dénia': 'Alicante', benidorm: 'Alicante', altea: 'Alicante',
  murcia: 'Murcia', cartagena: 'Murcia', granada: 'Granada', 'córdoba': 'Córdoba', cordoba: 'Córdoba', salamanca: 'Salamanca',
  burgos: 'Burgos', 'león': 'León', 'a coruña': 'A Coruña', 'la coruña': 'A Coruña', pontevedra: 'Pontevedra', vigo: 'Pontevedra',
  'las palmas': 'Las Palmas', 'gran canaria': 'Las Palmas', lanzarote: 'Las Palmas', fuerteventura: 'Las Palmas',
  castellón: 'Castellón', castellon: 'Castellón', huelva: 'Huelva', almería: 'Almería', almeria: 'Almería', jaén: 'Jaén',
  badajoz: 'Badajoz', cáceres: 'Cáceres', guadalajara: 'Guadalajara', cuenca: 'Cuenca', 'ciudad real': 'Ciudad Real',
  albacete: 'Albacete', lleida: 'Lleida', lérida: 'Lleida', huesca: 'Huesca', teruel: 'Teruel', soria: 'Soria',
  palencia: 'Palencia', zamora: 'Zamora', 'vitoria': 'Álava', 'álava': 'Álava', lugo: 'Lugo', ourense: 'Ourense',
  andorra: 'Andorra', portugal: 'Portugal', lisboa: 'Portugal', francia: 'Francia'
};

/** La provincia de un sitio («Pozuelo de Alarcón (Madrid)» → «Madrid»), la que antes aparece en el texto */
export function provinciaDe(texto) {
  const low = String(texto || '').toLowerCase();
  let mejor = null;
  for (const [sitio, prov] of Object.entries(PROVINCIAS)) {
    const re = new RegExp(`(^|[^a-záéíóúñü])${sitio.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-záéíóúñü])`);
    const m = re.exec(low);
    if (m && (!mejor || m.index < mejor[0])) mejor = [m.index, prov];
  }
  return mejor ? mejor[1] : '';
}

/** El sitio donde está el anuncio según su descripción (HTML), o '' si no lo dice */
export function ubicacionDe(html) {
  const texto = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h[1-6]|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ');
  const lineas = texto.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  let corta = '';
  for (let i = 0; i < lineas.length; i += 1) {
    const l = lineas[i];
    if (l.startsWith('📍')) {
      const resto = l.replace(/^📍\s*/, '');
      const dos = resto.indexOf(':');
      if (dos >= 0) {
        if (/ubicaci[oó]n|localizaci[oó]n/i.test(resto.slice(0, dos))) return resto.slice(dos + 1).trim().slice(0, 80);
        continue;   // «📍 Origen: …» no es la ubicación
      }
      if (!corta && resto.split(' ').length <= 5) corta = resto.slice(0, 80);
      continue;
    }
    // Sin chincheta: «Ubicación: Madrid» (también detrás de otro emoji) o «Ubicación» con el sitio debajo
    const sin = l.replace(/^[^\p{L}\p{N}]+/u, '');
    if (/^(ubicaci[oó]n|localizaci[oó]n)\b/i.test(sin) && sin.length <= 90) {
      const dos = sin.indexOf(':');
      if (dos >= 0 && sin.slice(dos + 1).trim()) return sin.slice(dos + 1).trim().slice(0, 80);
      if (lineas[i + 1] && lineas[i + 1].length <= 80) return lineas[i + 1].replace(/^[^\p{L}\p{N}]+/u, '').trim();
    }
  }
  return corta;
}

/** Lo que va en el producto: la provincia si se reconoce; si no, el sitio tal cual (lo primero antes de la coma) */
export function provinciaDeDescripcion(html) {
  const sitio = ubicacionDe(html);
  if (!sitio) return { sitio: '', provincia: '' };
  return { sitio, provincia: provinciaDe(sitio) || sitio.split(',')[0].trim() };
}

/**
 * Recorre todos los productos de la tienda y pone la ubicación a los que no la tienen: el metacampo custom.provincia
 * y una etiqueta con la provincia. Con sobrescribir, también a los que ya la tienen. Devuelve el informe.
 */
export async function rellenarUbicaciones(gql, { sobrescribir = false, etiqueta = true } = {}) {
  const informe = [];
  const poner = [];
  const etiquetas = [];
  let despues = null;
  do {
    const d = await gql(`query($despues: String) { products(first: 100, after: $despues, query: "status:active OR status:draft") {
      nodes { id handle title tags descriptionHtml provincia: metafield(namespace: "custom", key: "provincia") { value } }
      pageInfo { hasNextPage endCursor } } }`, { despues });
    for (const p of d.products.nodes) {
      const actual = (p.provincia?.value || '').trim();
      const { sitio, provincia } = provinciaDeDescripcion(p.descriptionHtml);
      if (actual && !sobrescribir) {
        informe.push({ handle: p.handle, titulo: p.title, sitio: actual, provincia: actual, estado: 'ya' });
        if (etiqueta && !p.tags.includes(actual)) etiquetas.push({ id: p.id, tag: actual });
        continue;
      }
      informe.push({ handle: p.handle, titulo: p.title, sitio, provincia, estado: provincia ? 'nuevo' : 'sin' });
      if (!provincia) continue;
      if (provincia !== actual) poner.push({ ownerId: p.id, namespace: 'custom', key: 'provincia', type: 'single_line_text_field', value: provincia.slice(0, 100) });
      if (etiqueta && !p.tags.includes(provincia)) etiquetas.push({ id: p.id, tag: provincia });
    }
    despues = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (despues);
  for (let i = 0; i < poner.length; i += 25) {
    const r = await gql(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`, { m: poner.slice(i, i + 25) });
    const errs = r.metafieldsSet.userErrors;
    if (errs.length) throw new Error(`Shopify: ${errs.map((e) => e.message).join(' · ')}`);
  }
  for (const { id, tag } of etiquetas) {
    const r = await gql(`mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`, { id, tags: [tag] });
    const errs = r.tagsAdd.userErrors;
    if (errs.length) throw new Error(`Shopify etiquetas: ${errs.map((e) => e.message).join(' · ')}`);
  }
  return informe;
}
