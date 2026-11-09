/**
 * Schema migrations, applied in order. `PRAGMA user_version` records how many have run.
 * Never edit a migration that has shipped; add a new one.
 */
export const migrations: string[] = [
	`
CREATE TABLE groups (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	position REAL NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE sessions (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('standing', 'task')),
	group_id TEXT REFERENCES groups (id) ON DELETE SET NULL,
	responsibility TEXT NOT NULL DEFAULT '',
	cwd TEXT,
	provider TEXT NOT NULL,
	model TEXT NOT NULL,
	thinking TEXT NOT NULL DEFAULT 'medium',
	rules TEXT NOT NULL DEFAULT '[]',
	options TEXT NOT NULL DEFAULT '{}',
	todos TEXT NOT NULL DEFAULT '[]',
	context TEXT,
	status TEXT NOT NULL DEFAULT 'idle'
		CHECK (status IN ('idle', 'working', 'waiting', 'error', 'needs_review')),
	status_detail TEXT,
	pinned INTEGER NOT NULL DEFAULT 0,
	unread INTEGER NOT NULL DEFAULT 0,
	archived_at INTEGER,
	usage_input INTEGER NOT NULL DEFAULT 0,
	usage_output INTEGER NOT NULL DEFAULT 0,
	usage_cache_read INTEGER NOT NULL DEFAULT 0,
	usage_cache_write INTEGER NOT NULL DEFAULT 0,
	usage_cost REAL NOT NULL DEFAULT 0,
	context_tokens INTEGER NOT NULL DEFAULT 0,
	event_seq INTEGER NOT NULL DEFAULT 0,
	message_seq INTEGER NOT NULL DEFAULT 0,
	last_activity_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX sessions_name ON sessions (name COLLATE NOCASE);

CREATE TABLE messages (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	seq INTEGER NOT NULL,
	role TEXT NOT NULL
		CHECK (role IN ('system', 'user', 'assistant', 'toolResult', 'compaction', 'notice')),
	body TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	UNIQUE (session_id, seq)
) STRICT;

CREATE VIRTUAL TABLE message_search USING fts5 (
	text,
	session_id UNINDEXED,
	message_id UNINDEXED,
	tokenize = 'trigram'
);

CREATE TABLE tool_calls (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
	call_id TEXT NOT NULL,
	tool TEXT NOT NULL,
	args TEXT NOT NULL,
	status TEXT NOT NULL
		CHECK (status IN ('pending', 'waiting', 'running', 'done', 'error', 'denied', 'needs_review')),
	detail TEXT,
	result_message_id TEXT,
	started_at INTEGER,
	finished_at INTEGER,
	created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX tool_calls_message ON tool_calls (message_id);
CREATE INDEX tool_calls_open ON tool_calls (session_id)
	WHERE status IN ('pending', 'waiting', 'running');

CREATE TABLE approvals (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	tool_call_id TEXT REFERENCES tool_calls (id) ON DELETE CASCADE,
	kind TEXT NOT NULL CHECK (kind IN ('permission', 'question')),
	request TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'cancelled')),
	response TEXT,
	created_at INTEGER NOT NULL,
	resolved_at INTEGER
) STRICT;
CREATE INDEX approvals_session ON approvals (session_id, created_at);
CREATE INDEX approvals_pending ON approvals (session_id) WHERE status = 'pending';

CREATE TABLE queued_messages (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	body TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX queued_messages_session ON queued_messages (session_id, id);

CREATE TABLE session_events (
	session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	seq INTEGER NOT NULL,
	type TEXT NOT NULL,
	data TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (session_id, seq)
) STRICT, WITHOUT ROWID;

CREATE TABLE providers (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	config TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
) STRICT;

CREATE TABLE idempotency_keys (
	scope TEXT NOT NULL,
	key TEXT NOT NULL,
	fingerprint TEXT NOT NULL,
	status INTEGER NOT NULL,
	body TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (scope, key)
) STRICT;

CREATE TABLE auth_tokens (
	hash TEXT PRIMARY KEY,
	kind TEXT NOT NULL CHECK (kind IN ('login', 'browser')),
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	last_used_at INTEGER
) STRICT;
`,
	// M2: letters between sessions, decision cards, and the session tree (blueprint sections 6 and 7).
	`
ALTER TABLE sessions ADD COLUMN parent_id TEXT REFERENCES sessions (id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN outcome TEXT CHECK (outcome IN ('done', 'given_up', 'failed'));
ALTER TABLE sessions ADD COLUMN interventions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN letters_sent INTEGER NOT NULL DEFAULT 0;
CREATE INDEX sessions_parent ON sessions (parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE letters (
	id TEXT PRIMARY KEY,
	thread_id TEXT NOT NULL,
	reply_to TEXT,
	from_kind TEXT NOT NULL CHECK (from_kind IN ('session', 'person', 'cli', 'jig')),
	from_session TEXT REFERENCES sessions (id) ON DELETE SET NULL,
	from_name TEXT NOT NULL,
	to_session TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	kind TEXT NOT NULL CHECK (kind IN ('notice', 'request', 'decision', 'report')),
	summary TEXT NOT NULL,
	body TEXT NOT NULL,
	status TEXT NOT NULL
		CHECK (status IN ('queued', 'held', 'delivered', 'done', 'refused', 'dropped')),
	status_reason TEXT,
	path TEXT NOT NULL DEFAULT '[]',
	auto INTEGER NOT NULL DEFAULT 0,
	decision INTEGER,
	entry_id TEXT,
	created_at INTEGER NOT NULL,
	delivered_at INTEGER,
	updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX letters_inbox ON letters (to_session, status);
CREATE INDEX letters_time ON letters (created_at, id);
CREATE INDEX letters_pair ON letters (from_session, to_session, created_at);

CREATE TABLE cards (
	id TEXT PRIMARY KEY,
	number INTEGER NOT NULL UNIQUE,
	created_by TEXT REFERENCES sessions (id) ON DELETE SET NULL,
	requested_by TEXT REFERENCES sessions (id) ON DELETE SET NULL,
	title TEXT NOT NULL,
	context TEXT NOT NULL DEFAULT '',
	options TEXT NOT NULL DEFAULT '[]',
	recommended INTEGER,
	deadline TEXT,
	sessions TEXT NOT NULL DEFAULT '[]',
	reversible TEXT NOT NULL DEFAULT '',
	after TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'decided', 'withdrawn')),
	choice INTEGER,
	note TEXT,
	decided_at INTEGER,
	withdrawn_reason TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX cards_status ON cards (status, updated_at);
`,
];
