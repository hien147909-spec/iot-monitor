const EventEmitter = require('node:events');
const mqtt = require('mqtt');
const { db, now } = require('./database');

class DeviceService extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.client = null;
    this.mode = 'disabled';
    this.simulatorTimer = null;
    this.watchdogTimer = null;
    this.sensorAlerts = new Map(); // deviceId -> alert string
    this.activeCommands = new Map();
    this.simulated = { temperature: 27.4, humidity: 64.8, lux: 612 };
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;

    // Periodic watchdog: checks every second if device stopped sending data (wire pulled out)
    this.watchdogTimer = setInterval(() => this.checkDeviceHealth(), 1000);

    if (this.config.url) {
      this.mode = 'mqtt';
      this.client = mqtt.connect(this.config.url, {
        clientId: this.config.clientId,
        username: this.config.username || undefined,
        password: this.config.password || undefined,
        reconnectPeriod: 3000,
        connectTimeout: 10000,
        clean: true
      });

      this.client.on('connect', () => {
        console.log(`[MQTT] Connected: ${this.config.url}`);
        this.client.subscribe(
          [this.config.topicSensor, this.config.topicResponse],
          { qos: 1 },
          err => {
            if (err) console.error('[MQTT] Subscribe error:', err.message);
            else console.log('[MQTT] Subscribed to sensor and response topics');
          }
        );
      });
      this.client.on('reconnect', () => console.log('[MQTT] Reconnecting...'));
      this.client.on('offline', () => console.warn('[MQTT] Broker offline'));
      this.client.on('error', err => console.error('[MQTT] Error:', err.message));
      this.client.on('message', (topic, payload) => {
        if (topic === this.config.topicSensor) this.handleSensorMessage(payload);
        if (topic === this.config.topicResponse) this.handleDeviceResponse(payload);
      });
      return;
    }

    if (this.config.simulator) {
      this.mode = 'simulator';
      console.log('[DEVICE] MQTT_URL is empty; built-in ESP32 simulator is enabled.');
      this.generateSensorSample();
      this.simulatorTimer = setInterval(
        () => this.generateSensorSample(),
        this.config.sensorIntervalMs
      );
    } else {
      this.mode = 'disabled';
      console.warn('[DEVICE] MQTT is not configured and simulator is disabled.');
    }
  }

  isReady() {
    if (this.mode === 'simulator') return true;
    return this.mode === 'mqtt' && Boolean(this.client && this.client.connected);
  }

  connectionInfo() {
    return {
      mode: this.mode,
      connected: this.mode === 'simulator' || Boolean(this.client && this.client.connected),
      brokerConnected: Boolean(this.client && this.client.connected)
    };
  }

  getDeviceOnline(device) {
    if (!device) return false;
    if (this.mode === 'simulator') return true;
    if (this.sensorAlerts.has(device.id)) return false;
    if (device.online === 0) return false;
    if (!device.last_seen) return false;
    return Date.now() - new Date(device.last_seen).getTime() <= this.config.onlineTimeoutMs;
  }

  getSensorAlert(deviceId) {
    return this.sensorAlerts.get(deviceId) || null;
  }

  checkDeviceHealth() {
    if (this.mode === 'simulator') return;
    try {
      const devices = db.prepare('SELECT id, online, last_seen FROM devices').all();
      for (const d of devices) {
        const isOnline = this.getDeviceOnline(d);
        if (!isOnline && d.online === 1) {
          db.prepare('UPDATE devices SET online = 0 WHERE id = ?').run(d.id);
          const alertMsg = this.sensorAlerts.get(d.id) || 'Mất kết nối ESP32! Kiểm tra dây cáp hoặc nguồn điện.';
          this.emit('alert', {
            type: 'OFFLINE',
            deviceId: d.id,
            message: alertMsg
          });
        }
      }
    } catch (err) {
      console.warn('[WATCHDOG] Check error:', err.message);
    }
  }

  handleSensorMessage(payload) {
    let message;
    try {
      message = JSON.parse(Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload));
    } catch (error) {
      console.warn('[MQTT] Invalid sensor JSON:', error.message);
      return;
    }

    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      console.warn('[MQTT] Sensor payload must be a JSON object.');
      return;
    }

    const deviceId = String(message.device_id || 'ESP32_01').trim();
    const toNumber = value => value === null || value === undefined || String(value).trim() === ''
      ? NaN
      : Number(value);
    const temperature = toNumber(message.temperature);
    const humidity = toNumber(message.humidity);
    const lux = toNumber(message.lux);

    if (!/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) {
      console.warn('[MQTT] Rejected sensor payload: invalid device_id.');
      return;
    }
    if (
      !Number.isFinite(temperature) || temperature < -40 || temperature > 85 ||
      !Number.isFinite(humidity) || humidity < 0 || humidity > 100 ||
      !Number.isFinite(lux) || lux < 0 || lux > 100000
    ) {
      console.warn(`[MQTT] Rejected out-of-range or missing sensor values from ${deviceId}.`);
      return;
    }

    const timestamp = now();
    const saveSample = db.transaction(() => {
      db.prepare(`
        INSERT INTO devices (id, name, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(deviceId, deviceId, timestamp);
      db.prepare('UPDATE devices SET online = 1, last_seen = ? WHERE id = ?').run(timestamp, deviceId);
      db.prepare(`
        INSERT INTO sensor_samples (device_id, temperature, humidity, lux, received_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(deviceId, temperature, humidity, lux, timestamp);

      // Retain up to 30,000 samples across devices.
      db.prepare(`
        DELETE FROM sensor_samples
        WHERE id NOT IN (SELECT id FROM sensor_samples ORDER BY received_at DESC, id DESC LIMIT 30000)
      `).run();
    });
    saveSample();

    const hadAlert = this.sensorAlerts.has(deviceId);
    if (hadAlert) {
      this.sensorAlerts.delete(deviceId);
      this.emit('alert', {
        type: 'ONLINE',
        deviceId,
        message: 'Dữ liệu cảm biến đã hoạt động trở lại bình thường'
      });
    }

    this.emit('sensor', {
      deviceId,
      temperature,
      humidity,
      lux,
      time: timestamp
    });
  }

  handleDeviceResponse(payload) {
    let message;
    try {
      message = JSON.parse(Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload));
    } catch (error) {
      console.warn('[MQTT] Invalid device response JSON:', error.message);
      return;
    }

    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const deviceId = String(message.device_id || 'ESP32_01').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) return;

    // Handle LWT (Last Will and Testament) - abrupt disconnection / wire pulled
    if (message.type === 'LWT_OFFLINE') {
      console.warn(`[MQTT] LWT Alert: Device ${deviceId} abruptly disconnected!`);
      db.prepare('UPDATE devices SET online = 0 WHERE id = ?').run(deviceId);
      const alertText = 'CẢNH BÁO: ESP32 vừa bị rút dây nguồn hoặc ngắt kết nối!';
      this.sensorAlerts.set(deviceId, alertText);
      this.emit('alert', {
        type: 'OFFLINE',
        deviceId,
        message: alertText
      });
      return;
    }

    // Handle sensor wire disconnected alert (DHT11 read failed)
    if (message.type === 'SENSOR_DISCONNECTED') {
      const msg = message.message || 'CẢNH BÁO: Dây cảm biến DHT11 vừa bị rút ra!';
      console.warn(`[MQTT] SENSOR_DISCONNECTED Alert from ${deviceId}: ${msg}`);
      this.sensorAlerts.set(deviceId, msg);
      this.emit('alert', {
        type: 'SENSOR_DISCONNECTED',
        deviceId,
        message: msg
      });
      return;
    }

    // Handle sensor wire reconnected
    if (message.type === 'SENSOR_RECONNECTED') {
      console.log(`[MQTT] SENSOR_RECONNECTED from ${deviceId}`);
      this.sensorAlerts.delete(deviceId);
      this.emit('alert', {
        type: 'ONLINE',
        deviceId,
        message: 'Dây cảm biến đã được cắm lại thành công'
      });
      return;
    }

    // Handle restore request: ESP32 reconnected and wants saved LED states
    if (message.type === 'RESTORE_REQUEST') {
      this.restoreDeviceState(deviceId);
      return;
    }

    const normalize = value => {
      if (typeof value === 'boolean') return value ? 1 : 0;
      const text = String(value ?? '').toUpperCase();
      if (text === 'ON') return 1;
      if (text === 'OFF') return 0;
      return null;
    };
    const led1 = normalize(message.led1);
    const led2 = normalize(message.led2);
    const led3 = normalize(message.led3);
    if ([led1, led2, led3].some(value => value === null)) {
      console.warn(`[MQTT] Rejected invalid LED response from ${deviceId}.`);
      return;
    }

    const timestamp = now();
    db.prepare(`
      INSERT INTO devices (id, name, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(deviceId, deviceId, timestamp);
    db.prepare(`
      UPDATE devices
      SET led1 = ?, led2 = ?, led3 = ?, online = 1, last_seen = ?
      WHERE id = ?
    `).run(led1, led2, led3, timestamp, deviceId);

    const active = this.activeCommands.get(deviceId);
    if (!active) return;

    // Echoed request_id prevents a delayed response completing a newer command.
    if (message.request_id !== undefined && String(message.request_id) !== String(active.actionId)) return;

    const action = db.prepare('SELECT * FROM action_history WHERE id = ?').get(active.actionId);
    if (!action || action.status !== 'wait') {
      this.clearActive(deviceId);
      this.dispatchNext(deviceId);
      return;
    }

    const allStates = [led1, led2, led3];
    const actualState = action.led_index === 0
      ? allStates.every(value => value === action.target_state)
      : allStates[action.led_index - 1] === action.target_state;
    const responseMessage = String(message.message || (actualState ? 'SUCCESS' : 'Unexpected LED state'));
    const status = actualState && !/^(ERROR|FAIL)/i.test(responseMessage) ? 'ok' : 'bad';

    db.prepare(`
      UPDATE action_history
      SET status = ?, responded_at = ?, response_message = ?
      WHERE id = ? AND status = 'wait'
    `).run(status, timestamp, responseMessage, action.id);

    this.clearActive(deviceId);
    this.dispatchNext(deviceId);
  }

  restoreDeviceState(deviceId) {
    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
    const timestamp = now();

    if (!device) {
      db.prepare(`
        INSERT INTO devices (id, name, online, last_seen, created_at)
        VALUES (?, ?, 1, ?, ?)
      `).run(deviceId, deviceId, timestamp, timestamp);
      console.log(`[MQTT] New device ${deviceId} connected. No saved LED state to restore.`);
      return;
    }

    db.prepare('UPDATE devices SET online = 1, last_seen = ? WHERE id = ?')
      .run(timestamp, deviceId);

    if (this.mode !== 'mqtt' || !this.client || !this.client.connected) {
      console.log(`[MQTT] Cannot restore ${deviceId}: broker not connected.`);
      return;
    }

    const command = `RESTORE:${device.led1},${device.led2},${device.led3}`;
    console.log(`[MQTT] Restoring LED states for ${deviceId}: ${command}`);
    this.client.publish(this.config.topicControl, command, { qos: 1, retain: false });
  }

  generateSensorSample() {
    const drift = (value, amount, min, max, digits = 1) =>
      Number(Math.min(max, Math.max(min, value + (Math.random() - 0.5) * amount)).toFixed(digits));
    this.simulated.temperature = drift(this.simulated.temperature, 0.24, 20, 40, 1);
    this.simulated.humidity = drift(this.simulated.humidity, 0.8, 30, 95, 1);
    this.simulated.lux = Math.round(Math.min(790, Math.max(10, this.simulated.lux + (Math.random() - 0.5) * 60)));
    this.handleSensorMessage(Buffer.from(JSON.stringify({
      device_id: 'ESP32_01',
      ...this.simulated
    })));
  }

  enqueueAction(actionId) {
    const action = db.prepare('SELECT * FROM action_history WHERE id = ?').get(actionId);
    if (action) this.dispatchNext(action.device_id);
  }

  buildCommand(action) {
    if (action.led_index === 0) return action.target_state ? 'ALL_ON' : 'ALL_OFF';
    return `LED${action.led_index}_${action.target_state ? 'ON' : 'OFF'}`;
  }

  dispatchNext(deviceId) {
    if (this.activeCommands.has(deviceId)) return;
    const action = db.prepare(`
      SELECT * FROM action_history
      WHERE device_id = ? AND status = 'wait'
      ORDER BY id ASC LIMIT 1
    `).get(deviceId);
    if (!action) return;

    if (!this.isReady()) {
      this.failAction(action.id, 'MQTT broker is not connected');
      setImmediate(() => this.dispatchNext(deviceId));
      return;
    }

    const command = `${this.buildCommand(action)}|${action.id}`;
    const timer = setTimeout(() => {
      this.failAction(action.id, 'Device response timeout');
      this.clearActive(deviceId);
      this.dispatchNext(deviceId);
    }, this.config.commandTimeoutMs);
    this.activeCommands.set(deviceId, { actionId: action.id, timer });

    if (this.mode === 'simulator') {
      setTimeout(() => {
        const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
        if (!device) return;
        const states = [device.led1, device.led2, device.led3];
        const value = action.target_state;
        if (action.led_index === 0) states.fill(value);
        else states[action.led_index - 1] = value;
        this.handleDeviceResponse(Buffer.from(JSON.stringify({
          device_id: deviceId,
          request_id: String(action.id),
          led1: states[0] ? 'ON' : 'OFF',
          led2: states[1] ? 'ON' : 'OFF',
          led3: states[2] ? 'ON' : 'OFF',
          message: 'SUCCESS'
        })));
      }, 350);
      return;
    }

    this.client.publish(this.config.topicControl, command, { qos: 1, retain: false }, error => {
      if (error) {
        this.failAction(action.id, error.message || 'MQTT publish failed');
        this.clearActive(deviceId);
        this.dispatchNext(deviceId);
      }
    });
  }

  failAction(actionId, reason) {
    db.prepare(`
      UPDATE action_history
      SET status = 'bad', responded_at = ?, response_message = ?
      WHERE id = ? AND status = 'wait'
    `).run(now(), reason, actionId);
  }

  clearActive(deviceId) {
    const active = this.activeCommands.get(deviceId);
    if (active) clearTimeout(active.timer);
    this.activeCommands.delete(deviceId);
  }

  stop() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    if (this.simulatorTimer) clearInterval(this.simulatorTimer);
    for (const deviceId of this.activeCommands.keys()) this.clearActive(deviceId);
    if (this.client) this.client.end(true);
  }
}

module.exports = DeviceService;
