#!/usr/bin/env python3
"""Prepara las descripciones de los productos de Sidonia a partir del CSV de productos exportado de Shopify.

Para cada producto:
  1. Quita los emojis de «Body (HTML)» y «SEO Description» (y del título con --titulos).
  2. Si reconoce ficha técnica o ubicación, reescribe la descripción en tres partes con títulos, que es lo que lee la
     plantilla de anuncio del tema (sections/sidonia-listing.liquid):
         <h3>Historia</h3>       párrafos con la historia
         <h3>Ficha técnica</h3>  <ul><li>Año: 1972</li>…</ul>
         <h3>Ubicación</h3>      <p>Madrid</p>
     Si no está seguro (no hay al menos 2 datos «Clave: valor», ni ubicación, ni títulos), solo quita los emojis.

Uso:
  python3 preparar-descripciones.py productos_export.csv
      -> productos_export_preparado.csv   (para importar en Shopify: «Sobrescribir productos con el mismo identificador»)
      -> productos_export_revision.html  (antes y después de cada producto, para revisarlo antes de importar)
  Opciones: --titulos (quita también los emojis de los títulos) · --solo-emojis (no reorganiza nada)

El resto del CSV (otras columnas, filas de variantes e imágenes) se copia tal cual.
"""
import csv
import html
import re
import sys

EMOJI = re.compile(
    '(?:[0-9#*]️?⃣)'
    '|[\U0001F000-\U0001FAFF]'
    '|[☀-➿]'
    '|[⬀-⯿]'
    '|[⌚⌛⌨⏏⏩-⏺]'
    '|[▪▫▶◀◻-◾]'
    '|[⤴⤵〰〽㊗㊙ℹ]'
    '|[︎️‍⃣]'
    '|[\U000E0020-\U000E007F]'
)

H_STORY = re.compile(r'^(su |la )?histori', re.I)
H_SPECS = re.compile(r'^(ficha|datos|caracter[ií]sticas|especificaci|equipamiento|t[eé]cnic)', re.I)
H_LOC = re.compile(r'^(ubicaci|localizaci|d[oó]nde est)', re.I)
BULLET = re.compile(r'^\s*(?:[-–—•·*>]|\d+[.)])\s+')


def sin_emojis(texto):
    t = EMOJI.sub('', texto or '')
    return re.sub(r'[ \t ]{2,}', ' ', t)


def lineas(body):
    """HTML -> lista de (es_titulo, tiene_chincheta, texto) sin etiquetas ni emojis."""
    b = body or ''
    b = re.sub(r'<h[1-6][^>]*>', '\n#', b, flags=re.I)
    b = re.sub(r'</(p|li|div|h[1-6])>|<br\s*/?>', '\n', b, flags=re.I)
    b = re.sub(r'<[^>]+>', '', b)
    out = []
    for raw in html.unescape(b).split('\n'):
        chincheta = '\U0001F4CD' in raw  # 📍 marca la ubicación
        t = sin_emojis(raw).strip()
        titulo = t.startswith('#')
        t = t.lstrip('#').strip()
        t = BULLET.sub('', t).strip()
        if t:
            out.append((titulo, chincheta, t))
    return out


def es_titulo(texto, marcado):
    corto = len(texto) < 34
    limpio = texto.rstrip(':').strip()
    reconocido = H_STORY.match(limpio) or H_SPECS.match(limpio) or H_LOC.match(limpio)
    if marcado:
        return True
    return bool(corto and reconocido and (':' not in texto or texto.endswith(':')))


def es_dato(clave, valor):
    """«Año: 1972» sí; «Un coche con mucha historia: perteneció a…» no (nombre largo o valor con frases)."""
    return bool(clave and valor and len(clave) < 28 and len(clave.split()) <= 4 and len(valor) < 80 and '. ' not in valor)


def partir(body, titulo_producto):
    story, specs, loc = [], [], []
    modo = 'auto'
    hay_titulos = False
    for marcado, chincheta, t in lineas(body):
        if es_titulo(t, marcado):
            limpio = t.rstrip(':').strip()
            if H_STORY.match(limpio):
                modo, hay_titulos = 'story', True
            elif H_LOC.match(limpio):
                modo, hay_titulos = 'loc', True
            elif H_SPECS.match(limpio):
                modo, hay_titulos = 'specs', True
            else:
                story.append(('h', limpio))
                modo = 'story'
            continue
        clave, valor = '', ''
        if ':' in t:
            clave, valor = [x.strip() for x in t.split(':', 1)]
        if modo == 'loc':
            loc.append(valor if re.match(r'^(ubicaci|localizaci|d[oó]nde)', clave, re.I) and valor else t)
            continue
        if re.match(r'^(ubicaci|localizaci)', clave, re.I) and valor:
            loc.append(valor)
            continue
        if chincheta and len(t) < 80:
            loc.append(t)
            continue
        if modo == 'specs':
            specs.append(f'{clave}: {valor}' if clave and len(clave) < 40 and valor else t)
            continue
        if modo == 'auto' and es_dato(clave, valor):
            specs.append(f'{clave}: {valor}')
            continue
        if titulo_producto and titulo_producto.lower() in t.lower() and len(t) < len(titulo_producto) + 16:
            continue  # línea que solo repite el título
        story.append(('p', t))
    return story, specs, loc, hay_titulos


def reescribir(body, titulo_producto):
    story, specs, loc, hay_titulos = partir(body, titulo_producto)
    seguro = hay_titulos or len(specs) >= 2 or bool(loc)
    if not seguro:
        return None
    e = html.escape
    partes = []
    if story:
        partes.append('<h3>Historia</h3>')
        for tipo, t in story:
            partes.append(f'<h4>{e(t)}</h4>' if tipo == 'h' else f'<p>{e(t)}</p>')
    if specs:
        partes.append('<h3>Ficha técnica</h3><ul>' + ''.join(f'<li>{e(s)}</li>' for s in specs) + '</ul>')
    if loc:
        partes.append(f'<h3>Ubicación</h3><p>{e(", ".join(loc))}</p>')
    return '\n'.join(partes)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 1:
        print(__doc__)
        sys.exit(1)
    origen = args[0]
    titulos = '--titulos' in sys.argv
    solo_emojis = '--solo-emojis' in sys.argv
    base = re.sub(r'\.csv$', '', origen, flags=re.I)

    with open(origen, newline='', encoding='utf-8-sig') as f:
        filas = list(csv.reader(f))
    cab = filas[0]
    col = {nombre: cab.index(nombre) for nombre in ('Handle', 'Title', 'Body (HTML)', 'SEO Description') if nombre in cab}
    if 'Body (HTML)' not in col:
        sys.exit('No encuentro la columna «Body (HTML)». ¿Es una exportación de productos de Shopify?')

    informe, n_reorg, n_emojis, n_titulos = [], 0, 0, 0
    for fila in filas[1:]:
        if len(fila) <= col['Body (HTML)']:
            continue
        handle = fila[col['Handle']] if 'Handle' in col else ''
        titulo = fila[col['Title']] if 'Title' in col else ''
        body = fila[col['Body (HTML)']]
        if not body.strip() and not titulo.strip():
            continue  # fila de variante o imagen
        antes = body
        nuevo = None if solo_emojis else reescribir(body, sin_emojis(titulo).strip())
        if nuevo is None:
            nuevo = sin_emojis(body)
        else:
            n_reorg += 1
        if EMOJI.search(antes):
            n_emojis += 1
        fila[col['Body (HTML)']] = nuevo
        if 'SEO Description' in col:
            fila[col['SEO Description']] = sin_emojis(fila[col['SEO Description']]).strip()
        if titulos and 'Title' in col and EMOJI.search(titulo):
            fila[col['Title']] = sin_emojis(titulo).strip()
            n_titulos += 1
        if nuevo != antes:
            informe.append((handle, sin_emojis(titulo).strip() or handle, antes, nuevo))

    with open(base + '_preparado.csv', 'w', newline='', encoding='utf-8') as f:
        csv.writer(f).writerows(filas)

    e = html.escape
    with open(base + '_revision.html', 'w', encoding='utf-8') as f:
        f.write('<!doctype html><meta charset="utf-8"><title>Revisión de descripciones</title>'
                '<style>body{font:15px/1.5 system-ui,sans-serif;margin:2rem;color:#1a1a1a}h1{font-size:1.4rem}'
                '.p{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;border-top:1px solid #ddd;padding:1.25rem 0}'
                '.p h2{grid-column:1/-1;margin:0;font-size:1.05rem}.c{background:#f6f5f2;padding:1rem;border-radius:10px}'
                '.c b{display:block;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;opacity:.6;margin-bottom:.5rem}'
                '@media(max-width:800px){.p{grid-template-columns:1fr}}</style>')
        f.write(f'<h1>Revisión: {len(informe)} productos cambian ({n_reorg} reorganizados, {n_emojis} tenían emojis)</h1>')
        for handle, titulo, antes, nuevo in informe:
            f.write(f'<section class="p"><h2>{e(titulo)} <small>({e(handle)})</small></h2>'
                    f'<div class="c"><b>Antes</b>{antes}</div><div class="c"><b>Después</b>{nuevo}</div></section>')

    print(f'{len(informe)} productos cambian: {n_reorg} reorganizados en Historia / Ficha técnica / Ubicación, '
          f'{n_emojis} tenían emojis' + (f', {n_titulos} títulos sin emojis' if titulos else ''))
    print(f'Escrito: {base}_preparado.csv')
    print(f'Revisión: {base}_revision.html')


if __name__ == '__main__':
    main()
