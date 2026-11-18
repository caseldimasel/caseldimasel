# 08 · Vídeo

## Fuentes (por pieza)

| Prioridad | Fuente | Cómo | Nota |
|---|---|---|---|
| 1 | Metacampo `sidonia.video` (archivo) | Sube el original a *Contenido > Archivos* y elígelo | **Fuente canónica**. Shopify genera versiones y póster |
| 2 | Vídeo en *Multimedia* del producto | Arrástralo al producto | Se usa si no hay metacampo |
| 3 | Vídeo externo del producto (YouTube/Vimeo) | Multimedia > URL | Requiere permiso del visitante |
| 4 | `sidonia.video_url` (YouTube/Vimeo) | URL | Igual que 3 |

Instagram y TikTok **no** son fuentes de vídeo reproducibles: van en `sidonia.social_url` («Ver la publicación original»).
No se descargan vídeos de redes ni música de terceros.

Opcionales: `preview_clip` (bucle silencioso de 6–12 s), `video_duration` (segundos; se muestra 1:23 solo si se conoce),
`video_language`, `subtitles_file` (.vtt) + `subtitles_lang`, `transcript`, `video_aspect` (solo externos).

## Comportamiento

- **Portada primero:** al abrir una ficha o un listado **no se descarga ningún vídeo** ni se crea ningún `<video>` (probado).
- **Sonido solo tras pulsar** «Ver y escuchar su historia» / «Ver historia». Controles nativos (pausa, volumen, subtítulos, progreso, pantalla completa).
- **Un solo vídeo con sonido**: al empezar otro, el anterior se pausa (probado). Se pausa al salir de pantalla o cerrar el modal.
- **Vertical 9:16 sin recortar ni estirar** (`object-fit: contain`, proporción reservada; probado a 0,5625). En escritorio,
  junto a la columna de datos; los horizontales ocupan el ancho.
- Portadas recortadas con **punto focal** de la imagen (*Productos > imagen > Punto focal*).
- En móvil y con ahorro de datos se usa la versión de menor resolución.
- Clips silenciosos de previsualización: desactivados por defecto en la ficha; nunca con «reducir movimiento» o ahorro
  de datos; el clip del hero tiene botón de pausa.
- **YouTube/Vimeo:** nada se carga hasta que el visitante lo acepta (youtube-nocookie; probado: 0 peticiones antes).
- Error de carga: mensaje útil con «Reintentar» y «Ver la ficha»; datos y contacto siguen visibles.
- Modal: foco atrapado, Escape cierra, el foco vuelve al botón que lo abrió (probado).

## Analítica de vídeo

`sidonia_video_start` y `sidonia_video_progress` (25/50/75/100, una vez por reproducción), con categoría, referencia y tipo
de vídeo; nunca datos personales ([11](11-matriz-de-funcionalidades.md)).
