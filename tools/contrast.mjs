// Calcula ratios de contraste WCAG 2.x entre pares de colores.
// Uso: node tools/contrast.mjs            (tabla de la paleta Sidonia)
//      node tools/contrast.mjs #fff #000  (un par)
export function luminance(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c) : h.match(/../g);
  const [r, g, b] = v.map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.length === 2) {
    console.log(ratio(args[0], args[1]).toFixed(2));
  } else {
    const { PALETTE, PAIRS } = await import('./palette.mjs');
    const rows = PAIRS.map(([fg, bg, need, use]) => {
      const r = ratio(PALETTE[fg], PALETTE[bg]);
      return { fg, bg, r: r.toFixed(2), need, ok: r >= need ? 'sí' : 'NO', use };
    });
    console.log('| Primer plano | Fondo | Ratio | Mínimo | Cumple | Uso |');
    console.log('|---|---|---|---|---|---|');
    for (const x of rows) console.log(`| ${x.fg} \`${PALETTE[x.fg]}\` | ${x.bg} \`${PALETTE[x.bg]}\` | ${x.r}:1 | ${x.need}:1 | ${x.ok} | ${x.use} |`);
    if (rows.some((x) => x.ok === 'NO')) process.exitCode = 1;
  }
}
