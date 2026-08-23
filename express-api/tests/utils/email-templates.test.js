const emailTemplates = require('../../src/utils/email-templates');

const {
  buildOtpEmail,
  buildLockoutEmail,
  buildResetEmail,
  buildDeletionScheduledEmail,
  buildDeletionCompleteEmail,
} = emailTemplates;

describe('Email Templates', () => {
  describe('buildOtpEmail', () => {
    it('should return correct subject', () => {
      const result = buildOtpEmail('482715');
      expect(result.subject).toBe('Your ShyTalk verification code');
    });

    it('should include the OTP code in the HTML', () => {
      const result = buildOtpEmail('482715');
      expect(result.html).toContain('482715');
    });

    it('should include expiry information', () => {
      const result = buildOtpEmail('123456');
      expect(result.html).toContain('10 minutes');
    });

    it('should include ShyTalk branding', () => {
      const result = buildOtpEmail('123456');
      expect(result.html).toContain('ShyTalk');
    });

    it('should use dark theme background', () => {
      const result = buildOtpEmail('123456');
      expect(result.html).toContain('#1a1a2e');
    });

    it('should include the ShyTalk logo from CDN', () => {
      const result = buildOtpEmail('123456');
      expect(result.html).toContain('images.shytalk.shyden.co.uk');
    });

    it('should include the OTP code pill with dark styling', () => {
      const result = buildOtpEmail('123456');
      expect(result.html).toContain('#2a2a4e');
    });

    it('should include greeting', () => {
      const result = buildOtpEmail('123456');
      expect(result.html).toContain('Hi there');
    });

    it('should return html as a string', () => {
      const result = buildOtpEmail('999999');
      expect(typeof result.html).toBe('string');
      expect(result.html.length).toBeGreaterThan(100);
    });
  });

  describe('buildLockoutEmail', () => {
    it('should return correct subject', () => {
      const result = buildLockoutEmail('987654');
      expect(result.subject).toBe('Unlock your ShyTalk account');
    });

    it('should include the OTP code', () => {
      const result = buildLockoutEmail('987654');
      expect(result.html).toContain('987654');
    });

    it('should mention account being locked', () => {
      const result = buildLockoutEmail('987654');
      expect(result.html).toMatch(/locked|too many/i);
    });

    it('should use dark theme', () => {
      const result = buildLockoutEmail('987654');
      expect(result.html).toContain('#1a1a2e');
    });

    it('should include ShyTalk logo', () => {
      const result = buildLockoutEmail('987654');
      expect(result.html).toContain('images.shytalk.shyden.co.uk');
    });
  });

  describe('buildResetEmail', () => {
    it('should return correct subject', () => {
      const result = buildResetEmail('111222');
      expect(result.subject).toBe('Reset your ShyTalk PIN');
    });

    it('should include the OTP code', () => {
      const result = buildResetEmail('111222');
      expect(result.html).toContain('111222');
    });

    it('should mention PIN reset', () => {
      const result = buildResetEmail('111222');
      expect(result.html).toMatch(/reset|pin/i);
    });

    it('should use dark theme', () => {
      const result = buildResetEmail('111222');
      expect(result.html).toContain('#1a1a2e');
    });
  });

  describe('buildDeletionScheduledEmail', () => {
    it('should return correct subject', () => {
      const result = buildDeletionScheduledEmail('2026-04-28');
      expect(result.subject).toMatch(/scheduled for deletion/i);
    });

    it('should include the deletion date in the HTML', () => {
      const result = buildDeletionScheduledEmail('2026-04-28');
      expect(result.html).toContain('2026-04-28');
    });

    it('should mention how to cancel', () => {
      const result = buildDeletionScheduledEmail('2026-04-28');
      expect(result.html).toMatch(/sign in|cancel/i);
    });

    it('should include ShyTalk branding', () => {
      const result = buildDeletionScheduledEmail('2026-04-28');
      expect(result.html).toContain('ShyTalk');
    });

    it('should use dark theme', () => {
      const result = buildDeletionScheduledEmail('2026-04-28');
      expect(result.html).toContain('#1a1a2e');
    });

    // SHY-0422: this person can still sign in -- the email itself tells them to,
    // in order to cancel -- so the in-app queue is a route that works for them.
    it('points to the in-app support form, which this person can still reach', () => {
      const result = buildDeletionScheduledEmail('2026-04-28');
      expect(result.html).toMatch(/Settings/);
      expect(result.html).toMatch(/Contact us/i);
    });
  });

  describe('buildDeletionCompleteEmail', () => {
    it('should return correct subject', () => {
      const result = buildDeletionCompleteEmail();
      expect(result.subject).toMatch(/has been deleted/i);
    });

    it('should mention permanent deletion', () => {
      const result = buildDeletionCompleteEmail();
      expect(result.html).toMatch(/permanently deleted/i);
    });

    it('should include ShyTalk branding', () => {
      const result = buildDeletionCompleteEmail();
      expect(result.html).toContain('ShyTalk');
    });

    it('should use dark theme', () => {
      const result = buildDeletionCompleteEmail();
      expect(result.html).toContain('#1a1a2e');
    });

    // SHY-0422: the account is GONE. They cannot sign in, so they cannot open the
    // in-app form -- the website is the only route left that anybody answers.
    it('points to the website, the only route left once the account is gone', () => {
      const result = buildDeletionCompleteEmail();
      expect(result.html).toContain('shyden.co.uk');
      expect(result.html).not.toMatch(/Settings/);
    });
  });

  // SHY-0422: nobody reads shytalk.help@gmail.com. An email that names it sends
  // somebody who needs help to a mailbox with no answer in it. The list of
  // builders is DERIVED from the module, so a template added later is covered
  // here the day it is written rather than the day somebody remembers.
  describe('no template names an unmonitored mailbox', () => {
    const SAMPLE_ARGS = {
      buildOtpEmail: ['482715'],
      buildLockoutEmail: [30],
      buildResetEmail: ['482715'],
      buildDeletionScheduledEmail: ['2026-04-28'],
      buildDeletionCompleteEmail: [],
      buildDataExportReadyEmail: ['https://example.invalid/export.zip', '2026-04-28'],
    };

    const exported = Object.entries(emailTemplates).filter(([, fn]) => typeof fn === 'function');

    it('has sample arguments for every exported builder', () => {
      const missing = exported.map(([name]) => name).filter((name) => !SAMPLE_ARGS[name]);
      expect({ buildersWithoutSampleArgs: missing }).toEqual({ buildersWithoutSampleArgs: [] });
    });

    it('covers more than one builder, so an empty export list cannot pass this quietly', () => {
      expect(exported.length).toBeGreaterThan(1);
    });

    exported.forEach(([name, fn]) => {
      it(`${name} does not print the unmonitored address`, () => {
        const { html, subject } = fn(...(SAMPLE_ARGS[name] || []));
        expect({ template: name, html }).toEqual({
          template: name,
          html: expect.not.stringContaining('shytalk.help@gmail.com'),
        });
        expect(subject).not.toContain('shytalk.help@gmail.com');
      });

      it(`${name} does not offer a mailto link at all`, () => {
        const { html } = fn(...(SAMPLE_ARGS[name] || []));
        expect({ template: name, html }).toEqual({
          template: name,
          html: expect.not.stringContaining('mailto:'),
        });
      });
    });
  });

  describe('all templates', () => {
    const templates = [
      { name: 'OTP', fn: buildOtpEmail },
      { name: 'Lockout', fn: buildLockoutEmail },
      { name: 'Reset', fn: buildResetEmail },
      { name: 'DeletionScheduled', fn: () => buildDeletionScheduledEmail('2026-04-28') },
      { name: 'DeletionComplete', fn: () => buildDeletionCompleteEmail() },
    ];

    templates.forEach(({ name, fn }) => {
      it(`${name}: should include do-not-reply footer`, () => {
        const result = fn('000000');
        expect(result.html).toContain("didn't request this");
      });

      it(`${name}: should include ShyTalk tagline in footer`, () => {
        const result = fn('000000');
        expect(result.html).toContain('Voice Chat Rooms');
      });

      it(`${name}: should not include unsubscribe link (transactional)`, () => {
        const result = fn('000000');
        expect(result.html.toLowerCase()).not.toContain('unsubscribe');
      });

      it(`${name}: should return both subject and html keys`, () => {
        const result = fn('000000');
        expect(result).toHaveProperty('subject');
        expect(result).toHaveProperty('html');
        expect(typeof result.subject).toBe('string');
        expect(typeof result.html).toBe('string');
      });

      it(`${name}: should produce valid HTML structure`, () => {
        const result = fn('123456');
        expect(result.html).toContain('<!DOCTYPE html');
        expect(result.html).toContain('</html>');
      });

      if (!name.startsWith('Deletion')) {
        it(`${name}: should handle 6-digit codes`, () => {
          const result = fn('000000');
          expect(result.html).toContain('000000');
        });
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Environment-aware CDN_URL fallback (env-isolation regression)
//
// Pre-fix: CDN_URL fell back to PROD images domain unconditionally.
// Now: prod → prod CDN, local → MinIO, otherwise → dev CDN.
// ═══════════════════════════════════════════════════════════════

describe('CDN_URL env-isolation fallback', () => {
  const SAVED = {
    CDN_URL: process.env.CDN_URL,
    NODE_ENV: process.env.NODE_ENV,
  };

  afterEach(() => {
    delete process.env.CDN_URL;
    delete process.env.NODE_ENV;
    if (SAVED.CDN_URL !== undefined) process.env.CDN_URL = SAVED.CDN_URL;
    if (SAVED.NODE_ENV !== undefined) process.env.NODE_ENV = SAVED.NODE_ENV;
  });

  function loadFresh() {
    let mod;
    jest.isolateModules(() => {
      mod = require('../../src/utils/email-templates');
    });
    return mod;
  }

  it('NODE_ENV=production with no override → prod CDN', () => {
    delete process.env.CDN_URL;
    process.env.NODE_ENV = 'production';
    const { buildOtpEmail } = loadFresh();
    const email = buildOtpEmail('123456');
    expect(email.html).toContain('https://images.shytalk.shyden.co.uk/');
    expect(email.html).not.toContain('dev-images.shytalk.shyden.co.uk');
  });

  it('NODE_ENV=local with no override → localhost MinIO (NOT prod, NOT dev)', () => {
    delete process.env.CDN_URL;
    process.env.NODE_ENV = 'local';
    const { buildOtpEmail } = loadFresh();
    const email = buildOtpEmail('123456');
    expect(email.html).toContain('http://localhost:9002/shytalk-media/');
    expect(email.html).not.toContain('shytalk.shyden.co.uk');
  });

  it('NODE_ENV=development with no override → dev CDN (NOT prod)', () => {
    delete process.env.CDN_URL;
    process.env.NODE_ENV = 'development';
    const { buildOtpEmail } = loadFresh();
    const email = buildOtpEmail('123456');
    expect(email.html).toContain('https://dev-images.shytalk.shyden.co.uk/');
  });

  it('explicit CDN_URL override beats NODE_ENV', () => {
    process.env.CDN_URL = 'https://cdn.staging.example.test';
    process.env.NODE_ENV = 'production';
    const { buildOtpEmail } = loadFresh();
    const email = buildOtpEmail('123456');
    expect(email.html).toContain('https://cdn.staging.example.test/');
    expect(email.html).not.toContain('shytalk.shyden.co.uk');
  });
});
