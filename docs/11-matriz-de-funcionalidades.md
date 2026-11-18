# 11 · Matriz de funcionalidades

**Tema** = funciona con el tema integrado · **Config.** = necesita configurar algo en Shopify · **App/servidor** = requiere
app, backend o servicio externo · **No** = no implementado (fase 2 u otro).

| Funcionalidad | Tema | Config. | App/servidor | Notas |
|---|---|---|---|---|
| Portada con hero, buscador, tres mundos, selección, cómo vendemos, historia, comunidad, criterio, testimonios, propietarios, FAQ | ✔ | Textos e imágenes en el editor | — | Secciones independientes y ordenables |
| Cabecera transparente → piedra, puntos de categoría, Favoritos, «Vender con Sidonia» | ✔ | Logo blanco de cabecera transparente | — | Mecanismo nativo de Impact + parche de cabecera |
| Paleta piedra en todo Impact | ✔ | Casilla (activada) | — | Puente de variables de color |
| Colecciones Explorar/Coches/Barcos/Casas/Vendidas/Destacadas | ✔ (plantillas) | Crear colecciones automáticas | — | `provision.mjs` o a mano |
| Filtros reales, estado en URL, cargar más, orden | ✔ | Filtros en Search & Discovery | App gratuita de Shopify | 16/25 filtros |
| Rangos numéricos arbitrarios | — | — | Buscador externo | **No**: bandas de texto |
| Búsqueda en lenguaje natural | — | — | Buscador semántico | **No** (fase 2) |
| Tarjeta de pieza en secciones de Impact (destacados, relacionados, búsqueda predictiva) | ✔ | — | — | Parches `card-swap` y `price-guard` |
| Ficha de coche, barco y casa | ✔ | Metacampos y plantilla por producto | — | [16](16-fichas-paso-a-paso.md) |
| Precio editorial, «a consultar», «no publicado», vendida | ✔ | Metacampos | — | Nunca 0 |
| Bloqueo de compra de las piezas | Interfaz ✔ | **Inventario 0, sin vender sin existencias, canales** | — | Obligatorio ([10](10-precios-y-compra.md)) |
| Vídeo narrado (Shopify, YouTube, Vimeo), subtítulos, transcripción | ✔ | Subir vídeos y .vtt | — | Consentimiento para externos |
| WhatsApp y correo con referencia y URL | ✔ | Número y correo | — | — |
| Formulario de consulta vinculado a la pieza | ✔ | Correo de notificaciones | — | Formulario nativo |
| Formulario único de venta (3 pasos) | ✔ | Correo de notificaciones | — | — |
| Asignar solicitudes por categoría a correos distintos, CRM, expedientes | — | — | Backend o app de formularios | **No** (fase 2) |
| Subida de archivos de propietarios | — | — | Almacenamiento privado | **No**: se pide un enlace |
| Favoritos en el navegador | ✔ | Página `favoritos` | — | No se sincronizan entre dispositivos |
| Favoritos con cuenta, listas compartidas, likes públicos | — | — | Backend | **No** |
| Total de seguidores calculado, enlaces a redes | ✔ | Metaobjetos con acceso de tienda | — | Cifras manuales |
| Sincronización automática de seguidores | — | — | APIs oficiales | **No** |
| Testimonios autorizados | ✔ | Bloques en el editor | — | Solo con casilla «Autorizado» |
| Archivo de vendidas, «Busco algo parecido» | ✔ | Colección `vendidas` | — | — |
| Compartir ficha (Web Share / copiar enlace) | ✔ | — | — | — |
| Relacionadas | ✔ | Opcional `sidonia.related` | — | Si no, misma categoría |
| SEO: títulos, canonical, OG, migas, JSON-LD por categoría, VideoObject | ✔ | Títulos y descripciones SEO por producto | — | Sin oferta con precio 0 |
| Analítica (vista, vídeo, favoritos, filtros, contacto, formularios) | ✔ | Casilla y consentimiento | Herramienta de analítica | Sin datos personales |
| Español; traducciones | ✔ | Traducciones si se publica otro idioma | — | — |
| Alertas de nuevas piezas, comparador, agenda de visitas, panel del propietario | — | — | Varios | **No** (fase 2) |
| Comercio normal (libros, láminas, detailing…) | ✔ sin cambios | — | — | Comprobado con un producto [PRUEBA] |
