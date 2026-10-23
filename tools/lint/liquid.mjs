#!/usr/bin/env node
// Linter ESTRICTO de Liquid para Shopify (propio, sin red). Detecta lo que un intérprete permisivo deja pasar y Shopify
// convierte en «Liquid error» al renderizar:
//  - etiquetas desconocidas o mal cerradas, filtros que no existen en Shopify,
//  - filtros dentro de `for`, `if`, `unless`, `case` y argumentos de `render`,
//  - snippets que leen variables del ámbito de quien los llama (render aísla el ámbito),
//  - `section`/`block` dentro de snippets, comparaciones número/texto, claves de traducción y assets inexistentes.
// Origen: linter del prototipo anterior (legacy/), adaptado para revisar el tema compuesto (anfitrión o Impact + kit).
// Uso: node tools/check-kit.mjs (lo invoca) o SIDONIA_LINT_ROOT=<tema> node tools/lint/liquid.mjs
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Raíz del tema a revisar (por defecto, el tema de pruebas compuesto) y filtro de archivos a informar.
const root = process.env.SIDONIA_LINT_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'build', 'harness-theme');
const ONLY = process.env.SIDONIA_LINT_ONLY ? new RegExp(process.env.SIDONIA_LINT_ONLY) : null;

const TAGS = new Set('assign capture case comment cycle decrement echo for form if include increment layout liquid paginate raw render section sections style stylesheet javascript schema tablerow unless else elsif when endif endunless endfor endcase endcapture endform endpaginate endcomment endraw endstyle endstylesheet endjavascript endschema endtablerow break continue content_for'.split(' '));
const FILTERS = new Set(('abs append asset_img_url asset_url at_least at_most base64_decode base64_encode base64_url_safe_decode base64_url_safe_encode brightness_difference camelcase capitalize ceil compact concat color_brightness color_contrast color_darken color_desaturate color_difference color_extract color_lighten color_mix color_modify color_saturate color_to_hex color_to_hsl color_to_rgb currency_selector date default default_errors default_pagination divided_by downcase escape escape_once external_video_tag external_video_url file_img_url file_url first floor font_face font_modify font_url format_address global_asset_url handle handleize hex_to_rgba hmac_sha1 hmac_sha256 image_tag image_url img_tag img_url join json last link_to link_to_add_tag link_to_remove_tag link_to_tag link_to_type link_to_vendor lstrip map md5 media_tag metafield_tag metafield_text minus model_viewer_tag modulo money money_with_currency money_without_currency money_without_trailing_zeros newline_to_br payment_button payment_type_img_url payment_type_svg_tag placeholder_svg_tag pluralize plus preload_tag prepend product_img_url remove remove_first remove_last replace replace_first replace_last reverse round rstrip script_tag sha1 sha256 shopify_asset_url size slice sort sort_natural split strip strip_html strip_newlines structured_data stylesheet_tag sum t times time_tag translate truncate truncatewords uniq unit_price_with_measurement upcase url_decode url_encode url_escape url_param_escape video_tag weight_with_unit where within withing article_img_url collection_img_url').split(' '));
// Objetos globales accesibles también dentro de snippets (render no los aísla)
const GLOBALS = new Set('shop settings routes request template canonical_url page_title page_description content_for_header content_for_layout content_for_index content_for_footer cart customer customer_address localization linklists pages blogs collections all_products product collection search page blog article current_page current_tags powered_by_link scripts handle theme form paginate forloop tablerowloop predictive_search recommendations shopify_attributes email_form images checkout order country_option_tags currency_selector robots comment true false nil empty blank'.split(' '));

let errors = [];
let warns = [];
const report = (f) => !ONLY || ONLY.test(relative(root, f));
const err = (f, line, msg) => report(f) && errors.push(`${relative(root, f)}:${line}  ${msg}`);
const warn = (f, line, msg) => report(f) && warns.push(`${relative(root, f)}:${line}  ${msg}`);

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const files = walk(root).filter((f) => f.endsWith('.liquid'));
const snippetsDir = join(root, 'snippets');
const snippetNames = new Set(readdirSync(snippetsDir).map((n) => n.replace(/\.liquid$/, '')));
const assets = new Set(readdirSync(join(root, 'assets')));
const localeFile = readdirSync(join(root, 'locales')).find((n) => n.endsWith('.default.json') && !n.includes('.schema.'));
const locale = JSON.parse(readFileSync(join(root, 'locales', localeFile), 'utf8').replace(/^\uFEFF?\s*\/\*[\s\S]*?\*\/\s*/, ''));
const hasKey = (k) => k.split('.').reduce((o, p) => (o && typeof o === 'object' ? o[p] : undefined), locale);

/* ------------------------------------------------------------ tokenizador */
function tokenize(src) {
  const out = [];
  const re = /\{%-?([\s\S]*?)-?%\}|\{\{-?([\s\S]*?)-?\}\}/g;
  let m;
  let last = 0;
  const lineAt = (i) => src.slice(0, i).split('\n').length;
  while ((m = re.exec(src))) {
    const line = lineAt(m.index);
    if (m[0].startsWith('{%')) {
      const body = m[1].trim();
      const name = (body.match(/^[a-z_]+/) || [''])[0];
      // raw / comment / schema / style / javascript: saltar hasta su cierre
      if (['comment', 'raw', 'schema', 'style', 'javascript', 'stylesheet'].includes(name)) {
        const endRe = new RegExp(`\\{%-?\\s*end${name}\\s*-?%\\}`, 'g');
        endRe.lastIndex = re.lastIndex;
        const e = endRe.exec(src);
        if (!e) {
          out.push({ type: 'tag', name, body, line, error: `falta end${name}` });
          continue;
        }
        out.push({ type: 'tag', name, body, line });
        out.push({ type: 'tag', name: 'end' + name, body: 'end' + name, line: lineAt(e.index) });
        re.lastIndex = e.index + e[0].length;
        continue;
      }
      out.push({ type: 'tag', name, body, line });
    } else {
      out.push({ type: 'out', body: m[2].trim(), line });
    }
    last = re.lastIndex;
  }
  return out;
}

// Expande {% liquid %} en tags individuales
function expand(tokens) {
  const res = [];
  for (const t of tokens) {
    if (t.type === 'tag' && t.name === 'liquid') {
      const lines = t.body.replace(/^liquid\s*/, '').split('\n');
      lines.forEach((ln, i) => {
        const s = ln.trim();
        if (!s || s.startsWith('#')) return;
        const name = (s.match(/^[a-z_]+/) || [''])[0];
        if (name === 'echo') res.push({ type: 'out', body: s.replace(/^echo\s+/, ''), line: t.line + i + 1, inLiquid: true });
        else res.push({ type: 'tag', name, body: s, line: t.line + i + 1, inLiquid: true });
      });
    } else res.push(t);
  }
  return res;
}

/* ------------------------------------------------------------ análisis de expresiones */
// Divide por | respetando comillas
function splitPipes(s) {
  const parts = [];
  let cur = '';
  let q = null;
  for (const ch of s) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (ch === '|') {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}
const hasPipe = (s) => splitPipes(s).length > 1;
const stripStrings = (s) => s.replace(/'[^']*'|"[^"]*"/g, '""');
// Raíces de variables leídas en una expresión
function rootsOf(expr) {
  const s = stripStrings(expr);
  const roots = new Set();
  const re = /(^|[^\w.\]])([a-zA-Z_][\w-]*)(?=[\s.\[|:,)=!<>]|$)/g;
  let m;
  while ((m = re.exec(s))) roots.add(m[2]);
  return roots;
}

function checkFilters(f, line, expr) {
  const parts = splitPipes(expr);
  for (let i = 1; i < parts.length; i++) {
    const name = (parts[i].match(/^[a-z_0-9]+/) || [''])[0];
    if (!name) {
      err(f, line, `filtro vacío en «${expr}»`);
      continue;
    }
    if (!FILTERS.has(name)) err(f, line, `filtro desconocido en Shopify: «${name}»`);
    if (name === 't' || name === 'translate') {
      const key = parts[0].match(/^['"]([^'"]+)['"]$/);
      if (key) {
        const v = hasKey(key[1]);
        if (v === undefined) {
          err(f, line, `clave de traducción inexistente: ${key[1]}`);
        } else if (v && typeof v === 'object' && ('one' in v || 'other' in v)) {
          if (!/\bcount\s*:/.test(parts[i])) err(f, line, `la clave plural ${key[1]} necesita el argumento count`);
        } else if (typeof v === 'object') {
          err(f, line, `la clave ${key[1]} no es un texto (es un grupo)`);
        }
      }
    }
    if (name === 'asset_url' || name === 'stylesheet_tag') {
      const a = parts[0].match(/^['"]([^'"]+)['"]$/);
      if (a && name === 'asset_url' && !assets.has(a[1])) err(f, line, `asset inexistente: ${a[1]}`);
    }
    if (name === 'divided_by' && /:\s*0(\.0+)?\s*$/.test(parts[i])) err(f, line, 'división por cero');
  }
}

/* ------------------------------------------------------------ sintaxis de expresiones */
const VALUE = /^(?:'[^']*'|"[^"]*"|-?\d+(?:\.\d+)?|[A-Za-z_][\w-]*\??(?:\.[\w-]+\??|\[(?:'[^']*'|"[^"]*"|[\w.-]+)\])*|\(\s*[\w.\[\]'"-]+\s*\.\.\s*[\w.\[\]'"-]+\s*\))$/;
function checkValue(f, line, v, what) {
  const t = v.trim();
  if (!t) return;
  if (!VALUE.test(t)) err(f, line, `${what}: expresión no válida en Liquid: «${t}»`);
}
function checkFilterArgs(f, line, segment) {
  // «nombre: a, b» o «nombre: k: v, k2: v2»
  const m = segment.match(/^([a-z_0-9]+)\s*(?::\s*([\s\S]*))?$/);
  if (!m || !m[2]) return;
  const parts = [];
  let cur = '';
  let q = null;
  let depth = 0;
  for (const ch of m[2]) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth--;
      cur += ch;
    } else if (ch === ',' && !depth) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  for (const a of parts) {
    const kv = a.trim().match(/^([a-z_]\w*)\s*:\s*([\s\S]+)$/i);
    checkValue(f, line, kv ? kv[2] : a, `argumento de ${m[1]}`);
  }
}
function checkOutputExpr(f, line, expr, what) {
  const parts = splitPipes(expr);
  checkValue(f, line, parts[0], what);
  for (const p of parts.slice(1)) checkFilterArgs(f, line, p);
}
function checkCondition(f, line, cond, tag) {
  const s = stripStrings(cond);
  if (/[()]/.test(s) && !/\(\s*[\w.\[\]-]+\s*\.\.\s*[\w.\[\]-]+\s*\)/.test(s)) err(f, line, `${tag}: los paréntesis no existen en las condiciones de Liquid: «${cond}»`);
  if (/(^|\s)not\s|!(?!=)|&&|\|\|/.test(s)) err(f, line, `${tag}: operador no válido (usa and / or / !=): «${cond}»`);
  if (/(^|[^=!<>])=([^=]|$)/.test(s)) err(f, line, `${tag}: «=» solo en assign; para comparar usa ==: «${cond}»`);
  // trocear por and/or y validar cada comparación
  for (const piece of s.split(/\s+(?:and|or)\s+/)) {
    const m = piece.trim().match(/^(.+?)\s*(==|!=|<>|<=|>=|<|>|contains)\s*(.+)$/);
    if (m) {
      const l = m[1].trim();
      const r = m[3].trim();
      if (!VALUE.test(l.replace(/^["']|["']$/g, '""')) && !/^""$/.test(l)) err(f, line, `${tag}: operando no válido «${l}» en «${cond}»`);
      if (!VALUE.test(r.replace(/^["']|["']$/g, '""')) && !/^""$/.test(r)) err(f, line, `${tag}: operando no válido «${r}» en «${cond}»`);
    } else if (piece.trim() && !VALUE.test(piece.trim().replace(/^["']|["']$/g, '""')) && !/^""$/.test(piece.trim())) {
      err(f, line, `${tag}: condición no válida «${piece.trim()}» en «${cond}»`);
    }
  }
}

/* ------------------------------------------------------------ análisis por archivo */
const info = {}; // snippet -> { free:Set, calls:[], file }

function analyze(file) {
  const src = readFileSync(file, 'utf8');
  const kind = file.includes('/snippets/') ? 'snippet' : file.includes('/sections/') ? 'section' : file.includes('/layout/') ? 'layout' : 'template';
  const name = basename(file, '.liquid');
  const tokens = expand(tokenize(src));
  const stack = [];
  const defined = new Set();
  const read = new Map(); // var -> first line
  const calls = [];
  const strVars = new Set();

  const OPEN = { if: 'endif', unless: 'endunless', for: 'endfor', case: 'endcase', capture: 'endcapture', form: 'endform', paginate: 'endpaginate', tablerow: 'endtablerow', comment: 'endcomment', raw: 'endraw', style: 'endstyle', javascript: 'endjavascript', schema: 'endschema', stylesheet: 'endstylesheet' };
  const CLOSE = new Map(Object.entries(OPEN).map(([k, v]) => [v, k]));

  const noteRead = (expr, line) => {
    for (const r of rootsOf(expr)) if (!read.has(r)) read.set(r, line);
  };

  for (const t of tokens) {
    if (t.error) err(file, t.line, t.error);
    if (t.type === 'out') {
      checkFilters(file, t.line, t.body);
      checkOutputExpr(file, t.line, t.body, 'salida');
      noteRead(splitPipes(t.body)[0], t.line);
      for (const p of splitPipes(t.body).slice(1)) noteRead(p.replace(/^[a-z_0-9]+\s*:?/, ''), t.line);
      continue;
    }
    const { name: tag, body, line } = t;
    if (!TAGS.has(tag)) {
      err(file, line, `etiqueta desconocida: {% ${tag} %}`);
      continue;
    }
    if (OPEN[tag]) stack.push({ tag, line });
    if (CLOSE.has(tag)) {
      const top = stack.pop();
      if (!top || top.tag !== CLOSE.get(tag)) err(file, line, `{% ${tag} %} no coincide con la apertura (${top ? top.tag + ' en la línea ' + top.line : 'ninguna'})`);
    }
    if (tag === 'else' || tag === 'elsif') {
      if (!stack.length || !['if', 'unless', 'case', 'for'].includes(stack[stack.length - 1].tag)) err(file, line, `{% ${tag} %} fuera de if/unless/case/for`);
    }
    if (tag === 'when' && (!stack.length || stack[stack.length - 1].tag !== 'case')) err(file, line, '{% when %} fuera de case');
    if ((tag === 'break' || tag === 'continue') && !stack.some((s) => s.tag === 'for' || s.tag === 'tablerow')) err(file, line, `{% ${tag} %} fuera de un bucle`);

    const rest = body.replace(/^[a-z_]+\s*/, '');
    if (tag === 'assign') {
      const m = rest.match(/^([\w.-]+)\s*=\s*([\s\S]+)$/);
      if (!m) {
        err(file, line, `assign mal formado: ${body}`);
        continue;
      }
      if (/-/.test(m[1])) warn(file, line, `variable con guion: ${m[1]}`);
      checkFilters(file, line, m[2]);
      checkOutputExpr(file, line, m[2], 'assign');
      noteRead(m[2], line);
      defined.add(m[1]);
      if (/^['"]/.test(m[2]) && !hasPipe(m[2])) strVars.add(m[1]);
      else if (/\|\s*(plus|minus|times|divided_by|modulo|round|ceil|floor|abs|at_least|at_most|size)\b[^|]*$/.test(m[2])) strVars.delete(m[1]);
    } else if (tag === 'capture') {
      defined.add(rest.trim());
      strVars.add(rest.trim());
    } else if (tag === 'for') {
      const m = rest.match(/^(\w+)\s+in\s+([\s\S]+)$/);
      if (!m) {
        err(file, line, `for mal formado: ${body}`);
        continue;
      }
      defined.add(m[1]);
      const coll = m[2].replace(/\s+(limit|offset|reversed)\b[\s\S]*$/, '');
      if (hasPipe(coll)) err(file, line, `un filtro dentro de for no es válido en Shopify: «${coll}» (asigna la lista antes)`);
      else checkValue(file, line, coll.trim(), 'for');
      if (/^['"]/.test(coll.trim())) err(file, line, `for sobre una cadena literal: ${coll}`);
      noteRead(coll, line);
      noteRead(rest.replace(/^.*\bin\b/, '').replace(/^[^]*?(limit|offset)/, '$1'), line);
    } else if (tag === 'if' || tag === 'unless' || tag === 'elsif' || tag === 'when' || tag === 'case') {
      if (hasPipe(rest)) err(file, line, `un filtro dentro de ${tag} no es válido: «${rest}»`);
      else if (tag === 'if' || tag === 'unless' || tag === 'elsif') checkCondition(file, line, rest, tag);
      else if (tag === 'when') for (const v of stripStrings(rest).split(/\s*(?:,|\bor\b)\s*/)) checkValue(file, line, v, 'when');
      else if (tag === 'case') checkValue(file, line, rest, 'case');
      noteRead(rest, line);
      // comparaciones < > con cadenas
      const cmp = stripStrings(rest);
      const strLit = rest.match(/(['"][^'"]*['"])\s*[<>]=?|[<>]=?\s*(['"][^'"]*['"])/);
      if (strLit) err(file, line, `comparación < o > con texto: «${rest}»`);
      for (const m of cmp.matchAll(/([a-zA-Z_][\w.]*)\s*[<>]=?\s*|[<>]=?\s*([a-zA-Z_][\w.]*)/g)) {
        if (/\.size$/.test(m[1] || m[2])) continue;
        const v = (m[1] || m[2]).split('.')[0];
        if (strVars.has(v)) warn(file, line, `comparación < o > con la variable de texto «${v}» (capture): usa | plus: 0 antes`);
      }
    } else if (tag === 'render') {
      if (/^block\s*$/.test(rest)) continue; // bloque de app
      const m = rest.match(/^(['"])([^'"]+)\1\s*(?:,\s*([\s\S]*))?$/);
      if (!m) {
        err(file, line, `render con nombre no literal: ${body}`);
        continue;
      }
      const sn = m[2];
      if (!snippetNames.has(sn)) err(file, line, `snippet inexistente: ${sn}`);
      const args = {};
      if (m[3]) {
        // argumentos clave: valor separados por comas fuera de comillas
        const segs = [];
        let cur = '';
        let q = null;
        for (const ch of m[3]) {
          if (q) {
            cur += ch;
            if (ch === q) q = null;
          } else if (ch === '"' || ch === "'") {
            q = ch;
            cur += ch;
          } else if (ch === ',') {
            segs.push(cur);
            cur = '';
          } else cur += ch;
        }
        segs.push(cur);
        for (const sgm of segs) {
          const mm = sgm.trim().match(/^(\w+)\s*:\s*([\s\S]+)$/);
          if (!mm) {
            err(file, line, `argumento de render mal formado: «${sgm.trim()}»`);
            continue;
          }
          if (hasPipe(mm[2])) err(file, line, `render ${sn}: el argumento «${mm[1]}» lleva un filtro (no válido)`);
          else checkValue(file, line, mm[2], `render ${sn}: argumento «${mm[1]}»`);
          args[mm[1]] = mm[2].trim();
          noteRead(mm[2], line);
        }
      }
      calls.push({ snippet: sn, args, line, scopeDefined: new Set(defined), inForloop: stack.some((s) => s.tag === 'for') });
    } else if (tag === 'include') {
      err(file, line, '{% include %} está obsoleto: usa {% render %}');
    } else if (tag === 'form' || tag === 'paginate' || tag === 'layout' || tag === 'section' || tag === 'sections' || tag === 'cycle' || tag === 'increment' || tag === 'decrement') {
      noteRead(rest, line);
      if (tag === 'paginate') defined.add('paginate');
      if (tag === 'form') defined.add('form');
    }
  }
  for (const s of stack) err(file, s.line, `{% ${s.tag} %} sin cerrar`);

  if (kind === 'snippet') {
    // Parámetros alternativos declarados en el comentario del snippet: «lint:opcional uid, field»
    const optional = new Set(((src.match(/lint:opcional\s+([\w, ]+)/) || [])[1] || '').split(/[\s,]+/).filter(Boolean));
    const free = new Map();
    for (const [v, ln] of read) if (!defined.has(v) && !GLOBALS.has(v) && !optional.has(v)) free.set(v, ln);
    info[name] = { free, file };
    for (const [v, ln] of read) {
      if (v === 'section' || v === 'block') err(file, ln, `el snippet lee «${v}»: render aísla el ámbito, hay que pasarlo como argumento`);
    }
  }
  return { file, kind, name, calls, read, defined };
}

const results = files.map(analyze);

// Los parámetros que lee cada snippet deben pasarse: avisar cuando la llamada no los pasa y el llamador SÍ los tiene definidos
for (const r of results) {
  for (const c of r.calls) {
    const sn = info[c.snippet];
    if (!sn) continue;
    for (const [v, ln] of sn.free) {
      if (v in c.args) continue;
      const callerHasIt = c.scopeDefined.has(v) || (r.kind === 'section' && (v === 'section' || v === 'block')) || (r.kind !== 'snippet' && ['section', 'block'].includes(v));
      if (callerHasIt) err(r.file, c.line, `render '${c.snippet}' no pasa «${v}», pero el snippet lo lee (línea ${ln}) y aquí existe: dentro de render quedaría vacío`);
    }
  }
}

// Plantillas y secciones: comprobaciones complementarias
for (const r of results) {
  if (r.kind === 'snippet' || r.kind === 'layout') continue;
}

console.log(`Archivos Liquid revisados: ${files.length}`);
if (warns.length) {
  console.log(`\nAvisos (${warns.length})`);
  warns.slice(0, 60).forEach((w) => console.log('  ' + w));
}
console.log(`\nErrores (${errors.length})`);
errors.forEach((e) => console.log('  ' + e));
console.log(errors.length ? '\nRESULTADO: CON ERRORES' : '\nRESULTADO: SIN ERRORES');
process.exit(errors.length ? 1 : 0);
