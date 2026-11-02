# 02 · Instalación y previsualización sin publicar

> Resumen: se sube un **ZIP nuevo** como tema **sin publicar**. La tienda publicada, sus ajustes y sus apps no cambian
> hasta que alguien pulse «Publicar».

## 1. Qué necesitas

- La copia de Impact de la tienda: *Tienda online > Temas > (tema actual) > ⋯ > Descargar archivo del tema*.
  La integrada en esta entrega es la exportación `theme_export__sidonia-es-sidonia__04OCT2026-0926pm` (Impact **7.2.0**).
- Node 20 o superior y el comando `zip` (macOS y Linux lo traen).
- Para crear metacampos, colecciones y páginas por script (opcional): una app personalizada con los permisos de
  `tools/setup/provision.mjs`. El token va en una variable de entorno; **nunca** en el tema ni en el repositorio.

## 2. Construir el tema integrado

```bash
mkdir -p impact/original && unzip theme_export__….zip -d impact/original     # carpeta ignorada por git
node integration/audit-impact.mjs impact/original                            # impact/AUDITORIA.md
node integration/apply-kit.mjs --base impact/original --out impact/sidonia --replace index.json,search.json,404.json
node tools/check-kit.mjs --theme impact/sidonia                              # debe terminar «SIN ERRORES»
node integration/build-zip.mjs --theme impact/sidonia --name impact-sidonia  # dist/impact-sidonia-7.2.0.zip
```

`apply-kit` **copia** el tema (el original no se toca), añade los archivos `sidonia-*`, fusiona traducciones y ajustes,
aplica los parches de `integration/patches/` y escribe `impact/sidonia.CAMBIOS.md` (registro) e `impact/sidonia.diff`
(diferencias exactas con el original). Si un archivo del kit ya existe en Impact o un parche no encuentra su ancla,
**se detiene** sin dejar nada a medias en el original.

## 3. Subir y previsualizar sin publicar

1. *Tienda online > Temas > Añadir tema > Subir archivo ZIP* → `dist/impact-sidonia-7.2.0.zip`.
2. El tema aparece en la **biblioteca de temas, sin publicar**. Usa *⋯ > Vista previa* y *Personalizar*.
3. Comparte la vista previa con el equipo desde la propia vista previa (enlace de previsualización).
4. No pulses «Publicar» hasta completar [13 · Datos pendientes](13-datos-pendientes.md) y la lista del apartado 7.

> El ZIP incluye el `settings_data.json` de la tienda tal cual: logos, colores, menús y bloques actuales se conservan
> en el duplicado. El kit no sobrescribe ningún ajuste guardado.

## 4. Configurar la tienda (una vez)

Orden recomendado (todo reversible y sin efecto en el tema publicado salvo lo indicado):

1. **Definiciones de metacampos y metaobjetos** ([04](04-modelo-de-datos.md)). A mano o con
   `node tools/setup/provision.mjs` (simulacro) y luego `--apply`. El script **no se ha podido ejecutar contra una tienda
   real** desde el entorno de desarrollo: empieza por el simulacro y revisa la salida. Crea solo lo que no existe.
2. **Acceso de la tienda online** a los metaobjetos `sidonia_social_account` y `sidonia_timeline_event` (necesario para leerlos en Liquid).
3. **Colecciones automáticas** `explorar`, `coches`, `barcos`, `casas`, `vendidas`, `destacadas` ([06](06-colecciones-y-filtros.md)).
   Aparecen en la tienda publicada solo si las enlazas desde sus menús.
4. **Páginas** con su plantilla: `vender-con-sidonia` (page.sell), `como-vendemos` (page.how-it-works),
   `sobre-sidonia` (**page.sidonia-about**: la tienda ya tiene una `page.about` propia que se conserva), `favoritos`,
   `contacto` (page.sidonia-contact), `busco` (page.wanted). Si una página ya existe, el script la deja como está:
   asígnale la plantilla a mano.
5. **Menú** `sidonia-principal` y, en el duplicado, *Personalizar > Cabecera > Menú* → `sidonia-principal`.
6. **Filtros** en *Search & Discovery* (orden y nombres en [06](06-colecciones-y-filtros.md)).
7. **Ajustes del tema > Sidonia · …**: contacto (correo, WhatsApp), páginas, colecciones de cada categoría, colores.

## 5. Plantillas: qué se reemplaza y qué se conserva

| Plantilla | Decisión |
|---|---|
| `index.json` | La del kit. Las 5 secciones de la portada actual se conservan **desactivadas** con prefijo `impact_` (reactivables en el editor) |
| `search.json` | La del kit (`sidonia-catalog` en modo búsqueda: piezas con su tarjeta, productos normales con su precio). La de Impact queda desactivada dentro |
| `404.json` | La del kit, con la de Impact desactivada dentro |
| `page.about.json`, `page.contact.json`, `collection.cars.json`, `product.cars.json` y el resto | **Sin cambios** |
| Nuevas | `collection.sidonia/garage/harbor/estate/sold`, `product.garage/harbor/estate`, `product.sidonia-card.liquid`, `page.sell/how-it-works/sidonia-about/favorites/sidonia-contact/wanted` |

## 6. Migración de lo que ya existe en la tienda

- **Anuncios actuales** (p. ej. los de la colección `coches-en-venta` y los barcos destacados en la portada): rellena sus
  metacampos `sidonia.*` ([16](16-fichas-paso-a-paso.md)) y cambia su plantilla a `product.garage` / `product.harbor` /
  `product.estate`. Mientras no tengan `sidonia.category`, se ven exactamente como hoy.
- **`coches-en-venta`**: puedes reutilizarla como colección de Coches (*Ajustes > Sidonia · Categorías > Coches > Colección*)
  o crear `coches` automática y redirigir `/collections/coches-en-venta` → `/collections/coches` (*Navegación > Redirecciones de URL*).
- **«Vende tu casa»** (app Powerful Form Builder): se conserva. Si se retira, redirige su URL a `/pages/vender-con-sidonia?categoria=casas`.
- **Productos normales** (libros, láminas, detailing…): no necesitan nada.

## 7. Antes de publicar

- [ ] Datos pendientes de [13](13-datos-pendientes.md) completados (sin `[PRUEBA]` en ningún sitio).
- [ ] Inventario de las piezas configurado para que no se puedan comprar ([10](10-precios-y-compra.md)) y probado con un pedido de prueba bloqueado.
- [ ] Formularios enviados desde la vista previa y **recibidos** en el correo de la tienda ([07](07-formularios-y-leads.md)).
- [ ] *Theme Check* ejecutado (`shopify theme check --path impact/sidonia`) — no se pudo ejecutar en el entorno de desarrollo.
- [ ] Revisión visual en móvil real (iOS y Android) y en el editor (añadir, mover y quitar secciones).
- [ ] Copia de seguridad del tema publicado actual ([15](15-restaurar-y-actualizar-impact.md)).
