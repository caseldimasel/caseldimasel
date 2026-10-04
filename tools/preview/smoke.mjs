// Renderiza todas las rutas con el intérprete de pruebas y comunica errores del motor y traducciones ausentes.
import { createStore, createRenderer } from './server.mjs';

const routes = [
  '/', '/collections/explorar', '/collections/garage', '/collections/harbor', '/collections/estate', '/collections/archivo',
  '/collections/garage?filter.p.m.sidonia.brand=Marca%20A', '/collections/explorar?page=2', '/collections/explorar?filter.p.m.sidonia.brand=Zzz',
  '/products/prueba-coche-a', '/products/prueba-coche-b-a-consultar', '/products/prueba-coche-c-minimo', '/products/prueba-barco-a', '/products/prueba-barco-b-reservado',
  '/products/prueba-casa-a', '/products/prueba-casa-b-vendida', '/products/prueba-coche-d-vendido', '/products/prueba-coche-e-youtube', '/products/prueba-coche-f-sin-portada',
  '/products/prueba-coche-a?view=card',
  '/pages/vender', '/pages/como-vendemos', '/pages/sobre-sidonia', '/pages/favoritos', '/pages/contacto', '/pages/busco', '/pages/privacidad',
  '/search', '/search?q=Marca&type=product', '/search?q=nada-que-encontrar', '/search/suggest?q=coche&section_id=predictive-search', '/cart', '/nope'
];

let failures = 0;
for (const profile of ['full', 'empty']) {
  const store = createStore(profile);
  const renderer = createRenderer(store);
  console.log(`\n== perfil ${profile}`);
  for (const r of routes) {
    const u = new URL(r, 'http://x');
    const query = {};
    u.searchParams.forEach((v, k) => (query[k] = query[k] || []).push(v));
    try {
      const out = renderer.renderRequest({ path: u.pathname, query, sectionId: query.section_id?.[0] });
      const miss = out.missing && out.missing.length ? ` TRADUCCIONES AUSENTES: ${out.missing.join(', ')}` : '';
      const bad = /Translation missing|\[object Object\]|undefined|NaN/.test(out.html) ? ' CONTENIDO SOSPECHOSO' : '';
      if (miss || bad) failures++;
      console.log(`${String(out.status).padEnd(4)} ${r.padEnd(70)} ${(out.html.length / 1024).toFixed(1)} KB${miss}${bad}`);
    } catch (e) {
      failures++;
      console.log(`ERR  ${r}\n     ${String(e.message).split('\n')[0]}`);
    }
  }
}
process.exit(failures ? 1 : 0);
