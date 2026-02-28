-- Phase 6: Private Messaging & Groups
-- Migrated from Firestore conversations collection and subcollections
-- NOTE: These tables already exist from 0001_initial_schema.sql.
-- Using IF NOT EXISTS to make this migration idempotent.

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  is_group INTEGER DEFAULT 0,
  group_name TEXT,
  group_photo_url TEXT,
  group_description TEXT,
  created_by TEXT,
  is_closed INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_message_text TEXT,
  last_message_sender_id TEXT,
  last_message_sender_name TEXT,
  last_message_at INTEGER,
  last_message_type TEXT DEFAULT 'TEXT',
  perm_who_can_send TEXT DEFAULT 'EVERYONE',
  perm_who_can_add_members TEXT DEFAULT 'EVERYONE',
  perm_who_can_edit_info TEXT DEFAULT 'EVERYONE',
  perm_who_can_delete_messages TEXT DEFAULT 'MODS_AND_ABOVE',
  perm_who_can_mute_members TEXT DEFAULT 'MODS_AND_ABOVE',
  perm_who_can_remove_members TEXT DEFAULT 'ADMINS_ONLY',
  sys_show_joins INTEGER DEFAULT 1,
  sys_show_leaves INTEGER DEFAULT 1,
  sys_show_role_changes INTEGER DEFAULT 1,
  sys_show_permission_changes INTEGER DEFAULT 1,
  mod_notify_mode TEXT DEFAULT 'ALL_ADMINS'
);

CREATE INDEX IF NOT EXISTS idx_conversations_created_by ON conversations(created_by);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'MEMBER',
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants(user_id);

CREATE TABLE IF NOT EXISTS conversation_settings (
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

CREATE TABLE IF NOT EXISTS private_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT DEFAULT '',
  text TEXT DEFAULT '',
  type TEXT DEFAULT 'TEXT',
  image_urls TEXT,
  sticker_url TEXT,
  room_invite_id TEXT,
  room_invite_name TEXT,
  reply_to_message_id TEXT,
  reply_to_text TEXT,
  reply_to_sender_name TEXT,
  reactions TEXT,
  read_by TEXT,
  is_recalled INTEGER DEFAULT 0,
  is_hidden INTEGER DEFAULT 0,
  hidden_by TEXT,
  edit_count INTEGER DEFAULT 0,
  edited_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_private_messages_conv ON private_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_private_messages_sender ON private_messages(sender_id);

CREATE TABLE IF NOT EXISTS message_edits (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  previous_text TEXT DEFAULT '',
  edited_at INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES private_messages(id)
);

CREATE INDEX IF NOT EXISTS idx_message_edits_msg ON message_edits(message_id, edited_at DESC);

CREATE TABLE IF NOT EXISTS conversation_mutes (
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

CREATE TABLE IF NOT EXISTS conversation_mod_log (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT DEFAULT '',
  target_id TEXT,
  target_name TEXT,
  details TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_conv_mod_log ON conversation_mod_log(conversation_id, created_at DESC);
