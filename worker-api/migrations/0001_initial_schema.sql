-- ShyTalk D1 Schema — Migrated from Firestore
-- All timestamps stored as INTEGER (Unix milliseconds)
-- All boolean fields stored as INTEGER (0 = false, 1 = true)

-- ═══════════════════════════════════════════════════════════════
-- USERS & AUTH
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE users (
  uid TEXT PRIMARY KEY,
  unique_id INTEGER UNIQUE,
  display_name TEXT,
  description TEXT,
  nationality TEXT,
  date_of_birth TEXT,
  gender TEXT,
  user_type TEXT DEFAULT 'MEMBER',

  -- Photos
  profile_photo_url TEXT,
  cover_photo_url TEXT,

  -- Economy
  shy_coins INTEGER DEFAULT 0,
  shy_beans INTEGER DEFAULT 0,
  luck_score INTEGER DEFAULT 0,
  pity_counter INTEGER DEFAULT 0,

  -- Super Shy subscription
  is_super_shy INTEGER DEFAULT 0,
  super_shy_expiry INTEGER,
  super_shy_tier TEXT,
  has_claimed_super_shy_trial INTEGER DEFAULT 0,

  -- Login streaks
  login_streak INTEGER DEFAULT 0,
  last_login_date TEXT,
  last_login_reward_date TEXT,

  -- Suspension
  is_suspended INTEGER DEFAULT 0,
  suspension_reason TEXT,
  suspension_start_date INTEGER,
  suspension_end_date INTEGER,
  suspension_can_appeal INTEGER DEFAULT 1,
  suspension_appeal_status TEXT,
  suspended_by TEXT,
  warning_count INTEGER DEFAULT 0,
  warning_reason TEXT,
  has_active_warning INTEGER DEFAULT 0,
  gcs_score INTEGER DEFAULT 100,

  -- Pre-suspension snapshot (for profile restoration)
  pre_suspension_display_name TEXT,
  pre_suspension_profile_photo_url TEXT,
  pre_suspension_cover_photo_url TEXT,

  -- Privacy & notification settings
  pm_privacy TEXT DEFAULT 'EVERYONE',
  pm_notifications_enabled INTEGER DEFAULT 1,
  pm_sound_enabled INTEGER DEFAULT 1,
  pm_show_timestamps INTEGER DEFAULT 1,
  pm_show_date_separators INTEGER DEFAULT 1,
  pm_notification_preview INTEGER DEFAULT 1,
  hide_following INTEGER DEFAULT 0,
  hide_online_status INTEGER DEFAULT 0,
  hide_age INTEGER DEFAULT 0,
  self_destruct_alert_enabled INTEGER DEFAULT 0,
  min_gift_animation_value INTEGER DEFAULT 0,

  -- Do Not Disturb
  dnd_enabled INTEGER DEFAULT 0,
  dnd_start_hour INTEGER DEFAULT 22,
  dnd_start_minute INTEGER DEFAULT 0,
  dnd_end_hour INTEGER DEFAULT 8,
  dnd_end_minute INTEGER DEFAULT 0,

  -- Stalkers
  stalker_count INTEGER DEFAULT 0,
  new_stalker_count INTEGER DEFAULT 0,
  stalkers_last_viewed_at INTEGER,

  -- Legal
  accepted_legal_version INTEGER DEFAULT 0,

  -- Room state
  current_room_id TEXT,

  -- Gacha guarantee (admin-set)
  guaranteed_next_pull_gift_id TEXT,

  -- Timestamps
  created_at INTEGER,
  last_seen_at INTEGER
);

-- Social graph: blocked users
CREATE TABLE user_blocks (
  user_id TEXT NOT NULL,
  blocked_user_id TEXT NOT NULL,
  created_at INTEGER,
  PRIMARY KEY (user_id, blocked_user_id)
);

-- Social graph: follows
CREATE TABLE user_follows (
  follower_id TEXT NOT NULL,
  following_id TEXT NOT NULL,
  created_at INTEGER,
  PRIMARY KEY (follower_id, following_id)
);

-- User aliases (nicknames for other users)
CREATE TABLE user_aliases (
  user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  PRIMARY KEY (user_id, target_user_id)
);

-- FCM tokens
CREATE TABLE fcm_tokens (
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,
  created_at INTEGER,
  PRIMARY KEY (user_id, token)
);

-- Profile visitors (stalkers)
CREATE TABLE stalkers (
  profile_user_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  visit_count INTEGER DEFAULT 1,
  first_visited_at INTEGER,
  last_visited_at INTEGER,
  PRIMARY KEY (profile_user_id, visitor_id)
);

-- Device binding (one device → one account)
CREATE TABLE device_bindings (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bound_at INTEGER
);

-- ═══════════════════════════════════════════════════════════════
-- VOICE ROOMS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  state TEXT DEFAULT 'ACTIVE',           -- ACTIVE | OWNER_AWAY | CLOSED
  voice_room_name TEXT,
  require_approval INTEGER DEFAULT 0,
  owner_left_at INTEGER,
  created_at INTEGER,
  closed_at INTEGER
);

CREATE TABLE room_seats (
  room_id TEXT NOT NULL,
  seat_index INTEGER NOT NULL,
  user_id TEXT,
  state TEXT DEFAULT 'EMPTY',            -- EMPTY | OCCUPIED
  is_muted INTEGER DEFAULT 0,
  PRIMARY KEY (room_id, seat_index)
);

CREATE TABLE room_participants (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  first_join_at INTEGER,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE room_hosts (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE room_bans (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reason TEXT,
  kicker_name TEXT,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE room_invites (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  created_at INTEGER,
  PRIMARY KEY (room_id, user_id)
);

-- All-time tracking for rooms
CREATE TABLE room_all_time_hosts (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE room_all_time_seat_users (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

-- Room chat messages
CREATE TABLE room_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT,
  text TEXT,
  type TEXT DEFAULT 'TEXT',              -- TEXT | SYSTEM | JOIN | GIFT
  is_edited INTEGER DEFAULT 0,
  gift_id TEXT,
  gift_icon_url TEXT,
  created_at INTEGER
);

CREATE INDEX idx_room_messages_room ON room_messages(room_id, created_at);

-- Room last gift event (denormalized for quick reads)
CREATE TABLE room_last_gift_event (
  room_id TEXT PRIMARY KEY,
  sender_id TEXT,
  sender_name TEXT,
  recipient_id TEXT,
  recipient_name TEXT,
  gift_id TEXT,
  gift_name TEXT,
  coin_value INTEGER,
  quantity INTEGER,
  timestamp INTEGER
);

-- Seat requests
CREATE TABLE seat_requests (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT,
  seat_index INTEGER NOT NULL,
  status TEXT DEFAULT 'PENDING',         -- PENDING | APPROVED | DENIED
  resolved_by TEXT,
  resolved_at INTEGER,
  created_at INTEGER
);

CREATE INDEX idx_seat_requests_room ON seat_requests(room_id, status);

-- ═══════════════════════════════════════════════════════════════
-- CONVERSATIONS & PRIVATE MESSAGES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  is_group INTEGER DEFAULT 0,
  group_name TEXT,
  group_photo_url TEXT,
  group_description TEXT,
  created_by TEXT,
  is_closed INTEGER DEFAULT 0,
  mod_notify_mode TEXT DEFAULT 'ALL_ADMINS',

  -- Last message preview (denormalized)
  last_message_text TEXT,
  last_message_sender_id TEXT,
  last_message_sender_name TEXT,
  last_message_type TEXT,
  last_message_at INTEGER,

  created_at INTEGER
);

-- Group permissions
CREATE TABLE conversation_permissions (
  conversation_id TEXT PRIMARY KEY,
  who_can_send TEXT DEFAULT 'EVERYONE',
  who_can_add_members TEXT DEFAULT 'EVERYONE',
  who_can_edit_info TEXT DEFAULT 'EVERYONE',
  who_can_delete_messages TEXT DEFAULT 'MODS_AND_ABOVE',
  who_can_mute_members TEXT DEFAULT 'MODS_AND_ABOVE',
  who_can_remove_members TEXT DEFAULT 'ADMINS_ONLY',
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- System message config per conversation
CREATE TABLE conversation_system_message_config (
  conversation_id TEXT PRIMARY KEY,
  show_joins INTEGER DEFAULT 1,
  show_leaves INTEGER DEFAULT 1,
  show_role_changes INTEGER DEFAULT 1,
  show_permission_changes INTEGER DEFAULT 1,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- Conversation participants
CREATE TABLE conversation_participants (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'MEMBER',            -- OWNER | ADMIN | MOD | MEMBER
  joined_at INTEGER,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX idx_conv_participants_user ON conversation_participants(user_id, conversation_id);

-- Per-user conversation settings (read state, mute, pin, hide)
CREATE TABLE conversation_settings (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  is_muted INTEGER DEFAULT 0,
  is_hidden INTEGER DEFAULT 0,
  hidden_at INTEGER,
  is_pinned INTEGER DEFAULT 0,
  last_read_message_id TEXT,
  last_read_at INTEGER,
  unread_count INTEGER DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);

-- Private messages
CREATE TABLE private_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT,
  text TEXT,
  type TEXT DEFAULT 'TEXT',              -- TEXT | IMAGE | STICKER | ROOM_INVITE | MOD_ACTION | SYSTEM
  image_urls TEXT,                       -- JSON array
  sticker_url TEXT,
  room_invite_id TEXT,
  room_invite_name TEXT,
  reply_to_message_id TEXT,
  reply_to_text TEXT,
  reply_to_sender_name TEXT,
  is_recalled INTEGER DEFAULT 0,
  is_hidden INTEGER DEFAULT 0,
  hidden_by TEXT,
  edit_count INTEGER DEFAULT 0,
  created_at INTEGER,
  edited_at INTEGER
);

CREATE INDEX idx_pm_conversation ON private_messages(conversation_id, created_at);

-- Message read receipts
CREATE TABLE message_read_by (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at INTEGER,
  PRIMARY KEY (message_id, user_id)
);

-- Message reactions
CREATE TABLE message_reactions (
  message_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER,
  PRIMARY KEY (message_id, emoji, user_id)
);

-- Message edit history
CREATE TABLE message_edits (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  previous_text TEXT,
  edited_at INTEGER
);

CREATE INDEX idx_message_edits ON message_edits(conversation_id, message_id);

-- Group mute records
CREATE TABLE conversation_mutes (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  muted_by TEXT NOT NULL,
  muted_by_name TEXT,
  reason TEXT,
  muted_at INTEGER,
  expires_at INTEGER,
  is_active INTEGER DEFAULT 1,
  PRIMARY KEY (conversation_id, user_id)
);

-- Moderation log
CREATE TABLE conversation_mod_log (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  mod_id TEXT NOT NULL,
  mod_name TEXT,
  action TEXT NOT NULL,                  -- MUTE | UNMUTE | HIDE_MESSAGE | etc.
  target_user_id TEXT,
  target_user_name TEXT,
  reason TEXT,
  created_at INTEGER
);

CREATE INDEX idx_mod_log_conv ON conversation_mod_log(conversation_id, created_at);

-- ═══════════════════════════════════════════════════════════════
-- ECONOMY & GIFTS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE gifts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  coin_value INTEGER NOT NULL,
  animation_url TEXT DEFAULT '',
  sound_url TEXT DEFAULT '',
  icon_url TEXT DEFAULT '',
  "order" INTEGER DEFAULT 0,
  expires_after_days INTEGER,
  show_in_store INTEGER DEFAULT 1,
  show_on_wheel INTEGER DEFAULT 1,
  weight REAL DEFAULT 1.0
);

CREATE TABLE coin_packages (
  id TEXT PRIMARY KEY,
  product_id TEXT UNIQUE NOT NULL,
  coins INTEGER NOT NULL,
  bonus_coins INTEGER DEFAULT 0,
  display_price TEXT,
  "order" INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1
);

-- User backpack (inventory)
CREATE TABLE backpack_items (
  user_id TEXT NOT NULL,
  gift_id TEXT NOT NULL,
  quantity INTEGER DEFAULT 0,
  last_acquired INTEGER,
  expires_at INTEGER,
  PRIMARY KEY (user_id, gift_id)
);

CREATE INDEX idx_backpack_expires ON backpack_items(expires_at) WHERE expires_at IS NOT NULL;

-- User gift wall (received gift counts)
CREATE TABLE gift_wall (
  user_id TEXT NOT NULL,
  gift_id TEXT NOT NULL,
  received_count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, gift_id)
);

-- Gift wall sender breakdown
CREATE TABLE gift_wall_senders (
  user_id TEXT NOT NULL,
  gift_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  send_count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, gift_id, sender_id)
);

-- Transaction history
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,                    -- PURCHASE | GACHA_PULL | GIFT_SENT | GIFT_RECEIVED | BEAN_REDEEM | DAILY_REWARD | SUBSCRIPTION | ADMIN_ADJUSTMENT | BACKPACK_SENT | BACKPACK_RECEIVED | TRIAL_CLAIM | TRIAL_ACTIVATE
  amount INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'COINS',         -- COINS | BEANS | ITEMS | GIFT
  balance_after INTEGER,
  gift_id TEXT,
  gift_name TEXT,
  recipient_id TEXT,
  sender_id TEXT,
  pull_count INTEGER,
  quantity INTEGER,
  total_recipients INTEGER,
  total_items_sent INTEGER,
  total_items_received INTEGER,
  details TEXT,
  guaranteed INTEGER DEFAULT 0,
  timestamp INTEGER
);

CREATE INDEX idx_transactions_user ON transactions(user_id, timestamp DESC);
CREATE INDEX idx_transactions_type ON transactions(user_id, type, timestamp DESC);

-- Gift rankings (precomputed, updated hourly)
CREATE TABLE gift_rankings (
  gift_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  display_name TEXT,
  profile_photo_url TEXT,
  rank INTEGER,
  PRIMARY KEY (gift_id, user_id)
);

CREATE TABLE gift_rankings_meta (
  gift_id TEXT PRIMARY KEY,
  total_sent INTEGER DEFAULT 0,
  last_updated INTEGER
);

-- Broadcasts (public feed of big gifts/gacha wins)
CREATE TABLE broadcasts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                    -- GIFT_SEND | GACHA_WIN
  sender_name TEXT,
  sender_photo_url TEXT,
  recipient_name TEXT,
  gift_name TEXT,
  gift_icon_url TEXT,
  gift_coin_value INTEGER,
  quantity INTEGER DEFAULT 1,
  timestamp INTEGER
);

CREATE INDEX idx_broadcasts_time ON broadcasts(timestamp DESC);

-- ═══════════════════════════════════════════════════════════════
-- REPORTS & MODERATION
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  reporter_name TEXT,
  reporter_unique_id INTEGER,
  reported_user_id TEXT NOT NULL,
  reported_user_name TEXT,
  reported_user_unique_id INTEGER,
  conversation_id TEXT,
  message_id TEXT,
  message_text TEXT,
  reason TEXT,
  description TEXT,
  evidence_urls TEXT,                    -- JSON array
  status TEXT DEFAULT 'pending',         -- pending | resolved | dismissed
  action_taken TEXT,
  resolved_at INTEGER,
  resolved_by TEXT,
  created_at INTEGER
);

CREATE INDEX idx_reports_status ON reports(status, created_at);

CREATE TABLE reports_archive (
  id TEXT PRIMARY KEY,
  reporter_id TEXT,
  reporter_name TEXT,
  reporter_unique_id INTEGER,
  reported_user_id TEXT,
  reported_user_name TEXT,
  reported_user_unique_id INTEGER,
  conversation_id TEXT,
  message_id TEXT,
  message_text TEXT,
  reason TEXT,
  description TEXT,
  evidence_urls TEXT,
  status TEXT,
  action_taken TEXT,
  resolved_at INTEGER,
  resolved_by TEXT,
  created_at INTEGER
);

CREATE TABLE suspension_appeals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  appeal_text TEXT,
  status TEXT DEFAULT 'pending',         -- pending | approved | denied
  reviewed_by TEXT,
  reviewed_at INTEGER,
  created_at INTEGER
);

CREATE INDEX idx_appeals_user ON suspension_appeals(user_id);

CREATE TABLE report_locks (
  report_id TEXT PRIMARY KEY,
  locked_by TEXT NOT NULL,
  locked_at INTEGER
);

-- Admin tokens (for push notifications to admin users)
CREATE TABLE admin_tokens (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  user_id TEXT
);

-- Admin audit log
CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  details TEXT,
  created_at INTEGER
);

CREATE INDEX idx_audit_log ON admin_audit_log(created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- CONFIG
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL                    -- JSON-encoded value
);

-- ═══════════════════════════════════════════════════════════════
-- COUNTERS (atomic auto-increment for unique_id generation)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  value INTEGER DEFAULT 0
);

-- Initialize the unique_id counter
INSERT INTO counters (name, value) VALUES ('unique_id', 0);
