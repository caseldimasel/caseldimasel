#!/usr/bin/env node
// Puesta en marcha automática de una tienda Shopify para el tema SIDONIA, mediante la Admin GraphQL API.
//
// Crea, si no existen: las definiciones de metacampos (namespace sidonia) y el metaobjeto de cronología, las colecciones
// inteligentes (Coches, Barcos, Casas, Explorar, Archivo), las páginas del tema con su plantilla, y un menú «Sidonia (principal)».
// NO publica nada sobre el tema actual ni toca productos. Por defecto solo MUESTRA lo que haría (--apply para ejecutarlo).
//
// Requisitos: Node 20+, y una app personalizada de la tienda con estos permisos (Ajustes > Apps > Desarrollar apps):
//   write_products, write_content, write_online_store_navigation, read_publications, write_publications, write_metaobject_definitions
//
// Uso:
//   SHOPIFY_STORE=mi-tienda.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_xxx node tools/setup/provision.mjs            # simulacro
//   SHOPIFY_STORE=... SHOPIFY_ADMIN_TOKEN=... node tools/setup/provision.mjs --apply                          # ejecuta
//   Opciones: --only=metafields,pages,collections,menu   · SHOPIFY_API_VERSION=2026-07 (cámbiala si Shopify la rechaza)
//
// ESTADO: escrito a partir de la documentación de la Admin API, pero NO ejecutado contra una tienda real (el entorno de
// desarrollo no tenía acceso a Internet). Empieza siempre por el simulacro y revisa los mensajes de error que devuelva Shopify.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const only = (args.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
const want = (k) => !only.length || only.includes(k);
const store = (process.env.SHOPIFY_STORE || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const token = process.env.SHOPIFY_ADMIN_TOKEN || '';
const version = process.env.SHOPIFY_API_VERSION || '2026-07';

if (APPLY && (!store || !token)) {
  console.error('Faltan SHOPIFY_STORE y SHOPIFY_ADMIN_TOKEN.');
  process.exit(1);
}

/* ------------------------------------------------------------ modelo de datos (desde docs/03) */
function parseModel() {
  const md = readFileSync(join(here, '..', '..', 'docs', '03-modelo-de-datos.md'), 'utf8');
  const defs = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*`sidonia\.([a-z0-9_]+)`\s*\|\s*([^|]+?)\s*\|/);
    if (!m) continue;
    const [, name, key, typeText] = m;
    if (defs.some((d) => d.key === key)) continue;
    defs.push({ name, key, ...mapType(typeText, key) });
  }
  return defs;
}
function mapType(t, key) {
  const choices = (t.match(/opciones:\s*(.+)$/i) || [])[1];
  const list = choices ? [...choices.matchAll(/`([^`]+)`/g)].map((x) => x[1]).filter((c) => !/^(Garage|Harbor|Estate)$/.test(c)) : null;
  if (/Lista de referencias a metaobjeto/i.test(t)) return { type: 'list.metaobject_reference', needsMetaobject: true };
  if (/Lista de referencias a producto/i.test(t)) return { type: 'list.product_reference' };
  if (/Lista de referencias a archivo/i.test(t)) return { type: 'list.file_reference', validations: [{ name: 'file_type_options', value: '["GenericFile"]' }] };
  if (/Referencia a archivo \(v/i.test(t)) return { type: 'file_reference', validations: [{ name: 'file_type_options', value: '["Video"]' }] };
  if (/Referencia a archivo/i.test(t)) return { type: 'file_reference', validations: [{ name: 'file_type_options', value: '["GenericFile"]' }] };
  if (/Lista de textos/i.test(t)) return { type: 'list.single_line_text_field' };
  if (/Texto enriquecido/i.test(t)) return { type: 'rich_text_field' };
  if (/varias l/i.test(t)) return { type: 'multi_line_text_field' };
  if (/Texto de una l/i.test(t)) return { type: 'single_line_text_field', validations: list && list.length ? [{ name: 'choices', value: JSON.stringify(list) }] : undefined };
  if (/Decimal/i.test(t)) return { type: 'number_decimal' };
  if (/entero/i.test(t)) return { type: 'number_integer' };
  if (/Verdadero/i.test(t)) return { type: 'boolean' };
  if (/URL/i.test(t)) return { type: 'url' };
  return { type: 'single_line_text_field', unknown: t };
}

const PAGES = [
  { handle: 'vender', title: 'Vender con Sidonia', templateSuffix: 'sell' },
  { handle: 'como-vendemos', title: 'Cómo vendemos', templateSuffix: 'how-it-works' },
  { handle: 'sobre-sidonia', title: 'Sobre Sidonia', templateSuffix: 'about' },
  { handle: 'favoritos', title: 'Favoritos', templateSuffix: 'favorites' },
  { handle: 'contacto', title: 'Contacto', templateSuffix: 'contact' },
  { handle: 'busco', title: 'Cuéntanos qué buscas', templateSuffix: 'wanted' },
  { handle: 'marcas', title: 'Marcas de coches y barcos', templateSuffix: 'brands' },
  { handle: 'privacidad', title: 'Aviso de privacidad', templateSuffix: 'legal', body: '<p>Pendiente: redacta aquí el aviso de privacidad con tu asesoría legal.</p>' }
];

if (args.includes('--print-model')) {
  console.log(JSON.stringify(parseModel(), null, 2));
  process.exit(0);
}

/* ------------------------------------------------------------ cliente GraphQL */
async function gql(query, variables) {
  const res = await fetch(`https://${store}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  if (json.errors) throw new Error('GraphQL: ' + JSON.stringify(json.errors).slice(0, 500));
  return json.data;
}
const report = { ok: [], skipped: [], failed: [] };
const say = (kind, msg) => {
  report[kind].push(msg);
  console.log(({ ok: '  ✔ ', skipped: '  · ', failed: '  ✘ ' })[kind] + msg);
};
async function run(label, fn) {
  if (!APPLY) return say('skipped', `(simulacro) ${label}`);
  try {
    await fn();
  } catch (e) {
    say('failed', `${label}: ${e.message}`);
  }
}
const userErr = (errs) => (errs || []).map((e) => `${(e.field || []).join('.')} ${e.message}`.trim()).join('; ');
const isTaken = (errs) => (errs || []).some((e) => /taken|already|exist|ya (existe|está)/i.test(e.message) || e.code === 'TAKEN');

/* ------------------------------------------------------------ pasos */
const defIds = {};
async function metafields() {
  console.log('\nMetacampos de producto (namespace sidonia)');
  const defs = parseModel();
  let metaobjId = null;
  await run('metaobjeto sidonia_timeline_event (Hito de cronología)', async () => {
    const d = await gql(
      `mutation($def: MetaobjectDefinitionCreateInput!){ metaobjectDefinitionCreate(definition:$def){ metaobjectDefinition{ id type } userErrors{ field message code } } }`,
      {
        def: {
          type: 'sidonia_timeline_event',
          name: 'Hito de cronología',
          access: { storefront: 'PUBLIC_READ' },
          displayNameKey: 'title',
          fieldDefinitions: [
            { key: 'period', name: 'Fecha o periodo', type: 'single_line_text_field' },
            { key: 'title', name: 'Título', type: 'single_line_text_field', required: true },
            { key: 'description', name: 'Descripción', type: 'multi_line_text_field' }
          ]
        }
      }
    );
    const r = d.metaobjectDefinitionCreate;
    if (r.metaobjectDefinition) {
      metaobjId = r.metaobjectDefinition.id;
      say('ok', 'metaobjeto sidonia_timeline_event creado');
    } else if (isTaken(r.userErrors)) {
      const q = await gql(`query{ metaobjectDefinitionByType(type:"sidonia_timeline_event"){ id } }`);
      metaobjId = q.metaobjectDefinitionByType && q.metaobjectDefinitionByType.id;
      say('skipped', 'metaobjeto sidonia_timeline_event ya existía');
    } else throw new Error(userErr(r.userErrors));
  });
  for (const d of defs) {
    await run(`sidonia.${d.key} · ${d.type}${d.unknown ? ' (tipo no reconocido: ' + d.unknown + ')' : ''}`, async () => {
      const validations = [...(d.validations || [])];
      if (d.needsMetaobject) {
        if (!metaobjId) throw new Error('falta el metaobjeto de cronología');
        validations.push({ name: 'metaobject_definition_id', value: metaobjId });
      }
      const data = await gql(
        `mutation($def: MetafieldDefinitionInput!){ metafieldDefinitionCreate(definition:$def){ createdDefinition{ id key } userErrors{ field message code } } }`,
        { def: { name: d.name, namespace: 'sidonia', key: d.key, ownerType: 'PRODUCT', type: d.type, validations, } }
      );
      const r = data.metafieldDefinitionCreate;
      if (r.createdDefinition) {
        defIds[d.key] = r.createdDefinition.id;
        say('ok', `sidonia.${d.key} creado`);
      } else if (isTaken(r.userErrors)) {
        say('skipped', `sidonia.${d.key} ya existía`);
      } else throw new Error(userErr(r.userErrors));
    });
  }
}

async function definitionId(key) {
  if (defIds[key]) return defIds[key];
  const q = await gql(`query($ns:String!,$key:String!){ metafieldDefinitions(first:1, ownerType:PRODUCT, namespace:$ns, key:$key){ nodes{ id } } }`, { ns: 'sidonia', key });
  const id = q.metafieldDefinitions.nodes[0] && q.metafieldDefinitions.nodes[0].id;
  if (!id) throw new Error(`no existe la definición sidonia.${key} (ejecuta antes el paso metafields)`);
  return (defIds[key] = id);
}

async function onlineStorePublication() {
  const q = await gql(`query{ publications(first:20){ nodes{ id name } } }`);
  const p = q.publications.nodes.find((n) => /online store|tienda online/i.test(n.name));
  return p && p.id;
}

async function collections() {
  console.log('\nColecciones inteligentes');
  const rule = async (key, relation, condition) => ({ column: 'PRODUCT_METAFIELD_DEFINITION', relation, condition, conditionObjectId: await definitionId(key) });
  const specs = [
    { handle: 'coches', title: 'Coches', templateSuffix: 'coches', rules: async () => [await rule('category', 'EQUALS', 'Coche'), await rule('status', 'NOT_EQUALS', 'Vendido')] },
    { handle: 'barcos', title: 'Barcos', templateSuffix: 'barcos', rules: async () => [await rule('category', 'EQUALS', 'Barco'), await rule('status', 'NOT_EQUALS', 'Vendido')] },
    { handle: 'casas', title: 'Casas', templateSuffix: 'casas', rules: async () => [await rule('category', 'EQUALS', 'Casa'), await rule('status', 'NOT_EQUALS', 'Vendido')] },
    { handle: 'explorar', title: 'Explorar', templateSuffix: '', rules: async () => [await rule('status', 'NOT_EQUALS', 'Vendido')] },
    { handle: 'archivo', title: 'Archivo de piezas vendidas', templateSuffix: 'archive', rules: async () => [await rule('status', 'EQUALS', 'Vendido')] }
  ];
  let pub = null;
  for (const c of specs) {
    await run(`colección ${c.handle} (${c.templateSuffix || 'plantilla estándar'})`, async () => {
      const exists = await gql(`query($q:String!){ collections(first:1, query:$q){ nodes{ id handle } } }`, { q: `handle:${c.handle}` });
      if (exists.collections.nodes.some((n) => n.handle === c.handle)) return say('skipped', `colección ${c.handle} ya existía`);
      const input = { title: c.title, handle: c.handle, ruleSet: { appliedDisjunctively: false, rules: await c.rules() } };
      if (c.templateSuffix) input.templateSuffix = c.templateSuffix;
      const d = await gql(`mutation($in: CollectionInput!){ collectionCreate(input:$in){ collection{ id handle } userErrors{ field message } } }`, { in: input });
      const r = d.collectionCreate;
      if (!r.collection) throw new Error(userErr(r.userErrors));
      say('ok', `colección ${c.handle} creada`);
      pub = pub || (await onlineStorePublication());
      if (pub) {
        const p = await gql(`mutation($id:ID!,$in:[PublicationInput!]!){ publishablePublish(id:$id, input:$in){ userErrors{ field message } } }`, { id: r.collection.id, in: [{ publicationId: pub }] });
        if (p.publishablePublish.userErrors.length) say('failed', `publicar ${c.handle} en Tienda online: ${userErr(p.publishablePublish.userErrors)}`);
      } else say('failed', `no se encontró el canal «Tienda online»: publica ${c.handle} a mano`);
    });
  }
}

async function pages() {
  console.log('\nPáginas');
  for (const p of PAGES) {
    await run(`página /pages/${p.handle} (plantilla ${p.templateSuffix})`, async () => {
      const exists = await gql(`query($q:String!){ pages(first:1, query:$q){ nodes{ id handle } } }`, { q: `handle:${p.handle}` });
      if (exists.pages.nodes.some((n) => n.handle === p.handle)) return say('skipped', `página ${p.handle} ya existía`);
      const d = await gql(`mutation($page: PageCreateInput!){ pageCreate(page:$page){ page{ id handle } userErrors{ field message code } } }`, {
        page: { title: p.title, handle: p.handle, body: p.body || '', isPublished: true, templateSuffix: p.templateSuffix }
      });
      const r = d.pageCreate;
      if (!r.page) throw new Error(userErr(r.userErrors));
      say('ok', `página ${p.handle} creada`);
    });
  }
}

async function menu() {
  console.log('\nMenú');
  await run('menú «Sidonia (principal)» (handle sidonia-principal)', async () => {
    const items = [
      { title: 'Explorar', type: 'HTTP', url: '/collections/explorar' },
      { title: 'Coches', type: 'HTTP', url: '/collections/coches' },
      { title: 'Barcos', type: 'HTTP', url: '/collections/barcos' },
      { title: 'Casas', type: 'HTTP', url: '/collections/casas' },
      { title: 'Cómo vendemos', type: 'HTTP', url: '/pages/como-vendemos' },
      { title: 'Sobre Sidonia', type: 'HTTP', url: '/pages/sobre-sidonia' }
    ];
    const d = await gql(`mutation($title:String!,$handle:String!,$items:[MenuItemCreateInput!]!){ menuCreate(title:$title, handle:$handle, items:$items){ menu{ id handle } userErrors{ field message code } } }`, {
      title: 'Sidonia (principal)',
      handle: 'sidonia-principal',
      items
    });
    const r = d.menuCreate;
    if (r.menu) say('ok', 'menú sidonia-principal creado: elígelo en el editor del tema > Cabecera > Menú');
    else if (isTaken(r.userErrors)) say('skipped', 'el menú sidonia-principal ya existía');
    else throw new Error(userErr(r.userErrors));
  });
}

/* ------------------------------------------------------------ principal */
console.log(`SIDONIA · puesta en marcha de ${store || '(tienda sin indicar)'} · API ${version} · ${APPLY ? 'EJECUCIÓN REAL' : 'SIMULACRO (usa --apply para ejecutar)'}`);
if (want('metafields')) await metafields();
if (want('collections')) await collections();
if (want('pages')) await pages();
if (want('menu')) await menu();
console.log(`\nResumen: ${report.ok.length} creados · ${report.skipped.length} omitidos${APPLY ? '' : ' (simulacro)'} · ${report.failed.length} con error`);
console.log('Pendiente a mano (no hay API): activar los filtros en Search & Discovery y elegir el menú en el editor del tema. Ver docs/00-puesta-en-marcha.md');
process.exit(report.failed.length ? 1 : 0);
