/* SIDONIA · Panel › Herramientas › Páginas de la web: crea en Shopify las páginas de Sidonia que falten (Eventos,
 * Profesionales, Alquiler…) con su plantilla puesta, y a las que ya existen les pone su plantilla. Así los enlaces del
 * tema (snippets/sidonia-*-url.liquid) llevan a /pages/eventos y no a la página por defecto.
 * También mira si el tema publicado tiene esas plantillas: si falta alguna, el tema no está recibiendo los cambios de
 * GitHub (la sincronización) y eso se arregla en Shopify › Tienda online › Temas.
 * Permisos de la app: write_online_store_pages (crear páginas) y read_themes (mirar las plantillas).
 * Además, ponerPoliticas copia los textos legales del tema (privacidad, términos, contacto y aviso legal) en las
 * políticas de Shopify (Ajustes › Políticas), las que salen en el pago: permiso write_legal_policies.
 */

export const PAGINAS = [
  { handle: 'eventos', titulo: 'Eventos', plantilla: 'agenda' },
  { handle: 'profesionales', titulo: 'Profesionales', plantilla: 'profesionales' },
  { handle: 'alquiler', titulo: 'Alquiler', plantilla: 'alquiler' },
  { handle: 'a-la-carta', titulo: 'A la carta', plantilla: 'a-la-carta' },
  { handle: 'publicar', titulo: 'Publicar', plantilla: 'publicar' },
  { handle: 'subastas', titulo: 'Subastas', plantilla: 'subastas' },
  { handle: 'perfil', titulo: 'Mi perfil', plantilla: 'perfil' },
  { handle: 'tienda', titulo: 'Tienda', plantilla: 'tienda' },
  { handle: 'sidonia-rd10', titulo: 'SIDONIA RD10', plantilla: 'rd10' },
  // Los textos legales (sections/sidonia-legal.liquid del tema)
  { handle: 'aviso-legal', titulo: 'Aviso legal', plantilla: 'aviso-legal' },
  { handle: 'politica-de-privacidad', titulo: 'Política de privacidad', plantilla: 'privacidad' },
  { handle: 'terminos-del-servicio', titulo: 'Términos del servicio', plantilla: 'terminos' },
  { handle: 'politica-de-cookies', titulo: 'Política de cookies', plantilla: 'cookies' },
  { handle: 'informacion-de-contacto', titulo: 'Información de contacto', plantilla: 'informacion-contacto' },
  // Interna: la propuesta para Arka (sin enlaces en la web y fuera de los buscadores)
  { handle: 'propuesta-arka', titulo: 'Propuesta para Arka', plantilla: 'propuesta-arka' }
];

const Q_PAGINAS = `{ pages(first: 250) { nodes { id handle title templateSuffix isPublished } } }`;
const M_CREAR = `mutation ($page: PageCreateInput!) { pageCreate(page: $page) { page { id handle } userErrors { field message } } }`;
const M_CAMBIAR = `mutation ($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id handle } userErrors { field message } } }`;
const Q_TEMA = `query ($f: [String!]!) { themes(first: 1, roles: [MAIN]) { nodes { id name files(filenames: $f, first: 50) { nodes { filename } } } } }`;

const sinPermiso = (e) => /permiso|ACCESS_DENIED|access denied|403/i.test(String(e && e.message));

/** Mira qué plantillas tiene el tema publicado. Devuelve { tema, tiene: Set } o { error } */
export async function plantillasDelTema(gql, paginas = PAGINAS) {
  try {
    const d = await gql(Q_TEMA, { f: paginas.map((p) => `templates/page.${p.plantilla}.json`) });
    const t = d?.themes?.nodes?.[0];
    if (!t) return { error: 'No hay tema publicado.' };
    return { tema: t.name, tiene: new Set((t.files?.nodes || []).map((n) => n.filename)) };
  } catch (e) {
    return { error: sinPermiso(e) ? 'sin-permiso' : e.message };
  }
}

/** Crea las que faltan y pone la plantilla a las que ya existen. hacer=false: solo mira. */
export async function ponerPaginas(gql, { hacer = true, paginas = PAGINAS } = {}) {
  let lista;
  try {
    lista = (await gql(Q_PAGINAS))?.pages?.nodes || [];
  } catch (e) {
    if (sinPermiso(e)) throw new Error('La app de Shopify no tiene permiso para las páginas. En dev.shopify.com › Apps › Sidonia Platform › Versiones › Crear versión, añade a los permisos (scopes) write_online_store_pages, read_themes y write_legal_policies (sin quitar los que ya tiene), pulsa Publicar y, en Shopify admin › Configuración › Apps › Sidonia Platform, acepta los permisos nuevos. Luego vuelve a pulsar el botón.');
    throw e;
  }
  const tema = await plantillasDelTema(gql, paginas);
  const informe = [];
  for (const p of paginas) {
    const ya = lista.find((x) => x.handle === p.handle);
    const fila = { ...p, url: `/pages/${p.handle}`, plantillaEnTema: tema.tiene ? tema.tiene.has(`templates/page.${p.plantilla}.json`) : null };
    try {
      if (!ya) {
        if (hacer) {
          const d = await gql(M_CREAR, { page: { title: p.titulo, handle: p.handle, body: '', isPublished: true, templateSuffix: p.plantilla } });
          const err = d?.pageCreate?.userErrors?.[0];
          if (err) throw new Error(err.message);
        }
        fila.estado = hacer ? 'creada' : 'falta';
      } else if ((ya.templateSuffix || '') !== p.plantilla) {
        if (hacer) {
          const d = await gql(M_CAMBIAR, { id: ya.id, page: { templateSuffix: p.plantilla } });
          const err = d?.pageUpdate?.userErrors?.[0];
          if (err) throw new Error(err.message);
        }
        fila.estado = hacer ? 'enlazada' : 'sin-plantilla';
        fila.antes = ya.templateSuffix || '';
      } else {
        fila.estado = 'ok';
      }
      if (ya && !ya.isPublished) fila.oculta = true;
    } catch (e) {
      fila.estado = 'error';
      fila.error = e.message;
    }
    informe.push(fila);
  }
  return { informe, tema };
}

/* ------------------------------------------------------------------ Políticas de Shopify con los textos de Sidonia */
export const POLITICAS = [
  { tipo: 'PRIVACY_POLICY', titulo: 'Política de privacidad', vista: 'privacidad' },
  { tipo: 'TERMS_OF_SERVICE', titulo: 'Términos del servicio', vista: 'terminos' },
  { tipo: 'CONTACT_INFORMATION', titulo: 'Información de contacto', vista: 'informacion-contacto' },
  { tipo: 'LEGAL_NOTICE', titulo: 'Aviso legal', vista: 'aviso-legal' }
];
const M_POLITICA = `mutation ($p: ShopPolicyInput!) { shopPolicyUpdate(shopPolicy: $p) { shopPolicy { id type } userErrors { field message } } }`;
/** El texto de un documento legal tal y como se ve en la web (sin el título ni el menú de abajo) */
export function textoLegal(html) {
  const m = /<div class="lg__in">([\s\S]*?)<nav class="lg__otros"/.exec(String(html || ''));
  if (!m) return '';
  return m[1].replace(/<h1>[\s\S]*?<\/h1>/, '').replace(/<p>\s*<button[^>]*data-lg-cookies[^>]*>[\s\S]*?<\/button>\s*<\/p>/, '').replace(/\n\s+/g, '\n').trim();
}
/** Copia los textos de la web en las políticas de Shopify. Devuelve una fila por política. */
export async function ponerPoliticas(gql, cfg, fetchImpl = fetch) {
  const filas = [];
  for (const p of POLITICAS) {
    const fila = { ...p, url: `/policies/${p.tipo.toLowerCase().replace(/_/g, '-')}` };
    try {
      const r = await fetchImpl(`${cfg.tienda || 'https://sidonia.es'}/pages/vende-con-nosotros?view=${p.vista}`, { headers: { 'User-Agent': 'Sidonia' } });
      const body = textoLegal(await r.text());
      if (body.length < 200) throw new Error('No se ha podido leer el texto de la web (¿el tema tiene la plantilla?).');
      const d = await gql(M_POLITICA, { p: { type: p.tipo, body } });
      const err = d?.shopPolicyUpdate?.userErrors?.[0];
      if (err) throw new Error(err.message);
      fila.estado = 'politica';
    } catch (e) {
      fila.estado = 'error';
      fila.error = sinPermiso(e) ? 'Falta el permiso write_legal_policies en la app de Shopify.' : e.message;
    }
    filas.push(fila);
  }
  return filas;
}
