#!/usr/bin/env python3
"""Quita los emojis de las descripciones de un CSV de productos exportado de Shopify.

Uso:
  python3 quitar-emojis.py productos_export.csv            -> crea productos_export_sin_emojis.csv
  python3 quitar-emojis.py productos_export.csv --informe  -> solo cuenta, no escribe nada

Toca SOLO las columnas «Body (HTML)» y «SEO Description». El resto del archivo (todas las columnas y filas,
incluidas las de variantes e imágenes) se copia tal cual, así que al importarlo en Shopify con
«Sobrescribir productos con el mismo identificador» solo cambian las descripciones.

Se quitan emojis, banderas, teclas «1️⃣», selectores de variación y similares.
Se conservan ©, ®, ™, €, °, flechas de texto (→) y cualquier letra o signo normal.
"""
import csv
import re
import sys

COLUMNAS = ('Body (HTML)', 'SEO Description')

EMOJI = re.compile(
    '(?:[0-9#*]️?⃣)'                       # teclas 1️⃣ #️⃣
    '|[\U0001F000-\U0001FAFF]'                       # emojis, banderas, símbolos y pictogramas
    '|[☀-➿]'                               # símbolos varios y dingbats (☀ ✅ ✨ ❤ ➡)
    '|[⬀-⯿]'                               # ⭐ ⬆ ⬛
    '|[⌚⌛⌨⏏⏩-⏺]'       # ⌚ ⏰ ⏩
    '|[▪▫▶◀◻-◾]'       # ▪ ▶ ◀ ◼
    '|[⤴⤵〰〽㊗㊙ℹ]'
    '|[︎️‍⃣]'                    # selectores de variación y unión
    '|[\U000E0020-\U000E007F]'                       # etiquetas de banderas regionales
)


def limpiar(texto):
    if not texto:
        return texto, 0
    n = len(EMOJI.findall(texto))
    if n == 0:
        return texto, 0
    t = EMOJI.sub('', texto)
    t = re.sub(r'[ \t ]{2,}', ' ', t)                       # espacios dobles que quedan
    t = re.sub(r'(>)[ \t ]+', r'\1', t)                      # espacio al principio de un párrafo
    t = re.sub(r'[ \t ]+(<)', r'\1', t)                      # espacio al final de un párrafo
    t = re.sub(r'<(p|li|span|strong|b|em|h[1-6])[^>]*>\s*(?:&nbsp;|<br\s*/?>)?\s*</\1>', '', t)  # elementos vacíos
    return t.strip(), n


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 1:
        print(__doc__)
        sys.exit(1)
    origen = args[0]
    solo_informe = '--informe' in sys.argv
    destino = re.sub(r'\.csv$', '', origen, flags=re.I) + '_sin_emojis.csv'

    with open(origen, newline='', encoding='utf-8-sig') as f:
        lector = csv.reader(f)
        filas = list(lector)
    if not filas:
        sys.exit('El CSV está vacío')
    cabecera = filas[0]
    indices = [cabecera.index(c) for c in COLUMNAS if c in cabecera]
    if not indices:
        sys.exit('No encuentro la columna «Body (HTML)». ¿Es una exportación de productos de Shopify?')
    i_handle = cabecera.index('Handle') if 'Handle' in cabecera else 0

    total, productos = 0, []
    for fila in filas[1:]:
        cambios = 0
        for i in indices:
            if i < len(fila):
                fila[i], n = limpiar(fila[i])
                cambios += n
        if cambios:
            total += cambios
            productos.append((fila[i_handle], cambios))

    print(f'{len(productos)} productos con emojis, {total} emojis en total')
    for handle, n in productos[:50]:
        print(f'  {handle}: {n}')
    if len(productos) > 50:
        print(f'  … y {len(productos) - 50} más')

    if not solo_informe:
        with open(destino, 'w', newline='', encoding='utf-8') as f:
            csv.writer(f).writerows(filas)
        print(f'Escrito: {destino}')


if __name__ == '__main__':
    main()
