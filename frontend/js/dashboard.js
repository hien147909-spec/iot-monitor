/* ---------- live dashboard ---------- */

function drawNums() {
  $('#sT').textContent = cur ? `${cur.t.toFixed(1)} °C` : '--';
  $('#sH').textContent = cur ? `${cur.h.toFixed(1)} %` : '--';
  $('#sL').textContent = cur ? `${Math.round(cur.l)} lx` : '--';
  $('#last').textContent = cur
    ? `Giá trị cuối: ${cur.t.toFixed(1)}°C / ${cur.h.toFixed(1)}% / ${Math.round(cur.l)} lx`
    : 'Chưa nhận được dữ liệu từ cảm biến';
  $('#sLed').textContent = `${leds.filter(Boolean).length}/3 BẬT`;
  renderLeds();
}

function draw() {
  drawNums();

  const svg = $('#chart');
  if (!svg) return;

  const wrapper = svg.parentNode;
  const W = Math.max(wrapper.clientWidth, 480);
  const H = Math.max(wrapper.clientHeight, 280);
  const L = 56; // Left margin for Left Axis (°C, %)
  const R = 56; // Right margin for Right Axis (lx)
  const T = 26; // Top margin
  const B = 30; // Bottom margin for timestamps
  const plotW = W - L - R;
  const plotH = H - T - B;
  const n = series.length;
  const x = index => n <= 1 ? L + plotW / 2 : L + (index * plotW) / (n - 1);

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  if (n === 0) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="var(--mut)" font-size="13">Chưa có dữ liệu cảm biến từ ESP32</text>`;
    const tip = $('#chartTip');
    if (tip) tip.style.display = 'none';
    return;
  }

  // 1. Scale calculations
  // Cột đơn vị bên trái (Left Axis): Nhiệt độ (°C) & Độ ẩm (%): 0 - 100
  const minLeft = 0;
  const maxLeft = 100;
  const yLeft = val => T + plotH - ((Math.min(100, Math.max(0, val)) - minLeft) / (maxLeft - minLeft)) * plotH;

  // Cột đơn vị bên phải (Right Axis): Ánh sáng (lx): 0 - maxLux (tự thích ứng 500, 1000, 1500, ...)
  const maxDataLux = Math.max(...series.map(p => Number(p.l) || 0), 0);
  let maxLux = 1000;
  if (maxDataLux > 1000) {
    maxLux = Math.ceil(maxDataLux / 500) * 500;
  } else if (maxDataLux > 0 && maxDataLux <= 400) {
    maxLux = 500;
  }
  const minRight = 0;
  const yRight = val => T + plotH - ((Math.min(maxLux, Math.max(0, val)) - minRight) / (maxLux - minRight)) * plotH;

  // 2. Build SVG markup
  let markup = `
    <defs>
      <!-- Area gradients for subtle fill under curves -->
      <linearGradient id="gradT" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--t)" stop-opacity="0.22" />
        <stop offset="100%" stop-color="var(--t)" stop-opacity="0.01" />
      </linearGradient>
      <linearGradient id="gradH" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--h)" stop-opacity="0.20" />
        <stop offset="100%" stop-color="var(--h)" stop-opacity="0.01" />
      </linearGradient>
      <linearGradient id="gradL" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--l)" stop-opacity="0.18" />
        <stop offset="100%" stop-color="var(--l)" stop-opacity="0.01" />
      </linearGradient>
    </defs>
  `;

  // 3. Grid lines & Axis Labels (5 intervals = 6 ticks)
  // Left: 0, 20, 40, 60, 80, 100 (°C, %)
  // Right: 0, 200, 400, 600, 800, 1000 (lx)
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const fraction = i / steps;
    const yVal = T + plotH - fraction * plotH;
    const leftVal = Math.round(minLeft + fraction * (maxLeft - minLeft));
    const rightVal = Math.round(minRight + fraction * (maxLux - minRight));
    const isBase = (i === 0);

    // Horizontal grid line
    markup += `<line x1="${L}" x2="${W - R}" y1="${yVal}" y2="${yVal}" stroke="var(--line)" ${isBase ? 'stroke-width="1.2"' : 'stroke-dasharray="3 4" stroke-width="0.9"'} />`;

    // Cột trái: Nhãn trục (°C / %)
    markup += `<text x="${L - 8}" y="${yVal + 3.5}" text-anchor="end" fill="var(--mut)" font-size="10" font-weight="500">${leftVal}</text>`;
    markup += `<line x1="${L - 4}" x2="${L}" y1="${yVal}" y2="${yVal}" stroke="var(--line)" />`;

    // Cột phải: Nhãn trục (lx)
    markup += `<text x="${W - R + 8}" y="${yVal + 3.5}" text-anchor="start" fill="var(--mut)" font-size="10" font-weight="500">${rightVal}</text>`;
    markup += `<line x1="${W - R}" x2="${W - R + 4}" y1="${yVal}" y2="${yVal}" stroke="var(--line)" />`;
  }

  // Intermediate subtle tick lines for extra detail
  for (let i = 0; i < steps; i++) {
    const fraction = (i + 0.5) / steps;
    const yVal = T + plotH - fraction * plotH;
    markup += `<line x1="${L}" x2="${W - R}" y1="${yVal}" y2="${yVal}" stroke="var(--line)" stroke-dasharray="1 5" stroke-width="0.6" opacity="0.4" />`;
  }

  // Tiêu đề cho 2 cột đơn vị (Headers for the 2 unit columns)
  markup += `<text x="${L}" y="${T - 10}" text-anchor="middle" fill="var(--t)" font-size="11" font-weight="700">°C / %</text>`;
  markup += `<text x="${W - R}" y="${T - 10}" text-anchor="middle" fill="var(--l)" font-size="11" font-weight="700">lx</text>`;

  // 2 đường trục đứng cho 2 cột đơn vị
  markup += `<line x1="${L}" x2="${L}" y1="${T}" y2="${T + plotH}" stroke="var(--line)" stroke-width="1.2" />`;
  markup += `<line x1="${W - R}" x2="${W - R}" y1="${T}" y2="${T + plotH}" stroke="var(--line)" stroke-width="1.2" />`;

  // 4. Coordinates for 3 curves
  const coordsT = series.map((p, i) => `${x(i)},${yLeft(Number(p.t))}`);
  const coordsH = series.map((p, i) => `${x(i)},${yLeft(Number(p.h))}`);
  const coordsL = series.map((p, i) => `${x(i)},${yRight(Number(p.l))}`);

  // Area fills (dưới các đường để tạo chiều sâu)
  if (n > 1) {
    const baseY = T + plotH;
    markup += `<polygon points="${x(0)},${baseY} ${coordsL.join(' ')} ${x(n - 1)},${baseY}" fill="url(#gradL)" />`;
    markup += `<polygon points="${x(0)},${baseY} ${coordsH.join(' ')} ${x(n - 1)},${baseY}" fill="url(#gradH)" />`;
    markup += `<polygon points="${x(0)},${baseY} ${coordsT.join(' ')} ${x(n - 1)},${baseY}" fill="url(#gradT)" />`;
  }

  // 3 đường đồ thị chính
  // 1. Ánh sáng (lx)
  markup += `<polyline fill="none" stroke="var(--l)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${coordsL.join(' ')}" />`;
  // 2. Độ ẩm (%)
  markup += `<polyline fill="none" stroke="var(--h)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${coordsH.join(' ')}" />`;
  // 3. Nhiệt độ (°C)
  markup += `<polyline fill="none" stroke="var(--t)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" points="${coordsT.join(' ')}" />`;

  // Các điểm mốc (Dots) trên đường khi số mẫu vừa phải
  if (n <= 35) {
    series.forEach((p, i) => {
      const px = x(i);
      markup += `<circle cx="${px}" cy="${yLeft(Number(p.t))}" r="2.8" fill="var(--card)" stroke="var(--t)" stroke-width="1.6" />`;
      markup += `<circle cx="${px}" cy="${yLeft(Number(p.h))}" r="2.8" fill="var(--card)" stroke="var(--h)" stroke-width="1.6" />`;
      markup += `<circle cx="${px}" cy="${yRight(Number(p.l))}" r="2.8" fill="var(--card)" stroke="var(--l)" stroke-width="1.6" />`;
    });
  }

  // Vòng sáng và điểm nhấn cho giá trị mới nhất
  const lastIdx = n - 1;
  const lastX = x(lastIdx);
  const lastT = yLeft(Number(series[lastIdx].t));
  const lastH = yLeft(Number(series[lastIdx].h));
  const lastL = yRight(Number(series[lastIdx].l));

  markup += `<circle cx="${lastX}" cy="${lastT}" r="6" fill="none" stroke="var(--t)" stroke-width="1.2" opacity="0.6" />`;
  markup += `<circle cx="${lastX}" cy="${lastT}" r="3.6" fill="var(--t)" />`;

  markup += `<circle cx="${lastX}" cy="${lastH}" r="6" fill="none" stroke="var(--h)" stroke-width="1.2" opacity="0.6" />`;
  markup += `<circle cx="${lastX}" cy="${lastH}" r="3.6" fill="var(--h)" />`;

  markup += `<circle cx="${lastX}" cy="${lastL}" r="6" fill="none" stroke="var(--l)" stroke-width="1.2" opacity="0.6" />`;
  markup += `<circle cx="${lastX}" cy="${lastL}" r="3.6" fill="var(--l)" />`;

  // 5. Trục thời gian (Trục X)
  const tickCount = Math.min(5, n);
  const tickIndexes = [];
  if (n === 1) {
    tickIndexes.push(0);
  } else {
    for (let i = 0; i < tickCount; i++) {
      tickIndexes.push(Math.round((i * (n - 1)) / (tickCount - 1)));
    }
  }
  [...new Set(tickIndexes)].forEach(index => {
    const date = series[index].time;
    const label = date instanceof Date && !Number.isNaN(date.getTime())
      ? `${p2(date.getHours())}:${p2(date.getMinutes())}:${p2(date.getSeconds())}`
      : '--:--';
    const px = x(index);

    markup += `<line x1="${px}" x2="${px}" y1="${T}" y2="${T + plotH}" stroke="var(--line)" stroke-dasharray="2 4" stroke-width="0.8" opacity="0.4" />`;
    markup += `<line x1="${px}" x2="${px}" y1="${T + plotH}" y2="${T + plotH + 4}" stroke="var(--line)" stroke-width="1" />`;
    markup += `<text x="${px}" y="${H - 10}" text-anchor="middle" fill="var(--mut)" font-size="9.5">${label}</text>`;
  });

  svg.innerHTML = markup;

  // Tooltip & Crosshair tương tác chi tiết
  const tip = $('#chartTip');
  svg.onmousemove = event => {
    const rect = svg.getBoundingClientRect();
    const svgX = (event.clientX - rect.left) * W / Math.max(rect.width, 1);
    const index = n <= 1
      ? 0
      : Math.min(n - 1, Math.max(0, Math.round((svgX - L) / plotW * (n - 1))));
    const point = series[index];
    const px = x(index);

    const oldMarkers = svg.querySelectorAll('.chart-marker');
    oldMarkers.forEach(el => el.remove());

    const pyT_curr = yLeft(Number(point.t));
    const pyH_curr = yLeft(Number(point.h));
    const pyL_curr = yRight(Number(point.l));

    // Đường dóng dọc (crosshair)
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'chart-marker');
    line.setAttribute('x1', px);
    line.setAttribute('x2', px);
    line.setAttribute('y1', T);
    line.setAttribute('y2', T + plotH);
    line.setAttribute('stroke', 'var(--mut)');
    line.setAttribute('stroke-width', '1.2');
    line.setAttribute('stroke-dasharray', '3 3');
    svg.appendChild(line);

    // Điểm tròn highlight từng thông số trên đường cong
    const createDot = (cy, color) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'chart-marker');
      c.setAttribute('cx', px);
      c.setAttribute('cy', cy);
      c.setAttribute('r', '4.5');
      c.setAttribute('fill', color);
      c.setAttribute('stroke', 'var(--card)');
      c.setAttribute('stroke-width', '1.5');
      svg.appendChild(c);
    };
    createDot(pyT_curr, 'var(--t)');
    createDot(pyH_curr, 'var(--h)');
    createDot(pyL_curr, 'var(--l)');

    tip.innerHTML = `
      <b>${fmt(point.time)}</b>
      <div class="tip-row"><span style="color:var(--t)">● Nhiệt độ</span><span class="tip-val">${point.t.toFixed(1)} °C</span></div>
      <div class="tip-row"><span style="color:var(--h)">● Độ ẩm</span><span class="tip-val">${point.h.toFixed(1)} %</span></div>
      <div class="tip-row"><span style="color:var(--l)">● Ánh sáng</span><span class="tip-val">${Math.round(point.l)} lx</span></div>
    `;
    tip.style.display = 'block';

    const tipW = tip.offsetWidth || 180;
    const tipH = tip.offsetHeight || 92;
    const wrapperRect = wrapper.getBoundingClientRect();
    const mouseX = event.clientX - wrapperRect.left;
    const mouseY = event.clientY - wrapperRect.top;
    let left = mouseX + 16;
    if (left + tipW > wrapper.clientWidth - 8) left = mouseX - tipW - 16;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, Math.min(wrapper.clientHeight - tipH - 4, mouseY - tipH / 2))}px`;
  };

  svg.onmouseleave = () => {
    if (tip) tip.style.display = 'none';
    const oldMarkers = svg.querySelectorAll('.chart-marker');
    oldMarkers.forEach(el => el.remove());
  };
}

/* ---------- LED control ---------- */

let busy = false;

function renderLeds() {
  const box = $('#ledList');
  if (!box) return;

  box.innerHTML = leds.map((state, index) => `
    <div class="led">
      <div>
        <b>Đèn ${index + 1}</b>
        <small>${state ? 'BẬT' : 'TẮT'}</small>
      </div>
      <span class="dot ${state ? 'on' : ''}"></span>
      <div class="bt">
        <button class="btn ${state ? '' : 'on'}" data-l="${index}" data-s="1" ${busy ? 'disabled' : ''}>Bật</button>
        <button class="btn ${state ? 'off' : ''}" data-l="${index}" data-s="0" ${busy ? 'disabled' : ''}>Tắt</button>
      </div>
    </div>
  `).join('');

  box.querySelectorAll('button').forEach(button => {
    button.onclick = () => sendCmd(Number(button.dataset.l), button.dataset.s === '1');
  });

  const activeCount = leds.filter(Boolean).length;
  if ($('#allOn') && $('#allOff')) {
    $('#allOn').disabled = busy;
    $('#allOff').disabled = busy;
    $('#allOn').className = `btn ${activeCount === 0 ? 'on' : ''}`;
    $('#allOff').className = `btn ${activeCount === 3 ? 'off' : ''}`;
  }
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForCommand(actionId) {
  for (let attempt = 0; attempt < 16; attempt++) {
    await pause(700);
    try {
      await Promise.all([loadDashboard(), loadActions()]);
      const action = actions.find(item => Number(item.id) === Number(actionId));
      if (action && action.st !== 'wait') {
        busy = false;
        drawNums();
        if ($('#v-hist').classList.contains('on')) renderHist();
        toast(action.st === 'ok' ? `${action.act} thành công` : `${action.act} thất bại`);
        return;
      }
    } catch (error) {
      console.warn('Không thể kiểm tra phản hồi lệnh:', error.message);
    }
  }

  busy = false;
  drawNums();
  toast('Lệnh đã gửi; thiết bị chưa phản hồi. Hãy kiểm tra kết nối MQTT.');
}

async function sendControl(payload, label) {
  if (busy) return;
  if (!online && mqttStatus.mode !== 'simulator') {
    toast('Thiết bị đang offline');
    return;
  }

  busy = true;
  renderLeds();
  try {
    const result = await api('/devices/ESP32_01/led', {
      method: 'POST',
      body: payload
    });
    actions.unshift({ ...result.action, sent: new Date(result.action.sent), resp: null });
    renderHist();
    toast(`Đã gửi lệnh: ${label}`);
    waitForCommand(result.action.id);
  } catch (error) {
    busy = false;
    renderLeds();
    toast(error.message);
  }
}

function sendCmd(index, state) {
  if (leds[index] === state) {
    toast(`Đèn ${index + 1} đã ${state ? 'bật' : 'tắt'} sẵn`);
    return;
  }
  sendControl({ led: index + 1, state }, `${state ? 'Bật' : 'Tắt'} đèn ${index + 1}`);
}

function sendAll(state) {
  const already = leds.every(value => value === state);
  if (already) {
    toast(state ? 'Tất cả đèn đã bật' : 'Tất cả đèn đã tắt');
    return;
  }
  sendControl({ led: 'all', state }, state ? 'Bật tất cả' : 'Tắt tất cả');
}

$('#allOn').onclick = () => sendAll(true);
$('#allOff').onclick = () => sendAll(false);
