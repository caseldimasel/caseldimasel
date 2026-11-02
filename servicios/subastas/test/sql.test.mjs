// Pruebas del motor contra un PostgreSQL de verdad (las funciones de sql/esquema.sql).
// Se ejecutan si hay PGTEST con los datos de conexión de psql, por ejemplo: PGTEST="-h /var/tmp/sidonia-pg -p 5499 -U postgres"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONN = process.env.PGTEST;
const skip = !CONN && 'sin PGTEST (base de datos de pruebas)';
const DB = 'sidonia_test';
const args = (db) => [...CONN.split(/\s+/), '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'];
const psql = (sql, db = DB) => execFileSync('psql', [...args(db), '-c', sql], { encoding: 'utf8' }).trim();
const json = (sql) => JSON.parse(psql(`select (${sql})::text`));
const pujar = (h, c, imp, tipo = 'directa', intento = null) =>
  json(`sidonia_pujar('${h}', '${c}', ${imp}, '${tipo}', ${intento ? `'${intento}'` : 'null'})`);
const estado = (h, c = null) => json(`sidonia_estado_uno('${h}', ${c ? `'${c}'` : 'null'})`);

test('motor de subastas', { skip }, async (t) => {
  psql(`drop database if exists ${DB}`, 'postgres');
  psql(`create database ${DB}`, 'postgres');
  execFileSync('psql', [...args(DB), '-f', fileURLToPath(new URL('../sql/esquema.sql', import.meta.url))], { encoding: 'utf8' });
  psql(`insert into pujadores (cliente, alias, registrado, tarjeta) values
          ('a', 'ana', true, 'Visa •••• 4242'), ('b', 'beto', true, null), ('c', 'carla', true, null), ('d', 'dani', false, null);
        insert into subastas (handle, titulo, estado, inicio, fin, salida, reserva)
          values ('porsche', 'Porsche 912', 'en_directo', now() - interval '1 day', now() + interval '1 day', 10000, 15000);`);

  await t.test('solo pujan los registrados', () => {
    assert.equal(pujar('porsche', 'd', 10000).error, 'registro');
  });

  await t.test('puja mínima: la salida y luego por tramos', () => {
    assert.equal(pujar('porsche', 'a', 9000).error, 'minimo');
    const r = pujar('porsche', 'a', 10000);
    assert.equal(r.ok, true);
    assert.equal(r.subasta.puja, 10000);
    assert.equal(r.subasta.lider_eres_tu, true);
    assert.equal(pujar('porsche', 'b', 10050).error, 'minimo');
  });

  await t.test('puja máxima: pone lo justo para ir ganando', () => {
    const r = pujar('porsche', 'b', 13000, 'maxima');
    assert.equal(r.ok, true);
    assert.equal(r.subasta.puja, 10100);
    assert.equal(r.subasta.tu.maxima, 13000);
    assert.equal(estado('porsche', 'a').tu.maxima, null, 'nadie ve la máxima de otro');
  });

  await t.test('la máxima responde sola a una puja directa más baja', () => {
    const r = pujar('porsche', 'c', 11000);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'superado');
    assert.equal(r.subasta.puja, 11100);
    assert.equal(r.subasta.historial[0].auto, true);
    assert.equal(r.subasta.historial[1].u, 'tú');
  });

  await t.test('empate de máximas: gana la que llegó antes', () => {
    const r = pujar('porsche', 'c', 13000, 'maxima');
    assert.equal(r.error, 'superado');
    assert.equal(r.subasta.puja, 13000);
    assert.equal(estado('porsche', 'b').lider_eres_tu, true);
  });

  await t.test('una máxima mayor pasa delante y sube lo justo', () => {
    const r = pujar('porsche', 'a', 20000, 'maxima');
    assert.equal(r.ok, true);
    assert.equal(r.subasta.puja, 13100);
    assert.equal(r.subasta.reserva_ok, false);
    assert.equal(pujar('porsche', 'a', 25000, 'maxima').subasta.puja, 13100, 'subir tu máximo no sube la puja');
    assert.equal(pujar('porsche', 'a', 24000, 'maxima').error, 'minimo', 'no se puede bajar el máximo');
  });

  await t.test('una puja repetida (mismo intento) no cuenta dos veces', () => {
    const r1 = pujar('porsche', 'b', 14000, 'directa', 'intento-1');
    assert.equal(r1.error, 'superado');
    const antes = estado('porsche').pujas;
    const r2 = pujar('porsche', 'b', 14000, 'directa', 'intento-1');
    assert.equal(r2.repetida, true);
    assert.equal(estado('porsche').pujas, antes);
  });

  await t.test('la reserva es secreta y se marca al alcanzarla', () => {
    const r = estado('porsche', 'b');
    assert.equal('reserva' in r, false);
    assert.equal(r.reserva_ok, false);
  });

  await t.test('cierre suave: una puja al final devuelve el reloj a 2 minutos', () => {
    psql(`update subastas set fin = now() + interval '30 seconds' where handle = 'porsche'`);
    const r = pujar('porsche', 'b', 30000);
    assert.equal(r.ok, true);
    assert.equal(r.subasta.reserva_ok, true);
    const quedan = (Date.parse(r.subasta.fin) - Date.now()) / 1000;
    assert.ok(quedan > 100 && quedan <= 121, `quedan ${quedan} s`);
    assert.ok(r.subasta.historial.some((p) => p.importe === 25000 && p.auto), 'la máxima de ana queda apuntada');
  });

  await t.test('al terminar: vendida, con ganador, y ya no se puede pujar', () => {
    psql(`update subastas set fin = now() - interval '1 second' where handle = 'porsche'`);
    const e = json(`sidonia_estado(array['porsche'], 'b')`).subastas[0];
    assert.equal(e.estado, 'vendida');
    assert.equal(e.ganador, 'beto');
    assert.equal(e.lider_eres_tu, true);
    assert.equal(pujar('porsche', 'c', 40000).error, 'cerrada');
  });

  await t.test('sin llegar a la reserva: reserva_no_alcanzada', () => {
    psql(`insert into subastas (handle, estado, inicio, fin, salida, reserva) values ('barco', 'en_directo', now() - interval '1 day', now() + interval '1 hour', 50000, 90000)`);
    pujar('barco', 'a', 50000);
    psql(`update subastas set fin = now() - interval '1 second' where handle = 'barco'`);
    assert.equal(json(`sidonia_estado(array['barco'])`).subastas[0].estado, 'reserva_no_alcanzada');
  });

  await t.test('comentarios y seguidores', () => {
    assert.equal(json(`sidonia_comentar('porsche', 'c', '¿Tiene el libro de mantenimiento?')`).ok, true);
    const e = json(`sidonia_seguir('porsche', 'c', true)`).subasta;
    assert.equal(e.seguidores, 1);
    assert.equal(e.comentarios.at(-1).u, 'tú');
    assert.equal(e.tu.sigues, true);
  });

  await t.test('registro: nombre único, y puede pujar cuando Stripe guarda la tarjeta', () => {
    assert.equal(json(`sidonia_registrar('e', 'ab', null)`).error, 'alias');
    assert.equal(json(`sidonia_registrar('e', 'ANA', null)`).error, 'alias_ocupado');
    assert.equal(json(`sidonia_registrar('e', 'elena<script>', 'e@x.es')`).pujador.alias, 'elenascript');
    assert.equal(pujar('barco', 'e', 1).error, 'registro');
    assert.equal(json(`sidonia_registro_ok('e', 'Visa •••• 4242', 'cus_1')`).ok, true);
    assert.equal(json(`sidonia_pujador('e')`).registrado, true);
  });

  await t.test('sincronizar desde Shopify: crea, pone al día y no deja que una página vieja deshaga', () => {
    const sinc = (v, salida, reserva, fin = "now() + interval '2 days'", inicio = 'now()') =>
      json(`sidonia_sincronizar('vanette', 'Nissan Vanette', ${inicio}, ${fin}, ${salida}, ${reserva}, ${v})`);
    let r = sinc(10, 750, 1500);
    assert.equal(r.ok, true);
    assert.equal(r.subasta.estado, 'en_directo');
    assert.equal(r.subasta.salida, 750);
    assert.equal('reserva' in r.subasta, false);
    assert.equal(sinc(20, 900, 'null').subasta.sin_reserva, true, 'sin pujas, se cambia todo');
    assert.equal(sinc(15, 500, 1500).subasta.salida, 900, 'una versión vieja no pisa');
    assert.equal(pujar('vanette', 'a', 900).ok, true);
    r = sinc(30, 100, 2000, "now() + interval '5 days'");
    assert.equal(r.subasta.salida, 900, 'con pujas no cambia la salida');
    assert.equal(r.subasta.reserva_ok, false, 'pero sí la reserva');
    assert.equal(sinc(40, 0, 'null').error, 'datos');
  });

  await t.test('cien pujas a la vez: ninguna se pisa', async () => {
    psql(`insert into subastas (handle, estado, inicio, fin, salida) values ('casa', 'en_directo', now() - interval '1 day', now() + interval '1 day', 100000);
          insert into pujadores (cliente, alias, registrado) select 'p' || g, 'p' || g, true from generate_series(1, 100) g;`);
    const una = (i) => new Promise((ok) => {
      // Cada uno puja la mínima que ve en ese momento: muchas llegarán tarde («minimo»)
      const sql = `select (sidonia_pujar('casa', 'p${i}', sidonia_minima(s), 'directa', 'x${i}'))->>'ok' from subastas s where handle = 'casa'`;
      execFile('psql', [...args(DB), '-c', sql], (err, out) => ok(err ? 'error' : out.trim()));
    });
    const res = await Promise.all(Array.from({ length: 100 }, (_, i) => una(i + 1)));
    assert.ok(!res.includes('error'), 'ninguna puja da error de base de datos');
    const aceptadas = res.filter((r) => r === 'true').length;
    const e = estado('casa');
    assert.equal(e.pujas, aceptadas);
    const importes = psql(`select string_agg(importe::text, ',' order by id) from pujas where handle = 'casa'`).split(',').map(Number);
    importes.forEach((v, i) => { if (i) assert.ok(v > importes[i - 1], `la puja ${i} (${v}) no supera a la anterior (${importes[i - 1]})`); });
    assert.equal(e.puja, importes.at(-1));
  });
});
