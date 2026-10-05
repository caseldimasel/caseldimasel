// Datos de PRUEBA del arnés. No forman parte del kit ni del tema ni de ningún ZIP.
// Todo va rotulado [PRUEBA]: no son piezas, cifras ni cuentas reales de Sidonia.
// Los coches usan las fotos aportadas por Sidonia en el prototipo anterior (solo como imagen de prueba);
// barcos y casas usan marcadores SVG generados por el servidor.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODEL = JSON.parse(readFileSync(join(ROOT, 'data', 'metafields.json'), 'utf8'));

export const IMAGES = {};
let imgSeq = 0;
export function image(label, w = 1600, h = 1200, color = '#8a7f6a', alt = '', focal = '50.0% 50.0%', photo) {
  const id = `i${++imgSeq}`;
  IMAGES[id] = { label, color, w, h, photo };
  return { id, width: w, height: h, alt, aspect_ratio: w / h, presentation: { focal_point: focal }, src: `/img/${id}` };
}

/** Logo de PRUEBA (texto «SIDONIA» en SVG): el arnés no tiene los PNG reales de la tienda. */
export function logoImage(tone = 'dark') {
  const id = `logo-${tone}`;
  IMAGES[id] = { label: 'SIDONIA', logo: tone, w: 1000, h: 200 };
  return { id, width: 1000, height: 200, alt: 'SIDONIA', aspect_ratio: 5, presentation: { focal_point: '50.0% 50.0%' }, src: `/img/${id}`, __str: `/img/${id}` };
}

export function video(ratio = 0.5625, poster) {
  const h = 1080;
  return {
    media_type: 'video',
    aspect_ratio: ratio,
    preview_image: poster || null,
    alt: '',
    sources: [
      { format: 'mp4', height: 1080, width: Math.round(h * ratio), mime_type: 'video/webm', url: '/fixtures/clip.webm' },
      { format: 'mp4', height: 480, width: Math.round(480 * ratio), mime_type: 'video/webm', url: '/fixtures/clip.webm?q=480' },
      { format: 'm3u8', height: 1080, width: Math.round(h * ratio), mime_type: 'application/x-mpegURL', url: '/fixtures/clip.m3u8' }
    ]
  };
}

const rich = (text) => ({ __mf: true, value: { __str: text }, html: text.split('\n\n').map((p) => `<p>${p}</p>`).join(''), text });

function mf(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    out[k] = v && v.__mf ? v : { value: v };
  }
  return { sidonia: out };
}

const CAR_PHOTOS = ['foto-alfa-giulia', 'foto-jaguar-e-type', 'foto-maserati-19', 'foto-ford-roadster', 'foto-maserati-lago', 'foto-porsche-911'];
let pid = 1000;
let photoIdx = 0;

export function makeProduct(o) {
  const id = ++pid;
  const kind = o.category === 'Coches' ? 'car' : o.category === 'Barcos' ? 'boat' : 'house';
  let cover = null;
  if (!o.noCover) {
    if (kind === 'car') cover = image(o.title, 2000, 1342, '#9a8f78', o.title, o.focal, CAR_PHOTOS[photoIdx++ % CAR_PHOTOS.length]);
    else cover = image(o.title, 1600, 1200, o.color || (kind === 'boat' ? '#2c5f86' : '#3d6b52'), o.title, o.focal);
  }
  const v = o.video === 'portrait' ? video(0.5625, cover) : o.video === 'landscape' ? video(1.7778, cover) : null;
  const data = {
    reference: o.ref, category: o.category, status: o.status, hook: o.hook, why_special: o.why, highlights: o.highlights,
    story: o.story ? rich(o.story) : undefined, provenance: o.provenance,
    country: o.country === undefined ? 'España' : o.country, region: o.region, city: o.city, location_precision: o.precision,
    owner_name: o.owner_name, owner_show_name: o.owner_show, owner_label: o.owner_label, owner_story: o.owner_story,
    price_mode: o.price_mode, price_amount: o.price, price_currency: o.currency,
    video: v, preview_clip: o.preview && v ? video(v.aspect_ratio, cover) : undefined, video_url: o.video_url, video_aspect: o.video_aspect,
    video_duration: o.duration, video_language: o.vlang,
    subtitles_file: o.subs ? { url: '/fixtures/subs.vtt' } : undefined, subtitles_lang: o.subs ? 'es' : undefined,
    transcript: o.transcript, social_url: o.social,
    condition_notes: o.condition, work_done: o.work, documents: o.documents, timeline: o.timeline, related: o.related, featured: o.featured,
    brand: o.brand, model: o.model, version: o.version, year: o.year, mileage_km: o.km, fuel: o.fuel, gearbox: o.gearbox, power_hp: o.power, color: o.mcolor,
    builder: o.builder, boat_type: o.boat_type, length_m: o.loa, beam_m: o.beam, engine: o.engine, engine_hours: o.hours, tax_regime: o.tax,
    property_type: o.ptype, area_value: o.area, area_unit: o.area_unit, plot_area: o.plot, bedrooms: o.beds, bathrooms: o.baths, built_period: o.period, energy_rating: o.energy,
    year_band: o.year_band, km_band: o.km_band, loa_band: o.loa_band, area_band: o.area_band, bedrooms_band: o.beds_band, price_band: o.price_band
  };
  const suffix = { Coches: 'garage', Barcos: 'harbor', Casas: 'estate' }[o.category];
  if (process.env.SIDONIA_SHOP_DATA) return shopLike(id, o, cover, data);
  return {
    id, handle: o.handle, title: o.title, url: `/products/${o.handle}`,
    description: o.description || '', vendor: o.brand || o.builder || '', type: o.category, tags: ['sidonia'],
    published_at: '2026-09-01T10:00:00Z', created_at: `2026-09-${String(1 + (id % 27)).padStart(2, '0')}T10:00:00Z`,
    template_suffix: suffix, featured_image: cover, images: cover ? [cover] : [], media: v ? [v] : [],
    available: false, object_type: 'product', metafields: mf(data), __data: data
  };
}

export function buildProducts() {
  const L = [];
  const A = makeProduct({
    handle: 'prueba-coche-a', title: '[PRUEBA] Coche de ejemplo A', ref: 'PR-G-001', category: 'Coches', status: 'Disponible', featured: true,
    hook: 'Texto de prueba: una línea de historia para la tarjeta.', why: 'Resumen de prueba de por qué es especial.', highlights: ['Hecho de prueba uno', 'Hecho de prueba dos'],
    story: 'Párrafo de historia de prueba uno.\n\nPárrafo de historia de prueba dos, con más texto para comprobar la lectura cómoda de una narración larga.',
    provenance: 'Procedencia de prueba.', region: 'Región de prueba', city: 'Ciudad de prueba', precision: 'Región',
    owner_name: 'Nombre de prueba', owner_show: true, owner_story: 'Historia pública de prueba del propietario.',
    price_mode: 'Publicado', price: 85000, currency: 'EUR', video: 'portrait', preview: true, duration: 83, vlang: 'Español', subs: true,
    transcript: 'Línea uno de la transcripción de prueba.\nLínea dos de la transcripción de prueba.', social: 'https://www.instagram.com/p/prueba/',
    condition: 'Observaciones de prueba sobre el estado.', work: ['Trabajo de prueba 1', 'Trabajo de prueba 2'],
    documents: [{ url: '/fixtures/ficha-prueba.pdf', alt: 'Ficha técnica de prueba' }],
    timeline: [
      { period: { value: '1972' }, title: { value: 'Hito de prueba 1' }, description: { value: 'Descripción de prueba.' } },
      { period: { value: '2010' }, title: { value: 'Hito de prueba 2' }, description: { value: '' } }
    ],
    brand: 'Marca A', model: 'Modelo A', version: 'Versión A', year: 1972, km: 84000, fuel: 'Gasolina', gearbox: 'Manual', power: 130, mcolor: 'Rojo de prueba',
    year_band: '1970-1979', km_band: '50.000-99.999 km', price_band: '50.000-99.999 €'
  });
  const B = makeProduct({
    handle: 'prueba-coche-b-a-consultar', title: '[PRUEBA] Coche B, precio a consultar y un título largo para comprobar el corte en dos líneas', ref: 'PR-G-002', category: 'Coches', status: 'Disponible', featured: true,
    price_mode: 'A consultar', price: 120000, region: 'Región B', precision: 'Región', owner_label: 'Propietario particular',
    brand: 'Marca B', model: 'Modelo B', year: 2004, km: 0, fuel: 'Diésel', gearbox: 'Automático', year_band: '2000-2009', km_band: 'Hasta 49.999 km', video: 'landscape', duration: 61
  });
  const C = makeProduct({ handle: 'prueba-coche-c-minimo', title: '[PRUEBA] Coche C (datos mínimos)', category: 'Coches', status: 'Reservado', price_mode: 'No publicado', brand: 'Marca A' });
  const D = makeProduct({
    handle: 'prueba-barco-a', title: '[PRUEBA] Barco de ejemplo A', ref: 'PR-H-001', category: 'Barcos', status: 'Disponible', featured: true,
    hook: 'Texto de prueba de un barco.', price_mode: 'Publicado', price: 240000, currency: 'EUR', region: 'Baleares', precision: 'Región',
    owner_name: 'Nombre oculto', owner_show: false, owner_label: 'Armador particular',
    video: 'landscape', duration: 61, builder: 'Constructor A', model: 'Modelo náutico A', boat_type: 'Velero', year: 1988, loa: 12.5, beam: 3.8, engine: 'Diésel 40 CV', hours: 2100, tax: 'IVA pagado (declarado)',
    year_band: '1980-1989', loa_band: '12-14,99 m', price_band: '100.000-249.999 €', story: 'Historia de prueba de un barco.'
  });
  const E = makeProduct({
    handle: 'prueba-barco-b-reservado', title: '[PRUEBA] Barco B (reservado)', ref: 'PR-H-002', category: 'Barcos', status: 'Reservado',
    price_mode: 'A consultar', region: 'Cataluña', precision: 'Región', builder: 'Constructor B', boat_type: 'Motora', year: 2012, loa: 8.2, year_band: '2010-2019', loa_band: '8-11,99 m'
  });
  const F = makeProduct({
    handle: 'prueba-casa-a', title: '[PRUEBA] Casa de ejemplo A', ref: 'PR-E-001', category: 'Casas', status: 'Disponible', featured: true,
    hook: 'Texto de prueba de una casa.', price_mode: 'Publicado', price: 1450000, currency: 'EUR', region: 'Mallorca', city: 'Pueblo de prueba', precision: 'Ciudad',
    video: 'portrait', duration: 95, ptype: 'Masía', area: 320, area_unit: 'm²', plot: 5200, beds: 5, baths: 3, period: 'Años 60', energy: 'E',
    area_band: '250-499 m²', beds_band: '5 o más', price_band: 'Más de 1.000.000 €', story: 'Historia de prueba de una casa.'
  });
  const G = makeProduct({
    handle: 'prueba-casa-b-vendida', title: '[PRUEBA] Casa B (vendida)', ref: 'PR-E-002', category: 'Casas', status: 'Vendido',
    price_mode: 'Publicado', price: 600000, region: 'Menorca', precision: 'Región', ptype: 'Casa de pueblo', area: 140, beds: 3, baths: 2, area_band: '100-249 m²', beds_band: '3'
  });
  const H = makeProduct({
    handle: 'prueba-coche-d-vendido', title: '[PRUEBA] Coche D (vendido)', ref: 'PR-G-004', category: 'Coches', status: 'Vendido',
    price_mode: 'Publicado', price: 30000, region: 'Región D', precision: 'Región', brand: 'Marca D', model: 'Modelo D', year: 1995, km: 150000, year_band: '1990-1999', km_band: 'Más de 100.000 km', video: 'portrait'
  });
  const I = makeProduct({
    handle: 'prueba-coche-e-youtube', title: '[PRUEBA] Coche E (vídeo de YouTube)', ref: 'PR-G-005', category: 'Coches', status: 'Disponible',
    price_mode: 'Publicado', price: 8500, region: 'Región E', precision: 'Región', brand: 'Marca E', model: 'Modelo E', year: 2015, km: 60000,
    year_band: '2010-2019', km_band: '50.000-99.999 km', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', video_aspect: '16:9', duration: 30
  });
  const J = makeProduct({ handle: 'prueba-coche-f-sin-portada', title: '[PRUEBA] Coche F (sin portada ni vídeo)', category: 'Coches', status: 'Disponible', noCover: true, price_mode: 'A consultar', brand: 'Marca F', year: 1999, region: 'Región F', precision: 'País', year_band: '1990-1999' });
  L.push(A, B, C, D, E, F, G, H, I, J);
  for (let n = 1; n <= 26; n++) {
    L.push(makeProduct({
      handle: `prueba-relleno-${n}`, title: `[PRUEBA] Coche de relleno ${n}`, ref: `PR-R-${n}`, category: 'Coches', status: 'Disponible',
      price_mode: n % 2 ? 'Publicado' : 'A consultar', price: 20000 + n * 1500, region: n % 3 ? 'Región R' : 'Región S', precision: 'Región',
      brand: `Marca ${n % 4 ? 'A' : 'B'}`, model: `M${n}`, year: 1960 + n * 2, km: 10000 * n,
      year_band: 1960 + n * 2 < 1980 ? '1960-1979' : '1980-1999', km_band: n < 5 ? 'Hasta 49.999 km' : '50.000-99.999 km', gearbox: n % 2 ? 'Manual' : 'Automático', fuel: 'Gasolina'
    }));
  }
  A.__data.related = [B, F];
  A.metafields = mf(A.__data);
  return L;
}

/* ---------------------------------------------------------------- comercio normal [PRUEBA] */
/** Un producto normal de la tienda (no es una pieza Sidonia): sirve para comprobar que el comercio de Impact
 *  (tarjeta, precio, compra) sigue intacto junto a las piezas. */
export function buildCommerceProducts() {
  const cover = image('[PRUEBA] Libro de ejemplo', 1200, 1500, '#b9a98a', '[PRUEBA] Portada de un libro de ejemplo');
  const media = { ...cover, media_type: 'image', preview_image: cover, position: 1 };
  const variant = {
    id: 9001, title: 'Default Title', price: 2500, compare_at_price: null, available: true, inventory_management: 'shopify', inventory_policy: 'deny',
    options: ['Default Title'], option1: 'Default Title', featured_media: null, url: '/products/prueba-libro?variant=9001', sku: '', barcode: '',
    unit_price_measurement: null, requires_selling_plan: false, selling_plan_allocations: [], quantity_rule: { min: 1, max: null, increment: 1 }, weight: 0, requires_shipping: true
  };
  return [{
    id: 9000, handle: 'prueba-libro', title: '[PRUEBA] Libro de ejemplo (producto normal de la tienda)', url: '/products/prueba-libro',
    vendor: 'Sidonia', type: 'Libro', tags: [], description: '<p>[PRUEBA] Producto normal con precio y compra, para comprobar que el comercio de Impact no cambia.</p>',
    price: 2500, price_min: 2500, price_max: 2500, price_varies: false, compare_at_price: null, compare_at_price_min: 0, compare_at_price_max: 0, compare_at_price_varies: false,
    available: true, featured_image: cover, featured_media: media, images: [cover], media: [media], variants: [variant],
    selected_or_first_available_variant: variant, selected_variant: null, first_available_variant: variant, has_only_default_variant: true,
    options: ['Title'], options_with_values: [{ name: 'Title', position: 1, values: ['Default Title'], selected_value: 'Default Title' }], options_by_name: {},
    template_suffix: '', published_at: '2026-09-01T10:00:00Z', created_at: '2026-09-01T10:00:00Z', 'gift_card?': false, requires_selling_plan: false, selling_plan_groups: [],
    quantity_price_breaks_configured: false, metafields: {}, __data: {}, object_type: 'product', collections: []
  }];
}

/* ---------------------------------------------------------------- cuentas sociales [PRUEBA] */
const field = (v) => ({ value: v });
export function socialAccounts() {
  const acc = (network, name, url, followers, include, updated) => ({ network: field(network), name: field(name), url: field(url), followers: field(followers), include_in_total: field(include), updated_on: field(updated) });
  return [
    acc('Instagram', '[PRUEBA] @cuenta.prueba', 'https://www.instagram.com/cuenta.prueba/', 12400, true, '2026-09-30'),
    acc('TikTok', '[PRUEBA] @cuenta.prueba', 'https://www.tiktok.com/@cuenta.prueba', 8300, true, '2026-09-28'),
    acc('YouTube', '[PRUEBA] Canal de prueba', 'https://www.youtube.com/@canalprueba', null, true, null),
    acc('Instagram', '[PRUEBA] @cuenta.prueba (repetida)', 'https://instagram.com/cuenta.prueba', 12400, true, '2026-09-30'),
    acc('Facebook', '[PRUEBA] Página de prueba', 'https://www.facebook.com/paginaprueba', 2100, false, '2026-09-01')
  ];
}

/* ---------------------------------------------------------------- filtros tipo Search & Discovery */
export const FILTER_DEFS = MODEL.filters.order.map((key) => ({ key, label: MODEL.filters.labels[key] }));
const mfVal = (p, key) => {
  const v = p.__data[key];
  return v === undefined || v === null ? undefined : String(v);
};
export function applyFilters(products, query) {
  return products.filter((p) => FILTER_DEFS.every((d) => {
    const vals = query[`filter.p.m.sidonia.${d.key}`];
    if (!vals || !vals.length) return true;
    return vals.includes(mfVal(p, d.key));
  }));
}
export function buildFilters(base, query, urlFor) {
  const out = [];
  for (const d of FILTER_DEFS) {
    const param = `filter.p.m.sidonia.${d.key}`;
    const distinct = [...new Set(base.map((p) => mfVal(p, d.key)).filter(Boolean))].sort();
    if (!distinct.length) continue;
    const others = { ...query };
    delete others[param];
    const scoped = applyFilters(base, others);
    const active = query[param] || [];
    const values = distinct.map((v) => ({
      label: v, value: v, param_name: param, count: scoped.filter((p) => mfVal(p, d.key) === v).length, active: active.includes(v),
      url_to_add: urlFor({ ...query, [param]: [...active, v] }), url_to_remove: urlFor({ ...query, [param]: active.filter((x) => x !== v) })
    }));
    out.push({ label: d.label, param_name: param, type: 'list', values, active_values: values.filter((v) => v.active), url_to_remove: urlFor({ ...query, [param]: [] }) });
  }
  return out;
}
export function sortProducts(list, sort) {
  const arr = list.slice();
  if (sort === 'created-descending') return arr.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
  if (sort === 'price-ascending') return arr.sort((a, b) => (a.__data.price_amount || 0) - (b.__data.price_amount || 0));
  if (sort === 'price-descending') return arr.sort((a, b) => (b.__data.price_amount || 0) - (a.__data.price_amount || 0));
  return arr;
}
export const SORT_OPTIONS = [
  { name: 'Destacados', value: 'manual' },
  { name: 'Más vendidos', value: 'best-selling' },
  { name: 'Alfabéticamente, A-Z', value: 'title-ascending' },
  { name: 'Precio, de menor a mayor', value: 'price-ascending' },
  { name: 'Precio, de mayor a menor', value: 'price-descending' },
  { name: 'Fecha, de más reciente a más antigua', value: 'created-descending' }
];

/** SIDONIA_SHOP_DATA=1: la misma pieza como producto «normal» de Shopify (foto, precio en la variante y etiquetas
 *  «Clave: valor»), que es como están hoy los productos en la tienda. Para probar el tema del repo Sidonia-Shopify. */
function shopLike(id, o, cover, data) {
  const media = cover ? [{ ...cover, media_type: 'image', preview_image: cover, position: 1 }] : [];
  const price = o.price_mode === 'Publicado' ? Math.round((o.price || 0) * 100) : 0;
  const available = o.status !== 'Vendido';
  const variant = { id: id * 10, title: 'Default Title', price, compare_at_price: null, available, url: `/products/${o.handle}?variant=${id * 10}`, options: ['Default Title'], option1: 'Default Title', featured_media: null, selling_plan_allocations: [], quantity_rule: { min: 1, max: null, increment: 1 } };
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const tags = [];
  if (o.status === 'Reservado' || o.status === 'Vendido') tags.push(o.status);
  if (o.year) tags.push(`Año: ${o.year}`);
  if (o.km) tags.push(`Km: ${fmt(o.km)}`);
  if (o.loa) tags.push(`Eslora: ${o.loa} m`);
  if (o.boat_type) tags.push(`Tipo: ${o.boat_type}`);
  if (o.ptype) tags.push(`Tipo: ${o.ptype}`);
  if (o.beds) tags.push(`Habitaciones: ${o.beds}`);
  if (o.area) tags.push(`Superficie: ${o.area} m²`);
  if (o.fuel) tags.push(`Combustible: ${o.fuel}`);
  if (o.city || o.region) tags.push(`Ubicación: ${o.city || o.region}`);
  return {
    id, handle: o.handle, title: o.title, url: `/products/${o.handle}`, description: o.description || '', vendor: o.brand || o.builder || '', type: o.category.replace(/s$/, ''),
    tags, published_at: '2026-09-01T10:00:00Z', created_at: `2026-09-${String(1 + (id % 27)).padStart(2, '0')}T10:00:00Z`, template_suffix: '',
    featured_image: cover, featured_media: media[0] || null, images: cover ? [cover] : [], media,
    price, price_min: price, price_max: price, price_varies: false, compare_at_price: null, compare_at_price_min: 0, compare_at_price_max: 0, compare_at_price_varies: false,
    available, variants: [variant], selected_or_first_available_variant: variant, first_available_variant: variant, selected_variant: null, has_only_default_variant: true,
    options: ['Title'], options_with_values: [{ name: 'Title', position: 1, values: ['Default Title'], selected_value: 'Default Title' }], options_by_name: {},
    'gift_card?': false, requires_selling_plan: false, selling_plan_groups: [], quantity_price_breaks_configured: false,
    object_type: 'product', metafields: mf(data), __data: data, collections: []
  };
}
