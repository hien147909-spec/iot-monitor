const $ = s => document.querySelector(s),
  $$ = s => [...document.querySelectorAll(s)];

const API_BASE = '/api';
const p2 = n => String(n).padStart(2, '0');

const fmt = value => {
  if (!value) return '--';
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '--';
  return `${dt.getFullYear()}/${p2(dt.getMonth() + 1)}/${p2(dt.getDate())} ${p2(dt.getHours())}:${p2(dt.getMinutes())}:${p2(dt.getSeconds())}`;
};

async function copyText(text, btn, e) {
  if (e) e.stopPropagation();
  if (!text || text === '--') return;
  try {
    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(`Đã sao chép: ${text}`);
    if (btn) {
      btn.classList.add('copied');
      btn.setAttribute('title', 'Đã sao chép!');
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.setAttribute('title', 'Sao chép thời gian');
      }, 1200);
    }
  } catch (err) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast(`Đã sao chép: ${text}`);
      if (btn) {
        btn.classList.add('copied');
        btn.setAttribute('title', 'Đã sao chép!');
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.setAttribute('title', 'Sao chép thời gian');
        }, 1200);
      }
    } catch (fallbackErr) {
      toast('Không thể sao chép');
    }
  }
}

function renderTimeCell(value) {
  const text = fmt(value);
  if (!text || text === '--') return '<span style="color:var(--mut)">--</span>';
  return `<span class="time-cell"><span>${text}</span><button type="button" class="btn-copy" onclick="copyText('${text}', this, event)" title="Sao chép thời gian" aria-label="Sao chép thời gian"><svg class="icon-copy" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><svg class="icon-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></button></span>`;
}

const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      if (value === null) return fallback;
      try { return JSON.parse(value); } catch { return value; }
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch {}
  }
};

async function api(path, options = {}) {
  const token = store.get('iot_token', '');
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      cache: options.cache || 'no-store',
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch (error) {
    throw new Error('Không thể kết nối backend. Hãy kiểm tra máy chủ Node.js.');
  }

  let payload = {};
  try { payload = await response.json(); } catch {}

  if (response.status === 401 && token && typeof showLogin === 'function') {
    showLogin('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  }
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

const UNIT = {
  'Nhiệt độ': '°C',
  'Độ ẩm': '%',
  'Ánh sáng': 'lx'
};

let sensors = [];
let actions = [];
let leds = [false, false, false];
let series = [];
let cur = null;
let online = false;
let mqttStatus = { connected: false, mode: 'disabled', brokerConnected: false };
let currentUser = null;
let pollingTimer = null;
let prevOnline = null;
let alertDismissed = false;
let currentSensorAlert = null;
let eventSource = null;

function playAlertBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(659, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (err) {}
}

function triggerAlertBanner(message) {
  const alertBanner = $('#alert-banner');
  if (!alertBanner) return;
  const alertText = alertBanner.querySelector('.alert-text');
  if (alertText) {
    alertText.textContent = message || '⚠️ CẢNH BÁO: ESP32 mất kết nối! Kiểm tra dây cảm biến hoặc nguồn điện.';
  }
  if (!alertDismissed) {
    alertBanner.classList.remove('hidden');
  }
}

const toast = message => {
  const element = $('#toast');
  if (!element) return;
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2400);
};

const cmp = (a, b, direction) =>
  (a > b ? 1 : a < b ? -1 : 0) * direction;

function pager(box, info, page, total, per, go, label) {
  const pages = Math.max(1, Math.ceil(total / per));
  const infoElement = $(info);
  const boxElement = $(box);
  if (infoElement) infoElement.textContent = `${total} ${label}`;
  if (!boxElement) return;

  boxElement.innerHTML = `
    <button ${page <= 1 ? 'disabled' : ''} data-p="${page - 1}" aria-label="Trang trước">‹</button>
    <span>${page} / ${pages}</span>
    <button ${page >= pages ? 'disabled' : ''} data-p="${page + 1}" aria-label="Trang sau">›</button>
  `;
  boxElement.querySelectorAll('button').forEach(button => {
    button.onclick = () => go(Number(button.dataset.p));
  });
}

function updateConnectionUI() {
  const label = online ? '● ESP32 đang kết nối' : '● ESP32 mất kết nối';
  ['#conn', '#conn2'].forEach(selector => {
    const element = $(selector);
    if (!element) return;
    element.textContent = label;
    element.classList.toggle('off', !online);
  });
  if ($('#onl')) {
    $('#onl').textContent = `Trạng thái: ${online ? 'ONLINE' : 'OFFLINE'}`;
    $('#onl').classList.toggle('offline', !online);
    $('#onl').title = online ? 'ESP32 vừa gửi dữ liệu cảm biến' : 'Chưa nhận dữ liệu cảm biến trong thời gian cho phép';
  }

  const brokerConnected = Boolean(mqttStatus.brokerConnected);
  const modeLabels = {
    simulator: 'MÔ PHỎNG (không phải ESP32)',
    mqtt: brokerConnected ? 'Broker MQTT đã kết nối' : 'Broker MQTT mất kết nối',
    disabled: 'Chưa cấu hình MQTT'
  };
  if ($('#mq')) $('#mq').textContent = modeLabels[mqttStatus.mode] || 'Không xác định';

  if ($('#chartSource')) {
    let sourceLabel;
    if (mqttStatus.mode === 'simulator') {
      sourceLabel = 'Dữ liệu mô phỏng nội bộ • không phải số đo phần cứng';
    } else if (mqttStatus.mode === 'mqtt' && brokerConnected && online) {
      sourceLabel = 'Dữ liệu ESP32 thật qua MQTT • làm mới mỗi 2 giây';
    } else if (mqttStatus.mode === 'mqtt' && brokerConnected) {
      sourceLabel = 'Broker đã sẵn sàng • đang chờ ESP32 gửi dữ liệu';
    } else if (mqttStatus.mode === 'mqtt') {
      sourceLabel = 'Đang kết nối broker MQTT • chưa có dữ liệu mới';
    } else {
      sourceLabel = 'Cấu hình MQTT để nhận dữ liệu từ ESP32';
    }
    $('#chartSource').textContent = sourceLabel;
  }

  // Alert banner: show when device goes offline or sensor wire disconnected
  const alertBanner = $('#alert-banner');
  if (alertBanner && mqttStatus.mode !== 'disabled') {
    if (!online || currentSensorAlert) {
      const msg = currentSensorAlert || '⚠️ CẢNH BÁO: ESP32 mất kết nối! Kiểm tra dây cảm biến hoặc nguồn điện.';
      triggerAlertBanner(msg);
      if (prevOnline === true) {
        playAlertBeep();
      }
    } else {
      alertBanner.classList.add('hidden');
      alertDismissed = false;
    }
    prevOnline = online && !currentSensorAlert;
  }
}

async function loadDashboard() {
  const data = await api('/dashboard/summary');
  online = Boolean(data.online);
  currentSensorAlert = data.sensorAlert || null;
  mqttStatus = data.mqtt || mqttStatus;
  leds = Array.isArray(data.leds) ? data.leds.map(Boolean) : [false, false, false];
  cur = data.current ? {
    t: Number(data.current.temperature),
    h: Number(data.current.humidity),
    l: Number(data.current.lux),
    time: new Date(data.current.time)
  } : null;
  series = (data.series || []).map(point => ({
    t: Number(point.t),
    h: Number(point.h),
    l: Number(point.l),
    time: new Date(point.time)
  }));

  updateConnectionUI();
  if ($('#lastCmd')) $('#lastCmd').textContent = data.lastCommand?.action || '--';
  if ($('#upd')) $('#upd').textContent = fmt(data.updatedAt);

  if ($('#v-dash')?.classList.contains('on')) draw();
  else drawNums();
  return data;
}

async function loadSensors() {
  const data = await api('/sensors/data?limit=30000');
  sensors = (data.items || []).map(item => ({
    ...item,
    time: new Date(item.time),
    val: Number(item.val)
  }));
  if (typeof renderSensors === 'function') renderSensors();
  return sensors;
}

async function loadActions() {
  const data = await api('/actions?limit=2000');
  actions = (data.items || []).map(item => ({
    ...item,
    sent: new Date(item.sent),
    resp: item.resp ? new Date(item.resp) : null
  }));
  if (typeof renderHist === 'function') renderHist();
  return actions;
}

async function loadAllData() {
  const results = await Promise.allSettled([loadDashboard(), loadSensors(), loadActions()]);
  const failed = results.find(result => result.status === 'rejected');
  if (failed) toast(failed.reason.message || 'Không thể tải dữ liệu.');
  if (typeof renderAll === 'function') renderAll();
}

function initSSE() {
  if (typeof EventSource === 'undefined') return;
  const token = store.get('iot_token', '');
  if (!token) return;

  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  try {
    eventSource = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    eventSource.addEventListener('alert', e => {
      try {
        const data = JSON.parse(e.data);
        console.warn('[Realtime Alert]', data);
        if (data.type === 'OFFLINE' || data.type === 'SENSOR_DISCONNECTED') {
          online = false;
          currentSensorAlert = data.message;
          alertDismissed = false;
          triggerAlertBanner(data.message);
          playAlertBeep();
          updateConnectionUI();
        } else if (data.type === 'ONLINE') {
          online = true;
          currentSensorAlert = null;
          updateConnectionUI();
          toast('✅ ' + (data.message || 'Thiết bị đã kết nối lại'));
        }
      } catch (err) {}
    });

    eventSource.addEventListener('sensor', e => {
      if (!online || currentSensorAlert) {
        online = true;
        currentSensorAlert = null;
        updateConnectionUI();
      }
      loadDashboard();
    });

    eventSource.onerror = () => {
      // Browser reconnects automatically
    };
  } catch (err) {
    console.warn('SSE error:', err.message);
  }
}

function startPolling() {
  stopPolling();
  initSSE();
  pollingTimer = setInterval(async () => {
    try { await loadDashboard(); } catch (error) { console.warn(error.message); }
    if ($('#v-sensor')?.classList.contains('on')) {
      try { await loadSensors(); } catch (error) { console.warn(error.message); }
    }
    if ($('#v-hist')?.classList.contains('on')) {
      try { await loadActions(); } catch (error) { console.warn(error.message); }
    }
  }, 2000);
}

function stopPolling() {
  if (pollingTimer) clearInterval(pollingTimer);
  pollingTimer = null;
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

// Alert banner close button
if ($('#alertClose')) {
  $('#alertClose').onclick = () => {
    const banner = $('#alert-banner');
    if (banner) banner.classList.add('hidden');
    alertDismissed = true;
  };
}
