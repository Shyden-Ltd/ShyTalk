-- Phase 6: Private Messaging & Groups
-- Migrated from Firestore conversations collection and subcollections

-- ═══════════════════════════════════════════════════════════════
-- CONVERSATIONS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  is_group INTEGER DEFAULT 0,
  group_name TEXT,
  group_photo_url TEXT,
  group_description TEXT,
  created_by TEXT,
  is_closed INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,

  -- Denormalized last message preview
  last_message_text TEXT,
  last_message_sender_id TEXT,
  last_message_sender_name TEXT,
  last_message_at INTEGER,
  last_message_type TEXT DEFAULT 'TEXT',

  -- Group permissions (stored as columns, not JSON)
  perm_who_can_send TEXT DEFAULT 'EVERYONE',
  perm_who_can_add_members TEXT DEFAULT 'EVERYONE',
  perm_who_can_edit_info TEXT DEFAULT 'EVERYONE',
  perm_who_can_delete_messages TEXT DEFAULT 'MODS_AND_ABOVE',
  perm_who_can_mute_members TEXT DEFAULT 'MODS_AND_ABOVE',
  perm_who_can_remove_members TEXT DEFAULT 'ADMINS_ONLY',

  -- System message config
  sys_show_joins INTEGER DEFAULT 1,
  sys_show_leaves INTEGER DEFAULT 1,
  sys_show_role_changes INTEGER DEFAULT 1,
  sys_show_permission_changes INTEGER DEFAULT 1,

  -- Moderation
  mod_notify_mode TEXT DEFAULT 'ALL_ADMINS'
);

CREATE INDEX idx_conversations_created_by ON conversations(created_by);
CREATE INDEX idx_conversations_last_message_at ON conversations(last_message_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- CONVERSATION PARTICIPANTS (junction table)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE conversation_participants (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'MEMBER', -- OWNER, ADMIN, MOD, MEMBER
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX idx_conv_participants_user ON conversation_participants(user_id);

-- ═══════════════════════════════════════════════════════════════
-- CONVERSATION SETTINGS (per-user settings)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE conversation_settings (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  is_muted INTEGER DEFAULT 0,
  is_hidden INTEGER DEFAULT 0,
  hidden_at INTEGER,
  is_pinned INTEGER DEFAULT 0,
  last_read_message_id TEXT DEFAULT '',
  last_read_at INTEGER DEFAULT 0,
  unread_count INTEGER DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- ═══════════════════════════════════════════════════════════════
-- PRIVATE MESSAGES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE private_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT DEFAULT '',
  text TEXT DEFAULT '',
  type TEXT DEFAULT 'TEXT', -- TEXT, IMAGE, STICKER, ROOM_INVITE, MOD_ACTION, SYSTEM
  image_urls TEXT, -- JSON array
  sticker_url TEXT,
  room_invite_id TEXT,
  room_invite_name TEXT,
  reply_to_message_id TEXT,
  reply_to_text TEXT,
  reply_to_sender_name TEXT,
  reactions TEXT, -- JSON: { "emoji": ["userId1", "userId2"] }
  read_by TEXT, -- JSON array of user IDs
  is_recalled INTEGER DEFAULT 0,
  is_hidden INTEGER DEFAULT 0,
  hidden_by TEXT,
  edit_count INTEGER DEFAULT 0,
  edited_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX idx_private_messages_conv ON private_messages(conversation_id, created_at);
CREATE INDEX idx_private_messages_sender ON private_messages(sender_id);

-- ═══════════════════════════════════════════════════════════════
-- MESSAGE EDITS (edit history)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE message_edits (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  previous_text TEXT DEFAULT '',
  edited_at INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES private_messages(id)
);

CREATE INDEX idx_message_edits_msg ON message_edits(message_id, edited_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- CONVERSATION MUTES (group member muting)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE conversation_mutes (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  muted_by TEXT DEFAULT '',
  muted_by_name TEXT DEFAULT '',
  reason TEXT,
  muted_at INTEGER NOT NULL,
  expires_at INTEGER,
  is_active INTEGER DEFAULT 1,
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- ═══════════════════════════════════════════════════════════════
-- MODERATION LOG
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE conversation_mod_log (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  action TEXT NOT NULL, -- MUTE, UNMUTE, HIDE_MESSAGE, etc.
  actor_id TEXT NOT NULL,
  actor_name TEXT DEFAULT '',
  target_id TEXT,
  target_name TEXT,
  details TEXT, -- JSON for additional context
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX idx_conv_mod_log ON conversation_mod_log(conversation_id, created_at DESC);
