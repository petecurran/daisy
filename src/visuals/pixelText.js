// Text as a grid of square pixels, like the rings are made of: rasterise once, keep the cells
// that are mostly ink. Shared by the chord name and the splash logo.

export const FONT = 'Shrikhand'; // bundled in src/fonts (SIL Open Font License)

export const hash = (a, b = 0) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };

export const fontReady = () => document.fonts?.check(`40px ${FONT}`) ?? true;

// Returns { w, px: [{ x, y, row, r, cell, size, near }], measure }. `near` is how many cells down
// and right the nearest pixel of the same text is, so a stacked-stripe shadow can draw each stripe
// only where it peeks out from behind the layer in front.
export function rasterText(text, px, cell, ox = 0, oy = 0, spacing = 0) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  const font = `${px}px ${FONT}, Inter, sans-serif`;
  const lift = px * 0.2; // room for ascenders that reach above the em box
  g.font = font;
  g.letterSpacing = `${spacing}px`;
  const w = Math.ceil(g.measureText(text).width);
  c.width = Math.ceil(w + px * 0.3); // Shrikhand leans right, past its advance width
  c.height = Math.ceil(px * 1.35 + lift);
  g.font = font;
  g.letterSpacing = `${spacing}px`;
  g.textBaseline = 'top';
  g.fillStyle = '#fff';
  g.fillText(text, 0, lift);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const at = (x, y) => data[(Math.min(c.height - 1, y | 0) * c.width + Math.min(c.width - 1, x | 0)) * 4 + 3];
  const out = [];
  for (let y = 0; y < c.height; y += cell) {
    for (let x = 0; x < c.width; x += cell) {
      const cover = at(x + cell * 0.3, y + cell * 0.3) + at(x + cell * 0.7, y + cell * 0.3) + at(x + cell * 0.3, y + cell * 0.7) + at(x + cell * 0.7, y + cell * 0.7);
      if (cover > 2 * 255) out.push({ x: ox + x, y: oy + y - lift, row: Math.round((oy + y) / cell), r: hash(ox + x, oy + y), cell, size: cell * 0.82 });
    }
  }
  const has = new Set(out.map((p) => `${p.x},${p.y}`));
  for (const p of out) {
    p.near = 1;
    while (p.near < 8 && !has.has(`${p.x + p.near * cell},${p.y + p.near * cell}`)) p.near++;
  }
  return { w, px: out, measure: (s) => g.measureText(s) };
}
