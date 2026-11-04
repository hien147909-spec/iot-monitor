/* ---------- sensor data ---------- */

let sPage = 1;
let sAsc = false;

function matchSensorVal(value, input) {
  if (!input) return true;
  const query = input.trim().replace(',', '.');
  if (!query) return true;

  const rangeMatch = query.match(/^(-?\d+(?:\.\d+)?)\s*(?:-|–|\.\.)\s*(-?\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);
    return Number.isFinite(min) && Number.isFinite(max) && value >= min && value <= max;
  }

  const opMatch = query.match(/^([><]=?|==?)\s*(-?\d+(?:\.\d+)?)$/);
  if (opMatch) {
    const target = parseFloat(opMatch[2]);
    if (!Number.isFinite(target)) return false;
    if (opMatch[1] === '>') return value > target;
    if (opMatch[1] === '>=') return value >= target;
    if (opMatch[1] === '<') return value < target;
    if (opMatch[1] === '<=') return value <= target;
    return value === target;
  }

  return String(value).toLowerCase().includes(query.toLowerCase());
}

function renderSensors() {
  if (!$('#sBody')) return;
  const type = $('#sType')?.value || '';
  const valueQuery = $('#sVal')?.value.trim() || '';
  const timeQuery = $('#sTime')?.value.trim() || '';

  let rows = sensors.filter(row =>
    (!type || row.type === type) &&
    matchSensorVal(row.val, valueQuery) &&
    (!timeQuery || fmt(row.time).includes(timeQuery) || fmt(row.time).includes(timeQuery.replace(/-/g, '/')))
  );

  const sortKey = $('#sSort')?.value || 'time';
  const direction = sAsc ? 1 : -1;
  rows = [...rows].sort((a, b) => cmp(a[sortKey], b[sortKey], direction));

  $('#sCnt').textContent = rows.length;
  $('#sDir').textContent = sAsc ? '↑' : '↓';
  const per = Number($('#sPer')?.value || 10);
  const pages = Math.max(1, Math.ceil(rows.length / per));
  if (sPage > pages) sPage = pages;

  $('#sBody').innerHTML = rows.slice((sPage - 1) * per, sPage * per).map(row => `
    <tr>
      <td>${renderTimeCell(row.time)}</td>
      <td>${escapeHtml(row.dev)}</td>
      <td>${escapeHtml(row.type)}</td>
      <td>${row.val}</td>
      <td>${UNIT[row.type] || escapeHtml(row.unit || '')}</td>
    </tr>
  `).join('') || `
    <tr><td colspan="5" style="text-align:center;color:var(--mut)">Không có dữ liệu</td></tr>
  `;

  pager('#sPg', '#sInfo', sPage, rows.length, per, page => {
    sPage = page;
    renderSensors();
  }, 'bản ghi');
}

['#sType', '#sSort'].forEach(selector => {
  const element = $(selector);
  if (element) element.onchange = () => { sPage = 1; renderSensors(); };
});

if ($('#sPer')) $('#sPer').onchange = () => { sPage = 1; renderSensors(); };
['#sVal', '#sTime'].forEach(selector => {
  const element = $(selector);
  if (element) element.oninput = () => { sPage = 1; renderSensors(); };
});

if ($('#sDir')) $('#sDir').onclick = () => { sAsc = !sAsc; renderSensors(); };
if ($('#sReset')) {
  $('#sReset').onclick = () => {
    if ($('#sType')) $('#sType').value = '';
    if ($('#sVal')) $('#sVal').value = '';
    if ($('#sTime')) $('#sTime').value = '';
    if ($('#sSort')) $('#sSort').value = 'time';
    if ($('#sPer')) $('#sPer').value = '10';
    sAsc = false;
    sPage = 1;
    renderSensors();
  };
}
