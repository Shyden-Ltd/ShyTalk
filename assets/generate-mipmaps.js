const sharp = require('sharp');
const path = require('path');

// ShyTalk brand colors
const PRIMARY = '#6750A4';
const PRIMARY_DARK = '#381E72';
const PRIMARY_LIGHT = '#D0BCFF';
const ON_PRIMARY = '#FFFFFF';

// Generate the full composed icon SVG (background + foreground in a circle/square)
function generateComposedIconSvg(size, shape) {
  const s = size;
  const cx = s / 2;
  const cy = s / 2;

  // Scale factor: the 108dp adaptive icon maps to the full size
  // The visible area is the center 72/108 = 66.67%
  const scale = s / 72; // scale so the 72dp safe zone fills the output
  const offset = (s - 108 * scale) / 2; // offset to center the 108dp canvas

  // Foreground elements positioned in 108dp space, scaled to output
  const f = scale; // shorthand
  const ox = offset;
  const oy = offset;

  // Bubble dimensions (from foreground XML, in 108dp space)
  const bx1 = 33 * f + ox, by1 = 36 * f + oy;
  const bx2 = 69 * f + ox, by2 = 62 * f + oy;
  const br = 5 * f;

  // Tail
  const tx1 = 42 * f + ox, ty1 = 62 * f + oy;
  const tx2 = 37 * f + ox, ty2 = 70 * f + oy;
  const tx3 = 50 * f + ox, ty3 = 62 * f + oy;

  // Dots
  const dotR = 2.2 * f;
  const dotY = 49 * f + oy;
  const dot1X = 45 * f + ox;
  const dot2X = 51 * f + ox;
  const dot3X = 57 * f + ox;

  // Blush
  const blushRx = 3.2 * f, blushRy = 2.2 * f;
  const blushY = 55 * f + oy;
  const blushLX = 40.2 * f + ox;
  const blushRX = 60.2 * f + ox;

  // Sound waves
  const w1x = 72 * f + ox, w1y1 = 45 * f + oy, w1qx = 76.5 * f + ox, w1qy = 49 * f + oy, w1y2 = 53 * f + oy;
  const w2x = 75.5 * f + ox, w2y1 = 41.5 * f + oy, w2qx = 81.5 * f + ox, w2qy = 49 * f + oy, w2y2 = 56.5 * f + oy;
  const w3x = 79 * f + ox, w3y1 = 38 * f + oy, w3qx = 86.5 * f + ox, w3qy = 49 * f + oy, w3y2 = 60 * f + oy;

  let clipStart = '', clipEnd = '';
  if (shape === 'circle') {
    clipStart = `<clipPath id="clip"><circle cx="${cx}" cy="${cy}" r="${cx}"/></clipPath><g clip-path="url(#clip)">`;
    clipEnd = '</g>';
  } else {
    // Rounded square (squircle-like)
    const r = s * 0.22;
    clipStart = `<clipPath id="clip"><rect x="0" y="0" width="${s}" height="${s}" rx="${r}"/></clipPath><g clip-path="url(#clip)">`;
    clipEnd = '</g>';
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7B61C4"/>
      <stop offset="50%" stop-color="${PRIMARY}"/>
      <stop offset="100%" stop-color="${PRIMARY_DARK}"/>
    </linearGradient>
  </defs>

  ${clipStart}

  <!-- Background -->
  <rect x="0" y="0" width="${s}" height="${s}" fill="url(#bg)"/>

  <!-- Speech bubble body -->
  <rect x="${bx1}" y="${by1}" width="${bx2-bx1}" height="${by2-by1}" rx="${br}" fill="${ON_PRIMARY}"/>

  <!-- Speech bubble tail -->
  <polygon points="${tx1},${ty1} ${tx2},${ty2} ${tx3},${ty3}" fill="${ON_PRIMARY}"/>

  <!-- Three dots -->
  <circle cx="${dot1X}" cy="${dotY}" r="${dotR}" fill="${PRIMARY}" opacity="0.7"/>
  <circle cx="${dot2X}" cy="${dotY}" r="${dotR}" fill="${PRIMARY}" opacity="0.5"/>
  <circle cx="${dot3X}" cy="${dotY}" r="${dotR}" fill="${PRIMARY}" opacity="0.35"/>

  <!-- Blush marks -->
  <ellipse cx="${blushLX}" cy="${blushY}" rx="${blushRx}" ry="${blushRy}" fill="#FFB3C1" opacity="0.55"/>
  <ellipse cx="${blushRX}" cy="${blushY}" rx="${blushRx}" ry="${blushRy}" fill="#FFB3C1" opacity="0.55"/>

  <!-- Sound wave 1 -->
  <path d="M ${w1x} ${w1y1} Q ${w1qx} ${w1qy} ${w1x} ${w1y2}"
        fill="none" stroke="${ON_PRIMARY}" stroke-width="${1.3*f}" stroke-linecap="round" opacity="0.9"/>

  <!-- Sound wave 2 -->
  <path d="M ${w2x} ${w2y1} Q ${w2qx} ${w2qy} ${w2x} ${w2y2}"
        fill="none" stroke="${ON_PRIMARY}" stroke-width="${1.1*f}" stroke-linecap="round" opacity="0.6"/>

  <!-- Sound wave 3 -->
  <path d="M ${w3x} ${w3y1} Q ${w3qx} ${w3qy} ${w3x} ${w3y2}"
        fill="none" stroke="${ON_PRIMARY}" stroke-width="${0.9*f}" stroke-linecap="round" opacity="0.35"/>

  ${clipEnd}
</svg>`;
}

async function main() {
  const resDir = path.join(__dirname, '..', 'app', 'src', 'main', 'res');

  const densities = [
    { name: 'mdpi', size: 48 },
    { name: 'hdpi', size: 72 },
    { name: 'xhdpi', size: 96 },
    { name: 'xxhdpi', size: 144 },
    { name: 'xxxhdpi', size: 192 },
  ];

  console.log('Generating mipmap raster fallbacks...\n');

  for (const { name, size } of densities) {
    const dir = path.join(resDir, `mipmap-${name}`);

    // Regular icon (rounded square)
    const squareSvg = generateComposedIconSvg(size * 2, 'square'); // render at 2x then downscale for quality
    await sharp(Buffer.from(squareSvg))
      .resize(size, size)
      .webp({ quality: 90 })
      .toFile(path.join(dir, 'ic_launcher.webp'));
    console.log(`  mipmap-${name}/ic_launcher.webp (${size}x${size})`);

    // Round icon (circle)
    const circleSvg = generateComposedIconSvg(size * 2, 'circle');
    await sharp(Buffer.from(circleSvg))
      .resize(size, size)
      .webp({ quality: 90 })
      .toFile(path.join(dir, 'ic_launcher_round.webp'));
    console.log(`  mipmap-${name}/ic_launcher_round.webp (${size}x${size})`);
  }

  console.log('\nAll mipmap icons generated!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
