# 10 · Matriz de funcionalidades

Leyenda: **T** = funciona solo con el tema · **S** = necesita configuración en Shopify (sin código) · **A** = requiere app o backend · **N** = no implementado.

«Probado» se refiere a la previsualización local con datos de prueba (ver `09`). **Nada se ha probado aún en una tienda real de Shopify.**

| Funcionalidad | Estado | Qué hace falta / límite |
|---|---|---|
| Home con hero, divisiones, selección, cómo vendemos, historia, comunidad, criterio, testimonios, CTA y FAQ editables | T | Contenido real: colecciones, vídeo, cifras |
| Cabecera con favoritos y CTA de venta, menú móvil accesible | T | Menú `main-menu` opcional (hay menú de reserva) |
| Logos, isotipo, favicon, ancho, nombre de marca; texto de reserva | T | Los aporta Sidonia |
| Paleta, tipografías, escala, radios, ancho, columnas móvil | T | — |
| Contraste automático de colores de división como texto | T | — |
| Tokens CSS (color, texto, espacios, anchos, radios, sombras, capas, movimiento) | T | — |
| Tarjeta de pieza (portada, play, guardar, categoría, precio, ubicación, datos, estado, duración) | T | Datos en metacampos |
| Ficha narrativa con módulos por categoría | T + S | Definiciones de metacampos |
| Datos técnicos que ocultan lo desconocido | T | — |
| Precio publicado / a consultar / no publicado | T + S | Metacampos de precio |
| Datos estructurados (Car, Product, RealEstateListing, VideoObject) | T | Sin ofertas salvo precio publicado + disponible |
| Migas, canonical, Open Graph, títulos y metadescripciones editables | T | SEO editable en cada producto/página |
| Colecciones Coches, Barcos, Casas, Explorar, Archivo | S | Crear colecciones inteligentes |
| Filtros por catálogo completo | S | App Search & Discovery configurada |
| Filtros por bandas (año, km, eslora, superficie, habitaciones, presupuesto) | S | Mantener metacampos de banda (`tools/compute-bands.mjs`) |
| Filtros con rango numérico libre (deslizador) | N | Requiere filtro nativo de precio o integración de búsqueda |
| Estado en URL, atrás/adelante, chips, limpiar todo, estado vacío | T | — |
| Paginación real y «Cargar más» con restauración al volver | T | — |
| Orden: selección editorial y novedades | T | — |
| Orden por precio | S | Solo si el precio de variante es el público real |
| Búsqueda textual con sugerencias | T + S | Proveedor/tipo con la marca y la categoría |
| Búsqueda semántica o por lenguaje natural | N | Mejora separada (ver `13`) |
| Vídeo bajo demanda en modal; un solo audio; pausa al salir; error útil | T | Vídeo en Shopify o URL de YouTube/Vimeo |
| Previsualización silenciosa condicionada | T | Clip opcional |
| Vídeo externo con consentimiento | T | — |
| Subtítulos y transcripción | T + S | Archivos `.vtt` y texto |
| WhatsApp, email y teléfono con referencia y URL | T + S | Datos de contacto reales |
| Formulario de consulta ligado a la pieza | T + S | Correo de la tienda; **recepción por probar** |
| Formulario de propietarios en 3 pasos (con y sin JS) | T + S | Ídem |
| Reparto automático de solicitudes por categoría | A | Shopify Flow o backend |
| Expedientes, CRM, seguimiento | A | CRM/backend |
| Subida de archivos de propietarios | N (A) | Almacenamiento privado, validación en servidor, borrado |
| Favoritos anónimos (localStorage, sync entre pestañas, estado actual al abrir) | T | — |
| Favoritos con cuenta o sincronizados entre dispositivos | N (A) | Fase 2 |
| Contadores públicos de «me gusta» | N | No se implementan a propósito |
| Compartir con Web Share y copiar enlace | T | — |
| Piezas relacionadas explicables | T + S | Colección de división y/o metacampo `related` |
| Archivo de vendidas y «Busco algo parecido» | T + S | Colección `archivo`; solo con autorización del propietario |
| Cuéntanos qué buscas | T + S | Sin alertas |
| Alertas de nuevas piezas | N (A) | Fase 2 |
| Comparador de piezas | N | Fase 2 |
| Agenda de visitas | N (A) | Fase 2 |
| Panel privado de propietarios | N (A) | Fase 2 |
| Barra fija de contacto en móvil | T | — |
| Métricas de comunidad manuales con fecha | T | Cifras reales de Sidonia |
| Métricas de comunidad automáticas desde redes | N (A) | API oficial, permisos, mantenimiento. Nunca scraping |
| Testimonios, equipo (solo con autorización) | T | Contenido real |
| Newsletter | S | Bloque opcional; Shopify Email o similar; texto de consentimiento |
| Analítica: adaptador, eventos, consentimiento, sin datos personales | T | Apagada por defecto; destino opcional |
| Idioma: cadenas traducibles; español de España | T | Sin selector de idioma (no hay idiomas publicados) |
| Bloques de app (`@app`) en formularios | T + A | Una app que los use |
| Bloqueo de compra en endpoints | S | Inventario 0 y «seguir vendiendo» apagado; **por probar** |
| Páginas legales y de privacidad | S | Textos redactados por Sidonia |
| Blog (Historias) | S | Opcional |
| Cuentas de cliente (login, pedidos) | N | No forman parte de la operación; plantillas `customers/*` no incluidas |
| Tarjetas regalo | N | Plantilla `gift_card` no incluida |
| Redirecciones de URLs antiguas | S | Ver `02` |
