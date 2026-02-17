const sharp = require('sharp');
const path = require('path');

function escXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ShyTalk brand colors
const PRIMARY = '#6750A4';
const PRIMARY_DARK = '#381E72';
const PRIMARY_LIGHT = '#D0BCFF';
const PRIMARY_CONTAINER = '#EADDFF';
const ON_PRIMARY = '#FFFFFF';
const SPEAKING_GREEN = '#4CAF50';
const OWNER_GOLD = '#FFBB00';

// ─── APP ICON (512x512) ────────────────────────────────────────────────────────
function generateIconSvg(size) {
  const s = size;
  const cx = s / 2;
  const cy = s / 2;
  const r = s * 0.46; // background circle radius

  // Speech bubble dimensions (centered, slightly left of center)
  const bw = s * 0.38; // bubble width
  const bh = s * 0.30; // bubble height
  const bx = cx - bw / 2 - s * 0.02;
  const by = cy - bh / 2 - s * 0.04;
  const br = s * 0.06; // bubble corner radius
  // Bubble tail
  const tx1 = bx + bw * 0.25;
  const ty1 = by + bh;
  const tx2 = bx + bw * 0.12;
  const ty2 = by + bh + s * 0.08;
  const tx3 = bx + bw * 0.42;
  const ty3 = by + bh;

  // Sound wave arcs (right side of bubble)
  const waveX = bx + bw + s * 0.02;
  const waveY = cy - s * 0.04;

  // Blush circles (shy indicator)
  const blushR = s * 0.025;
  const blushY = by + bh * 0.58;
  const blushLeftX = bx + bw * 0.22;
  const blushRightX = bx + bw * 0.68;

  // Three dots inside bubble (typing/chat indicator)
  const dotR = s * 0.022;
  const dotY = by + bh * 0.45;
  const dotSpacing = s * 0.065;
  const dotCenterX = bx + bw * 0.45;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7B61C4"/>
      <stop offset="50%" stop-color="${PRIMARY}"/>
      <stop offset="100%" stop-color="${PRIMARY_DARK}"/>
    </linearGradient>
    <linearGradient id="bubbleGrad" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#F0EAFF"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="130%" height="140%">
      <feDropShadow dx="0" dy="${s*0.01}" stdDeviation="${s*0.015}" flood-color="#000000" flood-opacity="0.25"/>
    </filter>
    <filter id="glow">
      <feGaussianBlur stdDeviation="${s*0.008}" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Background circle -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#bg)"/>

  <!-- Subtle inner ring -->
  <circle cx="${cx}" cy="${cy}" r="${r * 0.92}" fill="none" stroke="${PRIMARY_LIGHT}" stroke-width="${s*0.003}" opacity="0.3"/>

  <!-- Speech bubble with tail -->
  <g filter="url(#shadow)">
    <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${br}" fill="url(#bubbleGrad)"/>
    <polygon points="${tx1},${ty1} ${tx2},${ty2} ${tx3},${ty3}" fill="url(#bubbleGrad)"/>
  </g>

  <!-- Three dots (chat indicator) -->
  <circle cx="${dotCenterX - dotSpacing}" cy="${dotY}" r="${dotR}" fill="${PRIMARY}" opacity="0.7"/>
  <circle cx="${dotCenterX}" cy="${dotY}" r="${dotR}" fill="${PRIMARY}" opacity="0.5"/>
  <circle cx="${dotCenterX + dotSpacing}" cy="${dotY}" r="${dotR}" fill="${PRIMARY}" opacity="0.3"/>

  <!-- Blush marks (shy indicator) -->
  <ellipse cx="${blushLeftX}" cy="${blushY}" rx="${blushR * 1.3}" ry="${blushR}" fill="#FFB3C1" opacity="0.6"/>
  <ellipse cx="${blushRightX}" cy="${blushY}" rx="${blushR * 1.3}" ry="${blushR}" fill="#FFB3C1" opacity="0.6"/>

  <!-- Sound waves -->
  <g filter="url(#glow)">
    <path d="M ${waveX} ${waveY - s*0.04} Q ${waveX + s*0.04} ${waveY} ${waveX} ${waveY + s*0.04}"
          fill="none" stroke="${ON_PRIMARY}" stroke-width="${s*0.012}" stroke-linecap="round" opacity="0.9"/>
    <path d="M ${waveX + s*0.03} ${waveY - s*0.07} Q ${waveX + s*0.08} ${waveY} ${waveX + s*0.03} ${waveY + s*0.07}"
          fill="none" stroke="${ON_PRIMARY}" stroke-width="${s*0.010}" stroke-linecap="round" opacity="0.6"/>
    <path d="M ${waveX + s*0.06} ${waveY - s*0.10} Q ${waveX + s*0.12} ${waveY} ${waveX + s*0.06} ${waveY + s*0.10}"
          fill="none" stroke="${ON_PRIMARY}" stroke-width="${s*0.008}" stroke-linecap="round" opacity="0.35"/>
  </g>
</svg>`;
}

// ─── SCREENSHOT HELPER ──────────────────────────────────────────────────────────
function generateScreenshotSvg(width, height, title, subtitle, featureLines, iconType) {
  const isTablet = width > 1200;
  const titleSize = Math.round(height * 0.038);
  const subtitleSize = Math.round(height * 0.022);
  const featureSize = Math.round(height * 0.019);
  const lineHeight = Math.round(featureSize * 1.8);

  // Icon in the center area
  const iconSize = Math.round(Math.min(width, height) * 0.18);
  const iconY = Math.round(height * 0.22);

  // Feature icon SVG snippets
  const icons = {
    voice: (x, y, s) => `
      <circle cx="${x}" cy="${y}" r="${s*0.4}" fill="${PRIMARY}" opacity="0.15"/>
      <path d="M ${x} ${y-s*0.22} L ${x} ${y+s*0.05} M ${x-s*0.08} ${y+s*0.05} Q ${x-s*0.08} ${y+s*0.18} ${x} ${y+s*0.18} Q ${x+s*0.08} ${y+s*0.18} ${x+s*0.08} ${y+s*0.05}" stroke="${ON_PRIMARY}" stroke-width="${s*0.04}" fill="none" stroke-linecap="round"/>
      <rect x="${x-s*0.06}" y="${y-s*0.25}" width="${s*0.12}" height="${s*0.3}" rx="${s*0.06}" fill="${ON_PRIMARY}"/>
      <line x1="${x}" y1="${y+s*0.18}" x2="${x}" y2="${y+s*0.25}" stroke="${ON_PRIMARY}" stroke-width="${s*0.04}" stroke-linecap="round"/>
    `,
    chat: (x, y, s) => `
      <circle cx="${x}" cy="${y}" r="${s*0.4}" fill="${PRIMARY}" opacity="0.15"/>
      <rect x="${x-s*0.2}" y="${y-s*0.18}" width="${s*0.4}" height="${s*0.28}" rx="${s*0.06}" fill="${ON_PRIMARY}"/>
      <polygon points="${x-s*0.05},${y+s*0.1} ${x-s*0.12},${y+s*0.2} ${x+s*0.05},${y+s*0.1}" fill="${ON_PRIMARY}"/>
      <circle cx="${x-s*0.08}" cy="${y-s*0.04}" r="${s*0.025}" fill="${PRIMARY}"/>
      <circle cx="${x}" cy="${y-s*0.04}" r="${s*0.025}" fill="${PRIMARY}"/>
      <circle cx="${x+s*0.08}" cy="${y-s*0.04}" r="${s*0.025}" fill="${PRIMARY}"/>
    `,
    people: (x, y, s) => `
      <circle cx="${x}" cy="${y}" r="${s*0.4}" fill="${PRIMARY}" opacity="0.15"/>
      <circle cx="${x-s*0.1}" cy="${y-s*0.1}" r="${s*0.08}" fill="${ON_PRIMARY}"/>
      <path d="M ${x-s*0.22} ${y+s*0.12} Q ${x-s*0.1} ${y-s*0.02} ${x+s*0.02} ${y+s*0.12}" fill="${ON_PRIMARY}"/>
      <circle cx="${x+s*0.1}" cy="${y-s*0.12}" r="${s*0.07}" fill="${ON_PRIMARY}" opacity="0.8"/>
      <path d="M ${x} ${y+s*0.1} Q ${x+s*0.1} ${y} ${x+s*0.2} ${y+s*0.1}" fill="${ON_PRIMARY}" opacity="0.8"/>
    `,
    shield: (x, y, s) => `
      <circle cx="${x}" cy="${y}" r="${s*0.4}" fill="${PRIMARY}" opacity="0.15"/>
      <path d="M ${x} ${y-s*0.25} L ${x+s*0.18} ${y-s*0.12} L ${x+s*0.18} ${y+s*0.05} Q ${x+s*0.18} ${y+s*0.25} ${x} ${y+s*0.28} Q ${x-s*0.18} ${y+s*0.25} ${x-s*0.18} ${y+s*0.05} L ${x-s*0.18} ${y-s*0.12} Z" fill="${ON_PRIMARY}"/>
      <path d="M ${x-s*0.06} ${y+s*0.02} L ${x-s*0.01} ${y+s*0.08} L ${x+s*0.1} ${y-s*0.06}" fill="none" stroke="${SPEAKING_GREEN}" stroke-width="${s*0.04}" stroke-linecap="round" stroke-linejoin="round"/>
    `,
    seats: (x, y, s) => `
      <circle cx="${x}" cy="${y}" r="${s*0.4}" fill="${PRIMARY}" opacity="0.15"/>
      <circle cx="${x-s*0.15}" cy="${y-s*0.08}" r="${s*0.09}" fill="${ON_PRIMARY}" opacity="0.9"/>
      <circle cx="${x+s*0.15}" cy="${y-s*0.08}" r="${s*0.09}" fill="${ON_PRIMARY}" opacity="0.9"/>
      <circle cx="${x}" cy="${y+s*0.12}" r="${s*0.09}" fill="${ON_PRIMARY}" opacity="0.9"/>
      <path d="M ${x-s*0.15} ${y-s*0.08} L ${x+s*0.15} ${y-s*0.08} L ${x} ${y+s*0.12} Z" fill="none" stroke="${PRIMARY_LIGHT}" stroke-width="${s*0.015}" opacity="0.5"/>
    `,
  };

  const iconFn = icons[iconType] || icons.voice;
  const iconSvg = iconFn(width / 2, iconY, iconSize);

  const featuresStartY = Math.round(height * 0.48);

  let featureSvg = '';
  featureLines.forEach((line, i) => {
    const y = featuresStartY + i * lineHeight;
    const bulletX = Math.round(width * 0.12);
    const textX = Math.round(width * 0.16);
    featureSvg += `
      <circle cx="${bulletX}" cy="${y}" r="${featureSize * 0.35}" fill="${SPEAKING_GREEN}"/>
      <text x="${textX}" y="${y + featureSize * 0.35}" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="${featureSize}" fill="${ON_PRIMARY}" opacity="0.9">${escXml(line)}</text>
    `;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="screenBg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stop-color="#7B61C4"/>
      <stop offset="40%" stop-color="${PRIMARY}"/>
      <stop offset="100%" stop-color="${PRIMARY_DARK}"/>
    </linearGradient>
    <linearGradient id="accentLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${SPEAKING_GREEN}" stop-opacity="0"/>
      <stop offset="50%" stop-color="${SPEAKING_GREEN}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${SPEAKING_GREEN}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#screenBg)"/>

  <!-- Decorative circles -->
  <circle cx="${width * 0.85}" cy="${height * 0.1}" r="${width * 0.2}" fill="${PRIMARY_LIGHT}" opacity="0.06"/>
  <circle cx="${width * 0.1}" cy="${height * 0.85}" r="${width * 0.15}" fill="${PRIMARY_LIGHT}" opacity="0.05"/>
  <circle cx="${width * 0.7}" cy="${height * 0.7}" r="${width * 0.25}" fill="${PRIMARY_DARK}" opacity="0.15"/>

  <!-- Feature icon -->
  ${iconSvg}

  <!-- Title -->
  <text x="${width/2}" y="${height * 0.37}" text-anchor="middle" font-family="Segoe UI, Roboto, Arial, sans-serif" font-weight="bold" font-size="${titleSize}" fill="${ON_PRIMARY}">${escXml(title)}</text>

  <!-- Subtitle -->
  <text x="${width/2}" y="${height * 0.37 + subtitleSize * 1.6}" text-anchor="middle" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="${subtitleSize}" fill="${PRIMARY_LIGHT}" opacity="0.8">${escXml(subtitle)}</text>

  <!-- Accent line -->
  <rect x="${width*0.15}" y="${height * 0.44}" width="${width*0.7}" height="2" fill="url(#accentLine)"/>

  <!-- Feature list -->
  ${featureSvg}

  <!-- Bottom branding -->
  <text x="${width/2}" y="${height * 0.93}" text-anchor="middle" font-family="Segoe UI, Roboto, Arial, sans-serif" font-weight="bold" font-size="${Math.round(titleSize * 0.65)}" fill="${ON_PRIMARY}" opacity="0.4">ShyTalk</text>
</svg>`;
}

// ─── MAIN ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Generating ShyTalk Play Store assets...\n');

  // 1. App Icon - 512x512
  console.log('1. Generating app icon (512x512)...');
  const iconSvg = generateIconSvg(512);
  await sharp(Buffer.from(iconSvg))
    .png()
    .toFile(path.join(__dirname, 'icon', 'icon-512.png'));
  console.log('   -> icon/icon-512.png');

  // Also generate the Android adaptive icon foreground (108dp base, 432px at xxxhdpi)
  // and a high-res 1024x1024 version
  const iconSvg1024 = generateIconSvg(1024);
  await sharp(Buffer.from(iconSvg1024))
    .png()
    .toFile(path.join(__dirname, 'icon', 'icon-1024.png'));
  console.log('   -> icon/icon-1024.png');

  // 2. Phone screenshots (1080 x 1920)
  const phoneW = 1080;
  const phoneH = 1920;
  const phoneScreenshots = [
    {
      title: 'Voice Chat Rooms',
      subtitle: 'Talk with friends in real-time',
      features: [
        'Join voice rooms and listen instantly',
        'Take a seat to speak on the mic',
        'See who\'s talking with live indicators',
        'Crystal clear audio powered by LiveKit',
      ],
      icon: 'voice',
      file: 'phone-1-voice-rooms.png',
    },
    {
      title: 'Live Conversations',
      subtitle: 'Chat while you listen',
      features: [
        'Send messages in any room',
        'See real-time chat alongside voice',
        'React and engage with speakers',
        'Never miss a moment of the conversation',
      ],
      icon: 'chat',
      file: 'phone-2-live-chat.png',
    },
    {
      title: 'Room Management',
      subtitle: 'Your room, your rules',
      features: [
        'Create rooms with custom topics',
        'Invite users to speak on mic',
        'Manage seats - move, kick, or mute',
        'Assign hosts to help moderate',
      ],
      icon: 'seats',
      file: 'phone-3-room-management.png',
    },
    {
      title: 'Social Community',
      subtitle: 'Connect with like-minded people',
      features: [
        'Discover rooms on topics you love',
        'Follow your favorite speakers',
        'Build your profile and community',
        'Safe space with moderation tools',
      ],
      icon: 'people',
      file: 'phone-4-community.png',
    },
    {
      title: 'Safe & Secure',
      subtitle: 'Your privacy matters',
      features: [
        'Block and report disruptive users',
        'Room owners control who speaks',
        'Automatic ghost user removal',
        'Phone or Google sign-in',
      ],
      icon: 'shield',
      file: 'phone-5-safety.png',
    },
  ];

  console.log(`\n2. Generating ${phoneScreenshots.length} phone screenshots (${phoneW}x${phoneH})...`);
  for (const ss of phoneScreenshots) {
    const svg = generateScreenshotSvg(phoneW, phoneH, ss.title, ss.subtitle, ss.features, ss.icon);
    await sharp(Buffer.from(svg))
      .png()
      .toFile(path.join(__dirname, 'screenshots', 'phone', ss.file));
    console.log(`   -> screenshots/phone/${ss.file}`);
  }

  // 3. Tablet screenshots (2048 x 2732 for 10" tablet, portrait)
  const tabletW = 2048;
  const tabletH = 2732;
  const tabletScreenshots = [
    {
      title: 'Voice Chat Rooms',
      subtitle: 'Talk with friends in real-time on the big screen',
      features: [
        'Join voice rooms and listen instantly',
        'Take a seat to speak on the mic',
        'See who\'s talking with live speaking indicators',
        'Crystal clear audio powered by LiveKit',
        'Works beautifully on tablets',
      ],
      icon: 'voice',
      file: 'tablet-1-voice-rooms.png',
    },
    {
      title: 'Live Conversations',
      subtitle: 'Chat while you listen on your tablet',
      features: [
        'Send messages in any room',
        'See real-time chat alongside voice',
        'React and engage with speakers',
        'Spacious layout for tablet screens',
        'Never miss a moment of the conversation',
      ],
      icon: 'chat',
      file: 'tablet-2-live-chat.png',
    },
    {
      title: 'Room Management',
      subtitle: 'Full control with more screen space',
      features: [
        'Create rooms with custom topics',
        'Invite users to speak on mic',
        'Manage seats - move, kick, or mute',
        'Assign hosts to help moderate',
        'See all participants at a glance',
      ],
      icon: 'seats',
      file: 'tablet-3-room-management.png',
    },
  ];

  console.log(`\n3. Generating ${tabletScreenshots.length} tablet screenshots (${tabletW}x${tabletH})...`);
  for (const ss of tabletScreenshots) {
    const svg = generateScreenshotSvg(tabletW, tabletH, ss.title, ss.subtitle, ss.features, ss.icon);
    await sharp(Buffer.from(svg))
      .png()
      .toFile(path.join(__dirname, 'screenshots', 'tablet', ss.file));
    console.log(`   -> screenshots/tablet/${ss.file}`);
  }

  console.log('\nAll assets generated successfully!');
  console.log('\nFiles:');
  console.log('  icon/icon-512.png          - Google Play store icon (512x512)');
  console.log('  icon/icon-1024.png         - High-res icon (1024x1024)');
  console.log('  screenshots/phone/*.png    - Phone screenshots (1080x1920)');
  console.log('  screenshots/tablet/*.png   - Tablet screenshots (2048x2732)');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
