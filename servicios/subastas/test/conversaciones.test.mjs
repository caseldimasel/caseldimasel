import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cajaContactos, leerConversacion, listaConversaciones, paginaConversacionHtml, paginaConversacionesHtml, resumenContactos } from '../lib/conversaciones.mjs';

const t = (filas) => ({ async leer(f) { return /offset=([1-9])/.test(f) ? [] : filas.filter((x) => { const id = /chat_id=eq\.(\d+)/.exec(f)?.[1] || /&id=eq\.(\d+)/.exec(f)?.[1]; return !id || String(x.chat_id ?? x.id) === id; }); } });
const deps = { tablas: {
  eventos: t([
    { handle: 'porsche-944', titulo: 'Porsche 944', canal: 'whatsapp' }, { handle: 'porsche-944', titulo: 'Porsche 944', canal: 'llamar' },
    { handle: 'bmw-z3', titulo: 'BMW Z3', canal: 'chat' }, { handle: 'bmw-z3', titulo: 'BMW Z3', canal: 'llamar' }, { handle: 'bmw-z3', titulo: 'BMW Z3', canal: 'chat' }
  ]),
  anuncios: t([{ producto: 'bmw-z3' }]),
  chats: t([{ id: 7, tipo: 'venta', titulo: 'BMW Z3', dueno: '1', cliente: '2', dueno_nombre: 'Jorge', cliente_nombre: 'Ana', cliente_email: 'ana@x.es', ultimo: '¿Sigue a la venta?', actualizado: '2026-11-10T10:00:00Z', url: '/products/bmw-z3' }]),
  chat_mensajes: t([{ chat_id: 7, de: '2', texto: 'Hola, ¿sigue a la venta?', creado: '2026-11-10T09:00:00Z' }, { chat_id: 7, de: '1', texto: 'Sí, ¿quieres verlo?', creado: '2026-11-10T09:05:00Z' }])
} };

test('contactos: a Sidonia y a los dueños, conversaciones y mensajes', async () => {
  const r = await resumenContactos({}, deps, 30);
  assert.deepEqual([r.sidonia.total, r.sidonia.whatsapp, r.sidonia.llamar], [2, 1, 1]);
  assert.deepEqual([r.comunidad.total, r.comunidad.chat, r.comunidad.llamar], [3, 2, 1]);
  assert.deepEqual([r.conversaciones, r.mensajes], [1, 2]);
  assert.equal(r.coches[0].handle, 'bmw-z3');
  const h = cajaContactos(r);
  assert.match(h, /A Sidonia<\/span><b>2<\/b><small>1 WhatsApp · 1 llamadas/);
  assert.match(h, /A los dueños<\/span><b>3<\/b><small>2 por el chat · 1 llamadas/);
  assert.match(h, /Conversaciones en el chat<\/span><b>1<\/b><small>2 mensajes/);
});

test('conversaciones: la lista y leer lo que se han dicho', async () => {
  const l = await listaConversaciones({}, deps, 30);
  assert.equal(l[0].mensajes, 2);
  assert.match(paginaConversacionesHtml(l), /<b>Ana<\/b> → <b>Jorge<\/b> · BMW Z3/);
  const h = paginaConversacionHtml(await leerConversacion({}, deps, 7));
  assert.match(h, /<small>Ana · [^<]+<\/small>Hola, ¿sigue a la venta\?/);
  assert.match(h, /class="msg dueno"><small>Jorge/);
});
