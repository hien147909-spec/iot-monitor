const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const config = require('./config');
const { db } = require('./database');
const DeviceService = require('./mqtt-service');
const makeRouter = require('./routes');

const app = express();
const deviceService = new DeviceService(config.mqtt);
deviceService.start();

app.disable('x-powered-by');
// The original frontend contains inline style attributes, so CSP is disabled here.
// For public deployment, move inline styles to CSS and enable a strict CSP.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use('/api', makeRouter(config, deviceService).router);
app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API endpoint.' }));

const frontendDir = path.resolve(config.projectRoot, 'frontend');
app.use(express.static(frontendDir, { extensions: ['html'] }));
app.get('*', (req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(frontendDir, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[HTTP] Unhandled error:', err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'Lỗi máy chủ. Kiểm tra log backend để biết chi tiết.' });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log('--------------------------------------------------');
  console.log(`IoT Monitor is running at http://localhost:${config.port}`);
  console.log(`Frontend: ${frontendDir}`);
  console.log(`Database: ${config.databaseFile}`);
  console.log(`Device mode: ${deviceService.mode}`);
  console.log('Admin account is configured with ADMIN_USERNAME / ADMIN_PASSWORD.');
  console.log('--------------------------------------------------');
});

function shutdown(signal) {
  console.log(`\n[APP] ${signal} received; shutting down...`);
  server.close(() => {
    deviceService.stop();
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
