/* ---------- authentication and navigation ---------- */

function setDash() {
  document.body.classList.toggle('dash', $('#v-dash').classList.contains('on'));
  document.body.classList.toggle('sensor-page', $('#v-sensor').classList.contains('on'));
  document.body.classList.toggle('hist-page', $('#v-hist').classList.contains('on'));
}

function showLogin(message = '') {
  stopPolling();
  store.remove('iot_token');
  currentUser = null;
  $('#app').style.display = 'none';
  $('#login').style.display = 'flex';
  $('#lerr').textContent = message;
}

async function enter(user) {
  currentUser = user || null;
  $('#login').style.display = 'none';
  $('#app').style.display = 'block';
  $('#lerr').textContent = '';
  setDash();
  await loadAllData();
  if (store.get('iot_token', '')) startPolling();
}

window.addEventListener('resize', () => {
  if ($('#v-dash').classList.contains('on')) draw();
});

$('#lgo').onclick = async () => {
  const button = $('#lgo');
  button.disabled = true;
  $('#lerr').textContent = '';
  const u = $('#u').value.trim();
  const p = $('#p').value;
  try {
    const creds = btoa(unescape(encodeURIComponent(`${u}:${p}`)));
    const result = await api('/auth/login', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`
      },
      body: {
        username: u,
        password: p
      }
    });
    store.set('iot_token', result.token);
    await enter(result.user);
  } catch (error) {
    $('#lerr').textContent = error.message || 'Đăng nhập thất bại.';
  } finally {
    button.disabled = false;
  }
};

$('#p').onkeydown = event => {
  if (event.key === 'Enter') $('#lgo').click();
};

$('#out').onclick = async () => {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch (err) {}
  showLogin('Bạn đã đăng xuất.');
};

$$('#nav [data-v]').forEach(button => {
  button.onclick = async () => {
    $$('#nav button').forEach(item => item.classList.remove('on'));
    button.classList.add('on');
    $$('.view').forEach(view => view.classList.remove('on'));
    $('#v-' + button.dataset.v).classList.add('on');
    setDash();

    try {
      if (button.dataset.v === 'dash') await loadDashboard();
      if (button.dataset.v === 'sensor') await loadSensors();
      if (button.dataset.v === 'hist') await loadActions();
    } catch (error) {
      toast(error.message);
    }

    if (button.dataset.v === 'dash') draw();
    if (button.dataset.v === 'sensor') renderSensors();
    if (button.dataset.v === 'hist') renderHist();
  };
});

/* Restore the API session after a page refresh. */
(async () => {
  if (!store.get('iot_token', '')) {
    showLogin();
    return;
  }
  try {
    const result = await api('/auth/me');
    await enter(result.user);
  } catch (error) {
    showLogin('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  }
})();

const RES = {
  code: [
    'Kho mã nguồn',
    'Source của frontend, backend, SQLite và firmware ESP32 nằm trong cùng dự án.',
    `<pre>iot-monitor-project/
├─ backend/      # Express REST API, JWT, MQTT service
│  ├─ src/       # config, database, routes, server
│  └─ database/  # SQLite schema
├─ frontend/     # HTML, CSS, JavaScript
├─ esp32/        # ESP32 + DHT11 + LDR + 3 LED
├─ mosquitto/    # MQTT broker config
├─ .env.example
└─ docker-compose.yml</pre>`
  ],

  figma: [
    'Thiết kế giao diện',
    'Các màn hình đã thiết kế:',
    `<ul>
      <li>Đăng nhập</li>
      <li>Tổng quan: thẻ số liệu, biểu đồ realtime, điều khiển LED</li>
      <li>Dữ liệu cảm biến: tìm kiếm, lọc, sắp xếp, phân trang</li>
      <li>Lịch sử điều khiển (Action History)</li>
      <li>Hồ sơ</li>
    </ul>
    <small style="color:var(--mut)">
      Màu chủ đạo: xanh đậm #173f4a, xanh ngọc #2a9d8f, cam #f0a060.
    </small>`
  ],

  api: [
    'Tài liệu API',
    'Danh sách đầy đủ các endpoint REST API có xác thực JWT Token.',
    `<table>
      <thead>
        <tr>
          <th>Chức năng</th>
          <th>Method</th>
          <th>Endpoint</th>
          <th>Xác thực</th>
          <th>Mục đích</th>
        </tr>
      </thead>

      <tbody>
        <tr>
          <td>Đăng nhập</td>
          <td><span class="tag ok">POST</span></td>
          <td><code>/api/auth/login</code></td>
          <td><span class="tag ok">Basic / Credentials</span></td>
          <td>Xác thực thông tin & Cấp JWT Token</td>
        </tr>

        <tr>
          <td>Dashboard</td>
          <td><span class="tag wait">GET</span></td>
          <td><code>/api/dashboard/summary</code></td>
          <td><span class="tag ok">Bearer Token</span></td>
          <td>Tổng quan, dữ liệu 30 mẫu</td>
        </tr>

        <tr>
          <td>Sensor Data</td>
          <td><span class="tag wait">GET</span></td>
          <td><code>/api/sensors/data</code></td>
          <td><span class="tag ok">Bearer Token</span></td>
          <td>Tra cứu, lọc, phân trang</td>
        </tr>

        <tr>
          <td>Control LED</td>
          <td><span class="tag ok">POST</span></td>
          <td><code>/api/devices/:id/led</code></td>
          <td><span class="tag ok">Bearer Token</span></td>
          <td>Gửi lệnh ON/OFF đèn</td>
        </tr>

        <tr>
          <td>Trạng thái LED</td>
          <td><span class="tag wait">GET</span></td>
          <td><code>/api/devices/:id/led</code></td>
          <td><span class="tag ok">Bearer Token</span></td>
          <td>Lấy trạng thái LED hiện thời</td>
        </tr>

        <tr>
          <td>Status & Restore</td>
          <td><span class="tag wait">GET</span></td>
          <td><code>/api/devices/:id/status</code></td>
          <td><span class="tag ok">Bearer Token</span></td>
          <td>Trạng thái LED & kết nối đã lưu</td>
        </tr>

        <tr>
          <td>Action History</td>
          <td><span class="tag wait">GET</span></td>
          <td><code>/api/actions</code></td>
          <td><span class="tag ok">Bearer Token</span></td>
          <td>Lịch sử điều khiển thiết bị</td>
        </tr>

        <tr>
          <td>Profile</td>
          <td><span class="tag wait">GET</span></td>
          <td><code>/api/users/me</code></td>
          <td><span class="tag ok">Bearer Token</span></td>
          <td>Thông tin người dùng</td>
        </tr>

        <tr>
          <td>Realtime SSE</td>
          <td><span class="tag wait">GET</span></td>
          <td><code>/api/events</code></td>
          <td><span class="tag ok">Bearer Token</span></td>
          <td>Stream cảnh báo & cảm biến (SSE)</td>
        </tr>

        <tr>
          <td>Đăng xuất</td>
          <td><span class="tag ok">POST</span></td>
          <td><code>/api/auth/logout</code></td>
          <td><span class="tag ok">Bearer Token</span></td>
          <td>Hủy phiên đăng nhập</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top:12px;padding:10px;background:var(--bg);border-radius:8px;font-size:12px">
      <b>Xác thực Token:</b> Gửi kèm Header <code>Authorization: Bearer &lt;token&gt;</code> trong mọi request (hoặc query <code>?token=</code> cho SSE). Nếu thiếu hoặc token hết hạn, hệ thống trả về <b>HTTP 401 Unauthorized</b>.
    </div>

    <p style="font-size:12px;color:var(--mut);margin-top:8px">
      MQTT topic:
      data_sensor (ESP32 → Backend),
      device_control (Backend → ESP32),
      device_response (ESP32 → Backend).
    </p>`
  ],

  pdf: [
    'Báo cáo PDF',
    'Mục lục báo cáo bài thực hành 1.',
    `<ul>
      <li>Chương 1. Giới thiệu: bối cảnh, giải pháp, chức năng, kiến trúc, luồng hoạt động</li>
      <li>Chương 2. Các thành phần: ESP32, DHT11, LDR, LED, MQTT Broker, Backend, Database, Frontend</li>
      <li>Chương 3. Use case, API và cơ sở dữ liệu (UC01 đến UC06)</li>
      <li>Chương 4. Kết luận: kết quả đạt được và hạn chế</li>
    </ul>`
  ]
};


const URLS = {
  code: 'https://github.com/hien147909-spec/iot-monitor',

  figma: 'https://www.figma.com/design/ovzCv4svSmo6ULwy7XVN6k/Gi%C3%A1m+s%C3%A1t+IoT---B23DCAT122?node-id=0-1&t=gFdTrJfflcijPU5X-0',

  api: 'https://documenter.getpostman.com/view/23122122/iot-monitor-api',

  pdf: 'https://drive.google.com/file/d/1B23DCAT122-BTH1/view'
};


$$('[data-r]').forEach(b => {
  b.onclick = () => {
    const r = RES[b.dataset.r],
      u = URLS[b.dataset.r];

    $('#mbox').innerHTML = `
      <div class="row">
        <h3>${r[0]}</h3>
        <button class="btn" id="mx">Đóng</button>
      </div>

      <p style="color:var(--mut);margin:4px 0 6px">
        ${r[1]}
      </p>

      <p style="margin:0 0 12px">
        <a href="${u}"
           target="_blank"
           rel="noopener">
          ${u}
        </a>
      </p>

      ${r[2]}
    `;

    $('#modal').classList.add('on');

    $('#mx').onclick = () =>
      $('#modal').classList.remove('on');
  };
});


$('#modal').onclick = e => {
  if (e.target.id === 'modal') {
    $('#modal').classList.remove('on');
  }
};
