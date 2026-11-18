#!/usr/bin/env node
// Puesta en marcha OPCIONAL de la tienda para Sidonia mediante la Admin GraphQL API de Shopify.
//
// Crea, si no existen: definiciones de metacampos de producto (namespace sidonia), metaobjetos
// (cronología y cuentas sociales), colecciones automáticas, páginas con su plantilla y un menú.
// No toca productos, temas ni ajustes. Por defecto es un SIMULACRO: muestra lo que haría.
//
// Fuente de datos: data/metafields.json (la misma que la documentación).
//
// Requisitos: Node 20+ y una app personalizada de la tienda (Ajustes > Apps > Desarrollar apps) con:
//   write_products, write_content, write_online_store_navigation, read_publications,
//   write_publications, write_metaobject_definitions, write_metaobjects
// El token se pasa por variable de entorno y NUNCA se guarda en el repositorio ni en el tema.
//
// Uso:
//   node tools/setup/provision.mjs                                   (simulacro sin conexión)
//   SHOPIFY_STORE=tienda.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_... node tools/setup/provision.mjs --apply
//   Opciones: --only=metafields,metaobjects,collections,pages,menu · SHOPIFY_API_VERSION=2026-07
//
// ESTADO: escrito con la documentación conocida de la Admin API y NO ejecutado contra una tienda real
// (sin acceso desde el entorno de desarrollo). Empieza por el simulacro y revisa los errores que devuelva Shopify.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODEL = JSON.parse(readFileSync(join(ROOT, 'data', 'metafields.json'), 'utf8'));
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const only = (args.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
const want = (k) => !only.length || only.includes(k);
const store = (process.env.SHOPIFY_STORE || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const token = process.env.SHOPIFY_ADMIN_TOKEN || '';
const version = process.env.SHOPIFY_API_VERSION || '2026-07';

if (APPLY && (!store || !token)) {
  console.error('Faltan SHOPIFY_STORE y SHOPIFY_ADMIN_TOKEN para --apply.');
  process.exit(1);
}

async function gql(query, variables) {
  const res = await fetch(`https://${store}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  if (json.errors) throw new Error('GraphQL: ' + JSON.stringify(json.errors).slice(0, 500));
  return json.data;
}

const report = { ok: 0, skipped: 0, failed: 0 };
function say(kind, msg) {
  report[kind]++;
  console.log({ ok: '  ✔ ', skipped: '  · ', failed: '  ✘ ' }[kind] + msg);
}
async function step(label, fn) {
  if (!APPLY) return say('skipped', `(simulacro) ${label}`);
  try {
    await fn();
  } catch (e) {
    say('failed', `${label}: ${e.message}`);
  }
}
const errs = (list) => (list || []).map((e) => `${(e.field || []).join('.')} ${e.message}`.trim()).join('; ');
const taken = (list) => (list || []).some((e) => e.code === 'TAKEN' || /taken|already|exist/i.test(e.message));

function validationsFor(def, ids) {
  const v = [];
  if (def.choices) v.push({ name: 'choices', value: JSON.stringify(def.choices) });
  if (def.file_types) v.push({ name: 'file_type_options', value: JSON.stringify(def.file_types) });
  if (def.metaobject) {
    if (!ids[def.metaobject]) throw new Error(`falta el metaobjeto ${def.metaobject}`);
    v.push({ name: 'metaobject_definition_id', value: ids[def.metaobject] });
  }
  return v;
}

const metaobjectIds = {};
async function metaobjects() {
  console.log('\nMetaobjetos');
  for (const m of MODEL.metaobjects) {
    await step(`${m.type} (${m.name})`, async () => {
      const d = await gql(
        `mutation($def: MetaobjectDefinitionCreateInput!){ metaobjectDefinitionCreate(definition:$def){ metaobjectDefinition{ id } userErrors{ field message code } } }`,
        {
          def: {
            type: m.type,
            name: m.name,
            displayNameKey: m.display_key,
            access: { storefront: m.storefront ? 'PUBLIC_READ' : 'NONE' },
            fieldDefinitions: m.fields.map((f) => ({
              key: f.key,
              name: f.name,
              type: f.type,
              required: !!f.required,
              validations: f.choices ? [{ name: 'choices', value: JSON.stringify(f.choices) }] : []
            }))
          }
        }
      );
      const r = d.metaobjectDefinitionCreate;
      if (r.metaobjectDefinition) {
        metaobjectIds[m.type] = r.metaobjectDefinition.id;
        say('ok', `${m.type} creado`);
      } else if (taken(r.userErrors)) {
        const q = await gql(`query($t:String!){ metaobjectDefinitionByType(type:$t){ id } }`, { t: m.type });
        metaobjectIds[m.type] = q.metaobjectDefinitionByType && q.metaobjectDefinitionByType.id;
        say('skipped', `${m.type} ya existía`);
      } else throw new Error(errs(r.userErrors));
    });
  }
}

const definitionIds = {};
async function metafields() {
  console.log('\nMetacampos de producto (namespace sidonia)');
  if (APPLY && Object.keys(metaobjectIds).length === 0) {
    for (const m of MODEL.metaobjects) {
      const q = await gql(`query($t:String!){ metaobjectDefinitionByType(type:$t){ id } }`, { t: m.type });
      if (q.metaobjectDefinitionByType) metaobjectIds[m.type] = q.metaobjectDefinitionByType.id;
    }
  }
  for (const def of MODEL.product_metafields) {
    await step(`sidonia.${def.key} · ${def.type}`, async () => {
      const d = await gql(
        `mutation($def: MetafieldDefinitionInput!){ metafieldDefinitionCreate(definition:$def){ createdDefinition{ id } userErrors{ field message code } } }`,
        {
          def: {
            name: def.name,
            namespace: MODEL.namespace,
            key: def.key,
            ownerType: MODEL.owner,
            type: def.type,
            description: def.use || undefined,
            validations: validationsFor(def, metaobjectIds),
            pin: true,
            capabilities: def.smart ? { smartCollectionCondition: { enabled: true } } : undefined
          }
        }
      );
      const r = d.metafieldDefinitionCreate;
      if (r.createdDefinition) {
        definitionIds[def.key] = r.createdDefinition.id;
        say('ok', `sidonia.${def.key} creado`);
      } else if (taken(r.userErrors)) say('skipped', `sidonia.${def.key} ya existía`);
      else throw new Error(errs(r.userErrors));
    });
  }
}

async function definitionId(key) {
  if (definitionIds[key]) return definitionIds[key];
  const q = await gql(`query($k:String!){ metafieldDefinitions(first:1, ownerType:PRODUCT, namespace:"sidonia", key:$k){ nodes{ id } } }`, { k: key });
  const id = q.metafieldDefinitions.nodes[0] && q.metafieldDefinitions.nodes[0].id;
  if (!id) throw new Error(`no existe sidonia.${key}: ejecuta antes --only=metafields`);
  return (definitionIds[key] = id);
}

async function collections() {
  console.log('\nColecciones automáticas (solo condiciones «es igual a», las que Shopify admite en texto)');
  for (const c of MODEL.collections) {
    await step(`/collections/${c.handle}${c.template ? ' (plantilla collection.' + c.template + ')' : ''}`, async () => {
      const ex = await gql(`query($q:String!){ collections(first:1, query:$q){ nodes{ handle } } }`, { q: `handle:${c.handle}` });
      if (ex.collections.nodes.some((n) => n.handle === c.handle)) return say('skipped', `${c.handle} ya existía`);
      const rules = [];
      for (const [key, value] of c.rules) rules.push({ column: 'PRODUCT_METAFIELD_DEFINITION', relation: 'EQUALS', condition: value, conditionObjectId: await definitionId(key) });
      const input = { title: c.title, handle: c.handle, ruleSet: { appliedDisjunctively: !!c.any, rules } };
      if (c.template) input.templateSuffix = c.template;
      const d = await gql(`mutation($in: CollectionInput!){ collectionCreate(input:$in){ collection{ id } userErrors{ field message } } }`, { in: input });
      if (!d.collectionCreate.collection) throw new Error(errs(d.collectionCreate.userErrors));
      say('ok', `${c.handle} creada (publícala en Tienda online si no aparece)`);
    });
  }
}

async function pages() {
  console.log('\nPáginas');
  for (const p of MODEL.pages) {
    await step(`/pages/${p.handle} (plantilla page.${p.template})`, async () => {
      const ex = await gql(`query($q:String!){ pages(first:1, query:$q){ nodes{ handle } } }`, { q: `handle:${p.handle}` });
      if (ex.pages.nodes.some((n) => n.handle === p.handle)) return say('skipped', `${p.handle} ya existía (asígnale la plantilla a mano)`);
      const d = await gql(`mutation($page: PageCreateInput!){ pageCreate(page:$page){ page{ id } userErrors{ field message } } }`, {
        page: { title: p.title, handle: p.handle, body: '', isPublished: true, templateSuffix: p.template }
      });
      if (!d.pageCreate.page) throw new Error(errs(d.pageCreate.userErrors));
      say('ok', `${p.handle} creada`);
    });
  }
}

async function menu() {
  console.log('\nMenú');
  const m = MODEL.menu;
  await step(`menú ${m.handle}`, async () => {
    const d = await gql(
      `mutation($title:String!,$handle:String!,$items:[MenuItemCreateInput!]!){ menuCreate(title:$title, handle:$handle, items:$items){ menu{ id } userErrors{ field message code } } }`,
      { title: m.title, handle: m.handle, items: m.items.map(([title, url]) => ({ title, type: 'HTTP', url })) }
    );
    const r = d.menuCreate;
    if (r.menu) say('ok', `menú ${m.handle} creado: elígelo en la cabecera de Impact del duplicado`);
    else if (taken(r.userErrors)) say('skipped', `menú ${m.handle} ya existía`);
    else throw new Error(errs(r.userErrors));
  });
}

console.log(`SIDONIA · puesta en marcha · ${store || '(sin tienda)'} · API ${version} · ${APPLY ? 'EJECUCIÓN' : 'SIMULACRO'}`);
if (want('metaobjects')) await metaobjects();
if (want('metafields')) await metafields();
if (want('collections')) await collections();
if (want('pages')) await pages();
if (want('menu')) await menu();
console.log(`\nResumen: ${report.ok} creados · ${report.skipped} omitidos · ${report.failed} con error`);
console.log('A mano (sin API): filtros en Search & Discovery, entradas de cuentas sociales, menú en la cabecera del duplicado. Ver docs/02-instalacion.md.');
process.exit(report.failed ? 1 : 0);
