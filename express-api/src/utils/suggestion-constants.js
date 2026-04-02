/**
 * Constants for the suggestions feature.
 * Centralised validation rules, tag lists, and configuration.
 */

const VALID_TAGS = [
  'compliance',
  'platform',
  'revenue',
  'social',
  'quality-of-life',
  'entertainment',
  'support',
  'website',
];

const VALID_LANGUAGES = [
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

const VALID_STATUSES = ['pending', 'accepted', 'planned', 'completed', 'rejected'];
const PUBLIC_STATUSES = ['accepted', 'planned', 'completed', 'rejected'];
const VOTABLE_STATUSES = ['accepted'];
const COMMENTABLE_STATUSES = ['accepted'];

const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_COMMENT_LENGTH = 2000;
const MAX_VOTE_REASON_LENGTH = 500;
const MAX_REJECT_REASON_LENGTH = 2000;
const MAX_TAGS_PER_SUGGESTION = 5;
const MAX_PENDING_PER_USER = 10;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const SEARCH_MIN_LENGTH = 2;
const SEARCH_PAGE_SIZE = 3;
const MAX_NOTIFICATIONS_PER_USER = 200;
const NOTIFICATION_TTL_DAYS = 90;
const SIMILARITY_THRESHOLD = 0.7;

module.exports = {
  VALID_TAGS,
  VALID_LANGUAGES,
  VALID_STATUSES,
  PUBLIC_STATUSES,
  VOTABLE_STATUSES,
  COMMENTABLE_STATUSES,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_VOTE_REASON_LENGTH,
  MAX_REJECT_REASON_LENGTH,
  MAX_TAGS_PER_SUGGESTION,
  MAX_PENDING_PER_USER,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  SEARCH_MIN_LENGTH,
  SEARCH_PAGE_SIZE,
  MAX_NOTIFICATIONS_PER_USER,
  NOTIFICATION_TTL_DAYS,
  SIMILARITY_THRESHOLD,
};
