// Servidor de PREVISUALIZACIÓN local del tema de Sidonia (solo para pruebas; no se sube a Shopify).
// Renderiza las plantillas reales del tema con el intérprete de pruebas (liquid.mjs) y datos de prueba (store.mjs),
// simulando rutas de Shopify: /collections/*, /products/*, /pages/*, /search, ?section_id=, ?view=card, POST /contact.
// Uso: node tools/preview/server.mjs [--port 4173] [--profile full|empty]
import http from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Liquid, Context, str } from './liquid.mjs';
import { buildProducts, applyFilters, buildFilters, sortProducts, SORT_OPTIONS, IMAGE_COLORS, image, FILTER_DEFS } from './store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');
const THEME = join(ROOT, 'theme');
const FIXTURES = join(here, 'fixtures');

const locale = JSON.parse(readFileSync(join(THEME, 'locales/es.default.json'), 'utf8'));
const schemaGroups = JSON.parse(readFileSync(join(THEME, 'config/settings_schema.json'), 'utf8'));

/* ------------------------------------------------------------ ajustes por defecto desde los schemas */
function defaultFor(s, ctx) {
  switch (s.type) {
    case 'checkbox': return s.default === true;
    case 'select':
    case 'radio': return s.default !== undefined ? s.default : s.options[0].value;
    case 'range':
    case 'number': return s.default;
    case 'text':
    case 'textarea':
    case 'richtext':
    case 'inline_richtext':
    case 'color': return s.default !== undefined ? s.default : '';
    case 'font_picker': return { family: "'Test Font'", fallback_families: 'sans-serif', weight: 400, style: 'normal' };
    case 'link_list': return ctx.menus && s.default ? ctx.menus[s.default] || null : null;
    default: return null;
  }
}
function settingsFrom(list, overrides, ctx) {
  const out = {};
  for (const s of list) if (s.id) out[s.id] = defaultFor(s, ctx);
  return Object.assign(out, overrides || {});
}

/* ------------------------------------------------------------ perfiles de tienda */
const PAGES = [
  { handle: 'vender', title: 'Vender con Sidonia', template: 'sell' },
  { handle: 'como-vendemos', title: 'Cómo vendemos', template: 'how-it-works' },
  { handle: 'sobre-sidonia', title: 'Sobre Sidonia', template: 'about' },
  { handle: 'favoritos', title: 'Favoritos', template: 'favorites' },
  { handle: 'contacto', title: 'Contacto', template: 'contact' },
  { handle: 'busco', title: 'Busco algo', template: 'wanted' },
  { handle: 'marcas', title: 'Marcas', template: 'brands' },
  { handle: 'privacidad', title: 'Aviso de privacidad', template: 'legal', content: '<p>Texto legal de prueba.</p>' }
];

export function createStore(profileName = 'full', port = 4173) {
  const full = profileName === 'full';
  const products = full ? buildProducts() : [];
  const byHandle = Object.fromEntries(products.map((p) => [p.handle, p]));
  const inCat = (cat, includeSold) => products.filter((p) => p.__data.category === cat && (includeSold || p.__data.status !== 'Vendido'));
  const col = (handle, title, list, suffix = '') => ({
    handle, title, url: `/collections/${handle}`, description: '', image: null,
    products: list, products_count: list.length, all_products_count: list.length, template_suffix: suffix, filters: []
  });
  const collections = full
    ? {
        explorar: col('explorar', 'Explorar', products.filter((p) => p.__data.status !== 'Vendido')),
        garage: col('garage', 'Garage', inCat('Garage'), 'garage'),
        harbor: col('harbor', 'Harbor', inCat('Harbor'), 'harbor'),
        estate: col('estate', 'Estate', inCat('Estate'), 'estate'),
        archivo: col('archivo', 'Archivo', products.filter((p) => p.__data.status === 'Vendido'), 'archive'),
        all: col('all', 'Productos', products)
      }
    : { all: col('all', 'Productos', []) };
  collections.garage = collections.garage || col('garage', 'Garage', [], 'garage');
  collections.harbor = collections.harbor || col('harbor', 'Harbor', [], 'harbor');
  collections.estate = collections.estate || col('estate', 'Estate', [], 'estate');
  collections.explorar = collections.explorar || col('explorar', 'Explorar', []);
  collections.archivo = collections.archivo || col('archivo', 'Archivo', [], 'archive');

  const menus = full
    ? {
        'main-menu': { links: [
          { title: 'Explorar', url: '/collections/explorar', current: false, links: [] },
          { title: 'Garage', url: '/collections/garage', current: false, links: [] },
          { title: 'Harbor', url: '/collections/harbor', current: false, links: [] },
          { title: 'Estate', url: '/collections/estate', current: false, links: [] },
          { title: 'Cómo vendemos', url: '/pages/como-vendemos', current: false, links: [] },
          { title: 'Sobre Sidonia', url: '/pages/sobre-sidonia', current: false, links: [] }
        ] },
        footer: { links: [{ title: 'Contacto', url: '/pages/contacto', links: [] }, { title: 'Archivo', url: '/collections/archivo', links: [] }] }
      }
    : {};

  const pageObjs = Object.fromEntries(PAGES.map((p) => [p.handle, { ...p, url: `/pages/${p.handle}`, template_suffix: p.template, content: p.content || '', object_type: 'page' }]));

  // ajustes del tema según perfil
  const themeOverrides = full
    ? {
        contact_email: 'pruebas@sidonia.test',
        contact_whatsapp: '+34 600 000 000',
        contact_hours: 'Horario de prueba: L-V',
        social_instagram_url: 'https://instagram.com/prueba',
        social_instagram_followers: '12,4 mil',
        social_tiktok_url: 'https://tiktok.com/@prueba',
        social_tiktok_followers: '',
        social_metrics_updated: 'octubre de 2026',
        division_garage_collection: collections.garage,
        division_harbor_collection: collections.harbor,
        division_estate_collection: collections.estate,
        explore_collection: collections.explorar,
        archive_collection: collections.archivo,
        page_sell: { url: '/pages/vender' },
        page_how: { url: '/pages/como-vendemos' },
        page_about: { url: '/pages/sobre-sidonia' },
        page_favorites: { url: '/pages/favoritos' },
        page_contact: { url: '/pages/contacto' },
        page_archive: { url: '/collections/archivo' },
        page_wanted: { url: '/pages/busco' },
        page_brands: { url: '/pages/marcas' },
        legal_menu: menus.footer,
        privacy_url: '/pages/privacidad',
        analytics_enabled: true,
        analytics_require_consent: true,
        division_garage_image: image('Portada Garage', 1000, 1250, '#a3261c'),
        og_image: image('OG', 1200, 630, '#555')
      }
    : { enable_load_more: true };

  const settings = settingsFrom(
    schemaGroups.filter((g) => g.settings).flatMap((g) => g.settings),
    themeOverrides,
    { menus }
  );
  const sectionOverrides = full
    ? {
        hero: { product: byHandle['prueba-coche-a'] },
        'featured-story': { product: byHandle['prueba-coche-a'] },
        'featured-listings': { collection: collections.explorar }
      }
    : {};
  return { profileName, products, byHandle, collections, menus, pages: pageObjs, settings, submissions: [], port, sectionOverrides, mutable: { failNext: 0 } };
}

/* ------------------------------------------------------------ renderizado */
function readJSON(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}
function extractSchema(path) {
  const t = readFileSync(path, 'utf8');
  const m = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(t);
  return m ? JSON.parse(m[1]) : {};
}

function buildSection(store, type, id, given = {}, ctxGlobals) {
  const schema = extractSchema(join(THEME, 'sections', type + '.liquid'));
  const settings = settingsFrom(schema.settings || [], { ...(store.sectionOverrides?.[type] || {}), ...(given.settings || {}) }, { menus: store.menus });
  const blocks = (given.block_order || Object.keys(given.blocks || {})).map((bid) => {
    const b = given.blocks[bid];
    const bd = (schema.blocks || []).find((x) => x.type === b.type) || {};
    return { id: bid, type: b.type, settings: settingsFrom(bd.settings || [], b.settings, { menus: store.menus }), shopify_attributes: '' };
  });
  return { id, type, settings, blocks, schema, index: 0 };
}

function renderSectionHtml(engine, store, sec, globals, group) {
  const path = join(THEME, 'sections', sec.type + '.liquid');
  const nodes = engine.parseFile(path);
  const ctx = new Context(globals, { engine, file: 'sections/' + sec.type, overrides: globals.__overrides });
  ctx.set('section', { id: sec.id, settings: sec.settings, blocks: sec.blocks, index: sec.index });
  const out = engine.renderStr(nodes, ctx);
  const tag = sec.schema.tag || 'div';
  const cls = (group ? ` shopify-section-group-${group}` : '') + (sec.schema.class ? ' ' + sec.schema.class : '');
  return `<${tag} id="shopify-section-${sec.id}" class="shopify-section${cls}">${out}</${tag}>`;
}

function renderTemplateSections(engine, store, templateFile, globals, onlyId) {
  const data = readJSON(templateFile);
  let html = '';
  for (const key of data.order) {
    const id = `template--0__${key}`;
    if (onlyId && onlyId !== id) continue;
    const sec = buildSection(store, data.sections[key].type, id, data.sections[key], globals);
    html += renderSectionHtml(engine, store, sec, globals);
  }
  return html;
}

function makeGlobals(store, req) {
  const settings = store.settings;
  const q = req.query;
  const queryString = (over = {}) => {
    const params = new URLSearchParams();
    for (const [k, vals] of Object.entries(q)) {
      if (k === 'section_id' || k === 'view') continue;
      if (k in over) continue;
      for (const v of vals) params.append(k, v);
    }
    for (const [k, v] of Object.entries(over)) {
      if (v === null || v === undefined) continue;
      (Array.isArray(v) ? v : [v]).forEach((x) => params.append(k, x));
    }
    return params.toString();
  };
  return {
    settings,
    shop: { name: 'Tienda de prueba', url: `http://localhost:${store.port}`, description: 'Descripción de la tienda de prueba.', currency: 'EUR', password_message: 'Mensaje de contraseña de prueba.' },
    request: { design_mode: req.query.design_mode?.[0] === '1', locale: { iso_code: 'es' }, host: 'localhost' },
    routes: { root_url: '/', search_url: '/search', predictive_search_url: '/search/suggest', collections_url: '/collections', all_products_collection_url: '/collections/all', cart_url: '/cart' },
    policies: store.profileName === 'full' ? { privacy_policy: { url: '/policies/privacy-policy' }, terms_of_service: null } : {},
    collections: store.collections,
    linklists: store.menus,
    content_for_header: `<script>window.__events=[];window.Shopify=window.Shopify||{};Shopify.analytics={publish:function(n,p){window.__events.push([n,p])}};Shopify.customerPrivacy={analyticsProcessingAllowed:function(){return window.__consent!==false}};</script>`,
    canonical_url: `http://localhost:${store.port}${req.path}`,
    current_page: Math.max(1, parseInt(q.page?.[0] || '1', 10)),
    __path: req.path,
    __query: Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v[0]])),
    __queryString: queryString,
    __overrides: {},
    __formState: req.formState || null
  };
}

function formStateHook(req) {
  return (kind) => {
    if (kind === 'contact' || kind === 'customer') {
      if (req.formState) return req.formState;
      if (req.query.contact_posted?.[0] === 'true') return { posted: true, errors: null, values: {} };
    }
    return { posted: false, errors: null, values: {} };
  };
}

/** Renderiza una sección con los valores de su primer «preset» (lo que hace el editor al pulsar «Añadir sección»). */
export function renderPreset(store, type, route) {
  const renderer = createRenderer(store);
  const schema = extractSchema(join(THEME, 'sections', type + '.liquid'));
  const preset = (schema.presets || [])[0];
  if (!preset) return null;
  const u = new URL(route, 'http://x');
  const query = {};
  u.searchParams.forEach((v, k) => (query[k] = query[k] || []).push(v));
  const req = { path: u.pathname, query };
  const globals = makeGlobals(store, req);
  const engine = new Liquid({ themeDir: THEME, locale, globals, hooks: {} });
  engine.hooks.formState = formStateHook(req);
  // contexto de plantilla equivalente a la ruta
  const p = /^\/products\/(.+)$/.exec(u.pathname);
  if (p) globals.product = store.byHandle[p[1]];
  globals.template = { name: p ? 'product' : 'index', suffix: '' };
  const blocks = {};
  const order = [];
  (preset.blocks || []).forEach((b, i) => { blocks['b' + i] = b; order.push('b' + i); });
  const sec = buildSection(store, type, 'preset-' + type, { settings: preset.settings, blocks, block_order: order }, globals);
  const html = renderSectionHtml(engine, store, sec, globals);
  return { html, missing: [...engine.missingTranslations] };
}

export function createRenderer(store) {
  function renderRequest(req) {
    const url = req.path;
    const globals = makeGlobals(store, req);
    const engine = new Liquid({ themeDir: THEME, locale, globals, hooks: {} });
    engine.hooks.formState = formStateHook(req);
    engine.hooks.renderSectionGroup = (name, ctx, eng) => {
      const data = readJSON(join(THEME, 'sections', name + '.json'));
      let html = '';
      for (const key of data.order) {
        const sec = buildSection(store, data.sections[key].type, `sections--0__${key}`, data.sections[key], globals);
        if (req.sectionId && req.sectionId !== sec.id) continue;
        html += renderSectionHtml(eng, store, sec, globals, name);
      }
      return html;
    };

    let status = 200;
    let templateName = '404';
    let suffix = '';
    const query = req.query;

    // enrutado
    let m;
    if (url === '/') templateName = 'index';
    else if ((m = /^\/collections\/([^/]+)$/.exec(url))) {
      const c = store.collections[m[1]];
      if (c) {
        templateName = 'collection';
        suffix = c.template_suffix;
        buildCollectionGlobals(store, globals, c, query);
      }
    } else if ((m = /^\/products\/([^/]+)$/.exec(url))) {
      const p = store.byHandle[m[1]];
      if (p) {
        templateName = 'product';
        suffix = req.query.view?.[0] === 'card' ? 'card' : p.template_suffix || '';
        globals.product = p;
      }
    } else if ((m = /^\/pages\/([^/]+)$/.exec(url))) {
      const pg = store.pages[m[1]];
      if (pg) {
        templateName = 'page';
        suffix = pg.template_suffix;
        globals.page = pg;
      }
    } else if (url === '/search') {
      templateName = 'search';
      buildSearchGlobals(store, globals, query);
    } else if (url === '/cart') templateName = 'cart';
    else if (url === '/search/suggest') {
      return renderSuggest(engine, store, globals, query);
    }
    if (templateName === '404') status = 404;
    globals.template = { name: templateName, suffix };
    globals.page_title = pageTitle(templateName, globals);
    globals.page_description = '';

    // vista alternativa Liquid (product.card)
    if (templateName === 'product' && suffix === 'card') {
      const nodes = engine.parseFile(join(THEME, 'templates/product.card.liquid'));
      const ctx = new Context(globals, { engine, file: 'templates/product.card' });
      return { status, html: engine.renderStr(nodes, ctx) };
    }

    // Section Rendering API
    const onlyId = req.sectionId;
    const candidates = [join(THEME, 'templates', templateName + (suffix ? '.' + suffix : '') + '.json'), join(THEME, 'templates', templateName + '.json')];
    const tf = candidates.find((f) => existsSync(f));
    if (!tf) return { status: 500, html: `Plantilla ausente: ${candidates[0]}` };
    if (onlyId) {
      const html = renderTemplateSections(engine, store, tf, globals, onlyId);
      return { status, html };
    }
    const content = renderTemplateSections(engine, store, tf, globals, null);
    globals.content_for_layout = content;
    const layoutNodes = engine.parseFile(join(THEME, 'layout/theme.liquid'));
    const ctx = new Context(globals, { engine, file: 'layout/theme' });
    ctx.set('content_for_layout', content);
    const html = engine.renderStr(layoutNodes, ctx);
    return { status, html, missing: [...engine.missingTranslations] };
  }

  function renderSuggest(engine, store, globals, query) {
    const q = (query.q?.[0] || '').toLowerCase();
    const results = store.products.filter((p) => `${p.title} ${p.vendor} ${p.tags.join(' ')}`.toLowerCase().includes(q)).slice(0, 4);
    globals.predictive_search = { performed: true, terms: query.q?.[0] || '', resources: { products: results } };
    const data = { type: 'predictive-search', settings: {} };
    const sec = buildSection(store, 'predictive-search', 'predictive-search', data, globals);
    return { status: 200, html: renderSectionHtml(engine, store, sec, globals) };
  }
  return { renderRequest };
}

function pageTitle(t, g) {
  if (t === 'product') return g.product.title;
  if (t === 'collection') return g.collection.title;
  if (t === 'page') return g.page.title;
  if (t === 'index') return 'Inicio';
  return t;
}

function parseQueryFilters(query) {
  const f = {};
  for (const [k, vals] of Object.entries(query)) if (k.startsWith('filter.')) f[k] = vals;
  return f;
}

function urlWith(path, base, newFilters, extra) {
  const params = new URLSearchParams();
  for (const [k, vals] of Object.entries(newFilters)) vals.forEach((v) => params.append(k, v));
  for (const [k, v] of Object.entries(extra || {})) if (v) params.append(k, v);
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}

function buildCollectionGlobals(store, globals, c, query) {
  const filters = parseQueryFilters(query);
  const sort = query.sort_by?.[0] || 'manual';
  const extra = { sort_by: query.sort_by?.[0] };
  const urlFor = (f) => urlWith(c.url, null, Object.fromEntries(Object.entries(f).filter(([, v]) => v.length)), extra);
  const filtered = applyFilters(c.products, filters);
  const sorted = sortProducts(filtered, sort);
  globals.collection = {
    ...c,
    products: sorted,
    products_count: sorted.length,
    filters: buildFilters(c.products, filters, urlFor),
    sort_options: SORT_OPTIONS,
    default_sort_by: 'manual',
    sort_by: query.sort_by?.[0] || null
  };
}

function buildSearchGlobals(store, globals, query) {
  const terms = query.q?.[0] || '';
  const filters = parseQueryFilters(query);
  const performed = terms !== '' || 'q' in query;
  const matches = terms
    ? store.products.filter((p) => `${p.title} ${p.vendor} ${p.tags.join(' ')} ${p.__data.model || ''} ${p.__data.region || ''}`.toLowerCase().includes(terms.toLowerCase()))
    : [];
  const urlFor = (f) => {
    const params = new URLSearchParams({ q: terms, type: 'product', 'options[prefix]': 'last' });
    for (const [k, vals] of Object.entries(f)) vals.forEach((v) => params.append(k, v));
    return `/search?${params.toString()}`;
  };
  const filtered = applyFilters(matches, filters);
  const sort = query.sort_by?.[0] || 'relevance';
  globals.search = {
    performed,
    terms,
    results: sortProducts(filtered, sort),
    results_count: filtered.length,
    filters: buildFilters(matches, filters, urlFor),
    sort_options: [{ name: 'Relevancia', value: 'relevance' }, ...SORT_OPTIONS],
    default_sort_by: 'relevance',
    sort_by: query.sort_by?.[0] || null
  };
}

/* ------------------------------------------------------------ http */
function parseMultipart(buf, boundary) {
  const out = {};
  const parts = buf.toString('utf8').split('--' + boundary);
  for (const part of parts) {
    const m = /name="([^"]+)"\r?\n\r?\n([\s\S]*?)\r?\n$/.exec(part.replace(/^\r?\n/, ''));
    if (m) (out[m[1]] = out[m[1]] || []).push(m[2]);
  }
  return out;
}

const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.vtt': 'text/vtt', '.png': 'image/png' };

export function startServer({ port = 4173, profile = 'full' } = {}) {
  const store = createStore(profile, port);
  const renderer = createRenderer(store);

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://localhost:${port}`);
    const path = decodeURIComponent(u.pathname);
    const query = {};
    u.searchParams.forEach((v, k) => (query[k] = query[k] || []).push(v));

    const send = (status, body, type = 'text/html; charset=utf-8', extra = {}) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra });
      res.end(body);
    };

    try {
      // activos
      if (path.startsWith('/assets/')) {
        const f = join(THEME, 'assets', path.slice(8));
        if (existsSync(f)) return send(200, readFileSync(f), MIME[extname(f)] || 'application/octet-stream');
        return send(404, 'no asset');
      }
      if (path.startsWith('/fixtures/')) {
        const f = join(FIXTURES, path.slice(10));
        if (existsSync(f)) return send(200, readFileSync(f), MIME[extname(f)] || 'application/octet-stream', { 'accept-ranges': 'none' });
        return send(404, 'no fixture');
      }
      if (path.startsWith('/img/')) {
        const id = path.slice(5);
        const info = IMAGE_COLORS[id];
        if (!info) return send(404, 'no img');
        const w = Math.min(parseInt(query.width?.[0] || info.w, 10), info.w);
        const h = Math.round((w * info.h) / info.w);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9dde2"/><stop offset=".55" stop-color="${info.color}"/><stop offset="1" stop-color="#1c1c1c"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect y="${h * 0.62}" width="100%" height="${h * 0.38}" fill="rgba(0,0,0,.35)"/><path d="M${w * 0.14} ${h * 0.66} q${w * 0.04} ${-h * 0.14} ${w * 0.2} ${-h * 0.14} h${w * 0.18} q${w * 0.14} 0 ${w * 0.2} ${h * 0.14} z" fill="rgba(255,255,255,.18)"/><circle cx="${w * 0.3}" cy="${h * 0.68}" r="${w * 0.05}" fill="rgba(0,0,0,.55)"/><circle cx="${w * 0.68}" cy="${h * 0.68}" r="${w * 0.05}" fill="rgba(0,0,0,.55)"/><text x="50%" y="${h * 0.88}" font-family="sans-serif" font-size="${Math.max(12, w * 0.04)}" fill="#fff" text-anchor="middle">${info.label.replace(/&/g, '&amp;')}</text></svg>`;
        return send(200, svg, 'image/svg+xml', { 'cache-control': 'max-age=3600' });
      }
      if (path === '/favicon.ico') return send(204, '');

      // utilidades de prueba
      if (path === '/__test/submissions') return send(200, JSON.stringify(store.submissions), 'application/json');
      if (path === '/__test/reset') {
        store.submissions.length = 0;
        store.mutable.failNext = 0;
        return send(200, 'ok');
      }
      if (path === '/__test/unpublish') {
        const h = query.handle?.[0];
        const p = store.byHandle[h];
        if (p) {
          delete store.byHandle[h];
          for (const c of Object.values(store.collections)) c.products = c.products.filter((x) => x.handle !== h);
        }
        return send(200, 'ok');
      }
      if (path === '/__test/sell') {
        const p = store.byHandle[query.handle?.[0]];
        if (p) {
          p.__data.status = 'Vendido';
          p.metafields = new Proxy({ sidonia: Object.fromEntries(Object.entries(p.__data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v && v.__mf ? v : { value: v }])) }, {});
        }
        return send(200, 'ok');
      }

      // formulario nativo
      if (path === '/contact' && req.method === 'POST') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const buf = Buffer.concat(chunks);
          const ct = req.headers['content-type'] || '';
          let fields = {};
          if (ct.startsWith('multipart/form-data')) fields = parseMultipart(buf, /boundary=(.+)$/.exec(ct)[1]);
          else new URLSearchParams(buf.toString()).forEach((v, k) => (fields[k] = fields[k] || []).push(v));
          const ref = new URL(req.headers.referer || `http://localhost:${port}/pages/contacto`);
          const email = (fields['contact[email]'] || [''])[0];
          if (email.startsWith('netfail')) return req.destroy();
          if (email.startsWith('challenge')) return send(302, '', 'text/plain', { location: '/challenge' });
          const errors = [];
          const messages = {};
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            errors.push('email');
            messages.email = 'no es válido';
          }
          const body = (fields['contact[body]'] || [''])[0];
          if ('contact[body]' in fields && !body.trim()) {
            errors.push('body');
            messages.body = 'no puede estar vacío';
          }
          if (errors.length) {
            errors.messages = messages;
            errors.translated_fields = { email: 'email', body: 'mensaje' };
            const flat = (k) => (fields[k] || [''])[0];
            const rq = { path: ref.pathname, query: Object.fromEntries([...ref.searchParams].map(([k, v]) => [k, [v]])), formState: { posted: false, errors, values: { name: flat('contact[name]'), email, phone: flat('contact[phone]'), body } } };
            const out = renderer.renderRequest(rq);
            return send(200, out.html);
          }
          store.submissions.push({ at: Date.now(), page: ref.pathname, fields });
          return send(302, '', 'text/plain', { location: `${ref.pathname}?contact_posted=true` });
        });
        return;
      }

      const rq = { path, query, sectionId: query.section_id?.[0] };
      const out = renderer.renderRequest(rq);
      if (rq.sectionId || query.view?.[0] === 'card') return send(out.status, out.html);
      return send(out.status, out.html);
    } catch (e) {
      console.error(e);
      send(500, `<pre>${String(e.stack || e).replace(/</g, '&lt;')}</pre>`);
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, store, port })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const port = parseInt(args[args.indexOf('--port') + 1] || '4173', 10);
  const profile = args.includes('--profile') ? args[args.indexOf('--profile') + 1] : 'full';
  startServer({ port, profile }).then(() => console.log(`Previsualización en http://localhost:${port} (perfil ${profile})`));
}
