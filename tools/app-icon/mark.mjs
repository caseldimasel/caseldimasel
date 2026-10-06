// La «S» de Sidonia: dos arcos con trazo grueso y cortes rectos + el punto rojo de «Descubre»
export function sPath(cx, cy, r) {
  const a1 = (-24 * Math.PI) / 180, a2 = (156 * Math.PI) / 180;
  const c1 = [cx, cy - r], c2 = [cx, cy + r];
  const p1 = [c1[0] + r * Math.cos(a1), c1[1] + r * Math.sin(a1)];
  const mid = [cx, cy];
  const p2 = [c2[0] + r * Math.cos(a2), c2[1] + r * Math.sin(a2)];
  const f = (n) => n.toFixed(2);
  return `M ${f(p1[0])} ${f(p1[1])} A ${r} ${r} 0 1 0 ${f(mid[0])} ${f(mid[1])} A ${r} ${r} 0 1 1 ${f(p2[0])} ${f(p2[1])}`;
}
// Marca centrada en una caja de lado `size`; scale = alto de la S respecto al lado
export function markSvg({ size, scale = 0.6, bg = 'black', rounded = 0, dot = true, glow = true }) {
  const H = size * scale;               // alto total de la S (con el trazo)
  const sw = H * 0.175;                 // grosor del trazo
  const r = (H - sw) / 4;               // radio de cada arco
  const dotR = sw * 0.42;
  const totalW = 2 * r + sw + dotR * 2 + sw * 0.35;
  const cx = size / 2 - totalW / 2 + r + sw / 2;
  const cy = size / 2;
  const dotX = cx + r + sw / 2 + sw * 0.35 + dotR;
  const dotY = cy + 2 * r + sw / 2 - dotR;
  const radius = rounded * size;
  const bgFill = bg === 'black'
    ? `<defs><radialGradient id="g" cx="28%" cy="18%" r="95%"><stop offset="0" stop-color="#262626"/><stop offset=".55" stop-color="#0b0b0b"/><stop offset="1" stop-color="#000"/></radialGradient></defs><rect width="${size}" height="${size}" rx="${radius}" fill="${glow ? 'url(#g)' : '#000'}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bgFill}<path d="${sPath(cx, cy, r)}" fill="none" stroke="#fff" stroke-width="${sw.toFixed(2)}" stroke-linecap="butt"/>${dot ? `<circle cx="${dotX.toFixed(2)}" cy="${dotY.toFixed(2)}" r="${dotR.toFixed(2)}" fill="#ff4d5e"/>` : ''}</svg>`;
}
