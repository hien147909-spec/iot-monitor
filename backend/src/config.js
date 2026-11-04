const path = require('node:path');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

module.exports = {
  projectRoot,
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'development-only-change-this-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  databaseFile: path.isAbsolute(process.env.DATABASE_FILE || '')
    ? process.env.DATABASE_FILE
    : path.resolve(projectRoot, process.env.DATABASE_FILE || 'backend/data/iot-monitor.db'),
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || '123456',
    name: process.env.ADMIN_NAME || 'Dương Văn Hướng'
  },
  mqtt: {
    url: process.env.MQTT_URL || '',
    username: process.env.MQTT_USERNAME || '',
    password: process.env.MQTT_PASSWORD || '',
    topicSensor: process.env.MQTT_TOPIC_SENSOR || 'data_sensor',
    topicControl: process.env.MQTT_TOPIC_CONTROL || 'device_control',
    topicResponse: process.env.MQTT_TOPIC_RESPONSE || 'device_response',
    clientId: process.env.MQTT_CLIENT_ID || `iot-monitor-${process.pid}`,
    simulator: bool(process.env.MQTT_SIMULATOR, false),
    sensorIntervalMs: Math.max(1000, Number(process.env.SENSOR_INTERVAL_MS || 2000)),
    commandTimeoutMs: Math.max(1000, Number(process.env.COMMAND_TIMEOUT_MS || 10000)),
    onlineTimeoutMs: Math.max(3000, Number(process.env.DEVICE_ONLINE_TIMEOUT_MS || 5000))
  }
};
