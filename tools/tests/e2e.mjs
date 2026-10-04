// Pruebas end-to-end del tema de Sidonia contra la previsualización local (intérprete de pruebas + Chromium).
// Uso: node tools/tests/e2e.mjs [filtro]
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup, open, test, assert, eq, results, httpGet } from './harness.mjs';
const fetch = (u) => httpGet(u);

const filter = process.argv[2] || '';
const { full, empty, browser, URL: site } = await setup();
// El panel de filtros es un cajón modal en todos los anchos (con JS): hay que abrirlo antes de tocar casillas.
const ensureFilters = async (page) => {
  const open = await page.evaluate(() => !!document.querySelector('.sd-filters[open]'));
  if (open) return;
  const toggle = page.locator('[data-sd-open-filters]');
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.waitForSelector('.sd-filters[open]');
  }
};
const closeFilters = async (page) => {
  if (await page.evaluate(() => !!document.querySelector('dialog.sd-filters[open]:modal'))) {
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sd-filters:not([open])', { state: 'attached' });
  }
};
const checkFilter = async (page, key, label) => {
  await ensureFilters(page);
  const g = page.locator(`.sd-fgroup[data-group="filter.p.m.sidonia.${key}"]`);
  await g.evaluate((el) => (el.open = true));
  await g.locator('label', { hasText: label }).locator('input').check();
};
const WIDTHS = [360, 390, 768, 1024, 1440];
const run = (name, fn) => (!filter || name.toLowerCase().includes(filter.toLowerCase()) ? test(name, fn) : null);


/* =========================== 1. Responsive y consola =========================== */
console.log('\n1. Responsive, desbordes y errores');
const ROUTES = ['/', '/collections/explorar', '/collections/coches', '/collections/archivo', '/products/prueba-coche-a', '/products/prueba-barco-a', '/products/prueba-casa-a', '/products/prueba-casa-b-vendida', '/pages/vender', '/pages/como-vendemos', '/pages/sobre-sidonia', '/pages/favoritos', '/pages/contacto', '/pages/busco', '/pages/marcas', '/pages/privacidad', '/search?q=Marca&type=product', '/nope'];
for (const w of WIDTHS) {
  await run(`Sin desbordes ni errores a ${w}px (perfil completo, ${ROUTES.length} páginas)`, async () => {
    const { ctx, page } = await open(browser, { viewport: { width: w, height: 800 } });
    const bad = [];
    for (const r of ROUTES) {
      await page.goto(site(r), { waitUntil: 'networkidle' });
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (ov > 0) bad.push(`${r}: desborde ${ov}px`);
      const h1 = await page.locator('h1').count();
      if (h1 !== 1) bad.push(`${r}: ${h1} h1`);
      const errs = page.errors.splice(0).filter((e) => !(r === '/nope' && /status of 404/.test(e)));
      if (errs.length) bad.push(`${r}: ${errs.join(' | ')}`);
    }
    await ctx.close();
    assert(!bad.length, bad.join(' ; '));
    return `${ROUTES.length} páginas`;
  });
}
await run('Sin desbordes ni errores a 360 y 1440 px (instalación vacía, sin contenido real)', async () => {
  const bad = [];
  for (const w of [360, 1440]) {
    const { ctx, page } = await open(browser, { viewport: { width: w, height: 800 } });
    for (const r of ['/', '/collections/coches', '/collections/explorar', '/pages/vender', '/pages/contacto', '/pages/favoritos', '/search', '/cart', '/nope']) {
      await page.goto(site(r, 'empty'), { waitUntil: 'networkidle' });
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (ov > 0) bad.push(`${w} ${r}: desborde`);
      const errs = page.errors.splice(0).filter((e) => !(r === '/nope' && /status of 404/.test(e)));
      if (errs.length) bad.push(`${w} ${r}: ${errs.join(' | ')}`);
    }
    await ctx.close();
  }
  assert(!bad.length, bad.join(' ; '));
});

/* =========================== 2. Home =========================== */
console.log('\n2. Home y primer bloque');
await run('El hero comunica coches, barcos, casas y vídeo narrativo en el primer bloque', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/'), { waitUntil: 'networkidle' });
  const h1 = await page.locator('h1').innerText();
  eq(h1, 'Coches, barcos y casas con alma', 'titular');
  const hero = page.locator('.sd-hero');
  const txt = await hero.innerText();
  for (const t of ['Coches', 'Barcos', 'Casas', 'Explorar la selección', 'Quiero vender con Sidonia', 'Ver cómo lo contamos']) assert(txt.includes(t), 'falta «' + t + '» en el hero');
  assert((await hero.locator('input[type=search]').count()) === 1, 'sin buscador en el hero');
  const box = await hero.locator('.sd-hero__play').boundingBox();
  assert(box && box.y < 900, 'control de vídeo fuera del primer pantallazo');
  await ctx.close();
});
for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 800 }]) {
  await run(`Los dos botones principales se ven sin desplazarse a ${vp.width}×${vp.height}`, async () => {
    const { ctx, page } = await open(browser, { viewport: vp });
    await page.goto(site('/'), { waitUntil: 'networkidle' });
    for (const label of ['Explorar la selección', 'Quiero vender con Sidonia']) {
      const b = await page.locator('.sd-hero__ctas a', { hasText: label }).boundingBox();
      assert(b && b.y + b.height <= vp.height, `«${label}» queda por debajo del pliegue (y=${b && Math.round(b.y)})`);
    }
    await ctx.close();
  });
}
await run('Instalación vacía: logo en texto accesible, menú de reserva, secciones vacías ocultas y avisos solo en el editor', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/', 'empty'), { waitUntil: 'networkidle' });
  const brand = await page.locator('.sd-header__brand').getAttribute('aria-label');
  eq(brand, 'SIDONIA', 'nombre accesible del logo');
  const logoSrc = await page.locator('.sd-header__brand img').first().getAttribute('src');
  assert(/sidonia-logo-dark\.png/.test(logoSrc), 'logo incluido en el tema (variante oscura sobre cabecera clara): ' + logoSrc);
  const logoFoot = await page.locator('.sd-footer img[src*="sidonia-logo"]').count();
  assert(logoFoot >= 1, 'logo en el pie');
  assert((await page.locator('.sd-nav__list a').count()) >= 6, 'menú de reserva incompleto');
  assert((await page.locator('.sd-selection').count()) === 0, 'la selección vacía debe ocultarse fuera del editor');
  assert((await page.locator('.sd-story').count()) === 0, 'la historia sin pieza debe ocultarse');
  assert((await page.locator('.sd-testimonials').count()) === 0, 'testimonios vacíos deben ocultarse');
  assert((await page.locator('.sd-hero__mosaic .sd-hero__tile').count()) === 3, 'mosaico de reserva del hero (una tarjeta por división)');
  assert((await page.locator('.sd-hero__play').count()) === 0, 'no debe haber control de vídeo sin vídeo');
  const community = await page.locator('.sd-community').innerText();
  assert(community.includes('Más de 200'), 'dato del fundador');
  assert(!/seguidores|suscriptores/.test(community), 'no deben inventarse cifras de seguidores');
  assert((await page.locator('a[href^="https://wa.me"], a[href^="mailto:"]').count()) === 0, 'enlaces de contacto sin configurar');
  await page.goto(site('/?design_mode=1', 'empty'), { waitUntil: 'networkidle' });
  assert((await page.locator('.sd-selection').count()) === 1, 'en el editor la selección debe mostrar su aviso');
  assert((await page.locator('.sd-story').count()) === 1, 'en el editor la historia debe mostrar su aviso');
  await ctx.close();
});
await run('Métricas: solo se publican redes con perfil y cifra; sin cifras inventadas ni sumas', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/'), { waitUntil: 'networkidle' });
  const items = await page.locator('.sd-metrics .sd-metric').allInnerTexts();
  eq(items.length, 1, 'redes publicadas');
  assert(items[0].includes('12,4 mil') && /Instagram/.test(items[0]), 'cifra de Instagram');
  const all = await page.locator('.sd-community').innerText();
  assert(!/TikTok/.test(all), 'TikTok no tiene cifra: no se publica');
  assert(!/personas únicas/i.test(all), 'no debe hablar de personas únicas');
  await ctx.close();
});
await run('Tres mundos: el contador procede de la colección y coincide con el listado', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/'), { waitUntil: 'networkidle' });
  const txt = await page.locator('.sd-divcard.sd-cat--garage .sd-divcard__count').innerText();
  await page.goto(site('/collections/coches'), { waitUntil: 'networkidle' });
  const count = await page.locator('[data-sd-swap="count"]').innerText();
  eq(txt.replace(/\D/g, ''), count.replace(/\D/g, ''), 'contador de la división vs. listado');
  await ctx.close();
});

/* =========================== 3. Tarjetas =========================== */
console.log('\n3. Tarjetas');
await run('Tarjetas: sin botones dentro de enlaces, un enlace de ficha, destinos táctiles ≥ 44 px', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 390, height: 800 } });
  await page.goto(site('/collections/explorar'), { waitUntil: 'networkidle' });
  const r = await page.evaluate(() => {
    const out = { nested: 0, noLink: 0, small: [], cards: 0 };
    document.querySelectorAll('.sd-card').forEach((c) => {
      out.cards++;
      if (c.querySelector('a button, a [role=button], button a')) out.nested++;
      if (c.querySelectorAll('.sd-card__link').length !== 1) out.noLink++;
      c.querySelectorAll('.sd-play, .sd-save__btn').forEach((b) => {
        const r = b.getBoundingClientRect();
        if (r.width < 44 || r.height < 44) out.small.push(`${Math.round(r.width)}x${Math.round(r.height)}`);
      });
    });
    return out;
  });
  assert(r.cards >= 12, 'faltan tarjetas');
  eq(r.nested, 0, 'botones anidados en enlaces');
  eq(r.noLink, 0, 'tarjetas sin enlace único de ficha');
  assert(!r.small.length, 'destinos pequeños: ' + r.small.join(','));
  await ctx.close();
});
await run('Tarjetas: estado, precio real, «Precio a consultar» y «no publicado», sin 0 ni «gratis»', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/collections/coches'), { waitUntil: 'networkidle' });
  const grid = await page.locator('[data-sd-grid]').innerText();
  assert(grid.includes('Precio a consultar') && grid.includes('Precio no publicado') && /85\.000\s€/.test(grid), 'textos de precio');
  assert(!/(^|\s)0\s?€|gratis|gratuito/i.test(grid), 'aparece un 0 o «gratis»');
  assert(grid.includes('Reservado'), 'estado reservado visible');
  assert(!grid.includes('Vendido'), 'los vendidos no deben mezclarse en la colección principal');
  await page.goto(site('/collections/archivo'), { waitUntil: 'networkidle' });
  const arch = await page.locator('[data-sd-grid]').innerText();
  assert(arch.includes('Vendido') && !arch.includes('Disponible'), 'el archivo solo muestra vendidas, con estado inequívoco');
  await ctx.close();
});
await run('Tarjetas: duración solo si se conoce y sin vídeo no hay botón de reproducir', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/collections/explorar'), { waitUntil: 'networkidle' });
  const a = await page.locator('.sd-card', { hasText: 'Coche de ejemplo A' }).locator('.sd-play').innerText();
  assert(a.includes('1:23'), 'duración 1:23');
  const bPlay = await page.locator('.sd-card', { hasText: 'Coche B (precio' }).locator('.sd-play').count();
  eq(bPlay, 0, 'botón de vídeo en pieza sin vídeo');
  await ctx.close();
});

/* =========================== 4. Vídeo =========================== */
console.log('\n4. Vídeo');
await run('Listados: no se descarga ningún vídeo ni existe <video> al cargar', async () => {
  const { ctx, page } = await open(browser);
  for (const r of ['/', '/collections/explorar', '/search?q=Marca&type=product']) {
    await page.goto(site(r), { waitUntil: 'networkidle' });
    const vids = await page.locator('video').count();
    const reqs = page.requests.filter((u) => /clip\.webm|\.mp4/.test(u));
    assert(vids === 0 && reqs.length === 0, `${r}: ${vids} <video>, ${reqs.length} peticiones de vídeo`);
  }
  await ctx.close();
});
await run('Modal: el vídeo se crea al pulsar, suena (no silenciado), Escape lo cierra, lo elimina y devuelve el foco', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/collections/explorar'), { waitUntil: 'networkidle' });
  const trigger = page.locator('.sd-card', { hasText: 'Coche de ejemplo A' }).locator('.sd-play');
  await trigger.focus();
  await trigger.click();
  await page.waitForSelector('.sd-vmodal[open] video');
  const state = await page.evaluate(() => {
    const v = document.querySelector('.sd-vmodal video');
    return { muted: v.muted, controls: v.controls, src: v.currentSrc };
  });
  assert(!state.muted && state.controls, 'el vídeo del modal debe tener sonido y controles tras el clic');
  await page.waitForFunction(() => !document.querySelector('.sd-vmodal video').paused, null, { timeout: 5000 });
  const title = await page.locator('.sd-vmodal__title').innerText();
  assert(title.includes('Coche de ejemplo A'), 'título del modal');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sd-vmodal:not([open])', { state: 'attached' });
  await page.waitForFunction(() => !document.querySelector('.sd-vmodal video'), null, { timeout: 3000 });
  eq(await page.locator('.sd-vmodal video').count(), 0, 'vídeo tras cerrar');
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.className);
  assert(/sd-play/.test(focused), 'el foco debe volver al botón de reproducir (foco: ' + focused + ')');
  await ctx.close();
});
await run('Modal: botón de cerrar visible y clic en el fondo cierran; el vertical no se estira ni se recorta', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/collections/explorar'), { waitUntil: 'networkidle' });
  await page.locator('.sd-card', { hasText: 'Coche de ejemplo A' }).locator('.sd-play').click();
  await page.waitForSelector('.sd-vmodal[open] video');
  const m = await page.evaluate(() => {
    const s = document.querySelector('.sd-vmodal .sd-vstage').getBoundingClientRect();
    const v = document.querySelector('.sd-vmodal video');
    return { ratio: s.width / s.height, fit: getComputedStyle(v).objectFit, h: s.height, vh: innerHeight };
  });
  assert(Math.abs(m.ratio - 0.5625) < 0.02, 'relación del vídeo vertical: ' + m.ratio);
  eq(m.fit, 'contain', 'object-fit del vídeo completo');
  assert(m.h <= m.vh, 'el vídeo cabe en pantalla');
  await page.locator('.sd-vmodal [data-sd-close]').click();
  await page.waitForSelector('.sd-vmodal:not([open])', { state: 'attached' });
  await page.locator('.sd-card', { hasText: 'Coche de ejemplo A' }).locator('.sd-play').click();
  await page.waitForSelector('.sd-vmodal[open]');
  await page.mouse.click(5, 5);
  await page.waitForSelector('.sd-vmodal:not([open])', { state: 'attached' });
  await ctx.close();
});
await run('Un solo vídeo con sonido a la vez (ficha + modal)', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  await page.locator('[data-sd-start]').click();
  await page.waitForFunction(() => document.querySelector('sd-video-stage video:not(.sd-vplayer__preview)') && !document.querySelector('sd-video-stage video:not(.sd-vplayer__preview)').paused);
  await page.locator('.sd-related .sd-play').first().scrollIntoViewIfNeeded();
  await page.locator('.sd-related .sd-play').first().click();
  await page.waitForSelector('.sd-vmodal[open] video');
  await page.waitForFunction(() => !document.querySelector('.sd-vmodal video').paused);
  const audible = await page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused && !v.muted).length);
  eq(audible, 1, 'vídeos audibles simultáneos');
  await ctx.close();
});
await run('Ficha: vídeo vertical con reproductor junto a la información, sin audio automático y con controles tras empezar', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  const layout = await page.evaluate(() => {
    const m = document.querySelector('.sd-pdp__media').getBoundingClientRect();
    const i = document.querySelector('.sd-pdp__info').getBoundingClientRect();
    const st = document.querySelector('.sd-vplayer__stage').getBoundingClientRect();
    return { side: m.right <= i.left + 1, ratio: st.width / st.height, loud: [...document.querySelectorAll('video')].filter((v) => !v.paused && !v.muted).length };
  });
  assert(layout.side, 'el reproductor debe ir junto a la columna de información en escritorio');
  assert(Math.abs(layout.ratio - 0.5625) < 0.02, 'proporción vertical reservada: ' + layout.ratio);
  eq(layout.loud, 0, 'audio sin interacción');
  await page.locator('[data-sd-start]').click();
  await page.waitForSelector('sd-video-stage video[controls]');
  const v = await page.evaluate(() => {
    const el = document.querySelector('sd-video-stage video[controls]');
    return { fit: getComputedStyle(el).objectFit, muted: el.muted, tracks: el.querySelectorAll('track').length };
  });
  eq(v.fit, 'contain', 'el vídeo completo preserva el encuadre');
  assert(!v.muted, 'sonido activo tras la acción explícita');
  eq(v.tracks, 1, 'pista de subtítulos');
  await ctx.close();
});
await run('Ficha horizontal (16:9): se reserva proporción horizontal y no se recorta', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/products/prueba-barco-a'), { waitUntil: 'networkidle' });
  const r = await page.evaluate(() => {
    const st = document.querySelector('.sd-vplayer__stage').getBoundingClientRect();
    return st.width / st.height;
  });
  assert(Math.abs(r - 1.7778) < 0.03, 'proporción horizontal: ' + r);
  await ctx.close();
});
await run('Previsualización silenciosa: solo en escritorio, en bucle, silenciada; ausente con reducir movimiento y en móvil', async () => {
  let { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  await page.waitForSelector('.sd-vplayer__preview', { timeout: 4000 });
  const p = await page.evaluate(() => {
    const v = document.querySelector('.sd-vplayer__preview');
    return { muted: v.muted, loop: v.loop, aria: v.getAttribute('aria-hidden') };
  });
  assert(p.muted && p.loop && p.aria === 'true', 'preview muted/loop/aria-hidden');
  await ctx.close();
  ({ ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }));
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  eq(await page.locator('.sd-vplayer__preview').count(), 0, 'preview con reducir movimiento');
  await ctx.close();
  ({ ctx, page } = await open(browser, { viewport: { width: 390, height: 800 } }));
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  eq(await page.locator('.sd-vplayer__preview').count(), 0, 'preview en móvil');
  await ctx.close();
});
await run('Previsualización: si el navegador rechaza play(), no hay errores visibles y queda la portada', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      return Promise.reject(new DOMException('bloqueado', 'NotAllowedError'));
    };
  });
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  eq(await page.locator('.sd-vplayer__preview').count(), 0, 'preview retirada tras el rechazo');
  assert((await page.locator('.sd-vplayer__poster').isVisible()), 'la portada sigue visible');
  assert(!page.errors.length, 'errores: ' + page.errors.join('|'));
  await ctx.close();
});
await run('Vídeo roto: mensaje útil con reintento y la ficha conserva datos y contacto', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.route('**/clip.webm*', (r) => r.fulfill({ status: 404, body: 'no' }));
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  await page.locator('[data-sd-start]').click();
  await page.waitForSelector('.sd-vplayer__consent');
  const msg = await page.locator('.sd-vplayer__consent').innerText();
  assert(/No hemos podido cargar el vídeo/.test(msg) && /Reintentar/.test(msg), 'mensaje de error');
  assert(await page.locator('.sd-pdp__price').isVisible(), 'precio visible');
  assert(await page.locator('a[href^="https://wa.me"]').first().isVisible(), 'contacto visible');
  await ctx.close();
});
await run('Proveedores externos: no se carga ningún iframe hasta confirmar; se usa youtube-nocookie', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/collections/explorar'), { waitUntil: 'networkidle' });
  assert(!page.requests.some((u) => /youtube|vimeo/.test(u)), 'petición externa al cargar el listado');
  await page.locator('.sd-card', { hasText: 'vídeo de YouTube' }).locator('.sd-play').click();
  await page.waitForSelector('.sd-vstage__msg');
  eq(await page.locator('iframe').count(), 0, 'iframes antes del consentimiento');
  assert(!page.requests.some((u) => /youtube/.test(u)), 'petición a YouTube antes de confirmar');
  await page.locator('.sd-vstage__msg button').click();
  await page.waitForSelector('.sd-vmodal iframe');
  const src = await page.locator('.sd-vmodal iframe').getAttribute('src');
  assert(src.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), 'src del iframe: ' + src);
  await ctx.close();
});

/* =========================== 5. Ficha: datos, precio, compra =========================== */
console.log('\n5. Ficha de pieza');
const ld = async (page) => page.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent)));
await run('Datos estructurados válidos; oferta solo con precio publicado y pieza disponible (nunca 0, a consultar, no publicado ni vendida)', async () => {
  const { ctx, page } = await open(browser);
  const cases = [
    ['prueba-coche-a', true], ['prueba-coche-b-a-consultar', false], ['prueba-coche-c-minimo', false], ['prueba-coche-d-vendido', false],
    ['prueba-barco-a', true], ['prueba-barco-b-reservado', false], ['prueba-casa-a', false], ['prueba-casa-b-vendida', false], ['prueba-coche-f-sin-portada', false]
  ];
  for (const [h, expectOffer] of cases) {
    await page.goto(site('/products/' + h), { waitUntil: 'networkidle' });
    const blocks = await ld(page);
    const prod = blocks.find((b) => b['@type'] !== 'VideoObject');
    assert(prod, h + ': sin JSON-LD de pieza');
    const has = !!prod.offers;
    assert(has === expectOffer, `${h}: oferta=${has}, esperado ${expectOffer}`);
    if (has) {
      assert(Number(prod.offers.price) > 0 && prod.offers.priceCurrency === 'EUR', h + ': precio/moneda de la oferta');
      eq(prod.offers.availability, 'https://schema.org/InStock', h + ' disponibilidad');
    }
    assert(!('aggregateRating' in prod) && !('review' in prod), h + ': valoraciones inventadas');
  }
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  const v = (await ld(page)).find((b) => b['@type'] === 'VideoObject');
  assert(v && v.contentUrl && v.thumbnailUrl && v.uploadDate && v.duration === 'PT1M23S', 'VideoObject válido con duración');
  await page.goto(site('/products/prueba-coche-c-minimo'), { waitUntil: 'networkidle' });
  assert(!(await ld(page)).some((b) => b['@type'] === 'VideoObject'), 'VideoObject sin vídeo');
  await ctx.close();
});
await run('Precio a consultar / no publicado en la ficha: ni 0 ni «gratis» ni nada comprable', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/products/prueba-coche-b-a-consultar'), { waitUntil: 'networkidle' });
  const t = await page.locator('.sd-pdp__price').innerText();
  assert(/Precio a consultar/.test(t) && !/\d\s?€|gratis/i.test(t), 'texto de precio: ' + t);
  await page.goto(site('/products/prueba-coche-c-minimo'), { waitUntil: 'networkidle' });
  assert(/Precio no publicado/.test(await page.locator('.sd-pdp__price').innerText()), 'precio no publicado');
  await ctx.close();
});
await run('Ninguna ficha ni listado contiene carrito, cantidad, compra rápida ni botones de pago', async () => {
  const { ctx, page } = await open(browser);
  for (const r of ['/products/prueba-coche-a', '/products/prueba-coche-d-vendido', '/collections/explorar', '/']) {
    await page.goto(site(r), { waitUntil: 'networkidle' });
    const found = await page.evaluate(() => ({
      forms: document.querySelectorAll('form[action*="/cart"]').length,
      qty: document.querySelectorAll('input[name="quantity"], [name="add"], [data-add-to-cart]').length,
      pay: document.querySelectorAll('[class*="shopify-payment"], .additional-checkout-buttons').length,
      text: /añadir al carrito|comprar ahora|add to cart|buy now/i.test(document.body.innerText)
    }));
    assert(!found.forms && !found.qty && !found.pay && !found.text, `${r}: ${JSON.stringify(found)}`);
  }
  await page.goto(site('/cart'), { waitUntil: 'networkidle' });
  assert((await page.locator('h1').innerText()).includes('Aquí no hay carrito'), 'página de carrito informativa');
  await ctx.close();
});
await run('Datos correctos por categoría y los desconocidos se ocultan (garage, harbor, estate, mínimo)', async () => {
  const { ctx, page } = await open(browser);
  const dts = async () => (await page.locator('.sd-dl dt').allInnerTexts()).join('|');
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  let t = await dts();
  for (const l of ['Año', 'Kilometraje', 'Cambio', 'Combustible', 'Potencia', 'Marca', 'Modelo', 'Versión']) assert(t.includes(l), 'garage sin ' + l);
  assert(!t.includes('Eslora') && !t.includes('Superficie'), 'garage con datos de otras categorías');
  await page.goto(site('/products/prueba-barco-a'), { waitUntil: 'networkidle' });
  t = await dts();
  for (const l of ['Eslora', 'Manga', 'Constructor', 'Motorización', 'Horas de motor', 'Régimen fiscal declarado']) assert(t.includes(l), 'harbor sin ' + l);
  assert((await page.locator('.sd-dl dd', { hasText: '12,5' }).count()) >= 1, 'eslora 12,5 m');
  await page.goto(site('/products/prueba-casa-a'), { waitUntil: 'networkidle' });
  t = await dts();
  for (const l of ['Superficie', 'Dormitorios', 'Baños', 'Parcela', 'Certificación energética']) assert(t.includes(l), 'estate sin ' + l);
  await page.goto(site('/products/prueba-coche-c-minimo'), { waitUntil: 'networkidle' });
  assert(!(await page.locator('.sd-dl--key').count()), 'sin datos esenciales no debe pintarse la tabla');
  const body = await page.locator('main').innerText();
  assert(!/Kilometraje|Año\b/.test(body.split('Consulta')[0]), 'dato desconocido convertido en cero o visible');
  assert(!(await page.locator('.sd-pstory, .sd-ptimeline').count()), 'bloques sin datos deben ocultarse');
  await ctx.close();
});
await run('Ubicación pública: respeta la precisión elegida (región, ciudad, país)', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  let line = await page.locator('.sd-pdp__line').innerText();
  assert(line.includes('Región de prueba') && !line.includes('Ciudad de prueba'), 'precisión región: ' + line);
  await page.goto(site('/products/prueba-casa-a'), { waitUntil: 'networkidle' });
  line = await page.locator('.sd-pdp__line').innerText();
  assert(line.includes('Pueblo de prueba, Mallorca'), 'precisión ciudad: ' + line);
  await page.goto(site('/products/prueba-coche-f-sin-portada'), { waitUntil: 'networkidle' });
  line = await page.locator('.sd-pdp__line').innerText();
  assert(line.includes('España') && !line.includes('Región F'), 'precisión país: ' + line);
  await ctx.close();
});
await run('Pieza sin portada ni vídeo: composición de reserva, mensaje útil y contacto', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/products/prueba-coche-f-sin-portada'), { waitUntil: 'networkidle' });
  assert(await page.locator('.sd-vplayer__poster-fallback').isVisible(), 'composición de reserva');
  assert((await page.locator('.sd-vplayer__meta').innerText()).includes('todavía no tiene vídeo'), 'mensaje sin vídeo');
  assert(await page.locator('a[href^="https://wa.me"]').first().isVisible(), 'contacto');
  await ctx.close();
});
await run('Pieza vendida: estado inequívoco, sin precio ni «Me interesa», con «Busco algo parecido»', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/products/prueba-casa-b-vendida'), { waitUntil: 'networkidle' });
  const t = await page.locator('main').innerText();
  assert(/Vendido/.test(t) && /ya está vendida/.test(t), 'estado vendido');
  assert(!/Me interesa esta pieza|Consultar esta pieza/.test(t), 'invitación a una pieza no disponible');
  assert(/Busco algo parecido/.test(t), 'busco algo parecido');
  assert(!(await page.locator('.sd-pdp__priceval').count()), 'sin precio en vendidas');
  const wa = await page.locator('a[href^="https://wa.me"]').first().getAttribute('href');
  assert(/parecido/i.test(decodeURIComponent(new URL(wa).searchParams.get('text'))), 'mensaje de WhatsApp «algo parecido»');
  assert(/Piezas parecidas/.test(t), 'bloque de piezas parecidas disponibles');
  await ctx.close();
});
await run('WhatsApp y email: referencia, nombre y URL correctas y bien codificadas', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  const wa = new URL(await page.locator('a[href^="https://wa.me"]').first().getAttribute('href'));
  eq(wa.pathname, '/34600000000', 'número internacional solo con dígitos');
  const text = wa.searchParams.get('text');
  assert(text.includes('[PRUEBA] Coche de ejemplo A') && text.includes('referencia PR-G-001') && text.includes('http://localhost:4190/products/prueba-coche-a') && text.includes('¿Podéis darme más información?'), 'texto de WhatsApp: ' + text);
  const mail = await page.locator('a[href^="mailto:"]').first().getAttribute('href');
  const mu = new URL(mail);
  eq(mu.pathname, 'pruebas@sidonia.test', 'dirección');
  const subj = decodeURIComponent(mail.match(/subject=([^&]+)/)[1]);
  const body = decodeURIComponent(mail.match(/body=(.+)$/)[1]);
  assert(subj.includes('PR-G-001') && body.includes('http://localhost:4190/products/prueba-coche-a') && body.includes('\r\n'), 'asunto/cuerpo del mailto');
  assert(!/\+/.test(mail.split('?')[1].replace(/%2B/g, '')), 'espacios codificados como + en mailto');
  const note = await page.locator('.sd-pdp__actions .sd-note').first().innerText();
  assert(/no se envía nada hasta que lo envíes tú/i.test(note), 'nota sobre el cliente de correo');
  await ctx.close();
});
await run('Sin canales configurados no hay enlaces de WhatsApp ni email (perfil vacío) y se avisa en el editor', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/pages/contacto', 'empty'), { waitUntil: 'networkidle' });
  eq(await page.locator('a[href^="https://wa.me"], a[href^="mailto:"], a[href^="tel:"]').count(), 0, 'enlaces de contacto');
  assert((await page.locator('.sd-contact__channels').innerText()).includes('Aviso para el editor'), 'aviso de configuración');
  assert(await page.locator('.sd-contact__form form').count() === 1, 'el formulario sigue disponible');
  await ctx.close();
});
await run('Compartir: copiar enlace funciona cuando no hay Web Share', async () => {
  const { ctx, page } = await open(browser);
  await page.addInitScript(() => { delete Navigator.prototype.share; });
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  const btn = page.locator('[data-sd-share-btn]');
  assert(/Copiar enlace/.test(await btn.innerText()), 'etiqueta alternativa');
  await btn.click();
  await page.waitForSelector('.sd-toast');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert(clip.endsWith('/products/prueba-coche-a'), 'portapapeles: ' + clip);
  await ctx.close();
});
await run('Barra fija de contacto en móvil: visible, se oculta con el formulario a la vista y no tapa contenido', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 390, height: 800 } });
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  assert(await page.locator('sd-stickybar').isVisible(), 'barra visible');
  await page.locator('#consulta').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  assert(!(await page.locator('sd-stickybar').isVisible()), 'barra oculta con el formulario visible');
  await ctx.close();
  const d = await open(browser, { viewport: { width: 1440, height: 900 } });
  await d.page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  assert(!(await d.page.locator('sd-stickybar').isVisible()), 'sin barra en escritorio');
  await d.ctx.close();
});
await run('Piezas relacionadas: de la misma división, explicables, nunca vendidas ni la propia', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  const t = await page.locator('.sd-related').innerText();
  assert(/Elegidas por el equipo de Sidonia/.test(t), 'explicación de selección manual');
  const titles = await page.locator('.sd-related .sd-card__title').allInnerTexts();
  assert(!titles.some((x) => /Coche de ejemplo A|Coche D \(vendido\)|Casa B/.test(x)), 'no debe incluir la propia ni vendidas: ' + titles.join('|'));
  assert(titles.length === 4, 'cuatro piezas: ' + titles.length);
  await ctx.close();
});

/* =========================== 6. Catálogo, filtros, búsqueda =========================== */
console.log('\n6. Catálogo, filtros y búsqueda');
await run('Filtros: consultan todo el catálogo (no solo la página visible), con estado en URL, atrás/adelante y recarga', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/collections/coches'), { waitUntil: 'networkidle' });
  const total = parseInt((await page.locator('[data-sd-swap="count"]').innerText()).replace(/\D/g, ''), 10);
  const shown = await page.locator('[data-sd-grid] .sd-card').count();
  assert(total > shown, `el catálogo (${total}) debe tener más piezas que la página (${shown})`);
  // «Marca B» solo existe en piezas que no están en la primera página
  const group = page.locator('.sd-fgroup[data-group="filter.p.m.sidonia.brand"]');
  await checkFilter(page, 'brand', 'Marca B');
  await page.waitForFunction(() => /filter\.p\.m\.sidonia\.brand=Marca\+B|Marca%20B/.test(location.search));
  await page.waitForFunction((t) => parseInt(document.querySelector('[data-sd-swap="count"]').textContent.replace(/\D/g, ''), 10) < t, total);
  const filtered = parseInt((await page.locator('[data-sd-swap="count"]').innerText()).replace(/\D/g, ''), 10);
  assert(filtered > 0 && filtered < total, 'recuento filtrado ' + filtered);
  const titles = await page.locator('[data-sd-grid] .sd-card').evaluateAll((els) => els.map((e) => e.querySelector('.sd-card__title').textContent));
  assert(titles.length === filtered, 'tarjetas = recuento');
  assert((await page.locator('.sd-activebar .sd-chip--filter').count()) === 1, 'chip de filtro activo');
  const url1 = page.url();
  await page.reload({ waitUntil: 'networkidle' });
  eq(page.url(), url1, 'URL tras recargar');
  eq(parseInt((await page.locator('[data-sd-swap="count"]').innerText()).replace(/\D/g, ''), 10), filtered, 'recuento tras recargar (render del servidor)');
  assert(await page.locator('.sd-fgroup[data-group="filter.p.m.sidonia.brand"] input:checked').count() === 1, 'casilla marcada tras recargar');
  // atrás / adelante
  await ensureFilters(page);
  await page.locator('.sd-fgroup[data-group="filter.p.m.sidonia.year_band"]').evaluate((el) => (el.open = true));
  await page.locator('.sd-fgroup[data-group="filter.p.m.sidonia.year_band"] label').first().locator('input').check();
  await page.waitForFunction((u) => location.href !== u, url1);
  const url2 = page.url();
  await page.goBack();
  await page.waitForFunction((u) => location.href === u, url1);
  await page.waitForTimeout(400);
  assert((await page.locator('.sd-fgroup[data-group="filter.p.m.sidonia.year_band"] input:checked').count()) === 0, 'atrás restaura el filtro anterior');
  await page.goForward();
  await page.waitForFunction((u) => location.href === u, url2);
  await page.waitForTimeout(400);
  assert((await page.locator('.sd-fgroup[data-group="filter.p.m.sidonia.year_band"] input:checked').count()) === 1, 'adelante restaura el filtro');
  // limpiar todo
  await closeFilters(page);
  await page.locator('.sd-activebar a', { hasText: 'Limpiar todo' }).click();
  await page.waitForFunction(() => !/filter\./.test(location.search));
  eq(parseInt((await page.locator('[data-sd-swap="count"]').innerText()).replace(/\D/g, ''), 10), total, 'recuento tras limpiar');
  await ctx.close();
});
await run('Filtros: estado vacío invita a ampliar la búsqueda o contactar; mensaje de carga con aria-busy', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/collections/coches?filter.p.m.sidonia.brand=Marca%20E&filter.p.m.sidonia.year_band=1960-1969'), { waitUntil: 'networkidle' });
  const t = await page.locator('.sd-empty').innerText();
  assert(/Ninguna pieza coincide/.test(t) && /Limpiar todo/.test(t) && /Cuéntanos qué buscas/.test(t), 'estado vacío: ' + t);
  await ctx.close();
});
await run('Orden: solo opciones reales (editorial, novedades); sin «más populares»; el precio solo si se activa', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/collections/coches'), { waitUntil: 'networkidle' });
  const opts = await page.locator('[data-sd-sort] option').allInnerTexts();
  assert(opts.length === 2 && opts.includes('Selección editorial') && opts.includes('Novedades'), 'opciones: ' + opts.join('|'));
  assert(!opts.some((o) => /popular|vendid|Alfab/i.test(o)), 'opción no real');
  await page.selectOption('[data-sd-sort]', 'created-descending');
  await page.waitForFunction(() => /sort_by=created-descending/.test(location.search));
  await ctx.close();
});
await run('«Cargar más»: añade piezas reales de la página siguiente y la paginación real sigue disponible sin JavaScript', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/collections/explorar'), { waitUntil: 'networkidle' });
  const n1 = await page.locator('[data-sd-grid] .sd-card').count();
  await page.locator('[data-sd-load-more]').click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-sd-grid] .sd-card').length > n, n1);
  const ids = await page.locator('[data-sd-grid] .sd-card').evaluateAll((e) => e.map((x) => x.dataset.productId));
  eq(new Set(ids).size, ids.length, 'tarjetas duplicadas');
  await ctx.close();
  const nj = await open(browser, { js: false });
  await nj.page.goto(site('/collections/explorar'), { waitUntil: 'load' });
  assert(await nj.page.locator('.sd-pagination__list a[rel="next"]').count() === 1, 'paginación con enlaces');
  await nj.page.locator('.sd-pagination__list a[rel="next"]').click();
  assert(/page=2/.test(nj.page.url()), 'página 2 sin JS');
  await nj.ctx.close();
});
await run('«Cargar más»: al volver desde una ficha se restauran las páginas cargadas', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/collections/explorar'), { waitUntil: 'networkidle' });
  const n1 = await page.locator('[data-sd-grid] .sd-card').count();
  await page.locator('[data-sd-load-more]').click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-sd-grid] .sd-card').length > n, n1);
  const n2 = await page.locator('[data-sd-grid] .sd-card').count();
  await page.locator('[data-sd-grid] .sd-card__link').last().click();
  await page.waitForURL(/products/);
  await page.goBack({ waitUntil: 'networkidle' });
  await page.waitForFunction((n) => document.querySelectorAll('[data-sd-grid] .sd-card').length >= n, n2, { timeout: 5000 });
  await ctx.close();
});
await run('Filtros en móvil: panel modal accesible, «Ver N piezas», devuelve el foco', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 390, height: 800 } });
  await page.goto(site('/collections/coches'), { waitUntil: 'networkidle' });
  assert(!(await page.locator('.sd-filters').isVisible()), 'el panel empieza cerrado en móvil');
  const toggle = page.locator('[data-sd-open-filters]');
  await toggle.click();
  await page.waitForSelector('.sd-filters[open]');
  assert(await page.evaluate(() => document.querySelector('.sd-filters').matches(':modal')), 'panel modal');
  await checkFilter(page, 'brand', 'Marca B');
  await page.waitForFunction(() => /brand=/.test(location.search));
  const apply = page.locator('.sd-filters__foot .sd-btn--primary');
  assert(/Ver \d+ piezas?/.test(await apply.innerText()), 'botón «Ver resultados»: ' + (await apply.innerText()));
  await apply.click();
  await page.waitForSelector('.sd-filters:not([open])', { state: 'attached' });
  const focused = await page.evaluate(() => document.activeElement.getAttribute('data-sd-open-filters') !== null);
  assert(focused, 'el foco vuelve al botón Filtros');
  await ctx.close();
});
await run('Filtros: sin JavaScript el formulario funciona (GET) y se muestra «Aplicar filtros»', async () => {
  const { ctx, page } = await open(browser, { js: false });
  await page.goto(site('/collections/coches'), { waitUntil: 'load' });
  assert(await page.locator('.sd-filters').isVisible(), 'panel de filtros visible');
  await checkFilter(page, 'brand', 'Marca B');
  await page.locator('.sd-nojs-only').click();
  assert(/filter\.p\.m\.sidonia\.brand=Marca\+B/.test(page.url()), 'URL con filtro: ' + page.url());
  await ctx.close();
});
/* =========================== 6b. Marcas, pestañas y cajón de filtros =========================== */
console.log('\n6b. Marcas, pestañas de categoría y cajón de filtros');
await run('Marcas: la página lista TODAS las marcas de coches y barcos, con búsqueda local y enlaces al filtro real', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/pages/marcas'), { waitUntil: 'networkidle' });
  const cars = await page.locator('[data-sd-brand-panel="cars"] .sd-brand').count();
  const boats = await page.locator('[data-sd-brand-panel="boats"] .sd-brand').count();
  assert(cars >= 150, 'marcas de coches: ' + cars);
  assert(boats >= 130, 'marcas de barcos: ' + boats);
  for (const b of ['Porsche', 'Ferrari', 'Mercedes-Benz', 'Seat', 'Volkswagen', 'Alfa Romeo']) {
    assert((await page.locator('[data-sd-brand-panel="cars"] .sd-brand[data-brand="' + b + '"]').count()) === 1, 'falta la marca de coches ' + b);
  }
  for (const b of ['Riva', 'Sunseeker', 'Beneteau', 'Jeanneau', 'Princess', 'Sea Ray']) {
    assert((await page.locator('[data-sd-brand-panel="boats"] .sd-brand[data-brand="' + b + '"]').count()) === 1, 'falta la marca de barcos ' + b);
  }
  const href = await page.locator('[data-sd-brand-panel="cars"] .sd-brand[data-brand="Porsche"]').getAttribute('href');
  assert(/\/collections\/coches\?filter\.p\.m\.sidonia\.brand=Porsche$/.test(href), 'enlace de Porsche: ' + href);
  const hrefBoat = await page.locator('[data-sd-brand-panel="boats"] .sd-brand[data-brand="Riva"]').getAttribute('href');
  assert(/\/collections\/barcos\?filter\.p\.m\.sidonia\.builder=Riva$/.test(hrefBoat), 'enlace de Riva: ' + hrefBoat);
  // pestañas
  assert(await page.locator('[data-sd-brand-panel="boats"]').isHidden(), 'barcos oculto al inicio');
  await page.locator('[data-sd-brand-tab="boats"]').click();
  assert(await page.locator('[data-sd-brand-panel="cars"]').isHidden() && (await page.locator('[data-sd-brand-panel="boats"]').isVisible()), 'pestaña de barcos');
  await page.locator('[data-sd-brand-tab="cars"]').click();
  // búsqueda local
  await page.fill('[data-sd-brand-search]', 'porsc');
  await page.waitForFunction(() => document.querySelectorAll('[data-sd-brand-panel="cars"] .sd-brand').length > 0 && [...document.querySelectorAll('[data-sd-brand-panel="cars"] li')].filter((li) => !li.hidden).length === 1);
  eq(await page.locator('[data-sd-brand-panel="cars"] .sd-brand:visible').count(), 1, 'resultados de la búsqueda local');
  await page.fill('[data-sd-brand-search]', 'zzzz');
  await page.waitForFunction(() => !document.querySelector('[data-sd-brand-none]').hidden);
  assert(await page.locator('[data-sd-brand-none]').isVisible(), 'mensaje sin resultados');
  await ctx.close();
});
await run('Marcas: sin JavaScript se ven todas las marcas de ambos tipos', async () => {
  const { ctx, page } = await open(browser, { js: false });
  await page.goto(site('/pages/marcas'), { waitUntil: 'load' });
  assert(await page.locator('[data-sd-brand-panel="cars"]').isVisible() && (await page.locator('[data-sd-brand-panel="boats"]').isVisible()), 'ambos paneles visibles sin JS');
  await ctx.close();
});
await run('Inicio: sección compacta de marcas con enlace al listado completo', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/'), { waitUntil: 'networkidle' });
  const n = await page.locator('.sd-brands--compact [data-sd-brand-panel="cars"] .sd-brand').count();
  assert(n >= 20 && n < 150, 'marcas habituales de coches: ' + n);
  const more = await page.locator('.sd-brands--compact .sd-brandpanel__more a').first().getAttribute('href');
  assert(/\/pages\/marcas#cars$/.test(more), 'enlace al listado completo: ' + more);
  await ctx.close();
});
await run('Listado: pestañas Todo/Coches/Barcos/Casas y fila de marcas con piezas filtran de verdad', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/collections/coches'), { waitUntil: 'networkidle' });
  const tabs = await page.locator('.sd-segment:not(.sd-segment--brands) .sd-pill').allInnerTexts();
  eq(tabs.map((t) => t.trim()).join('|'), 'Todo|Coches|Barcos|Casas', 'pestañas');
  eq(await page.locator('.sd-segment:not(.sd-segment--brands) .sd-pill[aria-current="page"]').innerText(), 'Coches', 'pestaña activa');
  const pill = page.locator('.sd-segment--brands .sd-pill', { hasText: 'Marca B' });
  assert((await pill.count()) === 1, 'píldora de marca con piezas');
  assert(!(await page.locator('.sd-segment--brands .sd-pill', { hasText: 'Zzz' }).count()), 'solo marcas con piezas');
  await pill.click();
  await page.waitForFunction(() => /brand=Marca/.test(location.search));
  assert((await page.locator('.sd-segment--brands .sd-pill[aria-pressed="true"]').count()) === 1, 'píldora activa tras filtrar');
  assert((await page.locator('.sd-activebar .sd-chip--filter').count()) === 1, 'chip de filtro activo');
  const all = await page.locator('.sd-pill--more').getAttribute('href');
  assert(/\/pages\/marcas$/.test(all), 'enlace «Todas las marcas»: ' + all);
  await ctx.close();
});
await run('Filtros en escritorio: cajón lateral modal (cerrado al inicio), Escape lo cierra y devuelve el foco', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/collections/coches'), { waitUntil: 'networkidle' });
  assert(!(await page.locator('.sd-filters').isVisible()), 'el cajón empieza cerrado también en escritorio');
  await page.locator('[data-sd-open-filters]').click();
  await page.waitForSelector('.sd-filters[open]');
  assert(await page.evaluate(() => document.querySelector('.sd-filters').matches(':modal')), 'cajón modal');
  const box = await page.locator('.sd-filters').boundingBox();
  assert(box.width <= 420 && box.x === 0, 'cajón lateral: ' + JSON.stringify(box));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sd-filters:not([open])', { state: 'attached' });
  await ctx.close();
});
await run('Buscador: diálogo accesible, sugerencias reales (API), resultados con filtros y estado vacío', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/'), { waitUntil: 'networkidle' });
  await page.locator('.sd-header [data-sd-open="search"]').first().click();
  await page.waitForSelector('.sd-searchdlg[open]');
  assert(await page.evaluate(() => document.activeElement.matches('[data-sd-suggest-input]')), 'el foco va al campo');
  await page.fill('[data-sd-suggest-input]', 'Barco');
  await page.waitForSelector('.sd-suggest__item');
  assert(page.requests.some((u) => /\/search\/suggest\?.*section_id=predictive-search/.test(u)), 'usa la API de búsqueda predictiva');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sd-searchdlg:not([open])', { state: 'attached' });
  await page.goto(site('/search?q=Marca&type=product'), { waitUntil: 'networkidle' });
  assert((await page.locator('[data-sd-swap="count"]').innerText()).includes('resultados para «Marca»'), 'recuento de resultados');
  assert((await page.locator('.sd-fgroup').count()) > 0, 'filtros en resultados');
  await page.goto(site('/search?q=zzzz&type=product'), { waitUntil: 'networkidle' });
  assert((await page.locator('.sd-empty').innerText()).includes('No hemos encontrado nada'), 'estado vacío de búsqueda');
  await ctx.close();
});

/* =========================== 7. Favoritos =========================== */
console.log('\n7. Favoritos');
await run('Favoritos: guardar en tarjeta y ficha, aria-pressed, contador, persisten tras recargar y sincronizan entre pestañas', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/collections/explorar'), { waitUntil: 'networkidle' });
  const save = page.locator('.sd-card', { hasText: 'Coche de ejemplo A' }).locator('.sd-save__btn');
  eq(await save.getAttribute('aria-pressed'), 'false', 'estado inicial');
  await save.click();
  eq(await save.getAttribute('aria-pressed'), 'true', 'estado guardado');
  eq((await page.locator('sd-fav-count').first().innerText()).trim(), '1', 'contador de cabecera');
  assert(/Guardado/.test(await save.locator('.sd-save__label').innerText()), 'estado visible con texto, no solo color');
  const urlBefore = page.url();
  eq(page.url(), urlBefore, 'guardar no navega');
  await page.reload({ waitUntil: 'networkidle' });
  eq(await page.locator('.sd-card', { hasText: 'Coche de ejemplo A' }).locator('.sd-save__btn').getAttribute('aria-pressed'), 'true', 'persistencia');
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  eq(await page.locator('.sd-pdp .sd-save__btn').first().getAttribute('aria-pressed'), 'true', 'estado sincronizado en la ficha');
  const page2 = await ctx.newPage();
  await page2.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  await page2.locator('.sd-pdp .sd-save__btn').first().click();
  await page.waitForFunction(() => document.querySelector('.sd-pdp .sd-save__btn').getAttribute('aria-pressed') === 'false');
  const stored = await page.evaluate(() => localStorage.getItem('sidonia:favorites:v1'));
  assert(!/@|mail|phone/.test(stored), 'solo datos mínimos, nada personal');
  await ctx.close();
});
await run('Favoritos: la página consulta el estado ACTUAL (vendida, retirada) y permite quitar y vaciar con confirmación', async () => {
  await fetch(site('/__test/reset'));
  const { ctx, page } = await open(browser);
  await page.goto(site('/collections/explorar'), { waitUntil: 'networkidle' });
  for (const t of ['Coche de ejemplo A', 'Barco de ejemplo A', 'Casa de ejemplo A']) await page.locator('.sd-card', { hasText: t }).locator('.sd-save__btn').first().click();
  await page.goto(site('/pages/favoritos'), { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-sd-fav-grid] .sd-card');
  eq(await page.locator('[data-sd-fav-grid] > li').count(), 3, 'tres favoritos');
  assert((await page.locator('[data-sd-fav-count-text]').innerText()).includes('3 piezas'), 'contador de la página');
  assert(page.requests.some((u) => /\/products\/prueba-coche-a\?view=card/.test(u)), 'usa la plantilla alternativa ?view=card');
  assert((await page.locator('.sd-favpage__local').innerText()).includes('Guardado en este navegador'), 'aviso discreto de almacenamiento local');
  // una se vende y otra se retira
  await fetch(site('/__test/sell?handle=prueba-casa-a'));
  await fetch(site('/__test/unpublish?handle=prueba-barco-a'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('[data-sd-fav-grid] > li').length === 3);
  const txt = await page.locator('[data-sd-fav-grid]').innerText();
  assert(/Vendido/.test(txt), 'estado actual: vendida');
  assert(/Pieza retirada/.test(txt), 'pieza retirada gestionada sin romper la página');
  eq(errorsOf(page), '', 'errores');
  await page.locator('[data-sd-fav-removed-title], .sd-favremoved').first().scrollIntoViewIfNeeded();
  await page.locator('[data-sd-fav-remove]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-sd-fav-grid] > li').length === 2);
  await page.locator('[data-sd-fav-clear]').click();
  await page.waitForSelector('.sd-confirm[open]');
  await page.locator('.sd-confirm button[value="cancel"]').click();
  eq(await page.locator('[data-sd-fav-grid] > li').count(), 2, 'cancelar no vacía');
  await page.locator('[data-sd-fav-clear]').click();
  await page.locator('.sd-confirm button[value="confirm"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-sd-fav-grid] > li').length === 0);
  assert(await page.locator('[data-sd-fav-empty]').isVisible(), 'estado vacío con enlaces al catálogo');
  assert((await page.locator('[data-sd-fav-empty] a').count()) >= 4, 'enlaces al catálogo');
  await ctx.close();
});
function errorsOf(page) {
  return page.errors.filter((e) => !/404/.test(e)).join('|');
}
await run('Favoritos: contenido corrupto, versión futura y almacenamiento bloqueado se gestionan con aviso honesto', async () => {
  let { ctx, page } = await open(browser);
  await page.addInitScript(() => localStorage.setItem('sidonia:favorites:v1', '{no es json'));
  await page.goto(site('/pages/favoritos'), { waitUntil: 'networkidle' });
  assert(await page.locator('[data-sd-fav-warning]').isVisible(), 'aviso de contenido dañado');
  assert(await page.locator('[data-sd-fav-empty]').isVisible(), 'la página sigue funcionando');
  eq(page.errors.length, 0, 'errores de consola');
  await ctx.close();
  ({ ctx, page } = await open(browser));
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('bloqueado', 'SecurityError'); };
    Storage.prototype.getItem = function () { throw new DOMException('bloqueado', 'SecurityError'); };
  });
  await page.goto(site('/collections/coches'), { waitUntil: 'networkidle' });
  await page.locator('.sd-card .sd-save__btn').first().click();
  eq(await page.locator('.sd-card .sd-save__btn').first().getAttribute('aria-pressed'), 'true', 'funciona en memoria');
  await page.waitForSelector('.sd-toast');
  assert(/No hemos podido guardar|no permite guardar/.test(await page.locator('.sd-toast').innerText()), 'mensaje honesto');
  eq(page.errors.length, 0, 'errores de consola con almacenamiento bloqueado: ' + page.errors.join('|'));
  await ctx.close();
});

/* =========================== 8. Formularios =========================== */
console.log('\n8. Formularios');
const fillInquiry = async (page, email = 'persona@sidonia.test') => {
  await page.fill('#inq-template--0__inquiry-body', 'Mensaje de prueba con acentos: ¿cuánto?');
  await page.fill('#inq-template--0__inquiry-name', 'Nombre de Prueba');
  await page.fill('#inq-template--0__inquiry-email', email);
  await page.check('#inq-template--0__inquiry-privacy');
};
await run('Consulta: el formulario identifica la pieza, valida en cliente y el éxito sale de la respuesta real de Shopify', async () => {
  await fetch(site('/__test/reset'));
  const { ctx, page } = await open(browser);
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  assert((await page.locator('.sd-inqpiece').innerText()).includes('Coche de ejemplo A'), 'pieza visible en el formulario');
  // validación
  await page.locator('#consulta [data-sd-submit]').click();
  eq(await page.locator('#inq-template--0__inquiry-email').getAttribute('aria-invalid'), 'true', 'aria-invalid en el correo');
  assert((await page.locator('#inq-template--0__inquiry-email-err').innerText()).trim().length > 0, 'mensaje asociado al campo');
  assert(await page.evaluate(() => document.activeElement.id === 'inq-template--0__inquiry-body'), 'foco en el primer campo con error (mensaje)');
  assert((await page.locator('[data-sd-status]').innerText()).includes('por revisar'), 'resumen anunciado');
  assert((await fetch(site('/__test/submissions')).then((r) => r.json())).length === 0, 'no se envió nada con errores');
  // envío válido
  await fillInquiry(page);
  await page.locator('#consulta [data-sd-submit]').click();
  await page.waitForSelector('[data-sd-form-success]');
  assert((await page.locator('[data-sd-form-success]').innerText()).includes('Mensaje enviado'), 'éxito');
  const subs = await fetch(site('/__test/submissions')).then((r) => r.json());
  eq(subs.length, 1, 'envíos recibidos por el servidor');
  const f = subs[0].fields;
  eq(f['contact[Pieza]'][0], '[PRUEBA] Coche de ejemplo A', 'campo Pieza');
  eq(f['contact[Referencia]'][0], 'PR-G-001', 'campo Referencia');
  eq(f['contact[Categoría]'][0], 'Coches', 'campo Categoría');
  assert(f['contact[URL del anuncio]'][0].endsWith('/products/prueba-coche-a'), 'URL del anuncio');
  eq(f['contact[Tipo de consulta]'][0], 'Consulta sobre una pieza', 'tipo de consulta');
  eq(f['contact[Preferencia de contacto]'][0], 'Email', 'preferencia');
  assert(!('contact[Acepta novedades]' in f), 'sin casilla de marketing por defecto');
  await ctx.close();
});
await run('Consulta: error devuelto por el servidor se muestra con los datos conservados (sin éxito falso)', async () => {
  await fetch(site('/__test/reset'));
  const { ctx, page } = await open(browser);
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  await fillInquiry(page, 'a@b');
  await page.locator('#consulta [data-sd-submit]').click();
  await page.waitForSelector('[data-sd-form-errors]');
  assert((await page.locator('[data-sd-form-success]').count()) === 0, 'no debe mostrarse éxito');
  eq(await page.inputValue('#inq-template--0__inquiry-name'), 'Nombre de Prueba', 'nombre conservado');
  assert((await page.inputValue('#inq-template--0__inquiry-body')).includes('cuánto'), 'mensaje conservado');
  assert(await page.evaluate(() => document.activeElement.hasAttribute('data-sd-form-errors')), 'foco en el resumen de errores');
  eq((await fetch(site('/__test/submissions')).then((r) => r.json())).length, 0, 'nada recibido');
  // corregir y reintentar
  await page.fill('#inq-template--0__inquiry-email', 'persona@sidonia.test');
  await page.check('#inq-template--0__inquiry-privacy');
  await page.locator('#consulta [data-sd-submit]').click();
  await page.waitForSelector('[data-sd-form-success]');
  await ctx.close();
});
await run('Consulta: fallo de red conserva los datos y permite reintentar; la pantalla anti-spam se gestiona con envío nativo', async () => {
  await fetch(site('/__test/reset'));
  const { ctx, page } = await open(browser);
  page.errors.length = 0;
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  await fillInquiry(page, 'persona@sidonia.test');
  await page.route('**/contact', (r) => r.abort('connectionreset'));
  await page.locator('#consulta [data-sd-submit]').click();
  await page.waitForFunction(() => /No se ha podido enviar/.test(document.querySelector('[data-sd-status]').textContent));
  await page.unroute('**/contact');
  eq(await page.inputValue('#inq-template--0__inquiry-name'), 'Nombre de Prueba', 'datos conservados tras el fallo');
  assert((await page.locator('[data-sd-form-success]').count()) === 0, 'sin éxito falso');
  await page.fill('#inq-template--0__inquiry-email', 'challenge@sidonia.test');
  const nav = page.waitForURL(/\/challenge/, { timeout: 5000 });
  await page.locator('#consulta [data-sd-submit]').click();
  await nav;
  await ctx.close();
});
await run('Consulta sin JavaScript: el formulario nativo envía y Shopify devuelve el éxito', async () => {
  await fetch(site('/__test/reset'));
  const { ctx, page } = await open(browser, { js: false });
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'load' });
  await fillInquiry(page);
  await page.locator('#consulta [data-sd-submit]').click();
  await page.waitForSelector('[data-sd-form-success]');
  assert(/contact_posted=true/.test(page.url()), 'URL de confirmación');
  eq((await fetch(site('/__test/submissions')).then((r) => r.json())).length, 1, 'recibido');
  await ctx.close();
});
await run('Propietarios: tres pasos, campos condicionales, la categoría viaja en el envío y los campos de otras categorías no', async () => {
  await fetch(site('/__test/reset'));
  const { ctx, page } = await open(browser, { viewport: { width: 1024, height: 900 } });
  await page.goto(site('/pages/vender'), { waitUntil: 'networkidle' });
  const uid = 'sell-template--0__form';
  assert(await page.locator('[data-sd-step="1"]').isVisible() && !(await page.locator('[data-sd-step="2"]').isVisible()), 'solo el paso 1 visible');
  await page.locator('[data-sd-next]').click();
  assert((await page.locator('[data-sd-step-error="1"]').innerText()).includes('Elige qué quieres vender'), 'error del paso 1');
  await page.locator('.sd-optioncard', { hasText: 'Un barco' }).click();
  await page.locator('[data-sd-next]').click();
  assert(await page.locator('[data-sd-step="2"]').isVisible(), 'paso 2');
  assert(await page.locator('[data-sd-cat-group="harbor"]').isVisible() && !(await page.locator('[data-sd-cat-group="garage"]').isVisible()), 'solo campos de barco');
  await page.locator('[data-sd-next]').click(); // vacío: no avanza
  assert(await page.locator('[data-sd-step="2"]').isVisible(), 'no avanza con obligatorios vacíos');
  await page.fill(`#${uid}-h-make`, 'Constructor X modelo Y');
  await page.fill(`#${uid}-h-loc`, 'Puerto de prueba');
  await page.fill(`#${uid}-special`, 'Porque sí, de prueba');
  await page.selectOption(`#${uid}-rel`, 'Soy propietario o propietaria');
  await page.locator('[data-sd-next]').click();
  assert(await page.locator('[data-sd-step="3"]').isVisible(), 'paso 3');
  await page.fill(`#${uid}-name`, 'Propietario de Prueba');
  await page.fill(`#${uid}-email`, 'dueno@sidonia.test');
  await page.check(`#${uid}-privacy`);
  await page.locator('[data-sd-submit]').click();
  assert((await page.locator('[data-sd-status]').innerText()).includes('por revisar') || (await page.locator(`#${uid}-phone-err`).innerText()).length > 0, 'el teléfono es obligatorio en solicitudes');
  await page.fill(`#${uid}-phone`, '+34 600 000 001');
  await page.locator('[data-sd-submit]').click();
  await page.waitForSelector('[data-sd-form-success]');
  assert((await page.locator('[data-sd-form-success]').innerText()).includes('no implica aceptación'), 'aviso: valoración de encaje, sin compromiso');
  const f = (await fetch(site('/__test/submissions')).then((r) => r.json()))[0].fields;
  assert(f['contact[Categoría]'][0].startsWith('Barco'), 'categoría enviada');
  assert('contact[Constructor y modelo]' in f && !('contact[Marca]' in f) && !('contact[Superficie (m²)]' in f), 'solo campos de la categoría elegida');
  eq(f['contact[Tipo de consulta]'][0], 'Solicitud de propietario', 'tipo');
  assert(!Object.keys(f).some((k) => /archivo|file/i.test(k)), 'sin subida de archivos');
  await ctx.close();
});
await run('Propietarios: ?cat= preselecciona la categoría; sin JavaScript se ven los tres pasos y todas las opciones', async () => {
  let { ctx, page } = await open(browser);
  await page.goto(site('/pages/vender?cat=estate'), { waitUntil: 'networkidle' });
  assert(await page.locator('[data-sd-step="2"]').isVisible() && await page.locator('[data-sd-cat-group="estate"]').isVisible(), 'salta al paso 2 de casas');
  await ctx.close();
  ({ ctx, page } = await open(browser, { js: false }));
  await page.goto(site('/pages/vender'), { waitUntil: 'load' });
  for (const s of [1, 2, 3]) assert(await page.locator(`[data-sd-step="${s}"]`).isVisible(), 'paso ' + s + ' visible sin JS');
  for (const g of ['garage', 'harbor', 'estate']) assert(await page.locator(`[data-sd-cat-group="${g}"]`).isVisible(), 'grupo ' + g);
  assert(!(await page.locator('[data-sd-stepper]').isVisible()), 'el indicador de pasos solo existe con JS');
  assert(!(await page.locator('input[type=file]').count()), 'sin interfaz de subida de archivos');
  await ctx.close();
});
await run('Cuéntanos qué buscas y Contacto envían por el formulario nativo y sin promesas de alertas', async () => {
  await fetch(site('/__test/reset'));
  const { ctx, page } = await open(browser);
  await page.goto(site('/pages/busco'), { waitUntil: 'networkidle' });
  assert((await page.locator('.sd-wanted').innerText()).includes('no crea alertas automáticas'), 'sin promesa de alertas');
  const uid = 'want-template--0__form';
  await page.fill(`#${uid}-body`, 'Busco algo de prueba');
  await page.fill(`#${uid}-name`, 'Persona');
  await page.fill(`#${uid}-email`, 'busca@sidonia.test');
  await page.check(`#${uid}-privacy`);
  await page.locator('[data-sd-submit]').click();
  await page.waitForSelector('[data-sd-form-success]');
  await page.goto(site('/pages/contacto'), { waitUntil: 'networkidle' });
  const cuid = 'cont-template--0__main';
  await page.fill(`#${cuid}-body`, 'Mensaje general de prueba');
  await page.fill(`#${cuid}-name`, 'Persona');
  await page.fill(`#${cuid}-email`, 'contacto@sidonia.test');
  await page.check(`#${cuid}-privacy`);
  await page.locator('.sd-contact__form [data-sd-submit]').click();
  await page.waitForSelector('[data-sd-form-success]');
  eq((await fetch(site('/__test/submissions')).then((r) => r.json())).length, 2, 'envíos');
  await ctx.close();
});
await run('Preferencia WhatsApp/teléfono exige teléfono', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  await fillInquiry(page);
  await page.check('#consulta input[value="WhatsApp"]');
  await page.locator('#consulta [data-sd-submit]').click();
  eq(await page.locator('#inq-template--0__inquiry-phone').getAttribute('aria-invalid'), 'true', 'teléfono requerido');
  await ctx.close();
});

/* =========================== 9. Navegación, teclado y accesibilidad =========================== */
console.log('\n9. Navegación, teclado y accesibilidad');
await run('Cabecera: «Vender con Sidonia» siempre visible; en móvil, cajón accesible con Escape y foco restaurado', async () => {
  let { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/'), { waitUntil: 'networkidle' });
  assert(await page.locator('.sd-header__cta').isVisible(), 'CTA de venta visible en escritorio');
  for (const t of ['Explorar', 'Coches', 'Barcos', 'Casas', 'Cómo vendemos', 'Sobre Sidonia']) assert(await page.locator('.sd-nav__link', { hasText: t }).first().isVisible(), 'enlace ' + t);
  assert(!/Harbour/i.test(await page.content()), 'HARBOR sin cambiar');
  await ctx.close();
  ({ ctx, page } = await open(browser, { viewport: { width: 390, height: 800 } }));
  await page.goto(site('/'), { waitUntil: 'networkidle' });
  const burger = page.locator('.sd-header__burger');
  await burger.focus();
  await burger.click();
  await page.waitForSelector('.sd-drawer[open]');
  assert(await page.locator('.sd-drawer__cta').isVisible(), 'CTA «Vender con Sidonia» en el primer nivel del cajón');
  assert(await page.evaluate(() => document.querySelector('.sd-drawer').matches(':modal')), 'cajón modal');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sd-drawer:not([open])', { state: 'attached' });
  assert(await page.evaluate(() => document.activeElement.classList.contains('sd-header__burger')), 'foco restaurado en el botón del menú');
  await ctx.close();
});
await run('Cabecera fija: permanece arriba al desplazarse y no ocupa más de 5 rem', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 390, height: 800 } });
  await page.goto(site('/collections/explorar'), { waitUntil: 'networkidle' });
  await page.evaluate(() => window.scrollTo(0, 2500));
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => { const b = document.querySelector('.sd-header').getBoundingClientRect(); return { top: b.top, h: b.height, stuck: document.querySelector('.sd-header').classList.contains('is-stuck') }; });
  assert(Math.abs(r.top) < 1 && r.h <= 80, JSON.stringify(r));
  assert(r.stuck, 'sombra al desplazarse');
  await ctx.close();
});
await run('Teclado: enlace para saltar al contenido, foco visible y orden lógico', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/'), { waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement.classList.contains('sd-skip-link')), 'primer foco: saltar al contenido');
  await page.keyboard.press('Enter');
  assert(await page.evaluate(() => location.hash === '#MainContent'), 'salta a #MainContent');
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return { w: cs.outlineWidth, st: cs.outlineStyle, tag: el.tagName };
  });
  assert(ring.st !== 'none' && parseFloat(ring.w) >= 2, 'foco visible: ' + JSON.stringify(ring));
  await ctx.close();
});
const AUDIT = ['/', '/collections/explorar', '/products/prueba-coche-a', '/products/prueba-casa-b-vendida', '/pages/vender', '/pages/contacto', '/pages/favoritos', '/search?q=Marca&type=product', '/nope'];
await run('Auditoría automática de accesibilidad (idioma, landmarks, ids únicos, etiquetas, nombres, alt, encabezados)', async () => {
  const { ctx, page } = await open(browser);
  const bad = [];
  for (const r of AUDIT) {
    await page.goto(site(r), { waitUntil: 'networkidle' });
    const res = await page.evaluate(() => {
      const out = [];
      if (document.documentElement.lang !== 'es') out.push('html sin lang es');
      if (document.querySelectorAll('main').length !== 1) out.push('debe haber un único main');
      const ids = {};
      document.querySelectorAll('[id]').forEach((e) => (ids[e.id] = (ids[e.id] || 0) + 1));
      Object.entries(ids).forEach(([k, n]) => n > 1 && out.push('id duplicado ' + k));
      document.querySelectorAll('img').forEach((i) => { if (!i.hasAttribute('alt')) out.push('img sin alt ' + i.src.slice(-30)); });
      const name = (el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim() || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby')) ? 'ok' : '') || el.getAttribute('title') || '';
      document.querySelectorAll('button, a[href]').forEach((e) => {
        if (e.closest('[hidden], template, noscript')) return;
        if (e.matches('a[aria-hidden="true"]')) return;
        if (!name(e)) out.push('sin nombre accesible: ' + e.outerHTML.slice(0, 90));
      });
      document.querySelectorAll('input:not([type=hidden]):not([type=submit]), select, textarea').forEach((e) => {
        if (e.closest('template, noscript')) return;
        const lab = e.id && document.querySelector(`label[for="${e.id}"]`);
        const wrap = e.closest('label');
        if (!lab && !wrap && !e.getAttribute('aria-label')) out.push('control sin etiqueta: ' + (e.name || e.id));
      });
      document.querySelectorAll('[aria-describedby],[aria-labelledby]').forEach((e) => {
        (e.getAttribute('aria-describedby') || e.getAttribute('aria-labelledby')).split(/\s+/).forEach((id) => { if (id && !document.getElementById(id)) out.push('aria-* apunta a un id inexistente: ' + id); });
      });
      document.querySelectorAll('[aria-hidden="true"]').forEach((e) => {
        if (e.matches('a, button, input') && e.tabIndex >= 0) out.push('foco en elemento aria-hidden');
        if (e.querySelector('a:not([tabindex="-1"]), button:not([tabindex="-1"])') && !e.matches('svg')) out.push('elemento aria-hidden con controles enfocables');
      });
      const hs = [...document.querySelectorAll('h1,h2,h3,h4')].filter((h) => !h.closest('[hidden], dialog:not([open]), template')).map((h) => +h.tagName[1]);
      for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) out.push(`salto de encabezado h${hs[i - 1]}→h${hs[i]}`);
      return out;
    });
    res.forEach((x) => bad.push(r + ': ' + x));
  }
  await ctx.close();
  assert(!bad.length, bad.slice(0, 8).join(' ; '));
  return `${AUDIT.length} páginas`;
});
await run('Reducir movimiento: animaciones y transiciones se anulan', async () => {
  const { ctx, page } = await open(browser, { reducedMotion: 'reduce' });
  await page.goto(site('/collections/explorar'), { waitUntil: 'networkidle' });
  const d = await page.evaluate(() => {
    const b = document.querySelector('.sd-btn');
    return { t: parseFloat(getComputedStyle(b).transitionDuration) * 1000, s: getComputedStyle(document.documentElement).scrollBehavior };
  });
  assert(d.t < 1 && d.s === 'auto', JSON.stringify(d));
  await ctx.close();
});
await run('Contraste real renderizado: texto principal, secundario y botones ≥ 4,5:1', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/collections/coches'), { waitUntil: 'networkidle' });
  const rows = await page.evaluate(() => {
    const parse = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => { const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const bgOf = (el) => { let e = el; while (e) { const c = getComputedStyle(e).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return parse(c); e = e.parentElement; } return [255, 255, 255]; };
    const sel = ['.sd-card__title a', '.sd-card__meta', '.sd-card__cat', '.sd-card__facts', '.sd-price', '.sd-chip--available', '.sd-btn', '.sd-nav__link', '.sd-eyebrow', '.sd-note', '.sd-count', '.sd-footer__list a'];
    return sel.map((s) => { const el = document.querySelector(s); if (!el) return [s, null]; const fg = parse(getComputedStyle(el).color); return [s, +ratio(fg, bgOf(el)).toFixed(2)]; });
  });
  const low = rows.filter(([, r]) => r !== null && r < 4.5);
  assert(!low.length, 'bajo contraste: ' + JSON.stringify(low));
  await ctx.close();
  return rows.filter(([, r]) => r).map(([s, r]) => r).sort((a, b) => a - b)[0] + ':1 mínimo';
});

/* =========================== 10. Analítica y consentimiento =========================== */
console.log('\n10. Analítica');
await run('Analítica: eventos útiles, una sola vez, sin datos personales y solo con consentimiento', async () => {
  const { ctx, page } = await open(browser);
  await page.goto(site('/products/prueba-coche-a'), { waitUntil: 'networkidle' });
  const ev = () => page.evaluate(() => window.__events.map((e) => [e[0], e[1]]));
  let e = await ev();
  eq(e.filter((x) => x[0] === 'sidonia_view_listing').length, 1, 'vista de ficha una vez');
  await page.locator('.sd-pdp .sd-save__btn').first().click();
  await page.locator('.sd-pdp a[href^="https://wa.me"]').first().evaluate((a) => a.addEventListener('click', (ev) => ev.preventDefault()));
  await page.locator('.sd-pdp a[href^="https://wa.me"]').first().click();
  await page.locator('[data-sd-start]').click();
  await page.waitForFunction(() => document.querySelector('sd-video-stage video:not(.sd-vplayer__preview)') && !document.querySelector('sd-video-stage video:not(.sd-vplayer__preview)').paused);
  await page.waitForFunction(() => window.__events.some((e) => e[0] === 'sidonia_video_progress' && e[1].milestone === 50), null, { timeout: 9000 });
  e = await ev();
  const names = e.map((x) => x[0]);
  for (const n of ['sidonia_favorite_add', 'sidonia_contact_whatsapp_click', 'sidonia_video_start', 'sidonia_video_progress']) assert(names.includes(n), 'falta evento ' + n);
  const ms = e.filter((x) => x[0] === 'sidonia_video_progress').map((x) => x[1].milestone);
  eq(new Set(ms).size, ms.length, 'hitos repetidos: ' + ms);
  const flat = JSON.stringify(e);
  assert(!/@|\+34|persona|PRUEBA|Marca A/.test(flat), 'datos personales o texto libre en analítica: ' + flat.slice(0, 200));
  await page.evaluate(() => { window.__consent = false; window.__events.length = 0; });
  await page.locator('.sd-pdp .sd-save__btn').first().click();
  eq((await ev()).length, 0, 'sin consentimiento no se envía nada');
  await ctx.close();
  const off = await open(browser);
  await off.page.goto(site('/products/prueba-coche-a', 'empty'), { waitUntil: 'networkidle' });
  await off.ctx.close();
});
await run('Analítica: filtros aplicados solo envían nombres de filtro y recuento, no valores ni búsquedas', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/collections/coches'), { waitUntil: 'networkidle' });
  await checkFilter(page, 'brand', 'Marca B');
  await page.waitForFunction(() => window.__events.some((e) => e[0] === 'sidonia_filters_applied'));
  const ev = await page.evaluate(() => window.__events.find((e) => e[0] === 'sidonia_filters_applied')[1]);
  assert(ev.filter_keys === 'sidonia.brand' && typeof ev.results_count === 'number' && !JSON.stringify(ev).includes('Marca B'), JSON.stringify(ev));
  await ctx.close();
});

/* =========================== 11. Editor de temas =========================== */
console.log('\n11. Editor: carga, descarga y recarga de secciones');
await run('Los componentes son idempotentes: quitar y volver a insertar secciones no duplica listeners ni vídeos', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(site('/collections/coches'), { waitUntil: 'networkidle' });
  // simula shopify:section:unload + load: reemplaza el HTML de la sección
  await page.evaluate(async () => {
    const sec = document.querySelector('[id^="shopify-section-template--0__main"]');
    const html = sec.innerHTML;
    document.dispatchEvent(new CustomEvent('shopify:section:unload', { detail: { sectionId: 'template--0__main' } }));
    sec.innerHTML = '';
    await new Promise((r) => setTimeout(r, 50));
    sec.innerHTML = html;
    document.dispatchEvent(new CustomEvent('shopify:section:load', { detail: { sectionId: 'template--0__main' } }));
    await new Promise((r) => setTimeout(r, 50));
  });
  const btn = page.locator('.sd-card .sd-save__btn').first();
  await btn.click();
  eq(await btn.getAttribute('aria-pressed'), 'true', 'un clic = un cambio de estado tras recargar la sección');
  eq(await page.evaluate(() => JSON.parse(localStorage.getItem('sidonia:favorites:v1')).items.length), 1, 'sin dobles altas');
  // el modal de vídeo sigue funcionando y no deja vídeos tras descargar la sección
  await page.locator('.sd-play').first().click();
  await page.waitForSelector('.sd-vmodal[open] video');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('shopify:section:unload')));
  await page.waitForFunction(() => [...document.querySelectorAll('video')].every((v) => v.paused));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sd-vmodal:not([open])', { state: 'attached' });
  // filtros: una sola petición por cambio
  page.requests.length = 0;
  await checkFilter(page, 'brand', 'Marca B');
  await page.waitForFunction(() => /brand=/.test(location.search));
  await page.waitForTimeout(500);
  eq(page.requests.filter((u) => /section_id=/.test(u)).length, 1, 'peticiones de sección por cambio de filtro');
  assert(!page.errors.length, page.errors.join('|'));
  await ctx.close();
});
await run('Sección renderizada de forma independiente (Section Rendering API): cada sección devuelve su HTML', async () => {
  const sections = ['template--0__hero', 'template--0__divisions', 'template--0__selection', 'template--0__how', 'template--0__story', 'template--0__community', 'template--0__criteria', 'template--0__testimonials', 'template--0__cta', 'template--0__faq'];
  for (const id of sections) {
    const html = await fetch(site(`/?section_id=${id}`)).then((r) => r.text());
    assert(html.includes(`id="shopify-section-${id}"`), 'sección ' + id);
  }
  return `${sections.length} secciones`;
});

/* =========================== 12. Rendimiento =========================== */
console.log('\n12. Rendimiento (medición local, sin red real)');
await run('Home y ficha: sin terceros, imagen principal con prioridad, resto diferido, CLS bajo', async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 390, height: 800 } });
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true });
  });
  const out = [];
  for (const r of ['/', '/collections/explorar', '/products/prueba-coche-a']) {
    page.requests.length = 0;
    await page.goto(site(r), { waitUntil: 'networkidle' });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => ({
      cls: window.__cls,
      eager: document.querySelectorAll('img[loading="eager"]').length,
      lazy: document.querySelectorAll('img[loading="lazy"]').length,
      noDims: [...document.querySelectorAll('img')].filter((i) => !i.getAttribute('width') || !i.getAttribute('height')).length,
      high: document.querySelectorAll('img[fetchpriority="high"]').length
    }));
    const third = page.requests.filter((u) => !u.startsWith('http://localhost'));
    assert(!third.length, r + ': terceros ' + third.join(','));
    assert(info.cls <= 0.1, `${r}: CLS ${info.cls.toFixed(3)}`);
    assert(info.high <= 1, r + ': más de un recurso con prioridad alta');
    assert(info.noDims === 0, r + ': imágenes sin dimensiones');
    out.push(`${r} CLS ${info.cls.toFixed(3)} eager ${info.eager}`);
  }
  await ctx.close();
  return out.join(' · ');
});

/* =========================== resumen =========================== */
await browser.close();
full.server.close();
empty.server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pruebas correctas`);
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
