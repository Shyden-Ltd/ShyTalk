/**
 * Seasonal theme loader — date-gated CSS variable overrides + event banner.
 *
 * Fetches /events/events.json, checks if any event is active today,
 * and if so: overrides CSS custom properties and shows a seasonal banner.
 *
 * Banner adapts to page layout:
 * - Landing page (flex-centered): injects a card inside .container (not dismissible)
 * - Scrollable pages: shows a fixed bottom banner (dismissible per page view)
 *
 * Default ShyTalk theme = the inline CSS variables in each page's <style>.
 * When no event is active, this script does nothing — defaults remain.
 */

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
function cssColor(v) {
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : null;
}

function injectKeyframes() {
  if (document.getElementById('seasonal-keyframes')) return;
  const style = document.createElement('style');
  style.id = 'seasonal-keyframes';
  style.textContent = `
    @keyframes seasonalFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes seasonalSlideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    @keyframes seasonalSlideDown { from { transform: translateY(0); opacity: 1; } to { transform: translateY(100%); opacity: 0; } }
  `;
  document.head.appendChild(style);
}

(async function loadSeasonalTheme() {
  try {
    const res = await fetch('/events/events.json');
    if (!res.ok) return;
    const { events } = await res.json();
    if (!events || !events.length) return;

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const active = events.find((e) => today >= e.startDate && today < e.endDate);
    if (!active) return;

    // Override CSS custom properties with seasonal theme
    const root = document.documentElement;
    for (const [key, value] of Object.entries(active.theme)) {
      const safe = cssColor(value);
      if (!safe) continue;
      const cssVar = '--' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
      root.style.setProperty(cssVar, safe);
    }

    // Swap favicon if the event provides one
    if (active.favicon) {
      const existingFavicon = document.querySelector('link[rel="icon"]');
      if (existingFavicon) {
        existingFavicon.href = active.favicon;
      } else {
        const link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/svg+xml';
        link.href = active.favicon;
        document.head.appendChild(link);
      }
    }

    // Don't show banner on the event page itself — we're already there.
    // Check with and without .html extension (some servers strip it).
    const path = window.location.pathname;
    const eventPath = active.pageUrl;
    if (
      path === eventPath ||
      path === eventPath.replace('.html', '') ||
      path + '.html' === eventPath
    )
      return;

    // Inject animation keyframes once
    injectKeyframes();

    // Detect page layout to choose banner style
    const container = document.querySelector('.container');
    const isLandingPage = container && getComputedStyle(document.body).display === 'flex';

    if (isLandingPage) {
      injectLandingCard(active, container);
    } else {
      injectBottomBanner(active);
    }
  } catch {
    // Silently fail — seasonal theme is non-critical
  }
})();

/**
 * Landing page: a festive seasonal card inside .container.
 * Not dismissible — always visible during the event.
 */
function injectLandingCard(event, container) {
  const card = document.createElement('a');
  card.id = 'seasonal-ribbon';
  card.href = event.pageUrl;
  card.setAttribute('role', 'banner');
  card.setAttribute('aria-label', `${esc(event.name)} — learn more`);
  card.setAttribute('data-log', 'seasonal-event-link');

  const p = cssColor(event.theme.primary) || '#d4a017';
  const a = cssColor(event.theme.accent) || p;
  const glow = cssColor(event.theme.primaryGlow) || p;

  card.innerHTML = `
    <span class="seasonal-card-emoji" aria-hidden="true">\u{1FAB7}</span>
    <span class="seasonal-card-body">
      <span class="seasonal-card-title">${esc(event.name)}</span>
      <span class="seasonal-card-subtitle">${esc(event.ribbonText || 'Learn more')} \u2192</span>
    </span>
  `;

  card.style.cssText = `
    display: flex; align-items: center; gap: 14px;
    margin: 1.5rem auto 0.5rem; padding: 14px 22px;
    max-width: 400px; width: 100%;
    background: linear-gradient(135deg, ${p}18, ${a}18);
    border: 1px solid ${p}33;
    border-radius: 14px;
    color: #fff; text-decoration: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    cursor: pointer;
    animation: seasonalFadeIn 0.6s ease-out;
  `;

  card.addEventListener('mouseenter', () => {
    card.style.transform = 'translateY(-3px)';
    card.style.boxShadow = `0 8px 32px ${p}30`;
    card.style.borderColor = `${glow}66`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
    card.style.boxShadow = '';
    card.style.borderColor = `${p}33`;
  });

  const emoji = card.querySelector('.seasonal-card-emoji');
  emoji.style.cssText =
    'font-size: 1.8rem; flex-shrink: 0; filter: drop-shadow(0 0 8px rgba(212,160,23,0.4));';

  const body = card.querySelector('.seasonal-card-body');
  body.style.cssText = 'display: flex; flex-direction: column; gap: 2px; text-align: left;';

  const title = card.querySelector('.seasonal-card-title');
  title.style.cssText = `font-size: 0.95rem; font-weight: 600; color: ${glow};`;

  const subtitle = card.querySelector('.seasonal-card-subtitle');
  subtitle.style.cssText = 'font-size: 0.8rem; opacity: 0.75; color: #fff;';

  // Insert after the "Coming Soon" badge for natural reading flow
  const badge = container.querySelector('.badge');
  if (badge) {
    badge.after(card);
  } else {
    const tagline = container.querySelector('.tagline');
    if (tagline) tagline.after(card);
    else container.prepend(card);
  }
}

/**
 * Scrollable pages: a fixed bottom banner above the language selector.
 * Dismissible per page view (not persisted across navigation).
 * Positioned above the language button (bottom: 76px) to avoid overlap.
 */
function injectBottomBanner(event) {
  const banner = document.createElement('div');
  banner.id = 'seasonal-ribbon';
  banner.setAttribute('role', 'banner');
  banner.setAttribute('aria-label', `${esc(event.name)} — click to learn more`);

  const p = cssColor(event.theme.primary) || '#d4a017';
  const a = cssColor(event.theme.accent) || p;

  banner.innerHTML = `
    <a href="${esc(event.pageUrl)}" class="seasonal-bottom-link" aria-label="Learn about ${esc(event.name)}">
      <span class="seasonal-bottom-emoji" aria-hidden="true">\u{1FAB7}</span>
      <span class="seasonal-bottom-text">${esc(event.ribbonText || event.name)}</span>
      <span class="seasonal-bottom-arrow" aria-hidden="true">\u2192</span>
    </a>
    <button class="seasonal-ribbon-close" aria-label="Dismiss seasonal banner">\u2715</button>
  `;

  banner.style.cssText = `
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 9990;
    display: flex; align-items: center;
    background: linear-gradient(135deg, ${p}, ${a});
    padding: 0; margin: 0;
    box-shadow: 0 -4px 20px rgba(0,0,0,0.4);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: seasonalSlideUp 0.5s ease-out;
  `;

  const link = banner.querySelector('.seasonal-bottom-link');
  link.style.cssText = `
    display: flex; align-items: center; gap: 10px;
    flex: 1; padding: 14px 20px;
    color: #fff; text-decoration: none;
    justify-content: center;
    transition: filter 0.2s;
  `;
  link.addEventListener('mouseenter', () => {
    link.style.filter = 'brightness(1.1)';
  });
  link.addEventListener('mouseleave', () => {
    link.style.filter = '';
  });

  const emoji = banner.querySelector('.seasonal-bottom-emoji');
  emoji.style.cssText = 'font-size: 1.2rem;';

  const text = banner.querySelector('.seasonal-bottom-text');
  text.style.cssText = 'font-size: 0.9rem; font-weight: 500;';

  const arrow = banner.querySelector('.seasonal-bottom-arrow');
  arrow.style.cssText = 'font-size: 1rem; opacity: 0.8;';

  const closeBtn = banner.querySelector('.seasonal-ribbon-close');
  closeBtn.style.cssText = `
    flex-shrink: 0; margin-right: 14px;
    background: rgba(255,255,255,0.15); border: none; color: #fff;
    font-size: 13px; cursor: pointer; padding: 6px 10px;
    border-radius: 6px; opacity: 0.9;
    transition: background 0.2s;
    min-width: 44px; min-height: 44px;
    display: flex; align-items: center; justify-content: center;
  `;
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.background = 'rgba(255,255,255,0.25)';
  });
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.background = 'rgba(255,255,255,0.15)';
  });
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    banner.style.animation = 'seasonalSlideDown 0.3s ease-in forwards';
    setTimeout(() => {
      banner.remove();
      // Restore language button to original position
      const langBtn = document.querySelector('.stl-lang-btn');
      if (langBtn) langBtn.style.bottom = '20px';
    }, 300);
  });

  // Push language selector button up above the banner
  const langBtn = document.querySelector('.stl-lang-btn');
  if (langBtn) langBtn.style.bottom = '64px';

  document.body.appendChild(banner);
}
