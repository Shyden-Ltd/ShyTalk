/**
 * Tests for suggestion email templates.
 *
 * Covers all exported builders:
 *   - buildAcceptedEmail(suggestionId, title, language)
 *   - buildRejectedEmail(suggestionId, title, reason, language)
 *   - buildPlannedEmail(suggestionId, title, language)
 *   - buildCompletedEmail(suggestionId, title, language)
 *   - buildMergedEmail(suggestionId, originalId, title, language)
 *
 * Validates:
 *   - Return shape { subject, html, headers }
 *   - All 20 languages render without error
 *   - XSS in title/reason escaped
 *   - Very long title truncated
 *   - Subject length reasonable (< 200 chars)
 *   - List-Unsubscribe header present and correct format
 *   - List-Unsubscribe-Post header correct (RFC 8058)
 *   - Shyden Ltd footer present
 *   - ShyTalk branding present
 *   - Correct CTA URL using SITE_BASE env var
 *   - Suggestion ID in URL
 *   - Empty title handled gracefully
 *   - Null language defaults to English
 */

const {
  buildAcceptedEmail,
  buildRejectedEmail,
  buildPlannedEmail,
  buildCompletedEmail,
  buildMergedEmail,
} = require('../../src/utils/suggestion-email-templates');

const ALL_LANGUAGES = [
  'en',
  'ar',
  'de',
  'es',
  'fr',
  'hi',
  'id',
  'it',
  'ja',
  'ko',
  'nl',
  'pl',
  'pt',
  'ru',
  'sv',
  'th',
  'tr',
  'uk',
  'vi',
  'zh',
];

// ═══════════════════════════════════════════════════════════════
// buildAcceptedEmail
// ═══════════════════════════════════════════════════════════════

describe('buildAcceptedEmail', () => {
  test('returns { subject, html, headers } shape', () => {
    const result = buildAcceptedEmail('sug-123', 'Dark mode', 'en');
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('headers');
    expect(typeof result.subject).toBe('string');
    expect(typeof result.html).toBe('string');
    expect(typeof result.headers).toBe('object');
  });

  test('subject includes suggestion title', () => {
    const result = buildAcceptedEmail('sug-123', 'Dark mode', 'en');
    expect(result.subject).toContain('Dark mode');
  });

  test('subject contains "accepted" base text in English', () => {
    const result = buildAcceptedEmail('sug-123', 'Dark mode', 'en');
    expect(result.subject).toContain('accepted');
  });

  test('HTML contains suggestion title', () => {
    const result = buildAcceptedEmail('sug-123', 'Dark mode', 'en');
    expect(result.html).toContain('Dark mode');
  });

  test('HTML contains ShyTalk branding', () => {
    const result = buildAcceptedEmail('sug-123', 'Dark mode', 'en');
    expect(result.html).toContain('ShyTalk');
  });

  test('HTML contains Shyden Ltd footer', () => {
    const result = buildAcceptedEmail('sug-123', 'Dark mode', 'en');
    expect(result.html).toContain('Shyden Ltd');
  });

  test('HTML contains correct CTA URL with suggestion ID', () => {
    const result = buildAcceptedEmail('sug-456', 'Dark mode', 'en');
    expect(result.html).toContain('roadmap.html#suggestion-sug-456');
  });

  test('CTA URL uses SITE_BASE default', () => {
    const result = buildAcceptedEmail('sug-1', 'Title', 'en');
    expect(result.html).toContain('shytalk.shyden.co.uk/roadmap.html');
  });

  test('headers contain List-Unsubscribe', () => {
    const result = buildAcceptedEmail('sug-123', 'Dark mode', 'en');
    expect(result.headers).toHaveProperty('List-Unsubscribe');
    expect(result.headers['List-Unsubscribe']).toMatch(/^<https?:\/\/.+>$/);
  });

  test('headers contain List-Unsubscribe-Post per RFC 8058', () => {
    const result = buildAcceptedEmail('sug-123', 'Dark mode', 'en');
    expect(result.headers).toHaveProperty('List-Unsubscribe-Post');
    expect(result.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  test('List-Unsubscribe URL contains suggestion ID as token', () => {
    const result = buildAcceptedEmail('sug-789', 'Title', 'en');
    expect(result.headers['List-Unsubscribe']).toContain('sug-789');
  });

  test('all 20 languages render without error', () => {
    ALL_LANGUAGES.forEach((lang) => {
      expect(() => {
        const result = buildAcceptedEmail('sug-1', 'Test title', lang);
        expect(result.subject).toBeTruthy();
        expect(result.html).toBeTruthy();
        expect(result.headers).toBeTruthy();
      }).not.toThrow();
    });
  });

  test('all 20 languages produce localised subjects when available', () => {
    // en has a specific subject, ar has a specific subject, etc.
    const enResult = buildAcceptedEmail('sug-1', 'Title', 'en');
    const arResult = buildAcceptedEmail('sug-1', 'Title', 'ar');
    const jaResult = buildAcceptedEmail('sug-1', 'Title', 'ja');

    // Each should have a non-empty subject
    expect(enResult.subject.length).toBeGreaterThan(0);
    expect(arResult.subject.length).toBeGreaterThan(0);
    expect(jaResult.subject.length).toBeGreaterThan(0);

    // Arabic and Japanese subjects should differ from English base
    expect(arResult.subject).not.toBe(enResult.subject);
    expect(jaResult.subject).not.toBe(enResult.subject);
  });

  test('XSS in title is escaped in HTML', () => {
    const xssTitle = '<script>alert("XSS")</script>';
    const result = buildAcceptedEmail('sug-1', xssTitle, 'en');
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('&lt;script&gt;');
  });

  test('very long title is truncated in subject', () => {
    const longTitle = 'A'.repeat(200);
    const result = buildAcceptedEmail('sug-1', longTitle, 'en');
    // Subject should be reasonable length (title truncated to 60 then to 50 in getSubject)
    expect(result.subject.length).toBeLessThan(200);
    expect(result.subject).toContain('...');
  });

  test('subject length is reasonable (< 200 chars) for normal title', () => {
    const result = buildAcceptedEmail('sug-1', 'Add dark mode to voice rooms', 'en');
    expect(result.subject.length).toBeLessThan(200);
  });

  test('empty title is handled gracefully', () => {
    const result = buildAcceptedEmail('sug-1', '', 'en');
    expect(result.html).toBeTruthy();
    expect(result.html).toContain('accepted');
    expect(result.subject).toBeTruthy();
  });

  test('null title is handled gracefully', () => {
    const result = buildAcceptedEmail('sug-1', null, 'en');
    expect(result.html).toBeTruthy();
    expect(result.subject).toBeTruthy();
  });

  test('undefined title is handled gracefully', () => {
    const result = buildAcceptedEmail('sug-1', undefined, 'en');
    expect(result.html).toBeTruthy();
    expect(result.subject).toBeTruthy();
  });

  test('null language defaults to English', () => {
    const result = buildAcceptedEmail('sug-1', 'Dark mode');
    expect(result.subject).toContain('accepted');
    expect(result.html).toContain('html lang="en"');
  });

  test('undefined language defaults to English', () => {
    const result = buildAcceptedEmail('sug-1', 'Dark mode', undefined);
    expect(result.html).toContain('html lang="en"');
  });

  test('HTML is valid structure with DOCTYPE', () => {
    const result = buildAcceptedEmail('sug-1', 'Dark mode', 'en');
    expect(result.html).toContain('<!DOCTYPE html');
    expect(result.html).toContain('</html>');
  });

  test('HTML includes lang attribute matching language parameter', () => {
    const result = buildAcceptedEmail('sug-1', 'Title', 'fr');
    expect(result.html).toContain('html lang="fr"');
  });

  test('body mentions community voting', () => {
    const result = buildAcceptedEmail('sug-1', 'Title', 'en');
    expect(result.html).toMatch(/vote/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// buildRejectedEmail
// ═══════════════════════════════════════════════════════════════

describe('buildRejectedEmail', () => {
  test('returns { subject, html, headers } shape', () => {
    const result = buildRejectedEmail('sug-1', 'Title', 'Too niche', 'en');
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('headers');
  });

  test('reason is included in body', () => {
    const result = buildRejectedEmail('sug-1', 'Title', 'Already planned internally', 'en');
    expect(result.html).toContain('Already planned internally');
  });

  test('null reason is handled gracefully — shows thank you message', () => {
    const result = buildRejectedEmail('sug-1', 'Title', null, 'en');
    expect(result.html).toContain('Thank you');
    expect(result.html).not.toContain('Reason:');
  });

  test('undefined reason is handled — shows thank you message', () => {
    const result = buildRejectedEmail('sug-1', 'Title', undefined, 'en');
    expect(result.html).toContain('Thank you');
  });

  test('empty string reason is handled — shows thank you message', () => {
    const result = buildRejectedEmail('sug-1', 'Title', '', 'en');
    expect(result.html).toContain('Thank you');
  });

  test('reason with XSS is escaped', () => {
    const xssReason = '<img src=x onerror="alert(1)">';
    const result = buildRejectedEmail('sug-1', 'Title', xssReason, 'en');
    // Angle brackets are escaped so the tag cannot render
    expect(result.html).not.toContain('<img');
    expect(result.html).toContain('&lt;img');
    // Quotes are escaped so event handlers cannot execute
    expect(result.html).toContain('&quot;alert(1)&quot;');
  });

  test('subject contains declined/rejected text', () => {
    const result = buildRejectedEmail('sug-1', 'Title', null, 'en');
    expect(result.subject).toMatch(/declined/i);
  });

  test('CTA URL points to suggestions section (not specific suggestion)', () => {
    const result = buildRejectedEmail('sug-1', 'Title', null, 'en');
    expect(result.html).toContain('roadmap.html#suggestions');
  });

  test('HTML contains ShyTalk branding', () => {
    const result = buildRejectedEmail('sug-1', 'Title', null, 'en');
    expect(result.html).toContain('ShyTalk');
  });

  test('HTML contains Shyden Ltd footer', () => {
    const result = buildRejectedEmail('sug-1', 'Title', null, 'en');
    expect(result.html).toContain('Shyden Ltd');
  });

  test('headers contain List-Unsubscribe', () => {
    const result = buildRejectedEmail('sug-1', 'Title', null, 'en');
    expect(result.headers).toHaveProperty('List-Unsubscribe');
  });

  test('headers contain List-Unsubscribe-Post', () => {
    const result = buildRejectedEmail('sug-1', 'Title', null, 'en');
    expect(result.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  test('empty title is handled gracefully', () => {
    const result = buildRejectedEmail('sug-1', '', null, 'en');
    expect(result.html).toBeTruthy();
    expect(result.subject).toBeTruthy();
  });

  test('null language defaults to English', () => {
    const result = buildRejectedEmail('sug-1', 'Title', 'Reason');
    expect(result.html).toContain('html lang="en"');
  });
});

// ═══════════════════════════════════════════════════════════════
// buildPlannedEmail
// ═══════════════════════════════════════════════════════════════

describe('buildPlannedEmail', () => {
  test('returns { subject, html, headers } shape', () => {
    const result = buildPlannedEmail('sug-1', 'Title', 'en');
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('headers');
  });

  test('body mentions roadmap', () => {
    const result = buildPlannedEmail('sug-1', 'Title', 'en');
    expect(result.html).toMatch(/roadmap/i);
  });

  test('subject mentions roadmap', () => {
    const result = buildPlannedEmail('sug-1', 'Title', 'en');
    expect(result.subject).toMatch(/roadmap/i);
  });

  test('CTA URL includes suggestion ID', () => {
    const result = buildPlannedEmail('sug-plan-42', 'Title', 'en');
    expect(result.html).toContain('roadmap.html#suggestion-sug-plan-42');
  });

  test('HTML contains ShyTalk branding', () => {
    const result = buildPlannedEmail('sug-1', 'Title', 'en');
    expect(result.html).toContain('ShyTalk');
  });

  test('HTML contains Shyden Ltd footer', () => {
    const result = buildPlannedEmail('sug-1', 'Title', 'en');
    expect(result.html).toContain('Shyden Ltd');
  });

  test('headers contain List-Unsubscribe and List-Unsubscribe-Post', () => {
    const result = buildPlannedEmail('sug-1', 'Title', 'en');
    expect(result.headers).toHaveProperty('List-Unsubscribe');
    expect(result.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  test('empty title falls back to default text', () => {
    const result = buildPlannedEmail('sug-1', '', 'en');
    expect(result.html).toContain('Added to the roadmap');
  });

  test('null language defaults to English', () => {
    const result = buildPlannedEmail('sug-1', 'Title');
    expect(result.html).toContain('html lang="en"');
  });

  test('subject length is reasonable (< 200 chars)', () => {
    const result = buildPlannedEmail(
      'sug-1',
      'A moderately long title for a feature request',
      'en',
    );
    expect(result.subject.length).toBeLessThan(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// buildCompletedEmail
// ═══════════════════════════════════════════════════════════════

describe('buildCompletedEmail', () => {
  test('returns { subject, html, headers } shape', () => {
    const result = buildCompletedEmail('sug-1', 'Title', 'en');
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('headers');
  });

  test('body mentions shipped/completed', () => {
    const result = buildCompletedEmail('sug-1', 'Title', 'en');
    expect(result.html).toMatch(/shipped|completed/i);
  });

  test('subject mentions shipped', () => {
    const result = buildCompletedEmail('sug-1', 'Title', 'en');
    expect(result.subject).toMatch(/shipped/i);
  });

  test('CTA URL includes suggestion ID', () => {
    const result = buildCompletedEmail('sug-done-7', 'Title', 'en');
    expect(result.html).toContain('roadmap.html#suggestion-sug-done-7');
  });

  test('HTML contains ShyTalk branding', () => {
    const result = buildCompletedEmail('sug-1', 'Title', 'en');
    expect(result.html).toContain('ShyTalk');
  });

  test('HTML contains Shyden Ltd footer', () => {
    const result = buildCompletedEmail('sug-1', 'Title', 'en');
    expect(result.html).toContain('Shyden Ltd');
  });

  test('headers contain List-Unsubscribe and List-Unsubscribe-Post', () => {
    const result = buildCompletedEmail('sug-1', 'Title', 'en');
    expect(result.headers).toHaveProperty('List-Unsubscribe');
    expect(result.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  test('empty title falls back to default text', () => {
    const result = buildCompletedEmail('sug-1', '', 'en');
    expect(result.html).toContain('Feature shipped');
  });

  test('null language defaults to English', () => {
    const result = buildCompletedEmail('sug-1', 'Title');
    expect(result.html).toContain('html lang="en"');
  });

  test('subject length is reasonable (< 200 chars)', () => {
    const result = buildCompletedEmail('sug-1', 'A moderately long completed feature', 'en');
    expect(result.subject.length).toBeLessThan(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// buildMergedEmail
// ═══════════════════════════════════════════════════════════════

describe('buildMergedEmail', () => {
  test('returns { subject, html, headers } shape', () => {
    const result = buildMergedEmail('sug-dup', 'sug-original', 'Title', 'en');
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('headers');
  });

  test('CTA URL points to the original suggestion (not the merged one)', () => {
    const result = buildMergedEmail('sug-dup-1', 'sug-original-99', 'Title', 'en');
    expect(result.html).toContain('roadmap.html#suggestion-sug-original-99');
    expect(result.html).not.toContain('roadmap.html#suggestion-sug-dup-1');
  });

  test('body mentions merged with existing', () => {
    const result = buildMergedEmail('sug-dup', 'sug-orig', 'Title', 'en');
    expect(result.html).toMatch(/merged/i);
  });

  test('subject mentions merged', () => {
    const result = buildMergedEmail('sug-dup', 'sug-orig', 'Title', 'en');
    expect(result.subject).toMatch(/merged/i);
  });

  test('headers List-Unsubscribe uses the merged suggestion ID as token', () => {
    const result = buildMergedEmail('sug-dup-42', 'sug-orig-1', 'Title', 'en');
    expect(result.headers['List-Unsubscribe']).toContain('sug-dup-42');
  });

  test('HTML contains ShyTalk branding', () => {
    const result = buildMergedEmail('sug-dup', 'sug-orig', 'Title', 'en');
    expect(result.html).toContain('ShyTalk');
  });

  test('HTML contains Shyden Ltd footer', () => {
    const result = buildMergedEmail('sug-dup', 'sug-orig', 'Title', 'en');
    expect(result.html).toContain('Shyden Ltd');
  });

  test('headers contain List-Unsubscribe-Post per RFC 8058', () => {
    const result = buildMergedEmail('sug-dup', 'sug-orig', 'Title', 'en');
    expect(result.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  test('empty title falls back to default text', () => {
    const result = buildMergedEmail('sug-dup', 'sug-orig', '', 'en');
    expect(result.html).toContain('Suggestion merged');
  });

  test('null title falls back to default text', () => {
    const result = buildMergedEmail('sug-dup', 'sug-orig', null, 'en');
    expect(result.html).toContain('Suggestion merged');
  });

  test('null language defaults to English', () => {
    const result = buildMergedEmail('sug-dup', 'sug-orig', 'Title');
    expect(result.html).toContain('html lang="en"');
  });
});

// ═══════════════════════════════════════════════════════════════
// General / cross-builder tests
// ═══════════════════════════════════════════════════════════════

describe('all builders — common properties', () => {
  const builders = [
    {
      name: 'buildAcceptedEmail',
      fn: () => buildAcceptedEmail('sug-1', 'Test title', 'en'),
    },
    {
      name: 'buildRejectedEmail',
      fn: () => buildRejectedEmail('sug-1', 'Test title', 'Reason text', 'en'),
    },
    {
      name: 'buildPlannedEmail',
      fn: () => buildPlannedEmail('sug-1', 'Test title', 'en'),
    },
    {
      name: 'buildCompletedEmail',
      fn: () => buildCompletedEmail('sug-1', 'Test title', 'en'),
    },
    {
      name: 'buildMergedEmail',
      fn: () => buildMergedEmail('sug-1', 'sug-orig', 'Test title', 'en'),
    },
  ];

  builders.forEach(({ name, fn }) => {
    describe(name, () => {
      test('returns { subject, html, headers } shape', () => {
        const result = fn();
        expect(result).toHaveProperty('subject');
        expect(result).toHaveProperty('html');
        expect(result).toHaveProperty('headers');
        expect(typeof result.subject).toBe('string');
        expect(typeof result.html).toBe('string');
        expect(typeof result.headers).toBe('object');
      });

      test('subject is non-empty string', () => {
        const result = fn();
        expect(result.subject.length).toBeGreaterThan(0);
      });

      test('html is non-empty string', () => {
        const result = fn();
        expect(result.html.length).toBeGreaterThan(100);
      });

      test('headers has List-Unsubscribe', () => {
        const result = fn();
        expect(result.headers).toHaveProperty('List-Unsubscribe');
        expect(typeof result.headers['List-Unsubscribe']).toBe('string');
      });

      test('HTML contains ShyTalk branding', () => {
        const result = fn();
        expect(result.html).toContain('ShyTalk');
      });

      test('HTML contains Shyden Ltd footer', () => {
        const result = fn();
        expect(result.html).toContain('Shyden Ltd');
      });

      test('subject length < 200 chars', () => {
        const result = fn();
        expect(result.subject.length).toBeLessThan(200);
      });

      test('HTML is valid structure', () => {
        const result = fn();
        expect(result.html).toContain('<!DOCTYPE html');
        expect(result.html).toContain('</html>');
        expect(result.html).toContain('<body');
        expect(result.html).toContain('</body>');
      });

      test('HTML uses dark theme background', () => {
        const result = fn();
        expect(result.html).toContain('#0f1117');
      });

      test('HTML uses brand purple colour', () => {
        const result = fn();
        expect(result.html).toContain('#7c5cfc');
      });

      test('View Roadmap CTA button present', () => {
        const result = fn();
        expect(result.html).toContain('View Roadmap');
      });
    });
  });
});

describe('all builders — empty title handling', () => {
  test('buildAcceptedEmail with empty title uses fallback', () => {
    const result = buildAcceptedEmail('sug-1', '', 'en');
    expect(result.html).toContain('Your suggestion was accepted');
  });

  test('buildRejectedEmail with empty title uses fallback', () => {
    const result = buildRejectedEmail('sug-1', '', null, 'en');
    expect(result.html).toContain('Your suggestion was declined');
  });

  test('buildPlannedEmail with empty title uses fallback', () => {
    const result = buildPlannedEmail('sug-1', '', 'en');
    expect(result.html).toContain('Added to the roadmap');
  });

  test('buildCompletedEmail with empty title uses fallback', () => {
    const result = buildCompletedEmail('sug-1', '', 'en');
    expect(result.html).toContain('Feature shipped');
  });

  test('buildMergedEmail with empty title uses fallback', () => {
    const result = buildMergedEmail('sug-1', 'sug-orig', '', 'en');
    expect(result.html).toContain('Suggestion merged');
  });
});

describe('all builders — null language defaults to English', () => {
  test('buildAcceptedEmail defaults to en', () => {
    const result = buildAcceptedEmail('sug-1', 'Title');
    expect(result.html).toContain('html lang="en"');
    expect(result.subject).toContain('accepted');
  });

  test('buildRejectedEmail defaults to en', () => {
    const result = buildRejectedEmail('sug-1', 'Title', 'Reason');
    expect(result.html).toContain('html lang="en"');
  });

  test('buildPlannedEmail defaults to en', () => {
    const result = buildPlannedEmail('sug-1', 'Title');
    expect(result.html).toContain('html lang="en"');
  });

  test('buildCompletedEmail defaults to en', () => {
    const result = buildCompletedEmail('sug-1', 'Title');
    expect(result.html).toContain('html lang="en"');
  });

  test('buildMergedEmail defaults to en', () => {
    const result = buildMergedEmail('sug-1', 'sug-orig', 'Title');
    expect(result.html).toContain('html lang="en"');
  });
});

describe('all builders — XSS protection', () => {
  test('buildAcceptedEmail escapes script tags', () => {
    const result = buildAcceptedEmail('sug-1', '<script>alert("XSS")</script>', 'en');
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('&lt;script&gt;');
  });

  test('buildAcceptedEmail escapes img onerror — angle brackets and quotes escaped', () => {
    const result = buildAcceptedEmail('sug-1', '<img src=x onerror="alert(1)">', 'en');
    expect(result.html).not.toContain('<img');
    expect(result.html).toContain('&lt;img');
    expect(result.html).toContain('&quot;alert(1)&quot;');
  });

  test('buildAcceptedEmail escapes svg onload — angle brackets escaped', () => {
    const result = buildAcceptedEmail('sug-1', '"><svg onload=alert(1)>', 'en');
    expect(result.html).not.toContain('<svg');
    expect(result.html).toContain('&lt;svg');
    expect(result.html).toContain('&quot;&gt;');
  });

  test('buildAcceptedEmail escapes href javascript: — angle brackets and quotes escaped', () => {
    const result = buildAcceptedEmail('sug-1', '<a href="javascript:alert(1)">click</a>', 'en');
    // The injected <a> tag is entity-escaped (legitimate template <a> tags remain)
    expect(result.html).toContain('&lt;a href=');
    expect(result.html).toContain('&quot;javascript:');
    expect(result.html).toContain('&lt;/a&gt;');
  });

  test('buildAcceptedEmail escapes SQL injection characters', () => {
    const result = buildAcceptedEmail('sug-1', "'; DROP TABLE suggestions;--", 'en');
    // No angle brackets to escape, but text should appear safely
    expect(result.html).toContain('DROP TABLE suggestions');
  });

  test('buildRejectedEmail escapes script tags in reason', () => {
    const result = buildRejectedEmail('sug-1', 'Title', '<script>alert("XSS")</script>', 'en');
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('&lt;script&gt;');
  });

  test('buildRejectedEmail escapes img onerror in reason', () => {
    const result = buildRejectedEmail('sug-1', 'Title', '<img src=x onerror="alert(1)">', 'en');
    expect(result.html).not.toContain('<img');
    expect(result.html).toContain('&lt;img');
    expect(result.html).toContain('&quot;alert(1)&quot;');
  });

  test('buildRejectedEmail escapes svg onload in reason', () => {
    const result = buildRejectedEmail('sug-1', 'Title', '"><svg onload=alert(1)>', 'en');
    expect(result.html).not.toContain('<svg');
    expect(result.html).toContain('&lt;svg');
  });

  test('buildRejectedEmail escapes href javascript: in reason', () => {
    const result = buildRejectedEmail(
      'sug-1',
      'Title',
      '<a href="javascript:alert(1)">click</a>',
      'en',
    );
    // The injected <a> tag is entity-escaped (legitimate template <a> tags remain)
    expect(result.html).toContain('&lt;a href=');
    expect(result.html).toContain('&lt;/a&gt;');
  });
});

describe('all builders — long title truncation', () => {
  const longTitle = 'X'.repeat(300);

  test('buildAcceptedEmail truncates long title in subject', () => {
    const result = buildAcceptedEmail('sug-1', longTitle, 'en');
    expect(result.subject.length).toBeLessThan(200);
    expect(result.subject).toContain('...');
  });

  test('buildRejectedEmail truncates long title in subject', () => {
    const result = buildRejectedEmail('sug-1', longTitle, null, 'en');
    expect(result.subject.length).toBeLessThan(200);
    expect(result.subject).toContain('...');
  });

  test('buildPlannedEmail truncates long title in subject', () => {
    const result = buildPlannedEmail('sug-1', longTitle, 'en');
    expect(result.subject.length).toBeLessThan(200);
    expect(result.subject).toContain('...');
  });

  test('buildCompletedEmail truncates long title in subject', () => {
    const result = buildCompletedEmail('sug-1', longTitle, 'en');
    expect(result.subject.length).toBeLessThan(200);
    expect(result.subject).toContain('...');
  });

  test('buildMergedEmail truncates long title in subject', () => {
    const result = buildMergedEmail('sug-1', 'sug-orig', longTitle, 'en');
    expect(result.subject.length).toBeLessThan(200);
    expect(result.subject).toContain('...');
  });
});

describe('buildAcceptedEmail — all 20 languages produce valid output', () => {
  ALL_LANGUAGES.forEach((lang) => {
    test(`language ${lang} renders valid email`, () => {
      const result = buildAcceptedEmail('sug-1', 'Dark mode feature', lang);
      expect(result.subject.length).toBeGreaterThan(0);
      expect(result.html).toContain('<!DOCTYPE html');
      expect(result.html).toContain(`html lang="${lang}"`);
      expect(result.html).toContain('ShyTalk');
      expect(result.html).toContain('Shyden Ltd');
      expect(result.html).toContain('roadmap.html#suggestion-sug-1');
      expect(result.headers).toHaveProperty('List-Unsubscribe');
      expect(result.headers).toHaveProperty('List-Unsubscribe-Post');
    });
  });
});

describe('buildRejectedEmail — all 20 languages produce valid output', () => {
  ALL_LANGUAGES.forEach((lang) => {
    test(`language ${lang} renders valid email`, () => {
      const result = buildRejectedEmail('sug-2', 'Feature request', 'Too niche', lang);
      expect(result.subject.length).toBeGreaterThan(0);
      expect(result.html).toContain('<!DOCTYPE html');
      expect(result.html).toContain(`html lang="${lang}"`);
      expect(result.html).toContain('ShyTalk');
      expect(result.html).toContain('Shyden Ltd');
      expect(result.headers).toHaveProperty('List-Unsubscribe');
    });
  });
});

describe('unknown language falls back to English subject', () => {
  test('buildAcceptedEmail with unknown language uses en subject', () => {
    const enResult = buildAcceptedEmail('sug-1', 'Title', 'en');
    const unknownResult = buildAcceptedEmail('sug-1', 'Title', 'xx');
    // Unknown should fall back to English subject text
    expect(unknownResult.subject).toBe(enResult.subject);
  });

  test('buildRejectedEmail with unknown language uses en subject', () => {
    const enResult = buildRejectedEmail('sug-1', 'Title', null, 'en');
    const unknownResult = buildRejectedEmail('sug-1', 'Title', null, 'xx');
    expect(unknownResult.subject).toBe(enResult.subject);
  });
});
