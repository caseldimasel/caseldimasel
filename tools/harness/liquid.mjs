// Intérprete mínimo de Liquid para PRUEBAS del tema de Sidonia.
// No es el motor de Shopify: implementa solo lo que usa este tema (etiquetas, filtros y objetos principales)
// para poder renderizar las plantillas con datos de prueba y verificarlas en un navegador real.
// Las diferencias con el motor real se documentan en docs/09-informe-de-pruebas.md.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const NIL = null;

/* ------------------------------------------------------------ utilidades */
const isNil = (v) => v === null || v === undefined;
const truthyF = (v) => !(v === null || v === undefined || v === false);
const truthy = (v) => !(isNil(v) || v === false);
function isBlank(v) {
  if (isNil(v) || v === false) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') {
    if ('__str' in v && !v.__keep) return str(v).trim() === '';
    return Object.keys(v).length === 0 && !v.__keep;
  }
  return false;
}
function str(v) {
  if (isNil(v)) return '';
  if (Array.isArray(v)) return v.map(str).join('');
  if (typeof v === 'object') {
    if ('__str' in v) return typeof v.__str === 'function' ? v.__str() : String(v.__str);
    return '';
  }
  return String(v);
}
function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  return 0;
}

/* ------------------------------------------------------------ tokenizador */
function tokenize(src) {
  const re = /\{%(-?)([\s\S]*?)(-?)%\}|\{\{(-?)([\s\S]*?)(-?)\}\}/g;
  const tokens = [];
  let last = 0;
  let m;
  let trimNext = false;
  const pushText = (t) => {
    if (trimNext) {
      t = t.replace(/^\s+/, '');
      trimNext = false;
    }
    if (t) tokens.push({ type: 'text', value: t });
  };
  while ((m = re.exec(src))) {
    let text = src.slice(last, m.index);
    const isTag = m[0].startsWith('{%');
    const trimLeft = isTag ? m[1] === '-' : m[4] === '-';
    const trimRight = isTag ? m[3] === '-' : m[6] === '-';
    if (trimLeft) text = text.replace(/\s+$/, '');
    pushText(text);
    const line = src.slice(0, m.index).split('\n').length;
    if (isTag) tokens.push({ type: 'tag', value: m[2].trim(), line });
    else tokens.push({ type: 'output', value: m[5].trim(), line });
    trimNext = trimRight;
    last = m.index + m[0].length;
  }
  pushText(src.slice(last));
  return tokens;
}

/* ------------------------------------------------------------ expresiones */
function splitTop(s, sepRe) {
  // divide por separador fuera de comillas y paréntesis
  const out = [];
  let depth = 0;
  let q = null;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (depth === 0) {
      const rest = s.slice(i);
      const mm = sepRe.exec(rest);
      if (mm && mm.index === 0) {
        out.push(cur);
        cur = '';
        i += mm[0].length - 1;
        continue;
      }
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseVarPath(s) {
  const segs = [];
  let i = 0;
  let cur = '';
  const flush = () => {
    if (cur) segs.push({ k: cur });
    cur = '';
  };
  while (i < s.length) {
    const ch = s[i];
    if (ch === '.') {
      flush();
      i++;
    } else if (ch === '[') {
      flush();
      let depth = 1;
      let j = i + 1;
      let q = null;
      while (j < s.length && depth > 0) {
        const c = s[j];
        if (q) {
          if (c === q) q = null;
        } else if (c === '"' || c === "'") q = c;
        else if (c === '[') depth++;
        else if (c === ']') depth--;
        j++;
      }
      segs.push({ expr: parseExpr(s.slice(i + 1, j - 1)) });
      i = j;
    } else {
      cur += ch;
      i++;
    }
  }
  flush();
  return segs;
}

function parseExpr(s) {
  s = s.trim();
  let m;
  if (s === '') return { t: 'lit', v: NIL };
  if ((m = /^'([^']*)'$/.exec(s)) || (m = /^"([^"]*)"$/.exec(s))) return { t: 'lit', v: m[1] };
  if (/^-?\d+$/.test(s)) return { t: 'lit', v: parseInt(s, 10), int: true };
  if (/^-?\d+\.\d+$/.test(s)) return { t: 'lit', v: parseFloat(s), float: true };
  if (s === 'true') return { t: 'lit', v: true };
  if (s === 'false') return { t: 'lit', v: false };
  if (s === 'nil' || s === 'null') return { t: 'lit', v: NIL };
  if (s === 'blank') return { t: 'blank' };
  if (s === 'empty') return { t: 'blank' };
  if ((m = /^\((.+)\.\.(.+)\)$/.exec(s))) return { t: 'range', a: parseExpr(m[1]), b: parseExpr(m[2]) };
  return { t: 'var', path: parseVarPath(s) };
}

function parseOutput(s) {
  const parts = splitTop(s, /^\|/);
  const head = parseExpr(parts[0]);
  const filters = parts.slice(1).map((p) => {
    p = p.trim();
    const idx = p.indexOf(':');
    let name = p;
    let args = [];
    if (idx > -1 && /^[a-z_0-9]+$/.test(p.slice(0, idx).trim())) {
      name = p.slice(0, idx).trim();
      const argStr = p.slice(idx + 1);
      args = splitTop(argStr, /^,/).map((a) => {
        a = a.trim();
        const km = /^([a-z_][a-z_0-9]*)\s*:\s*([\s\S]+)$/.exec(a);
        if (km && !/^['"]/.test(a)) return { named: km[1], expr: parseExpr(km[2]) };
        return { expr: parseExpr(a) };
      });
    }
    return { name, args };
  });
  return { head, filters };
}

function parseCondition(s) {
  return parseCondList(s);
}
function parseCondList(s) {
  // tokeniza por " and " / " or " fuera de comillas
  const segs = [];
  const ops = [];
  let depth = 0;
  let q = null;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0) {
      const m = /^\s+(and|or)\s+/.exec(s.slice(i));
      if (m) {
        segs.push(cur);
        ops.push(m[1]);
        cur = '';
        i += m[0].length - 1;
        continue;
      }
    }
    cur += ch;
  }
  segs.push(cur);
  return { segs: segs.map(parseComparison), ops };
}
function parseComparison(s) {
  s = s.trim();
  // buscar operador fuera de comillas
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      continue;
    }
    const rest = s.slice(i);
    const m = /^(==|!=|<>|>=|<=|>|<)/.exec(rest) || (/^\s+contains\s+/.test(rest) ? [' contains '] : null);
    if (m && (i > 0 || m[0].trim() === 'contains')) {
      const op = m[0].trim();
      const left = s.slice(0, i);
      const right = s.slice(i + m[0].length);
      return { op, l: parseExpr(left), r: parseExpr(right) };
    }
  }
  return { op: null, l: parseExpr(s) };
}

/* ------------------------------------------------------------ contexto */
class Context {
  constructor(globals, opts = {}) {
    this.scopes = [Object.create(null)];
    this.globals = globals;
    this.overrides = opts.overrides || {};
    this.engine = opts.engine;
    this.file = opts.file || '';
    this.registers = opts.registers || { layoutNone: false };
  }
  set(k, v) {
    this.scopes[this.scopes.length - 1][k] = v;
  }
  get(k) {
    for (let i = this.scopes.length - 1; i >= 0; i--) if (k in this.scopes[i]) return this.scopes[i][k];
    if (k in this.globals) return this.globals[k];
    return undefined;
  }
}

function access(v, key, ctx, pathStr) {
  if (isNil(v)) return undefined;
  if (Array.isArray(v)) {
    if (key === 'size') return v.length;
    if (key === 'first') return v[0];
    if (key === 'last') return v[v.length - 1];
    if (typeof key === 'number') return v[key < 0 ? v.length + key : key];
    if (typeof key === 'string' && key !== 'length' && key in v) return v[key];
    return undefined;
  }
  if (typeof v === 'string') {
    if (key === 'size') return v.length;
    if (key === 'first') return v[0];
    if (key === 'last') return v[v.length - 1];
    return undefined;
  }
  if (typeof v === 'object') {
    if (pathStr && ctx && ctx.overrides[pathStr] !== undefined) return ctx.overrides[pathStr];
    if (key in v) return v[key];
    if (key === 'size') return Object.keys(v).length;
    return undefined;
  }
  return undefined;
}

function evalVar(path, ctx) {
  let v = ctx.get(path[0].k !== undefined ? path[0].k : '');
  let pstr = path[0].k;
  for (let i = 1; i < path.length; i++) {
    const seg = path[i];
    const key = seg.k !== undefined ? seg.k : evalExpr(seg.expr, ctx);
    pstr += '.' + key;
    v = access(v, key, ctx, pstr);
    if (v === undefined) {
      // permite que los overrides resuelvan rutas completas aunque falte el intermedio
      return ctx.overrides[pstr] !== undefined ? ctx.overrides[pstr] : undefined;
    }
  }
  if (ctx.overrides[pstr] !== undefined && path.length > 1) return ctx.overrides[pstr];
  return v;
}

function evalExpr(e, ctx) {
  switch (e.t) {
    case 'lit':
      return e.v;
    case 'blank':
      return { __blank: true, __keep: true };
    case 'range': {
      const a = num(evalExpr(e.a, ctx));
      const b = num(evalExpr(e.b, ctx));
      const r = [];
      for (let i = a; i <= b; i++) r.push(i);
      return r;
    }
    case 'var': {
      const v = evalVar(e.path, ctx);
      return v === undefined ? NIL : v;
    }
  }
  return NIL;
}

function cmpEq(a, b) {
  if (a && a.__blank) return isBlank(b);
  if (b && b.__blank) return isBlank(a);
  if (isNil(a) && isNil(b)) return true;
  if (isNil(a) || isNil(b)) return false;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === typeof b && (typeof a === 'string' || typeof a === 'boolean')) return a === b;
  // objetos que se comportan como texto (colores, imágenes, fuentes…): Shopify los compara por su valor
  if (a && typeof a === 'object' && '__str' in a && (typeof b === 'string' || (b && typeof b === 'object' && '__str' in b))) return str(a) === str(b);
  if (b && typeof b === 'object' && '__str' in b && typeof a === 'string') return str(b) === a;
  if (typeof a === 'object' && typeof b === 'object') return a === b;
  if (typeof a === 'string' && typeof b === 'number') return false;
  if (typeof a === 'number' && typeof b === 'string') return false;
  return false;
}
function cmpOrder(a, b, op) {
  if (isNil(a) || isNil(b)) return false;
  // Shopify (Ruby) lanza «comparison of String with Integer failed» al ordenar texto y número: aquí también falla
  if ((typeof a === 'string' && typeof b === 'number') || (typeof a === 'number' && typeof b === 'string')) throw new Error(`Liquid error: comparación inválida de ${typeof a} con ${typeof b} (${JSON.stringify(a)} ${op} ${JSON.stringify(b)})`);
  if (typeof a === 'object' || typeof b === 'object') return false;
  switch (op) {
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
  }
  return false;
}

function evalComparison(c, ctx) {
  const l = evalExpr(c.l, ctx);
  if (c.op === null) return truthy(l) && !(l && l.__blank);
  const r = evalExpr(c.r, ctx);
  switch (c.op) {
    case '==': return cmpEq(l, r);
    case '!=':
    case '<>': return !cmpEq(l, r);
    case 'contains':
      if (isNil(l)) return false;
      if (typeof l === 'string' || (typeof l === 'object' && '__str' in l)) return typeof r === 'string' || typeof r === 'number' ? str(l).includes(String(r)) : false;
      if (Array.isArray(l)) return l.some((x) => cmpEq(x, r));
      return false;
    default: return cmpOrder(l, r, c.op);
  }
}
function evalCondition(cond, ctx) {
  const { segs, ops } = cond;
  const rec = (i) => {
    const v = evalComparison(segs[i], ctx);
    if (i === segs.length - 1) return v;
    return ops[i] === 'and' ? v && rec(i + 1) : v || rec(i + 1);
  };
  return rec(0);
}

/* ------------------------------------------------------------ filtros */
function colorParse(c) {
  c = str(c).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [...m[1]].map((x) => parseInt(x + x, 16));
  m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (m) return [+m[1], +m[2], +m[3]];
  return [0, 0, 0];
}
const toHex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hsl2rgb([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
function luminance([r, g, b]) {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function strftime(d, fmt) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return fmt.replace(/%([YmdHMSyb])/g, (_, c) => ({ Y: d.getFullYear(), m: p(d.getMonth() + 1), d: p(d.getDate()), H: p(d.getHours()), M: p(d.getMinutes()), S: p(d.getSeconds()), y: p(d.getFullYear() % 100), b: ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][d.getMonth()] }[c]));
}

function makeFilters(engine) {
  const arg = (args, i) => (args[i] === undefined ? undefined : args[i]);
  const f = {
    append: (v, a) => str(v) + str(a[0]),
    prepend: (v, a) => str(a[0]) + str(v),
    replace: (v, a) => str(v).split(str(a[0])).join(str(a[1])),
    remove: (v, a) => str(v).split(str(a[0])).join(''),
    split: (v, a) => {
      const s = str(v);
      const sep = str(a[0]);
      if (s === '') return [];
      const parts = sep === '' ? [...s] : s.split(sep);
      while (parts.length && parts[parts.length - 1] === '') parts.pop();
      return parts;
    },
    join: (v, a) => (Array.isArray(v) ? v.map(str).join(a[0] === undefined ? ' ' : str(a[0])) : str(v)),
    first: (v) => (Array.isArray(v) || typeof v === 'string' ? v[0] : undefined),
    last: (v) => (Array.isArray(v) ? v[v.length - 1] : typeof v === 'string' ? v[v.length - 1] : undefined),
    size: (v) => (isNil(v) ? 0 : Array.isArray(v) || typeof v === 'string' ? v.length : Object.keys(v).length),
    strip: (v) => str(v).trim(),
    strip_html: (v) => str(v).replace(/<[^>]*>/g, ''),
    strip_newlines: (v) => str(v).replace(/\r?\n/g, ''),
    escape: (v) => str(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    downcase: (v) => str(v).toLowerCase(),
    upcase: (v) => str(v).toUpperCase(),
    capitalize: (v) => { const s = str(v); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); },
    truncate: (v, a) => { const s = str(v); const n = num(a[0] ?? 50); const e = a[1] === undefined ? '...' : str(a[1]); return s.length <= n ? s : s.slice(0, Math.max(0, n - e.length)) + e; },
    truncatewords: (v, a) => { const w = str(v).split(/\s+/).filter(Boolean); const n = num(a[0] ?? 15); return w.length <= n ? w.join(' ') : w.slice(0, n).join(' ') + '...'; },
    plus: (v, a) => num(v) + num(a[0]),
    minus: (v, a) => num(v) - num(a[0]),
    times: (v, a) => num(v) * num(a[0]),
    divided_by: (v, a, raw) => {
      const d = num(a[0]);
      if (d === 0) return 0;
      const floatDiv = raw[0] && raw[0].float;
      const x = num(v);
      return Number.isInteger(x) && Number.isInteger(d) && !floatDiv ? Math.floor(x / d) : x / d;
    },
    modulo: (v, a) => num(v) % num(a[0]),
    round: (v, a) => { const d = num(a[0] ?? 0); const p = Math.pow(10, d); const r = Math.round(num(v) * p) / p; return r; },
    floor: (v) => Math.floor(num(v)),
    ceil: (v) => Math.ceil(num(v)),
    abs: (v) => Math.abs(num(v)),
    at_most: (v, a) => Math.min(num(v), num(a[0])),
    at_least: (v, a) => Math.max(num(v), num(a[0])),
    default: (v, a, raw) => {
      const allowFalse = raw.some((r, i) => r.named === 'allow_false' && a[i] === true);
      const fallback = a[raw.findIndex((r) => !r.named)];
      if (v === false && allowFalse) return v;
      return isNil(v) || v === false || (typeof v === 'string' && v === '') || (Array.isArray(v) && v.length === 0) || (v && typeof v === 'object' && '__str' in v && str(v) === '') ? fallback : v;
    },
    json: (v) => ({ __str: JSON.stringify(v === undefined ? null : v, (k, x) => (x && x.__str !== undefined ? str(x) : x)) }),
    url_encode: (v) => encodeURIComponent(str(v)).replace(/%20/g, '+').replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()),
    newline_to_br: (v) => str(v).replace(/\r?\n/g, '<br />\n'),
    slice: (v, a) => {
      const s = Array.isArray(v) ? v : str(v);
      let st = num(a[0]);
      const len = a[1] === undefined ? 1 : num(a[1]);
      if (st < 0) st = Math.max(0, s.length + st);
      return Array.isArray(s) ? s.slice(st, st + len) : s.substr(st, len);
    },
    handleize: (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    date: (v, a) => { const s = str(a[0]); const d = v === 'now' || isNil(v) ? new Date() : new Date(v); return isNaN(d) ? '' : strftime(d, s); },
    time_tag: (v, a) => { const d = new Date(v); return `<time datetime="${d.toISOString()}">${strftime(d, str(a[0] || '%d/%m/%Y'))}</time>`; },
    t: (v, a, raw, ctx) => engine.translate(str(v), a, raw),
    asset_url: (v) => `/assets/${str(v)}?v=1`,
    image_url: (v, a, raw) => {
      if (!v || typeof v !== 'object') return '';
      // Como en Shopify: de un vídeo (o un medio sin imagen propia) se usa su imagen de vista previa
      if (v.media_type && v.media_type !== 'image' && v.preview_image) v = v.preview_image;
      const named = Object.fromEntries(raw.filter((r) => r.named).map((r, i) => [r.named, a[raw.indexOf(r)]]));
      const w = named.width || v.width;
      return `/img/${v.id}?width=${w}`;
    },
    stylesheet_tag: (v) => `<link href="${str(v)}" rel="stylesheet" type="text/css" media="all">`,
    script_tag: (v) => `<script src="${str(v)}"></script>`,
    money_without_currency: (v) => (num(v) / 100).toFixed(2),
    font_face: () => '',
    font_url: () => '/font.woff2',
    font_modify: (v) => v,
    color_brightness: (v) => { const [r, g, b] = colorParse(v); return (r * 299 + g * 587 + b * 114) / 1000; },
    color_contrast: (v, a) => { const l1 = luminance(colorParse(v)); const l2 = luminance(colorParse(a[0])); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10; },
    color_darken: (v, a) => { const [h, s, l] = rgb2hsl(colorParse(v)); return toHex(hsl2rgb([h, s, Math.max(0, l - num(a[0]) / 100)])); },
    color_lighten: (v, a) => { const [h, s, l] = rgb2hsl(colorParse(v)); return toHex(hsl2rgb([h, s, Math.min(1, l + num(a[0]) / 100)])); },
    metafield_tag: (v) => (v && typeof v === 'object' && v.__mf ? v.html : str(v)),
    metafield_text: (v) => (v && typeof v === 'object' && v.__mf ? v.text : str(v)),
    default_errors: () => 'Revisa los campos.',
    within: (v) => str(v.url || v),
    // --- añadidos para el kit Sidonia ---
    where: (v, a) => (Array.isArray(v) ? v.filter((x) => (a.length > 1 ? str(x && x[a[0]]) === str(a[1]) : truthyF(x && x[a[0]]))) : []),
    sort: (v, a) => (Array.isArray(v) ? v.slice().sort((x, y) => { const p = a[0] ? x && x[a[0]] : x; const q = a[0] ? y && y[a[0]] : y; return p > q ? 1 : p < q ? -1 : 0; }) : v),
    sort_natural: (v, a) => (Array.isArray(v) ? v.slice().sort((x, y) => str(a[0] ? x[a[0]] : x).localeCompare(str(a[0] ? y[a[0]] : y))) : v),
    map: (v, a) => (Array.isArray(v) ? v.map((x) => x && x[a[0]]) : []),
    uniq: (v) => (Array.isArray(v) ? [...new Set(v)] : v),
    compact: (v) => (Array.isArray(v) ? v.filter((x) => !isNil(x)) : v),
    reverse: (v) => (Array.isArray(v) ? v.slice().reverse() : v),
    // Como Shopify: collection.products no es una lista normal y «concat» la rechaza
    concat: (v, a) => { if (a[0] && a[0].__shopifyDrop) throw new Error('concat filter requires an array argument'); return (Array.isArray(v) ? v : []).concat(Array.isArray(a[0]) ? a[0] : []); },
    url_escape: (v) => encodeURI(str(v)),
    escape_once: (v) => str(v).replace(/&(?!(amp|lt|gt|quot|#39);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    image_tag: (v, a, raw) => {
      const named = {};
      raw.forEach((r, i) => { if (r.named) named[r.named] = a[i]; });
      const attrs = Object.entries(named).filter(([k]) => !['widths', 'sizes', 'preload'].includes(k) || k === 'sizes').map(([k, val]) => `${k}="${str(val).replace(/"/g, '&quot;')}"`).join(' ');
      return `<img src="${str(v)}" ${attrs}>`;
    },
    video_tag: (v, a, raw) => {
      if (!v || !v.sources) return '';
      const named = {};
      raw.forEach((r, i) => { if (r.named) named[r.named] = a[i]; });
      const bool = ['controls', 'playsinline', 'autoplay', 'loop', 'muted'].filter((k) => named[k]).map((k) => `${k}="${k}"`).join(' ');
      const poster = v.preview_image ? ` poster="/img/${v.preview_image.id}?width=1080"` : '';
      const cls = named.class ? ` class="${str(named.class)}"` : '';
      const srcs = v.sources.map((s) => `<source src="${s.url}" type="${s.mime_type}">`).join('');
      return `<video ${bool} preload="${str(named.preload || 'metadata')}"${poster}${cls}>${srcs}</video>`;
    },
    // --- añadidos para renderizar Impact en el arnés (aproximaciones de prueba, no el motor real) ---
    money: (v) => moneyEs(v),
    money_with_currency: (v) => moneyEs(v) + ' EUR',
    money_without_trailing_zeros: (v) => moneyEs(v).replace(/,00(?=\s)/, ''),
    color_to_rgb: (v) => { const [r, g, b] = colorParse(v); return `rgb(${r}, ${g}, ${b})`; },
    color_to_hex: (v) => toHex(colorParse(v)),
    color_mix: (v, a) => { const x = colorParse(v); const y = colorParse(a[0]); const w = num(a[1]) / 100; return toHex(x.map((c, i) => c * w + y[i] * (1 - w))); },
    color_modify: (v, a) => { const [r, g, b] = colorParse(v); if (str(a[0]) === 'alpha') return `rgba(${r}, ${g}, ${b}, ${num(a[1])})`; return toHex([r, g, b]); },
    color_saturate: (v) => v,
    color_desaturate: (v) => v,
    handle: (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    placeholder_svg_tag: (v, a) => `<svg class="${str(a[0] || '')}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 525 525"><rect width="525" height="525" fill="#e6e3dc"/></svg>`,
    url_decode: (v) => { try { return decodeURIComponent(str(v).replace(/\+/g, ' ')); } catch { return str(v); } },
    remove_first: (v, a) => str(v).replace(str(a[0]), ''),
    remove_last: (v, a) => { const s = str(v); const i = s.lastIndexOf(str(a[0])); return i < 0 ? s : s.slice(0, i) + s.slice(i + str(a[0]).length); },
    replace_first: (v, a) => str(v).replace(str(a[0]), str(a[1])),
    shopify_asset_url: (v) => `/assets/${str(v)}`,
    external_video_url: (v) => str(v && v.url ? v.url : v),
    external_video_tag: () => '<iframe title="vídeo externo (arnés)"></iframe>',
    structured_data: (v) => ({ __str: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Thing', name: v && v.title }) }),
    payment_type_svg_tag: () => '',
    img_url: (v) => (v && v.id ? `/img/${v.id}` : ''),
    weight_with_unit: (v) => `${num(v)} kg`,
    format_address: () => '',
    url_param_escape: (v) => encodeURIComponent(str(v)),
    link_to_tag: (v) => str(v),
    link_to_remove_tag: (v) => str(v),
    unit_price_with_measurement: () => '',
    md5: (v) => str(v).length.toString(16),
    base64_encode: (v) => Buffer.from(str(v)).toString('base64'),
    sha256: (v) => str(v).length.toString(16),
    url_for_vendor: (v) => `/collections/vendors?q=${encodeURIComponent(str(v))}`,
    url_for_type: (v) => `/collections/types?q=${encodeURIComponent(str(v))}`,
    payment_button: () => '<div class="harness-payment-button">[botón de pago (arnés)]</div>',
    payment_terms: () => '',
    model_viewer_tag: () => '',
    media_tag: () => '',
    login_button: () => '',
    line_items_for: () => [],
    highlight: (v) => str(v),
    pluralize: (v, a) => (num(v) === 1 ? str(a[0]) : str(a[1])),
    currency_selector: () => '',
    json_escape: (v) => str(v)
  };
  return f;
}
function moneyEs(v) {
  const n = num(v) / 100;
  const [i, d] = n.toFixed(2).split('.');
  const int = i.length > 4 ? i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : i;
  return `${int},${d} €`;
}

/* ------------------------------------------------------------ parser de bloques */
class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.i = 0;
  }
  parse(endTags = []) {
    const nodes = [];
    while (this.i < this.tokens.length) {
      const t = this.tokens[this.i];
      if (t.type === 'text') {
        nodes.push({ type: 'text', value: t.value });
        this.i++;
      } else if (t.type === 'output') {
        nodes.push({ type: 'output', expr: parseOutput(t.value), line: t.line });
        this.i++;
      } else {
        if (t.value.startsWith('#')) {
          this.i++;
          continue;
        }
        const name = (/^([a-z_]+)/.exec(t.value) || [])[1] || '';
        if (endTags.includes(name)) return { nodes, end: name, endToken: t };
        this.i++;
        const rest = t.value.slice(name.length).trim();
        nodes.push(this.tag(name, rest, t.line));
      }
    }
    if (endTags.length) throw new Error(`Falta cierre de ${endTags.join('/')}`);
    return { nodes, end: null };
  }
  tag(name, rest, line) {
    switch (name) {
      case 'if':
      case 'unless': {
        const ends = ['elsif', 'else', 'endif', 'endunless'];
        const branches = [];
        let elseBody = null;
        let cond = parseCondition(rest);
        let r = this.parse(ends);
        branches.push({ cond, body: r.nodes });
        for (;;) {
          const end = r.end;
          const tok = r.endToken;
          this.i++;
          if (end === 'endif' || end === 'endunless') break;
          if (end === 'elsif') {
            cond = parseCondition(tok.value.replace(/^elsif/, '').trim());
            r = this.parse(ends);
            branches.push({ cond, body: r.nodes });
          } else {
            r = this.parse(ends);
            elseBody = r.nodes;
          }
        }
        return { type: name, branches, elseBody, line };
      }
      case 'case': {
        const ends = ['when', 'else', 'endcase'];
        const subject = parseExpr(rest);
        const whens = [];
        let elseBody = null;
        let r = this.parse(ends);
        for (;;) {
          const end = r.end;
          const tok = r.endToken;
          this.i++;
          if (end === 'endcase') break;
          if (end === 'when') {
            const exprs = splitTop(tok.value.replace(/^when/, '').trim(), /^(,|\s+or\s+)/).map((x) => parseExpr(x));
            r = this.parse(ends);
            whens.push({ exprs, body: r.nodes });
          } else {
            r = this.parse(ends);
            elseBody = r.nodes;
          }
        }
        return { type: 'case', subject, whens, elseBody, line };
      }
      case 'for': {
        const m = /^([a-z_0-9]+)\s+in\s+([\s\S]+)$/.exec(rest);
        if (!m) throw new Error('for inválido: ' + rest);
        const limitM = /\blimit:\s*(\S+)/.exec(m[2]);
        const offsetM = /\boffset:\s*(\S+)/.exec(m[2]);
        const reversed = /\sreversed\b/.test(m[2]);
        const collStr = m[2].replace(/\s+(limit|offset):[\s\S]*$/, '').replace(/\s+reversed\s*$/, '').trim();
        const r = this.parse(['else', 'endfor']);
        this.i++;
        let elseBody = null;
        if (r.end === 'else') {
          const r2 = this.parse(['endfor']);
          this.i++;
          elseBody = r2.nodes;
        }
        return { type: 'for', v: m[1], coll: parseExpr(collStr), reversed, limit: limitM ? parseExpr(limitM[1]) : null, offset: offsetM ? parseExpr(offsetM[1]) : null, body: r.nodes, elseBody, line };
      }
      case 'capture': {
        const r = this.parse(['endcapture']);
        this.i++;
        return { type: 'capture', name: rest.trim(), body: r.nodes };
      }
      case 'style': {
        const r = this.parse(['endstyle']);
        this.i++;
        return { type: 'style', body: r.nodes };
      }
      case 'cycle': {
        let body = rest;
        let group = null;
        const gm = /^((?:'[^']*'|"[^"]*"|[\w.]+))\s*:\s*([\s\S]+)$/.exec(rest);
        if (gm && !/,/.test(gm[1])) {
          group = gm[1];
          body = gm[2];
        }
        return { type: 'cycle', key: group || rest, values: splitTop(body, /^,/).map((x) => parseExpr(x)) };
      }
      case 'increment':
      case 'decrement':
        return { type: name, v: rest.trim() };
      case 'content_for':
        return { type: 'noop' };
      case 'include': {
        const parts = splitTop(rest, /^,/);
        const fileM = /^\s*(['"])([^'"]+)\1/.exec(parts[0]);
        const params = parts.slice(1).map((p) => {
          const idx = p.indexOf(':');
          return { k: p.slice(0, idx).trim(), v: parseExpr(p.slice(idx + 1)) };
        });
        return { type: 'render', file: fileM[2], params, shared: true, line };
      }
      case 'comment':
      case 'doc':
      case 'raw':
      case 'schema':
      case 'stylesheet':
      case 'javascript': {
        // salta hasta el cierre sin interpretar
        while (this.i < this.tokens.length) {
          const t = this.tokens[this.i++];
          if (t.type === 'tag' && t.value === 'end' + name) break;
        }
        return { type: 'noop' };
      }
      case 'form': {
        const r = this.parse(['endform']);
        this.i++;
        const parts = splitTop(rest, /^,/);
        const kind = parseExpr(parts[0]);
        // el segundo argumento puede ser un objeto (form 'product', product): no es un atributo
        const attrs = parts.slice(1).filter((p) => p.includes(':')).map((p) => {
          const idx = p.indexOf(':');
          return { k: p.slice(0, idx).trim(), v: parseExpr(p.slice(idx + 1)) };
        });
        return { type: 'form', kind, attrs, body: r.nodes, line };
      }
      case 'paginate': {
        const m = /^(.+?)\s+by\s+(.+)$/.exec(rest);
        const r = this.parse(['endpaginate']);
        this.i++;
        return { type: 'paginate', coll: m[1].trim(), expr: parseExpr(m[1]), by: parseExpr(m[2]), body: r.nodes, line };
      }
      case 'assign': {
        const idx = rest.indexOf('=');
        return { type: 'assign', name: rest.slice(0, idx).trim(), expr: parseOutput(rest.slice(idx + 1)), line };
      }
      case 'echo':
        return { type: 'output', expr: parseOutput(rest), line };
      case 'render': {
        const parts = splitTop(rest, /^,/);
        const fileM = /^\s*(['"])([^'"]+)\1\s*(?:(with|for)\s+(.+?))?(?:\s+as\s+([a-z_0-9]+))?\s*$/.exec(parts[0]);
        if (!fileM) return { type: 'renderBlock' };
        const params = parts.slice(1).map((p) => {
          const idx = p.indexOf(':');
          return { k: p.slice(0, idx).trim(), v: parseExpr(p.slice(idx + 1)) };
        });
        return { type: 'render', file: fileM[2], params, line, mode: fileM[3] || null, subject: fileM[4] ? parseExpr(fileM[4]) : null, alias: fileM[5] || fileM[2].split('/').pop() };
      }
      case 'section':
        return { type: 'section', name: rest.replace(/['"]/g, '') };
      case 'sections':
        return { type: 'sections', name: rest.replace(/['"]/g, '') };
      case 'layout':
        return { type: 'layout', value: rest.trim() };
      case 'break':
        return { type: 'break' };
      case 'continue':
        return { type: 'continue' };
      case 'liquid': {
        // cada línea es una etiqueta
        const toks = [];
        for (const raw of rest.split('\n')) {
          const l = raw.trim();
          if (!l || l.startsWith('#')) continue;
          // una línea que no empieza por etiqueta continúa la anterior (p. ej. argumentos de render en varias líneas)
          if (!/^[a-z_]/.test(l) && toks.length) toks[toks.length - 1].value += ' ' + l;
          else toks.push({ type: 'tag', value: l, line });
        }
        const sub = new Parser(toks);
        return { type: 'group', nodes: sub.parse([]).nodes };
      }
      default:
        throw new Error(`Etiqueta no soportada por el intérprete de pruebas: ${name} (línea ${line})`);
    }
  }
}

const PARSE_CACHE = new Map();
class BreakSignal {}
class ContinueSignal {}

/* ------------------------------------------------------------ motor */
export class Liquid {
  constructor({ themeDir, locale, globals, hooks }) {
    this.themeDir = themeDir;
    this.locale = locale;
    this.globals = globals;
    this.hooks = hooks || {};
    this.cache = PARSE_CACHE;
    this.filters = makeFilters(this);
    this.missingTranslations = new Set();
  }

  parseFile(path) {
    if (!this.cache.has(path)) {
      const src = readFileSync(path, 'utf8');
      const tokens = tokenize(src);
      this.cache.set(path, new Parser(tokens).parse([]).nodes);
    }
    return this.cache.get(path);
  }

  translate(key, args, raw) {
    const parts = key.split('.');
    let n = this.locale;
    for (const p of parts) n = n && typeof n === 'object' ? n[p] : undefined;
    const named = {};
    raw.forEach((r, i) => {
      if (r.named) named[r.named] = args[i];
    });
    if (n && typeof n === 'object') {
      const c = named.count;
      n = c === 1 ? n.one ?? n.other : n.other;
    }
    if (typeof n !== 'string') {
      this.missingTranslations.add(key);
      return `Translation missing: es.${key}`;
    }
    return n.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k) => str(named[k]));
  }

  renderStr(nodes, ctx) {
    const r = this.render(nodes, ctx);
    return typeof r === 'string' ? r : r.out;
  }

  applyFilters(value, filters, ctx) {
    let v = value;
    for (const fl of filters) {
      const fn = this.filters[fl.name];
      if (!fn) throw new Error(`Filtro no soportado: ${fl.name} (${ctx.file})`);
      const args = fl.args.map((a) => evalExpr(a.expr, ctx));
      const raw = fl.args.map((a) => ({ named: a.named, float: a.expr.float, int: a.expr.int }));
      v = fn(v, args, raw, ctx);
    }
    return v;
  }

  evalOutput(expr, ctx) {
    return this.applyFilters(evalExpr(expr.head, ctx), expr.filters, ctx);
  }

  node(n, ctx) {
    switch (n.type) {
      case 'text':
        return n.value;
      case 'noop':
        return '';
      case 'output':
        return str(this.evalOutput(n.expr, ctx));
      case 'assign': {
        const v = this.evalOutput(n.expr, ctx);
        ctx.set(n.name, v === undefined ? NIL : v);
        return '';
      }
      case 'capture': {
        const s = this.renderStr(n.body, ctx);
        ctx.set(n.name, s);
        return '';
      }
      case 'if':
      case 'unless': {
        for (let i = 0; i < n.branches.length; i++) {
          const b = n.branches[i];
          let c = evalCondition(b.cond, ctx);
          if (n.type === 'unless' && i === 0) c = !c;
          if (c) return this.renderNodesSignal(b.body, ctx);
        }
        return n.elseBody ? this.renderNodesSignal(n.elseBody, ctx) : '';
      }
      case 'case': {
        const subj = evalExpr(n.subject, ctx);
        for (const w of n.whens) {
          if (w.exprs.some((e) => cmpEq(subj, evalExpr(e, ctx)))) return this.renderNodesSignal(w.body, ctx);
        }
        return n.elseBody ? this.renderNodesSignal(n.elseBody, ctx) : '';
      }
      case 'for': {
        let coll = evalExpr(n.coll, ctx);
        if (coll && !Array.isArray(coll) && typeof coll === 'object' && Array.isArray(coll.__items)) coll = coll.__items;
        if (!Array.isArray(coll)) coll = [];
        if (n.reversed) coll = coll.slice().reverse();
        const off = n.offset ? num(evalExpr(n.offset, ctx)) : 0;
        const lim = n.limit ? num(evalExpr(n.limit, ctx)) : coll.length;
        const arr = coll.slice(off, off + lim);
        if (!arr.length) return n.elseBody ? this.renderNodesSignal(n.elseBody, ctx) : '';
        let out = '';
        const prev = ctx.get('forloop');
        for (let i = 0; i < arr.length; i++) {
          ctx.set(n.v, arr[i]);
          ctx.set('forloop', { index: i + 1, index0: i, rindex: arr.length - i, rindex0: arr.length - i - 1, first: i === 0, last: i === arr.length - 1, length: arr.length, parentloop: prev });
          const r = this.render(n.body, ctx);
          if (typeof r === 'string') out += r;
          else {
            out += r.out;
            if (r.signal instanceof BreakSignal) break;
          }
        }
        ctx.set('forloop', prev);
        return out;
      }
      case 'break':
        return new BreakSignal();
      case 'continue':
        return new ContinueSignal();
      case 'group':
        return this.renderNodesSignal(n.nodes, ctx);
      case 'render':
        return this.renderSnippet(n, ctx);
      case 'renderBlock':
        return '';
      case 'style':
        return '<style>' + this.renderStr(n.body, ctx) + '</style>';
      case 'cycle': {
        const reg = (ctx.registers.cycles = ctx.registers.cycles || {});
        const i = reg[n.key] || 0;
        reg[n.key] = i + 1;
        return str(evalExpr(n.values[i % n.values.length], ctx));
      }
      case 'increment':
      case 'decrement': {
        const reg = (ctx.registers.counters = ctx.registers.counters || {});
        if (!(n.v in reg)) reg[n.v] = 0;
        if (n.type === 'increment') return String(reg[n.v]++);
        return String(--reg[n.v]);
      }
      case 'layout':
        if (n.value === 'none') ctx.registers.layoutNone = true;
        return '';
      case 'sections':
        return this.hooks.renderSectionGroup ? this.hooks.renderSectionGroup(n.name, ctx, this) : '';
      case 'section':
        return '';
      case 'form':
        return this.renderForm(n, ctx);
      case 'paginate':
        return this.renderPaginate(n, ctx);
    }
    throw new Error('Nodo desconocido ' + n.type);
  }

  renderNodesSignal(nodes, ctx) {
    const r = this.render(nodes, ctx);
    if (typeof r === 'string') return r;
    // propaga break/continue hacia el bucle
    const sig = r.signal;
    const res = r.out;
    // devolvemos un objeto especial que `render` entiende
    return new SignalOutput(res, sig);
  }

  renderSnippet(n, ctx) {
    const path = join(this.themeDir, 'snippets', n.file + '.liquid');
    if (!existsSync(path)) throw new Error(`Snippet inexistente: ${n.file} (desde ${ctx.file})`);
    const nodes = this.parseFile(path);
    if (n.shared) {
      for (const p of n.params) ctx.set(p.k, evalExpr(p.v, ctx));
      const r = this.render(nodes, ctx);
      return typeof r === 'string' ? r : r.out;
    }
    const run = (extra) => {
      const sub = new Context(this.globals, { engine: this, file: `snippets/${n.file}`, registers: ctx.registers, overrides: ctx.overrides });
      // Como en Shopify: el objeto «section» de la sección que renderiza sigue disponible dentro de sus snippets
      const sec = ctx.get('section');
      if (sec !== undefined) sub.set('section', sec);
      for (const p of n.params) sub.set(p.k, evalExpr(p.v, ctx));
      for (const [k, v] of Object.entries(extra)) sub.set(k, v);
      const r = this.render(nodes, sub);
      return typeof r === 'string' ? r : r.out;
    };
    if (n.mode === 'for') {
      let list = evalExpr(n.subject, ctx);
      if (!Array.isArray(list)) list = isNil(list) ? [] : [list];
      return list.map((item, i) => run({ [n.alias]: item, forloop: { index: i + 1, index0: i, first: i === 0, last: i === list.length - 1, length: list.length } })).join('');
    }
    if (n.mode === 'with') return run({ [n.alias]: evalExpr(n.subject, ctx) });
    return run({});
  }

  renderForm(n, ctx) {
    const kind = str(evalExpr(n.kind, ctx));
    const attrs = n.attrs.map((a) => `${a.k}="${str(evalExpr(a.v, ctx))}"`).join(' ');
    const state = (this.hooks.formState && this.hooks.formState(kind, ctx)) || { posted: false, errors: null, values: {} };
    const form = {
      'posted_successfully?': state.posted,
      errors: state.errors || null,
      name: state.values.name || '',
      email: state.values.email || '',
      phone: state.values.phone || '',
      body: state.values.body || ''
    };
    const prev = ctx.get('form');
    ctx.set('form', form);
    const inner = this.renderStr(n.body, ctx);
    ctx.set('form', prev);
    const action = kind === 'storefront_password' ? '/password' : kind === 'product' ? '/cart/add' : '/contact#contact_form';
    return `<form method="post" action="${action}" ${attrs} accept-charset="UTF-8"><input type="hidden" name="form_type" value="${kind}"><input type="hidden" name="utf8" value="✓">${inner}</form>`;
  }

  renderPaginate(n, ctx) {
    const coll = evalExpr(n.expr, ctx);
    const by = num(evalExpr(n.by, ctx)) || 12;
    const all = Array.isArray(coll) ? coll : [];
    const page = Math.max(1, num(ctx.globals.__query?.page) || 1);
    const pages = Math.max(1, Math.ceil(all.length / by));
    const slice = all.slice((page - 1) * by, page * by);
    const base = ctx.globals.__path + '?' + ctx.globals.__queryString({ page: null });
    const urlFor = (p) => `${ctx.globals.__path}?${ctx.globals.__queryString({ page: p })}`;
    const parts = [];
    for (let p = 1; p <= pages; p++) parts.push({ title: p, url: urlFor(p), is_link: p !== page });
    const pag = {
      current_page: page,
      pages,
      items: all.length,
      page_size: by,
      next: page < pages ? { url: urlFor(page + 1), title: 'next' } : null,
      previous: page > 1 ? { url: urlFor(page - 1), title: 'prev' } : null,
      parts
    };
    void base;
    const prevOv = ctx.overrides[n.coll];
    ctx.overrides[n.coll] = slice;
    ctx.set('paginate', pag);
    const out = this.renderStr(n.body, ctx);
    if (prevOv === undefined) delete ctx.overrides[n.coll];
    else ctx.overrides[n.coll] = prevOv;
    return out;
  }
}

class SignalOutput {
  constructor(out, signal) {
    this.out = out;
    this.signal = signal;
  }
}

Liquid.prototype.render = function (nodes, ctx) {
  let out = '';
  for (const n of nodes) {
    const r = this.node(n, ctx);
    if (r === undefined) continue;
    if (r instanceof SignalOutput) {
      return { signal: r.signal, out: out + r.out };
    }
    if (r instanceof BreakSignal || r instanceof ContinueSignal) return { signal: r, out };
    out += r;
  }
  return out;
};

export { Context, evalExpr, parseExpr, str, isNil, isBlank };
