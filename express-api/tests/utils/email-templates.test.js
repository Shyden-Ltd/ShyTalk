const {
  buildOtpEmail,
  buildLockoutEmail,
  buildResetEmail,
} = require('../../src/utils/email-templates');

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

  describe('all templates', () => {
    const templates = [
      { name: 'OTP', fn: buildOtpEmail },
      { name: 'Lockout', fn: buildLockoutEmail },
      { name: 'Reset', fn: buildResetEmail },
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

      it(`${name}: should handle 6-digit codes`, () => {
        const result = fn('000000');
        expect(result.html).toContain('000000');
      });
    });
  });
});
