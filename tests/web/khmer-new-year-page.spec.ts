import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';
const PAGE_URL = `${BASE}/events/khmer-new-year.html`;

test.describe('Khmer New Year Page', () => {
  test('page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    const response = await page.goto(PAGE_URL);
    expect(response?.ok()).toBe(true);
    expect(errors).toHaveLength(0);
  });

  test('hero section displays Khmer greeting', async ({ page }) => {
    await page.goto(PAGE_URL);
    await expect(page.locator('.hero h1')).toContainText('សួស្តីឆ្នាំថ្មី');
  });

  test('hero shows Choul Chnam Thmey subtitle', async ({ page }) => {
    await page.goto(PAGE_URL);
    await expect(page.locator('.hero .subtitle')).toContainText('Choul Chnam Thmey 2026');
  });

  test('all 6 tradition cards are present', async ({ page }) => {
    await page.goto(PAGE_URL);
    await expect(page.locator('.tradition-card')).toHaveCount(6);
  });

  test('tradition cards have titles and descriptions', async ({ page }) => {
    await page.goto(PAGE_URL);
    const cards = page.locator('.tradition-card');
    for (let i = 0; i < 6; i++) {
      const card = cards.nth(i);
      await expect(card.locator('h3')).not.toBeEmpty();
      await expect(card.locator('p')).not.toBeEmpty();
    }
  });

  test('three days section has 3 entries', async ({ page }) => {
    await page.goto(PAGE_URL);
    await expect(page.locator('.day-entry')).toHaveCount(3);
  });

  test('three days include Maha Sangkran, Virak Wanabat, Tngai Leang Sak', async ({ page }) => {
    await page.goto(PAGE_URL);
    const days = page.locator('.day-entry');
    await expect(days.nth(0)).toContainText('Maha Sangkran');
    await expect(days.nth(1)).toContainText('Virak Wanabat');
    await expect(days.nth(2)).toContainText('Tngai Leang Sak');
  });

  test('zodiac section mentions Year of the Horse', async ({ page }) => {
    await page.goto(PAGE_URL);
    const zodiac = page.locator('#zodiac');
    await expect(zodiac).toContainText('Horse');
    await expect(zodiac).toContainText('មមី');
  });

  test('zodiac table has 12 animals', async ({ page }) => {
    await page.goto(PAGE_URL);
    const rows = page.locator('#zodiac .zodiac-table tbody tr');
    await expect(rows).toHaveCount(12);
  });

  test('greetings section has multiple languages', async ({ page }) => {
    await page.goto(PAGE_URL);
    const greetings = page.locator('.greeting-item');
    const count = await greetings.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('page is responsive — no horizontal overflow at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(PAGE_URL);
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1);
  });

  test('scroll-to-top button works', async ({ page }) => {
    await page.goto(PAGE_URL);
    // Scroll down and wait for the scroll event to fire
    await page.evaluate(() => window.scrollTo(0, 2000));
    const scrollTop = page.locator('#scroll-top');
    await expect(scrollTop).toBeVisible({ timeout: 5_000 });
    await scrollTop.click();
    // Wait for smooth scroll to complete
    await page.waitForFunction(() => window.scrollY < 100, { timeout: 5_000 });
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeLessThan(100);
  });

  test('page has accessible emoji decorations (aria-hidden)', async ({ page }) => {
    await page.goto(PAGE_URL);
    const heroEmoji = page.locator('.hero-emoji');
    await expect(heroEmoji).toHaveAttribute('aria-hidden', 'true');
    const cardEmojis = page.locator('.card-emoji');
    const count = await cardEmojis.count();
    for (let i = 0; i < count; i++) {
      await expect(cardEmojis.nth(i)).toHaveAttribute('aria-hidden', 'true');
    }
  });

  test('no page links to other ShyTalk pages (standalone)', async ({ page }) => {
    await page.goto(PAGE_URL);
    const internalLinks = await page.locator('a[href^="/"]').all();
    // Only the favicon link in <head> should reference /, no body navigation links
    const bodyLinks = await page.locator('main a[href^="/"], header a[href^="/"]').count();
    expect(bodyLinks).toBe(0);
  });
});

test.describe('Language Selector Regression', () => {
  const pagesWithSelector = [
    { name: 'Landing', path: '/' },
    { name: 'Privacy', path: '/privacy.html' },
    { name: 'Terms', path: '/terms.html' },
    { name: 'Community Guidelines', path: '/community-guidelines.html' },
    { name: 'Cyber Bullying', path: '/cyber-bullying.html' },
    { name: 'Roadmap', path: '/roadmap.html' },
    { name: 'Khmer New Year', path: '/events/khmer-new-year.html' },
  ];

  for (const { name, path } of pagesWithSelector) {
    test(`${name} page has language selector button`, async ({ page }) => {
      await page.goto(`${BASE}${path}`);
      const langBtn = page.locator('.stl-lang-btn');
      await expect(langBtn).toBeVisible({ timeout: 5_000 });
    });
  }
});
