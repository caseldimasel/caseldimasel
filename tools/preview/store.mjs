// Datos de PRUEBA para el servidor de previsualización. NO forman parte del tema ni del ZIP.
// Todos los títulos llevan el prefijo [PRUEBA]: son fixtures claramente rotulados, no un catálogo real.
// Los números de teléfono y correos de esta tienda de prueba usan dominios y prefijos reservados para tests.

const img = (id, w, h, alt = '', focal = '50.0% 50.0%') => ({ id, width: w, height: h, alt, aspect_ratio: w / h, presentation: { focal_point: focal } });

export const IMAGE_COLORS = {};
let imgSeq = 0;
function image(label, w = 1200, h = 1500, color = '#8a7f6a', alt = '', focal) {
  const id = `i${++imgSeq}`;
  IMAGE_COLORS[id] = { label, color, w, h };
  return img(id, w, h, alt, focal);
}

function video(ratio = 0.5625, poster) {
  const h = 1080;
  const w = Math.round(h * ratio);
  return {
    media_type: 'video',
    aspect_ratio: ratio,
    preview_image: poster,
    // En pruebas el contenedor es webm; el tema solo ve «formato mp4» y el mime que declare la fuente.
    sources: [
      { format: 'mp4', height: 1080, width: w, mime_type: 'video/webm', url: '/fixtures/clip.webm' },
      { format: 'mp4', height: 720, width: Math.round(720 * ratio), mime_type: 'video/webm', url: '/fixtures/clip.webm?q=720' },
      { format: 'mp4', height: 360, width: Math.round(360 * ratio), mime_type: 'video/webm', url: '/fixtures/clip.webm?q=360' },
      { format: 'm3u8', height: 1080, width: w, mime_type: 'application/x-mpegURL', url: '/fixtures/clip.m3u8' }
    ]
  };
}

const rich = (text) => ({ __mf: true, value: { __str: text }, html: text.split('\n\n').map((p) => `<p>${p}</p>`).join(''), text });

function mfProxy(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    out[k] = v && v.__mf ? v : { value: v };
  }
  return new Proxy({ sidonia: out }, {});
}

let pid = 1000;
export function makeProduct(o) {
  const id = ++pid;
  const poster = o.noCover ? null : image(o.title, 1200, 1500, o.color || '#9a8f78', o.alt || o.title);
  const mf = {
    reference: o.ref,
    category: o.category,
    status: o.status,
    hook: o.hook,
    why_special: o.why,
    highlights: o.highlights,
    story: o.story ? rich(o.story) : undefined,
    provenance: o.provenance,
    country: o.country ?? 'España',
    region: o.region,
    city: o.city,
    location_precision: o.precision,
    price_mode: o.price_mode,
    price_amount: o.price,
    price_currency: o.currency,
    video: o.video,
    preview_clip: o.preview ? video(0.5625, poster) : undefined,
    video_url: o.video_url,
    video_duration: o.duration,
    video_language: o.vlang,
    subtitles_file: o.subs ? { url: '/fixtures/subs.vtt' } : undefined,
    subtitles_lang: o.subs ? 'es' : undefined,
    transcript: o.transcript,
    social_url: o.social,
    condition_notes: o.condition,
    work_done: o.work,
    timeline: o.timeline,
    documents: o.documents,
    related: o.related,
    // garage
    brand: o.brand,
    model: o.model,
    version: o.version,
    year: o.year,
    mileage_km: o.km,
    fuel: o.fuel,
    gearbox: o.gearbox,
    power_hp: o.power,
    color: o.mcolor,
    // harbor
    builder: o.builder,
    boat_type: o.boat_type,
    length_m: o.loa,
    beam_m: o.beam,
    engine: o.engine,
    engine_hours: o.hours,
    tax_regime: o.tax,
    // estate
    property_type: o.ptype,
    area_value: o.area,
    area_unit: o.area_unit,
    plot_area: o.plot,
    bedrooms: o.beds,
    bathrooms: o.baths,
    built_period: o.period,
    energy_rating: o.energy,
    // bandas
    year_band: o.year_band,
    km_band: o.km_band,
    loa_band: o.loa_band,
    area_band: o.area_band,
    bedrooms_band: o.beds_band,
    price_band: o.price_band
  };
  const media = [];
  if (o.video) media.push(o.video);
  const p = {
    id,
    handle: o.handle,
    title: o.title,
    url: `/products/${o.handle}`,
    description: o.description || '',
    vendor: o.brand || o.builder || '',
    type: o.type || '',
    tags: o.tags || ['pieza'],
    published_at: '2026-09-01T10:00:00Z',
    template_suffix: o.suffix || '',
    featured_image: poster,
    media,
    available: false,
    selected_or_first_available_variant: { sku: '' },
    metafields: mfProxy(mf),
    object_type: 'product',
    __data: mf
  };
  return p;
}

export function buildProducts() {
  const list = [];
  const gv = video(0.5625);
  const A = makeProduct({
    handle: 'prueba-coche-a', title: '[PRUEBA] Coche de ejemplo A', ref: 'PR-G-001', category: 'Garage', status: 'Disponible',
    hook: 'Texto de prueba: una línea de historia para la tarjeta.', color: '#a3261c',
    why: 'Resumen de prueba de por qué es especial.', highlights: ['Hecho de prueba uno', 'Hecho de prueba dos'],
    story: 'Párrafo de historia de prueba uno.\n\nPárrafo de historia de prueba dos con más texto para comprobar la lectura.',
    provenance: 'Procedencia de prueba.', region: 'Región de prueba', city: 'Ciudad de prueba', precision: 'Región',
    price_mode: 'Publicado', price: 85000, currency: 'EUR',
    video: gv, preview: true, duration: 83, vlang: 'Español', subs: true, transcript: 'Línea uno de la transcripción de prueba.\nLínea dos.',
    social: 'https://www.instagram.com/p/prueba/',
    condition: 'Observaciones de prueba sobre el estado.', work: ['Trabajo de prueba 1', 'Trabajo de prueba 2'],
    timeline: [
      { period: { value: '1972' }, title: { value: 'Hito de prueba 1' }, description: { value: 'Descripción de prueba.' } },
      { period: { value: '2010' }, title: { value: 'Hito de prueba 2' }, description: { value: '' } }
    ],
    documents: [{ url: 'https://cdn.preview.test/files/ficha-prueba.pdf', alt: 'Ficha de prueba' }],
    brand: 'Marca A', model: 'Modelo A', version: 'Versión A', year: 1972, km: 84000, fuel: 'Gasolina', gearbox: 'Manual', power: 130, mcolor: 'Rojo de prueba',
    year_band: '1970-1979', km_band: '50.000-99.999 km', price_band: '50.000-99.999 €', suffix: 'garage', type: 'Coche'
  });
  const B = makeProduct({
    handle: 'prueba-coche-b-a-consultar', title: '[PRUEBA] Coche B (precio a consultar)', ref: 'PR-G-002', category: 'Garage', status: 'Disponible',
    price_mode: 'A consultar', price: 120000, region: 'Región B', precision: 'Región', brand: 'Marca B', model: 'Modelo B', year: 2004, km: 0,
    fuel: 'Diésel', gearbox: 'Automático', year_band: '2000-2009', km_band: 'Hasta 49.999 km', suffix: 'garage', color: '#7a2a22', type: 'Coche'
  });
  const C = makeProduct({
    handle: 'prueba-coche-c-minimo', title: '[PRUEBA] Coche C (datos mínimos)', category: 'Garage', status: 'Reservado',
    price_mode: 'No publicado', brand: 'Marca A', suffix: 'garage', color: '#5b3b2c', noCover: false, type: 'Coche'
  });
  const D = makeProduct({
    handle: 'prueba-barco-a', title: '[PRUEBA] Barco de ejemplo A', ref: 'PR-H-001', category: 'Harbor', status: 'Disponible', color: '#1d4f7c',
    hook: 'Texto de prueba de un barco.', price_mode: 'Publicado', price: 240000, currency: 'EUR', region: 'Baleares', precision: 'Región',
    video: video(1.7778), duration: 61, builder: 'Constructor A', boat_type: 'Velero', year: 1988, loa: 12.5, beam: 3.8, engine: 'Diésel 40 CV', hours: 2100, tax: 'IVA pagado (declarado)',
    year_band: '1980-1989', loa_band: '12-14,99 m', suffix: 'harbor', story: 'Historia de prueba de un barco.', type: 'Barco', ratioNote: 'horizontal'
  });
  const E = makeProduct({
    handle: 'prueba-barco-b-reservado', title: '[PRUEBA] Barco B (reservado)', ref: 'PR-H-002', category: 'Harbor', status: 'Reservado', color: '#2a6a9c',
    price_mode: 'A consultar', region: 'Cataluña', precision: 'Región', builder: 'Constructor B', boat_type: 'Motora', year: 2012, loa: 8.2,
    year_band: '2010-2019', loa_band: '8-11,99 m', suffix: 'harbor', type: 'Barco'
  });
  const F = makeProduct({
    handle: 'prueba-casa-a', title: '[PRUEBA] Casa de ejemplo A', ref: 'PR-E-001', category: 'Estate', status: 'Disponible', color: '#2d6a4a',
    hook: 'Texto de prueba de una casa.', price_mode: 'Publicado', price: 1450000, currency: 'EUR', region: 'Mallorca', city: 'Pueblo de prueba', precision: 'Ciudad',
    video: video(0.5625), duration: 95, ptype: 'Masía', area: 320, area_unit: 'm²', plot: 5200, beds: 5, baths: 3, period: 'Años 60', energy: 'E',
    area_band: '250-499 m²', beds_band: '5 o más', suffix: 'estate', story: 'Historia de prueba de una casa.', type: 'Casa'
  });
  const G = makeProduct({
    handle: 'prueba-casa-b-vendida', title: '[PRUEBA] Casa B (vendida)', ref: 'PR-E-002', category: 'Estate', status: 'Vendido', color: '#4d7a5f',
    price_mode: 'Publicado', price: 600000, region: 'Menorca', precision: 'Región', ptype: 'Casa de pueblo', area: 140, beds: 3, baths: 2,
    area_band: '100-249 m²', beds_band: '3', suffix: 'estate', type: 'Casa'
  });
  const H = makeProduct({
    handle: 'prueba-coche-d-vendido', title: '[PRUEBA] Coche D (vendido)', ref: 'PR-G-004', category: 'Garage', status: 'Vendido', color: '#6b3a33',
    price_mode: 'Publicado', price: 30000, region: 'Región D', precision: 'Región', brand: 'Marca D', model: 'Modelo D', year: 1995, km: 150000, year_band: '1990-1999', km_band: 'Más de 100.000 km',
    suffix: 'garage', video: gv, type: 'Coche'
  });
  const I = makeProduct({
    handle: 'prueba-coche-e-youtube', title: '[PRUEBA] Coche E (vídeo de YouTube)', ref: 'PR-G-005', category: 'Garage', status: 'Disponible', color: '#8a4a3a',
    price_mode: 'Publicado', price: 45000, region: 'Región E', precision: 'Región', brand: 'Marca E', model: 'Modelo E', year: 2015, km: 60000,
    year_band: '2010-2019', km_band: '50.000-99.999 km', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration: 30, suffix: 'garage', type: 'Coche'
  });
  const J = makeProduct({
    handle: 'prueba-coche-f-sin-portada', title: '[PRUEBA] Coche F (sin portada ni vídeo)', category: 'Garage', status: 'Disponible', noCover: true,
    price_mode: 'A consultar', brand: 'Marca F', year: 1999, region: 'Región F', precision: 'País', suffix: 'garage', type: 'Coche', year_band: '1990-1999'
  });
  list.push(A, B, C, D, E, F, G, H, I, J);
  for (let n = 1; n <= 14; n++) {
    list.push(makeProduct({
      handle: `prueba-relleno-${n}`, title: `[PRUEBA] Relleno ${n}`, ref: `PR-R-${n}`, category: 'Garage', status: 'Disponible', color: ['#8a3a30', '#6a4a3a', '#9a5a40'][n % 3],
      price_mode: n % 2 ? 'Publicado' : 'A consultar', price: 20000 + n * 1500, region: 'Región R', precision: 'Región', brand: `Marca ${n % 4 ? 'A' : 'B'}`, model: `M${n}`, year: 1960 + n * 3, km: 10000 * n,
      year_band: n * 3 + 1960 < 1980 ? '1960-1969' : '1980-1989', km_band: n < 5 ? 'Hasta 49.999 km' : '50.000-99.999 km', suffix: 'garage', type: 'Coche', gearbox: n % 2 ? 'Manual' : 'Automático', fuel: 'Gasolina'
    }));
  }
  // enlaces «relacionadas» manuales
  A.__data.related = [list.find((p) => p.handle === 'prueba-coche-b-a-consultar'), list.find((p) => p.handle === 'prueba-casa-a')];
  A.metafields = mfProxy(A.__data);
  return list;
}

/* ------------------------------------------------------------ filtros tipo Search & Discovery */
export const FILTER_DEFS = [
  { key: 'category', label: 'Categoría' },
  { key: 'status', label: 'Estado' },
  { key: 'region', label: 'Ubicación' },
  { key: 'price_band', label: 'Presupuesto' },
  { key: 'brand', label: 'Marca' },
  { key: 'year_band', label: 'Año' },
  { key: 'km_band', label: 'Kilometraje' },
  { key: 'gearbox', label: 'Cambio' },
  { key: 'fuel', label: 'Combustible' },
  { key: 'boat_type', label: 'Tipo de embarcación' },
  { key: 'builder', label: 'Constructor' },
  { key: 'loa_band', label: 'Eslora' },
  { key: 'property_type', label: 'Tipo de inmueble' },
  { key: 'bedrooms_band', label: 'Habitaciones' },
  { key: 'area_band', label: 'Superficie' }
];

const mfVal = (p, key) => {
  const v = p.__data[key];
  return v === undefined || v === null ? undefined : String(v);
};

export function applyFilters(products, query) {
  // query: Map nombre -> [valores]
  return products.filter((p) =>
    FILTER_DEFS.every((d) => {
      const vals = query[`filter.p.m.sidonia.${d.key}`];
      if (!vals || !vals.length) return true;
      return vals.includes(mfVal(p, d.key));
    })
  );
}

export function buildFilters(baseProducts, query, urlFor) {
  const out = [];
  for (const d of FILTER_DEFS) {
    const param = `filter.p.m.sidonia.${d.key}`;
    const distinct = [...new Set(baseProducts.map((p) => mfVal(p, d.key)).filter(Boolean))].sort();
    if (!distinct.length) continue;
    const others = { ...query };
    delete others[param];
    const scoped = applyFilters(baseProducts, others);
    const active = query[param] || [];
    const values = distinct.map((v) => {
      const count = scoped.filter((p) => mfVal(p, d.key) === v).length;
      const isActive = active.includes(v);
      return {
        label: v,
        value: v,
        param_name: param,
        count,
        active: isActive,
        url_to_add: urlFor({ ...query, [param]: [...active, v] }),
        url_to_remove: urlFor({ ...query, [param]: active.filter((x) => x !== v) })
      };
    });
    out.push({
      label: d.label,
      param_name: param,
      type: 'list',
      values,
      active_values: values.filter((v) => v.active),
      url_to_remove: urlFor({ ...query, [param]: [] })
    });
  }
  return out;
}

export function sortProducts(list, sort) {
  const arr = list.slice();
  switch (sort) {
    case 'created-descending':
      return arr.sort((a, b) => b.id - a.id);
    case 'price-ascending':
      return arr.sort((a, b) => (a.__data.price_amount || 0) - (b.__data.price_amount || 0));
    case 'price-descending':
      return arr.sort((a, b) => (b.__data.price_amount || 0) - (a.__data.price_amount || 0));
    default:
      return arr; // manual / selección editorial
  }
}

export const SORT_OPTIONS = [
  { name: 'Destacados', value: 'manual' },
  { name: 'Más vendidos', value: 'best-selling' },
  { name: 'Alfabéticamente, A-Z', value: 'title-ascending' },
  { name: 'Precio, de menor a mayor', value: 'price-ascending' },
  { name: 'Precio, de mayor a menor', value: 'price-descending' },
  { name: 'Fecha, de más reciente a más antigua', value: 'created-descending' }
];

export { image, video };
