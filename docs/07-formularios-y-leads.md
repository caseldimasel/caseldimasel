# 07 · Formularios y contactos

## Canales

| Canal | Dónde | Qué lleva | Qué significa |
|---|---|---|---|
| WhatsApp | Ficha (resumen, barra móvil), contacto | Número de *Sidonia · Contacto* (o el de la categoría) y mensaje con **nombre, referencia y URL** codificados | Abre WhatsApp; **no** es un mensaje recibido |
| Correo | Ficha, contacto | `mailto:` con asunto y cuerpo codificados (nombre, referencia, URL) | Abre el programa de correo del visitante; **no** se envía desde la web (lo dice un texto bajo el botón) |
| Formulario de consulta | Ficha (`#sidonia-consulta`) | Nombre, correo, teléfono opcional, canal preferido, mensaje + **tipo de consulta, categoría, referencia, nombre y URL de la pieza** | Envío real al correo de la tienda |
| Formulario de venta | `/pages/vender-con-sidonia` | 3 pasos ([abajo](#formulario-de-venta)) | Envío real al correo de la tienda |
| Contacto general y «Cuéntanos qué buscas» | `/pages/contacto`, `/pages/busco` | Nombre, correo, teléfono, mensaje (y lo que busca) | Envío real; «busco» **no** crea alertas |

Sin número o correo configurado, el botón correspondiente **no se muestra**.

## Cómo llegan

Todos los formularios usan el **formulario de contacto nativo de Shopify** (`{% form 'contact' %}`):

- Llegan al correo de *Ajustes > Notificaciones > Notificaciones del personal* (contacto). **Ningún ajuste del tema cambia
  ese destinatario**; los correos por categoría de *Sidonia · Contacto* solo se usan en los enlaces `mailto:`.
- Cada campo aparece en el correo con su etiqueta (`contact[Categoría]`, `contact[Referencia]`…). El «Tipo de consulta» permite
  filtrar en el buzón («Solicitud de venta», «Interés en una pieza», «Consulta general», «Busco algo»).
- Shopify puede mostrar una **verificación anti-spam** (`/challenge`): el script lo detecta y pasa al envío normal del navegador.

## Estados (con y sin JavaScript)

| Estado | Comportamiento |
|---|---|
| Validación | En el navegador, junto a cada campo (`aria-invalid` + mensaje asociado); el foco va al primer error |
| Enviando | Botón ocupado, «Enviando…» anunciado al lector de pantalla |
| Éxito | Solo si la respuesta de Shopify contiene el mensaje de éxito del propio formulario (`form.posted_successfully?`) |
| Error de Shopify | Los errores del servidor se muestran junto a los campos; los valores se conservan |
| Fallo de red | «No se ha podido enviar por un problema de conexión. Tus datos siguen aquí: vuelve a intentarlo.» (también si la conexión se queda colgada 25 s) |
| Sin JavaScript | Envío normal del navegador con los mismos campos, errores y mensaje de éxito |

Nunca se muestra «enviado» por un temporizador. No se guarda nada del formulario en el navegador.

## Formulario de venta

Un único formulario para Coches, Barcos y Casas:

1. **Qué es:** Coches · Barcos · Casas (con su punto). `?categoria=coches|barcos|casas` lo preselecciona si el valor es
   válido; siempre se puede cambiar. Los botones «Vender con Sidonia» de categoría ya llevan el parámetro.
2. **La pieza:** campos de la categoría elegida (coche: marca, modelo, año, km conocidos, dónde está, precio orientativo;
   barco: constructor y modelo, tipo, año, eslora, dónde está, precio; casa: tipo, ciudad o región, superficie, habitaciones, precio)
   + comunes (qué la hace especial, su historia, estado, relación con la pieza, enlace a vídeo/carpeta/anuncio).
3. **Contacto:** nombre, correo, teléfono (obligatorio si elige teléfono o WhatsApp), canal preferido, aviso de privacidad
   (obligatorio) y comunicaciones comerciales (opcional, separado y desmarcado).

- Los grupos de las categorías no elegidas se desactivan: **no se envían** ni bloquean el envío (probado).
- Texto visible: enviar inicia una **valoración de encaje**, no implica aceptación ni compromiso de venta.
- No se piden escrituras, DNI, cuentas bancarias ni documentación. **No hay subida de archivos** (`input type=file` no
  funciona con el formulario nativo): se pide un enlace. La subida real queda para la fase 2 ([17](17-fase-2.md)).
- Las solicitudes no se publican como productos.

## Ofertas («Hacer una oferta»)

En cada coche, casa o barco en venta (y en las subastas que no llegan a la reserva) hay un botón **«Hacer una oferta»**
junto al precio y en la barra de abajo. Abre una ventana con la oferta, nombre, teléfono, email, mensaje y el
consentimiento de privacidad (`snippets/sidonia-offer.liquid`, `assets/sidonia-offer.js`).

- **Inicio de sesión:** si las cuentas de cliente están activadas y el ajuste «Pedir iniciar sesión para ofertar» está
  marcado, hay que entrar antes (Shopify envía un código al email). Al volver, la ventana se abre sola con el email ya
  puesto.
- **Envío:** con el servidor de ofertas configurado ([servicios/ofertas](../servicios/ofertas/README.md)), el cliente
  recibe el email de «¡Gracias por tu oferta!» y el equipo un aviso; si no hay servidor o falla, la oferta llega al
  correo de la tienda por el formulario de contacto de Shopify (campos `Tipo: Oferta`, `Producto`, `Enlace`,
  `Precio publicado`, `Oferta`).
- Ajustes: Personalizar › Ajustes del tema › **Sidonia · Ofertas**.

## Pendiente de comprobar en la tienda (no se puede en el arnés)

- [ ] Enviar los 4 formularios desde la vista previa del duplicado y confirmar que **llegan** al correo de la tienda con todos los campos.
- [ ] Comprobar la pantalla anti-spam en un envío repetido.
- [ ] Revisar el texto del aviso de privacidad con la política real.
- [ ] Hacer una oferta de prueba (con y sin sesión) y comprobar el aviso al equipo y el email de gracias.
