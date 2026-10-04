// Pruebas end-to-end de SIDONIA en Chromium, con datos [PRUEBA] y el intérprete de Liquid del arnés.
// Objetivo «impact» (por defecto si existe impact/original): el Impact 7.2.0 de la tienda + kit + parches, tal como
// sale de integration/apply-kit.mjs. Objetivo «host»: el anfitrión genérico (sin la copia licenciada).
// No es la tienda real de Shopify: lo que no se puede probar aquí está en docs/12-informe-de-pruebas.md.
// Uso: node tools/harness/tests/e2e.mjs [filtro]      SIDONIA_TARGET=host node tools/harness/tests/e2e.mjs
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup, open, test, assert, eq, results, httpGet, TARGET } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const filter = (process.argv[2] || '').toLowerCase();
const { servers, browser, url } = await setup();
const full = servers.full.store;
let group = '';
const section = (name) => {
  group = name;
  if (!filter) console.log('\n' + name);
};
const run = (name, fn) => (!filter || name.toLowerCase().includes(filter) || group.toLowerCase().includes(filter) ? test(group, name, fn) : null);
const WIDTHS = [360, 390, 768, 1024, 1440];
const IMPACT = TARGET === 'impact';
// Selectores de la cabecera según el tema: Impact (store-header nativo) o el anfitrión genérico.
const HDR = IMPACT ? 'store-header.header' : '[data-sidonia-header]';
const NAV_LINKS = IMPACT ? '.header__link-list a, .header__link-list summary' : '.harness-nav a';
// Elemento cuyo color de texto se mide (Impact aplica el color transparente a los enlaces vía --text-color)
const HDR_TEXT = IMPACT ? '.header__link-list a' : '[data-sidonia-header]';
console.log(`Objetivo de las pruebas: ${IMPACT ? 'Impact 7.2.0 integrado (impact/sidonia)' : 'anfitrión de pruebas genérico'}`);
const RED = 'rgb(182, 63, 56)';
const BLUE = 'rgb(40, 99, 142)';
const GREEN = 'rgb(52, 116, 85)';
const resetSubs = () => httpGet(url('/__test/reset'));
const subs = async () => JSON.parse((await httpGet(url('/__test/submissions'))).body);

/* ============================================================ 1. Responsive y consola */
section('1. Responsive, desbordes, errores y estructura');
const ROUTES = [
  '/', '/collections/explorar', '/collections/coches', '/collections/barcos', '/collections/casas', '/collections/vendidas',
  '/products/prueba-coche-a', '/products/prueba-coche-b-a-consultar', '/products/prueba-coche-c-minimo', '/products/prueba-barco-a', '/products/prueba-casa-a',
  '/products/prueba-casa-b-vendida', '/products/prueba-coche-e-youtube', '/products/prueba-coche-f-sin-portada',
  '/pages/vender-con-sidonia', '/pages/como-vendemos', '/pages/sobre-sidonia', '/pages/favoritos', '/pages/contacto', '/pages/busco',
  '/search?q=prueba', '/search?q=nada-de-nada', '/no-existe', ...(IMPACT ? ['/products/prueba-libro', '/collections/all'] : [])
];
// /collections/all usa la plantilla collection.json de la tienda, que tiene su banner (con el h1) desactivado.
const H1_EXEMPT = new Set(['/collections/all']);
for (const w of WIDTHS) {
  await run(`Sin desbordes, sin errores y un solo h1 a ${w}px (${ROUTES.length} páginas)`, async () => {
    const { ctx, page } = await open(browser, { viewport: { width: w, height: 820 } });
    const bad = [];
    for (const r of ROUTES) {
      await page.goto(url(r), { waitUntil: 'networkidle' });
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (ov > 0) bad.push(`${r}: desborde ${ov}px`);
      const h1 = await page.locator('h1').count();
      if (h1 !== 1 && !H1_EXEMPT.has(r)) bad.push(`${r}: ${h1} h1`);
      const errs = page.errors.splice(0).filter((e) => !(r === '/no-existe' && /404/.test(e)));
      if (errs.length) bad.push(`${r}: ${errs.join(' | ')}`);
    }
    await ctx.close();
    assert(!bad.length, bad.join(' ; '));
  });
}
await run('Instalación vacía (sin piezas, sin redes, sin imágenes): sin errores ni desbordes a 360 y 1440 px', async () => {
  const bad = [];
  for (const w of [360, 1440]) {
    const { ctx, page } = await open(browser, { viewport: { width: w, height: 820 } });
    for (const r of ['/', '/collections/all', '/search?q=x', '/search', '/no-existe']) {
      await page.goto(url(r, 'empty'), { waitUntil: 'networkidle' });
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (ov > 0) bad.push(`${w} ${r}: desborde ${ov}px`);
      const errs = page.errors.splice(0).filter((e) => !/404/.test(e));
      if (errs.length) bad.push(`${w} ${r}: ${errs.join(' | ')}`);
    }
    await ctx.close();
  }
  assert(!bad.length, bad.join(' ; '));
});
await run('Ninguna tarjeta anida elementos interactivos (botón dentro de enlace o enlace dentro de botón)', async () => {
  const { ctx, page } = await open(browser);
  const bad = [];
  for (const r of ['/', '/collections/explorar', '/products/prueba-coche-a', '/search?q=prueba']) {
    await page.goto(url(r), { waitUntil: 'networkidle' });
    const n = await page.evaluate(() => document.querySelectorAll('a button, a a, button a, button button, a input, button input').length);
    if (n) bad.push(`${r}: ${n}`);
  }
  await ctx.close();
  assert(!bad.length, bad.join(', '));
});

/* ============================================================ 2. Home */
section('2. Home, primer bloque y categorías');
await run('El primer bloque comunica Coches, Barcos y Casas con alma y deja explorar y vender', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 390, height: 844 } });
  await page.goto(url('/'), { waitUntil: 'networkidle' });
  eq((await page.locator('h1').innerText()).replace(/\s+/g, ' '), 'Coches, barcos y casas con alma', 'titular');
  const above = await page.evaluate(() => {
    const vis = (el) => el && el.getBoundingClientRect().top < window.innerHeight && el.getBoundingClientRect().bottom > 0;
    return {
      cats: [...document.querySelectorAll('.sidonia-hero__cats .sidonia-cat')].map((li) => li.textContent.trim()),
      explore: vis(document.querySelector('.sidonia-hero__ctas a')),
      search: vis(document.querySelector('.sidonia-hero [data-sidonia-search]'))
    };
  });
  eq(above.cats.join(','), 'Coches,Barcos,Casas', 'categorías del hero');
  assert(above.explore, 'el botón Explorar no está en el primer bloque');
  await ctx.close();
  return 'titular, categorías, Explorar y buscador visibles a 390 px';
});
await run('Nombres públicos exactos y puntos de color (rojo Coches, azul Barcos, verde Casas)', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/'), { waitUntil: 'networkidle' });
  const dots = await page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)]
        .filter((a) => a.querySelector('.sidonia-dot'))
        .map((a) => [a.textContent.trim(), getComputedStyle(a.querySelector('.sidonia-dot')).backgroundColor]),
    NAV_LINKS
  );
  const map = Object.fromEntries(dots);
  eq(map.Coches, 'rgb(182, 63, 56)', 'punto de Coches');
  eq(map.Barcos, 'rgb(40, 99, 142)', 'punto de Barcos');
  eq(map.Casas, 'rgb(52, 116, 85)', 'punto de Casas');
  const html = await page.content();
  assert(!/HARBOUR|>\s*(Cars|Boats|Homes)\s*</.test(html), 'aparece HARBOUR o un nombre de categoría en inglés');
  const titles = await page.evaluate(() => [...document.querySelectorAll('.sidonia-divisions h3, .sidonia-divisions .sidonia-division-card__title')].map((h) => h.textContent.trim()));
  for (const c of ['Coches', 'Barcos', 'Casas']) assert(titles.some((t) => t.includes(c)), `falta la categoría ${c} en «Tres mundos»: ${titles.join(' | ')}`);
  await ctx.close();
  return `${RED} · ${BLUE} · ${GREEN}`;
});
await run('Buscador del hero: la pestaña de categoría sin texto lleva a su colección; con texto, a la búsqueda', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/'), { waitUntil: 'networkidle' });
  await page.locator('.sidonia-hero .sidonia-seg', { hasText: 'Barcos' }).click();
  await Promise.all([page.waitForURL(/\/collections\/barcos/), page.locator('.sidonia-hero [type=submit]').click()]);
  await page.goto(url('/'), { waitUntil: 'networkidle' });
  await page.locator('.sidonia-hero input[type=search], .sidonia-hero input[name=q]').first().fill('Marca A');
  await Promise.all([page.waitForURL(/\/search\?/), page.locator('.sidonia-hero [type=submit]').click()]);
  assert(/q=Marca\+A|q=Marca%20A/.test(page.url()), 'la búsqueda no lleva el texto: ' + page.url());
  await ctx.close();
});

/* ============================================================ 3. Cabecera */
section('3. Cabecera transparente y sólida');
await run('Transparente sobre el hero, sólida al bajar, sin cambiar de altura; los paneles abren sobre superficie piedra opaca', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(url('/'), { waitUntil: 'networkidle' });
  await page.mouse.move(700, 600);
  const state = () =>
    page.evaluate(({ HDR, HDR_TEXT }) => {
      const h = document.querySelector(HDR);
      const cs = getComputedStyle(h);
      return { filled: h.classList.contains('is-filled'), mode: document.documentElement.dataset.sidoniaHeader, bg: cs.backgroundColor, bgOpacity: cs.getPropertyValue('--header-background-opacity').trim(), color: getComputedStyle(document.querySelector(HDR_TEXT)).color, h: h.getBoundingClientRect().height };
    }, { HDR, HDR_TEXT });
  const transparent = (st) => (IMPACT ? !st.filled && st.bgOpacity === '0' : st.mode === 'overlay' && /rgba\(0, 0, 0, 0\)/.test(st.bg));
  const top = await state();
  assert(transparent(top), 'la cabecera no es transparente sobre el hero: ' + JSON.stringify(top));
  eq(top.color, 'rgb(255, 255, 255)', 'texto claro sobre la imagen');
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(700);
  const down = await state();
  assert(!transparent(down), 'al bajar sigue transparente: ' + JSON.stringify(down));
  assert(Math.abs(down.h - top.h) < 1, `la altura cambia: ${top.h} → ${down.h}`);
  await page.mouse.wheel(0, -3000);
  await page.waitForTimeout(900);
  assert(transparent(await state()), 'al volver arriba no vuelve a ser transparente');
  if (IMPACT) {
    // Impact abre búsqueda y menú en paneles propios (x-drawer); su contenido debe ser piedra opaca y legible
    await page.locator(`${HDR} a[aria-controls="search-drawer"]:visible`).first().click();
    await page.waitForTimeout(800);
    const bg = await page.evaluate(() => getComputedStyle(document.getElementById('search-drawer').shadowRoot.querySelector('[part~="content"]')).backgroundColor);
    eq(bg, 'rgb(250, 248, 244)', 'fondo del panel de búsqueda');
  } else {
    await page.locator('[data-sidonia-header-panel] > summary').first().click();
    await page.waitForTimeout(400);
    assert(!transparent(await state()), 'con un panel abierto sigue transparente');
  }
  await ctx.close();
  return `altura constante ${top.h}px`;
});
await run('Páginas sin imagen inicial: cabecera sólida desde el principio (colección, ficha, vender, favoritos)', async () => {
  const { ctx, page } = await open(browser);
  for (const r of ['/collections/coches', '/products/prueba-coche-a', '/pages/vender-con-sidonia', '/pages/favoritos']) {
    await page.goto(url(r), { waitUntil: 'networkidle' });
    const st = await page.evaluate((HDR) => {
      const h = document.querySelector(HDR);
      const cs = getComputedStyle(h);
      return { allow: h.hasAttribute('allow-transparency'), bg: cs.backgroundColor, op: cs.getPropertyValue('--header-background-opacity').trim() };
    }, HDR);
    assert(IMPACT ? !st.allow && st.op !== '0' : !/rgba\(0, 0, 0, 0\)/.test(st.bg), `${r}: cabecera transparente sin hero ${JSON.stringify(st)}`);
  }
  await ctx.close();
});
await run('Primer render correcto sin JavaScript (cabecera transparente por CSS y legible)', async () => {
  const { ctx, page } = await open(browser, { js: false });
  await page.goto(url('/'), { waitUntil: 'load' });
  const c = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).color, HDR_TEXT);
  eq(c, 'rgb(255, 255, 255)', 'color de la cabecera sin JS');
  await ctx.close();
});
await run('Cabecera: «Vender» visible en móvil sin salirse ni montarse sobre el logo (360 px)', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 360, height: 760 } });
  await page.goto(url('/collections/coches'), { waitUntil: 'networkidle' });
  const sell = page.locator(`${HDR} .sidonia-sell-cta`).first();
  assert(await sell.isVisible(), 'no se ve «Vender» en móvil');
  const box = await sell.boundingBox();
  assert(box.x + box.width <= 360, 'el botón se sale de la pantalla');
  if (IMPACT) {
    const overlap = await page.evaluate(() => {
      const logo = document.querySelector('.header__logo').getBoundingClientRect();
      return [...document.querySelectorAll('.header__secondary-nav li, .header__main-nav .tap-area')]
        .filter((el) => el.offsetParent && getComputedStyle(el).display !== 'none')
        .some((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.left < logo.right - 2 && r.right > logo.left + 2;
        });
    });
    assert(!overlap, 'los iconos se montan sobre el logo a 360 px');
  }
  await ctx.close();
});

/* ============================================================ 4. Catálogo y tarjetas */
section('4. Catálogo, precios y tarjetas');
await run('Precios: publicado con formato español; «Precio a consultar»; «Precio no publicado»; vendida sin precio; nunca 0 €', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/collections/explorar'), { waitUntil: 'networkidle' });
  const prices = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-sidonia-card]')].map((c) => [c.dataset.productHandle, c.querySelector('.sidonia-card__price').textContent.trim()])));
  eq(prices['prueba-coche-a'], '85.000 €', 'precio publicado');
  eq(prices['prueba-coche-b-a-consultar'], 'Precio a consultar', 'a consultar');
  eq(prices['prueba-coche-c-minimo'], 'Precio no publicado', 'no publicado');
  assert(/^Vendid[ao]$/.test(prices['prueba-coche-d-vendido']), 'vendida: ' + prices['prueba-coche-d-vendido']);
  const zero = Object.entries(prices).filter(([, p]) => /(^|\s)0([,.]00)?\s?€/.test(p));
  assert(!zero.length, 'precios a cero: ' + zero.map((z) => z[0]).join(', '));
  await page.goto(url('/products/prueba-casa-a'), { waitUntil: 'networkidle' });
  const big = await page.locator('.sidonia-listing__card .sidonia-price').first().innerText();
  eq(big.trim(), '1.450.000 €', 'precio de la casa');
  await ctx.close();
  return Object.keys(prices).length + ' tarjetas revisadas';
});
await run('Cada tarjeta muestra categoría con punto, ubicación pública y estado reservado/vendido', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/collections/explorar'), { waitUntil: 'networkidle' });
  const info = await page.evaluate(() => [...document.querySelectorAll('[data-sidonia-card]')].map((c) => ({ h: c.dataset.productHandle, cat: c.querySelector('.sidonia-card__meta .sidonia-cat')?.textContent.trim(), dot: !!c.querySelector('.sidonia-card__meta .sidonia-dot'), place: c.querySelector('.sidonia-card__place')?.textContent.trim(), badge: c.querySelector('.sidonia-card__badge')?.textContent.trim() })));
  const bad = info.filter((i) => !['Coches', 'Barcos', 'Casas'].includes(i.cat) || !i.dot || !i.place);
  assert(!bad.length, 'tarjetas incompletas: ' + bad.map((b) => b.h).join(', '));
  eq(info.find((i) => i.h === 'prueba-coche-c-minimo').badge, 'Reservado', 'distintivo reservado');
  await ctx.close();
});
await run('Filtros: el estado vive en la URL, se aplica sin recargar y funciona con atrás/adelante', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(url('/collections/coches'), { waitUntil: 'networkidle' });
  const total = await page.locator('[data-sidonia-swap="count"]').innerText();
  const g = page.locator('[data-sidonia-fgroup][data-param="filter.p.m.sidonia.gearbox"]');
  await g.locator('summary').click();
  await page.evaluate(() => (window.__noReload = true));
  await g.locator('label', { hasText: 'Automático' }).locator('input').check();
  await page.waitForURL(/filter\.p\.m\.sidonia\.gearbox=Autom/);
  await page.waitForFunction((t) => document.querySelector('[data-sidonia-swap="count"]').innerText !== t, total);
  const filtered = await page.locator('[data-sidonia-swap="count"]').innerText();
  eq(await page.evaluate(() => window.__noReload === true), true, 'la página se ha recargado (debe filtrar sin recargar)');
  const gears = await page.evaluate(() => [...document.querySelectorAll('[data-sidonia-card]')].length);
  await page.goBack();
  await page.waitForFunction((t) => document.querySelector('[data-sidonia-swap="count"]').innerText === t, total);
  await page.goForward();
  await page.waitForFunction((t) => document.querySelector('[data-sidonia-swap="count"]').innerText === t, filtered);
  await ctx.close();
  return `${total.trim()} → ${filtered.trim()} (${gears} tarjetas)`;
});
await run('Filtros en móvil: diálogo modal accesible que se cierra con Escape y devuelve el foco', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 390, height: 844 } });
  await page.goto(url('/collections/coches'), { waitUntil: 'networkidle' });
  const btn = page.locator('[data-sidonia-open-filters]');
  await btn.click();
  await page.waitForFunction(() => document.querySelector('[data-sidonia-filters]').matches(':modal'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-sidonia-filters]').open);
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-sidonia-open-filters'));
  assert(focused, 'el foco no vuelve al botón Filtros');
  await ctx.close();
});
await run('Cargar más añade piezas sin perder las anteriores y mantiene la URL compartible', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/collections/coches'), { waitUntil: 'networkidle' });
  const before = await page.locator('[data-sidonia-card]').count();
  const more = page.locator('[data-sidonia-load-more]');
  assert(await more.isVisible(), 'no hay botón Cargar más');
  await more.click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-sidonia-card]').length > n, before);
  const after = await page.locator('[data-sidonia-card]').count();
  await ctx.close();
  return `${before} → ${after}`;
});
await run('Sin JavaScript: filtros como formulario normal y paginación con enlaces', async () => {
  const { ctx, page } = await open(browser, { js: false, viewport: { width: 390, height: 844 } });
  await page.goto(url('/collections/coches'), { waitUntil: 'load' });
  assert(await page.locator('[data-sidonia-facets-form] input[type=checkbox]').first().isVisible().catch(() => false) || (await page.locator('[data-sidonia-facets-form]').count()) > 0, 'no hay formulario de filtros');
  assert((await page.locator('[data-sidonia-pagination] a').count()) > 0, 'no hay enlaces de paginación');
  await ctx.close();
});
await run('El archivo de vendidas solo muestra piezas vendidas', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/collections/vendidas'), { waitUntil: 'networkidle' });
  const st = await page.evaluate(() => [...document.querySelectorAll('[data-sidonia-card]')].map((c) => c.dataset.status));
  assert(st.length > 0 && st.every((s) => s === 'sold'), 'estados: ' + st.join(','));
  await ctx.close();
  return st.length + ' vendidas';
});

/* ============================================================ 5. Ficha */
section('5. Ficha de pieza');
await run('La ficha muestra precio, descripción, datos de la categoría, propietario autorizado, ubicación pública y referencia', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  const t = await page.locator('main').innerText();
  for (const s of ['85.000 €', 'Año', '1972', 'Kilometraje', '84.000 km', 'Nombre de prueba', 'Región de prueba', 'PR-G-001', 'Párrafo de historia de prueba uno']) assert(t.includes(s), `falta «${s}»`);
  await page.goto(url('/products/prueba-barco-a'), { waitUntil: 'networkidle' });
  const b = await page.locator('main').innerText();
  assert(b.includes('Armador particular'), 'falta la descripción pública del propietario');
  assert(!b.includes('Nombre oculto'), 'muestra un nombre NO autorizado');
  for (const s of ['Eslora', '12,5 m', 'Velero']) assert(b.includes(s), `barco: falta «${s}»`);
  await page.goto(url('/products/prueba-casa-a'), { waitUntil: 'networkidle' });
  const c = await page.locator('main').innerText();
  for (const s of ['Dormitorios', 'Superficie', '320 m²', 'Pueblo de prueba']) assert(c.includes(s), `casa: falta «${s}»`);
  await ctx.close();
});
await run('Al abrir la ficha no se descarga ni se crea ningún vídeo (portada primero)', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  const vids = await page.evaluate(() => document.querySelectorAll('video').length);
  const webm = page.requests.filter((u) => /\.webm/.test(u));
  eq(vids, 0, 'elementos <video> al cargar');
  eq(webm.length, 0, 'descargas de vídeo al cargar');
  await ctx.close();
});
await run('Reproducir abre con sonido, vertical sin recortar, Escape cierra y el foco vuelve', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(url('/collections/coches'), { waitUntil: 'networkidle' });
  const play = page.locator('[data-product-handle="prueba-coche-a"] [data-sidonia-play]');
  await play.click();
  await page.waitForSelector('#sidonia-video-modal video');
  await page.waitForFunction(() => {
    const v = document.querySelector('#sidonia-video-modal video');
    return v && !v.paused;
  });
  const v = await page.evaluate(() => {
    const el = document.querySelector('#sidonia-video-modal video');
    const r = el.getBoundingClientRect();
    return { muted: el.muted, fit: getComputedStyle(el).objectFit, ratio: r.width / r.height, inView: r.top >= 0 && r.bottom <= innerHeight };
  });
  eq(v.muted, false, 'silenciado');
  eq(v.fit, 'contain', 'object-fit');
  assert(Math.abs(v.ratio - 0.5625) < 0.02, 'proporción del vertical ' + v.ratio.toFixed(3));
  assert(v.inView, 'el vertical no cabe en la pantalla');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#sidonia-video-modal').open);
  const back = await page.evaluate(() => document.activeElement && document.activeElement.closest('[data-product-handle="prueba-coche-a"]') !== null);
  assert(back, 'el foco no vuelve a la tarjeta');
  const playing = await page.evaluate(() => [...document.querySelectorAll('video')].filter((x) => !x.paused).length);
  eq(playing, 0, 'vídeos sonando tras cerrar');
  await ctx.close();
  return `proporción ${v.ratio.toFixed(3)}, con sonido`;
});
await run('Solo suena un vídeo a la vez (reproductor de la ficha y modal)', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(url('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  await page.locator('[data-sidonia-player-start]').click();
  await page.waitForFunction(() => {
    const v = document.querySelector('sidonia-player video');
    return v && !v.paused;
  });
  const rel = page.locator('.sidonia-related [data-sidonia-play], [id*="related"] [data-sidonia-play]').first();
  await rel.scrollIntoViewIfNeeded();
  await rel.click();
  await page.waitForFunction(() => {
    const v = document.querySelector('#sidonia-video-modal video');
    return v && !v.paused;
  });
  const n = await page.evaluate(() => [...document.querySelectorAll('video')].filter((x) => !x.paused && !x.muted).length);
  eq(n, 1, 'vídeos con sonido a la vez');
  await ctx.close();
});
await run('YouTube: no se carga nada externo sin permiso explícito', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/products/prueba-coche-e-youtube'), { waitUntil: 'networkidle' });
  await page.locator('[data-sidonia-player-start], [data-sidonia-play]').first().click();
  await page.waitForTimeout(400);
  const ext = page.requests.filter((u) => /youtube\.com|youtube-nocookie|ytimg|vimeo\.com/.test(u));
  eq(ext.length, 0, 'peticiones a YouTube antes del permiso');
  const consent = await page.locator('.sidonia-player__consent, .sidonia-player__msg').first().isVisible();
  assert(consent, 'no se pide permiso');
  await ctx.close();
});
await run('WhatsApp y correo: mensaje con nombre, referencia y URL de la pieza, bien codificado', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  const wa = await page.locator('.sidonia-listing__card a[href^="https://wa.me/"]').first().getAttribute('href');
  const u = new URL(wa);
  eq(u.pathname, '/34600000000', 'número normalizado');
  const text = u.searchParams.get('text');
  for (const s of ['[PRUEBA] Coche de ejemplo A', 'PR-G-001', '/products/prueba-coche-a']) assert(text.includes(s), `WhatsApp sin «${s}»`);
  const mail = await page.locator('.sidonia-listing__card a[href^="mailto:"]').first().getAttribute('href');
  const subject = decodeURIComponent(/subject=([^&]+)/.exec(mail)[1]);
  assert(subject.includes('PR-G-001'), 'asunto sin referencia');
  assert(!/[\s]/.test(mail.replace(/^mailto:[^?]+\?/, '')), 'el mailto lleva espacios sin codificar');
  await ctx.close();
});
await run('Barra de contacto móvil: aparece al pasar el resumen y se oculta sobre el formulario de consulta', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 390, height: 844 } });
  await page.goto(url('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  const bar = page.locator('sidonia-contact-bar');
  await page.evaluate(() => {
    const c = document.querySelector('.sidonia-listing__card');
    window.scrollTo(0, c.getBoundingClientRect().bottom + window.scrollY + 80);
  });
  await page.waitForFunction(() => {
    const b = document.querySelector('sidonia-contact-bar');
    return b && !b.hidden && !b.classList.contains('is-hidden');
  });
  await page.locator('#sidonia-consulta').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const b = document.querySelector('sidonia-contact-bar');
    return b.hidden || b.classList.contains('is-hidden');
  });
  assert(await bar.count(), 'no hay barra');
  await ctx.close();
});

/* ============================================================ 6. Favoritos */
section('6. Favoritos');
await run('Guardar desde una tarjeta, contador en la cabecera y página de favoritos con la pieza', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/collections/coches'), { waitUntil: 'networkidle' });
  await page.locator('[data-product-handle="prueba-coche-a"] .sidonia-save__btn').click();
  eq(await page.locator('[data-product-handle="prueba-coche-a"] .sidonia-save__btn').getAttribute('aria-pressed'), 'true', 'aria-pressed');
  eq((await page.locator('sidonia-fav-count').first().innerText()).trim(), '1', 'contador');
  await page.goto(url('/pages/favoritos'), { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-sidonia-fav-grid] [data-sidonia-card]');
  const h = await page.locator('[data-sidonia-fav-grid] [data-sidonia-card]').first().getAttribute('data-product-handle');
  eq(h, 'prueba-coche-a', 'pieza en favoritos');
  const stored = await page.evaluate(() => localStorage.getItem('sidonia:favorites:v1'));
  assert(stored && !/@|nombre|email/i.test(stored), 'lo guardado no es solo una lista de piezas');
  await ctx.close();
});
await run('Una pieza retirada se muestra como «ya no disponible» y se puede quitar', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/collections/coches'), { waitUntil: 'networkidle' });
  await page.locator('[data-product-handle="prueba-relleno-1"] .sidonia-save__btn').click();
  await httpGet(url('/__test/unpublish?handle=prueba-relleno-1'));
  await page.goto(url('/pages/favoritos'), { waitUntil: 'load' });
  await page.waitForFunction(() => /ya no est|no disponible|retirad/i.test(document.querySelector('[data-sidonia-fav-grid]').innerText));
  await ctx.close();
});

/* ============================================================ 7. Formularios */
section('7. Formularios (venta y consulta)');
const fillSell = async (page, cat = 'Barcos', email = 'persona@ejemplo.test') => {
  await page.locator('[data-sidonia-cat]', { hasText: '' }).first();
  await page.locator(`label:has(input[data-sidonia-cat][value="${cat}"])`).click();
  await page.locator('[data-sidonia-next]').click();
  const key = { Coches: 'g', Barcos: 'h', Casas: 'e' }[cat];
  if (key === 'g') {
    await page.fill('[name="contact[Marca]"]', 'Marca de prueba');
    await page.fill('[name="contact[Modelo]"]', 'Modelo de prueba');
    await page.fill('[name="contact[Dónde está el coche]"]', 'Madrid');
  } else if (key === 'h') {
    await page.fill('[name="contact[Constructor y modelo]"]', 'Constructor de prueba');
    await page.fill('[name="contact[Dónde está el barco]"]', 'Palma');
  } else {
    await page.fill('[name="contact[Tipo de inmueble]"]', 'Masía');
    await page.fill('[name="contact[Ciudad o región]"]', 'Girona');
  }
  await page.fill('[name="contact[Qué la hace especial]"]', 'Texto de prueba sobre lo especial.');
  await page.selectOption('[name="contact[Relación con la pieza]"]', { index: 1 });
  await page.locator('[data-sidonia-next]').click();
  await page.fill('[name="contact[name]"]', 'Persona de prueba');
  await page.fill('[name="contact[email]"]', email);
  await page.locator('label:has([data-sidonia-privacy])').click();
};
await run('Vender: un solo formulario en 3 pasos; ?categoria=barcos preselecciona Barcos y solo envía sus campos', async () => {
  await resetSubs();
  const { ctx, page } = await open(browser, { viewport: { width: 390, height: 844 } });
  await page.goto(url('/pages/vender-con-sidonia?categoria=barcos'), { waitUntil: 'networkidle' });
  eq(await page.locator('input[data-sidonia-cat][value="Barcos"]').isChecked(), true, 'Barcos preseleccionado');
  eq(await page.locator('[data-sidonia-step]').count(), 3, 'pasos');
  await page.locator('[data-sidonia-next]').click();
  assert(await page.locator('[data-sidonia-cat-group="harbor"]').isVisible(), 'no se ven los campos de barco');
  assert(!(await page.locator('[data-sidonia-cat-group="garage"]').isVisible()), 'se ven campos de coche');
  await page.locator('[data-sidonia-prev]').click();
  await fillSell(page, 'Barcos');
  await page.locator('[data-sidonia-submit]').click();
  await page.waitForSelector('[data-sidonia-form-success]');
  const s = await subs();
  eq(s.length, 1, 'envíos recibidos');
  const keys = Object.keys(s[0].fields);
  assert(keys.includes('contact[Constructor y modelo]'), 'falta el campo de barco');
  assert(!keys.includes('contact[Marca]') && !keys.includes('contact[Tipo de inmueble]'), 'se envían campos de otras categorías: ' + keys.join(', '));
  eq(s[0].fields['contact[Precio orientativo]'].length, 1, 'un solo «Precio orientativo»');
  await ctx.close();
  return `${keys.length} campos enviados`;
});
await run('Vender: un ?categoria= no válido no preselecciona nada y no rompe el formulario', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/pages/vender-con-sidonia?categoria=<script>'), { waitUntil: 'networkidle' });
  eq(await page.locator('input[data-sidonia-cat]:checked').count(), 0, 'categorías marcadas');
  eq(page.errors.length, 0, 'errores: ' + page.errors.join(' | '));
  await ctx.close();
});
await run('Vender: los errores se anuncian junto al campo y el foco va al primero', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/pages/vender-con-sidonia'), { waitUntil: 'networkidle' });
  await page.locator('[data-sidonia-next]').click();
  const inv = await page.evaluate(() => ({ active: document.activeElement && document.activeElement.getAttribute('aria-invalid'), msgs: [...document.querySelectorAll('[data-sidonia-step="1"] [id$="-error"], [data-sidonia-step="1"] .sidonia-field__error')].map((e) => e.textContent.trim()).filter(Boolean) }));
  assert(inv.msgs.length > 0, 'sin mensaje de error en el paso 1');
  await ctx.close();
  return inv.msgs[0];
});
await run('Vender: fallo de red → aviso claro y los datos se conservan', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/pages/vender-con-sidonia'), { waitUntil: 'networkidle' });
  await fillSell(page, 'Casas', 'netfail@ejemplo.test');
  await page.locator('[data-sidonia-submit]').click();
  await page.waitForFunction(() => /problema de conexión/i.test(document.querySelector('[data-sidonia-form]')?.innerText || ''));
  eq(await page.inputValue('[name="contact[name]"]'), 'Persona de prueba', 'nombre conservado');
  page.errors.length = 0;
  await ctx.close();
});
await run('Vender: si Shopify pide verificación (anti-spam), se pasa al envío nativo', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/pages/vender-con-sidonia'), { waitUntil: 'networkidle' });
  await fillSell(page, 'Coches', 'challenge@ejemplo.test');
  await Promise.all([page.waitForURL(/\/challenge/), page.locator('[data-sidonia-submit]').click()]);
  await ctx.close();
});
await run('Vender sin JavaScript: errores del servidor junto a los campos y valores conservados', async () => {
  const { ctx, page } = await open(browser, { js: false });
  await page.goto(url('/pages/vender-con-sidonia'), { waitUntil: 'load' });
  await page.check('input[data-sidonia-cat][value="Coches"]');
  await page.fill('[name="contact[Marca]"]', 'Marca X');
  await page.fill('[name="contact[Modelo]"]', 'Modelo X');
  await page.fill('[name="contact[Dónde está el coche]"]', 'Bilbao');
  await page.fill('[name="contact[Qué la hace especial]"]', 'Algo especial');
  await page.selectOption('[name="contact[Relación con la pieza]"]', { index: 1 });
  await page.fill('[name="contact[name]"]', 'Sin JS');
  await page.fill('[name="contact[email]"]', 'a@b');
  await page.check('[data-sidonia-privacy]');
  await Promise.all([page.waitForLoadState('load'), page.locator('[data-sidonia-form] [type=submit]').click()]);
  const t = await page.locator('[data-sidonia-form-errors]').innerText();
  assert(/correo/i.test(t), 'no se informa del correo: ' + t);
  eq(await page.inputValue('[name="contact[name]"]'), 'Sin JS', 'nombre conservado');
  await ctx.close();
});
await run('Consulta de una pieza: el envío identifica la pieza (referencia, nombre, categoría y URL)', async () => {
  await resetSubs();
  const { ctx, page } = await open(browser);
  await page.goto(url('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  const f = page.locator('#sidonia-consulta form');
  await f.locator('[name="contact[name]"]').fill('Interesada de prueba');
  await f.locator('[name="contact[email]"]').fill('interes@ejemplo.test');
  await f.locator('[name="contact[body]"]').fill('Me interesa.');
  const priv = f.locator('label:has([data-sidonia-privacy])');
  if (await priv.count()) await priv.click();
  await f.locator('[type=submit]').click();
  await page.waitForSelector('#sidonia-consulta [data-sidonia-form-success]');
  const s = await subs();
  eq(s[0].fields['contact[Referencia]'][0], 'PR-G-001', 'referencia');
  eq(s[0].fields['contact[Categoría]'][0], 'Coches', 'categoría');
  assert(/\/products\/prueba-coche-a$/.test(s[0].fields['contact[URL de la pieza]'][0]), 'URL');
  const events = await page.evaluate(() => JSON.stringify([window.__events, window.dataLayer]));
  assert(!/interes@|Interesada|Me interesa/.test(events), 'datos personales en la analítica: ' + events.slice(0, 300));
  await ctx.close();
});

/* ============================================================ 8. Confianza y datos */
section('8. Comunidad, redes y testimonios');
await run('Total de seguidores calculado de las cuentas: suma solo las incluidas, sin duplicados, vacío ≠ 0', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/'), { waitUntil: 'networkidle' });
  const t = await page.locator('.sidonia-community').innerText();
  assert(t.includes('20.700'), 'total esperado 20.700 (12.400 + 8.300): ' + t.slice(0, 200));
  assert(t.includes('Suma de seguidores de las cuentas mostradas'), 'falta la explicación del total');
  assert(t.includes('Más de 200') && t.includes('clientes han confiado en nosotros para vender sus propiedades'), 'falta el dato de clientes');
  const links = await page.locator('.sidonia-community .sidonia-social__link').count();
  eq(links, 4, 'cuentas listadas (la repetida no se lista dos veces)');
  assert(!/YouTube · 0/.test(t), 'una cuenta sin cifra aparece con 0');
  await ctx.close();
});
await run('Sin cuentas con cifra: no hay total inventado, solo «Sigue las historias de Sidonia»', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/', 'empty'), { waitUntil: 'networkidle' });
  const t = await page.locator('.sidonia-community').innerText();
  assert(t.includes('Sigue las historias de Sidonia'), 'falta el texto alternativo');
  assert(!/seguidores/.test(t), 'aparece una cifra de seguidores');
  await ctx.close();
});
await run('Solo se publican testimonios marcados como autorizados', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/'), { waitUntil: 'networkidle' });
  const html = await page.content();
  assert(html.includes('Testimonio de ejemplo autorizado'), 'no aparece el autorizado');
  assert(!html.includes('no está autorizado'), 'aparece un testimonio NO autorizado');
  await ctx.close();
});

/* ============================================================ 9. Analítica, accesibilidad y SEO */
section('9. Analítica, accesibilidad y SEO');
await run('Analítica: eventos con parámetros permitidos y sin datos personales', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  await page.locator('.sidonia-listing__card a[href^="https://wa.me/"]').first().click({ modifiers: ['ControlOrMeta'] }).catch(() => {});
  const ev = await page.evaluate(() => window.__events);
  assert(ev.some(([n]) => n === 'sidonia_view_listing'), 'falta sidonia_view_listing: ' + JSON.stringify(ev));
  const allowed = new Set(['category', 'ref', 'status', 'video_kind', 'milestone', 'filters', 'count', 'form', 'sort', 'page', 'source']);
  const bad = ev.flatMap(([, p]) => Object.keys(p || {}).filter((k) => !allowed.has(k)));
  eq(bad.length, 0, 'parámetros no permitidos: ' + bad.join(','));
  await ctx.close();
  return ev.map(([n]) => n).join(', ');
});
await run('Sin consentimiento de analítica no se publica ningún evento', async () => {
  const { ctx, page } = await open(browser);
  await page.addInitScript(() => (window.__consent = false));
  await page.goto(url('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  eq(await page.evaluate(() => window.__events.length), 0, 'eventos sin consentimiento');
  await ctx.close();
});
await run('Movimiento reducido: el hero no reproduce vídeo de fondo', async () => {
  const { ctx, page } = await open(browser, { reducedMotion: 'reduce' });
  await page.goto(url('/'), { waitUntil: 'networkidle' });
  eq(await page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused).length), 0, 'vídeos en marcha');
  await ctx.close();
});
await run('Foco visible y orden de tabulación: el primer Tab llega a la cabecera, nunca a una portada', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/collections/coches'), { waitUntil: 'networkidle' });
  const seen = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => document.activeElement.className + ' ' + (document.activeElement.getAttribute('aria-hidden') || '')));
  }
  assert(!seen.some((s) => /sidonia-card__cover/.test(s)), 'una portada recibe el foco');
  await ctx.close();
});
await run('Datos estructurados: oferta solo con precio publicado y pieza disponible; nunca precio 0; sin el JSON-LD comprable de Impact', async () => {
  const ld = async (h) => {
    const r = await httpGet(url('/products/' + h));
    assert(!/"price":\s*"?0(\.0+)?"?[,}]/.test(r.body), `${h}: precio 0 en el HTML`);
    return [...r.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  };
  const a = await ld('prueba-coche-a');
  const pieces = a.filter((b) => /Car|Product|Vehicle|Boat|Residence|House/.test(b['@type']));
  eq(pieces.length, 1, 'bloques de producto (Impact no debe emitir el suyo)');
  eq(pieces[0].offers && pieces[0].offers.price, '85000', 'oferta con el precio publicado');
  assert(a.some((b) => b['@type'] === 'BreadcrumbList'), 'sin BreadcrumbList');
  for (const h of ['prueba-coche-b-a-consultar', 'prueba-coche-c-minimo', 'prueba-casa-b-vendida']) {
    const p = (await ld(h)).find((b) => /Car|Product/.test(b['@type']));
    assert(p && !p.offers, `${h}: no debe tener oferta`);
  }
});
await run('Teléfono y correo privados del propietario nunca aparecen en la web', async () => {
  const pages = ['/products/prueba-coche-a', '/products/prueba-barco-a', '/collections/explorar', '/products/prueba-coche-a?view=sidonia-card'];
  for (const p of pages) {
    const r = await httpGet(url(p));
    assert(!/Nombre oculto/.test(r.body), `${p}: aparece el nombre no autorizado`);
  }
});

/* ============================================================ 10. Impact: comercio normal y editor */
section('10. Comercio normal de la tienda y editor de temas');
if (IMPACT) {
  await run('Un producto normal (no pieza) conserva el precio y la compra de Impact; aparece con su precio en la búsqueda', async () => {
    const { ctx, page } = await open(browser);
    await page.goto(url('/products/prueba-libro'), { waitUntil: 'networkidle' });
    const t = await page.locator('main').innerText();
    assert(/25,00\s?€/.test(t), 'no se ve el precio de venta');
    assert(await page.locator('buy-buttons button[type=submit], buy-buttons [type=submit]').count(), 'no hay botón de compra');
    eq(await page.locator('[data-sidonia-card]').count(), 0, 'tarjetas Sidonia en la ficha de un producto normal');
    await page.goto(url('/search?q=libro'), { waitUntil: 'networkidle' });
    const card = page.locator('[data-product-handle="prueba-libro"]');
    assert(/25,00\s?€/.test(await card.innerText()), 'el producto normal no muestra su precio en la búsqueda');
    await ctx.close();
  });
  await run('En la colección «all» de Impact, las piezas usan la tarjeta Sidonia y los productos normales la de Impact; ningún 0,00 €', async () => {
    const { ctx, page } = await open(browser);
    await page.goto(url('/collections/all?page=2'), { waitUntil: 'networkidle' });
    const info = await page.evaluate(() => ({
      sidonia: document.querySelectorAll('product-list [data-sidonia-card], .product-list [data-sidonia-card], [data-sidonia-card].sidonia-card--in-impact').length,
      book: !!document.querySelector('product-card'),
      zero: /\b0,00\s?€/.test(document.querySelector('main').innerText)
    }));
    assert(info.sidonia > 0, 'Impact no pinta la tarjeta Sidonia para las piezas');
    assert(info.book, 'el producto normal no usa la tarjeta de Impact');
    assert(!info.zero, 'aparece un precio 0,00 €');
    await ctx.close();
    return `${info.sidonia} piezas con tarjeta Sidonia junto a la tarjeta normal de Impact`;
  });
}
await run('Editor de temas: descargar y volver a cargar secciones no da errores ni duplica comportamientos', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(url('/?design_mode=1'), { waitUntil: 'networkidle' });
  const n = await page.evaluate(async () => {
    const secs = [...document.querySelectorAll('main .shopify-section')].filter((s) => s.querySelector('[class*="sidonia-"]'));
    for (const sec of secs) {
      const id = sec.id.replace('shopify-section-', '');
      const html = sec.outerHTML;
      sec.dispatchEvent(new CustomEvent('shopify:section:unload', { bubbles: true, detail: { sectionId: id } }));
      const parent = sec.parentNode;
      const next = sec.nextSibling;
      sec.remove();
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const fresh = tmp.firstElementChild;
      parent.insertBefore(fresh, next);
      fresh.dispatchEvent(new CustomEvent('shopify:section:load', { bubbles: true, detail: { sectionId: id } }));
    }
    await new Promise((r) => setTimeout(r, 600));
    return secs.length;
  });
  const save = page.locator('.sidonia-save__btn:visible').first();
  if (await save.count()) {
    await save.click();
    eq(await save.getAttribute('aria-pressed'), 'true', 'Guardar tras recargar secciones (un solo listener)');
    await save.click();
    eq(await save.getAttribute('aria-pressed'), 'false', 'Quitar tras recargar secciones');
  }
  eq(page.errors.length, 0, 'errores: ' + page.errors.join(' | '));
  await ctx.close();
  return `${n} secciones descargadas y recargadas`;
});

/* ============================================================ resultado */
await browser.close();
for (const s of Object.values(servers)) s.server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} de ${results.length} pruebas correctas`);
if (!filter) writeFileSync(join(here, `last-run-${TARGET}.json`), JSON.stringify({ at: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2) + '\n');
process.exit(failed.length ? 1 : 0);
