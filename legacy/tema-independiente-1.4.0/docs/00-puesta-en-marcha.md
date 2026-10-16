# 00 · Puesta en marcha (léelo primero)

El tema es solo la parte visual y funcional. **No crea nada en tu tienda**: ni páginas, ni colecciones, ni menús, ni metacampos. Por eso, al instalarlo en una tienda vacía, conviene seguir estos pasos. El tema ya está preparado para **no dar errores 404 en una tienda sin configurar**: los enlaces apuntan a la portada (que incluye el formulario de «Vender con Sidonia») o al catálogo completo, y «Favoritos» se abre como un cajón lateral.

> **Estado de las pruebas.** Todo se ha probado en una previsualización local con datos de prueba y con validadores propios (`tools/lint-liquid.mjs`, `tools/lint-schema.mjs`). **No se ha probado en una tienda real de Shopify** ni se ha pasado Shopify Theme Check. Si algo muestra un error en tu tienda, pégame el texto exacto (por ejemplo «Liquid error (sections/… line N): …»): indica el archivo y la línea.

## 1. Subir el tema sin publicarlo

1. Descarga `dist/sidonia-theme-1.4.0.zip` (en GitHub: abre el archivo → «Download raw file»). **No uses «Download ZIP» del repositorio**: contiene carpetas de desarrollo y Shopify no lo reconocerá.
2. *Tienda online → Temas → Añadir tema → Subir archivo ZIP*. Queda **sin publicar**. Pulsa «Personalizar» para ver el editor.
3. Mientras no publiques, tu web actual (Impact) no cambia.

## 2. Crear lo que el tema necesita (elige A o B)

### A. A mano (30–40 minutos, sin código)

| Qué | Dónde | Datos |
|---|---|---|
| **Páginas** | *Contenido → Páginas → Añadir página* | Título libre; **handle** y **plantilla** de la tabla de abajo (la plantilla se elige a la derecha, en «Plantilla de tema») |
| **Colecciones** | *Productos → Colecciones → Crear colección* → «Automatizada» | Condiciones de la tabla de abajo; plantilla `collection.coches`, `collection.barcos`… |
| **Metacampos** | *Ajustes → Datos personalizados → Productos* | Ver `03-modelo-de-datos.md` (62 definiciones; si no quieres crear todas, empieza por `reference`, `category`, `status`, `price_mode`, `hook`, `video`) |
| **Menú** | *Contenido → Menús* | Opcional: sin menú, el tema usa uno de reserva |
| **Filtros** | *Apps → Search & Discovery → Filtros* | Ver `04-colecciones-y-filtros.md` |

| Página | Handle | Plantilla |
|---|---|---|
| Vender con Sidonia | `vender` | `page.sell` |
| Cómo vendemos | `como-vendemos` | `page.how-it-works` |
| Sobre Sidonia | `sobre-sidonia` | `page.about` |
| Favoritos | `favoritos` | `page.favorites` |
| Contacto | `contacto` | `page.contact` |
| Cuéntanos qué buscas | `busco` | `page.wanted` |
| Marcas | `marcas` | `page.brands` |
| Aviso de privacidad | `privacidad` | `page.legal` |

| Colección | Handle | Plantilla | Condiciones (automatizada) |
|---|---|---|---|
| Coches | `coches` | `collection.coches` | `sidonia.category` es igual a `Coche` **y** `sidonia.status` no es igual a `Vendido` |
| Barcos | `barcos` | `collection.barcos` | ídem con `Barco` |
| Casas | `casas` | `collection.casas` | ídem con `Casa` |
| Explorar | `explorar` | `collection` | `sidonia.status` no es igual a `Vendido` |
| Archivo | `archivo` | `collection.archive` | `sidonia.status` es igual a `Vendido` |

### B. Con el script (si alguien técnico te ayuda)

`tools/setup/provision.mjs` crea las 62 definiciones de metacampos, el metaobjeto de cronología, las 5 colecciones, las 8 páginas y un menú «Sidonia (principal)». **Por defecto solo simula** y muestra lo que haría.

1. En el administrador: *Ajustes → Apps y canales de venta → Desarrollar apps → Crear una app*. En «Configuración de la API de Admin» marca: `write_products`, `write_content`, `write_online_store_navigation`, `read_publications`, `write_publications`, `write_metaobject_definitions`. Instala la app y copia el token (`shpat_…`).
2. En un terminal con Node 20+, dentro del repositorio:
   ```
   SHOPIFY_STORE=tu-tienda.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_xxx node tools/setup/provision.mjs
   SHOPIFY_STORE=tu-tienda.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_xxx node tools/setup/provision.mjs --apply
   ```
3. Si Shopify rechaza la versión de la API, añade `SHOPIFY_API_VERSION=<una vigente>`. El script **no se ha ejecutado contra una tienda real**: revisa los avisos que devuelva.
4. Es idempotente: lo que ya existe se omite. **Borra el token** al terminar.

No se puede automatizar (no hay API): activar los filtros en Search & Discovery y elegir el menú en el editor del tema.

## 3. Configurar el tema (editor → Ajustes del tema)

- **Marca y logos**: ya incluye el logotipo y las tipografías de Sidonia.
- **Divisiones**: elige la colección de cada una (si no, usa la que tenga handle `coches`, `barcos` o `casas`).
- **Páginas clave**: si dejas una vacía, se usa la página con el handle de la tabla; si tampoco existe, el tema enlaza a un bloque de la portada.
- **Contacto**: correo y WhatsApp reales. Un canal vacío **desaparece** de la web.
- Al abrir la portada en el editor verás una sección **«Puesta en marcha»** (solo visible en el editor) que lista qué falta. Bórrala al terminar.

## 4. Publicar

Cuando la revises: *Temas → Acciones → Publicar*. Hasta entonces nada cambia en la tienda real. Antes, repasa el checklist de `09-informe-de-pruebas.md` y `11-datos-pendientes.md`.
