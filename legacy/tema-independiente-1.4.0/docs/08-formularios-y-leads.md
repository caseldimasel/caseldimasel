# 08 · Formularios y recepción de solicitudes

## Qué hay

| Formulario | Dónde | Campos que viajan |
|---|---|---|
| Consulta sobre una pieza | Ficha | Nombre, email, teléfono (opcional), mensaje, preferencia de contacto, aviso de privacidad. **Ocultos**: tipo de consulta, pieza, referencia, categoría, URL del anuncio |
| «Busco algo parecido» | Ficha de pieza vendida | Igual que la consulta, con el tipo «Busco algo parecido a una pieza vendida» |
| Cuéntanos qué buscas | Página `busco` | Categoría, qué buscas, zona, presupuesto orientativo, datos de contacto. Sin alertas automáticas |
| Contacto | Página `contacto` | Mensaje y datos de contacto |
| Vender con Sidonia | Página `vender` | 3 pasos: categoría; datos de la pieza (campos condicionales); datos de contacto. Teléfono obligatorio |

Todos usan el **formulario de contacto nativo de Shopify** (`{% form 'contact' %}`) con campos personalizados `contact[…]`.

## Cómo funciona de verdad

- **Sin JavaScript**: se envía como cualquier formulario de Shopify. Shopify devuelve la página con el aviso de éxito (`form.posted_successfully?`) o con los errores (`form.errors`). En el formulario de propietarios se ven los tres pasos seguidos.
- **Con JavaScript**: validación en cliente (mensajes asociados a cada campo, `aria-invalid`, foco en el primer error) y envío por `fetch` al mismo destino. **El éxito se muestra solo si la página que devuelve Shopify contiene el aviso de éxito generado por Shopify.** Nunca por temporizador ni por pulsar el botón.
- Si Shopify devuelve errores, se muestran **conservando todo lo escrito**.
- Si falla la red: mensaje claro, datos intactos y el botón sigue disponible para reintentar.
- Si la respuesta no se entiende (por ejemplo la comprobación anti-spam de Shopify), el formulario se envía de forma nativa para que el navegador la gestione.
- «Enviar» el formulario de propietarios **inicia una valoración de encaje**: no implica aceptación ni compromiso de venta. Está dicho en el propio formulario.

## Quién recibe los mensajes

El **destinatario lo decide Shopify**, no el tema: es el correo de contacto de la tienda (*Ajustes → Notificaciones*, remitente/contacto del cliente). Cambiar campos del tema **no** cambia el destinatario. En el correo aparecen los campos personalizados como «Etiqueta: valor».

Además, el tema envía en cada formulario un campo `contact[tags]` (`consulta-pieza`, `propietario`, `busqueda` o `contacto`, más la categoría). Según la documentación de formularios de Shopify (no verificada en esta entrega) el contacto queda en **Clientes** con esas etiquetas, lo que permite filtrar solicitudes. Es un dato personal: infórmalo en el aviso de privacidad y comprueba en la prueba de recepción que las etiquetas se aplican.

## Qué NO está resuelto (y por qué)

| Necesidad | Estado |
|---|---|
| Repartir solicitudes automáticamente al email de cada categoría | **No implementado.** Requiere Shopify Flow (reglas sobre clientes etiquetados) o un backend propio |
| Guardar expedientes de propietarios y seguimiento (CRM) | **No implementado.** Requiere CRM/backend |
| **Subida de archivos** | **No existe en la interfaz.** Solo hay un campo para pegar un enlace a un vídeo, carpeta o anuncio. Un `<input type=file>` en el formulario nativo no almacenaría nada |
| Newsletter | Bloque opcional del pie con el formulario de cliente de Shopify. No se muestra hasta que lo añadas y escribas el texto de consentimiento real |
| Casilla de novedades | Opcional (apagada). Solo queda registrada en el correo recibido; **no suscribe a nadie automáticamente** |
| Verificar que el correo llega | **Pendiente**: requiere una prueba en la tienda (ver `09`) |

El repositorio hermano `mega` ya contiene un agente de WhatsApp y un CRM sencillo. Conectar estos formularios a ese servicio sería una integración separada: habría que añadir un endpoint receptor allí, validar y resolver la referencia **en el servidor** (los campos ocultos del navegador no son fiables) y cambiar el destino del formulario. No se ha hecho ni se da por hecho.

## Subida de archivos en el futuro (diseño)

Debe validar tamaño, número y tipo **en servidor**, limitar abuso, mantener los archivos **privados** (nunca en archivos públicos de Shopify), permitir el borrado y avisar al propietario de qué se guarda. El formulario ya admite un **bloque de aplicación** (`@app`) en el paso 2, el contacto y la consulta para que una app inyecte esa interfaz cuando exista.

## Datos que no se piden

Escrituras, DNI, números de cuenta o documentación sensible. Las consultas tampoco piden dirección exacta.

## Analítica

Un clic en WhatsApp o email se registra como **clic**, no como lead. «Inicio de formulario» y «envío confirmado» se registran solo con la respuesta real de Shopify. Nunca se envían mensajes, emails, teléfonos ni búsquedas (ver `01` y `09`).
