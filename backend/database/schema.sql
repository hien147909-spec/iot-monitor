PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  student_id TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  led1 INTEGER NOT NULL DEFAULT 0 CHECK (led1 IN (0, 1)),
  led2 INTEGER NOT NULL DEFAULT 0 CHECK (led2 IN (0, 1)),
  led3 INTEGER NOT NULL DEFAULT 0 CHECK (led3 IN (0, 1)),
  online INTEGER NOT NULL DEFAULT 0 CHECK (online IN (0, 1)),
  last_seen TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sensor_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  temperature REAL NOT NULL,
  humidity REAL NOT NULL,
  lux REAL NOT NULL,
  received_at TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE IF NOT EXISTS action_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  led_index INTEGER NOT NULL CHECK (led_index BETWEEN 0 AND 3),
  target_state INTEGER NOT NULL CHECK (target_state IN (0, 1)),
  action TEXT NOT NULL,
  command TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'wait' CHECK (status IN ('wait', 'ok', 'bad')),
  sent_at TEXT NOT NULL,
  responded_at TEXT,
  response_message TEXT,
  user_id INTEGER,
  FOREIGN KEY (device_id) REFERENCES devices(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sensor_samples_time
  ON sensor_samples(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_samples_device_time
  ON sensor_samples(device_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_history_time
  ON action_history(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_history_device_time
  ON action_history(device_id, sent_at DESC);
