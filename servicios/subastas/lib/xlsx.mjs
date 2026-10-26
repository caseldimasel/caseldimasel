/* SIDONIA · Leer un Excel (.xlsx) sin dependencias: un .xlsx es un zip con XML dentro.
 * leerXlsx(buffer) → [{ nombre, oculta, filas: [[celda, …], …] }] con los valores ya calculados (lo que se ve en Excel).
 */
import { inflateRawSync } from 'node:zlib';

/** Los ficheros de un zip: { nombre: Buffer } (solo «guardado» y «deflate», que es lo que usa Excel) */
export function leerZip(buf) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('No es un archivo .xlsx (zip) válido');
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const out = {};
  for (let k = 0; k < total; k += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Zip dañado');
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const largoNombre = buf.readUInt16LE(p + 28), largoExtra = buf.readUInt16LE(p + 30), largoComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + largoNombre);
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const datos = buf.subarray(ini, ini + comprimido);
    if (metodo === 0) out[nombre] = datos;
    else if (metodo === 8) out[nombre] = inflateRawSync(datos);
    p += 46 + largoNombre + largoExtra + largoComent;
  }
  return out;
}

const ent = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const textoDe = (xml) => ent([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
const attr = (tag, nombre) => (tag.match(new RegExp(`\\s${nombre}="([^"]*)"`)) || [])[1];

/** «AB12» → índice de columna (0 = A) */
export const columna = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

export function leerXlsx(buf) {
  const z = leerZip(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  const s = (n) => (z[n] ? z[n].toString('utf8') : '');
  const compartidos = [...s('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1]));
  const rels = Object.fromEntries([...s('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const hojas = [...s('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    nombre: ent(attr(m[0], 'name') || ''), oculta: /hidden/.test(attr(m[0], 'state') || ''),
    ruta: `xl/${String(rels[attr(m[0], 'r:id')] || '').replace(/^\/?xl\//, '')}`
  }));
  return hojas.map((h) => {
    const filas = [];
    for (const fm of s(h.ruta).matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = Number(attr(fm[1], 'r')) - 1;
      const fila = [];
      for (const cm of (fm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], 'r'), tipo = attr(cm[1], 't');
        const v = ((cm[2] || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = '';
        if (tipo === 's') val = compartidos[Number(v)] ?? '';
        else if (tipo === 'inlineStr') val = textoDe(cm[2] || '');
        else if (tipo === 'str' || tipo === 'e') val = ent(v || '');
        else if (tipo === 'b') val = v === '1';
        else if (v !== undefined && v !== '') val = Number(v);
        fila[ref ? columna(ref) : fila.length] = val;
      }
      filas[r] = Array.from(fila, (x) => x ?? '');
    }
    return { nombre: h.nombre, oculta: h.oculta, filas: Array.from(filas, (x) => x || []) };
  });
}
