# 07 · Vídeo

El vídeo es el centro de la experiencia, pero **nunca se descarga hasta que el visitante lo pide** y **nunca suena sin una acción suya**.

## Fuente canónica (una sola por pieza)

El tema busca el vídeo en este orden y usa el primero que exista:

1. `sidonia.video` (referencia a archivo de vídeo de Shopify): **la fuente recomendada y canónica**.
2. El primer vídeo de los medios del producto.
3. Un vídeo externo de los medios del producto (YouTube o Vimeo).
4. `sidonia.video_url` (URL de YouTube o Vimeo).

Usa **una sola**. Si hay varias, gana la primera de la lista.

## Qué hay que subir

- **Vídeo narrativo**: el archivo original que ya se publica en redes (no el enlace de Instagram o TikTok, que **no** es una fuente de vídeo válida). Preferible **vertical 9:16**. También se admiten 16:9, 4:5 y 1:1.
- **Portada**: primera imagen del producto, con punto focal. Es también el póster del vídeo.
- **Clip de previsualización** (opcional, `sidonia.preview_clip`): 3–6 s, silencioso, ligero. Solo se reproduce en escritorio y si el visitante no ha pedido reducir movimiento ni ahorro de datos.
- **Subtítulos** (`sidonia.subtitles_file`, `.vtt`) y **transcripción** (`sidonia.transcript`) si existen. La transcripción es una vía de acceso adicional, no un sustituto.
- No subas música, vídeos ni contenido de terceros sin derechos.

Los límites de tamaño y duración de los vídeos alojados en Shopify dependen de vuestro plan y de la versión de Shopify: **compruébalos antes de subir material pesado**. Comprime con una calidad de 1080 px de altura como máximo; el tema puede limitarlo a 720 px (*Ajustes → Vídeo*).

## Cómo se reproduce

| Dónde | Comportamiento |
|---|---|
| Tarjetas (listados, home, favoritos, relacionadas) | Portada + botón «Ver vídeo» **separado del enlace a la ficha**. Al pulsar se abre un modal (`<dialog>` nativo) y **recién entonces** se crea el `<video>`. Ningún listado descarga vídeos |
| Ficha | Portada + «Ver y escuchar la historia». Al pulsar se crea el vídeo con sonido y controles nativos (pausa, volumen, progreso, subtítulos si hay pista, pantalla completa). Escritorio: reproductor junto a la información; el vertical no se estira |
| Hero y «Una historia concreta» | Mismo modal |
| Previsualización silenciosa | Solo en la ficha, si el navegador acepta la reproducción; si la rechaza no hay error visible |
| YouTube / Vimeo | No se carga ningún script hasta pulsar. Si el ajuste está activo, se pide confirmación antes de cargar el reproductor (`youtube-nocookie.com`, `dnt=1`) |

Reglas: solo un vídeo con sonido a la vez; se pausa al cerrar el modal, al salir del viewport (ficha) y al cambiar de pestaña; el vídeo completo usa `object-fit: contain` (no se recorta); las proporciones se reservan antes de cargar (sin saltos de layout); si el vídeo falla, aparece un mensaje con «Reintentar» y la ficha conserva datos y contacto.

## Datos estructurados del vídeo

Se emite `VideoObject` solo cuando hay vídeo alojado (URL pública del archivo) o de YouTube, con portada y descripción. La duración se incluye únicamente si `video_duration` está informado.
