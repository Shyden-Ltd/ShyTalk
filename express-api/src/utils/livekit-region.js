/**
 * LiveKit multi-region routing.
 *
 * getRegion(req)        - determines region ('asia' or 'eu') from CF-IPCountry header.
 * getRegionConfig(region) - returns { url, apiKey, apiSecret } for the given region.
 *
 * CF-IPCountry is set by Cloudflare on proxied requests. Direct-to-origin
 * requests may not have this header; they default to Asia (Singapore).
 */

const EU_COUNTRIES = new Set([
  'GB',
  'DE',
  'FR',
  'IT',
  'ES',
  'NL',
  'BE',
  'AT',
  'CH',
  'PT',
  'IE',
  'LU',
  'MC',
  'LI',
  'SE',
  'NO',
  'DK',
  'FI',
  'IS',
  'PL',
  'CZ',
  'SK',
  'HU',
  'RO',
  'BG',
  'HR',
  'SI',
  'RS',
  'BA',
  'ME',
  'MK',
  'AL',
  'XK',
  'UA',
  'BY',
  'MD',
  'LT',
  'LV',
  'EE',
  'RU',
  'TR',
  'SA',
  'AE',
  'QA',
  'KW',
  'BH',
  'OM',
  'JO',
  'LB',
  'IQ',
  'IL',
  'PS',
  'YE',
  'SY',
  'IR',
  'EG',
  'LY',
  'TN',
  'DZ',
  'MA',
  'ZA',
  'NG',
  'KE',
  'GH',
  'ET',
  'TZ',
  'UG',
  'CI',
  'SN',
  'CM',
  'PK',
  'AF',
]);

function getRegion(req) {
  const country = req.headers['cf-ipcountry'];
  if (country && EU_COUNTRIES.has(country)) {
    return 'eu';
  }
  return 'asia';
}

function getRegionConfig(region) {
  if (region === 'eu') {
    return {
      url: process.env.LIVEKIT_URL_EU || 'wss://livekit-eu.shytalk.shyden.co.uk',
      apiKey: process.env.LIVEKIT_KEY_EU || process.env.LIVEKIT_API_KEY,
      apiSecret: process.env.LIVEKIT_SECRET_EU || process.env.LIVEKIT_API_SECRET,
    };
  }
  return {
    url: process.env.LIVEKIT_URL_ASIA || 'wss://livekit.shytalk.shyden.co.uk',
    apiKey: process.env.LIVEKIT_KEY_ASIA || process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_SECRET_ASIA || process.env.LIVEKIT_API_SECRET,
  };
}

module.exports = { getRegion, getRegionConfig };
