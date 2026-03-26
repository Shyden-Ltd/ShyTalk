describe('livekit-region', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.LIVEKIT_URL_ASIA = 'wss://livekit.shytalk.shyden.co.uk';
    process.env.LIVEKIT_URL_EU = 'wss://livekit-eu.shytalk.shyden.co.uk';
    process.env.LIVEKIT_KEY_ASIA = 'asia-key';
    process.env.LIVEKIT_SECRET_ASIA = 'asia-secret';
    process.env.LIVEKIT_KEY_EU = 'eu-key';
    process.env.LIVEKIT_SECRET_EU = 'eu-secret';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('routes Southeast Asian country to Asia region', () => {
    const { getRegion } = require('../../src/utils/livekit-region');
    expect(getRegion({ headers: { 'cf-ipcountry': 'SG' } })).toBe('asia');
    expect(getRegion({ headers: { 'cf-ipcountry': 'TH' } })).toBe('asia');
    expect(getRegion({ headers: { 'cf-ipcountry': 'ID' } })).toBe('asia');
    expect(getRegion({ headers: { 'cf-ipcountry': 'MY' } })).toBe('asia');
  });

  test('routes European country to EU region', () => {
    const { getRegion } = require('../../src/utils/livekit-region');
    expect(getRegion({ headers: { 'cf-ipcountry': 'GB' } })).toBe('eu');
    expect(getRegion({ headers: { 'cf-ipcountry': 'DE' } })).toBe('eu');
    expect(getRegion({ headers: { 'cf-ipcountry': 'FR' } })).toBe('eu');
  });

  test('routes Middle East to EU region (closer to London)', () => {
    const { getRegion } = require('../../src/utils/livekit-region');
    expect(getRegion({ headers: { 'cf-ipcountry': 'SA' } })).toBe('eu');
    expect(getRegion({ headers: { 'cf-ipcountry': 'AE' } })).toBe('eu');
    expect(getRegion({ headers: { 'cf-ipcountry': 'TR' } })).toBe('eu');
  });

  test('defaults to Asia when no CF-IPCountry header', () => {
    const { getRegion } = require('../../src/utils/livekit-region');
    expect(getRegion({ headers: {} })).toBe('asia');
  });

  test('defaults to Asia for unknown country', () => {
    const { getRegion } = require('../../src/utils/livekit-region');
    expect(getRegion({ headers: { 'cf-ipcountry': 'XX' } })).toBe('asia');
  });

  test('getRegionConfig returns correct URL and keys for Asia', () => {
    const { getRegionConfig } = require('../../src/utils/livekit-region');
    const config = getRegionConfig('asia');
    expect(config.url).toBe('wss://livekit.shytalk.shyden.co.uk');
    expect(config.apiKey).toBe('asia-key');
    expect(config.apiSecret).toBe('asia-secret');
  });

  test('getRegionConfig returns correct URL and keys for EU', () => {
    const { getRegionConfig } = require('../../src/utils/livekit-region');
    const config = getRegionConfig('eu');
    expect(config.url).toBe('wss://livekit-eu.shytalk.shyden.co.uk');
    expect(config.apiKey).toBe('eu-key');
    expect(config.apiSecret).toBe('eu-secret');
  });

  test('falls back to single LIVEKIT_API_KEY when per-region keys not set', () => {
    delete process.env.LIVEKIT_KEY_ASIA;
    delete process.env.LIVEKIT_SECRET_ASIA;
    process.env.LIVEKIT_API_KEY = 'fallback-key';
    process.env.LIVEKIT_API_SECRET = 'fallback-secret';

    const { getRegionConfig } = require('../../src/utils/livekit-region');
    const config = getRegionConfig('asia');
    expect(config.apiKey).toBe('fallback-key');
    expect(config.apiSecret).toBe('fallback-secret');
  });

  test('falls back to single LIVEKIT_API_KEY for EU when per-region keys not set', () => {
    delete process.env.LIVEKIT_KEY_EU;
    delete process.env.LIVEKIT_SECRET_EU;
    process.env.LIVEKIT_API_KEY = 'fallback-key';
    process.env.LIVEKIT_API_SECRET = 'fallback-secret';

    const { getRegionConfig } = require('../../src/utils/livekit-region');
    const config = getRegionConfig('eu');
    expect(config.apiKey).toBe('fallback-key');
    expect(config.apiSecret).toBe('fallback-secret');
  });

  test('returns asia for null cf-ipcountry header', () => {
    const { getRegion } = require('../../src/utils/livekit-region');
    expect(getRegion({ headers: { 'cf-ipcountry': null } })).toBe('asia');
  });

  test('returns asia for empty string cf-ipcountry header', () => {
    const { getRegion } = require('../../src/utils/livekit-region');
    expect(getRegion({ headers: { 'cf-ipcountry': '' } })).toBe('asia');
  });
});
