import { test, expect } from '@playwright/test';

test.describe('Privacy Policy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/privacy.html');
  });

  test('loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Privacy/i);
  });

  test('has viewport meta tag', async ({ page }) => {
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
  });

  test('contains key privacy sections', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toContainText('Information We Collect');
    await expect(body).toContainText('Data Storage');
  });

  test('age verification section is present and explains ID-image lifetime', async ({
    page,
  }) => {
    // PR 12 (age-verification feature) added a dedicated section
    // documenting DOB collection, ID image collection + retention
    // (deleted on decision), legal basis, and the under-18 path.
    // Pin the headline + the load-bearing claims so a future privacy
    // refactor can't silently drop the compliance text.
    const body = page.locator('body');
    await expect(body).toContainText('Age Verification');
    await expect(body).toContainText('permanently deleted as part of the same admin action');
    await expect(body).toContainText(
      'we will not accept ID submissions to override the date of birth on file',
    );
    // Non-prod warning so dev testers know not to upload real IDs.
    await expect(body).toContainText('do NOT');
  });

});

test.describe('Terms of Service', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/terms.html');
  });

  test('loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Terms/i);
  });

  test('has viewport meta tag', async ({ page }) => {
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
  });

  test('contains key terms sections', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toContainText('Terms of Service');
    await expect(body).toContainText('Acceptable Use');
  });

});

test.describe('Community Guidelines', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/community-guidelines.html');
  });

  test('loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Community/i);
  });

  test('has viewport meta tag', async ({ page }) => {
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
  });

  test('contains community-related content', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toContainText('Community Guidelines');
    await expect(body).toContainText('Be Respectful');
  });

});

test.describe('Cyber Bullying Policy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/cyber-bullying.html');
  });

  test('loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Cyber Bullying/i);
  });

  test('has viewport meta tag', async ({ page }) => {
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
  });

  test('contains anti-bullying content', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toContainText('bullying');
  });

});

test.describe('Shyden Ltd branding across legal pages', () => {
  const pages = ['/privacy.html', '/terms.html', '/community-guidelines.html', '/cyber-bullying.html'];

  for (const pagePath of pages) {
    test(`${pagePath} footer shows Shyden Ltd copyright`, async ({ page }) => {
      await page.goto(pagePath);
      const copyright = page.locator('.copyright');
      await expect(copyright).toContainText('© 2026 Shyden Ltd. All rights reserved.');
    });
  }
});

test.describe('Privacy Policy — Shyden Ltd data controller', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/privacy.html');
  });

  test('identifies Shyden Ltd as data controller', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toContainText('Shyden Ltd');
    await expect(body).toContainText('data controller');
  });

  test('includes company registration number', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toContainText('17110487');
  });

  test('includes registered address', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toContainText('71-75 Shelton Street');
    await expect(body).toContainText('WC2H 9JQ');
  });
});

test.describe('Terms of Service — Shyden Ltd service provider', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/terms.html');
  });

  test('identifies Shyden Ltd as service provider', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toContainText('Shyden Ltd');
  });

  test('includes company registration number', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toContainText('17110487');
  });
});

test.describe('Consistent styling across pages', () => {
  const pages = ['/privacy.html', '/terms.html', '/community-guidelines.html', '/cyber-bullying.html'];

  for (const pagePath of pages) {
    test(`${pagePath} uses dark theme`, async ({ page }) => {
      await page.goto(pagePath);
      const bgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      // All pages use the dark theme (--bg: #0f0d15) which is rgb(15, 13, 21)
      expect(bgColor).not.toBe('rgb(255, 255, 255)');
    });
  }
});
