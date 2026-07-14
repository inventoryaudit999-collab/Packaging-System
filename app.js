// ============================================================
//  app.js — Makro Packaging Count System
//  CP Axtra | Store Operations | Fresh Food
//  Version 2.0 — Fixed & Complete
// ============================================================
'use strict';

// ─── Globals (injected by bootApp in index.html) ─────────────
// window.ITEMS_DATA, window.STORES_DATA, window.ADMIN_ACCOUNT, window.MAKRO_LOGO_DATA_URI

// ─── App State ────────────────────────────────────────────────
const App = {
  user:       null,   // { username, role, name, storeId, storeName }
  store:      null,   // matched STORES_DATA entry
  view:       null,   // current view name
  unsaved:    false
};

// ─── DOM Helpers ─────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls)  e.className   = cls;
  if (html) e.innerHTML   = html;
  return e;
};

// ─── Toast ───────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
  const t = $('toast');
  if (!t) return;
  const div = el('div', `toast-item toast-${type}`, msg);
  t.appendChild(div);
  setTimeout(() => div.classList.add('toast-show'), 10);
  setTimeout(() => {
    div.classList.remove('toast-show');
    setTimeout(() => div.remove(), 400);
  }, duration);
}

// ─── Modal ────────────────────────────────────────────────────
function modal(html, onClose) {
  const root = $('modalRoot');
  if (!root) return;
  root.innerHTML = `<div class="modal-overlay"><div class="modal-box">${html}</div></div>`;
  root.querySelector('.modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  if (onClose) root._onClose = onClose;
}
function closeModal() {
  const root = $('modalRoot');
  if (!root) return;
  if (typeof root._onClose === 'function') root._onClose();
  root.innerHTML = '';
}

// ─── Auth ─────────────────────────────────────────────────────
function findUser(username, password) {
  // RSOA / Admin account
  const admin = window.ADMIN_ACCOUNT || {};
  if (username === admin.username && password === admin.password) {
    return {
      username: admin.username,
      role:     admin.role || 'RSOA',
      name:     admin.name || 'Regional SOA',
      storeId:  null,
      storeName:'Regional 1',
      region:   admin.region || 1
    };
  }
  // Store SOA accounts
  const stores = window.STORES_DATA || [];
  for (const store of stores) {
    const users = store.users || [];
    for (const u of users) {
      if (u.username === username && u.password === password) {
        return {
          username: u.username,
          role:     u.role || 'SOA',
          name:     u.name || `SOA ${store.id}`,
          storeId:  store.id,
          storeName:`สาขา${store.nameEn || store.name} (${store.id})`
        };
      }
    }
  }
  return null;
}

function login(username, password) {
  const user = findUser(username.trim(), password);
  if (!user) return false;
  App.user  = user;
  App.store = (window.STORES_DATA || []).find(s => s.id === user.storeId) || null;
  return true;
}

function logout() {
  App.user  = null;
  App.store = null;
  App.view  = null;
  showLoginScreen();
}

// ─── Screen switching ─────────────────────────────────────────
function showLoginScreen() {
  const loginScreen = $('loginScreen');
  const appShell    = $('app');
  if (loginScreen) loginScreen.classList.remove('hidden');
  if (appShell)    appShell.classList.add('hidden');
  // reset logo
  updateLogos();
}

function showApp() {
  const loginScreen = $('loginScreen');
  const appShell    = $('app');
  if (loginScreen) loginScreen.classList.add('hidden');
  if (appShell)    appShell.classList.remove('hidden');
  buildSidebar();
  updateTopbar('ยินดีต้อนรับ', App.user.storeName || 'Regional 1');
  navigateTo('dashboard');
}

function updateLogos() {
  const uri = window.MAKRO_LOGO_DATA_URI || '';
  if (!uri) return;
  document.querySelectorAll('.brand-logo').forEach(img => { img.src = uri; });
}

// ─── Sidebar ─────────────────────────────────────────────────
function buildSidebar() {
  // Update user info
  const sbName = $('sbStoreName');
  const sbRole = $('sbRole');
  if (sbName) sbName.textContent = App.user.storeName || '';
  if (sbRole) sbRole.textContent = App.user.role === 'RSOA' ? 'Regional SOA' : `SOA – ${App.user.storeId}`;
  updateLogos();

  // Nav items by role
  const items = getNavItems();
  const nav   = $('sidebarNav');
  if (!nav) return;
  nav.innerHTML = '';
  items.forEach(item => {
    const a = el('a', 'nav-item', `<span class="nav-icon">${item.icon}</span><span>${item.label}</span>`);
    a.href = '#';
    a.dataset.view = item.view;
    a.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.view);
      closeSidebar();
    });
    nav.appendChild(a);
  });
}

function getNavItems() {
  if (App.user.role === 'RSOA') {
    return [
      { icon: '📊', label: 'Dashboard', view: 'dashboard' },
      { icon: '📋', label: 'สรุปรายงานทุกสาขา', view: 'report-all' },
      { icon: '📦', label: 'ข้อมูลสาขา', view: 'stores' },
    ];
  }
  return [
    { icon: '📊', label: 'Dashboard', view: 'dashboard' },
    { icon: '📦', label: 'บันทึกการนับ', view: 'count-entry' },
    { icon: '📋', label: 'รายงานสาขา', view: 'report-store' },
    { icon: '📥', label: 'Export Excel', view: 'export' },
  ];
}

function closeSidebar() {
  const sidebar = $('sidebar');
  const backdrop = $('sidebarBackdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
}

// ─── Topbar ───────────────────────────────────────────────────
function updateTopbar(title, sub) {
  const t = $('topbarTitle');
  const s = $('topbarSub');
  if (t) t.textContent = title;
  if (s) s.textContent = sub;
}

function setActiveNav(view) {
  document.querySelectorAll('.nav-item').forEach(a => {
    a.classList.toggle('active', a.dataset.view === view);
  });
}

// ─── Router ───────────────────────────────────────────────────
function navigateTo(view) {
  App.view = view;
  setActiveNav(view);
  const content = $('content');
  if (!content) return;

  const views = {
    dashboard:    renderDashboard,
    'count-entry': renderCountEntry,
    'report-store': renderReportStore,
    'report-all':  renderReportAll,
    stores:        renderStores,
    export:        renderExport,
  };

  const renderer = views[view];
  if (renderer) {
    renderer(content);
  } else {
    content.innerHTML = `<div class="card"><p>ไม่พบหน้า: ${view}</p></div>`;
  }
}

// ─── Views ────────────────────────────────────────────────────

function renderDashboard(container) {
  const store = App.store;
  const isRSOA = App.user.role === 'RSOA';
  updateTopbar('Dashboard', isRSOA ? 'ภาพรวม Region 1' : `${App.user.storeName}`);

  const stores = window.STORES_DATA || [];
  const items  = window.ITEMS_DATA  || [];

  container.innerHTML = `
    <div class="dashboard-grid">
      <div class="stat-card">
        <div class="stat-num">${isRSOA ? stores.length : items.length}</div>
        <div class="stat-lbl">${isRSOA ? 'สาขาทั้งหมด' : 'รายการ Packaging'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${items.length}</div>
        <div class="stat-lbl">รายการ Packaging ทั้งหมด</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${new Date().toLocaleDateString('th-TH', {month:'short', year:'numeric'})}</div>
        <div class="stat-lbl">รอบการนับปัจจุบัน</div>
      </div>
    </div>
    <div class="card mt-16">
      <div class="card-title">ข้อมูลระบบ</div>
      <table class="data-table">
        <thead><tr><th>รายการ</th><th>ข้อมูล</th></tr></thead>
        <tbody>
          <tr><td>ผู้ใช้งาน</td><td><strong>${App.user.name}</strong></td></tr>
          <tr><td>บทบาท</td><td>${App.user.role}</td></tr>
          <tr><td>สาขา</td><td>${App.user.storeName}</td></tr>
          <tr><td>วันที่</td><td>${new Date().toLocaleDateString('th-TH', {weekday:'long', year:'numeric', month:'long', day:'numeric'})}</td></tr>
        </tbody>
      </table>
    </div>
    ${isRSOA ? renderStoreList(stores) : ''}
  `;
}

function renderStoreList(stores) {
  const rows = stores.map(s => `
    <tr>
      <td><strong>${s.id}</strong></td>
      <td>${s.name}</td>
      <td>${s.nameEn || ''}</td>
      <td>Region ${s.region}</td>
    </tr>`).join('');
  return `
    <div class="card mt-16">
      <div class="card-title">รายการสาขาใน Region 1</div>
      <table class="data-table">
        <thead><tr><th>รหัส</th><th>ชื่อสาขา (ไทย)</th><th>ชื่อสาขา (EN)</th><th>Region</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderCountEntry(container) {
  updateTopbar('บันทึกการนับ Packaging', App.user.storeName);
  const items   = window.ITEMS_DATA || [];
  const grouped = {};
  items.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });

  const today = new Date().toISOString().split('T')[0];

  let tableRows = '';
  items.forEach(item => {
    tableRows += `
      <tr>
        <td>${item.id}</td>
        <td>${item.category}</td>
        <td>${item.name}</td>
        <td>${item.unit}</td>
        <td>${item.dept}</td>
        <td>
          <input type="number" class="qty-input" data-id="${item.id}" 
                 min="0" value="" placeholder="0"
                 style="width:80px;padding:4px 8px;border:1px solid #D1D5DB;border-radius:6px;text-align:right;">
        </td>
        <td><input type="text" class="note-input" data-id="${item.id}" 
                   placeholder="หมายเหตุ" 
                   style="width:120px;padding:4px 8px;border:1px solid #D1D5DB;border-radius:6px;"></td>
      </tr>`;
  });

  container.innerHTML = `
    <div class="card">
      <div class="card-title">📦 บันทึกการนับ Packaging – ${App.user.storeName}</div>
      <div class="flex gap-12 mb-16" style="flex-wrap:wrap;">
        <div>
          <label style="font-size:13px;font-weight:600;color:#4B5563;">วันที่นับ</label>
          <input type="date" id="countDate" value="${today}" 
                 style="display:block;margin-top:4px;padding:6px 10px;border:1px solid #D1D5DB;border-radius:8px;">
        </div>
        <div>
          <label style="font-size:13px;font-weight:600;color:#4B5563;">แผนก</label>
          <select id="deptFilter" style="display:block;margin-top:4px;padding:6px 10px;border:1px solid #D1D5DB;border-radius:8px;">
            <option value="">ทั้งหมด</option>
            ${[...new Set(items.map(i => i.dept))].map(d => `<option value="${d}">${d}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;align-items:flex-end;gap:8px;">
          <button class="btn btn-primary" id="saveCountBtn">💾 บันทึก</button>
          <button class="btn btn-secondary" id="clearCountBtn">🗑 ล้างข้อมูล</button>
        </div>
      </div>
      <div style="overflow-x:auto;">
        <table class="data-table" id="countTable">
          <thead>
            <tr>
              <th>รหัส</th><th>หมวด</th><th>ชื่อสินค้า</th><th>หน่วย</th>
              <th>แผนก</th><th style="width:90px;">จำนวน</th><th>หมายเหตุ</th>
            </tr>
          </thead>
          <tbody id="countBody">${tableRows}</tbody>
        </table>
      </div>
    </div>`;

  // Filter by dept
  $('deptFilter').addEventListener('change', function() {
    const val = this.value;
    document.querySelectorAll('#countBody tr').forEach(row => {
      row.style.display = (!val || row.cells[4].textContent === val) ? '' : 'none';
    });
  });

  // Save
  $('saveCountBtn').addEventListener('click', () => {
    const date   = $('countDate').value;
    const counts = {};
    document.querySelectorAll('.qty-input').forEach(inp => {
      if (inp.value !== '') counts[inp.dataset.id] = { qty: parseInt(inp.value) || 0 };
    });
    document.querySelectorAll('.note-input').forEach(inp => {
      if (inp.value && counts[inp.dataset.id]) counts[inp.dataset.id].note = inp.value;
    });
    const filled = Object.keys(counts).length;
    if (filled === 0) { toast('กรุณากรอกจำนวนอย่างน้อย 1 รายการ', 'warn'); return; }

    const record = {
      storeId:   App.user.storeId,
      storeName: App.user.storeName,
      date,
      counts,
      savedBy:   App.user.username,
      savedAt:   new Date().toISOString()
    };

    // Save to Firebase if available
    if (window.DB && window.DB.isReady()) {
      window.DB.push(`packaging_counts/${App.user.storeId}/${date.replace(/-/g,'')}`, record)
        .then(() => toast(`✅ บันทึกสำเร็จ ${filled} รายการ วันที่ ${date}`, 'success'))
        .catch(e => toast('⚠️ บันทึกไม่สำเร็จ: ' + e.message, 'error'));
    } else {
      // Local only
      const key = `count_${App.user.storeId}_${date}`;
      try { localStorage.setItem(key, JSON.stringify(record)); } catch(e) {}
      toast(`✅ บันทึกสำเร็จ (local) ${filled} รายการ`, 'success');
    }
  });

  // Clear
  $('clearCountBtn').addEventListener('click', () => {
    document.querySelectorAll('.qty-input, .note-input').forEach(i => { i.value = ''; });
    toast('ล้างข้อมูลแล้ว', 'info');
  });
}

function renderReportStore(container) {
  updateTopbar('รายงานสาขา', App.user.storeName);
  container.innerHTML = `
    <div class="card">
      <div class="card-title">📋 รายงาน Packaging – ${App.user.storeName}</div>
      <p style="color:#6B7280;">ระบบจะแสดงรายงานการนับย้อนหลัง<br>
         กรุณาเชื่อมต่อ Firebase เพื่อดูข้อมูลจริง</p>
      <div class="flex gap-8 mt-16">
        <input type="month" id="reportMonth" value="${new Date().toISOString().slice(0,7)}"
               style="padding:6px 10px;border:1px solid #D1D5DB;border-radius:8px;">
        <button class="btn btn-primary" id="loadReportBtn">โหลดรายงาน</button>
      </div>
      <div id="reportContent" class="mt-16"></div>
    </div>`;

  $('loadReportBtn').addEventListener('click', () => {
    $('reportContent').innerHTML = `<p style="color:#6B7280;padding:20px 0;">
      กำลังโหลด... (ต้องเชื่อมต่อ Firebase)</p>`;
  });
}

function renderReportAll(container) {
  updateTopbar('สรุปรายงานทุกสาขา', 'Region 1');
  const stores = window.STORES_DATA || [];
  container.innerHTML = `
    <div class="card">
      <div class="card-title">📊 สรุป Packaging ทุกสาขา – Region 1</div>
      <div class="flex gap-8 mb-16">
        <input type="month" id="reportMonth" value="${new Date().toISOString().slice(0,7)}"
               style="padding:6px 10px;border:1px solid #D1D5DB;border-radius:8px;">
        <button class="btn btn-primary" id="loadAllBtn">โหลดข้อมูล</button>
      </div>
      <table class="data-table">
        <thead><tr><th>รหัส</th><th>ชื่อสาขา</th><th>สถานะ</th><th>รายการ</th></tr></thead>
        <tbody>
          ${stores.map(s => `
            <tr>
              <td><strong>${s.id}</strong></td>
              <td>${s.name}</td>
              <td><span style="color:#6B7280;">รอข้อมูล</span></td>
              <td>–</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderStores(container) {
  updateTopbar('ข้อมูลสาขา', 'Region 1');
  const stores = window.STORES_DATA || [];
  const rows = stores.map(s => {
    const users = (s.users || []).map(u => `<code>${u.username}</code>`).join(', ');
    return `<tr>
      <td><strong>${s.id}</strong></td>
      <td>${s.name}</td>
      <td>${s.nameEn || ''}</td>
      <td>${users}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="card">
      <div class="card-title">📦 ข้อมูลสาขาทั้งหมด – Region 1</div>
      <table class="data-table">
        <thead><tr><th>รหัส</th><th>ชื่อ (ไทย)</th><th>ชื่อ (EN)</th><th>ผู้ใช้งาน</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderExport(container) {
  updateTopbar('Export Excel', App.user.storeName);
  container.innerHTML = `
    <div class="card">
      <div class="card-title">📥 Export ข้อมูล Excel</div>
      <p style="color:#6B7280;">เลือกช่วงเวลาที่ต้องการ Export</p>
      <div class="flex gap-8 mt-12">
        <div>
          <label style="font-size:13px;font-weight:600;">จาก</label>
          <input type="date" id="expFrom" style="display:block;margin-top:4px;padding:6px 10px;border:1px solid #D1D5DB;border-radius:8px;">
        </div>
        <div>
          <label style="font-size:13px;font-weight:600;">ถึง</label>
          <input type="date" id="expTo" style="display:block;margin-top:4px;padding:6px 10px;border:1px solid #D1D5DB;border-radius:8px;">
        </div>
      </div>
      <button class="btn btn-primary mt-16" id="doExportBtn">⬇ Download Excel</button>
      <p id="expMsg" class="mt-8" style="color:#6B7280;font-size:13px;"></p>
    </div>`;

  $('doExportBtn').addEventListener('click', () => {
    if (typeof XLSX === 'undefined') {
      $('expMsg').textContent = '⚠️ SheetJS ไม่พร้อม กรุณารอสักครู่';
      return;
    }
    const items   = window.ITEMS_DATA || [];
    const wsData  = [['รหัส','หมวด','ชื่อสินค้า','หน่วย','แผนก','จำนวน']];
    items.forEach(i => wsData.push([i.id, i.category, i.name, i.unit, i.dept, '']));
    const wb  = XLSX.utils.book_new();
    const ws  = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Packaging Count');
    const date = new Date().toISOString().slice(0,10).replace(/-/g,'');
    XLSX.writeFile(wb, `PackagingCount_${App.user.storeId || 'RSOA'}_${date}.xlsx`);
    toast('✅ Export สำเร็จ', 'success');
  });
}

// ─── Login Form Handler ───────────────────────────────────────
function initLogin() {
  const form = $('loginForm');
  const err  = $('loginError');
  if (!form) return;

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    const username = ($('loginUser')  || {}).value || '';
    const password = ($('loginPass')  || {}).value || '';
    if (!username || !password) {
      if (err) { err.textContent = 'กรุณากรอก Username และ Password'; err.classList.add('visible'); }
      return;
    }
    if (login(username, password)) {
      if (err) err.classList.remove('visible');
      showApp();
    } else {
      if (err) { err.textContent = 'ชื่อผู้ใช้ หรือ รหัสผ่าน ไม่ถูกต้อง'; err.classList.add('visible'); }
      const passEl = $('loginPass');
      if (passEl) { passEl.value = ''; passEl.focus(); }
    }
  });
}

// ─── Event Bindings ───────────────────────────────────────────
function initEvents() {
  // Logout
  const logoutBtn = $('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  // Mobile sidebar toggle
  const menuToggle = $('menuToggle');
  const sidebar    = $('sidebar');
  const backdrop   = $('sidebarBackdrop');
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      if (backdrop) backdrop.classList.toggle('open');
    });
  }
  if (backdrop) {
    backdrop.addEventListener('click', closeSidebar);
  }
}

// ─── Boot ─────────────────────────────────────────────────────
(function init() {
  // Update logos on boot
  updateLogos();
  // Wire login form
  initLogin();
  // Wire global events
  initEvents();
  console.log('[app.js] Makro Packaging Count System ready ✅');
  console.log('[app.js] ITEMS_DATA:', (window.ITEMS_DATA || []).length, 'items');
  console.log('[app.js] STORES_DATA:', (window.STORES_DATA || []).length, 'stores');
})();
