// Servidor del ARNÉS DE PRUEBAS (no es Shopify ni Impact).
// 1. Compone el tema de pruebas: anfitrión (harness/host) + kit, con integration/apply-kit.mjs.
// 2. Lo renderiza con el intérprete de pruebas (liquid.mjs) y datos [PRUEBA] (store.mjs), simulando rutas
//    de Shopify: /, /collections/*, /products/*, /pages/*, /search, ?section_id=, ?view=sidonia-card y POST /contact.
// Uso: node tools/harness/server.mjs [--port 4173] [--profile full|empty]
import http from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Liquid, Context } from './liquid.mjs';
import { buildProducts, buildCommerceProducts, socialAccounts, applyFilters, buildFilters, sortProducts, SORT_OPTIONS, IMAGES, image, logoImage } from './store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');
export let THEME = join(ROOT, 'build', 'harness-theme');
/** Cambia el tema que sirve el arnés (p. ej. impact/sidonia, el Impact integrado; nunca se publica nada). */
export function setTheme(dir) {
  THEME = dir;
}
export const isImpactTheme = () => existsSync(join(THEME, 'config', 'settings_data.json')) && /"theme_name":\s*"Impact"/.test(readFileSync(join(THEME, 'config', 'settings_schema.json'), 'utf8'));
const FIXTURES = join(here, 'fixtures');
const PHOTOS = join(ROOT, 'legacy', 'tema-independiente-1.4.0', 'theme', 'assets');

export function composeTheme() {
  execFileSync('node', [join(ROOT, 'integration', 'apply-kit.mjs'), '--base', join(ROOT, 'harness', 'host'), '--out', THEME, '--replace', 'index.json,search.json,404.json', '--quiet'], { stdio: 'pipe' });
}

function readJsonLoose(p) {
  return JSON.parse(readFileSync(p, 'utf8').replace(/^﻿?\s*\/\*[\s\S]*?\*\/\s*/, ''));
}
function extractSchema(path) {
  const t = readFileSync(path, 'utf8');
  const m = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(t);
  return m ? JSON.parse(m[1]) : {};
}

/* Valores con tipo, como los entrega Shopify: colores, imágenes, fuentes, menús, colecciones… */
function colorObj(v) {
  const sv = String(v || '');
  let r = 0, g = 0, b = 0, a = 1;
  let m = /^#([0-9a-f]{6})$/i.exec(sv);
  if (m) {
    const n = parseInt(m[1], 16);
    [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else if ((m = /^#([0-9a-f]{3})$/i.exec(sv))) [r, g, b] = [...m[1]].map((x) => parseInt(x + x, 16));
  else if ((m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(sv))) [r, g, b, a] = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  return { __str: sv, rgb: `${r} ${g} ${b}`, red: r, green: g, blue: b, alpha: a, hex: sv };
}
const FONT_FAMILIES = { lato: 'Lato', carlito: 'Carlito', assistant: 'Assistant', helvetica: 'Helvetica', inter: 'Inter' };
function fontObj(h) {
  const m = /^([a-z0-9_]+)_([ni])(\d)$/.exec(String(h || '')) || [null, 'helvetica', 'n', '4'];
  const family = FONT_FAMILIES[m[1]] || m[1].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { __str: family, family, fallback_families: 'sans-serif', weight: Number(m[3]) * 100, style: m[2] === 'i' ? 'italic' : 'normal', 'system?': m[1] === 'helvetica', variants: [] };
}
const SHOP_IMAGES = {};
function shopImage(url) {
  if (SHOP_IMAGES[url]) return SHOP_IMAGES[url];
  const name = url.split('/').pop();
  let img;
  if (/negro/i.test(name)) img = logoImage('dark');
  else if (/blanco/i.test(name)) img = logoImage('light');
  else img = image(`[Imagen de la tienda: ${name} · no disponible en el arnés]`, 1600, 1000, '#9a9384', '', '50.0% 50.0%');
  SHOP_IMAGES[url] = img;
  return img;
}
function typed(s, v, ctx) {
  if (v === undefined || v === null) return v;
  switch (s.type) {
    case 'color':
    case 'color_background':
      return typeof v === 'string' ? colorObj(v) : v;
    case 'image_picker':
      return typeof v === 'string' ? (v ? shopImage(v) : null) : v;
    case 'font_picker':
      return typeof v === 'string' ? fontObj(v) : v;
    case 'link_list':
      return typeof v === 'string' ? (ctx.menus && ctx.menus[v]) || null : v;
    case 'collection':
      return typeof v === 'string' ? (ctx.collections && ctx.collections[v]) || null : v;
    case 'product':
      return typeof v === 'string' ? (ctx.byHandle && ctx.byHandle[v]) || null : v;
    case 'page':
      return typeof v === 'string' ? (ctx.pages && ctx.pages[v]) || null : v;
    case 'collection_list':
      return Array.isArray(v) ? v.map((h) => (typeof h === 'string' ? ctx.collections && ctx.collections[h] : h)).filter(Boolean) : v;
    case 'product_list':
      return Array.isArray(v) ? v.map((h) => (typeof h === 'string' ? ctx.byHandle && ctx.byHandle[h] : h)).filter(Boolean) : v;
    case 'video':
      return null;
    default:
      return v;
  }
}

function defaultFor(s, ctx) {
  switch (s.type) {
    case 'color':
    case 'color_background':
      return colorObj(s.default !== undefined ? s.default : '');
    case 'font_picker':
      return fontObj(s.default);
    case 'checkbox':
      return s.default === true;
    case 'select':
    case 'radio':
      return s.default !== undefined ? s.default : s.options[0].value;
    case 'range':
    case 'number':
      return s.default;
    case 'text':
    case 'textarea':
    case 'richtext':
    case 'inline_richtext':
    case 'color':
    case 'url':
      return s.default !== undefined ? s.default : '';
    case 'font_picker':
      return { family: "'Prueba'", fallback_families: 'sans-serif', weight: 400, style: 'normal' };
    case 'link_list':
      return ctx.menus && s.default ? ctx.menus[s.default] || null : null;
    default:
      return null;
  }
}
function settingsFrom(list, overrides, ctx) {
  const out = {};
  for (const s of list) if (s.id) out[s.id] = defaultFor(s, ctx);
  for (const [k, v] of Object.entries(overrides || {})) {
    const def = list.find((x) => x.id === k);
    out[k] = def ? typed(def, v, ctx) : v;
  }
  return out;
}
function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  return out;
}
/** Traducciones como en una tienda en español: es.json sobre el idioma por defecto del tema. */
function loadLocale() {
  const files = readdirSync(join(THEME, 'locales'));
  const def = files.find((f) => f.endsWith('.default.json') && !f.includes('.schema.'));
  let loc = readJsonLoose(join(THEME, 'locales', def));
  if (!/^es\./.test(def) && files.includes('es.json')) loc = deepMerge(loc, readJsonLoose(join(THEME, 'locales', 'es.json')));
  return loc;
}
/** Ajustes guardados del tema (settings_data.json › current), si el tema los trae (Impact). */
function savedSettings() {
  const p = join(THEME, 'config', 'settings_data.json');
  if (!existsSync(p)) return {};
  try {
    const d = readJsonLoose(p);
    const cur = typeof d.current === 'string' ? (d.presets || {})[d.current] || {} : d.current || {};
    const out = { ...cur };
    delete out.sections;
    delete out.content_for_index;
    delete out.blocks;
    return out;
  } catch {
    return {};
  }
}

const PAGES = [
  { handle: 'vender-con-sidonia', title: 'Vender con Sidonia', template: 'sell' },
  { handle: 'como-vendemos', title: 'Cómo vendemos', template: 'how-it-works' },
  { handle: 'sobre-sidonia', title: 'Sobre Sidonia', template: 'sidonia-about', content: '<p>[PRUEBA] Texto de la página Sobre Sidonia: aquí irá la historia real del equipo.</p>' },
  { handle: 'favoritos', title: 'Favoritos', template: 'favorites', alt: 'favoritos' },
  { handle: 'contacto', title: 'Contacto', template: 'sidonia-contact' },
  { handle: 'busco', title: 'Cuéntanos qué buscas', template: 'wanted' },
  { handle: 'vender', title: 'Vende con Sidonia', template: 'vender' },
  { handle: 'privacidad', title: 'Aviso de privacidad', template: 'legal', content: '<p>[PRUEBA] Texto legal pendiente de Sidonia.</p>' }
];

export function createStore(profile = 'full', port = 4173) {
  const full = profile === 'full';
  const products = full ? buildProducts().concat(buildCommerceProducts()) : [];
  const byHandle = Object.fromEntries(products.map((p) => [p.handle, p]));
  const col = (handle, title, list, suffix = '') => ({ handle, title, url: `/collections/${handle}`, description: '', featured_image: null, products: list, products_count: list.length, all_products_count: list.length, template_suffix: suffix, filters: [], object_type: 'collection' });
  const cat = (c) => products.filter((p) => p.__data.category === c);
  const collections = full
    ? {
        explorar: col('explorar', 'Explorar', products, 'sidonia'),
        coches: col('coches', 'Coches', cat('Coches'), 'garage'),
        barcos: col('barcos', 'Barcos', cat('Barcos'), 'harbor'),
        casas: col('casas', 'Casas', cat('Casas'), 'estate'),
        vendidas: col('vendidas', 'Archivo de piezas vendidas', products.filter((p) => p.__data.status === 'Vendido'), 'sold'),
        destacadas: col('destacadas', 'Destacadas', products.filter((p) => p.__data.featured === true)),
        all: col('all', 'Productos', products)
      }
    : { all: col('all', 'Productos', []) };
  const menus = full
    ? {
        'main-menu': { title: 'Menú principal', links: [
          { title: 'Explorar', url: '/collections/explorar', type: 'collection_link', object: collections.explorar, links: [] },
          { title: 'Coches', url: '/collections/coches', type: 'collection_link', object: collections.coches, links: [] },
          { title: 'Barcos', url: '/collections/barcos', type: 'collection_link', object: collections.barcos, links: [] },
          { title: 'Casas', url: '/collections/casas', type: 'collection_link', object: collections.casas, links: [] },
          { title: 'Cómo vendemos', url: '/pages/como-vendemos', type: 'page_link', links: [] },
          { title: 'Sobre Sidonia', url: '/pages/sobre-sidonia', type: 'page_link', links: [] }
        ] },
        footer: { title: 'Sidonia', links: [
          { title: 'Explorar', url: '/collections/explorar', links: [] },
          { title: 'Cómo vendemos', url: '/pages/como-vendemos', links: [] },
          { title: 'Sobre Sidonia', url: '/pages/sobre-sidonia', links: [] },
          { title: 'Archivo de vendidas', url: '/collections/vendidas', links: [] },
          { title: 'Contacto', url: '/pages/contacto', links: [] }
        ] }
      }
    : { 'main-menu': { title: 'Menú principal', links: [{ title: 'Inicio', url: '/', links: [] }] } };
  // Menús que usa la cabecera/pie de Impact (handles reales de su header-group/footer-group). Contenido [PRUEBA].
  if (full) {
    menus['drawer-menu'] = menus['main-menu'];
    menus.shop = { title: '[PRUEBA] Tienda', links: [{ title: '[PRUEBA] Productos', url: '/collections/all', links: [] }] };
  }
  menus['secundary-menu'] = { title: 'Secundario', links: [] };
  menus['customer-account-main-menu'] = { title: 'Cuenta', links: [] };
  menus.footer = menus.footer || { title: 'Pie', links: [] };
  for (const m of Object.values(menus)) {
    m.handle = m.handle || '';
    for (const l of m.links) Object.assign(l, { levels: l.links && l.links.length ? 1 : 0, current: false, active: false, child_active: false, links: l.links || [] });
  }
  const pages = full ? Object.fromEntries(PAGES.map((p) => [p.handle, { ...p, url: `/pages/${p.handle}`, template_suffix: p.alt && existsSync(join(THEME, 'templates', `page.${p.alt}.json`)) ? p.alt : p.template, content: p.content || '', object_type: 'page' }])) : {};

  const schemaGroups = readJsonLoose(join(THEME, 'config/settings_schema.json'));
  const typedCtx = { menus, collections, byHandle, pages };
  const heroImage = image('[PRUEBA] Portada', 2000, 1342, '#6b5a45', '[PRUEBA] Coche clásico rojo sobre la hierba', '55.0% 60.0%', 'foto-alfa-giulia');
  const overrides = full
    ? {
        sidonia_email: 'pruebas@sidonia.test',
        sidonia_whatsapp: '+34 600 000 000',
        sidonia_hours: '[PRUEBA] Horario de ejemplo: lunes a viernes',
        sidonia_garage_image: image('[PRUEBA] Coches', 2000, 1342, '#7a3a30', '', '50.0% 55.0%', 'foto-jaguar-e-type'),
        sidonia_harbor_image: image('[PRUEBA] Barcos', 1600, 1200, '#2c5f86'),
        sidonia_estate_image: image('[PRUEBA] Casas', 1600, 1200, '#3d6b52'),
        sidonia_analytics: true
      }
    : {};
  const settings = settingsFrom(schemaGroups.filter((g) => g.settings).flatMap((g) => g.settings), { ...savedSettings(), ...overrides }, typedCtx);
  const sectionOverrides = full
    ? {
        'sidonia-hero': { image: heroImage, story_product: byHandle['prueba-coche-a'] },
        'sidonia-story': { product: byHandle['prueba-coche-a'] },
        'sidonia-testimonials': {}
      }
    : {};
  const testimonialBlocks = full;
  return { profile, products, byHandle, collections, menus, pages, settings, sectionOverrides, testimonialBlocks, social: full ? socialAccounts() : [], submissions: [], port, mutable: {} };
}

/* ---------------------------------------------------------------- renderizado */
function buildSection(store, type, id, given = {}, index = null) {
  const schema = extractSchema(join(THEME, 'sections', type + '.liquid'));
  const settings = settingsFrom(schema.settings || [], { ...(store.sectionOverrides[type] || {}), ...(given.settings || {}) }, store);
  for (const s of schema.settings || []) if (s.type === 'link_list' && typeof settings[s.id] === 'string') settings[s.id] = store.menus[settings[s.id]] || null;
  let order = given.block_order || Object.keys(given.blocks || {});
  let blocksDef = given.blocks || {};
  if (type === 'sidonia-testimonials' && store.testimonialBlocks && !order.length) {
    blocksDef = {
      t1: { type: 'testimonial', settings: { authorized: true, quote: '[PRUEBA] Testimonio de ejemplo autorizado: palabras de prueba, no de un cliente real.', name: '[PRUEBA] Nombre', context: '[PRUEBA] Contexto de ejemplo' } },
      t2: { type: 'testimonial', settings: { authorized: false, quote: '[PRUEBA] Este testimonio no está autorizado y no debe verse.', name: '[PRUEBA] Oculto' } }
    };
    order = ['t1', 't2'];
  }
  const blocks = order.filter((bid) => blocksDef[bid] && !blocksDef[bid].disabled).map((bid) => {
    const b = blocksDef[bid];
    const bd = (schema.blocks || []).find((x) => x.type === b.type) || {};
    return { id: bid, type: b.type, settings: settingsFrom(bd.settings || [], b.settings, store), shopify_attributes: '' };
  });
  return { id, type, settings, blocks, schema, index };
}

function renderSectionHtml(engine, sec, globals, group) {
  const nodes = engine.parseFile(join(THEME, 'sections', sec.type + '.liquid'));
  const ctx = new Context(globals, { engine, file: 'sections/' + sec.type, overrides: globals.__overrides });
  ctx.set('section', { id: sec.id, settings: sec.settings, blocks: sec.blocks, index: sec.index });
  const out = engine.renderStr(nodes, ctx);
  const tag = sec.schema.tag || 'div';
  const cls = (group ? ` shopify-section-group-${group}` : '') + (sec.schema.class ? ' ' + sec.schema.class : '');
  return `<${tag} id="shopify-section-${sec.id}" class="shopify-section${cls}">${out}</${tag}>`;
}

function makeGlobals(store, req) {
  const q = req.query;
  const queryString = (over = {}) => {
    const params = new URLSearchParams();
    for (const [k, vals] of Object.entries(q)) {
      if (k === 'section_id' || k === 'view' || k in over) continue;
      for (const v of vals) params.append(k, v);
    }
    for (const [k, v] of Object.entries(over)) if (v !== null && v !== undefined) (Array.isArray(v) ? v : [v]).forEach((x) => params.append(k, x));
    return params.toString();
  };
  return {
    settings: store.settings,
    shop: {
      name: 'Tienda de prueba', url: `http://localhost:${store.port}`, currency: 'EUR', description: '', customer_accounts_enabled: false, enabled_payment_types: [], money_format: '{{amount_with_comma_separator}} €', locale: 'es',
      privacy_policy: store.profile === 'full' ? { url: '/policies/privacy-policy', title: 'Política de privacidad' } : null,
      terms_of_service: null, legal_notice: null,
      metaobjects: { sidonia_social_account: { values: store.social } }
    },
    request: { design_mode: q.design_mode?.[0] === '1', locale: { iso_code: 'es' }, host: 'localhost', page_type: 'index', path: req.path },
    routes: { root_url: '/', search_url: '/search', collections_url: '/collections', all_products_collection_url: '/collections/all', cart_url: '/cart', cart_add_url: '/cart/add', cart_change_url: '/cart/change', cart_update_url: '/cart/update', account_url: '/account', account_login_url: '/account/login', predictive_search_url: '/search/suggest', product_recommendations_url: '/recommendations/products' },
    localization: { available_countries: [], available_languages: [{ iso_code: 'es', endonym_name: 'Español' }], country: { iso_code: 'ES', name: 'España', currency: { iso_code: 'EUR', symbol: '€' } }, language: { iso_code: 'es', endonym_name: 'Español' } },
    cart: { item_count: 0, items: [], total_price: 0, currency: { iso_code: 'EUR' }, attributes: {}, note: '', cart_level_discount_applications: [], requires_shipping: false },
    predictive_search: { performed: false, resources: {} },
    recommendations: { performed: true, products: [], products_count: 0 },
    customer: null,
    collections: Object.fromEntries(Object.values(store.collections).map((c) => [c.handle, c])),
    pages: store.pages,
    linklists: store.menus,
    content_for_header: `<script>window.__events=[];window.dataLayer=[];window.Shopify=window.Shopify||{};Shopify.routes=Shopify.routes||{root:'/'};Shopify.locale='es';Shopify.currency={active:'EUR',rate:'1.0'};Shopify.country='ES';Shopify.designMode=${q.design_mode?.[0] === '1'};Shopify.analytics={publish:function(n,p){window.__events.push([n,p])}};Shopify.customerPrivacy={analyticsProcessingAllowed:function(){return window.__consent!==false}};</script>`,
    canonical_url: `http://localhost:${store.port}${req.path}`,
    current_page: Math.max(1, parseInt(q.page?.[0] || '1', 10)),
    __path: req.path,
    __query: Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v[0]])),
    __queryString: queryString,
    __overrides: {}
  };
}

function formStateHook(req) {
  return (kind) => {
    if (kind !== 'contact') return { posted: false, errors: null, values: {} };
    if (req.formState) return req.formState;
    if (req.query.contact_posted?.[0] === 'true') return { posted: true, errors: null, values: {} };
    return { posted: false, errors: null, values: {} };
  };
}

function urlWith(path, filters, extra) {
  const params = new URLSearchParams();
  for (const [k, vals] of Object.entries(filters)) vals.forEach((v) => params.append(k, v));
  for (const [k, v] of Object.entries(extra || {})) if (v) params.append(k, v);
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}
const queryFilters = (q) => Object.fromEntries(Object.entries(q).filter(([k]) => k.startsWith('filter.')));

function collectionGlobals(globals, c, q) {
  const filters = queryFilters(q);
  const sort = q.sort_by?.[0] || 'manual';
  const urlFor = (f) => urlWith(c.url, Object.fromEntries(Object.entries(f).filter(([, v]) => v.length)), { sort_by: q.sort_by?.[0] });
  const list = sortProducts(applyFilters(c.products, filters), sort);
  globals.collection = { ...c, products: list, products_count: list.length, filters: buildFilters(c.products, filters, urlFor), sort_options: SORT_OPTIONS, default_sort_by: 'manual', sort_by: q.sort_by?.[0] || null };
}

function searchGlobals(store, globals, q) {
  const terms = q.q?.[0] || '';
  const filters = queryFilters(q);
  const base = terms ? store.products.filter((p) => `${p.title} ${p.vendor} ${p.__data.model || ''} ${p.__data.region || ''}`.toLowerCase().includes(terms.toLowerCase())) : [];
  const urlFor = (f) => {
    const params = new URLSearchParams({ q: terms, type: 'product', 'options[prefix]': 'last' });
    for (const [k, vals] of Object.entries(f)) vals.forEach((v) => params.append(k, v));
    return `/search?${params.toString()}`;
  };
  const list = sortProducts(applyFilters(base, filters), q.sort_by?.[0] || 'relevance');
  const allForFilters = terms ? base : store.products;
  globals.search = { performed: 'q' in q, terms, results: list, results_count: list.length, filters: buildFilters(allForFilters, filters, urlFor), sort_options: [{ name: 'Relevancia', value: 'relevance' }, ...SORT_OPTIONS], default_sort_by: 'relevance', sort_by: q.sort_by?.[0] || null };
}

export function createRenderer(store) {
  const locale = loadLocale();
  function engineFor(req, globals) {
    const engine = new Liquid({ themeDir: THEME, locale, globals, hooks: {} });
    engine.hooks.formState = formStateHook(req);
    engine.hooks.renderSectionGroup = (name, ctx, eng) => {
      const data = readJsonLoose(join(THEME, 'sections', name + '.json'));
      return data.order.filter((key) => !data.sections[key].disabled).map((key) => renderSectionHtml(eng, buildSection(store, data.sections[key].type, `sections--${name}__${key}`, data.sections[key]), globals, name)).join('');
    };
    return engine;
  }
  function renderRequest(req) {
    const globals = makeGlobals(store, req);
    const engine = engineFor(req, globals);
    const q = req.query;
    let name = '404';
    let suffix = '';
    let m;
    if (req.path === '/') name = 'index';
    else if ((m = /^\/collections\/([^/]+)$/.exec(req.path)) && store.collections[m[1]] !== undefined) {
      const c = Object.values(store.collections).find((x) => x.handle === m[1]);
      name = 'collection';
      suffix = c.template_suffix;
      collectionGlobals(globals, c, q);
    } else if ((m = /^\/products\/([^/]+)$/.exec(req.path)) && store.byHandle[m[1]]) {
      name = 'product';
      globals.product = store.byHandle[m[1]];
      suffix = q.view?.[0] === 'sidonia-card' ? 'sidonia-card' : globals.product.template_suffix;
    } else if ((m = /^\/pages\/([^/]+)$/.exec(req.path)) && store.pages[m[1]]) {
      name = 'page';
      globals.page = store.pages[m[1]];
      suffix = globals.page.template_suffix;
    } else if (req.path === '/search') {
      name = 'search';
      searchGlobals(store, globals, q);
    }
    const status = name === '404' ? 404 : 200;
    globals.template = { name, suffix, __str: suffix ? `${name}.${suffix}` : name };
    globals.request.page_type = name;
    globals.page_title = name === 'product' ? globals.product.title : name === 'collection' ? globals.collection.title : name === 'page' ? globals.page.title : name === 'index' ? 'Inicio' : name === 'search' ? 'Buscar' : 'Página no encontrada';

    const liquidTpl = join(THEME, 'templates', `${name}.${suffix}.liquid`);
    if (suffix && existsSync(liquidTpl)) {
      const ctx = new Context(globals, { engine, file: `templates/${name}.${suffix}` });
      return { status, html: engine.renderStr(engine.parseFile(liquidTpl), ctx) };
    }
    const candidates = [join(THEME, 'templates', `${name}${suffix ? '.' + suffix : ''}.json`), join(THEME, 'templates', `${name}.json`)];
    const tf = candidates.find((f) => existsSync(f));
    const data = readJsonLoose(tf);
    let content = '';
    data.order.filter((key) => !data.sections[key].disabled).forEach((key, i) => {
      const id = `template--1__${key}`;
      if (req.sectionId && req.sectionId !== id) return;
      content += renderSectionHtml(engine, buildSection(store, data.sections[key].type, id, data.sections[key], i + 1), globals);
    });
    if (req.sectionId) return { status, html: content };
    const ctx = new Context(globals, { engine, file: 'layout/theme' });
    ctx.set('content_for_layout', content);
    const html = engine.renderStr(engine.parseFile(join(THEME, 'layout/theme.liquid')), ctx);
    return { status, html, missing: [...engine.missingTranslations] };
  }
  return { renderRequest };
}

/** Renderiza una sección con su primer preset (lo que hace el editor al «Añadir sección»). */
export function renderPreset(store, type, route = '/') {
  const renderer = createRenderer(store);
  void renderer;
  const schema = extractSchema(join(THEME, 'sections', type + '.liquid'));
  const preset = (schema.presets || [])[0];
  if (!preset) return null;
  const u = new URL(route, 'http://x');
  const query = {};
  u.searchParams.forEach((v, k) => (query[k] = query[k] || []).push(v));
  const req = { path: u.pathname, query };
  const globals = makeGlobals(store, req);
  const locale = loadLocale();
  const engine = new Liquid({ themeDir: THEME, locale, globals, hooks: {} });
  engine.hooks.formState = formStateHook(req);
  const p = /^\/products\/(.+)$/.exec(u.pathname);
  if (p) globals.product = store.byHandle[p[1]];
  globals.template = { name: p ? 'product' : 'index', suffix: '' };
  const blocks = {};
  const order = [];
  (preset.blocks || []).forEach((b, i) => {
    blocks['b' + i] = b;
    order.push('b' + i);
  });
  const sec = buildSection(store, type, 'preset-' + type, { settings: preset.settings, blocks, block_order: order }, 2);
  return { html: renderSectionHtml(engine, sec, globals), missing: [...engine.missingTranslations] };
}

/* ---------------------------------------------------------------- http */
const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.vtt': 'text/vtt', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf' };

function placeholderSvg(info, w) {
  const h = Math.round((w * info.h) / info.w);
  const label = info.label.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9dde2"/><stop offset=".55" stop-color="${info.color}"/><stop offset="1" stop-color="#1c1c1c"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="${h * 0.9}" font-family="sans-serif" font-size="${Math.max(12, w * 0.035)}" fill="#fff" text-anchor="middle">${label}</text></svg>`;
}

function parseBody(buf, ct) {
  const fields = {};
  if (ct.startsWith('multipart/form-data')) {
    const boundary = /boundary=(.+)$/.exec(ct)[1];
    for (const part of buf.toString('utf8').split('--' + boundary)) {
      const mm = /name="([^"]+)"\r?\n\r?\n([\s\S]*?)\r?\n$/.exec(part.replace(/^\r?\n/, ''));
      if (mm) (fields[mm[1]] = fields[mm[1]] || []).push(mm[2]);
    }
  } else new URLSearchParams(buf.toString()).forEach((v, k) => (fields[k] = fields[k] || []).push(v));
  return fields;
}

export function startServer({ port = 4173, profile = 'full', compose = true, theme = null } = {}) {
  if (theme) setTheme(theme);
  else if (compose) composeTheme();
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
      if (path.startsWith('/assets/')) {
        const f = join(THEME, 'assets', path.slice(8));
        return existsSync(f) ? send(200, readFileSync(f), MIME[extname(f)] || 'application/octet-stream') : send(404, 'no asset');
      }
      if (path.startsWith('/fixtures/')) {
        const f = join(FIXTURES, path.slice(10));
        return existsSync(f) ? send(200, readFileSync(f), MIME[extname(f)] || 'application/octet-stream') : send(404, 'no fixture');
      }
      if (path.startsWith('/img/')) {
        const info = IMAGES[path.slice(5)];
        if (!info) return send(404, 'no img');
        if (info.logo) {
          const fill = info.logo === 'light' ? '#ffffff' : '#1d1d1b';
          return send(200, `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="200" viewBox="0 0 1000 200"><text x="500" y="138" font-family="Helvetica, Arial, sans-serif" font-size="120" font-weight="600" letter-spacing="40" text-anchor="middle" fill="${fill}">SIDONIA</text></svg>`, 'image/svg+xml');
        }
        if (info.photo && existsSync(join(PHOTOS, info.photo + '.jpg'))) return send(200, readFileSync(join(PHOTOS, info.photo + '.jpg')), 'image/jpeg', { 'cache-control': 'max-age=3600' });
        return send(200, placeholderSvg(info, Math.min(parseInt(query.width?.[0] || info.w, 10), info.w)), 'image/svg+xml', { 'cache-control': 'max-age=3600' });
      }
      if (path === '/favicon.ico' || path === '/font.woff2') return send(204, '');
      if (path === '/__test/submissions') return send(200, JSON.stringify(store.submissions), 'application/json');
      if (path === '/__test/reset') {
        store.submissions.length = 0;
        return send(200, 'ok');
      }
      if (path === '/__test/unpublish') {
        const h = query.handle?.[0];
        if (store.byHandle[h]) {
          delete store.byHandle[h];
          for (const c of Object.values(store.collections)) {
            c.products = c.products.filter((x) => x.handle !== h);
            c.products_count = c.products.length;
          }
        }
        return send(200, 'ok');
      }
      if (path === '/contact' && req.method === 'POST') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const fields = parseBody(Buffer.concat(chunks), req.headers['content-type'] || '');
          const ref = new URL(req.headers.referer || `http://localhost:${port}/pages/contacto`);
          const one = (k) => (fields[k] || [''])[0];
          const email = one('contact[email]');
          if (email.startsWith('netfail')) return res.socket.destroy(); // corte de conexión real (fetch falla al momento)
          if (email.startsWith('challenge')) return send(302, '', 'text/plain', { location: '/challenge' });
          const errors = [];
          const messages = {};
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            errors.push('email');
            messages.email = 'no es válido';
          }
          if ('contact[body]' in fields && !one('contact[body]').trim()) {
            errors.push('body');
            messages.body = 'no puede estar vacío';
          }
          if (errors.length) {
            errors.messages = messages;
            errors.translated_fields = { email: 'correo electrónico', body: 'mensaje' };
            const rq = { path: ref.pathname, query: Object.fromEntries([...ref.searchParams].map(([k, v]) => [k, [v]])), formState: { posted: false, errors, values: { name: one('contact[name]'), email, phone: one('contact[phone]'), body: one('contact[body]') } } };
            return send(200, renderer.renderRequest(rq).html);
          }
          store.submissions.push({ at: Date.now(), page: ref.pathname, fields });
          return send(302, '', 'text/plain', { location: `${ref.pathname}?contact_posted=true` });
        });
        return;
      }
      if (path === '/cart.js') return send(200, JSON.stringify({ token: 'arnes', note: '', attributes: {}, item_count: 0, items: [], total_price: 0, currency: 'EUR', requires_shipping: false }), 'application/json');
      if (path === '/recommendations/products') {
        const prod = store.products.find((x) => String(x.id) === String(query.product_id?.[0]));
        const out = renderer.renderRequest({ path: prod ? prod.url : '/', query: {}, sectionId: query.section_id?.[0] });
        return send(200, out.html);
      }
      if (path === '/challenge') return send(200, '<!doctype html><title>Verificación</title><p>Pantalla de verificación simulada.</p>');
      const out = renderer.renderRequest({ path, query, sectionId: query.section_id?.[0] });
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
  const port = parseInt(args.includes('--port') ? args[args.indexOf('--port') + 1] : '4173', 10);
  const profile = args.includes('--profile') ? args[args.indexOf('--profile') + 1] : 'full';
  const theme = args.includes('--theme') ? join(process.cwd(), args[args.indexOf('--theme') + 1]) : null;
  startServer({ port, profile, theme }).then(() =>
    console.log(theme ? `Arnés en http://localhost:${port} sirviendo ${theme} (perfil ${profile}): Impact integrado, con datos [PRUEBA] y el intérprete de pruebas.` : `Arnés de pruebas Sidonia en http://localhost:${port} (perfil ${profile}). No es Impact.`)
  );
}
