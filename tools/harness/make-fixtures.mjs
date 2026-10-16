// Genera fixtures de vídeo (webm vertical 9:16 de 6 s) y subtítulos para las pruebas. Se ejecuta una vez.
import { chromium, CHROMIUM_PATH } from './pw.mjs';
import { writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent('<canvas id="c" width="360" height="640"></canvas>');
const b64 = await page.evaluate(async () => {
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  const stream = c.captureStream(24);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start(200);
  const t0 = performance.now();
  await new Promise((resolve) => {
    function frame() {
      const t = (performance.now() - t0) / 1000;
      ctx.fillStyle = '#2b2118';
      ctx.fillRect(0, 0, 360, 640);
      ctx.fillStyle = `hsl(${(t * 40) % 360},40%,45%)`;
      ctx.fillRect(40, 120 + Math.sin(t * 2) * 40, 280, 280);
      ctx.fillStyle = '#fff';
      ctx.font = '28px sans-serif';
      ctx.fillText('VÍDEO DE PRUEBA 9:16', 40, 540);
      ctx.fillText(t.toFixed(1) + ' s', 40, 580);
      if (t < 6) requestAnimationFrame(frame);
      else resolve();
    }
    frame();
  });
  rec.stop();
  await done;
  const blob = new Blob(chunks, { type: 'video/webm' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
});
writeFileSync(join(out, 'clip.webm'), Buffer.from(b64, 'base64'));
writeFileSync(join(out, 'subs.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nSubtítulo de prueba uno\n\n00:00:03.000 --> 00:00:06.000\nSubtítulo de prueba dos\n');
await browser.close();
// Añade duración al contenedor (MediaRecorder no la escribe) si el ffmpeg de Playwright está disponible.
const ff = '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';
if (existsSync(ff)) {
  execFileSync(ff, ['-y', '-loglevel', 'error', '-i', join(out, 'clip.webm'), '-c', 'copy', '-t', '6', join(out, 'clip-fixed.webm')]);
  renameSync(join(out, 'clip-fixed.webm'), join(out, 'clip.webm'));
}
console.log('fixtures generados en', out);
