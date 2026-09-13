/**
 * Canvas renderer for archived layouts. Shared by the rating app.
 *
 * Implements renderer-1 and renderer-2 (V1-SPECIFICATION §1.2). The renderer a
 * layout was authored under travels with the layout and is honoured here; a
 * layout is never re-rendered under a different renderer version.
 *
 * PRESENTATION DISCIPLINE
 * Draws the composition ONLY. No grid overlay, no direction arrows, no score,
 * no labels, no condition marks. `showArrows` is ignored entirely — arrows make
 * rotation visible for every shape and would leak a property the model excludes.
 */

export function drawLayout(ctx, layout, { width, height } = {}) {
  const canvas = layout.canvas ?? { width: 500, height: 500, background: '#FFFFFF' };
  const w = width ?? canvas.width;
  const h = height ?? canvas.height;
  const renderer = layout.meta?.rendererVersion ?? 'renderer-2';

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = canvas.background ?? '#FFFFFF';
  ctx.fillRect(0, 0, w, h);

  const sx = w / canvas.width;
  const sy = h / canvas.height;
  ctx.scale(sx, sy);

  const ordered = [...layout.elements].sort((a, b) => a.order - b.order);
  for (const e of ordered) {
    if (!e.visible) continue;
    ctx.save();
    ctx.translate(e.x, e.y);
    // Circles are rotation-invariant; rotating them would be a no-op visually
    // but is skipped explicitly so the code states the intent.
    if (e.type !== 'circle') ctx.rotate((e.rotation * Math.PI) / 180);
    ctx.fillStyle = e.color;
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 3;

    const s = e.size;
    const s2 = e.size2 ?? e.size;
    switch (e.type) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
        e.filled ? ctx.fill() : ctx.stroke();
        break;
      case 'square':
        e.filled ? ctx.fillRect(-s / 2, -s / 2, s, s) : ctx.strokeRect(-s / 2, -s / 2, s, s);
        break;
      case 'rectangle':
        e.filled ? ctx.fillRect(-s / 2, -s2 / 2, s, s2) : ctx.strokeRect(-s / 2, -s2 / 2, s, s2);
        break;
      case 'triangle': {
        ctx.beginPath();
        if (renderer === 'renderer-2') {
          ctx.moveTo(0, -s / Math.sqrt(3));
          ctx.lineTo(-s / 2, s / (2 * Math.sqrt(3)));
          ctx.lineTo(s / 2, s / (2 * Math.sqrt(3)));
        } else {
          ctx.moveTo(0, -s * 0.433);
          ctx.lineTo(-s / 2, s * 0.433);
          ctx.lineTo(s / 2, s * 0.433);
        }
        ctx.closePath();
        e.filled ? ctx.fill() : ctx.stroke();
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }
  ctx.restore();
}

/**
 * FNV-1a over the canonical serialization. Must match core/layout.js layoutHash
 * so a stimulus file can be integrity-checked in the browser without importing
 * the scorer.
 */
export function contentHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
