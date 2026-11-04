const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, now, publicUser } = require('./database');

function makeRouter(config, deviceService) {
  const router = express.Router();

  function authenticate(req, res, next) {
    const header = req.headers.authorization || '';
    let token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token && req.query && req.query.token) {
      token = String(req.query.token).trim();
    }
    if (!token) {
      return res.status(401).json({
        error: 'Vui lòng đăng nhập.',
        message: 'Yêu cầu token xác thực (Authorization: Bearer <token> hoặc query ?token=).'
      });
    }
    try {
      req.auth = jwt.verify(token, config.jwtSecret);
      return next();
    } catch (error) {
      return res.status(401).json({
        error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
        message: error.message
      });
    }
  }

  const requireDevice = (req, res, next) => {
    const deviceId = String(req.params.id || '').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) {
      return res.status(400).json({ error: 'Mã thiết bị không hợp lệ.' });
    }
    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
    if (!device) return res.status(404).json({ error: 'Không tìm thấy thiết bị.' });
    req.device = device;
    return next();
  };

  router.get('/health', (req, res) => {
    res.json({
      ok: true,
      service: 'iot-monitor-api',
      time: now(),
      mqtt: deviceService.connectionInfo()
    });
  });

  router.get('/events', authenticate, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(': connected\n\n');

    const onAlert = data => {
      try {
        res.write(`event: alert\ndata: ${JSON.stringify(data)}\n\n`);
      } catch (err) {}
    };

    const onSensor = data => {
      try {
        res.write(`event: sensor\ndata: ${JSON.stringify(data)}\n\n`);
      } catch (err) {}
    };

    deviceService.on('alert', onAlert);
    deviceService.on('sensor', onSensor);

    req.on('close', () => {
      deviceService.off('alert', onAlert);
      deviceService.off('sensor', onSensor);
    });
  });

  router.post('/auth/login', (req, res) => {
    let username = String(req.body.username || '').trim();
    let password = String(req.body.password || '');

    // Support HTTP Basic Authentication header: Authorization: Basic <base64(username:password)>
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
        const sep = decoded.indexOf(':');
        if (sep >= 0) {
          username = decoded.substring(0, sep).trim();
          password = decoded.substring(sep + 1);
        }
      } catch (err) {}
    }

    if (!username || !password) {
      return res.status(400).json({
        error: 'Nhập tên đăng nhập và mật khẩu.',
        message: 'Hỗ trợ xác thực qua Header Authorization: Basic hoặc JSON body { username, password }.'
      });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu.' });
    }

    const token = jwt.sign(
      { sub: String(user.id), username: user.username, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );
    return res.json({
      token,
      token_type: 'Bearer',
      expires_in: config.jwtExpiresIn,
      user: publicUser(user)
    });
  });

  router.post('/auth/logout', authenticate, (req, res) => {
    return res.json({ ok: true, message: 'Đăng xuất thành công.' });
  });

  router.get('/auth/me', authenticate, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.auth.sub));
    if (!user) return res.status(401).json({ error: 'Tài khoản không tồn tại.' });
    return res.json({ user: publicUser(user) });
  });

  router.get('/users/me', authenticate, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.auth.sub));
    if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    return res.json({ user: publicUser(user) });
  });

  router.get('/dashboard/summary', authenticate, (req, res) => {
    const deviceId = String(req.query.deviceId || 'ESP32_01');
    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
    const latest = db.prepare(`
      SELECT temperature, humidity, lux, received_at
      FROM sensor_samples WHERE device_id = ?
      ORDER BY received_at DESC, id DESC LIMIT 1
    `).get(deviceId);
    const points = db.prepare(`
      SELECT temperature, humidity, lux, received_at
      FROM sensor_samples WHERE device_id = ?
      ORDER BY received_at DESC, id DESC LIMIT 30
    `).all(deviceId).reverse();
    const lastAction = db.prepare(`
      SELECT id, action, status, sent_at, responded_at
      FROM action_history WHERE device_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(deviceId);
    const mqtt = deviceService.connectionInfo();

    return res.json({
      deviceId,
      current: latest ? {
        temperature: latest.temperature,
        humidity: latest.humidity,
        lux: latest.lux,
        time: latest.received_at
      } : null,
      series: points.map(row => ({
        t: row.temperature,
        h: row.humidity,
        l: row.lux,
        time: row.received_at
      })),
      leds: device ? [Boolean(device.led1), Boolean(device.led2), Boolean(device.led3)] : [false, false, false],
      online: deviceService.getDeviceOnline(device),
      sensorAlert: deviceService.getSensorAlert(deviceId),
      mqtt,
      lastCommand: lastAction ? {
        id: lastAction.id,
        action: lastAction.action,
        status: lastAction.status,
        sentAt: lastAction.sent_at,
        respondedAt: lastAction.responded_at
      } : null,
      updatedAt: latest ? latest.received_at : null
    });
  });

  router.get('/sensors/data', authenticate, (req, res) => {
    const sampleLimit = Math.min(30000, Math.max(1, Number.parseInt(req.query.limit, 10) || 30000));
    const deviceId = req.query.deviceId ? String(req.query.deviceId) : null;
    const samples = deviceId
      ? db.prepare(`
          SELECT device_id, temperature, humidity, lux, received_at
          FROM sensor_samples WHERE device_id = ?
          ORDER BY received_at DESC, id DESC LIMIT ?
        `).all(deviceId, sampleLimit)
      : db.prepare(`
          SELECT device_id, temperature, humidity, lux, received_at
          FROM sensor_samples
          ORDER BY received_at DESC, id DESC LIMIT ?
        `).all(sampleLimit);

    const items = [];
    for (const row of samples) {
      items.push(
        { time: row.received_at, dev: row.device_id, type: 'Nhiệt độ', val: row.temperature, unit: '°C' },
        { time: row.received_at, dev: row.device_id, type: 'Độ ẩm', val: row.humidity, unit: '%' },
        { time: row.received_at, dev: row.device_id, type: 'Ánh sáng', val: row.lux, unit: 'lx' }
      );
    }
    return res.json({ items, sampleCount: samples.length });
  });

  router.get('/actions', authenticate, (req, res) => {
    const limit = Math.min(5000, Math.max(1, Number.parseInt(req.query.limit, 10) || 1000));
    const rows = db.prepare(`
      SELECT id, device_id, action, status, sent_at, responded_at, response_message
      FROM action_history
      ORDER BY sent_at DESC, id DESC LIMIT ?
    `).all(limit);
    return res.json({ items: rows.map(row => ({
      id: row.id,
      dev: row.device_id,
      act: row.action,
      st: row.status,
      sent: row.sent_at,
      resp: row.responded_at,
      message: row.response_message
    })) });
  });

  router.get('/devices/:id/led', authenticate, requireDevice, (req, res) => {
    const device = req.device;
    return res.json({
      deviceId: device.id,
      leds: [Boolean(device.led1), Boolean(device.led2), Boolean(device.led3)],
      online: deviceService.getDeviceOnline(device),
      lastSeen: device.last_seen
    });
  });

  router.get('/devices/:id/status', authenticate, requireDevice, (req, res) => {
    const device = req.device;
    const latest = db.prepare(`
      SELECT temperature, humidity, lux, received_at
      FROM sensor_samples WHERE device_id = ?
      ORDER BY received_at DESC, id DESC LIMIT 1
    `).get(device.id);

    return res.json({
      deviceId: device.id,
      name: device.name,
      leds: {
        led1: Boolean(device.led1),
        led2: Boolean(device.led2),
        led3: Boolean(device.led3)
      },
      online: deviceService.getDeviceOnline(device),
      lastSeen: device.last_seen,
      lastSensor: latest ? {
        temperature: latest.temperature,
        humidity: latest.humidity,
        lux: latest.lux,
        time: latest.received_at
      } : null,
      mqtt: deviceService.connectionInfo()
    });
  });

  router.post('/devices/:id/led', authenticate, requireDevice, (req, res) => {
    if (!deviceService.isReady()) {
      return res.status(503).json({ error: 'MQTT chưa kết nối. Hãy kiểm tra broker hoặc bật chế độ mô phỏng.' });
    }

    const rawLed = req.body.led;
    const ledIndex = rawLed === 'all' ? 0 : Number(rawLed);
    const state = req.body.state;
    if (![0, 1, 2, 3].includes(ledIndex) || (rawLed !== 'all' && ledIndex === 0) || typeof state !== 'boolean') {
      return res.status(400).json({ error: 'Dữ liệu điều khiển không hợp lệ. led phải là 1, 2, 3 hoặc all; state phải là true/false.' });
    }

    const action = ledIndex === 0
      ? `${state ? 'Bật' : 'Tắt'} tất cả`
      : `${state ? 'Bật' : 'Tắt'} đèn ${ledIndex}`;
    const command = ledIndex === 0
      ? (state ? 'ALL_ON' : 'ALL_OFF')
      : `LED${ledIndex}_${state ? 'ON' : 'OFF'}`;

    const result = db.prepare(`
      INSERT INTO action_history
        (device_id, led_index, target_state, action, command, status, sent_at, user_id)
      VALUES (?, ?, ?, ?, ?, 'wait', ?, ?)
    `).run(
      req.device.id,
      ledIndex,
      state ? 1 : 0,
      action,
      command,
      now(),
      Number(req.auth.sub)
    );

    const created = db.prepare(`
      SELECT id, device_id, action, status, sent_at, responded_at
      FROM action_history WHERE id = ?
    `).get(result.lastInsertRowid);
    deviceService.enqueueAction(created.id);

    return res.status(202).json({
      action: {
        id: created.id,
        dev: created.device_id,
        act: created.action,
        st: created.status,
        sent: created.sent_at,
        resp: created.responded_at
      },
      command,
      message: 'Đã tiếp nhận lệnh điều khiển.'
    });
  });

  return { router, authenticate };
}

module.exports = makeRouter;
