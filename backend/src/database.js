const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const config = require('./config');

fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });
const db = new Database(config.databaseFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
db.exec(schema);

// Commands left pending by a previous server process cannot still be guaranteed.
db.prepare(`UPDATE action_history SET status = 'bad', responded_at = ?, response_message = 'Backend restarted before device response' WHERE status = 'wait'`).run(new Date().toISOString());

const now = () => new Date().toISOString();
const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get(config.admin.username);
if (!existingAdmin) {
  const passwordHash = bcrypt.hashSync(config.admin.password, 12);
  db.prepare(`
    INSERT INTO users (username, password_hash, full_name, student_id, email, role, created_at)
    VALUES (?, ?, ?, ?, ?, 'admin', ?)
  `).run(
    config.admin.username,
    passwordHash,
    config.admin.name,
    'B23DCAT122',
    'huongdv.b23dcat122@stu.ptit.edu.vn',
    now()
  );
}

db.prepare(`
  INSERT OR IGNORE INTO devices (id, name, created_at)
  VALUES ('ESP32_01', 'ESP32_01', ?)
`).run(now());

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    studentId: user.student_id,
    email: user.email,
    role: user.role
  };
}

module.exports = { db, now, publicUser };
