# SIDONIA · tema de Shopify

**Diseño:** tipo escaparate/marketplace (referencias: Bring a Trailer, Cars & Bids, Wallapop), con cabecera oscura con buscador, pestañas por categoría, filas de marcas, tarjetas con foto y precio y filtros en cajón. Logo de Sidonia incluido en `theme/assets` (se puede sustituir desde los ajustes).

Plataforma de catálogo y contactos para **coches (punto rojo), barcos (punto azul) y casas (punto verde)** con carácter, historia y personalidad. Tema independiente para Online Store (Liquid + plantillas JSON + CSS y JavaScript sin build). **No es una app ni un proyecto headless.**

> **Estado:** entrega completa del tema, la documentación y las pruebas locales. **El tema aún no se ha subido a una tienda de Shopify ni se ha pasado Shopify Theme Check** (el entorno de desarrollo no tenía acceso a Internet). Lee `docs/09-informe-de-pruebas.md` antes de publicar. **No se ha publicado nada ni se ha tocado el tema actual (Impact).**

## Qué hay aquí

| Carpeta | Contenido |
|---|---|
| `theme/` | El tema (se sube a Shopify) |
| `dist/` | `sidonia-theme-1.2.0.zip` (+ SHA-256): contenido de `theme/` con las carpetas en la raíz |
| `docs/` | Documentación en español (índice abajo) |
| `tools/` | Validador, generadores, previsualización local y pruebas (no van en el ZIP) |

## Empezar

1. Sube `dist/sidonia-theme-1.2.0.zip` en *Tienda online → Temas → Añadir tema → Subir archivo ZIP*. Queda **sin publicar**.
2. Sigue `docs/02-instalacion-y-previsualizacion.md` (metacampos, colecciones, páginas, menús).
3. Rellena los *Ajustes del tema* (`docs/01-guia-de-edicion.md`).
4. Antes de publicar, repasa el checklist de `docs/09-informe-de-pruebas.md` (§6).

## Documentación

| Doc | Contenido |
|---|---|
| `00-decisiones-y-supuestos.md` | Decisiones, supuestos, trazabilidad del briefing y estado para continuar |
| `01-guia-de-edicion.md` | Editar textos, colores, logos, vídeos, métricas, menús, contactos; añadir una división |
| `02-instalacion-y-previsualizacion.md` | Instalar sin publicar, páginas, plantillas, handles y redirecciones |
| `03-modelo-de-datos.md` | Metacampos (tabla completa), metaobjeto, valores de prueba, lectura desde Liquid |
| `04-colecciones-y-filtros.md` | Colecciones inteligentes, filtros de Search & Discovery, bandas, SEO de facetas |
| `05-precios-y-compra.md` | Precios altos, «a consultar», anuncios no comprables |
| `06-fichas-paso-a-paso.md` | Crear una ficha de coche, barco y casa |
| `07-video.md` | Vídeo: fuentes, formatos, reproducción |
| `08-formularios-y-leads.md` | Formularios nativos, recepción y lo que no está resuelto |
| `09-informe-de-pruebas.md` | Resultados observados, limitaciones y hechos por verificar |
| `10-matriz-de-funcionalidades.md` | Solo tema / configuración Shopify / app o backend / no implementado |
| `11-datos-pendientes.md` | Lo que falta para publicar sin placeholders |
| `12-registro-de-archivos.md` | Registro de archivos |
| `13-hoja-de-ruta-y-fase-2.md` | Fase 2 con dependencias y coste operativo |

## Desarrollo y pruebas (opcional)

Requiere Node 20+ y, para las pruebas de navegador, Playwright con Chromium (en este repositorio se usó la instalación global del entorno).

```
node tools/validate-theme.mjs                 # validador estático
node tools/preview/make-fixtures.mjs          # una vez: genera el vídeo y subtítulos de prueba
node tools/preview/server.mjs --port 4173     # previsualización local con datos de PRUEBA
node tools/tests/e2e.mjs                      # pruebas end-to-end en Chromium
node tools/tests/report.mjs                   # regenera docs/09
node tools/build-zip.mjs                      # crea dist/sidonia-theme-<versión>.zip
```

La previsualización local usa un **intérprete de Liquid propio** y piezas rotuladas **[PRUEBA]**: sirve para desarrollar y verificar, **no sustituye** a Shopify.

## Origen del código

Todo el código es original de este proyecto: no se ha usado ninguna base abierta ni código de Impact (es un tema propietario y su código no está en este repositorio; si se quiere partir de él, hay que descargarlo desde *Temas → Acciones → Descargar archivo del tema* y comprobar que su licencia lo permite). El tema no depende de ningún archivo ajeno. Los iconos son trazos funcionales de interfaz, no un logotipo. La licencia del tema la decide Sidonia.
