# SIDONIA · Coches, barcos y casas con alma — personalización de Impact

Plataforma de compraventa de Sidonia construida **sobre la copia licenciada de Impact 7.2.0 de la tienda**
(exportación del 4/10/2026, `theme_export__sidonia-es-sidonia`), como duplicado sin publicar. No es un tema
independiente, ni Dawn, ni una aplicación headless: son secciones, snippets, CSS y JavaScript con prefijo `sidonia-`
y cinco parches pequeños y trazables sobre archivos de Impact.

> **Este repositorio es público.** El código de Impact es licenciado y **no está aquí**: la copia original, el tema
> integrado, el ZIP y el diff viven solo en la carpeta local `impact/` y en `dist/`, que git ignora. Aquí está solo el
> trabajo propio de Sidonia (kit, parches, datos, herramientas y documentación). Si quieres guardar el tema integrado
> en GitHub, hazlo en un repositorio **privado**.

## Qué hay

| Carpeta | Contenido |
|---|---|
| `kit/` | Componentes Sidonia: 24 secciones, 37 snippets, 5 JS, 2 CSS, plantillas JSON, traducciones `sidonia.*` y grupos de ajustes «Sidonia · …» |
| `integration/` | `audit-impact.mjs` (auditoría), `apply-kit.mjs` (integra kit + parches sin tocar el original), `build-zip.mjs`, `patches/` (5 parches para Impact 7.x) e `impact/` (puente de colores y medidas) |
| `data/metafields.json` | Modelo de datos (metacampos, metaobjetos, filtros, colecciones, páginas, menú): fuente única |
| `tools/` | `check-kit.mjs` (comprobación completa), linters de Liquid y esquemas, contraste, generadores, `setup/provision.mjs` (crea definiciones en la tienda), `harness/` (arnés de pruebas en Chromium) |
| `harness/host/` | Anfitrión de pruebas genérico (no es Impact): permite probar el kit sin la copia licenciada |
| `docs/` | Documentación de entrega en español (índice abajo) y `capturas/` |
| `legacy/` | El prototipo independiente anterior, conservado como referencia. **No es la entrega** |

## Uso rápido

```bash
# 1. Copia licenciada de Impact (Shopify > Temas > … > Descargar archivo del tema), descomprimida en impact/original
node integration/audit-impact.mjs impact/original          # → impact/AUDITORIA.md
node integration/apply-kit.mjs --base impact/original --out impact/sidonia --replace index.json,search.json,404.json
node tools/check-kit.mjs --theme impact/sidonia              # Liquid, esquemas, reglas del encargo
node integration/build-zip.mjs --theme impact/sidonia --name impact-sidonia   # → dist/impact-sidonia-7.2.0.zip
# 2. Shopify > Tienda online > Temas > Añadir tema > Subir archivo ZIP  (queda SIN publicar)
```

Pruebas y capturas (necesitan Chromium y Playwright, preinstalados en el entorno de desarrollo):

```bash
node tools/harness/tests/e2e.mjs          # Impact integrado si existe impact/original; si no, el anfitrión genérico
node tools/harness/screenshots.mjs        # docs/capturas/*.png (rotuladas: arnés, datos [PRUEBA])
node tools/harness/server.mjs --port 4300 --theme impact/sidonia   # navegar el Impact integrado en local
```

## Documentación

| # | Documento |
|---|---|
| 00 | [Decisiones, supuestos y requisitos trazables](docs/00-decisiones-y-supuestos.md) |
| 01 | [Patrones de JamesEdition y acabado Apple](docs/01-patrones-jamesedition.md) |
| 02 | [Instalación y previsualización sin publicar](docs/02-instalacion.md) |
| 03 | [Sistema de diseño y contraste](docs/03-sistema-de-diseno.md) |
| 04 | [Modelo de datos](docs/04-modelo-de-datos.md) |
| 05 | [Guía de edición](docs/05-guia-de-edicion.md) |
| 06 | [Colecciones y filtros](docs/06-colecciones-y-filtros.md) |
| 07 | [Formularios y contactos](docs/07-formularios-y-leads.md) |
| 08 | [Vídeo](docs/08-video.md) |
| 09 | [Cabecera transparente, nombres públicos, propietario, ubicación y redes](docs/09-guia-cabecera-y-datos-publicos.md) |
| 10 | [Precios, «a consultar» y piezas no comprables](docs/10-precios-y-compra.md) |
| 11 | [Matriz de funcionalidades](docs/11-matriz-de-funcionalidades.md) |
| 12 | [Informe de pruebas](docs/12-informe-de-pruebas.md) |
| 13 | [Datos pendientes](docs/13-datos-pendientes.md) |
| 14 | [Registro de cambios y archivos](docs/14-registro-de-cambios.md) |
| 15 | [Restaurar y actualizar Impact](docs/15-restaurar-y-actualizar-impact.md) |
| 16 | [Fichas paso a paso: coche, barco y casa](docs/16-fichas-paso-a-paso.md) |
| 17 | [Fase 2](docs/17-fase-2.md) |
| — | [Capturas](docs/capturas/README.md) |

## Licencia

El kit, los parches y la documentación son trabajo encargado por Sidonia. Impact es un tema de Maestrooo con licencia
para la tienda de Sidonia: no se redistribuye y sus avisos se conservan intactos en los archivos de Impact.
