/* SIDONIA · Centro operativo (panel › Ventas y Propietarios).
 *
 * Cada coche, moto, barco o casa que vende Sidonia es una «operación»: su propietario, su comprador, el precio de
 * salida y el de venta, la comisión de Sidonia y la del comercial, cuándo se anunció y cuándo se vendió. Se rellena a
 * mano en el panel o importando el Excel de ventas (las hojas con «Modelo / Precio / Comisión / Venta»), y se enlaza
 * sola con su ficha de la tienda (por el título) para sacar la fecha en que se anunció.
 *
 *   ?estado=ventas[&ver=en_venta|vendido|captacion|encargo|retirado|todo][&q=]   la lista y los números
 *   ?estado=ventas&csv=1                                                          todo en CSV
 *   ?estado=operacion[&id=]                                                       añadir o editar una
 *   ?estado=importar                                                              subir el Excel (vista previa e importar)
 *   ?estado=duenos                                                                Propietarios: los de las ventas y los
 *                                                                                 de los anuncios gratis, con sus coches
 * Base de datos: sql/operaciones.sql (tabla operaciones).
 */
import { esc, shopifyAdmin, tablaAnuncios } from './circulo.mjs';
import { ESTILO, fmt, n, navPanel } from './estadisticas.mjs';
import { leerXlsx } from './xlsx.mjs';

export const ESTADOS_OP = { captacion: 'Captación', en_venta: 'En venta', reservado: 'Reservado', vendido: 'Vendido', retirado: 'Retirado' };
export const MODALIDADES = { gestion: 'Venta gestionada', encargo: 'Encargo', subasta: 'Subasta', particular: 'Anuncio de particular' };
/** El comercial de Sidonia: las comisiones de comercial del Excel son suyas */
export const COMERCIAL = 'Hugo';
export const TIPOS_OP = { coche: 'Coche', moto: 'Moto', barco: 'Barco', casa: 'Casa', otro: 'Otro' };
const CAMPOS = ['tipo', 'titulo', 'handle', 'estado', 'modalidad', 'propietario_nombre', 'propietario_email', 'propietario_telefono', 'comprador_nombre', 'comprador_email',
  'comprador_telefono', 'precio_anunciado', 'precio_venta', 'comision', 'comision_comercial', 'comercial', 'fecha_alta', 'fecha_venta', 'notas'];
const NUMEROS = ['precio_anunciado', 'precio_venta', 'comision', 'comision_comercial'];
const FECHAS = ['fecha_alta', 'fecha_venta'];

const tabla = (cfg, deps) => deps.operaciones || tablaAnuncios(cfg, deps.fetch, 'operaciones');
export const normal = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const euros = (x) => (x == null || x === '' ? '—' : `${Math.round(Number(x)).toLocaleString('es-ES')} €`);
const redondo = (x) => Math.round(Number(x) * 100) / 100;

/** «45.000 €», «35000», 35000.4 → número (o null) */
export function numero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v ?? '').replace(/[€\s]/g, '');
  if (!t || !/\d/.test(t)) return null;
  const limpio = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
  const x = Number(limpio.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(x) ? x : null;
}

/** El tipo por el título («YAMAHA TZR 250» → moto) */
export function tipoDe(titulo) {
  const t = normal(titulo);
  if (/\b(yamaha|ducati|vespa|lambretta|kawasaki|harley|husqvarna|ktm|moto|motocicleta|bultaco|montesa|ossa|aprilia|mv agusta)\b/.test(t) || /\bhonda (cb|cbr|vfr|nsr|xr)\b/.test(t) || /\bsuzuki (gsx|rg|gs)\b/.test(t)) return 'moto';
  if (/\b(barco|yate|velero|lancha|riva|catamaran|llaut|llaüt)\b/.test(t)) return 'barco';
  if (/\b(casa|villa|piso|chalet|finca|apartamento|atico)\b/.test(t)) return 'casa';
  return 'coche';
}

// «ENCARGO PACO», «ENACRGO MARIO» (con erratas) → «PACO», «MARIO»
const quien = (t) => (/^en[a-z]*[rc]g/i.test(t) ? t.split(' ').slice(1).join(' ') : t);
const capital = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/* ---------------------------------------------------------------------------- Importar el Excel */
/**
 * Saca las operaciones de un libro (leerXlsx): en cada hoja, cada tabla con una fila de títulos «Coche / Modelo …» y
 * «Precio …». Columnas: precio (vendido / venta / propuesto), comisión Sidonia, comisión comercial, venta («VENDIDO»)
 * y estimaciones (van a las notas). Encima de la tabla, «Encargos…» = encargos; hoja «Colección X» = propietario X.
 */
export function detectarOperaciones(libro) {
  const ops = [];
  for (const hoja of libro) {
    const propietarioHoja = (hoja.nombre.match(/colecci[oó]n\s+(.+)/i) || [])[1]?.trim() || '';
    const filas = hoja.filas;
    for (let r = 0; r < filas.length; r += 1) {
      const fila = filas[r] || [];
      for (let c = 0; c < fila.length; c += 1) {
        const cab = normal(fila[c]);
        if (!/^(coches?|modelo|coches modelo|vehiculos?|barcos?|motos?|casas?)( |$)/.test(cab)) continue;
        if (!fila.slice(c + 1, c + 8).some((x) => /precio/.test(normal(x)))) continue;
        // Las columnas de esta tabla (hasta la primera vacía)
        const cols = {};
        for (let k = c + 1; k < fila.length && normal(fila[k]); k += 1) {
          const h = normal(fila[k]);
          if (/comision.*comercial/.test(h)) cols.comision_comercial = k;
          else if (/comision/.test(h)) cols.comision = k;
          else if (/precio/.test(h)) { cols.precio = k; if (/propuest/.test(h)) cols.propuesto = true; }
          else if (/^(venta|estado|vendido)$/.test(h)) cols.venta = k;
          else (cols.notas ||= []).push([k, String(fila[k]).trim()]);
        }
        const encima = [filas[r - 1]?.[c], filas[r - 2]?.[c]].map(normal).join(' ');
        const encargo = /encargo/.test(encima);
        const vistos = {};
        let vacias = 0;
        for (let i = r + 1; i < filas.length && vacias < 3; i += 1) {
          const f = filas[i] || [];
          const titulo = String(f[c] ?? '').replace(/\s+/g, ' ').trim();
          if (!titulo) { vacias += 1; continue; }
          vacias = 0;
          if (/^(total|totales|suma)\b/i.test(titulo)) break;
          const precio = numero(f[cols.precio]);
          const vendido = cols.venta !== undefined && /vendid/i.test(String(f[cols.venta] ?? ''));
          const clave = `${normal(hoja.nombre)}|${normal(titulo)}`;
          vistos[clave] = (vistos[clave] || 0) + 1;
          const op = {
            ref: `excel|${clave}|${vistos[clave]}`,
            fila: `${hoja.nombre} · fila ${i + 1}`,
            titulo: encargo ? `Encargo · ${capital(quien(titulo))}` : titulo,
            tipo: tipoDe(titulo),
            modalidad: encargo ? 'encargo' : 'gestion',
            estado: vendido ? 'vendido' : cols.propuesto ? 'captacion' : 'en_venta',
            precio_anunciado: vendido ? null : precio,
            precio_venta: vendido ? precio : null,
            comision: cols.comision !== undefined && numero(f[cols.comision]) ? redondo(numero(f[cols.comision])) : null,
            comision_comercial: cols.comision_comercial !== undefined && numero(f[cols.comision_comercial]) ? redondo(numero(f[cols.comision_comercial])) : null,
            comercial: cols.comision_comercial !== undefined && numero(f[cols.comision_comercial]) ? COMERCIAL : null,
            propietario_nombre: propietarioHoja || null,
            comprador_nombre: encargo ? capital(quien(titulo).replace(/\s+\d+$/, '')) : null,
            notas: (cols.notas || []).map(([k, h]) => (String(f[k] ?? '').trim() ? `${h}: ${String(f[k]).trim()}` : '')).filter(Boolean).join(' · ') || null
          };
          if (vendido && op.precio_venta == null) op.precio_venta = precio;
          ops.push(op);
        }
      }
    }
  }
  return ops;
}

/* ---------------------------------------------------------------------------- Enlazar con las fichas de Shopify */
const palabras = (t) => normal(t).split(' ').filter((w) => w.length > 1 || /\d/.test(w));
const anios = (t) => (String(t).match(/\b(19|20)\d{2}\b/g) || []);

/** Lo bien que se parece un título del Excel a uno de la tienda (0 a 1) */
export function parecido(op, prod) {
  const a = palabras(op), b = new Set(palabras(prod));
  if (!a.length) return 0;
  const ya = anios(op), yb = anios(prod);
  if (ya.length && yb.length && !ya.some((y) => yb.includes(y))) return 0;
  return a.filter((w) => b.has(w)).length / a.length;
}

const TIPO_SHOPIFY = { coches: 'coche', coche: 'coche', motos: 'moto', moto: 'moto', barcos: 'barco', barco: 'barco', casas: 'casa', casa: 'casa' };

/** Todos los productos de la tienda (para enlazar) */
export async function productosTienda(gql) {
  const out = [];
  let despues = null;
  do {
    const d = await gql(`query($despues: String) { products(first: 250, after: $despues) { nodes { handle title productType createdAt status tags
      precio: priceRangeV2 { minVariantPrice { amount } } } pageInfo { hasNextPage endCursor } } }`, { despues });
    out.push(...d.products.nodes);
    despues = d.products.pageInfo.hasNextPage && out.length < 5000 ? d.products.pageInfo.endCursor : null;
  } while (despues);
  return out;
}

/**
 * Para cada operación sin ficha, la ficha de la tienda que más se le parece (sin repetir ficha). Devuelve los cambios
 * [{ id, cambios: { handle, fecha_alta, tipo, precio_anunciado, estado } }]: la fecha en que se anunció es la de la ficha,
 * y si en la tienda está vendida («vendido» en las etiquetas) o archivada, aquí también (vendida o retirada).
 */
export function emparejar(ops, productos) {
  const usados = new Set(ops.map((o) => o.handle).filter(Boolean));
  const candidatos = [];
  for (const o of ops) {
    if (o.handle || o.modalidad === 'encargo') continue;
    for (const p of productos) {
      if (usados.has(p.handle)) continue;
      const s = parecido(o.titulo, p.title);
      if (s >= 0.75) candidatos.push([s, o, p]);
    }
  }
  // Las que ya tienen ficha: si en la tienda está vendida o archivada, se pone igual aquí
  const porHandle = new Map(productos.map((p) => [p.handle, p]));
  const estadoTienda = (o, p) => {
    if (!p || o.estado === 'vendido' || o.estado === 'captacion') return null;
    if ((p.tags || []).some((t) => /^vendid/i.test(t))) return 'vendido';
    if (p.status === 'ARCHIVED' && o.estado !== 'retirado') return 'retirado';
    return null;
  };
  const sincronizadas = [];
  for (const o of ops) {
    const e = o.handle && estadoTienda(o, porHandle.get(o.handle));
    if (e) sincronizadas.push({ id: o.id, titulo: o.titulo, producto: porHandle.get(o.handle).title, cambios: { estado: e } });
  }
  candidatos.sort((x, y) => y[0] - x[0] || String(y[2].createdAt).localeCompare(String(x[2].createdAt)));
  const hechos = new Map();
  for (const [, o, p] of candidatos) {
    if (hechos.has(o.id) || usados.has(p.handle)) continue;
    usados.add(p.handle);
    const cambios = { handle: p.handle };
    if (!o.fecha_alta && p.createdAt) cambios.fecha_alta = p.createdAt.slice(0, 10);
    const t = TIPO_SHOPIFY[normal(p.productType)];
    if (t && t !== o.tipo) cambios.tipo = t;
    const precio = Number(p.precio?.minVariantPrice?.amount);
    if (o.precio_anunciado == null && precio > 0) cambios.precio_anunciado = precio;
    const e = estadoTienda(o, p);
    if (e) cambios.estado = e;
    hechos.set(o.id, { id: o.id, titulo: o.titulo, producto: p.title, cambios });
  }
  return [...sincronizadas, ...hechos.values()];
}

/* ---------------------------------------------------------------------------- Números */
const DOBLES = ['land rover', 'range rover', 'aston martin', 'alfa romeo', 'rolls royce', 'austin healey', 'de tomaso', 'mercedes amg', 'land cruiser', 'dmc delorean'];
/** La marca: «LAND ROVER DEFENDER» → «Land Rover», «MERCEDES-BENZ 280» → «Mercedes» */
export function marcaDe(titulo) {
  const t = normal(titulo);
  const doble = DOBLES.find((d) => t.startsWith(`${d} `) || t === d);
  const m = doble || t.split(' ')[0] || '';
  return m === 'land cruiser' ? 'Toyota' : m === 'mercedes amg' ? 'Mercedes' : m === 'dmc delorean' ? 'DeLorean' : capital(m);
}

const dias = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 864e5) : null);

export function resumen(ops) {
  const vendidos = ops.filter((o) => o.estado === 'vendido');
  const ventas = vendidos.filter((o) => o.modalidad !== 'encargo');
  const encargos = vendidos.filter((o) => o.modalidad === 'encargo');
  const suma = (l, f) => l.reduce((s, o) => s + n(f(o)), 0);
  const facturado = suma(vendidos, (o) => o.precio_venta ?? o.precio_anunciado);
  const comision = suma(vendidos, (o) => o.comision);
  const comercial = suma(vendidos, (o) => o.comision_comercial);
  const enVenta = ops.filter((o) => o.estado === 'en_venta' || o.estado === 'reservado');
  const tiempos = vendidos.map((o) => dias(o.fecha_alta, o.fecha_venta)).filter((d) => d != null && d >= 0);
  const descuentos = vendidos.filter((o) => n(o.precio_anunciado) > 0 && n(o.precio_venta) > 0).map((o) => 1 - o.precio_venta / o.precio_anunciado);
  const marcas = {};
  for (const o of ventas) {
    const m = marcaDe(o.titulo);
    marcas[m] ||= { marca: m, n: 0, facturado: 0, comision: 0 };
    marcas[m].n += 1; marcas[m].facturado += n(o.precio_venta ?? o.precio_anunciado); marcas[m].comision += n(o.comision);
  }
  const comerciales = {};
  for (const o of vendidos.filter((x) => x.comercial)) {
    comerciales[o.comercial] ||= { comercial: o.comercial, n: 0, comision: 0, sobre: 0 };
    comerciales[o.comercial].n += 1; comerciales[o.comercial].comision += n(o.comision_comercial); comerciales[o.comercial].sobre += n(o.comision);
  }
  return {
    vendidos: vendidos.length, ventas: ventas.length, encargos: encargos.length, facturado, comision, comercial, neto: comision - comercial,
    pct: facturado ? (comision / facturado) * 100 : 0,
    ticket: vendidos.length ? facturado / vendidos.length : 0,
    enVenta: enVenta.length, valorEnVenta: suma(enVenta, (o) => o.precio_anunciado ?? o.precio_venta), comisionPrevista: suma(enVenta, (o) => o.comision),
    captacion: ops.filter((o) => o.estado === 'captacion').length,
    diasMedios: tiempos.length ? Math.round(tiempos.reduce((s, d) => s + d, 0) / tiempos.length) : null, conTiempos: tiempos.length,
    descuento: descuentos.length ? (descuentos.reduce((s, d) => s + d, 0) / descuentos.length) * 100 : null,
    marcas: Object.values(marcas).sort((a, b) => b.n - a.n || b.facturado - a.facturado).slice(0, 10),
    // pct: lo que se lleva el comercial sobre la comisión de Sidonia (su parte del beneficio)
    comerciales: Object.values(comerciales).map((c) => ({ ...c, pct: c.sobre ? (c.comision / c.sobre) * 100 : 0 })).sort((a, b) => b.comision - a.comision)
  };
}

/** Lo que se lleva el comercial sobre la comisión de Sidonia (%), o null */
export const pctComercial = (o) => (n(o.comision) && n(o.comision_comercial) ? (o.comision_comercial / o.comision) * 100 : null);

/* ---------------------------------------------------------------------------- Páginas */
export const marco = (titulo, on, cuerpo, extraCss = '') => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} · Panel de Sidonia</title><meta name="robots" content="noindex">
<style>${ESTILO}
  td.izq, th.izq { text-align: left; } td .sub { display: block; font-size: 12px; opacity: .55; }
  .pill { display: inline-block; padding: 3px 9px; border-radius: 99px; font-size: 12px; font-weight: 700; white-space: nowrap; background: #eceae5; color: #5f5b53; }
  .pill.vendido { background: #e2f3e8; color: #1f7a4d; } .pill.en_venta { background: #e8eefb; color: #2b4c9b; } .pill.reservado { background: #fff3d6; color: #8a5a00; }
  .pill.captacion { background: #f1e8fb; color: #6b3fa0; } .pill.retirado { background: #f3e9e7; color: #8a3a2a; }
  .barra { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0 0 14px; }
  .barra input[type=search] { padding: 9px 14px; border: 1px solid #0002; border-radius: 99px; font: inherit; font-size: 14px; min-width: 220px; background: #fff; }
  .boton { display: inline-block; padding: 9px 16px; border: 0; border-radius: 99px; background: #1a1a1a; color: #fff !important; text-decoration: none; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
  .boton.claro { background: #fff; color: #1a1a1a !important; border: 1px solid #0002; } .boton.rojo { background: #b3261e; }
  .aviso { padding: 12px 16px; border-radius: 12px; background: #e6f4ec; color: #1f7a4d; font-weight: 600; margin: 0 0 14px; } .aviso.mal { background: #fde8ea; color: #a2121f; }
  form.op { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px 16px; }
  form.op fieldset { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px 16px; margin: 0; padding: 16px; border: 0; border-radius: 16px; background: #fff; }
  form.op legend { float: left; width: 100%; padding: 0 0 4px; font-weight: 700; font-size: 15px; }
  form.op label { display: grid; gap: 5px; font-size: 13px; color: #0009; }
  form.op input, form.op select, form.op textarea { padding: 10px 12px; border: 1px solid #0002; border-radius: 10px; font: inherit; font-size: 15px; color: #1a1a1a; background: #fff; }
  form.op .ancho { grid-column: 1 / -1; } form.op .acc { grid-column: 1 / -1; display: flex; gap: 10px; flex-wrap: wrap; }
  tr[data-q] { cursor: pointer; } tr[data-q]:hover td { background: #00000005; }
  .kpi b { font-size: clamp(22px, 1.2rem + .8vw, 28px); white-space: nowrap; }
  .bars li { grid-template-columns: 190px 1fr 90px; } .bars .bl .sub { display: block; }
  .tareas { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px; } .tareas a { padding: 8px 14px; border-radius: 99px; background: #fff3d6; color: #8a5a00; text-decoration: none; font-size: 14px; font-weight: 600; }
  ${extraCss}
</style></head><body>
<header><h1>SIDONIA · PANEL</h1></header>
${navPanel(on)}
${cuerpo}
</body></html>`;

const errorSql = (error) => (error ? `<p class="aviso mal">No se han podido leer las ventas: ${esc(/operaciones|relation|schema cache/.test(error) ? 'falta ejecutar sql/operaciones.sql en Supabase › SQL Editor.' : error)}</p>` : '');
const pill = (e) => `<span class="pill ${esc(e)}">${esc(ESTADOS_OP[e] || e)}</span>`;

export function paginaVentas(ops, { ver = 'todo', aviso = '', error = '', tienda = 'https://sidonia.es', tareas = [] } = {}) {
  const r = resumen(ops);
  const filtros = { todo: 'Todas', en_venta: 'En venta', vendido: 'Vendidas', captacion: 'Captación', encargo: 'Encargos', retirado: 'Retiradas' };
  const cuenta = (k) => (k === 'todo' ? ops.length : k === 'encargo' ? ops.filter((o) => o.modalidad === 'encargo').length : k === 'en_venta' ? ops.filter((o) => o.estado === 'en_venta' || o.estado === 'reservado').length : ops.filter((o) => o.estado === k).length);
  const lista = ops.filter((o) => ver === 'todo' || (ver === 'encargo' ? o.modalidad === 'encargo' : ver === 'en_venta' ? (o.estado === 'en_venta' || o.estado === 'reservado') : o.estado === ver));
  const filas = lista.map((o) => {
    const d = dias(o.fecha_alta, o.fecha_venta);
    const pct = n(o.comision) && n(o.precio_venta ?? o.precio_anunciado) ? (o.comision / (o.precio_venta ?? o.precio_anunciado)) * 100 : null;
    const q = normal(`${o.titulo} ${o.propietario_nombre || ''} ${o.comprador_nombre || ''} ${o.propietario_email || ''} ${o.comprador_email || ''} ${o.comercial || ''}`);
    return `<tr data-q="${esc(q)}" onclick="if(!event.target.closest('a'))location.href='?estado=operacion&id=${o.id}'">
      <td class="izq"><b>${esc(o.titulo)}</b><span class="sub">${esc(TIPOS_OP[o.tipo] || o.tipo)} · ${esc(MODALIDADES[o.modalidad] || o.modalidad)}${o.handle ? ` · <a href="${esc(tienda)}/products/${esc(o.handle)}" target="_blank" rel="noopener">ficha</a> · <a href="?estado=anuncio&h=${encodeURIComponent(o.handle)}">interesados</a>` : ''}</span></td>
      <td class="izq">${pill(o.estado)}</td>
      <td class="izq">${esc(o.propietario_nombre || '—')}${o.propietario_telefono ? `<span class="sub">${esc(o.propietario_telefono)}</span>` : ''}</td>
      <td class="izq">${esc(o.comprador_nombre || '—')}${o.comprador_telefono ? `<span class="sub">${esc(o.comprador_telefono)}</span>` : ''}</td>
      <td>${o.estado === 'vendido' ? euros(o.precio_venta) : euros(o.precio_anunciado)}${o.estado === 'vendido' && n(o.precio_anunciado) ? `<span class="sub">salía a ${euros(o.precio_anunciado)}</span>` : ''}</td>
      <td>${euros(o.comision)}${pct != null ? `<span class="sub">${pct.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %</span>` : ''}</td>
      <td>${n(o.comision_comercial) ? euros(o.comision_comercial) : '—'}${o.comercial || n(o.comision_comercial) ? `<span class="sub">${esc(o.comercial || '')}${pctComercial(o) != null ? ` · ${pctComercial(o).toLocaleString('es-ES', { maximumFractionDigits: 1 })} % del beneficio` : ''}</span>` : ''}</td>
      <td>${o.fecha_alta ? new Date(o.fecha_alta).toLocaleDateString('es-ES') : '—'}</td>
      <td>${o.fecha_venta ? new Date(o.fecha_venta).toLocaleDateString('es-ES') : '—'}${d != null ? `<span class="sub">${d} días</span>` : ''}</td></tr>`;
  }).join('');
  const marcas = r.marcas.length ? `<ul class="bars">${r.marcas.map((m) => `<li><span class="bl">${esc(m.marca)}</span><span class="bb"><i style="width:${((m.n / r.marcas[0].n) * 100).toFixed(1)}%"></i></span><b>${fmt(m.n)}</b></li>`).join('')}</ul>` : '<p class="vacio">Aún sin ventas.</p>';
  const comerciales = r.comerciales.length ? `<ul class="bars">${r.comerciales.map((c) => `<li><span class="bl">${esc(c.comercial)}<span class="sub">${fmt(c.n)} ${c.n === 1 ? 'venta' : 'ventas'} · ${c.pct.toLocaleString('es-ES', { maximumFractionDigits: 1 })} % del beneficio de media</span></span><span class="bb"><i style="width:${((c.comision / r.comerciales[0].comision) * 100 || 0).toFixed(1)}%"></i></span><b>${euros(c.comision)}</b></li>`).join('')}</ul>` : '<p class="vacio">Pon el nombre del comercial en cada venta para verlo aquí.</p>';
  return marco('Ventas', 'ventas', `
${aviso ? `<p class="aviso${/^Error/.test(aviso) ? ' mal' : ''}">${esc(aviso)}</p>` : ''}
${errorSql(error)}
${tareas.length ? `<div class="tareas">${tareas.map(([t, href]) => `<a href="${href}">${esc(t)}</a>`).join('')}</div>` : ''}
<div class="kpis">
  <div class="kpi"><b>${fmt(r.vendidos)}</b><span>Vendidos</span><small>${fmt(r.ventas)} ventas · ${fmt(r.encargos)} encargos</small></div>
  <div class="kpi"><b>${euros(r.facturado)}</b><span>Vendido en total</span><small>ticket medio ${euros(r.ticket)}</small></div>
  <div class="kpi"><b>${euros(r.comision)}</b><span>Comisión Sidonia</span><small>${r.pct.toLocaleString('es-ES', { maximumFractionDigits: 1 })} % de media</small></div>
  <div class="kpi"><b>${euros(r.comercial)}</b><span>Comisión comerciales</span><small>${r.comerciales.length === 1 ? `para ${esc(r.comerciales[0].comercial)} · ` : ''}neto Sidonia ${euros(r.neto)}</small></div>
  <div class="kpi"><b>${fmt(r.enVenta)}</b><span>En venta ahora</span><small>${euros(r.valorEnVenta)} · comisión prevista ${euros(r.comisionPrevista)}</small></div>
  <div class="kpi"><b>${r.diasMedios == null ? '—' : fmt(r.diasMedios)}</b><span>Días hasta vender</span><small>${r.conTiempos ? `de media, en ${fmt(r.conTiempos)} ventas con fechas` : 'pon las fechas para verlo'}</small></div>
  <div class="kpi"><b>${r.descuento == null ? '—' : `${r.descuento.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`}</b><span>Rebaja media</span><small>del precio de salida al de venta</small></div>
  <div class="kpi"><b>${fmt(r.captacion)}</b><span>En captación</span><small>tasados, aún sin anunciar</small></div>
</div>
<div class="grid2">
  <div class="card"><h2>Las marcas que más vendemos</h2>${marcas}</div>
  <div class="card"><h2>Comerciales</h2>${comerciales}</div>
</div>
<div class="barra" style="margin-top:14px">
  <div class="per" style="margin:0">${Object.entries(filtros).map(([k, t]) => `<a href="?estado=ventas&ver=${k}" class="${k === ver ? 'on' : ''}">${t} <small>${fmt(cuenta(k))}</small></a>`).join('')}</div>
  <input type="search" placeholder="Buscar coche, propietario, comprador…" oninput="const q=this.value.trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');document.querySelectorAll('tr[data-q]').forEach((tr)=>{tr.hidden=q&&!tr.dataset.q.includes(q)})">
  <a class="boton" href="?estado=operacion">+ Añadir</a>
  <a class="boton claro" href="?estado=importar">Importar Excel</a>
  <form method="post" action="?estado=ventas&ver=${esc(ver)}" style="display:inline"><button class="boton claro" name="accion" value="enlazar">Enlazar con la tienda</button></form>
  <a class="boton claro" href="?estado=ventas&csv=1">Descargar CSV</a>
</div>
<div class="card"><div class="tabla"><table>
  <thead><tr><th class="izq">Vehículo</th><th class="izq">Estado</th><th class="izq">Propietario</th><th class="izq">Comprador</th><th>Precio</th><th>Comisión</th><th>Comercial</th><th>Anunciado</th><th>Vendido</th></tr></thead>
  <tbody>${filas || '<tr><td colspan="9" class="vacio">Aún no hay nada aquí. Añade una venta o importa el Excel.</td></tr>'}</tbody>
</table></div></div>
<p class="nota">Pulsa en una fila para ver o cambiar todo (propietario, comprador, precios, comisiones y fechas). «Enlazar con la tienda» busca la ficha de cada uno por el título, pone la fecha en que se anunció y, si en la tienda ya está vendido o archivado, lo pone igual aquí.</p>`);
}

/** Todo en CSV (con ; y BOM, para Excel) */
export function csvOperaciones(ops) {
  const celda = (v) => {
    const t = String(v ?? '');
    return /[;"\n\r]/.test(t) || /^[=+\-@]/.test(t) ? `"${t.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : t;
  };
  const cab = ['id', ...CAMPOS, 'dias_hasta_vender'];
  const filas = ops.map((o) => [...['id', ...CAMPOS].map((k) => o[k]), dias(o.fecha_alta, o.fecha_venta) ?? ''].map(celda).join(';'));
  return `﻿${[cab.join(';'), ...filas].join('\r\n')}\r\n`;
}

export function paginaOperacion(o, { aviso = '', error = '', tienda = 'https://sidonia.es' } = {}) {
  const v = o || { estado: 'en_venta', modalidad: 'gestion', tipo: 'coche' };
  const campo = (k, etiqueta, tipo = 'text', extra = '') => `<label>${etiqueta}<input name="${k}" type="${tipo}" value="${esc(v[k] ?? '')}"${extra}></label>`;
  const select = (k, etiqueta, opciones) => `<label>${etiqueta}<select name="${k}">${Object.entries(opciones).map(([a, b]) => `<option value="${a}"${v[k] === a ? ' selected' : ''}>${b}</option>`).join('')}</select></label>`;
  const pct = n(v.comision) && n(v.precio_venta ?? v.precio_anunciado) ? ((v.comision / (v.precio_venta ?? v.precio_anunciado)) * 100).toFixed(2) : '';
  return marco(v.titulo || 'Nueva venta', 'ventas', `
<p><a href="?estado=ventas">‹ Ventas</a></p>
${aviso ? `<p class="aviso${/^Error/.test(aviso) ? ' mal' : ''}">${esc(aviso)}</p>` : ''}${errorSql(error)}
<form class="op" method="post" action="?estado=operacion${v.id ? `&id=${v.id}` : ''}">
  <fieldset><legend>El vehículo</legend>
    <label class="ancho">Título<input name="titulo" required value="${esc(v.titulo || '')}" placeholder="PORSCHE 911 CARRERA 3.2 COUPÉ 1986"></label>
    ${select('tipo', 'Tipo', TIPOS_OP)}${select('modalidad', 'Modalidad', MODALIDADES)}${select('estado', 'Estado', ESTADOS_OP)}
    <label>Ficha en la tienda (handle)<input name="handle" value="${esc(v.handle || '')}" placeholder="porsche-911-carrera-3-2-1986">${v.handle ? `<small><a href="${esc(tienda)}/products/${esc(v.handle)}" target="_blank" rel="noopener">Ver ficha</a> · <a href="?estado=anuncio&h=${encodeURIComponent(v.handle)}">Quién está interesado</a></small>` : ''}</label>
  </fieldset>
  <fieldset><legend>Propietario</legend>
    ${campo('propietario_nombre', 'Nombre')}${campo('propietario_telefono', 'Teléfono', 'tel')}${campo('propietario_email', 'Email', 'email')}
  </fieldset>
  <fieldset><legend>Comprador</legend>
    ${campo('comprador_nombre', 'Nombre')}${campo('comprador_telefono', 'Teléfono', 'tel')}${campo('comprador_email', 'Email', 'email')}
  </fieldset>
  <fieldset><legend>Dinero</legend>
    ${campo('precio_anunciado', 'Precio de salida (€)', 'number', ' step="any" min="0"')}${campo('precio_venta', 'Precio de venta (€)', 'number', ' step="any" min="0"')}
    ${campo('comision', 'Comisión Sidonia (€)', 'number', ' step="any" min="0"')}
    <label>o la comisión en %<input name="comision_pct" type="number" step="any" min="0" max="100" value="${esc(pct)}" placeholder="6"><small>Si pones el %, se calcula el importe con el precio de venta (o el de salida).</small></label>
    ${campo('comercial', 'Comercial', 'text', ` placeholder="${COMERCIAL}"`)}
    ${campo('comision_comercial', 'Comisión del comercial (€)', 'number', ' step="any" min="0"')}
    <label>% del comercial sobre la comisión de Sidonia<input name="comercial_pct" type="number" step="any" min="0" max="100" value="${esc(pctComercial(v) != null ? pctComercial(v).toFixed(2) : '')}" placeholder="25"><small>Su parte del beneficio: con un 25 %, de cada 1.000 € de comisión se lleva 250 €.</small></label>
  </fieldset>
  <fieldset><legend>Fechas</legend>
    ${campo('fecha_alta', 'Se anunció', 'date')}${campo('fecha_venta', 'Se vendió', 'date')}
    <label class="ancho">Notas<textarea name="notas" rows="3">${esc(v.notas || '')}</textarea></label>
  </fieldset>
  <script>
    // Al cambiar un %, se calcula el importe (y al revés)
    (() => {
      const f = document.currentScript.closest('form');
      const num = (x) => parseFloat(String(f[x].value).replace(',', '.')) || 0;
      const base = () => num('precio_venta') || num('precio_anunciado');
      const r2 = (x) => (Math.round(x * 100) / 100).toString();
      f.comision_pct.addEventListener('input', () => { if (base() && num('comision_pct')) f.comision.value = r2(base() * num('comision_pct') / 100); f.comercial_pct.dispatchEvent(new Event('input')); });
      f.comision.addEventListener('input', () => { if (base()) f.comision_pct.value = num('comision') ? r2(num('comision') / base() * 100) : ''; if (num('comercial_pct')) f.comision_comercial.value = r2(num('comision') * num('comercial_pct') / 100); });
      f.comercial_pct.addEventListener('input', () => { if (num('comision') && f.comercial_pct.value !== '') f.comision_comercial.value = r2(num('comision') * num('comercial_pct') / 100); });
      f.comision_comercial.addEventListener('input', () => { f.comercial_pct.value = num('comision') && num('comision_comercial') ? r2(num('comision_comercial') / num('comision') * 100) : ''; });
    })();
  </script>
  <div class="acc"><button class="boton" name="accion" value="guardar">Guardar</button>
    ${v.id ? '<button class="boton rojo" name="accion" value="borrar" onclick="return confirm(\'¿Borrar esta venta del panel?\')">Borrar</button>' : ''}
    <a class="boton claro" href="?estado=ventas">Cancelar</a></div>
</form>`);
}

/** Lo que llega del formulario, limpio. { cambios } o { error } */
export function leerOperacion(body) {
  const c = {};
  for (const k of CAMPOS) {
    if (!(k in body)) continue;
    let v = String(body[k] ?? '').trim();
    if (NUMEROS.includes(k)) v = v === '' ? null : numero(v);
    else if (FECHAS.includes(k)) v = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    else v = v === '' ? null : v.slice(0, k === 'notas' ? 4000 : 200);
    c[k] = v;
  }
  if (!c.titulo) return { error: 'Falta el título.' };
  if (c.tipo && !TIPOS_OP[c.tipo]) c.tipo = 'otro';
  if (c.estado && !ESTADOS_OP[c.estado]) return { error: 'Estado no válido.' };
  if (c.modalidad && !MODALIDADES[c.modalidad]) c.modalidad = 'gestion';
  if (c.handle) c.handle = c.handle.replace(/^.*\/products\//, '').replace(/[?#].*$/, '').toLowerCase();
  const pct = numero(body.comision_pct);
  const base = c.precio_venta ?? c.precio_anunciado;
  if ((c.comision == null) && pct != null && pct > 0 && base) c.comision = redondo((base * pct) / 100);
  const pctCom = numero(body.comercial_pct);
  if (c.comision_comercial == null && pctCom != null && pctCom > 0 && c.comision) c.comision_comercial = redondo((c.comision * pctCom) / 100);
  if (c.comision_comercial && !c.comercial) c.comercial = COMERCIAL;
  if (c.estado === 'vendido' && !c.fecha_venta && body.fecha_venta === undefined) c.fecha_venta = new Date().toISOString().slice(0, 10);
  return { cambios: c };
}

export function paginaImportar({ ops = null, archivo = '', nombre = '', aviso = '', existentes = 0 } = {}) {
  const vista = ops ? `<div class="card"><h2>Esto es lo que hay en «${esc(nombre)}»</h2>
    <p>${fmt(ops.length)} filas: ${fmt(ops.filter((o) => o.estado === 'vendido').length)} vendidas, ${fmt(ops.filter((o) => o.estado === 'en_venta').length)} en venta, ${fmt(ops.filter((o) => o.estado === 'captacion').length)} en captación y ${fmt(ops.filter((o) => o.modalidad === 'encargo').length)} encargos.
    ${existentes ? `${fmt(existentes)} ya estaban de una importación anterior: se ponen al día (precio, comisión y estado), sin tocar lo que hayáis añadido a mano.` : ''}</p>
    <div class="tabla"><table><thead><tr><th class="izq">Fila</th><th class="izq">Título</th><th class="izq">Estado</th><th>Precio</th><th>Comisión</th><th>Comercial</th><th class="izq">Notas</th></tr></thead><tbody>
    ${ops.map((o) => `<tr><td class="izq"><span class="sub">${esc(o.fila)}</span></td><td class="izq">${esc(o.titulo)}<span class="sub">${esc(TIPOS_OP[o.tipo])} · ${esc(MODALIDADES[o.modalidad])}${o.propietario_nombre ? ` · de ${esc(o.propietario_nombre)}` : ''}</span></td><td class="izq">${pill(o.estado)}</td><td>${euros(o.precio_venta ?? o.precio_anunciado)}</td><td>${euros(o.comision)}</td><td>${euros(o.comision_comercial)}</td><td class="izq"><span class="sub">${esc(o.notas || '')}</span></td></tr>`).join('')}
    </tbody></table></div>
    <form method="post" action="?estado=importar" style="margin-top:14px"><input type="hidden" name="archivo" value="${esc(archivo)}"><input type="hidden" name="nombre" value="${esc(nombre)}">
      <label style="display:flex;gap:8px;align-items:center;margin:0 0 12px;font-size:14px"><input type="checkbox" name="enlazar" value="1" checked> Enlazar cada uno con su ficha de la tienda (y sacar la fecha en que se anunció)</label>
      <button class="boton" name="accion" value="importar">Importar ${fmt(ops.length)} filas</button> <a class="boton claro" href="?estado=importar">Elegir otro archivo</a></form></div>` : '';
  return marco('Importar Excel', 'ventas', `
<p><a href="?estado=ventas">‹ Ventas</a></p>
${aviso ? `<p class="aviso${/^Error/.test(aviso) ? ' mal' : ''}">${esc(aviso)}</p>` : ''}
${ops ? '' : `<div class="card"><h2>Importar el Excel de ventas</h2>
  <p>Sube el Excel (.xlsx). Se leen todas las hojas, también las ocultas: cada tabla con una columna de coche o modelo y otra de precio (y, si las tiene, comisión de Sidonia, comisión del comercial y «VENDIDO»). Las tablas que van debajo de «Encargos…» entran como encargos, y una hoja «Colección Arturo» como coches de Arturo en captación. Antes de importar ves lo que hay. Se puede repetir: lo que ya está se pone al día.</p>
  <form method="post" action="?estado=importar" id="sube"><input type="hidden" name="archivo"><input type="hidden" name="nombre">
    <input type="file" accept=".xlsx" required onchange="const f=this.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{const fo=document.getElementById('sube');fo.archivo.value=String(r.result).split(',')[1];fo.nombre.value=f.name;fo.querySelector('button').disabled=false};r.readAsDataURL(f)">
    <button class="boton" name="accion" value="ver" disabled>Ver qué hay</button></form></div>`}
${vista}`);
}

/* ---------------------------------------------------------------------------- Propietarios */
const digitos = (t) => String(t || '').replace(/\D/g, '').replace(/^34(?=\d{9}$)/, '');
const ESTADO_ANUNCIO = { pendiente: 'Por revisar', aprobado: 'Aprobado', publicado: 'Publicado', vendido: 'Vendido', rechazado: 'Rechazado', retirado: 'Retirado' };

/** Junta a los propietarios de las ventas y de los anuncios gratis (por email, teléfono o nombre) */
export function propietarios(ops, anuncios) {
  const grupos = new Map();
  const clave = (email, tel, nombre) => (email ? `e:${String(email).toLowerCase()}` : digitos(tel) ? `t:${digitos(tel)}` : nombre ? `n:${normal(nombre)}` : '');
  const meter = (k, dato, cosa) => {
    if (!k) return;
    const g = grupos.get(k) || { nombre: '', email: '', telefono: '', tipo: new Set(), cosas: [], vendidos: 0, facturado: 0, ultima: '' };
    g.nombre ||= dato.nombre || ''; g.email ||= dato.email || ''; g.telefono ||= dato.telefono || '';
    g.tipo.add(cosa.origen); g.cosas.push(cosa);
    if (cosa.vendido) { g.vendidos += 1; g.facturado += n(cosa.precio); }
    if (String(cosa.fecha || '') > g.ultima) g.ultima = String(cosa.fecha || '');
    grupos.set(k, g);
  };
  for (const o of ops) {
    meter(clave(o.propietario_email, o.propietario_telefono, o.propietario_nombre), { nombre: o.propietario_nombre, email: o.propietario_email, telefono: o.propietario_telefono },
      { origen: 'Venta gestionada', titulo: o.titulo, estado: ESTADOS_OP[o.estado] || o.estado, clase: o.estado, enlace: `?estado=operacion&id=${o.id}`, vendido: o.estado === 'vendido', precio: o.precio_venta ?? o.precio_anunciado, fecha: o.fecha_venta || o.fecha_alta || o.creado });
  }
  for (const a of anuncios) {
    meter(clave(a.email, a.telefono, a.vendedor_nombre), { nombre: a.vendedor_nombre, email: a.email, telefono: a.telefono },
      { origen: a.vendedor_tipo === 'profesional' ? 'Anuncio (profesional)' : 'Anuncio gratis', titulo: a.titulo, estado: ESTADO_ANUNCIO[a.estado] || a.estado, clase: a.estado === 'publicado' ? 'en_venta' : a.estado === 'vendido' ? 'vendido' : a.estado === 'pendiente' ? 'captacion' : 'retirado', enlace: `?estado=${a.estado === 'rechazado' || a.estado === 'retirado' ? 'cancelados' : a.estado}#a${a.id}`, vendido: a.estado === 'vendido', precio: a.precio, fecha: a.creado });
  }
  return [...grupos.values()].map((g) => ({ ...g, tipo: [...g.tipo] })).sort((a, b) => b.ultima.localeCompare(a.ultima));
}

export function paginaPropietarios(lista, { error = '' } = {}) {
  const wa = (t) => (digitos(t) ? `https://wa.me/34${digitos(t)}` : '');
  const filas = lista.map((p) => `<tr data-q="${esc(normal(`${p.nombre} ${p.email} ${p.telefono} ${p.cosas.map((c) => c.titulo).join(' ')}`))}">
    <td class="izq"><b>${esc(p.nombre || '—')}</b>${p.email ? `<a class="sub" href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}${p.telefono ? `<a class="sub" href="${esc(wa(p.telefono))}" target="_blank" rel="noopener">${esc(p.telefono)} · WhatsApp</a>` : ''}</td>
    <td class="izq">${p.tipo.map((t) => `<span class="sub">${esc(t)}</span>`).join('')}</td>
    <td class="izq">${p.cosas.map((c) => `<div style="margin:0 0 4px"><a href="${c.enlace}">${esc(c.titulo)}</a> <span class="pill ${esc(c.clase)}">${esc(c.estado)}</span></div>`).join('')}</td>
    <td>${fmt(p.vendidos)}</td><td>${p.facturado ? euros(p.facturado) : '—'}</td></tr>`).join('');
  return marco('Propietarios', 'duenos', `
${error ? `<p class="aviso mal">${esc(error)}</p>` : ''}
<div class="kpis">
  <div class="kpi"><b>${fmt(lista.length)}</b><span>Propietarios</span><small>de ventas gestionadas y anuncios</small></div>
  <div class="kpi"><b>${fmt(lista.filter((p) => p.tipo.includes('Venta gestionada')).length)}</b><span>Con venta gestionada</span></div>
  <div class="kpi"><b>${fmt(lista.filter((p) => p.tipo.some((t) => t.startsWith('Anuncio'))).length)}</b><span>Con anuncio en Sidonia</span></div>
  <div class="kpi"><b>${fmt(lista.filter((p) => p.cosas.length > 1).length)}</b><span>Repiten</span><small>más de un vehículo</small></div>
</div>
<div class="barra"><input type="search" placeholder="Buscar propietario, teléfono o coche…" oninput="const q=this.value.trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');document.querySelectorAll('tr[data-q]').forEach((tr)=>{tr.hidden=q&&!tr.dataset.q.includes(q)})"></div>
<div class="card"><div class="tabla"><table>
  <thead><tr><th class="izq">Propietario</th><th class="izq">Cómo vende</th><th class="izq">Sus vehículos</th><th>Vendidos</th><th>Vendido por</th></tr></thead>
  <tbody>${filas || '<tr><td colspan="5" class="vacio">Aún no hay propietarios: ponlos en cada venta (Ventas › la venta › Propietario) o llegarán con los anuncios gratis.</td></tr>'}</tbody>
</table></div></div>
<p class="nota">Junta a la misma persona por su email, su teléfono o su nombre. Los de las ventas se ponen en Ventas (cada venta tiene su propietario); los de los anuncios gratis vienen del formulario «Anuncia gratis».</p>`);
}

/* ---------------------------------------------------------------------------- Rutas del panel */
const ordenar = (ops) => ops.sort((a, b) => {
  const peso = { en_venta: 0, reservado: 0, captacion: 1, vendido: 2, retirado: 3 };
  return (peso[a.estado] ?? 4) - (peso[b.estado] ?? 4) || String(b.fecha_venta || b.fecha_alta || b.creado || '').localeCompare(String(a.fecha_venta || a.fecha_alta || a.creado || '')) || b.id - a.id;
});

/** Enlaza con la tienda las que no tienen ficha. Devuelve cuántas */
async function enlazar(cfg, deps, t, ops) {
  const gql = deps.gql || shopifyAdmin(cfg, deps.fetch);
  const pares = emparejar(ops, await productosTienda(gql));
  for (const p of pares) await t.cambiar(p.id, { ...p.cambios, actualizado: new Date().toISOString() });
  return pares.length;
}

/** Importa: crea las nuevas y pone al día las de antes (por su referencia del Excel), sin tocar lo puesto a mano */
export async function importar(t, nuevas, existentes) {
  const porRef = new Map(existentes.filter((o) => o.ref).map((o) => [o.ref, o]));
  let creadas = 0, puestas = 0;
  for (const o of nuevas) {
    const { fila, ...datos } = o;
    const ya = porRef.get(o.ref);
    if (ya) {
      const cambios = {};
      for (const k of ['estado', 'precio_anunciado', 'precio_venta', 'comision', 'comision_comercial']) if (datos[k] != null && datos[k] !== ya[k]) cambios[k] = datos[k];
      for (const k of ['propietario_nombre', 'comprador_nombre', 'notas', 'comercial']) if (datos[k] && !ya[k]) cambios[k] = datos[k];
      if (Object.keys(cambios).length) { await t.cambiar(ya.id, { ...cambios, actualizado: new Date().toISOString() }); puestas += 1; }
    } else {
      await t.guardar({ ...datos, origen: 'excel' }, 'id');
      creadas += 1;
    }
  }
  return { creadas, puestas };
}

export async function rutasOperaciones(req, cfg, deps, html) {
  const estado = req.query.estado || 'ventas';
  const t = tabla(cfg, deps);
  const leerTodas = async () => ordenar(await t.leer('select=*&order=id.desc&limit=5000'));

  if (estado === 'importar') {
    const b = req.body || {};
    if (req.method !== 'POST' || !b.archivo) return html(paginaImportar({}));
    let ops;
    try {
      ops = detectarOperaciones(leerXlsx(Buffer.from(String(b.archivo), 'base64')));
    } catch (e) {
      return html(paginaImportar({ aviso: `Error: no se ha podido leer el Excel (${e.message}).` }));
    }
    if (!ops.length) return html(paginaImportar({ aviso: 'Error: no he encontrado ninguna tabla con «Coche/Modelo» y «Precio» en ese Excel.' }));
    let existentes = [];
    try { existentes = await t.leer('select=id,ref,estado,precio_anunciado,precio_venta,comision,comision_comercial,comercial,propietario_nombre,comprador_nombre,notas&limit=5000'); } catch (e) {
      return html(paginaImportar({ aviso: `Error: ${/operaciones|relation|schema/.test(e.message) ? 'falta ejecutar sql/operaciones.sql en Supabase › SQL Editor.' : e.message}` }));
    }
    if (b.accion !== 'importar') {
      const refs = new Set(existentes.map((o) => o.ref));
      return html(paginaImportar({ ops, archivo: b.archivo, nombre: b.nombre, existentes: ops.filter((o) => refs.has(o.ref)).length }));
    }
    const { creadas, puestas } = await importar(t, ops, existentes);
    let enlazadas = 0, nota = '';
    if (b.enlazar) {
      try { enlazadas = await enlazar(cfg, deps, t, await leerTodas()); } catch (e) { nota = ` No se ha podido enlazar con la tienda (${e.message}).`; }
    }
    return html(paginaVentas(await leerTodas(), { aviso: `Importado: ${fmt(creadas)} nuevas y ${fmt(puestas)} puestas al día.${b.enlazar ? ` ${fmt(enlazadas)} enlazadas con su ficha.` : ''}${nota}`, tienda: cfg.tienda, tareas: deps.tareas }));
  }

  if (estado === 'operacion') {
    const id = Number(req.query.id) || null;
    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.accion === 'borrar' && id) {
        await t.borrar(`id=eq.${id}`);
        return html(paginaVentas(await leerTodas(), { aviso: 'Borrada.', tienda: cfg.tienda, tareas: deps.tareas }));
      }
      const { cambios, error } = leerOperacion(b);
      if (error) return html(paginaOperacion({ ...b, id }, { aviso: `Error: ${error}`, tienda: cfg.tienda }));
      try {
        if (id) await t.cambiar(id, { ...cambios, actualizado: new Date().toISOString() });
        else await t.guardar({ ...cambios, origen: 'panel' }, 'id');
      } catch (e) {
        return html(paginaOperacion({ ...cambios, id }, { error: e.message, tienda: cfg.tienda }));
      }
      return html(paginaVentas(await leerTodas(), { aviso: `Guardado: ${cambios.titulo}.`, tienda: cfg.tienda, tareas: deps.tareas }));
    }
    let o = null, error = '';
    if (id) {
      try { o = (await t.leer(`id=eq.${id}&select=*`))[0] || null; } catch (e) { error = e.message; }
    }
    return html(paginaOperacion(o, { error, tienda: cfg.tienda }));
  }

  if (estado === 'duenos') {
    let ops = [], anuncios = [], error = '';
    try { ops = await t.leer('select=*&limit=5000'); } catch (e) { error = 'Las ventas aún no están: ejecuta sql/operaciones.sql en Supabase › SQL Editor.'; }
    try { anuncios = await (deps.tabla || tablaAnuncios(cfg, deps.fetch)).leer('select=id,tipo,titulo,precio,estado,vendedor_nombre,vendedor_tipo,telefono,email,creado&order=creado.desc&limit=5000'); } catch (e) { error ||= e.message; }
    return html(paginaPropietarios(propietarios(ops, anuncios), { error }));
  }

  // Ventas
  let ops = [], error = '', aviso = '';
  if (req.method === 'POST' && req.body?.accion === 'enlazar') {
    try { aviso = `Enlazadas con su ficha: ${fmt(await enlazar(cfg, deps, t, await leerTodas()))}.`; } catch (e) { aviso = `Error: ${e.message}`; }
  }
  try { ops = await leerTodas(); } catch (e) { error = e.message; }
  if (req.query.csv) return { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="ventas-sidonia.csv"', 'Cache-Control': 'no-store' }, body: csvOperaciones(ops) };
  const ver = ['todo', 'en_venta', 'vendido', 'captacion', 'encargo', 'retirado'].includes(req.query.ver) ? req.query.ver : 'todo';
  return html(paginaVentas(ops, { ver, aviso, error, tienda: cfg.tienda, tareas: deps.tareas }));
}
