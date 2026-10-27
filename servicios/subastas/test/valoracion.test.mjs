import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { atender, config } from '../lib/motor.mjs';
import { cajaValoracion, comparablesSidonia, dondeQueda, entradaDe, huella, leerResultado, pedido, POR_PERSONA_DIA, preguntarIa, valorar } from '../lib/valoracion.mjs';

const cfg = config({ SUBASTAS_CLAVE: 'k', ANTHROPIC_API_KEY: 'sk-test', SUPABASE_URL: 'https://x.supabase.co', TIENDA_URL: 'https://sidonia.es' });
const quien = (c = '55') => { const t = String(Math.floor(Date.now() / 1000)); return { c, ct: t, cf: createHmac('sha256', 'k').update(`${c}.${t}`).digest('hex') }; };
const coche = { tipo: 'coche', titulo: 'BMW M3 E30 1988', precio: '72.000', ubicacion: 'Madrid', resumen: 'M3 E30 en su color original.', mecanica: 'Embrague nuevo en 2023, distribución hecha. Chapa sin óxido.', historia: 'Dos dueños desde nuevo.', ficha: [['Año', '1988'], ['Kilometraje', '142.000 km'], ['Cambio', 'Manual']] };
const resultado = { minimo: 58000, maximo: 68000, recomendado: 64900, venta_rapida: 57000, confianza: 'alta', resumen: 'Un E30 M3 así se mueve entre 58 y 68 mil.', a_favor: ['Dos dueños'], en_contra: ['Kilómetros altos'], comparables: [{ titulo: 'BMW M3 E30 1987', precio: 62000, ano: '1987', km: '120.000 km', fuente: 'coches.net', url: 'https://www.coches.net/bmw-m3-1', tipo: 'anunciado', nota: 'Parecido' }, { titulo: 'Inventado', precio: 90000, url: 'https://inventado.example/x' }], mercado: 'Demanda alta.', consejo: 'Enseña las facturas.', faltan: [] };

/** Una respuesta de la API de Claude: busca, cita y acaba con el JSON */
function respuestaIa(json = resultado, extra = {}) {
  return {
    stop_reason: 'end_turn', usage: { input_tokens: 9000, output_tokens: 1500, server_tool_use: { web_search_requests: 4 } },
    content: [
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'BMW M3 E30 venta' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://www.coches.net/bmw-m3-1', title: 'BMW M3' }] },
      { type: 'text', text: 'He encontrado varios.', citations: [{ type: 'web_search_result_location', url: 'https://www.coches.net/bmw-m3-1' }] },
      { type: 'text', text: JSON.stringify(json) }
    ],
    ...extra
  };
}

function preparar({ ya = [], ops = [], respuestas = [respuestaIa()] } = {}) {
  const guardadas = [], llamadas = [];
  const tabla = {
    leer: async (f) => (f.startsWith('huella=') ? ya : f.startsWith('cliente=') ? guardadas.filter((g) => f.includes(`cliente=eq.${g.cliente}`)) : f.startsWith('origen=') ? guardadas : []),
    guardar: async (x) => { guardadas.push(x); return x; }, cambiar: async () => {}
  };
  const deps = {
    db: async () => null,
    valoraciones: tabla,
    operaciones: { leer: async () => ops },
    tabla: { leer: async () => [] },
    fetch: async (u, o) => { llamadas.push({ u, o, body: JSON.parse(o.body) }); const d = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)]; return { ok: true, status: 200, json: async () => d }; }
  };
  return { deps, guardadas, llamadas };
}

test('valoración: la petición a Claude lleva el modelo, la búsqueda web y lo que cuenta el vendedor', async () => {
  const { deps, llamadas } = preparar();
  const r = await preguntarIa(cfg, entradaDe(coche), ['- BMW M3 E30 1989: vendido en Sidonia por 66.000 €'], deps.fetch);
  const { u, o, body } = llamadas[0];
  assert.equal(u, 'https://api.anthropic.com/v1/messages');
  assert.equal(o.headers['x-api-key'], 'sk-test');
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.tools[0].type, 'web_search_20260209');
  assert.equal(body.tools[0].user_location.country, 'ES');
  assert.equal(body.fallbacks, 'default');
  assert.match(body.messages[0].content, /142\.000 km/);
  assert.match(body.messages[0].content, /Embrague nuevo/);
  assert.match(body.messages[0].content, /vendido en Sidonia por 66\.000 €/);
  assert.equal(r.resultado.recomendado, 64900);
  assert.equal(r.uso.busquedas, 4);
});

test('valoración: quita los enlaces que no ha visto en la búsqueda y ordena las cifras', () => {
  const v = leerResultado(`Aquí va: ${JSON.stringify({ ...resultado, minimo: 68000, maximo: 58000, recomendado: 99000 })}`, new Set(['https://www.coches.net/bmw-m3-1']));
  assert.deepEqual([v.minimo, v.maximo, v.recomendado], [58000, 68000, 68000]);
  assert.equal(v.comparables[0].url, 'https://www.coches.net/bmw-m3-1');
  assert.equal(v.comparables[1].url, '', 'el enlace inventado no sale');
  assert.equal(leerResultado('no sé'), null);
  assert.equal(leerResultado('{"minimo": 0, "maximo": 0}'), null);
});

test('valoración: si se alarga (pause_turn) le deja seguir con lo que lleva', async () => {
  const pausa = { stop_reason: 'pause_turn', usage: {}, content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } }] };
  const { deps, llamadas } = preparar({ respuestas: [pausa, respuestaIa()] });
  const r = await preguntarIa(cfg, entradaDe(coche), [], deps.fetch);
  assert.equal(llamadas.length, 2);
  assert.equal(llamadas[1].body.messages.at(-1).role, 'assistant');
  assert.equal(r.resultado.minimo, 58000);
});

test('valoración: sin clave o si la IA se niega, un error claro', async () => {
  await assert.rejects(preguntarIa({ ...cfg, anthropicKey: '' }, entradaDe(coche), []), (e) => e.codigo === 'sin_clave');
  const { deps } = preparar({ respuestas: [{ stop_reason: 'refusal', content: [], usage: {} }] });
  await assert.rejects(preguntarIa(cfg, entradaDe(coche), [], deps.fetch), (e) => e.codigo === 'ia');
});

test('valoración: compara con lo que Sidonia ha vendido del mismo modelo', () => {
  const ops = [
    { tipo: 'coche', titulo: 'BMW M3 E30 Sport Evolution', estado: 'vendido', precio_venta: 95000, precio_anunciado: 99000, fecha_venta: '2026-03-02' },
    { tipo: 'coche', titulo: 'Porsche 911 SC', estado: 'vendido', precio_venta: 70000 },
    { tipo: 'barco', titulo: 'BMW M3 lancha', estado: 'vendido', precio_venta: 1 }
  ];
  const l = comparablesSidonia(entradaDe(coche), ops);
  assert.equal(l.length, 1);
  assert.match(l[0], /vendido en Sidonia por 95\.000 €.*2026-03/);
  assert.match(pedido(entradaDe(coche), l), /coches\.net/);
});

test('valoración en la web: hace falta sesión, guarda la valoración y reutiliza la misma si nada cambia', async () => {
  const { deps, guardadas, llamadas } = preparar();
  const pedir = (body, q = quien()) => atender({ method: 'POST', ruta: 'api/anuncio/valorar', query: q, body, directo: true, headers: {} }, cfg, deps).then((r) => JSON.parse(r.body));
  assert.equal((await pedir(coche, {})).error, 'login');
  const r = await pedir(coche);
  assert.equal(r.ok, true);
  assert.deepEqual([r.valoracion.minimo, r.valoracion.maximo, r.valoracion.recomendado], [58000, 68000, 64900]);
  assert.equal(guardadas[0].origen, 'web');
  assert.equal(guardadas[0].cliente, '55');
  assert.equal(guardadas[0].huella, huella(entradaDe(coche)));
  // Lo mismo otra vez: la guardada, sin volver a preguntar
  const { deps: d2, llamadas: ll2 } = preparar({ ya: [{ id: 1, resultado: r.valoracion, creado: new Date().toISOString(), origen: 'web' }] });
  const r2 = JSON.parse((await atender({ method: 'POST', ruta: 'api/anuncio/valorar', query: quien(), body: { ...coche, precio: '60000' }, directo: true, headers: {} }, cfg, d2)).body);
  assert.equal(r2.valoracion.minimo, 58000);
  assert.equal(ll2.length, 0, 'cambiar solo el precio no vuelve a buscar');
  assert.equal(llamadas.length, 1);
});

test('valoración en la web: unas pocas al día por persona', async () => {
  const { deps } = preparar();
  for (let i = 0; i < POR_PERSONA_DIA; i++) assert.equal((await valorar(cfg, deps, { ...coche, titulo: `BMW M3 E30 ${1980 + i}` }, { cliente: '55', origen: 'web', limite: true })).ok, true);
  assert.equal((await valorar(cfg, deps, { ...coche, titulo: 'BMW M3 E30 otra' }, { cliente: '55', origen: 'web', limite: true })).error, 'limite');
  assert.equal((await valorar(cfg, deps, { ...coche, titulo: 'X' }, { cliente: '56' })).error, 'datos');
});

test('valoración en el panel: la horquilla, los comparables y si pide de más', () => {
  const v = { ...leerResultado(JSON.stringify(resultado)), creado: '2026-10-27T10:00:00Z', origen: 'web' };
  assert.equal(dondeQueda(80000, v), 'alto');
  assert.equal(dondeQueda(62000, v), 'bien');
  const h = cajaValoracion({ id: 9, precio: 80000, valoracion: v });
  assert.match(h, /58\.000 € – 68\.000 €/);
  assert.match(h, /Pide por encima del mercado/);
  assert.match(h, /href="https:\/\/www\.coches\.net\/bmw-m3-1"/);
  assert.match(h, /la pidió el vendedor/);
  assert.match(cajaValoracion({ id: 9 }), /Valorar con IA/);
});
