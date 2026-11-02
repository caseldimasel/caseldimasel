# 09 · Cabecera transparente, nombres públicos, propietario, ubicación y redes

## 1. Cabecera transparente (mecanismo de Impact)

Impact 7.2.0 vuelve la cabecera transparente cuando la **primera sección** de la página lleva el atributo
`allow-transparent-header` (lo comprueba `StoreHeader` en `assets/theme.js`). Las secciones compatibles de Impact
(Slideshow, Imagen con texto superpuesto, Vídeo, Banner de colección) tienen la casilla «Allow transparent header».
El kit hace lo mismo en:

- **Sidonia · Hero y búsqueda** → casilla «Cabecera transparente sobre este bloque» (activada por defecto).
- **Sidonia · Encabezado** (páginas) cuando lleva imagen → misma casilla.

Solo actúa si el bloque es **el primero** de la página y **tiene imagen o vídeo**; si no, la cabecera es piedra sólida
desde el primer render (sin parpadeo; Impact lo resuelve con CSS `:has()` antes de que cargue el JavaScript).

| Estado | Resultado (probado) |
|---|---|
| Inicio sobre el hero | Fondo transparente, texto y logo blancos (logo de *Cabecera > Cabecera transparente > Logo*), botón «Vender» claro, puntos con aro blanco |
| Al bajar (> 500 px, umbral de Impact) | Piedra sólida, texto oscuro; **misma altura** |
| Búsqueda o menú móvil abiertos | Panel propio de Impact sobre superficie piedra opaca `#FAF8F4` |
| Desplegable de menú abierto | Impact rellena la cabecera (`.header:has([open])`) |
| Sin JavaScript | Transparente y legible por CSS |
| Reducir movimiento | Sin animaciones; mismo comportamiento |

Ajustes que influyen (sección **Cabecera** de Impact): «Color de texto» y «Logo» de cabecera transparente, «Fijar la
cabecera» (activado en el duplicado: sin él la cabecera se va al bajar y no tiene sentido «piedra al superar el hero»),
diseño «logo a la izquierda, navegación en línea» (cambiado en el duplicado). Barra de anuncios: si se activa y es fija,
Impact la suma a la zona fija y el hero la tiene en cuenta.

Contraste sobre imágenes: degradado superior y oscurecido ajustable (20–80 %). Elige portadas sin zonas muy claras arriba a la izquierda.

## 2. Nombres públicos de las categorías

- Visibles siempre como **Coches**, **Barcos**, **Casas** (*Ajustes del tema > Sidonia · Categorías > Nombre*). Claves internas
  (no visibles): `garage`, `harbor`, `estate`. Comunidades opcionales: **SIDONIA GARAGE**, **SIDONIA HARBOR** (sin U), **SIDONIA ESTATE**
  («Tres mundos > Mostrar el nombre de la comunidad»).
- El metacampo `sidonia.category` de cada pieza debe valer exactamente `Coches`, `Barcos` o `Casas` (lista de opciones de la definición).
- El punto es decorativo (`aria-hidden`): el nombre lleva el significado. Estados de venta con texto propio: Disponible, Reservado, Vendido.

## 3. Nombre público del propietario

| Datos de la pieza | Se muestra |
|---|---|
| `owner_name` = «Lucía», `owner_show_name` = sí | «Propietario: Lucía» y «La historia de Lucía» si hay `owner_story` |
| `owner_show_name` = no (aunque haya nombre), `owner_label` = «Propietario particular» | «Propietario particular» |
| Sin autorización ni descripción | Nada |

- Es un dato **editorial y autorizado**, separado de los datos privados: su teléfono o correo **nunca** se guardan en metacampos
  (las solicitudes llegan por correo) y el tema no tiene forma de publicarlos (probado: el nombre no autorizado no aparece en ninguna página).
- No hay cuentas de propietario ni sellos de «verificado».

## 4. Ubicación pública

`sidonia.country`, `region`, `city` = dónde está **hoy** la pieza (no dónde se fabricó o matriculó).
`location_precision`: **Ciudad** (ciudad, región, país), **Región** (región, país; por defecto) o **País**. Nunca dirección
exacta ni coordenadas. El filtro «Ubicación» usa la región.

## 5. Cuentas sociales y total combinado

1. *Ajustes > Datos personalizados > Metaobjetos > Cuenta social de Sidonia* (con acceso de la tienda online).
2. Una entrada por cuenta real: red, nombre público, URL, seguidores (cifra real, opcional), «Incluir en el total», fecha de la cifra.
3. El tema:
   - suma solo las cuentas con «Incluir en el total» **y** cifra; vacío no es 0;
   - no cuenta dos veces la misma cuenta (URL normalizada o misma red + nombre) y avisa en el editor;
   - muestra «20.700 seguidores entre nuestras redes» con la aclaración «Suma de seguidores de las cuentas mostradas» y la
     fecha más reciente; no antepone «más de»;
   - sin ninguna cifra: solo «Sigue las historias de Sidonia» y los enlaces;
   - usa la misma fuente en la portada, el pie y «Sobre Sidonia».
4. Las cifras se actualizan a mano. No hay sincronización automática ni scraping ([17](17-fase-2.md)).
