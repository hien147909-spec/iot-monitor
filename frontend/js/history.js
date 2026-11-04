/* ---------- action history ---------- */

let hPage = 1;
let hAsc = false;

const ST = {
  ok: 'Thành công',
  bad: 'Thất bại',
  wait: 'Đang xử lý'
};

function matchHistTime(value, query) {
  if (!value || !query) return false;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const y = String(date.getFullYear());
  const m = p2(date.getMonth() + 1);
  const mSingle = String(date.getMonth() + 1);
  const day = p2(date.getDate());
  const daySingle = String(date.getDate());
  const hh = p2(date.getHours());
  const mm = p2(date.getMinutes());
  const ss = p2(date.getSeconds());
  const formats = [
    `${y}/${m}/${day} ${hh}:${mm}:${ss}`,
    `${y}-${m}-${day} ${hh}:${mm}:${ss}`,
    `${day}/${m}/${y} ${hh}:${mm}:${ss}`,
    `${day}-${m}-${y} ${hh}:${mm}:${ss}`,
    `${daySingle}/${mSingle}/${y} ${hh}:${mm}:${ss}`,
    `${daySingle}-${mSingle}-${y} ${hh}:${mm}:${ss}`
  ];
  const clean = query.trim().toLowerCase();
  return formats.some(value =>
    value.toLowerCase().includes(clean) ||
    value.toLowerCase().includes(clean.replace(/-/g, '/')) ||
    value.toLowerCase().includes(clean.replace(/\//g, '-'))
  );
}

function renderHist() {
  if (!$('#hBody')) return;
  const timeQuery = ($('#hTime') || $('#hQ'))?.value.trim().toLowerCase() || '';
  const device = $('#hDev')?.value || '';
  const action = $('#hAct')?.value || '';
  const status = $('#hSt')?.value || '';

  let rows = actions.filter(row =>
    (!device || row.dev === device) &&
    (!action || row.act.startsWith(action)) &&
    (!status || row.st === status) &&
    (!timeQuery || matchHistTime(row.sent, timeQuery) || (row.resp && matchHistTime(row.resp, timeQuery)))
  );

  rows = [...rows].sort((a, b) => cmp(a.sent, b.sent, hAsc ? 1 : -1));
  $('#hCnt').textContent = rows.length;
  $('#hDir').textContent = hAsc ? '↑' : '↓';

  const per = Number($('#hPer')?.value || 10);
  const pages = Math.max(1, Math.ceil(rows.length / per));
  if (hPage > pages) hPage = pages;

  $('#hBody').innerHTML = rows.slice((hPage - 1) * per, hPage * per).map(row => `
    <tr>
      <td>${escapeHtml(row.dev)}</td>
      <td>${escapeHtml(row.act)}</td>
      <td><span class="tag ${row.st}">${ST[row.st] || 'Không xác định'}</span></td>
      <td>${renderTimeCell(row.sent)}</td>
      <td>${renderTimeCell(row.resp)}</td>
    </tr>
  `).join('') || `
    <tr><td colspan="5" style="text-align:center;color:var(--mut)">Không có lịch sử</td></tr>
  `;

  pager('#hPg', '#hInfo', hPage, rows.length, per, page => {
    hPage = page;
    renderHist();
  }, 'lịch sử');
}

['#hDev', '#hAct', '#hSt'].forEach(selector => {
  const element = $(selector);
  if (element) element.onchange = () => { hPage = 1; renderHist(); };
});

if ($('#hPer')) $('#hPer').onchange = () => { hPage = 1; renderHist(); };
['#hTime', '#hQ'].forEach(selector => {
  const element = $(selector);
  if (element) element.oninput = () => { hPage = 1; renderHist(); };
});
if ($('#hDir')) $('#hDir').onclick = () => { hAsc = !hAsc; renderHist(); };
if ($('#hReset')) {
  $('#hReset').onclick = () => {
    ['#hTime', '#hQ', '#hDev', '#hAct', '#hSt'].forEach(selector => {
      const element = $(selector);
      if (element) element.value = '';
    });
    hAsc = false;
    hPage = 1;
    if ($('#hPer')) $('#hPer').value = '10';
    renderHist();
  };
}

function renderAll() {
  renderSensors();
  renderHist();
  drawNums();
}
