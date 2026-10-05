#!/usr/bin/env python3
"""Prepara las descripciones de los productos de Sidonia a partir del CSV de productos exportado de Shopify.

Para cada producto:
  1. Quita los emojis de «Body (HTML)» y «SEO Description» (y del título con --titulos), las líneas separadoras
     «xxxxxxxx» y la línea final «📩 Si te interesa… ¡contáctanos!» (la ficha ya tiene los botones de contacto).
  2. Si reconoce ficha técnica o ubicación, reescribe la descripción en tres partes con títulos, que es lo que lee la
     plantilla de anuncio del tema (sections/sidonia-listing.liquid):
         <h3>Historia</h3>       párrafos con la historia
         <h3>Ficha técnica</h3>  <ul><li>Año: 1972</li>…</ul>
         <h3>Ubicación</h3>      <p>Madrid</p>
     Reconoce el formato de la tienda: las líneas que empiezan por emoji son la ficha técnica (y se separan si están
     escritas seguidas), «Ubicación: …» o «📍 Lugar» la ubicación, «🌞 Planta baja:» un grupo de la ficha, «📍 Entorno:»
     detalles de la ubicación, y los párrafos sin emoji la historia («- …» como lista).
     Si no está seguro (no hay al menos 2 datos de ficha, ni ubicación, ni títulos), solo quita los emojis.

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
    '|[\u2194-\u2199\u21A9\u21AA]'  # ↔ ↕ ↖ … ↩ ↪
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
# «🏡 HISTORIA» o «🔧 Ficha técnica» son títulos aunque lleven emoji; «📋 Equipamiento Avantgarde» no (es un dato)
SECCION_EXACTA = re.compile(r'(su |la )?historia|ficha( t[eé]cnica)?|caracter[ií]sticas|especificaciones( t[eé]cnicas)?|datos t[eé]cnicos|ubicaci[oó]n|localizaci[oó]n')
H_LOC_DETAILS = re.compile(r'^(entorno|alrededor)', re.I)
LOC_KEY = re.compile(r'^(ubicaci|localizaci)', re.I)
CTA = re.compile(r'cont[aá]ctanos|escr[ií]benos', re.I)
PIN = '\U0001F4CD'  # 📍
MAIL = '\U0001F4E9'  # 📩
BULLET = re.compile(r'^\s*(?:[-–—•·*>]\s*|\d+[.)]\s+)')
# Un emoji (o bandera) que abre línea; para separar datos escritos seguidos («📅 Año: 1978🛣️ Kilometraje: …»)
EMOJI_START = re.compile('^(?:[0-9#*]️?⃣|[\U0001F1E6-\U0001F1FF]{2}|[\U0001F000-\U0001FAFF☀-➿⬀-⯿←-⇿⌚-⏺▪-◾⤴⤵〰〽㊗㊙ℹ])')
SPLIT_INSIDE = re.compile('(?<=[^\\s\U0001F1E6-\U0001F1FF‍️\U0001F000-\U0001FAFF☀-➿])(?=[\U0001F1E6-\U0001F1FF]{2}|[\U0001F000-\U0001FAFF☀-➿⬀-⯿⌚-⏺▪-◾])')


def sin_emojis(texto):
    t = EMOJI.sub('', texto or '')
    return re.sub(r'[ \t ]{2,}', ' ', t)


def lineas(body):
    """HTML -> lista de dicts {titulo, vineta, chincheta, emoji, texto} (texto sin etiquetas ni emojis)."""
    b = body or ''
    b = re.sub(r'<h[1-6][^>]*>', '\n#', b, flags=re.I)
    b = re.sub(r'<li[^>]*>', '\n•', b, flags=re.I)
    b = re.sub(r'</(p|li|div|h[1-6])>|<br\b[^>]*>', '\n', b, flags=re.I)
    b = re.sub(r'<[^>]+>', '', b)
    crudas = []
    for raw in html.unescape(b).replace(' ', ' ').split('\n'):
        raw = raw.strip()
        marca = ''
        if raw[:1] in ('#', '•'):
            marca, raw = raw[0], raw[1:].strip()
        if EMOJI_START.match(raw):
            partes = [x.strip() for x in SPLIT_INSIDE.split(raw) if x.strip()]
            crudas += [(marca, x) for x in partes]
        else:
            crudas.append((marca, raw))
    out = []
    for marca, raw in crudas:
        emoji = bool(EMOJI_START.match(raw))
        t = sin_emojis(raw).strip()
        vineta = marca == '•' or bool(BULLET.match(t)) and not emoji
        t = BULLET.sub('', t).strip()
        if t or MAIL in raw:
            out.append({'titulo': marca == '#', 'vineta': vineta, 'chincheta': PIN in raw, 'correo': MAIL in raw, 'emoji': emoji, 'texto': t})
    return out


def es_dato(clave, valor):
    """«Año: 1972» sí; «Un coche con mucha historia: perteneció a…» no (nombre largo o valor con frases)."""
    return bool(clave and valor and len(clave) < 28 and len(clave.split()) <= 4 and len(valor) < 80 and '. ' not in valor)


def partir(body, titulo_producto):
    """Devuelve (historia, ficha, ubicacion, detalles_ubicacion, hay_titulos).
    historia: [('p'|'li'|'h', texto)] · ficha: [('row'|'group', texto)]."""
    story, specs, details = [], [], []
    loc_key, loc_pin = '', ''
    modo, hay_titulos = 'auto', False
    implicito = False  # apartado abierto por un grupo con emoji («🌞 Planta baja:», «📍 Entorno:»), no por un título
    for L in lineas(body):
        t = L['texto']
        if L['correo'] or (CTA.search(t) and len(t) < 120):
            continue  # «📩 Si te interesa… ¡contáctanos!»: la ficha ya tiene los botones de contacto
        if not t or (len(t) > 3 and not re.sub(r'[xX_=\-]', '', t).strip()):
            continue  # separadores «xxxxxxxx»
        clave, valor = '', ''
        if ':' in t:
            clave, valor = [x.strip() for x in t.split(':', 1)]
        termina_dos_puntos = t.endswith(':') and len(t) < 40
        nombre = t.rstrip(':').strip()
        reconocido = H_STORY.match(nombre) or H_SPECS.match(nombre) or H_LOC.match(nombre)
        titulo = L['titulo'] or (not L['emoji'] and not L['vineta'] and len(t) < 34 and reconocido and not valor) \
            or (L['emoji'] and not L['vineta'] and SECCION_EXACTA.fullmatch(t.strip().lower()) is not None)
        if termina_dos_puntos and not titulo and L['emoji']:
            # Grupo dentro de la lista («🌞 Planta baja:», «📜 Historia del vehículo:»): se queda en la ficha,
            # salvo «📍 Entorno:» y «Ubicación:», que van a la ubicación.
            implicito = True
            if H_LOC_DETAILS.match(nombre):
                modo = 'loc_details'
            elif H_LOC.match(nombre):
                modo = 'loc'
            else:
                specs.append(('group', nombre))
                modo = 'specs'
            continue
        if titulo or termina_dos_puntos:
            implicito = not titulo
            if H_STORY.match(nombre):
                modo, hay_titulos = 'story', True
            elif H_LOC_DETAILS.match(nombre):
                modo = 'loc_details'
            elif H_LOC.match(nombre):
                modo, hay_titulos = 'loc', True
            elif H_SPECS.match(nombre):
                modo, hay_titulos = 'specs', True
            elif modo == 'specs' or (termina_dos_puntos and L['emoji']):
                specs.append(('group', nombre))
                modo = 'specs'
            else:
                story.append(('h', nombre))
                modo = 'story'
            continue

        if implicito and not L['emoji'] and (len(t) > 90 or '. ' in t):
            modo, implicito = 'auto', False  # un párrafo largo sin emoji vuelve a ser historia
        es_parrafo = len(t) > 110 and '. ' in t  # «💡 Un coche histórico que… Restaurado con…»: historia aunque lleve emoji

        es_clave_lugar = bool(LOC_KEY.match(clave))
        es_lugar_chincheta = L['chincheta'] and not clave and len(t.split()) <= 5
        if modo in ('loc', 'loc_details') or es_clave_lugar or es_lugar_chincheta:
            linea = valor if es_clave_lugar else t
            if not linea:
                continue
            if modo == 'loc_details':
                details.append(linea)
            elif es_clave_lugar and not loc_key:
                loc_key = linea
            elif es_lugar_chincheta and not loc_pin:
                loc_pin = linea
            elif modo == 'loc' and not loc_key and not loc_pin:
                loc_key = linea
            else:
                details.append(linea)
            continue

        if titulo_producto and titulo_producto.lower() in t.lower() and len(t) < len(titulo_producto) + 16:
            continue  # línea que solo repite el título
        if es_parrafo and modo in ('auto', 'specs'):
            story.append(('p', t))
            continue
        if modo == 'specs' or (modo == 'auto' and L['emoji']):
            specs.append(('row', f'{clave}: {valor}' if clave and len(clave) < 40 and valor else t))
            continue
        if modo == 'auto' and es_dato(clave, valor):
            specs.append(('row', f'{clave}: {valor}'))
            continue
        if titulo_producto and titulo_producto.lower() in t.lower() and len(t) < len(titulo_producto) + 16:
            continue  # línea que solo repite el título
        story.append(('li' if L['vineta'] else 'p', t))
    if loc_key and loc_pin and loc_pin != loc_key:
        specs.append(('row', loc_pin))  # «📍 Unidad nacional, procedente de Valencia» cuando ya hay «Ubicación: …»
    return story, specs, (loc_key or loc_pin), details, hay_titulos


def reescribir(body, titulo_producto):
    story, specs, loc, details, hay_titulos = partir(body, titulo_producto)
    filas = [x for x in specs if x[0] == 'row']
    seguro = hay_titulos or len(filas) >= 2 or bool(loc)
    if not seguro:
        return None
    e = html.escape
    partes = []
    if story:
        partes.append('<h3>Historia</h3>')
        lista = []
        for tipo, t in story + [('fin', '')]:
            if tipo == 'li':
                lista.append(t)
                continue
            if lista:
                partes.append('<ul>' + ''.join(f'<li>{e(x)}</li>' for x in lista) + '</ul>')
                lista = []
            if tipo == 'p':
                partes.append(f'<p>{e(t)}</p>')
            elif tipo == 'h':
                partes.append(f'<h4>{e(t)}</h4>')
    if specs:
        partes.append('<h3>Ficha técnica</h3>')
        lista = []
        for tipo, t in specs + [('fin', '')]:
            if tipo == 'row':
                lista.append(t)
                continue
            if lista:
                partes.append('<ul>' + ''.join(f'<li>{e(x)}</li>' for x in lista) + '</ul>')
                lista = []
            if tipo == 'group':
                partes.append(f'<h4>{e(t)}</h4>')
    if loc or details:
        partes.append('<h3>Ubicación</h3>')
        if loc:
            partes.append(f'<p>{e(loc)}</p>')
        if details:
            partes.append('<ul>' + ''.join(f'<li>{e(x)}</li>' for x in details) + '</ul>')
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
