/* ============================================================
   app.js — Application Logic
   Makro Packaging Count System
   
   Depends on: data.json (loaded as APP_DATA), firebase.js, style.css
============================================================ */

/* ===== UTILS ===== */
// ============================================================
// utils.js — ฟังก์ชันช่วยทั่วไป: Toast, Modal, วันที่, Firebase, Excel
// ============================================================

/* ---------- Date helpers ---------- */
function pad2(n){ return String(n).padStart(2,'0'); }

function todayStr(){
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function thaiDate(dateStr){
  // 'YYYY-MM-DD' -> 'DD/MM/YYYY'
  if(!dateStr) return '-';
  const [y,m,d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function daysInMonth(yyyyMm){
  // 'YYYY-MM' -> number of days
  const [y,m] = yyyyMm.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function dateRange(from, to){
  const out = [];
  let cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  if(isNaN(cur) || isNaN(end) || cur > end) return out;
  while(cur <= end){
    out.push(`${cur.getFullYear()}-${pad2(cur.getMonth()+1)}-${pad2(cur.getDate())}`);
    cur.setDate(cur.getDate()+1);
  }
  return out;
}

function fmtDateTime(ts){
  if(!ts) return '-';
  const d = new Date(ts);
  return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/* ---------- Number / formatting helpers ---------- */
function fmtNum(n, digits=0){
  n = Number(n)||0;
  return n.toLocaleString('th-TH', {minimumFractionDigits:digits, maximumFractionDigits:digits});
}
function fmtMoney(n){ return fmtNum(n, 2); }

function escapeHtml(str){
  if(str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg, type='default'){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (type!=='default' ? ' '+type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ t.className = ''; }, 3200);
}

/* ---------- Modal ---------- */
function showModal(innerHtml, onMount){
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal">${innerHtml}</div></div>`;
  document.getElementById('modalBackdrop').addEventListener('click', (e)=>{
    if(e.target.id === 'modalBackdrop') closeModal();
  });
  if(onMount) onMount(root);
}
function closeModal(){
  document.getElementById('modalRoot').innerHTML = '';
}

/* ---------- Loading state on buttons ---------- */
function setLoading(btn, loading, loadingText='กำลังโหลด...'){
  if(!btn) return;
  if(loading){
    btn.dataset.origText = btn.innerHTML;
    btn.innerHTML = loadingText;
    btn.disabled = true;
  } else {
    if(btn.dataset.origText) btn.innerHTML = btn.dataset.origText;
    btn.disabled = false;
  }
}

/* ---------- Firebase helpers ---------- */

// LocalStorage fallback สำหรับ path ที่อาจ PERMISSION_DENIED
// ใช้สำหรับ settings/ และ counts/ เพื่อให้ทำงานได้แม้ Rules ยังไม่ถูกต้อง
const LS_PREFIX = 'packing_fb_';

function lsKey(path){ return LS_PREFIX + path.replace(/[^a-zA-Z0-9_]/g,'_'); }
function lsGet(path){ try{ const v=localStorage.getItem(lsKey(path)); return v?JSON.parse(v):null; }catch(e){return null;} }
function lsSet(path, val){ try{ localStorage.setItem(lsKey(path), JSON.stringify(val)); }catch(e){} }
function lsDel(path){ try{ localStorage.removeItem(lsKey(path)); }catch(e){} }

async function dbGetOnce(path){
  try{
    const snap = await db.ref(path).once('value');
    const val = snap.val();
    if(val !== null) lsSet(path, val); // cache ใน LS
    return val;
  }catch(e){
    if(e.code === 'PERMISSION_DENIED' || String(e.message).includes('Permission denied')){
      console.warn('[dbGetOnce] PERMISSION_DENIED for:', path, '— using localStorage fallback');
      return lsGet(path);
    }
    throw e;
  }
}

async function dbUpdate(updates, retries=3){
  let lastErr;
  for(let attempt = 0; attempt <= retries; attempt++){
    try{
      await db.ref().update(updates);
      // cache ใน LS ด้วย
      Object.entries(updates).forEach(([path, val])=>{
        if(val === null) lsDel(path); else lsSet(path, val);
      });
      return; // สำเร็จ
    }catch(e){
      lastErr = e;
      if(e.code === 'PERMISSION_DENIED' || String(e.message).includes('Permission denied')){
        console.warn('[dbUpdate] PERMISSION_DENIED — saving to localStorage fallback');
        Object.entries(updates).forEach(([path, val])=>{
          if(val === null) lsDel(path); else lsSet(path, val);
        });
        return; // ไม่ throw — ให้ทำงานต่อได้
      }
      // Network error / timeout — retry ด้วย exponential backoff
      if(attempt < retries){
        const delay = 300 * Math.pow(2, attempt); // 300ms, 600ms, 1200ms
        console.warn(`[dbUpdate] attempt ${attempt+1} failed (${e.message}) — retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

async function dbSet(path, val){
  try{
    await db.ref(path).set(val);
    if(val === null) lsDel(path); else lsSet(path, val);
  }catch(e){
    if(e.code === 'PERMISSION_DENIED' || String(e.message).includes('Permission denied')){
      console.warn('[dbSet] PERMISSION_DENIED for:', path, '— saving to localStorage fallback');
      if(val === null) lsDel(path); else lsSet(path, val);
      return; // ไม่ throw
    }
    throw e;
  }
}

async function dbPush(path, val){
  try{
    return db.ref(path).push(val);
  }catch(e){
    if(e.code === 'PERMISSION_DENIED' || String(e.message).includes('Permission denied')){
      console.warn('[dbPush] PERMISSION_DENIED for:', path, '— skipping log (non-fatal)');
      return; // log ไม่ได้ก็ไม่เป็นไร
    }
    throw e;
  }
}

async function dbRemove(path){
  try{
    await db.ref(path).remove();
    lsDel(path);
  }catch(e){
    if(e.code === 'PERMISSION_DENIED' || String(e.message).includes('Permission denied')){
      console.warn('[dbRemove] PERMISSION_DENIED for:', path, '— removing from localStorage');
      lsDel(path);
      return;
    }
    throw e;
  }
}

/* ============================================================
   PRESENCE SYSTEM — ติดตามว่าผู้ใช้ใด online อยู่ตอนนี้
   ใช้ Firebase '.info/connected' + onDisconnect() เพื่อความแม่นยำแบบ real-time
   (ถ้าปิดเบราว์เซอร์/เน็ตหลุด Firebase จะลบสถานะ online ให้อัตโนมัติ)
============================================================ */
const HEARTBEAT_INTERVAL_MS = 30000; // อัปเดต lastSeen ทุก 30 วิ (เผื่อ onDisconnect ไม่ทำงานในบางกรณี เช่น browser crash)
let HEARTBEAT_TIMER = null;

function startPresenceTracking(){
  if(!SESSION) return;
  const userKey = SESSION.role === 'admin' ? `admin_${SESSION.username}` : SESSION.storeCode;
  const path = `presence/${userKey}`;
  PRESENCE_REF = db.ref(path);

  const presenceInfo = {
    online: true,
    role: SESSION.role,
    storeCode: SESSION.role === 'store' ? SESSION.storeCode : null,
    storeName: SESSION.role === 'store' ? SESSION.storeName : ADMIN_ACCOUNT.name,
    locNo: SESSION.role === 'store' ? SESSION.locNo : null,
    username: SESSION.username,
    sessionId: SESSION_ID,
    loginAt: Date.now(),
    lastSeen: Date.now(),
    userAgent: (navigator.userAgent||'').slice(0,120)
  };

  // ฟัง '.info/connected' — ทุกครั้งที่ reconnect (เน็ตหลุดแล้วกลับมา) ต้อง set ใหม่ + ตั้ง onDisconnect ใหม่
  db.ref('.info/connected').on('value', (snap)=>{
    if(snap.val() === true){
      // ตั้งคำสั่งล่วงหน้า: ถ้า client หลุดการเชื่อมต่อ (ปิดเบราว์เซอร์/เน็ตหลุด) ให้ Firebase ลบ presence ให้อัตโนมัติ
      PRESENCE_REF.onDisconnect().remove().then(()=>{
        PRESENCE_REF.set(presenceInfo).catch(e=> console.warn('[presence] set error:', e.message));
      }).catch(e=> console.warn('[presence] onDisconnect setup error:', e.message));
    }
  });

  // Heartbeat: อัปเดต lastSeen เป็นระยะ เผื่อกรณี onDisconnect ไม่ทำงาน (เช่น browser ค้าง/บังคับปิด)
  clearInterval(HEARTBEAT_TIMER);
  HEARTBEAT_TIMER = setInterval(()=>{
    PRESENCE_REF && PRESENCE_REF.update({ lastSeen: Date.now() }).catch(()=>{});
  }, HEARTBEAT_INTERVAL_MS);

  // ── ฟังคำสั่ง force-logout จาก admin ──
  FORCE_LOGOUT_REF = db.ref(`forceLogout/${userKey}`);
  FORCE_LOGOUT_REF.on('value', (snap)=>{
    const val = snap.val();
    if(val && val.sessionId === SESSION_ID){
      // admin สั่งให้ session นี้ออกจากระบบ
      toast('คุณถูกบังคับออกจากระบบโดยผู้ดูแลระบบ', 'error');
      setTimeout(()=>{
        stopPresenceTracking();
        FORCE_LOGOUT_REF.remove().catch(()=>{});
        clearSession();
        SESSION = null;
        location.reload();
      }, 1200);
    }
  });
}

function stopPresenceTracking(){
  clearInterval(HEARTBEAT_TIMER);
  HEARTBEAT_TIMER = null;
  try{ db.ref('.info/connected').off(); }catch(e){}
  if(PRESENCE_REF){
    PRESENCE_REF.onDisconnect().cancel().catch(()=>{});
    PRESENCE_REF.remove().catch(()=>{});
    PRESENCE_REF = null;
  }
  if(FORCE_LOGOUT_REF){
    FORCE_LOGOUT_REF.off();
    FORCE_LOGOUT_REF = null;
  }
}


/* ---------- Item helpers ---------- */
const CAT_LABELS = { FRESH: 'FRESH FOOD', TRANSFER: 'TRANSFER', NONFRESH: 'NON FRESH' };
const CAT_FIELD_LABELS = { FV: 'F&V', BUT: 'BUT', FISH: 'FISH', QTY: 'จำนวน' };

function itemUnitCost(item){
  const pack = Number(item.packCount) || 1;
  const price = Number(item.price) || 0;
  return price / pack;
}
function recordTotal(item, rec){
  if(!rec) return 0;
  return (item.subFields||[]).reduce((s,f)=> s + (Number(rec[f])||0), 0);
}
function recordAmount(item, rec){
  return recordTotal(item, rec) * itemUnitCost(item);
}

/* ---------- Excel export ---------- */
function exportRowsToExcel(sheets, filename){
  // sheets: { 'ชื่อชีท': [ {col:val,...}, ... ] }
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, rows])=>{
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'ไม่มีข้อมูล': '' }]);
    XLSX.utils.book_append_sheet(wb, ws, name.substring(0,31));
  });
  XLSX.writeFile(wb, filename);
}

/* ---------- Store helpers ---------- */
function getStoreByCode(code){
  return STORES_DATA.find(s=>s.username === code);
}
function storeLabel(code){
  const s = getStoreByCode(code);
  return s ? `${s.locNo} - ${s.name}` : code;
}

/* ---------- Export row builder (shared by store + admin export) ---------- */
function buildExportRow(dateOrMonth, storeCode, cat, item, rec){
  const s = getStoreByCode(storeCode);
  const total = recordTotal(item, rec);
  const amount = recordAmount(item, rec);
  // Handle both 'YYYY-MM-DD' and 'YYYY-MM' formats
  const label = dateOrMonth.length === 7 ? thaiMonthLabel(dateOrMonth) : thaiDate(dateOrMonth);
  return {
    'เดือน/วันที่': label,
    'รหัสผู้ใช้สาขา': storeCode,
    'เลขที่สาขา (Loc)': s ? s.locNo : '',
    'ชื่อสาขา': s ? s.name : '',
    'หมวดหมู่': CAT_LABELS[cat] || cat,
    'รหัสสินค้า': item.code,
    'รายการสินค้า': item.desc,
    'ผู้ขาย/Supplier': item.supplier,
    'หน่วยนับ': item.uomCount,
    'F&V': cat === 'NONFRESH' ? '' : (Number(rec.FV)||0),
    'BUT': cat === 'NONFRESH' ? '' : (Number(rec.BUT)||0),
    'FISH': cat === 'NONFRESH' ? '' : (Number(rec.FISH)||0),
    'จำนวน (Non Fresh)': cat === 'NONFRESH' ? (Number(rec.QTY)||0) : '',
    'รวมจำนวนตรวจนับ': total,
    'ราคาต่อหน่วยนับ (บาท)': Math.round(itemUnitCost(item)*100)/100,
    'มูลค่ารวม (บาท)': Math.round(amount*100)/100
  };
}

/* ---------- Dashboard helpers: colors + donut chart ---------- */
const CAT_COLORS = {
  FRESH: '#1FA97C',     // เขียว
  TRANSFER: '#0B5FB4',  // น้ำเงิน (Makro)
  NONFRESH: '#F5A623'   // ส้ม (Makro)
};

/**
 * สร้าง SVG Donut Chart
 * segments: [{ label, value, color }]
 * คืนค่า HTML string ของ <svg>
 */
function buildDonutChart(segments, opts={}){
  const size = opts.size || 200;
  const stroke = opts.stroke || 28;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((s,x)=> s + (Number(x.value)||0), 0);

  let offset = 0;
  const arcs = segments.map(seg=>{
    const value = Number(seg.value) || 0;
    const frac = total > 0 ? value / total : 0;
    const dash = frac * circumference;
    const gap = circumference - dash;
    const arc = `<circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none"
        stroke="${seg.color}" stroke-width="${stroke}"
        stroke-dasharray="${dash.toFixed(3)} ${gap.toFixed(3)}"
        stroke-dashoffset="${(-offset).toFixed(3)}"
        transform="rotate(-90 ${size/2} ${size/2})"
        stroke-linecap="${segments.length>1?'butt':'round'}"></circle>`;
    offset += dash;
    return arc;
  }).join('');

  const centerLabel = opts.centerLabel || 'มูลค่ารวม';
  const centerValue = opts.centerValue !== undefined ? opts.centerValue : fmtMoney(total);

  return `
  <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="display:block;">
    <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="var(--border-soft)" stroke-width="${stroke}"></circle>
    ${total > 0 ? arcs : ''}
    <text x="50%" y="46%" text-anchor="middle" dominant-baseline="middle"
      font-family="Inter,'Noto Sans Thai',sans-serif" font-size="12" fill="var(--text-soft)" font-weight="600">${escapeHtml(centerLabel)}</text>
    <text x="50%" y="60%" text-anchor="middle" dominant-baseline="middle"
      font-family="'Roboto Mono',monospace" font-size="17" fill="var(--text)" font-weight="800">${escapeHtml(String(centerValue))}</text>
  </svg>`;
}


/* ---------- Month helpers (Monthly system) ---------- */
function generateMonthRange(from, to){
  // from/to: 'YYYY-MM'
  const out = [];
  let [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while(fy < ty || (fy === ty && fm <= tm)){
    out.push(`${fy}-${pad2(fm)}`);
    fm++;
    if(fm > 12){ fm = 1; fy++; }
  }
  return out;
}

const THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function thaiMonthLabel(yyyyMm){
  if(!yyyyMm) return '-';
  const [y, m] = yyyyMm.split('-').map(Number);
  return `${THAI_MONTHS[m-1]} ${y}`;
}


// ============================================================
// auth.js — เข้าสู่ระบบ / จัดการ Session
// ============================================================

const SESSION_KEY = 'pc_session_v1';

let SESSION = null; // { role:'store'|'admin', username, storeCode, storeName, locNo }

// ── PRESENCE SYSTEM: ใช้ติดตามว่า user ใด online อยู่ตอนนี้ + รองรับ force-logout จาก admin ──
let PRESENCE_REF = null;        // ref ของ presence node ของ session นี้ (สำหรับ onDisconnect)
let FORCE_LOGOUT_REF = null;    // ref ที่ฟังคำสั่ง force-logout จาก admin
const SESSION_ID = Math.random().toString(36).slice(2) + Date.now().toString(36); // ID เฉพาะของ session นี้ (กันชนกันถ้า login หลาย tab/อุปกรณ์)

function findAccount(username, password){
  username = (username||'').trim();
  password = (password||'').trim();
  if(!username || !password) return null;

  if(username === ADMIN_ACCOUNT.username && password === ADMIN_ACCOUNT.password){
    return { role:'admin', username, name: ADMIN_ACCOUNT.name };
  }
  const s = STORES_DATA.find(s=> s.username === username && s.password === password);
  if(s){
    return { role:'store', username: s.username, storeCode: s.username, storeName: s.name, locNo: s.locNo };
  }
  return null;
}

function restoreSession(){
  try{
    const raw = localStorage.getItem(SESSION_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){ return null; }
}

function saveSession(session){
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession(){
  localStorage.removeItem(SESSION_KEY);
}

function initLoginForm(){
  const form = document.getElementById('loginForm');
  const errBox = document.getElementById('loginError');
  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const u = document.getElementById('loginUser').value;
    const p = document.getElementById('loginPass').value;
    const account = findAccount(u, p);
    if(!account){
      errBox.style.display = 'block';
      return;
    }
    errBox.style.display = 'none';
    SESSION = account;
    saveSession(account);
    startApp();
  });

  document.getElementById('logoutBtn').addEventListener('click', ()=>{
    stopPresenceTracking();
    clearSession();
    SESSION = null;
    location.reload();
  });
}

/* ===== STORE VIEW ===== */
// ============================================================
// store-view.js — หน้าจอสาขา: บันทึกตรวจนับรายเดือน + ประวัติ/Export
// ============================================================

let CURRENT_MONTH = todayStr().slice(0,7);  // 'YYYY-MM'
let CURRENT_CAT   = 'FRESH';
let CURRENT_DATA  = { FRESH:{}, TRANSFER:{}, NONFRESH:{} };
// snapshot ของข้อมูลที่บันทึกไว้แล้วจริง (จาก Firebase) ใช้เทียบว่าค่าที่กรอกเปลี่ยนไปจากเดิมหรือไม่
let ENTRY_SAVED_BASELINE = { FRESH:{}, TRANSFER:{}, NONFRESH:{} };
let CURRENT_META  = null;
let DIRTY = { FRESH:false, TRANSFER:false, NONFRESH:false };
let CURRENT_ACTIVE = true; // default: true เพื่อให้บันทึกได้ทันที (admin ต้องกด Inactive ถึงจะล็อก)

// ── ค้นหา/กรองรายการในหน้าบันทึก ──
let ENTRY_SEARCH_TEXT = '';      // คำค้นหาจากชื่อสินค้า/รหัสสินค้า
let ENTRY_SUPPLIER_FILTER = '';  // กรองเฉพาะ Supplier ที่เลือก ('' = ทั้งหมด)

// ============================================================
// CONCURRENCY GUARD — ป้องกันการบันทึกซ้ำซ้อนพร้อมกัน
// ============================================================
let SAVE_IN_PROGRESS = false;  // lock: กันกด Save ซ้ำหรือกดพร้อมกันในหน้าเดียวกัน

/* ---------- Month Active helpers ---------- */
async function getActiveMonths(){
  const data = await dbGetOnce('settings/months') || {};
  return data; // { 'YYYY-MM': true/false, ... }
}

// Cache สถานะ active ของเดือนทั้งหมด โหลดครั้งเดียว
let MONTHS_ACTIVE_CACHE = null;

async function loadMonthsCache(){
  try{
    const raw = await dbGetOnce('settings/months') || {};
    MONTHS_ACTIVE_CACHE = raw;
    // sync ลง LS ด้วย
    lsSet('settings/months', raw);
  }catch(e){
    console.warn('[loadMonthsCache] Firebase error — using localStorage');
    MONTHS_ACTIVE_CACHE = lsGet('settings/months') || {};
  }
}

function isMonthActiveSync(yyyyMm){
  // ตรวจจาก cache (ไม่รอ Firebase)
  if(!MONTHS_ACTIVE_CACHE) return false;
  const k = yyyyMm.replace('-','_');
  return MONTHS_ACTIVE_CACHE[k] === true;
}

async function isMonthActive(yyyyMm){
  // โหลด cache ถ้ายังไม่มี แล้วใช้ sync check
  if(!MONTHS_ACTIVE_CACHE) await loadMonthsCache();
  return isMonthActiveSync(yyyyMm);
}

/* ============================================================
   ENTRY VIEW (Monthly)
============================================================ */
async function renderEntryView(){
  setTopbar('บันทึกการตรวจนับ Packing', `${SESSION.locNo} - ${SESSION.storeName}`);
  const content = document.getElementById('content');

  // Generate month options: Jun 2026 - Dec 2030
  const months = generateMonthRange('2026-06','2030-12');
  const monthOptions = months.map(m=>`<option value="${m}" ${m===CURRENT_MONTH?'selected':''}>${thaiMonthLabel(m)}</option>`).join('');

  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">บันทึกการตรวจนับ Packing รายเดือน</div>
          <div class="muted">เลือกเดือนที่ต้องการบันทึก หรือแก้ไขข้อมูล</div>
        </div>
        <div class="form-row" style="align-items:flex-end;">
          <div class="form-group">
            <label>เดือนที่ตรวจนับ</label>
            <select id="entryMonth">${monthOptions}</select>
          </div>
          <button class="btn btn-secondary" id="loadMonthBtn">โหลดข้อมูล</button>
          <button class="btn btn-accent" id="exportTemplateBtn">📥 Export Excel</button>
        </div>
      </div>

      <div id="entryStatusBanner" class="mt-8"></div>

      <div class="tabs mt-8" id="catTabs">
        ${['FRESH'].map(c=>`
          <div class="tab ${c===CURRENT_CAT?'active':''} ${DIRTY[c]?'dirty':''}" data-cat="${c}">
            ${CAT_LABELS[c]} <span class="dot"></span>
          </div>`).join('')}
      </div>

      <div class="mt-12" id="entryMeta"></div>

      <!-- ── แถบค้นหา / กรอง Supplier เพื่อลดรายการก่อนบันทึก ── -->
      <div class="form-row mt-12" style="align-items:flex-end;">
        <div class="form-group flex-1" style="min-width:220px;">
          <label>🔍 ค้นหารายการสินค้า (ชื่อ / รหัสสินค้า)</label>
          <input type="text" id="entrySearchInput" placeholder="พิมพ์ชื่อสินค้าหรือรหัสสินค้า..." value="${escapeHtml(ENTRY_SEARCH_TEXT)}">
        </div>
        <div class="form-group" style="min-width:220px;">
          <label>กรองตาม Supplier</label>
          <select id="entrySupplierFilter">
            <option value="">-- ทุก Supplier --</option>
          </select>
        </div>
        <button class="btn btn-secondary" id="entryClearFilterBtn">ล้างการค้นหา</button>
      </div>
      <div class="text-faint mt-8" id="entryFilterInfo" style="font-size:12px;"></div>

      <div class="table-wrap mt-12" id="entryTableWrap"></div>

      <div class="flex justify-between items-center mt-16" style="flex-wrap:wrap;gap:12px;">
        <div class="text-soft" id="entryTotals"></div>
        <button class="btn btn-primary" id="saveEntryBtn">บันทึกข้อมูล (${CAT_LABELS[CURRENT_CAT]})</button>
      </div>
    </div>
  `;

  document.getElementById('entryMonth').addEventListener('change', e=>{
    CURRENT_MONTH = e.target.value;
    loadMonthData();
  });
  document.getElementById('loadMonthBtn').addEventListener('click', ()=> loadMonthData());

  content.querySelectorAll('#catTabs .tab').forEach(t=>{
    t.addEventListener('click', ()=>{
      CURRENT_CAT = t.dataset.cat;
      content.querySelectorAll('#catTabs .tab').forEach(x=> x.classList.toggle('active', x===t));
      populateSupplierFilterOptions(); // หมวดเปลี่ยน → Supplier ในหมวดอาจเปลี่ยนด้วย
      renderEntryTable(CURRENT_ACTIVE); // ใช้ค่า active ที่ cache ไว้
      const btn = document.getElementById('saveEntryBtn');
      if(btn) btn.textContent = `บันทึกข้อมูล (${CAT_LABELS[CURRENT_CAT]})`;
    });
  });

  document.getElementById('saveEntryBtn').addEventListener('click', saveCategory);
  document.getElementById('exportTemplateBtn').addEventListener('click', exportEntryTemplate);

  // ── ค้นหาแบบ real-time (debounce เล็กน้อยเพื่อความลื่นไหล) ──
  let searchDebounce = null;
  document.getElementById('entrySearchInput').addEventListener('input', e=>{
    ENTRY_SEARCH_TEXT = e.target.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(()=> renderEntryTable(CURRENT_ACTIVE), 200);
  });

  document.getElementById('entrySupplierFilter').addEventListener('change', e=>{
    ENTRY_SUPPLIER_FILTER = e.target.value;
    renderEntryTable(CURRENT_ACTIVE);
  });

  document.getElementById('entryClearFilterBtn').addEventListener('click', ()=>{
    ENTRY_SEARCH_TEXT = '';
    ENTRY_SUPPLIER_FILTER = '';
    document.getElementById('entrySearchInput').value = '';
    document.getElementById('entrySupplierFilter').value = '';
    renderEntryTable(CURRENT_ACTIVE);
  });

  populateSupplierFilterOptions();
  await loadMonthData();
}

/* ============================================================
   SUPPLIER FILTER — เติม dropdown ตาม Supplier ที่มีในหมวดปัจจุบัน
============================================================ */
function populateSupplierFilterOptions(){
  const sel = document.getElementById('entrySupplierFilter');
  if(!sel) return;
  const items = ITEMS_BY_CAT[CURRENT_CAT] || [];
  // รวบรวมชื่อ Supplier ที่ไม่ซ้ำกัน เรียงตามตัวอักษรไทย/อังกฤษ
  const suppliers = Array.from(new Set(items.map(it=> (it.supplier||'').trim()).filter(Boolean)))
    .sort((a,b)=> a.localeCompare(b, 'th'));

  const prevValue = ENTRY_SUPPLIER_FILTER;
  sel.innerHTML = `<option value="">-- ทุก Supplier --</option>` +
    suppliers.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

  // คงค่าที่เคยเลือกไว้ ถ้า Supplier นั้นยังมีอยู่ในหมวดนี้
  if(suppliers.includes(prevValue)){
    sel.value = prevValue;
  } else {
    ENTRY_SUPPLIER_FILTER = '';
    sel.value = '';
  }
}

async function loadMonthData(){
  const wrap = document.getElementById('entryTableWrap');
  if(wrap) wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-soft)">กำลังโหลดข้อมูล...</div>';

  // รีเซ็ต save lock เมื่อโหลดข้อมูลเดือนใหม่
  SAVE_IN_PROGRESS = false;

  // Step 1: แสดงตารางจาก embedded data ทันที (ไม่รอ Firebase)
  CURRENT_DATA = { FRESH:{}, TRANSFER:{}, NONFRESH:{} };
  ENTRY_SAVED_BASELINE = { FRESH:{}, TRANSFER:{}, NONFRESH:{} };
  CURRENT_META = null;
  DIRTY = { FRESH:false, TRANSFER:false, NONFRESH:false };

  // Step 2: โหลด cache ของ months active (ถ้ายังไม่มี) — 1 round-trip เดียว
  if(!MONTHS_ACTIVE_CACHE) await loadMonthsCache();
  const active = isMonthActiveSync(CURRENT_MONTH);
  CURRENT_ACTIVE = active;

  // Step 3: แสดง banner และตาราง (จาก embedded data ก่อน)
  renderEntryStatusBanner(active);
  updateTabDots();
  renderEntryMeta();
  renderEntryTable(active);

  // Step 4: โหลดข้อมูลที่สาขาเคยบันทึกไว้จาก Firebase (background)
  const key = CURRENT_MONTH.replace('-','_');
  try{
    const fbData = await dbGetOnce(`counts/${key}/${SESSION.storeCode}`) || {};
    CURRENT_DATA = { FRESH: fbData.FRESH||{}, TRANSFER: fbData.TRANSFER||{}, NONFRESH: fbData.NONFRESH||{} };
    // เก็บ snapshot ไว้เป็น baseline สำหรับเทียบการเปลี่ยนแปลง (deep copy ป้องกันการแก้ทับโดยไม่ตั้งใจ)
    ENTRY_SAVED_BASELINE = JSON.parse(JSON.stringify(CURRENT_DATA));
    CURRENT_META = fbData._meta || null;
    // Refresh ตาราง + meta หลังได้ข้อมูลจาก Firebase
    renderEntryMeta();
    renderEntryTable(active);
  }catch(e){
    console.warn('[loadMonthData] Firebase load error:', e.message);
  }

  // ปุ่มบันทึก: active เสมอ เว้นแต่ admin ปิดเดือนนั้นไว้
  const saveBtn = document.getElementById('saveEntryBtn');
  if(saveBtn) saveBtn.disabled = !active;
}

function renderEntryStatusBanner(active){
  const el = document.getElementById('entryStatusBanner');
  if(!el) return;
  if(active){
    el.innerHTML = `<div style="background:var(--success-soft);border:1.5px solid var(--success);border-radius:var(--radius-md);padding:10px 16px;display:flex;align-items:center;gap:10px;">
      <span style="font-size:20px;">✅</span>
      <div style="font-size:13px;font-weight:700;color:var(--success);">เดือน ${thaiMonthLabel(CURRENT_MONTH)} เปิดรับการบันทึกข้อมูลแล้ว — สามารถบันทึกได้</div>
    </div>`;
  } else {
    el.innerHTML = `
      <div style="background:var(--warning-soft);border:1.5px solid var(--warning);border-radius:var(--radius-md);padding:14px 18px;display:flex;align-items:center;gap:12px;">
        <span style="font-size:24px;">🔒</span>
        <div>
          <div style="font-weight:800;font-size:14px;color:var(--warning);">ยังไม่เปิดรับการบันทึกข้อมูล</div>
          <div style="font-size:12.5px;color:var(--text-soft);margin-top:3px;">
            เดือน <b>${thaiMonthLabel(CURRENT_MONTH)}</b> ยังไม่ได้เปิด Active — กรุณาติดต่อผู้ดูแลระบบ (Admin)<br>
            <span style="color:var(--text-faint);">※ ดูรายการสินค้าและตรวจสอบข้อมูลได้ แต่ยังบันทึกไม่ได้</span>
          </div>
        </div>
      </div>`;
  }
}

function renderEntryMeta(){
  const el = document.getElementById('entryMeta');
  if(!el) return;
  if(CURRENT_META && CURRENT_META.updatedAt){
    el.innerHTML = `<span class="pill pill-success">✔ มีข้อมูลของเดือน <b>${thaiMonthLabel(CURRENT_MONTH)}</b></span>
      <span class="text-faint" style="margin-left:8px;font-size:12px;">
        บันทึกล่าสุด ${fmtDateTime(CURRENT_META.updatedAt)} โดย ${escapeHtml(CURRENT_META.updatedBy||'-')}
      </span>`;
  } else {
    el.innerHTML = `<span class="pill pill-muted">ยังไม่มีข้อมูลของเดือน <b>${thaiMonthLabel(CURRENT_MONTH)}</b> — บันทึกเพื่อเริ่มต้น</span>`;
  }
}

function renderEntryTable(active=true){
  const cat = CURRENT_CAT;
  const allItems = ITEMS_BY_CAT[cat] || [];
  const fields = cat === 'NONFRESH' ? ['QTY'] : ['FV','BUT','FISH'];
  const wrap = document.getElementById('entryTableWrap');

  if(!wrap) return;

  if(allItems.length === 0){
    // retry จาก embedded ITEMS_DATA ก่อนแสดง error
    if(typeof ITEMS_DATA !== 'undefined' && ITEMS_DATA.length > 0){
      console.warn('[renderEntryTable] ITEMS_BY_CAT empty — rebuilding from ITEMS_DATA');
      const counters = { FRESH:0, TRANSFER:0, NONFRESH:0 };
      ITEMS_BY_CAT = { FRESH:[], TRANSFER:[], NONFRESH:[] };
      ITEM_MAP = { FRESH:{}, TRANSFER:{}, NONFRESH:{} };
      ITEMS_DATA.forEach(item=>{
        counters[item.category] = (counters[item.category]||0)+1;
        const it = { ...item, no: counters[item.category] };
        ITEMS_BY_CAT[item.category].push(it);
        ITEM_MAP[item.category][item.code] = it;
      });
    }
    const retryItems = ITEMS_BY_CAT[cat] || [];
    if(retryItems.length === 0){
      wrap.innerHTML = `<div style="padding:48px;text-align:center;">
        <div style="font-size:32px;margin-bottom:12px;">📦</div>
        <div style="font-size:14px;font-weight:700;color:var(--text-soft);">ไม่พบรายการสินค้าในหมวด ${CAT_LABELS[cat]||cat}</div>
        <button class="btn btn-secondary btn-sm" style="margin-top:12px;" onclick="location.reload()">รีเฟรชหน้า</button>
      </div>`;
      return;
    }
    // retry สำเร็จ — ใช้ items ใหม่
    return renderEntryTable(active);
  }

  // ── กรองรายการตามคำค้นหา + Supplier ที่เลือก ──
  const searchTerm = (ENTRY_SEARCH_TEXT||'').trim().toLowerCase();
  const items = allItems.filter(item=>{
    if(ENTRY_SUPPLIER_FILTER && (item.supplier||'') !== ENTRY_SUPPLIER_FILTER) return false;
    if(searchTerm){
      const haystack = `${item.desc||''} ${item.code||''} ${item.supplier||''}`.toLowerCase();
      if(!haystack.includes(searchTerm)) return false;
    }
    return true;
  });

  // แสดงข้อความบอกผลการกรอง
  const filterInfoEl = document.getElementById('entryFilterInfo');
  if(filterInfoEl){
    if(searchTerm || ENTRY_SUPPLIER_FILTER){
      filterInfoEl.innerHTML = `พบ <b class="num">${items.length}</b> จาก ${allItems.length} รายการ`;
    } else {
      filterInfoEl.innerHTML = '';
    }
  }

  const headCols = fields.map(f=>`<th class="text-right">${CAT_FIELD_LABELS[f]}</th>`).join('');

  if(items.length === 0){
    wrap.innerHTML = `<div style="padding:40px;text-align:center;">
      <div style="font-size:28px;margin-bottom:10px;">🔍</div>
      <div style="font-size:13.5px;font-weight:700;color:var(--text-soft);">ไม่พบรายการที่ตรงกับการค้นหา</div>
      <div class="text-faint mt-8" style="font-size:12px;">ลองเปลี่ยนคำค้นหา หรือเลือก Supplier อื่น</div>
    </div>`;
    return;
  }

  const rows = items.map((item, idx)=>{
    const rec = CURRENT_DATA[cat][item.code];
    const inputCols = fields.map(f=>{
      const val = (rec && rec[f]!==undefined) ? rec[f] : '';
      const disabled = active ? '' : 'disabled';
      return `<td class="text-right">
        <input class="qty-input" type="number" min="0" step="any" inputmode="decimal"
          id="inp_${cat}_${item.code}_${f}" data-cat="${cat}" data-code="${item.code}" data-field="${f}"
          value="${val===''?'':val}" ${disabled}>
      </td>`;
    }).join('');
    const total = recordTotal(item, rec);
    const amount = recordAmount(item, rec);
    return `<tr>
      <td class="num text-soft">${idx+1}</td>
      <td class="nowrap text-soft" style="max-width:160px;white-space:normal;line-height:1.3;">${escapeHtml(item.supplier||'-')}</td>
      <td class="desc"><div>${escapeHtml(item.desc)}</div><div class="code">${escapeHtml(item.code)}</div></td>
      <td class="nowrap text-soft">${escapeHtml(item.uomCount)}</td>
      ${inputCols}
      <td class="text-right num" id="total_${cat}_${item.code}">${fmtNum(total,2)}</td>
      <td class="text-right num" id="amount_${cat}_${item.code}">${fmtMoney(amount)}</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="dtable">
      <thead><tr>
        <th>#</th><th>Supplier</th><th>รายการสินค้า</th><th>หน่วยนับ</th>${headCols}<th class="text-right">รวม</th><th class="text-right">มูลค่า (บาท)</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="${4+fields.length}" class="text-right">รวมมูลค่าทั้งหมวด</td>
        <td class="text-right num" id="grandTotalQty">0</td>
        <td class="text-right num" id="grandTotalAmount">0.00</td>
      </tr></tfoot>
    </table>
  `;

  wrap.querySelectorAll('.qty-input').forEach(inp=> inp.addEventListener('input', onQtyInput));
  updateGrandTotals();
}

function onQtyInput(e){
  const inp = e.target;
  const { cat, code, field } = inp.dataset;
  const item = ITEM_MAP[cat][code];
  if(!item) return;

  const rec = {};
  let hasAny = false;
  item.subFields.forEach(f=>{
    const v = document.getElementById(`inp_${cat}_${code}_${f}`).value;
    if(v !== '') hasAny = true;
    rec[f] = v===''?0:(parseFloat(v)||0);
  });

  // ── sync ค่าที่กรอกแบบ live เข้า CURRENT_DATA (in-memory) ──
  // เพื่อให้ updateGrandTotals คำนวณยอดรวมได้ถูกต้อง แม้บางแถวถูกซ่อนจากการค้นหา/filter
  if(!CURRENT_DATA[cat]) CURRENT_DATA[cat] = {};
  CURRENT_DATA[cat][code] = { ...rec };

  const total = recordTotal(item, rec);
  const amount = recordAmount(item, rec);
  const totalEl = document.getElementById(`total_${cat}_${code}`);
  const amountEl = document.getElementById(`amount_${cat}_${code}`);
  if(totalEl) totalEl.textContent = fmtNum(total, 2);
  if(amountEl) amountEl.textContent = fmtMoney(amount);

  const baseline = ENTRY_SAVED_BASELINE[cat] && ENTRY_SAVED_BASELINE[cat][code];
  const baseVal = (baseline && baseline[field]!==undefined) ? Number(baseline[field]) : 0;
  const curVal = inp.value===''?0:(parseFloat(inp.value)||0);
  inp.classList.toggle('changed', curVal !== baseVal);

  DIRTY[cat] = true;
  updateTabDots();
  updateGrandTotals();
}

function updateGrandTotals(){
  const cat = CURRENT_CAT;
  const items = ITEMS_BY_CAT[cat] || [];
  const fields = cat === 'NONFRESH' ? ['QTY'] : ['FV','BUT','FISH'];
  let totalQty = 0, totalAmount = 0, filledCount = 0;

  items.forEach(item=>{
    // อ่านจาก DOM ก่อนถ้าแถวนั้นแสดงอยู่ (กรณีกำลังพิมพ์ใน input ที่เพิ่งสร้าง)
    // ถ้าแถวถูกซ่อนจาก filter ให้อ่านจาก CURRENT_DATA (in-memory) ที่ sync ไว้ใน onQtyInput แทน
    const rec = {};
    let has = false;
    let usedDom = false;
    fields.forEach(f=>{
      const inp = document.getElementById(`inp_${cat}_${item.code}_${f}`);
      if(inp){
        usedDom = true;
        const v = inp.value;
        if(v !== '') has = true;
        rec[f] = v===''?0:(parseFloat(v)||0);
      }
    });
    if(!usedDom){
      // แถวไม่ได้แสดงในตาราง (ถูกกรองออก) — ใช้ค่าจาก memory
      const memRec = CURRENT_DATA[cat] && CURRENT_DATA[cat][item.code];
      if(memRec){
        fields.forEach(f=>{
          const v = Number(memRec[f]) || 0;
          if(v !== 0) has = true;
          rec[f] = v;
        });
      }
    }
    if(has) filledCount++;
    totalQty += recordTotal(item, rec);
    totalAmount += recordAmount(item, rec);
  });

  const qtyEl = document.getElementById('grandTotalQty');
  const amtEl = document.getElementById('grandTotalAmount');
  if(qtyEl) qtyEl.textContent = fmtNum(totalQty, 2);
  if(amtEl) amtEl.textContent = fmtMoney(totalAmount);

  const totalsEl = document.getElementById('entryTotals');
  if(totalsEl){
    totalsEl.innerHTML = `กรอกแล้ว <b class="num">${filledCount}</b> / ${items.length} รายการ
      &nbsp;&middot;&nbsp; มูลค่ารวม <b class="num">${fmtMoney(totalAmount)}</b> บาท`;
  }
}

function updateTabDots(){
  document.querySelectorAll('#catTabs .tab').forEach(t=>{
    t.classList.toggle('dirty', !!DIRTY[t.dataset.cat]);
  });
}

/* ============================================================
   SAVE (Monthly)
============================================================ */
async function saveCategory(){
  // ── CONCURRENCY GUARD: ป้องกันกด Save ซ้ำหรือ double-tap บนมือถือ ──
  if(SAVE_IN_PROGRESS){
    toast('กำลังบันทึกอยู่ กรุณารอสักครู่...', 'default');
    return;
  }

  // ── ตรวจ active จาก cache ก่อน (เร็ว) ──
  if(!CURRENT_ACTIVE){
    toast('เดือนนี้ยังไม่เปิดรับการบันทึก กรุณาติดต่อ Admin', 'error');
    return;
  }

  const cat = CURRENT_CAT;
  const items = ITEMS_BY_CAT[cat] || [];
  const updates = {};
  const changesLog = [];
  const newDataCat = {};
  const key = CURRENT_MONTH.replace('-','_');

  items.forEach(item=>{
    const fields = item.subFields;
    // ── อ่านค่าจาก DOM ถ้าแถวนั้นแสดงอยู่ในตาราง (อาจมีการพิมพ์ล่าสุด) ──
    // ถ้าแถวถูกซ่อนจาก filter/ค้นหา ให้อ่านจาก CURRENT_DATA (in-memory) ที่ sync ไว้แล้วใน onQtyInput
    // ป้องกันไม่ให้รายการที่ถูกกรองออกถูกบันทึกเป็น 0 ทับข้อมูลเดิมโดยไม่ตั้งใจ
    let hasInput = false;
    let usedDom = false;
    const rec = {};
    fields.forEach(f=>{
      const inp = document.getElementById(`inp_${cat}_${item.code}_${f}`);
      if(inp){
        usedDom = true;
        const raw = inp.value;
        if(raw !== '') hasInput = true;
        rec[f] = raw===''?0:(parseFloat(raw)||0);
      }
    });
    if(!usedDom){
      // แถวไม่ได้แสดงในตารางตอนนี้ (ถูกกรองออก) — ใช้ค่าจาก memory state ที่มีอยู่แล้ว
      const memRec = CURRENT_DATA[cat] && CURRENT_DATA[cat][item.code];
      if(memRec){
        fields.forEach(f=>{
          const v = Number(memRec[f]) || 0;
          if(v !== 0) hasInput = true;
          rec[f] = v;
        });
      }
    }

    // ── baseline คือค่าที่บันทึกไว้แล้วจริงใน Firebase (ไม่ใช่ live-edit state) ──
    const baseline = ENTRY_SAVED_BASELINE[cat] && ENTRY_SAVED_BASELINE[cat][item.code];
    const recsEqual = (a,b)=>{
      if(!a && !b) return true;
      if(!a || !b) return false;
      return fields.every(f=> (Number(a[f])||0) === (Number(b[f])||0));
    };

    if(hasInput){
      if(!recsEqual(baseline, rec)){
        updates[`counts/${key}/${SESSION.storeCode}/${cat}/${item.code}`] = rec;
        fields.forEach(f=>{
          const ov = (baseline && Number(baseline[f])) || 0;
          const nv = Number(rec[f]) || 0;
          if(ov !== nv) changesLog.push({ itemCode:item.code, itemDesc:item.desc, field:f, oldVal:ov, newVal:nv });
        });
      }
      newDataCat[item.code] = rec;
    } else if(baseline){
      updates[`counts/${key}/${SESSION.storeCode}/${cat}/${item.code}`] = null;
      fields.forEach(f=>{
        const ov = Number(baseline[f]) || 0;
        if(ov !== 0) changesLog.push({ itemCode:item.code, itemDesc:item.desc, field:f, oldVal:ov, newVal:0 });
      });
    }
  });

  if(changesLog.length === 0){
    toast('ไม่มีข้อมูลที่เปลี่ยนแปลง');
    return;
  }

  // ── SET LOCK ก่อน async operation ──
  SAVE_IN_PROGRESS = true;
  const btn = document.getElementById('saveEntryBtn');
  setLoading(btn, true, 'กำลังบันทึก...');

  try{
    // ── RE-VERIFY active status จาก Firebase ก่อน write จริง ──
    // ป้องกันกรณี admin ปิดเดือนระหว่างที่สาขากำลังกรอกข้อมูล
    try{
      await loadMonthsCache();
      const stillActive = isMonthActiveSync(CURRENT_MONTH);
      if(!stillActive){
        CURRENT_ACTIVE = false;
        renderEntryStatusBanner(false);
        if(btn) btn.disabled = true;
        toast('เดือนนี้ถูกปิดการบันทึกโดย Admin กรุณาติดต่อผู้ดูแลระบบ', 'error');
        return;
      }
    }catch(verifyErr){
      // ถ้า Firebase ขัดข้องระหว่าง verify ให้ใช้ค่า cache เดิม (ไม่ block การบันทึก)
      console.warn('[saveCategory] re-verify error (using cached status):', verifyErr.message);
    }

    updates[`counts/${key}/${SESSION.storeCode}/_meta`] = {
      storeName: SESSION.storeName,
      locNo: SESSION.locNo,
      updatedAt: Date.now(),
      updatedBy: SESSION.username
    };
    await dbUpdate(updates);
    // บันทึก log แบบ non-blocking (ถ้า PERMISSION_DENIED ก็ไม่หยุดการทำงาน)
    dbPush('logs', {
      ts: Date.now(),
      month: CURRENT_MONTH,
      store: SESSION.storeCode,
      storeName: SESSION.storeName,
      user: SESSION.username,
      action: 'SAVE',
      category: cat,
      changes: changesLog
    }).catch(e=> console.warn('[saveCategory] log error:', e.message));

    CURRENT_DATA[cat] = newDataCat;
    // sync baseline ใหม่ให้ตรงกับข้อมูลที่บันทึกสำเร็จแล้ว (deep copy ป้องกันการแก้ทับ)
    ENTRY_SAVED_BASELINE[cat] = JSON.parse(JSON.stringify(newDataCat));
    DIRTY[cat] = false;
    updateTabDots();
    renderEntryMeta();
    document.querySelectorAll('#entryTableWrap .qty-input.changed').forEach(i=> i.classList.remove('changed'));
    toast(`บันทึกข้อมูลเรียบร้อย (${changesLog.length} การเปลี่ยนแปลง)`, 'success');
  }catch(err){
    console.error(err);
    toast('เกิดข้อผิดพลาดในการบันทึก: ' + err.message, 'error');
  }finally{
    SAVE_IN_PROGRESS = false;  // ── RELEASE LOCK เสมอ ──
    setLoading(btn, false);
  }
}

/* ============================================================
   EXPORT TEMPLATE
============================================================ */
function exportEntryTemplate(){
  const cat = CURRENT_CAT;
  const items = ITEMS_BY_CAT[cat] || [];
  if(items.length === 0){ toast('ไม่มีรายการสินค้าในหมวดนี้', 'error'); return; }

  const fields = cat === 'NONFRESH' ? ['QTY'] : ['F&V', 'BUT', 'FISH'];
  const monthLabel = thaiMonthLabel(CURRENT_MONTH);

  const headerRow = {
    '#': '#', 'รหัสสินค้า':'รหัสสินค้า', 'รายการสินค้า':'รายการสินค้า', 'หน่วยนับ':'หน่วยนับ',
  };
  fields.forEach(f => { headerRow[f] = f; });
  headerRow['รวม'] = 'รวม';
  headerRow['หมายเหตุ'] = 'หมายเหตุ';

  const rows = items.map((item, idx) => {
    const row = {
      '#': idx + 1, 'รหัสสินค้า': item.code, 'รายการสินค้า': item.desc, 'หน่วยนับ': item.uomCount,
    };
    fields.forEach(f => { row[f] = ''; });
    row['รวม'] = '';
    row['หมายเหตุ'] = '';
    return row;
  });

  const sheetName = `${SESSION.locNo}_${CURRENT_MONTH}`.substring(0, 31);
  const filename  = `Template_${SESSION.locNo}_${SESSION.storeName.replace(/[^a-zA-Z0-9ก-๙]/g,'_').substring(0,20)}_${CURRENT_MONTH}.xlsx`;

  const wb = XLSX.utils.book_new();
  const titleRows = [
    [`แบบฟอร์มตรวจนับ Packing — ${CAT_LABELS[cat]}`],
    [`สาขา: ${SESSION.locNo} - ${SESSION.storeName}  |  เดือน: ${monthLabel}`],
    [],
  ];

  const colKeys = ['#', 'รหัสสินค้า', 'รายการสินค้า', 'หน่วยนับ', ...fields, 'รวม', 'หมายเหตุ'];
  const headerArr = colKeys;
  const dataArrs  = rows.map(r => colKeys.map(k => r[k]));
  const allArrs = [...titleRows, headerArr, ...dataArrs];

  const ws = XLSX.utils.aoa_to_sheet(allArrs);
  ws['!cols'] = [
    { wch: 5 }, { wch: 18 }, { wch: 52 }, { wch: 14 },
    ...fields.map(() => ({ wch: 10 })),
    { wch: 10 }, { wch: 20 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
  toast(`Export แบบฟอร์มตรวจนับเรียบร้อย (${items.length} รายการ)`, 'success');
}

/* ============================================================
   HISTORY / EXPORT VIEW (Monthly)
============================================================ */
async function renderHistoryView(){
  setTopbar('ประวัติการตรวจนับ / Export Excel', `${SESSION.locNo} - ${SESSION.storeName}`);
  const content = document.getElementById('content');
  const months = generateMonthRange('2026-06','2030-12');
  const monthOptions = months.map(m=>`<option value="${m}">${thaiMonthLabel(m)}</option>`).join('');

  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">สถิติรายเดือน (ทุกสาขา)</div>
          <div class="muted">ข้อมูลสรุปมูลค่า FRESH FOOD รายเดือน ตั้งแต่ มิถุนายน 2026</div>
        </div>
      </div>
      <div id="monthlyStatsWrap">
        <div class="text-soft" style="padding:32px;text-align:center;">กำลังโหลดสถิติ...</div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div>
          <div class="card-title">Export ข้อมูลของสาขานี้</div>
          <div class="muted">Export ข้อมูลตรวจนับรายเดือนเป็น Excel</div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>เลือกเดือน</label>
          <select id="histMonth">${monthOptions}</select>
        </div>
        <button class="btn btn-accent" id="histExportBtn">Export Excel เดือนนี้</button>
      </div>
    </div>
  `;

  document.getElementById('histExportBtn').addEventListener('click', ()=>{
    const month = document.getElementById('histMonth').value;
    if(!month){ toast('กรุณาเลือกเดือน','error'); return; }
    exportStoreMonthExcel(month);
  });

  // Load monthly stats
  await loadMonthlyStats();
}

async function loadMonthlyStats(){
  const wrap = document.getElementById('monthlyStatsWrap');
  if(!wrap) return;

  const months = generateMonthRange('2026-06','2030-12');
  const now = todayStr().slice(0,7);

  // Build table
  let rows = '';
  const results = [];

  for(const m of months){
    if(m > now) continue; // Only show past/current months
    const key = m.replace('-','_');
    const data = await dbGetOnce(`counts/${key}/${SESSION.storeCode}`);
    let freshValue = 0;
    let hasData = false;
    if(data){
      hasData = true;
      const catData = data.FRESH || {};
      Object.entries(catData).forEach(([code, r])=>{
        const item = ITEM_MAP.FRESH[code] || placeholderItem('FRESH', code);
        freshValue += recordAmount(item, r);
      });
    }
    results.push({ month: m, hasData, freshValue });
  }

  if(results.length === 0){
    wrap.innerHTML = '<div class="text-soft" style="padding:32px;text-align:center;">ยังไม่มีข้อมูล</div>';
    return;
  }

  rows = results.map(r=>{
    const badge = r.hasData
      ? `<span class="pill pill-success">✔ มีข้อมูล</span>`
      : `<span class="pill pill-muted">ยังไม่มีข้อมูล</span>`;
    const val = r.hasData ? `<b class="num">${fmtMoney(r.freshValue)}</b>` : `<span class="text-faint">—</span>`;
    return `<tr>
      <td class="nowrap num">${thaiMonthLabel(r.month)}</td>
      <td>${badge}</td>
      <td class="text-right">${val}</td>
      <td class="text-right text-soft" style="font-size:12px;">บาท</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="table-wrap">
      <table class="dtable">
        <thead><tr>
          <th>เดือน</th><th>สถานะ</th><th class="text-right">มูลค่า FRESH FOOD (บาท)</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function exportStoreMonthExcel(month){
  const key = month.replace('-','_');
  const cats = ['FRESH','TRANSFER','NONFRESH'];
  const rows = [];

  for(const cat of cats){
    const data = await dbGetOnce(`counts/${key}/${SESSION.storeCode}/${cat}`) || {};
    Object.entries(data).forEach(([itemCode, r])=>{
      const item = ITEM_MAP[cat][itemCode] || placeholderItem(cat, itemCode);
      rows.push(buildExportRow(month, SESSION.storeCode, cat, item, r));
    });
  }

  if(rows.length === 0){ toast('ไม่พบข้อมูลของเดือนนี้', 'error'); return; }

  const filename = `PackagingCount_${SESSION.locNo}_${SESSION.storeName.replace(/[^a-zA-Z0-9ก-๙]/g,'_').substring(0,15)}_${month}.xlsx`;
  exportRowsToExcel({ 'ข้อมูลตรวจนับ': rows }, filename);
  toast(`Export เดือน ${thaiMonthLabel(month)} สำเร็จ (${rows.length} รายการ)`, 'success');
}

/* ============================================================
   ADMIN MONTHS MANAGEMENT
============================================================ */
async function renderAdminMonths(){
  setTopbar('จัดการเดือนที่เปิด/ปิด', 'กำหนดเดือนที่อนุญาตให้สาขาบันทึกข้อมูล');
  const content = document.getElementById('content');

  const months = generateMonthRange('2026-06','2030-12');
  const thisMonth = todayStr().slice(0,7);
  const monthOpts = months.map(m=>`<option value="${m}" ${m===thisMonth?'selected':''}>${thaiMonthLabel(m)}</option>`).join('');

  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">จัดการสถานะเดือน (Active / Inactive)</div>
          <div class="muted">กำหนดว่าเดือนใดที่อนุญาตให้สาขาบันทึกข้อมูลได้ — สาขาจะเห็นข้อความแจ้งหากเดือนนั้น Inactive</div>
        </div>
      </div>
      <div class="form-row" style="align-items:flex-end;">
        <div class="form-group" style="min-width:200px;">
          <label>เลือกเดือน</label>
          <select id="monthSelect">${monthOpts}</select>
        </div>
        <button class="btn btn-primary" id="setActiveBtn">✅ เปิด Active เดือนนี้</button>
        <button class="btn btn-danger" id="setInactiveBtn">🔒 ปิด Inactive เดือนนี้</button>
      </div>
      <div class="mt-12" id="monthStatusMsg"></div>
    </div>

    <div class="card mt-16" id="firebaseRulesCard" style="display:none;">
      <div class="card-head">
        <div>
          <div class="card-title" style="color:var(--danger);">⚠️ Firebase Rules ต้องแก้ไข</div>
          <div class="muted">ระบบตรวจพบว่า Firebase ปฏิเสธการเขียนข้อมูล — ข้อมูลถูกบันทึกไว้ใน localStorage แทน (เฉพาะเครื่องนี้) กรุณาแก้ Firebase Rules เพื่อให้ sync ข้ามอุปกรณ์ได้</div>
        </div>
      </div>
      <div style="font-size:13px;margin-bottom:10px;">ไปที่ <b>Firebase Console → Realtime Database → Rules</b> แล้วใส่ Rules นี้:</div>
      <pre style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:14px;font-size:12px;overflow:auto;line-height:1.6;">{
  "rules": {
    ".read": true,
    ".write": true
  }
}</pre>
      <div class="mt-8" style="font-size:12px;color:var(--text-faint);">หรือถ้าต้องการ Rules ที่ปลอดภัยกว่า สามารถใช้แบบนี้แทน:</div>
      <pre style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:14px;font-size:12px;overflow:auto;line-height:1.6;margin-top:6px;">{
  "rules": {
    "counts":   { ".read": true, ".write": true },
    "items":    { ".read": true, ".write": true },
    "logs":     { ".read": true, ".write": true },
    "settings": { ".read": true, ".write": true }
  }
}</pre>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div class="card-title">สถานะเดือนทั้งหมด (มิ.ย. 2026 – ธ.ค. 2030)</div>
      </div>
      <div id="monthsTableWrap">
        <div class="text-soft" style="padding:24px;text-align:center;">กำลังโหลด...</div>
      </div>
    </div>
  `;

  document.getElementById('monthSelect').addEventListener('change', ()=> checkMonthStatus());
  document.getElementById('setActiveBtn').addEventListener('click', ()=> setMonthStatus(true));
  document.getElementById('setInactiveBtn').addEventListener('click', ()=> setMonthStatus(false));

  // โหลด cache ก่อน (เพื่อให้ loadAllMonthStatuses ทำงานได้ทันที)
  if(!MONTHS_ACTIVE_CACHE) await loadMonthsCache();
  await loadAllMonthStatuses();
  await checkMonthStatus();
}

async function checkMonthStatus(){
  const month = document.getElementById('monthSelect')?.value;
  if(!month) return;
  // ใช้ cache ที่มีอยู่ — ไม่ยิง Firebase ซ้ำ
  const active = isMonthActiveSync(month);
  const el = document.getElementById('monthStatusMsg');
  if(!el) return;
  const storageInfo = lsGet('settings/months') ? '<span class="text-faint" style="font-size:11px;margin-left:8px;">(บันทึกแล้ว)</span>' : '';
  if(active){
    el.innerHTML = `<div style="background:var(--success-soft);border:1.5px solid var(--success);border-radius:8px;padding:10px 16px;display:inline-flex;align-items:center;gap:8px;">
      <span style="font-size:18px;">✅</span>
      <span style="font-size:13px;font-weight:700;color:var(--success);">เดือน <b>${thaiMonthLabel(month)}</b> — Active (เปิดรับบันทึก)</span>
      ${storageInfo}
    </div>`;
  } else {
    el.innerHTML = `<div style="background:var(--danger-soft);border:1.5px solid var(--danger);border-radius:8px;padding:10px 16px;display:inline-flex;align-items:center;gap:8px;">
      <span style="font-size:18px;">🔒</span>
      <span style="font-size:13px;font-weight:700;color:var(--danger);">เดือน <b>${thaiMonthLabel(month)}</b> — Inactive (ปิดการบันทึก)</span>
      ${storageInfo}
    </div>`;
  }
}

async function setMonthStatus(active){
  const month = document.getElementById('monthSelect')?.value;
  if(!month){ toast('กรุณาเลือกเดือน', 'error'); return; }
  const key = month.replace('-','_');

  const setBtn = document.getElementById(active ? 'setActiveBtn' : 'setInactiveBtn');
  if(setBtn) setLoading(setBtn, true, active ? 'กำลังเปิด...' : 'กำลังปิด...');

  try{
    // อัปเดต MONTHS_ACTIVE_CACHE ทันที (optimistic update) ก่อนรอ Firebase
    if(!MONTHS_ACTIVE_CACHE) MONTHS_ACTIVE_CACHE = {};
    MONTHS_ACTIVE_CACHE[key] = active;
    lsSet('settings/months', MONTHS_ACTIVE_CACHE); // sync to LS

    // บันทึกลง Firebase (dbSet จะ fallback to LS ถ้า PERMISSION_DENIED)
    await dbSet(`settings/months/${key}`, active);

    // บันทึก log (non-blocking)
    dbPush('logs', {
      ts: Date.now(), month, store: '-', storeName: '-',
      user: SESSION.username, action: active ? 'MONTH_ACTIVATE' : 'MONTH_DEACTIVATE',
      category: '-', changes: [{ itemCode: '-', itemDesc: `เดือน ${thaiMonthLabel(month)}`, field: 'status', oldVal: !active, newVal: active }]
    }).catch(()=>{});

    toast(`${active ? '✅ เปิด' : '🔒 ปิด'} Active เดือน ${thaiMonthLabel(month)} เรียบร้อย`, 'success');
    await checkMonthStatus();
    await loadAllMonthStatuses();
  }catch(err){
    // rollback optimistic update
    if(MONTHS_ACTIVE_CACHE) MONTHS_ACTIVE_CACHE[key] = !active;
    lsSet('settings/months', MONTHS_ACTIVE_CACHE);
    const msg = err.message || '';
    if(msg.includes('PERMISSION_DENIED') || msg.includes('Permission denied')){
      // แสดง card แนะนำแก้ Firebase Rules
      const rulesCard = document.getElementById('firebaseRulesCard');
      if(rulesCard) rulesCard.style.display = '';
      toast('⚠️ Firebase Rules ปฏิเสธ — ข้อมูลบันทึกแค่เครื่องนี้ กรุณาแก้ Rules ตามคำแนะนำด้านล่าง', 'error');
    } else {
      toast('เกิดข้อผิดพลาด: ' + msg, 'error');
    }
  }finally{
    if(setBtn) setLoading(setBtn, false);
  }
}

async function loadAllMonthStatuses(){
  const wrap = document.getElementById('monthsTableWrap');
  if(!wrap) return;

  // ใช้ cache ที่มีอยู่แล้ว (ไม่รอ Firebase ซ้ำ)
  // ถ้าไม่มี cache ให้โหลดใหม่
  if(!MONTHS_ACTIVE_CACHE) await loadMonthsCache();
  const data = MONTHS_ACTIVE_CACHE || {};

  const months = generateMonthRange('2026-06','2030-12');
  const now = todayStr().slice(0,7);

  const rows = months.map(m=>{
    const key = m.replace('-','_');
    const active = data[key] === true;
    const isCurrent = m === now;
    const badge = active
      ? `<span class="pill pill-success" style="font-size:12px;">✅ Active (เปิดรับ)</span>`
      : `<span class="pill pill-danger" style="font-size:12px;">🔒 Inactive (ปิด)</span>`;
    const currentBadge = isCurrent
      ? `<span class="pill pill-info" style="margin-left:6px;font-size:11px;">เดือนปัจจุบัน</span>` : '';
    const rowStyle = isCurrent ? 'background:var(--primary-soft);' : '';
    return `<tr style="${rowStyle}">
      <td class="nowrap num" style="font-weight:${isCurrent?'800':'500'}">${thaiMonthLabel(m)}</td>
      <td>${badge}${currentBadge}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="setMonthStatusDirect('${m}', true)" ${active?'disabled':''}>✅ เปิด Active</button>
        <button class="btn btn-danger btn-sm" onclick="setMonthStatusDirect('${m}', false)" style="margin-left:4px;" ${!active?'disabled':''}>🔒 ปิด Inactive</button>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="table-wrap" style="max-height:480px;">
      <table class="dtable">
        <thead><tr>
          <th>เดือน</th>
          <th>สถานะ</th>
          <th>การจัดการ</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function setMonthStatusDirect(month, active){
  const key = month.replace('-','_');
  try{
    // Optimistic update — อัปเดต cache ทันที
    if(!MONTHS_ACTIVE_CACHE) MONTHS_ACTIVE_CACHE = {};
    MONTHS_ACTIVE_CACHE[key] = active;
    lsSet('settings/months', MONTHS_ACTIVE_CACHE);

    await dbSet(`settings/months/${key}`, active);

    dbPush('logs', {
      ts: Date.now(), month, store: '-', storeName: '-',
      user: SESSION.username, action: active ? 'MONTH_ACTIVATE' : 'MONTH_DEACTIVATE',
      category: '-', changes: [{ itemCode: '-', itemDesc: `เดือน ${thaiMonthLabel(month)}`, field: 'status', oldVal: !active, newVal: active }]
    }).catch(()=>{});

    toast(`${active ? '✅ เปิด' : '🔒 ปิด'} Active เดือน ${thaiMonthLabel(month)} เรียบร้อย`, 'success');
    await loadAllMonthStatuses();
    await checkMonthStatus();
  }catch(err){
    if(MONTHS_ACTIVE_CACHE) MONTHS_ACTIVE_CACHE[key] = !active;
    toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

/* ===== ADMIN VIEW ===== */
// ============================================================
// admin-view.js — หน้าจอผู้ดูแลระบบ (Admin)
// ============================================================

let ADMIN_DATA_ROWS = []; // cache of last search results for edit/delete

/* ============================================================
   OVERVIEW
============================================================ */
async function renderAdminOverview(){
  setTopbar('ภาพรวมระบบ', 'Packaging Count — CP Axtra / Makro');
  const content = document.getElementById('content');
  const thisMonth = todayStr().slice(0,7);
  const months = generateMonthRange('2026-06','2030-12');
  const monthOpts = months.map(m=>`<option value="${m}" ${m===thisMonth?'selected':''}>${thaiMonthLabel(m)}</option>`).join('');

  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">ภาพรวมการบันทึกข้อมูลรายเดือน</div>
          <div class="muted">เลือกเดือนเพื่อดูสถานะการบันทึกของแต่ละสาขา</div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>เดือน</label><select id="ovMonth">${monthOpts}</select></div>
          <button class="btn btn-secondary" id="ovRefreshBtn">รีเฟรช</button>
        </div>
      </div>
      <div class="stat-grid" id="ovStats">
        <div class="stat-card"><div class="label">กำลังโหลด...</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">รายการสินค้าในระบบ</div>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="label">FRESH FOOD</div><div class="value">${ITEMS_BY_CAT.FRESH.length}</div><div class="sub">รายการ &middot; ตรวจนับ F&amp;V / BUT / FISH</div></div>
        <div class="stat-card"><div class="label">สาขาทั้งหมด</div><div class="value">${STORES_DATA.length}</div><div class="sub">สาขาในระบบ</div></div>
      </div>
    </div>
  `;

  document.getElementById('ovRefreshBtn').addEventListener('click', loadOverviewStats);
  document.getElementById('ovMonth').addEventListener('change', loadOverviewStats);
  await loadOverviewStats();
}

async function loadOverviewStats(){
  const month = document.getElementById('ovMonth')?.value;
  if(!month) return;
  const statsEl = document.getElementById('ovStats');
  statsEl.innerHTML = `<div class="stat-card"><div class="label">กำลังโหลด...</div></div>`;

  const key = month.replace('-','_');
  const data = await dbGetOnce(`counts/${key}`) || {};
  const storeCodes = Object.keys(data);
  const submitted = storeCodes.length;
  const total = STORES_DATA.length;
  const pct = total ? Math.round((submitted/total)*100) : 0;
  const active = await isMonthActive(month);

  let grandAmount = 0;
  storeCodes.forEach(code=>{
    const rec = data[code];
    ['FRESH','TRANSFER','NONFRESH'].forEach(cat=>{
      const catData = rec[cat];
      if(!catData) return;
      Object.entries(catData).forEach(([itemCode, r])=>{
        const item = ITEM_MAP[cat][itemCode];
        if(item) grandAmount += recordAmount(item, r);
      });
    });
  });

  const statusBadge = active
    ? `<span class="pill pill-success">✅ Active</span>`
    : `<span class="pill pill-danger">🔒 Inactive</span>`;

  statsEl.innerHTML = `
    <div class="stat-card">
      <div class="label">สถานะเดือน ${thaiMonthLabel(month)}</div>
      <div class="value" style="font-size:18px;">${statusBadge}</div>
      <div class="sub">กำหนดได้ที่เมนู "จัดการเดือน"</div>
    </div>
    <div class="stat-card">
      <div class="label">สาขาที่บันทึกแล้ว</div>
      <div class="value">${fmtNum(submitted)} / ${fmtNum(total)}</div>
      <div class="bar"><div style="width:${pct}%"></div></div>
      <div class="sub">${pct}% ของสาขาทั้งหมด</div>
    </div>
    <div class="stat-card">
      <div class="label">สาขาที่ยังไม่บันทึก</div>
      <div class="value">${fmtNum(total - submitted)}</div>
      <div class="sub">สาขา</div>
    </div>
    <div class="stat-card">
      <div class="label">มูลค่ารวมของเดือนนี้</div>
      <div class="value">${fmtMoney(grandAmount)}</div>
      <div class="sub">บาท (ทุกสาขา / ทุกหมวด)</div>
    </div>
  `;
}

/* ============================================================
   ผู้ใช้งานออนไลน์ (PRESENCE) — ดูว่า user ใดเข้าใช้งานระบบอยู่ตอนนี้
   พร้อมปุ่มบังคับออกจากระบบ สำหรับกรณี session ค้างหรือเข้าระบบไม่ได้
============================================================ */
let ONLINE_USERS_REF = null;       // ref ของ presence node ทั้งหมด (สำหรับ on('value'))
let ONLINE_USERS_CACHE = {};       // cache ข้อมูล presence ล่าสุดที่ได้รับ

async function renderAdminOnlineUsers(){
  setTopbar('ผู้ใช้งานออนไลน์', 'ตรวจสอบสถานะการเข้าใช้งานระบบ Real-time ของสาขาทั้งหมด');
  const content = document.getElementById('content');

  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">สถานะการเข้าใช้งานระบบของสาขา</div>
          <div class="muted">แสดงผลแบบ Real-time — รายการนี้จะอัปเดตอัตโนมัติเมื่อมีสาขา เข้า/ออก ระบบ</div>
        </div>
        <div class="pill pill-success" id="onlineCountBadge">🟢 0 สาขาออนไลน์</div>
      </div>
      <div id="onlineUsersWrap">
        <div class="text-soft" style="padding:32px;text-align:center;">กำลังเชื่อมต่อ...</div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div class="card-title">หมายเหตุการใช้งาน</div>
      </div>
      <div class="text-soft" style="font-size:13px;line-height:1.7;">
        • สถานะ <span class="pill pill-success" style="vertical-align:middle;">🟢 Online</span> หมายถึงอุปกรณ์ของสาขานั้นยังเชื่อมต่อกับระบบอยู่ขณะนี้<br>
        • ระบบจะตัดสถานะ Online อัตโนมัติเมื่อปิดเบราว์เซอร์ ปิดแท็บ หรือเน็ตหลุด (ภายในไม่กี่วินาที)<br>
        • หากพบสาขาที่ Online ค้างอยู่นานผิดปกติ หรือสาขาแจ้งว่าเข้าระบบไม่ได้ (เช่น ระบบแจ้งว่ามีการใช้งานซ้อน) สามารถกดปุ่ม <b>"บังคับออกจากระบบ"</b> เพื่อล้าง session นั้นได้ทันที
      </div>
    </div>
  `;

  // ── ฟัง Firebase 'presence/' แบบ real-time ด้วย on('value') ──
  // ใช้ on() ไม่ใช่ dbGetOnce() เพราะหน้านี้ต้องอัปเดตทันทีเมื่อมีคน login/logout
  if(ONLINE_USERS_REF){
    try{ ONLINE_USERS_REF.off(); }catch(e){}
  }
  ONLINE_USERS_REF = db.ref('presence');
  ONLINE_USERS_REF.on('value', (snap)=>{
    ONLINE_USERS_CACHE = snap.val() || {};
    renderOnlineUsersTable();
  }, (err)=>{
    console.warn('[renderAdminOnlineUsers] presence listener error:', err.message);
    const wrap = document.getElementById('onlineUsersWrap');
    if(wrap) wrap.innerHTML = `<div class="text-soft" style="padding:24px;text-align:center;">ไม่สามารถเชื่อมต่อสถานะออนไลน์ได้ (${escapeHtml(err.message)})</div>`;
  });
}

function renderOnlineUsersTable(){
  const wrap = document.getElementById('onlineUsersWrap');
  const badge = document.getElementById('onlineCountBadge');
  if(!wrap) return; // ออกจากหน้านี้ไปแล้ว

  // ── กรองเฉพาะ user สาขา (role === 'store') — ไม่แสดง Admin ในรายการนี้ ──
  const entries = Object.entries(ONLINE_USERS_CACHE).filter(([, u])=> u.role !== 'admin');
  if(badge) badge.textContent = `🟢 ${entries.length} สาขาออนไลน์`;

  if(entries.length === 0){
    wrap.innerHTML = `<div style="padding:40px;text-align:center;">
      <div style="font-size:32px;margin-bottom:10px;">🌙</div>
      <div style="font-size:13.5px;font-weight:700;color:var(--text-soft);">ไม่มีสาขาออนไลน์ในขณะนี้</div>
    </div>`;
    return;
  }

  // เรียงตาม locNo (ถ้ามี) แล้วตามชื่อ
  const sorted = entries.sort((a,b)=>{
    const [, ua] = a, [, ub] = b;
    const na = Number(ua.locNo) || 9999, nb = Number(ub.locNo) || 9999;
    if(na !== nb) return na - nb;
    return (ua.storeName||'').localeCompare(ub.storeName||'', 'th');
  });

  const now = Date.now();
  const rows = sorted.map(([userKey, u])=>{
    const label = `${escapeHtml(u.locNo||'-')} - ${escapeHtml(u.storeName||'-')}`;
    const secondsAgo = Math.max(0, Math.round((now - (u.lastSeen||u.loginAt||now)) / 1000));
    const lastSeenLabel = secondsAgo < 60 ? `${secondsAgo} วินาทีที่แล้ว` : fmtDateTime(u.lastSeen);
    // ถ้า heartbeat ล่าสุดเกิน 90 วิ ถือว่าอาจหลุด/ค้าง (เผื่อ onDisconnect ยังไม่ทันลบ)
    const stale = secondsAgo > 90;
    return `<tr>
      <td>${label}</td>
      <td>
        ${stale
          ? `<span class="pill pill-warning">🟡 อาจไม่ตอบสนอง</span>`
          : `<span class="pill pill-success">🟢 Online</span>`}
      </td>
      <td class="nowrap text-soft">${fmtDateTime(u.loginAt)}</td>
      <td class="nowrap text-soft">${lastSeenLabel}</td>
      <td class="text-faint" style="font-size:11px;max-width:200px;white-space:normal;">${escapeHtml(u.userAgent||'-')}</td>
      <td class="nowrap">
        <button class="btn btn-danger btn-sm" data-force-logout="${escapeHtml(userKey)}" data-session="${escapeHtml(u.sessionId||'')}">บังคับออกจากระบบ</button>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="table-wrap">
      <table class="dtable">
        <thead><tr>
          <th>สาขา</th><th>สถานะ</th><th>เวลาเข้าระบบ</th><th>เห็นล่าสุด</th><th>อุปกรณ์ / เบราว์เซอร์</th><th>การจัดการ</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  wrap.querySelectorAll('[data-force-logout]').forEach(btn=>{
    btn.addEventListener('click', ()=> confirmForceLogout(btn.dataset.forceLogout, btn.dataset.session));
  });
}

function confirmForceLogout(userKey, sessionId){
  const u = ONLINE_USERS_CACHE[userKey];
  const label = u ? (u.role === 'admin' ? (u.storeName||u.username) : `${u.locNo||'-'} - ${u.storeName||'-'}`) : userKey;
  showModal(`
    <h3>ยืนยันการบังคับออกจากระบบ</h3>
    <div class="text-soft" style="font-size:13px;margin-bottom:14px;">
      ต้องการบังคับให้ <b>${escapeHtml(label)}</b> ออกจากระบบใช่หรือไม่?<br><br>
      <span class="pill pill-warning">หมายเหตุ: หากผู้ใช้กำลังกรอกข้อมูลอยู่และยังไม่ได้กดบันทึก ข้อมูลที่กรอกไว้ในหน้านั้นจะหายไป</span>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="flCancelBtn">ยกเลิก</button>
      <button class="btn btn-danger" id="flConfirmBtn">บังคับออกจากระบบ</button>
    </div>
  `, ()=>{
    document.getElementById('flCancelBtn').addEventListener('click', closeModal);
    document.getElementById('flConfirmBtn').addEventListener('click', ()=> doForceLogout(userKey, sessionId));
  });
}

async function doForceLogout(userKey, sessionId){
  try{
    // เขียนคำสั่ง force-logout ไปที่ path ที่ session เป้าหมายกำลังฟังอยู่
    // session นั้นจะเห็นคำสั่งนี้แบบ real-time แล้ว auto logout ตัวเอง (ดู startPresenceTracking)
    await dbSet(`forceLogout/${userKey}`, { sessionId: sessionId || '', requestedAt: Date.now(), by: SESSION.username });
    // ลบ presence ออกทันทีจากฝั่ง admin ด้วย เผื่อ client ปลายทางไม่ตอบสนอง (เช่นค้างจริง/ปิดไปแล้วแต่ onDisconnect ช้า)
    await dbRemove(`presence/${userKey}`);
    closeModal();
    toast('สั่งบังคับออกจากระบบเรียบร้อย', 'success');
  }catch(err){
    console.error(err);
    toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

/* ============================================================
   DATA BROWSER
============================================================ */
async function renderAdminData(){
  setTopbar('ข้อมูลการตรวจนับ', 'ค้นหา / แก้ไข / ลบ ข้อมูลรายการตรวจนับ (รายเดือน)');
  const content = document.getElementById('content');

  const months = generateMonthRange('2026-06','2030-12');
  const thisMonth = todayStr().slice(0,7);
  const monthOpts = months.map(m=>`<option value="${m}" ${m===thisMonth?'selected':''}>${thaiMonthLabel(m)}</option>`).join('');

  const storeOptions = STORES_DATA
    .slice()
    .sort((a,b)=> Number(a.locNo) - Number(b.locNo))
    .map(s=>`<option value="${s.username}">${s.locNo} - ${escapeHtml(s.name)}</option>`).join('');

  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">ค้นหาข้อมูลการตรวจนับรายเดือน</div>
          <div class="muted">เลือกเดือน สาขา และหมวดหมู่ แล้วกด "ค้นหา"</div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>เดือน</label>
          <select id="dataMonth">${monthOpts}</select>
        </div>
        <div class="form-group" style="min-width:220px;">
          <label>สาขา</label>
          <select id="dataStore">
            <option value="ALL">-- ทุกสาขา --</option>
            ${storeOptions}
          </select>
        </div>
        <div class="form-group">
          <label>หมวดหมู่</label>
          <select id="dataCat">
            <option value="ALL">ทั้งหมด</option>
            <option value="FRESH">FRESH FOOD</option>
            <option value="TRANSFER">TRANSFER</option>
            <option value="NONFRESH">NON FRESH</option>
          </select>
        </div>
        <button class="btn btn-primary" id="dataSearchBtn">ค้นหา</button>
      </div>
      <div class="mt-12" id="dataResultInfo"></div>
      <div class="table-wrap mt-12" id="dataResultWrap"></div>
    </div>
  `;

  document.getElementById('dataSearchBtn').addEventListener('click', searchAdminData);
}

async function searchAdminData(){
  const month = document.getElementById('dataMonth').value;
  const storeFilter = document.getElementById('dataStore').value;
  const catFilter = document.getElementById('dataCat').value;
  const infoEl = document.getElementById('dataResultInfo');
  const wrapEl = document.getElementById('dataResultWrap');

  if(!month){
    toast('กรุณาเลือกเดือน', 'error');
    return;
  }

  infoEl.innerHTML = `<div class="text-soft">กำลังค้นหา...</div>`;
  wrapEl.innerHTML = '';
  ADMIN_DATA_ROWS = [];

  const key = month.replace('-','_');
  const data = await dbGetOnce(`counts/${key}`);
  if(data){
    const storeCodes = storeFilter === 'ALL' ? Object.keys(data) : (data[storeFilter] ? [storeFilter] : []);
    storeCodes.forEach(storeCode=>{
      const rec = data[storeCode];
      if(!rec) return;
      ['FRESH','TRANSFER','NONFRESH'].forEach(cat=>{
        if(catFilter !== 'ALL' && catFilter !== cat) return;
        const catData = rec[cat];
        if(!catData) return;
        Object.entries(catData).forEach(([itemCode, r])=>{
          const item = ITEM_MAP[cat][itemCode] || placeholderItem(cat, itemCode);
          ADMIN_DATA_ROWS.push({ month, storeCode, cat, itemCode, item, rec: r });
        });
      });
    });
  }

  if(ADMIN_DATA_ROWS.length === 0){
    infoEl.innerHTML = '<div class="text-soft">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</div>';
    return;
  }

  const MAX_SHOW = 1000;
  const showRows = ADMIN_DATA_ROWS.slice(0, MAX_SHOW);
  infoEl.innerHTML = `พบ <b class="num">${fmtNum(ADMIN_DATA_ROWS.length)}</b> รายการ
    ${ADMIN_DATA_ROWS.length > MAX_SHOW ? `<span class="pill pill-warning" style="margin-left:8px;">แสดงเฉพาะ ${fmtNum(MAX_SHOW)} รายการแรก</span>` : ''}`;

  renderAdminDataTable(showRows);
}

function placeholderItem(cat, code){
  return { category: cat, code, desc:'(ไม่พบในรายการสินค้า — อาจถูกลบแล้ว)', supplier:'', price:0, uomCount:'', packCount:1,
    subFields: cat === 'NONFRESH' ? ['QTY'] : ['FV','BUT','FISH'] };
}

function renderAdminDataTable(rows){
  const wrapEl = document.getElementById('dataResultWrap');
  const trs = rows.map((row, idx)=>{
    const { month, storeCode, cat, item, rec } = row;
    const total = recordTotal(item, rec);
    const amount = recordAmount(item, rec);
    const fields = item.subFields;
    const fieldVals = fields.map(f=>`<span class="text-soft">${CAT_FIELD_LABELS[f]}:</span> <b class="num">${fmtNum(rec[f]||0,2)}</b>`).join('&nbsp;&nbsp;');
    return `<tr>
      <td class="num nowrap">${thaiMonthLabel(month)}</td>
      <td class="nowrap">${escapeHtml(storeLabel(storeCode))}</td>
      <td><span class="pill pill-info">${CAT_LABELS[cat]}</span></td>
      <td class="desc"><div>${escapeHtml(item.desc)}</div><div class="code">${escapeHtml(item.code)}</div></td>
      <td class="nowrap">${fieldVals}</td>
      <td class="text-right num">${fmtNum(total,2)}</td>
      <td class="text-right num">${fmtMoney(amount)}</td>
      <td class="nowrap">
        <button class="btn btn-secondary btn-sm" data-edit="${idx}">แก้ไข</button>
        <button class="btn btn-danger btn-sm" data-del="${idx}">ลบ</button>
      </td>
    </tr>`;
  }).join('');

  wrapEl.innerHTML = `
    <table class="dtable">
      <thead><tr>
        <th>เดือน</th><th>สาขา</th><th>หมวดหมู่</th><th>รายการสินค้า</th><th>จำนวนที่บันทึก</th><th class="text-right">รวม</th><th class="text-right">มูลค่า</th><th>การจัดการ</th>
      </tr></thead>
      <tbody>${trs}</tbody>
    </table>
  `;

  wrapEl.querySelectorAll('[data-edit]').forEach(b=> b.addEventListener('click', ()=> openEditRecordModal(Number(b.dataset.edit))));
  wrapEl.querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click', ()=> confirmDeleteRecord(Number(b.dataset.del))));
}

function openEditRecordModal(idx){
  const row = ADMIN_DATA_ROWS[idx];
  const { month, storeCode, cat, item, rec } = row;
  const fields = item.subFields;

  const inputsHtml = fields.map(f=>`
    <div class="field">
      <label>${CAT_FIELD_LABELS[f]}</label>
      <input type="number" min="0" step="any" id="editField_${f}" value="${rec[f]!==undefined?rec[f]:0}">
    </div>
  `).join('');

  showModal(`
    <h3>แก้ไขข้อมูลการตรวจนับ</h3>
    <div class="text-soft" style="font-size:13px;margin-bottom:14px;">
      <div><b>เดือน:</b> ${thaiMonthLabel(month)}</div>
      <div><b>สาขา:</b> ${escapeHtml(storeLabel(storeCode))}</div>
      <div><b>รายการ:</b> ${escapeHtml(item.desc)} <span class="code">(${escapeHtml(item.code)})</span></div>
    </div>
    ${inputsHtml}
    <div class="modal-actions">
      <button class="btn btn-secondary" id="editCancelBtn">ยกเลิก</button>
      <button class="btn btn-primary" id="editSaveBtn">บันทึก</button>
    </div>
  `, ()=>{
    document.getElementById('editCancelBtn').addEventListener('click', closeModal);
    document.getElementById('editSaveBtn').addEventListener('click', ()=> saveEditedRecord(idx));
  });
}

async function saveEditedRecord(idx){
  const row = ADMIN_DATA_ROWS[idx];
  const { month, storeCode, cat, item, rec } = row;
  const fields = item.subFields;
  const newRec = {};
  const changes = [];
  const key = month.replace('-','_');

  fields.forEach(f=>{
    const inp = document.getElementById(`editField_${f}`);
    const nv = parseFloat(inp.value) || 0;
    const ov = Number(rec[f]) || 0;
    newRec[f] = nv;
    if(nv !== ov) changes.push({ itemCode:item.code, itemDesc:item.desc, field:f, oldVal:ov, newVal:nv });
  });

  if(changes.length === 0){
    toast('ไม่มีการเปลี่ยนแปลง');
    closeModal();
    return;
  }

  try{
    const updates = {};
    updates[`counts/${key}/${storeCode}/${cat}/${item.code}`] = newRec;
    updates[`counts/${key}/${storeCode}/_meta/updatedAt`] = Date.now();
    updates[`counts/${key}/${storeCode}/_meta/updatedBy`] = `${SESSION.username} (admin)`;
    await dbUpdate(updates);
    await dbPush('logs', {
      ts: Date.now(), month, store: storeCode, storeName: getStoreByCode(storeCode)?.name || storeCode,
      user: SESSION.username, action: 'UPDATE', category: cat, changes
    });

    row.rec = newRec;
    closeModal();
    toast('แก้ไขข้อมูลเรียบร้อย', 'success');
    renderAdminDataTable(ADMIN_DATA_ROWS.slice(0, 1000));
  }catch(err){
    console.error(err);
    toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

function confirmDeleteRecord(idx){
  const row = ADMIN_DATA_ROWS[idx];
  const { month, storeCode, cat, item } = row;
  showModal(`
    <h3>ยืนยันการลบข้อมูล</h3>
    <div class="text-soft" style="font-size:13px;margin-bottom:14px;">
      ต้องการลบข้อมูลตรวจนับของรายการนี้ใช่หรือไม่?<br><br>
      <b>เดือน:</b> ${thaiMonthLabel(month)}<br>
      <b>สาขา:</b> ${escapeHtml(storeLabel(storeCode))}<br>
      <b>รายการ:</b> ${escapeHtml(item.desc)} <span class="code">(${escapeHtml(item.code)})</span>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="delCancelBtn">ยกเลิก</button>
      <button class="btn btn-danger" id="delConfirmBtn">ลบข้อมูล</button>
    </div>
  `, ()=>{
    document.getElementById('delCancelBtn').addEventListener('click', closeModal);
    document.getElementById('delConfirmBtn').addEventListener('click', ()=> deleteRecord(idx));
  });
}

async function deleteRecord(idx){
  const row = ADMIN_DATA_ROWS[idx];
  const { month, storeCode, cat, item, rec } = row;
  const fields = item.subFields;
  const key = month.replace('-','_');
  const changes = fields.map(f=>({ itemCode:item.code, itemDesc:item.desc, field:f, oldVal:Number(rec[f])||0, newVal:0 }));

  try{
    const updates = {};
    updates[`counts/${key}/${storeCode}/${cat}/${item.code}`] = null;
    updates[`counts/${key}/${storeCode}/_meta/updatedAt`] = Date.now();
    updates[`counts/${key}/${storeCode}/_meta/updatedBy`] = `${SESSION.username} (admin)`;
    await dbUpdate(updates);
    await dbPush('logs', {
      ts: Date.now(), month, store: storeCode, storeName: getStoreByCode(storeCode)?.name || storeCode,
      user: SESSION.username, action: 'DELETE', category: cat, changes
    });

    ADMIN_DATA_ROWS.splice(idx, 1);
    closeModal();
    toast('ลบข้อมูลเรียบร้อย', 'success');
    renderAdminDataTable(ADMIN_DATA_ROWS.slice(0, 1000));
  }catch(err){
    console.error(err);
    toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

/* ============================================================
   ITEM MASTER
============================================================ */
let ADMIN_ITEMS_CAT = 'FRESH';

async function renderAdminItems(){
  ADMIN_ITEMS_CAT = 'FRESH'; // รีเซ็ตเสมอ เนื่องจากแสดงเฉพาะ FRESH FOOD
  setTopbar('รายการสินค้า (Item Master)', 'เพิ่ม / แก้ไข / ลบ รายการสินค้าในระบบ');
  const content = document.getElementById('content');

  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">รายการสินค้า</div>
          <div class="muted">รายการที่เพิ่มหรือแก้ไขที่นี่ จะมีผลกับหน้าบันทึกของทุกสาขาทันที</div>
        </div>
        <button class="btn btn-primary" id="addItemBtn">+ เพิ่มรายการสินค้า</button>
      </div>
      <div class="tabs" id="itemCatTabs">
        ${['FRESH'].map(c=>`<div class="tab ${c===ADMIN_ITEMS_CAT?'active':''}" data-cat="${c}">${CAT_LABELS[c]} (${ITEMS_BY_CAT[c].length})</div>`).join('')}
      </div>
      <div class="table-wrap mt-12" id="itemsTableWrap"></div>
    </div>
  `;

  content.querySelectorAll('#itemCatTabs .tab').forEach(t=>{
    t.addEventListener('click', ()=>{
      ADMIN_ITEMS_CAT = t.dataset.cat;
      content.querySelectorAll('#itemCatTabs .tab').forEach(x=> x.classList.toggle('active', x===t));
      renderItemsTable();
    });
  });
  document.getElementById('addItemBtn').addEventListener('click', ()=> openItemModal(null));

  renderItemsTable();
}

function renderItemsTable(){
  const cat = ADMIN_ITEMS_CAT;
  const items = ITEMS_BY_CAT[cat] || [];
  const wrap = document.getElementById('itemsTableWrap');

  const rows = items.map((item, idx)=>`
    <tr>
      <td class="num text-soft">${idx+1}</td>
      <td class="code">${escapeHtml(item.code)}</td>
      <td class="desc">${escapeHtml(item.desc)}</td>
      <td>${escapeHtml(item.supplier||'')}</td>
      <td class="text-right num">${fmtMoney(item.price)}</td>
      <td class="nowrap">${escapeHtml(item.uomRec||'')}</td>
      <td class="text-right num">${fmtNum(item.packRec,2)}</td>
      <td class="nowrap">${escapeHtml(item.uomCount||'')}</td>
      <td class="text-right num">${fmtNum(item.packCount,2)}</td>
      <td class="nowrap">
        <button class="btn btn-secondary btn-sm" data-edit-item="${item.code}">แก้ไข</button>
        <button class="btn btn-danger btn-sm" data-del-item="${item.code}">ลบ</button>
      </td>
    </tr>
  `).join('');

  wrap.innerHTML = `
    <table class="dtable">
      <thead><tr>
        <th>#</th><th>รหัสสินค้า</th><th>รายการสินค้า</th><th>Supplier</th>
        <th class="text-right">ราคา (บาท)</th><th>หน่วยรับ</th><th class="text-right">Pack รับ</th>
        <th>หน่วยตรวจนับ</th><th class="text-right">Pack ตรวจนับ</th><th>การจัดการ</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="10" class="text-center text-soft" style="padding:24px;">ไม่มีรายการ</td></tr>`}</tbody>
    </table>
  `;

  wrap.querySelectorAll('[data-edit-item]').forEach(b=> b.addEventListener('click', ()=> openItemModal(b.dataset.editItem)));
  wrap.querySelectorAll('[data-del-item]').forEach(b=> b.addEventListener('click', ()=> confirmDeleteItem(b.dataset.delItem)));
}

function openItemModal(code){
  const cat = ADMIN_ITEMS_CAT;
  const isEdit = !!code;
  const item = isEdit ? ITEM_MAP[cat][code] : null;

  showModal(`
    <h3>${isEdit ? 'แก้ไขรายการสินค้า' : 'เพิ่มรายการสินค้าใหม่'}</h3>
    <div class="field"><label>หมวดหมู่</label>
      <input type="text" value="${CAT_LABELS[cat]}" disabled>
    </div>
    <div class="field"><label>รหัสสินค้า (Item Code)</label>
      <input type="text" id="itCode" value="${isEdit ? escapeHtml(code) : ''}" ${isEdit?'disabled':''} placeholder="เช่น 0240080001Y">
    </div>
    <div class="field"><label>รายการสินค้า</label>
      <input type="text" id="itDesc" value="${isEdit ? escapeHtml(item.desc) : ''}">
    </div>
    <div class="field"><label>Supplier</label>
      <input type="text" id="itSupplier" value="${isEdit ? escapeHtml(item.supplier||'') : ''}">
    </div>
    <div class="form-row">
      <div class="form-group flex-1"><label>ราคา (บาท)</label>
        <input type="number" step="any" id="itPrice" value="${isEdit ? item.price : 0}"></div>
      <div class="form-group flex-1"><label>หน่วยรับ (UOM รับ)</label>
        <input type="text" id="itUomRec" value="${isEdit ? escapeHtml(item.uomRec||'') : ''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group flex-1"><label>Pack รับ (Unit Pack Rec)</label>
        <input type="number" step="any" id="itPackRec" value="${isEdit ? item.packRec : 1}"></div>
      <div class="form-group flex-1"><label>หน่วยตรวจนับ</label>
        <input type="text" id="itUomCount" value="${isEdit ? escapeHtml(item.uomCount||'') : ''}"></div>
    </div>
    <div class="form-group"><label>Pack ตรวจนับ (Unit Pack Count)</label>
      <input type="number" step="any" id="itPackCount" value="${isEdit ? item.packCount : 1}"></div>

    <div class="modal-actions">
      <button class="btn btn-secondary" id="itCancelBtn">ยกเลิก</button>
      <button class="btn btn-primary" id="itSaveBtn">บันทึก</button>
    </div>
  `, ()=>{
    document.getElementById('itCancelBtn').addEventListener('click', closeModal);
    document.getElementById('itSaveBtn').addEventListener('click', ()=> saveItem(isEdit, code));
  });
}

async function saveItem(isEdit, oldCode){
  const cat = ADMIN_ITEMS_CAT;
  const code = isEdit ? oldCode : document.getElementById('itCode').value.trim();
  const desc = document.getElementById('itDesc').value.trim();

  if(!code || !desc){ toast('กรุณากรอกรหัสสินค้าและชื่อรายการ', 'error'); return; }
  if(!isEdit && ITEM_MAP[cat][code]){ toast('รหัสสินค้านี้มีอยู่แล้วในหมวดนี้', 'error'); return; }

  const newItem = {
    code,
    desc,
    supplier: document.getElementById('itSupplier').value.trim(),
    price: parseFloat(document.getElementById('itPrice').value) || 0,
    uomRec: document.getElementById('itUomRec').value.trim(),
    packRec: parseFloat(document.getElementById('itPackRec').value) || 1,
    uomCount: document.getElementById('itUomCount').value.trim(),
    packCount: parseFloat(document.getElementById('itPackCount').value) || 1,
    subFields: cat === 'NONFRESH' ? ['QTY'] : ['FV','BUT','FISH'],
    no: isEdit ? ITEM_MAP[cat][code].no : (ITEMS_BY_CAT[cat].length ? Math.max(...ITEMS_BY_CAT[cat].map(i=>i.no||0))+1 : 1)
  };

  try{
    await dbSet(`items/${cat}/${code}`, newItem);
    await dbPush('logs', {
      ts: Date.now(), date: todayStr(), store: '-', storeName: '-',
      user: SESSION.username, action: isEdit ? 'ITEM_EDIT' : 'ITEM_ADD',
      category: cat, changes: [{ itemCode: code, itemDesc: desc, field: '-', oldVal: '-', newVal: '-' }]
    });

    if(isEdit){
      const idx = ITEMS_BY_CAT[cat].findIndex(i=>i.code===code);
      ITEMS_BY_CAT[cat][idx] = newItem;
    } else {
      ITEMS_BY_CAT[cat].push(newItem);
    }
    ITEM_MAP[cat][code] = newItem;

    closeModal();
    toast(isEdit ? 'แก้ไขรายการเรียบร้อย' : 'เพิ่มรายการเรียบร้อย', 'success');
    await renderAdminItems();
  }catch(err){
    console.error(err);
    toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

function confirmDeleteItem(code){
  const cat = ADMIN_ITEMS_CAT;
  const item = ITEM_MAP[cat][code];
  showModal(`
    <h3>ยืนยันการลบรายการสินค้า</h3>
    <div class="text-soft" style="font-size:13px;margin-bottom:14px;">
      ต้องการลบ <b>${escapeHtml(item.desc)}</b> (${escapeHtml(code)}) ออกจากรายการสินค้าใช่หรือไม่?<br><br>
      <span class="pill pill-warning">หมายเหตุ: ข้อมูลตรวจนับที่บันทึกไปแล้วในอดีตจะยังคงอยู่ แต่จะไม่แสดงในหน้าบันทึกของสาขาอีกต่อไป</span>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="diCancelBtn">ยกเลิก</button>
      <button class="btn btn-danger" id="diConfirmBtn">ลบรายการ</button>
    </div>
  `, ()=>{
    document.getElementById('diCancelBtn').addEventListener('click', closeModal);
    document.getElementById('diConfirmBtn').addEventListener('click', ()=> deleteItem(code));
  });
}

async function deleteItem(code){
  const cat = ADMIN_ITEMS_CAT;
  const item = ITEM_MAP[cat][code];
  try{
    await dbRemove(`items/${cat}/${code}`);
    await dbPush('logs', {
      ts: Date.now(), date: todayStr(), store: '-', storeName: '-',
      user: SESSION.username, action: 'ITEM_DELETE',
      category: cat, changes: [{ itemCode: code, itemDesc: item.desc, field: '-', oldVal: '-', newVal: '-' }]
    });

    ITEMS_BY_CAT[cat] = ITEMS_BY_CAT[cat].filter(i=>i.code!==code);
    delete ITEM_MAP[cat][code];

    closeModal();
    toast('ลบรายการเรียบร้อย', 'success');
    await renderAdminItems();
  }catch(err){
    console.error(err);
    toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

/* ============================================================
   LOGS
============================================================ */
async function renderAdminLogs(){
  setTopbar('Log การใช้งาน', 'ประวัติการบันทึก / แก้ไข / ลบ ข้อมูล');
  const content = document.getElementById('content');

  const storeOptions = STORES_DATA
    .slice().sort((a,b)=> Number(a.locNo) - Number(b.locNo))
    .map(s=>`<option value="${s.username}">${s.locNo} - ${escapeHtml(s.name)}</option>`).join('');

  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Log การใช้งานระบบ</div>
          <div class="muted">แสดง Log ล่าสุดตามจำนวนที่เลือก สามารถกรองตามสาขาและประเภทการทำงาน</div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group" style="min-width:220px;">
          <label>สาขา</label>
          <select id="logStore">
            <option value="ALL">-- ทุกสาขา --</option>
            <option value="-">-- ระบบ / Admin (รายการสินค้า) --</option>
            ${storeOptions}
          </select>
        </div>
        <div class="form-group">
          <label>ประเภทการทำงาน</label>
          <select id="logAction">
            <option value="ALL">ทั้งหมด</option>
            <option value="SAVE">SAVE (สาขาบันทึก)</option>
            <option value="UPDATE">UPDATE (แก้ไขโดย Admin)</option>
            <option value="DELETE">DELETE (ลบโดย Admin)</option>
            <option value="ITEM_ADD">ITEM_ADD (เพิ่มสินค้า)</option>
            <option value="ITEM_EDIT">ITEM_EDIT (แก้ไขสินค้า)</option>
            <option value="ITEM_DELETE">ITEM_DELETE (ลบสินค้า)</option>
            <option value="BULK_DELETE">BULK_DELETE (ล้างข้อมูลทั้งเดือน)</option>
            <option value="MONTH_ACTIVATE">MONTH_ACTIVATE (เปิดเดือน)</option>
            <option value="MONTH_DEACTIVATE">MONTH_DEACTIVATE (ปิดเดือน)</option>
          </select>
        </div>
        <div class="form-group">
          <label>จำนวน Log ล่าสุด</label>
          <select id="logLimit">
            <option value="200">200 รายการ</option>
            <option value="500">500 รายการ</option>
            <option value="1000">1,000 รายการ</option>
          </select>
        </div>
        <button class="btn btn-primary" id="logSearchBtn">โหลด Log</button>
      </div>
      <div class="mt-12" id="logResultInfo"></div>
      <div class="table-wrap mt-12" id="logResultWrap"></div>
    </div>
  `;

  document.getElementById('logSearchBtn').addEventListener('click', loadLogs);
  await loadLogs();
}

async function loadLogs(){
  const storeFilter = document.getElementById('logStore').value;
  const actionFilter = document.getElementById('logAction').value;
  const limit = parseInt(document.getElementById('logLimit').value, 10) || 200;
  const infoEl = document.getElementById('logResultInfo');
  const wrapEl = document.getElementById('logResultWrap');

  infoEl.innerHTML = '<div class="text-soft">กำลังโหลด...</div>';
  wrapEl.innerHTML = '';

  let data;
  try{
    const snap = await db.ref('logs').orderByChild('ts').limitToLast(limit).once('value');
    data = snap.val() || {};
  }catch(err){
    console.error(err);
    infoEl.innerHTML = `<div class="pill pill-danger">ไม่สามารถโหลด Log ได้ (ตรวจสอบว่าได้ตั้งค่า .indexOn: ["ts"] ใน Database Rules แล้ว) — ${err.message}</div>`;
    return;
  }

  let entries = Object.entries(data).map(([id, v])=>({ id, ...v }));
  if(storeFilter !== 'ALL') entries = entries.filter(e=> e.store === storeFilter);
  if(actionFilter !== 'ALL') entries = entries.filter(e=> e.action === actionFilter);
  entries.sort((a,b)=> (b.ts||0) - (a.ts||0));

  if(entries.length === 0){
    infoEl.innerHTML = '<div class="text-soft">ไม่พบ Log ตามเงื่อนไขที่เลือก</div>';
    return;
  }

  infoEl.innerHTML = `พบ <b class="num">${fmtNum(entries.length)}</b> รายการ`;

  const rows = entries.map(e=>{
    const changeCount = (e.changes||[]).length;
    const detailId = 'log_' + e.id;
    const changesRows = (e.changes||[]).map(c=>`
      <tr>
        <td class="desc"><div>${escapeHtml(c.itemDesc||'')}</div><div class="code">${escapeHtml(c.itemCode||'')}</div></td>
        <td>${escapeHtml(CAT_FIELD_LABELS[c.field] || c.field || '-')}</td>
        <td class="text-right num">${c.oldVal === '-' ? '-' : fmtNum(c.oldVal,2)}</td>
        <td class="text-right num">${c.newVal === '-' ? '-' : fmtNum(c.newVal,2)}</td>
      </tr>
    `).join('');

    return `
      <tr>
        <td class="num nowrap">${fmtDateTime(e.ts)}</td>
        <td class="nowrap">${e.store==='-' ? '-' : escapeHtml(storeLabel(e.store))}</td>
        <td>${escapeHtml(e.user||'-')}</td>
        <td><span class="pill ${logActionPillClass(e.action)}">${e.action}</span></td>
        <td>${e.category ? `<span class="pill pill-muted">${CAT_LABELS[e.category]||e.category}</span>` : '-'}</td>
        <td class="text-center">
          ${changeCount ? `<button class="btn btn-ghost btn-sm" data-toggle="${detailId}">${changeCount} รายการ ▾</button>` : '-'}
        </td>
      </tr>
      ${changeCount ? `
      <tr class="hidden" id="${detailId}">
        <td colspan="6" style="padding:0;">
          <table class="dtable" style="margin:0;">
            <thead><tr><th>รายการสินค้า</th><th>ฟิลด์</th><th class="text-right">ค่าเดิม</th><th class="text-right">ค่าใหม่</th></tr></thead>
            <tbody>${changesRows}</tbody>
          </table>
        </td>
      </tr>` : ''}
    `;
  }).join('');

  wrapEl.innerHTML = `
    <table class="dtable">
      <thead><tr>
        <th>เวลา</th><th>สาขา</th><th>ผู้ใช้งาน</th><th>การทำงาน</th><th>หมวดหมู่</th><th class="text-center">รายละเอียด</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  wrapEl.querySelectorAll('[data-toggle]').forEach(b=>{
    b.addEventListener('click', ()=>{
      document.getElementById(b.dataset.toggle).classList.toggle('hidden');
    });
  });
}

function logActionPillClass(action){
  switch(action){
    case 'SAVE': return 'pill-success';
    case 'UPDATE': return 'pill-info';
    case 'DELETE': return 'pill-danger';
    case 'ITEM_ADD': return 'pill-success';
    case 'ITEM_EDIT': return 'pill-info';
    case 'ITEM_DELETE': return 'pill-danger';
    case 'BULK_DELETE': return 'pill-danger';
    case 'MONTH_ACTIVATE': return 'pill-success';
    case 'MONTH_DEACTIVATE': return 'pill-warning';
    default: return 'pill-muted';
  }
}

/* ============================================================
   EXPORT (ALL BRANCHES)
============================================================ */
async function renderAdminExport(){
  setTopbar('Export ข้อมูล', 'ส่งออกข้อมูลการตรวจนับเป็นไฟล์ Excel (รายเดือน)');
  const content = document.getElementById('content');

  const months = generateMonthRange('2026-06','2030-12');
  const thisMonth = todayStr().slice(0,7);
  const monthOpts = months.map(m=>`<option value="${m}" ${m===thisMonth?'selected':''}>${thaiMonthLabel(m)}</option>`).join('');

  const storeChecks = STORES_DATA
    .slice().sort((a,b)=> Number(a.locNo) - Number(b.locNo))
    .map(s=>`
      <label class="flex items-center gap-8" style="padding:4px 0;font-weight:500;font-size:13px;cursor:pointer;">
        <input type="checkbox" class="exp-store-chk" value="${s.username}" checked>
        ${s.locNo} - ${escapeHtml(s.name)}
      </label>
    `).join('');

  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Export ข้อมูลการตรวจนับรายเดือน</div>
          <div class="muted">เลือกเดือน สาขา และหมวดหมู่ที่ต้องการ Export เป็นไฟล์ Excel (.xlsx)</div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>เดือน</label>
          <select id="expMonth">${monthOpts}</select>
        </div>
        <div class="form-group">
          <label>หมวดหมู่</label>
          <select id="expCat">
            <option value="ALL">ทั้งหมด</option>
            <option value="FRESH">FRESH FOOD</option>
            <option value="TRANSFER">TRANSFER</option>
            <option value="NONFRESH">NON FRESH</option>
          </select>
        </div>
        <button class="btn btn-primary" id="expRunBtn">Export Excel</button>
      </div>

      <div class="mt-16">
        <div class="flex items-center justify-between" style="margin-bottom:8px;">
          <div class="card-title" style="font-size:13px;">เลือกสาขา (${STORES_DATA.length} สาขา)</div>
          <div class="flex gap-8">
            <button class="btn btn-secondary btn-sm" id="expSelectAll">เลือกทั้งหมด</button>
            <button class="btn btn-secondary btn-sm" id="expSelectNone">ไม่เลือกเลย</button>
          </div>
        </div>
        <input type="text" id="expStoreFilter" placeholder="ค้นหาสาขา..." style="width:100%;padding:9px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface-2);margin-bottom:8px;">
        <div id="expStoreList" style="max-height:260px;overflow:auto;border:1px solid var(--border-soft);border-radius:10px;padding:8px 12px;background:var(--surface-2);">
          ${storeChecks}
        </div>
      </div>
    </div>
  `;

  document.getElementById('expSelectAll').addEventListener('click', ()=>{
    content.querySelectorAll('.exp-store-chk').forEach(c=> c.checked = true);
  });
  document.getElementById('expSelectNone').addEventListener('click', ()=>{
    content.querySelectorAll('.exp-store-chk').forEach(c=> c.checked = false);
  });
  document.getElementById('expStoreFilter').addEventListener('input', (e)=>{
    const q = e.target.value.trim().toLowerCase();
    content.querySelectorAll('#expStoreList label').forEach(label=>{
      label.style.display = label.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
  document.getElementById('expRunBtn').addEventListener('click', runAdminExport);
}

async function runAdminExport(){
  const month = document.getElementById('expMonth').value;
  const catFilter = document.getElementById('expCat').value;

  if(!month){ toast('กรุณาเลือกเดือน', 'error'); return; }

  const selectedStores = new Set(
    Array.from(document.querySelectorAll('.exp-store-chk:checked')).map(c=>c.value)
  );
  if(selectedStores.size === 0){ toast('กรุณาเลือกสาขาอย่างน้อย 1 สาขา', 'error'); return; }

  const btn = document.getElementById('expRunBtn');
  setLoading(btn, true, 'กำลัง Export...');

  try{
    const key = month.replace('-','_');
    const rows = [];
    const data = await dbGetOnce(`counts/${key}`);
    if(data){
      Object.entries(data).forEach(([storeCode, rec])=>{
        if(!selectedStores.has(storeCode)) return;
        ['FRESH','TRANSFER','NONFRESH'].forEach(cat=>{
          if(catFilter !== 'ALL' && catFilter !== cat) return;
          const catData = rec[cat];
          if(!catData) return;
          Object.entries(catData).forEach(([itemCode, r])=>{
            const item = ITEM_MAP[cat][itemCode] || placeholderItem(cat, itemCode);
            rows.push(buildExportRow(month, storeCode, cat, item, r));
          });
        });
      });
    }

    if(rows.length === 0){ toast('ไม่พบข้อมูลตามเงื่อนไขที่เลือก', 'error'); return; }

    // สร้าง Summary Sheet
    const summaryMap = {};
    rows.forEach(r=>{
      const skey = r['รหัสผู้ใช้สาขา'] + '|' + r['หมวดหมู่'];
      if(!summaryMap[skey]){
        summaryMap[skey] = {
          'รหัสผู้ใช้สาขา': r['รหัสผู้ใช้สาขา'],
          'เลขที่สาขา (Loc)': r['เลขที่สาขา (Loc)'],
          'ชื่อสาขา': r['ชื่อสาขา'],
          'หมวดหมู่': r['หมวดหมู่'],
          'รวมจำนวนตรวจนับ': 0,
          'มูลค่ารวม (บาท)': 0
        };
      }
      summaryMap[skey]['รวมจำนวนตรวจนับ'] += Number(r['รวมจำนวนตรวจนับ']) || 0;
      summaryMap[skey]['มูลค่ารวม (บาท)'] += Number(r['มูลค่ารวม (บาท)']) || 0;
    });

    const catOrder = { 'FRESH FOOD': 0, 'TRANSFER': 1, 'NON FRESH': 2 };
    const summaryRows = Object.values(summaryMap).sort((a,b)=>{
      const la = Number(a['เลขที่สาขา (Loc)']) || 0;
      const lb = Number(b['เลขที่สาขา (Loc)']) || 0;
      if(la !== lb) return la - lb;
      return (catOrder[a['หมวดหมู่']]||0) - (catOrder[b['หมวดหมู่']]||0);
    });
    summaryRows.forEach(r=>{
      r['รวมจำนวนตรวจนับ'] = Math.round(r['รวมจำนวนตรวจนับ'] * 100) / 100;
      r['มูลค่ารวม (บาท)'] = Math.round(r['มูลค่ารวม (บาท)'] * 100) / 100;
    });
    const grandQty = summaryRows.reduce((s,r)=> s + r['รวมจำนวนตรวจนับ'], 0);
    const grandAmt = summaryRows.reduce((s,r)=> s + r['มูลค่ารวม (บาท)'], 0);
    summaryRows.push({
      'รหัสผู้ใช้สาขา': '', 'เลขที่สาขา (Loc)': '', 'ชื่อสาขา': 'รวมทั้งหมด',
      'หมวดหมู่': '', 'รวมจำนวนตรวจนับ': Math.round(grandQty * 100) / 100,
      'มูลค่ารวม (บาท)': Math.round(grandAmt * 100) / 100
    });

    const filename = `PackagingCount_AllBranches_${month}.xlsx`;
    exportRowsToExcel({ 'สรุปรายสาขา': summaryRows, 'ข้อมูลตรวจนับ': rows }, filename);
    toast(`Export สำเร็จ (${fmtNum(rows.length)} รายการ · ${fmtNum(summaryRows.length - 1)} สาขา/หมวด)`, 'success');
  }catch(err){
    console.error(err);
    toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }finally{
    setLoading(btn, false);
  }
}

/* ============================================================
   CLEAR ALL DATA (BULK DELETE BY MONTH)
============================================================ */
async function renderAdminClearAll(){
  setTopbar('ล้างข้อมูลทั้งหมด', 'ลบข้อมูลการตรวจนับของทุกสาขาในเดือนที่เลือก');
  const content = document.getElementById('content');
  const months = generateMonthRange('2026-06','2030-12');
  const thisMonth = todayStr().slice(0,7);
  const monthOpts = months.map(m=>`<option value="${m}" ${m===thisMonth?'selected':''}>${thaiMonthLabel(m)}</option>`).join('');

  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">ล้างข้อมูลการตรวจนับทั้งหมด (ทุกสาขา)</div>
          <div class="muted">ใช้สำหรับล้างข้อมูลตรวจนับของ <b>ทุกสาขา (${STORES_DATA.length} สาขา)</b> ในเดือนที่เลือกออกทั้งหมด</div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group"><label>เดือนที่ต้องการล้างข้อมูล</label><select id="clearMonth">${monthOpts}</select></div>
        <button class="btn btn-danger" id="clearMonthBtn">ลบข้อมูลทั้งหมดของเดือนนี้</button>
      </div>

      <div class="mt-16">
        <span class="pill pill-danger">⚠ คำเตือน</span>
        <div class="text-soft mt-8" style="font-size:13px; line-height:1.7;">
          การลบข้อมูลนี้จะลบ <b>ข้อมูลการตรวจนับ (FRESH FOOD / TRANSFER / NON FRESH)</b> ของ
          <b>ทุกสาขาทั้งหมด</b> ในเดือนที่เลือก ออกจากระบบอย่างถาวร และ<b>ไม่สามารถกู้คืนได้</b><br>
          &middot; รายการสินค้า (Item Master) จะไม่ได้รับผลกระทบ<br>
          &middot; Log การลบนี้จะถูกบันทึกไว้ในหน้า "Log การใช้งาน"<br>
          &middot; แนะนำให้ Export ข้อมูลของเดือนนั้นเก็บไว้ก่อน (ไปที่เมนู "Export ข้อมูล") หากต้องการสำรองข้อมูล
        </div>
      </div>
    </div>
  `;

  document.getElementById('clearMonthBtn').addEventListener('click', confirmClearMonth);
}

function confirmClearMonth(){
  const month = document.getElementById('clearMonth').value;
  if(!month){ toast('กรุณาเลือกเดือน', 'error'); return; }
  const label = thaiMonthLabel(month);

  showModal(`
    <h3>ยืนยันการล้างข้อมูลทั้งหมด</h3>
    <div class="text-soft" style="font-size:13px;margin-bottom:14px;line-height:1.7;">
      คุณกำลังจะลบข้อมูลการตรวจนับของ <b>ทุกสาขา (${STORES_DATA.length} สาขา)</b>
      ในเดือน <b>${label}</b> ออกทั้งหมด<br><br>
      การลบนี้ <b style="color:var(--danger)">ไม่สามารถย้อนกลับได้</b><br><br>
      กรุณาพิมพ์ <code class="num" style="background:var(--surface-2);padding:2px 6px;border-radius:4px;">${month}</code> ในช่องด้านล่างเพื่อยืนยัน
    </div>
    <div class="field"><input type="text" id="clearConfirmInput" placeholder="พิมพ์ ${month} เพื่อยืนยัน" class="num"></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="clearCancelBtn">ยกเลิก</button>
      <button class="btn btn-danger" id="clearConfirmBtn">ลบข้อมูลทั้งหมดของเดือน ${label}</button>
    </div>
  `, ()=>{
    document.getElementById('clearCancelBtn').addEventListener('click', closeModal);
    document.getElementById('clearConfirmBtn').addEventListener('click', ()=>{
      const val = document.getElementById('clearConfirmInput').value.trim();
      if(val !== month){
        toast('ข้อความยืนยันไม่ถูกต้อง กรุณาพิมพ์ให้ตรงกับเดือนที่เลือก (เช่น 2026-06)', 'error');
        return;
      }
      executeClearMonth(month);
    });
  });
}

async function executeClearMonth(month){
  const btn = document.getElementById('clearConfirmBtn');
  setLoading(btn, true, 'กำลังลบข้อมูล...');
  const key = month.replace('-','_');

  try{
    await dbRemove(`counts/${key}`);
    await dbPush('logs', {
      ts: Date.now(), month, store: '-', storeName: 'ทุกสาขา',
      user: SESSION.username, action: 'BULK_DELETE', category: 'ALL',
      changes: [{ itemCode:'-', itemDesc:`ล้างข้อมูลการตรวจนับทั้งหมดของเดือน ${thaiMonthLabel(month)} (ทุกสาขา ${STORES_DATA.length} สาขา)`, field:'-', oldVal:'-', newVal:'-' }]
    });

    closeModal();
    toast(`ล้างข้อมูลของเดือน ${thaiMonthLabel(month)} เรียบร้อยแล้ว`, 'success');
  }catch(err){
    console.error(err);
    toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    setLoading(btn, false);
  }
}

/* ===== DASHBOARD ===== */
// ============================================================
// dashboard.js — แดชบอร์ดสรุปข้อมูล (ใช้ร่วมกันทั้งหน้าสาขาและ Admin)
// ============================================================

let DASH_MONTH = null;
let DASH_STORE = 'ALL';        // admin เท่านั้น

async function renderDashboardView(){
  const isAdmin = SESSION.role === 'admin';
  setTopbar('แดชบอร์ดสรุปข้อมูล', isAdmin ? 'สรุปมูลค่าการตรวจนับของทุกสาขา / สาขาที่เลือก' : `${SESSION.locNo} - ${SESSION.storeName}`);
  const content = document.getElementById('content');
  const thisMonth = todayStr().slice(0,7);
  const months = generateMonthRange('2026-06','2030-12');
  const monthOpts = months.map(m=>`<option value="${m}" ${(DASH_MONTH||thisMonth)===m?'selected':''}>${thaiMonthLabel(m)}</option>`).join('');

  const storeOptions = isAdmin ? STORES_DATA.slice()
    .sort((a,b)=> Number(a.locNo) - Number(b.locNo))
    .map(s=>`<option value="${s.username}" ${DASH_STORE===s.username?'selected':''}>${s.locNo} - ${escapeHtml(s.name)}</option>`).join('') : '';

  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">แดชบอร์ดสรุปข้อมูลการตรวจนับ</div>
          <div class="muted">${isAdmin ? 'เลือกสาขาและเดือนที่ต้องการดูสรุปมูลค่า Fresh Food' : 'สรุปมูลค่าการตรวจนับ Fresh Food รายเดือน'}</div>
        </div>
      </div>

      <div class="form-row mt-12">
        ${isAdmin ? `
        <div class="form-group" style="min-width:240px;">
          <label>สาขา</label>
          <select id="dashStore">
            <option value="ALL" ${DASH_STORE==='ALL'?'selected':''}>-- ทุกสาขา (รวม ${STORES_DATA.length} สาขา) --</option>
            ${storeOptions}
          </select>
        </div>` : ''}
        <div class="form-group">
          <label>เดือน</label>
          <select id="dashMonth">${monthOpts}</select>
        </div>
        <button class="btn btn-primary" id="dashLoadBtn">แสดงข้อมูล</button>
      </div>

      <div id="dashBody" class="mt-16">
        <div class="text-soft" style="padding:40px;text-align:center;">กำลังโหลดข้อมูล...</div>
      </div>
    </div>
  `;

  document.getElementById('dashLoadBtn').addEventListener('click', loadDashboard);
  await loadDashboard();
}

async function loadDashboard(){
  const isAdmin = SESSION.role === 'admin';
  const bodyEl = document.getElementById('dashBody');
  bodyEl.innerHTML = '<div class="text-soft" style="padding:40px;text-align:center;">กำลังโหลดข้อมูล...</div>';

  DASH_MONTH = document.getElementById('dashMonth')?.value;
  if(!DASH_MONTH){ toast('กรุณาเลือกเดือน', 'error'); return; }

  const storeFilter = isAdmin ? document.getElementById('dashStore').value : SESSION.storeCode;
  DASH_STORE = storeFilter;

  const result = await computeCategorySums(DASH_MONTH, storeFilter, isAdmin);
  renderDashboardResult(result, isAdmin, storeFilter);
}

/**
 * รวมมูลค่าตามหมวดหมู่ (รายเดือน)
 * พร้อมแยกรายชื่อสาขาที่บันทึกแล้ว / ยังไม่บันทึก (ใช้แสดงในแดชบอร์ดแบบ 2 คอลัมน์)
 */
async function computeCategorySums(month, storeFilter, isAdmin){
  const sums = { FRESH:0, TRANSFER:0, NONFRESH:0 };
  const storesSeen = new Set();
  const submittedStores = []; // [{ storeCode, locNo, name, updatedAt, updatedBy }]
  const key = month.replace('-','_');

  if(isAdmin && storeFilter === 'ALL'){
    const data = await dbGetOnce(`counts/${key}`);
    if(data){
      Object.entries(data).forEach(([storeCode, rec])=>{
        let storeHasData = false;
        ['FRESH','TRANSFER','NONFRESH'].forEach(cat=>{
          const catData = rec[cat];
          if(!catData) return;
          storesSeen.add(storeCode);
          storeHasData = true;
          Object.entries(catData).forEach(([code, r])=>{
            const item = ITEM_MAP[cat][code] || placeholderItem(cat, code);
            sums[cat] += recordAmount(item, r);
          });
        });
        if(storeHasData){
          const s = getStoreByCode(storeCode);
          submittedStores.push({
            storeCode,
            locNo: s ? s.locNo : '-',
            name: s ? s.name : storeCode,
            updatedAt: rec._meta ? rec._meta.updatedAt : null,
            updatedBy: rec._meta ? rec._meta.updatedBy : null
          });
        }
      });
    }
  } else {
    const storeCode = storeFilter;
    const data = await dbGetOnce(`counts/${key}/${storeCode}`);
    if(data){
      ['FRESH','TRANSFER','NONFRESH'].forEach(cat=>{
        const catData = data[cat];
        if(!catData) return;
        storesSeen.add(storeCode);
        Object.entries(catData).forEach(([code, r])=>{
          const item = ITEM_MAP[cat][code] || placeholderItem(cat, code);
          sums[cat] += recordAmount(item, r);
        });
      });
    }
  }

  // ── สร้างรายชื่อสาขาที่ "ยังไม่บันทึก" จาก STORES_DATA ทั้งหมด หักลบสาขาที่บันทึกแล้ว ──
  let notSubmittedStores = [];
  if(isAdmin && storeFilter === 'ALL'){
    const submittedCodes = new Set(submittedStores.map(s=> s.storeCode));
    notSubmittedStores = STORES_DATA
      .filter(s=> !submittedCodes.has(s.username))
      .map(s=> ({ storeCode: s.username, locNo: s.locNo, name: s.name }));
  }

  // เรียงตาม locNo ทั้งสองฝั่งเพื่อให้ดูง่าย
  submittedStores.sort((a,b)=> (Number(a.locNo)||9999) - (Number(b.locNo)||9999));
  notSubmittedStores.sort((a,b)=> (Number(a.locNo)||9999) - (Number(b.locNo)||9999));

  return { sums, storeCount: storesSeen.size, submittedStores, notSubmittedStores };
}

function renderDashboardResult(result, isAdmin, storeFilter){
  const bodyEl = document.getElementById('dashBody');
  const { sums, storeCount, submittedStores, notSubmittedStores } = result;
  const freshValue = sums.FRESH;
  const showStoreBreakdown = isAdmin && storeFilter === 'ALL';

  if(freshValue === 0 && !showStoreBreakdown){
    bodyEl.innerHTML = `
      <div style="padding:56px 24px;text-align:center;">
        <div style="font-size:48px;margin-bottom:12px;">📦</div>
        <div style="font-size:15px;font-weight:700;color:var(--text-soft);">ไม่พบข้อมูลการตรวจนับในเดือนที่เลือก</div>
        <div style="font-size:12.5px;color:var(--text-faint);margin-top:6px;">ลองเปลี่ยนเดือนหรือเลือกสาขาอื่น</div>
      </div>`;
    return;
  }

  let extraInfo = '';
  if(showStoreBreakdown){
    extraInfo = `สาขาที่มีข้อมูล <b class="num">${fmtNum(storeCount)}</b> / ${fmtNum(STORES_DATA.length)} สาขา`;
  } else {
    const label = isAdmin ? escapeHtml(storeLabel(storeFilter)) : `${SESSION.locNo} - ${SESSION.storeName}`;
    extraInfo = `สาขา <b>${label}</b>`;
  }

  const freshColor = CAT_COLORS.FRESH || '#1A9E6B';

  const heroSection = freshValue > 0 ? `
    <!-- Hero KPI Card -->
    <div class="dash-hero-wrap">
      <div class="dash-hero-card">
        <div class="dash-hero-icon">🥩</div>
        <div class="dash-hero-content">
          <div class="dash-hero-label">มูลค่า FRESH FOOD รวม — ${thaiMonthLabel(DASH_MONTH)}</div>
          <div class="dash-hero-value num">${fmtMoney(freshValue)}</div>
          <div class="dash-hero-unit">บาท</div>
        </div>
        <div class="dash-hero-badge">FRESH FOOD</div>
      </div>
    </div>` : '';

  // ── ส่วนแบ่งซ้าย-ขวา: สาขาที่ยังไม่บันทึก / บันทึกแล้ว (เฉพาะ admin + เลือกทุกสาขา) ──
  const storeBreakdownSection = showStoreBreakdown ? `
    <div class="card mt-16" style="padding:0;overflow:hidden;">
      <div class="card-head" style="padding:18px 20px 0;">
        <div>
          <div class="card-title">สถานะการบันทึกข้อมูลรายสาขา — ${thaiMonthLabel(DASH_MONTH)}</div>
          <div class="muted">แบ่งสาขาตามสถานะ เพื่อให้ติดตามสาขาที่ยังไม่บันทึกได้ง่ายขึ้น</div>
        </div>
      </div>
      <div class="dash-split-wrap">
        <div class="dash-split-col dash-split-pending">
          <div class="dash-split-head">
            <span class="dash-split-dot" style="background:var(--danger);"></span>
            ยังไม่บันทึกข้อมูล
            <span class="pill pill-danger" style="margin-left:auto;">${fmtNum(notSubmittedStores.length)} สาขา</span>
          </div>
          <div class="dash-split-list">
            ${notSubmittedStores.length === 0
              ? `<div class="dash-split-empty">✅ ทุกสาขาบันทึกข้อมูลครบแล้ว</div>`
              : notSubmittedStores.map(s=>`
                <div class="dash-split-item">
                  <span class="dash-split-loc">${escapeHtml(s.locNo)}</span>
                  <span class="dash-split-name">${escapeHtml(s.name)}</span>
                </div>`).join('')}
          </div>
        </div>
        <div class="dash-split-col dash-split-done">
          <div class="dash-split-head">
            <span class="dash-split-dot" style="background:var(--success);"></span>
            บันทึกข้อมูลแล้ว
            <span class="pill pill-success" style="margin-left:auto;">${fmtNum(submittedStores.length)} สาขา</span>
          </div>
          <div class="dash-split-list">
            ${submittedStores.length === 0
              ? `<div class="dash-split-empty">ยังไม่มีสาขาบันทึกข้อมูลในเดือนนี้</div>`
              : submittedStores.map(s=>`
                <div class="dash-split-item">
                  <span class="dash-split-loc">${escapeHtml(s.locNo)}</span>
                  <span class="dash-split-name">${escapeHtml(s.name)}</span>
                  <span class="dash-split-time">${s.updatedAt ? fmtDateTime(s.updatedAt) : ''}</span>
                </div>`).join('')}
          </div>
        </div>
      </div>
    </div>` : '';

  bodyEl.innerHTML = `
    ${heroSection}

    <!-- KPI Row -->
    <div class="dash-kpi-row">
      ${showStoreBreakdown ? `
      <div class="dash-kpi-card">
        <div class="dash-kpi-icon">🏪</div>
        <div class="dash-kpi-body">
          <div class="dash-kpi-label">สาขาที่มีข้อมูล</div>
          <div class="dash-kpi-value num">${fmtNum(storeCount)} <span class="dash-kpi-unit">/ ${fmtNum(STORES_DATA.length)} สาขา</span></div>
        </div>
      </div>` : ''}
    </div>

    <!-- Progress Visual -->
    <div class="dash-progress-card">
      <div class="dash-progress-head">
        <div>
          <div class="dash-progress-title">ข้อมูลสรุปเดือน ${thaiMonthLabel(DASH_MONTH)}</div>
          <div class="dash-progress-sub">${extraInfo}</div>
        </div>
        <div class="dash-progress-pct num">${showStoreBreakdown ? Math.round(storeCount/STORES_DATA.length*100) : 100}%</div>
      </div>
      <div class="dash-progress-bar-wrap">
        <div class="dash-progress-bar-track">
          <div class="dash-progress-bar-fill" style="width:${showStoreBreakdown ? (storeCount/STORES_DATA.length*100).toFixed(1) : 100}%;background:${freshColor};"></div>
        </div>
      </div>
    </div>

    ${storeBreakdownSection}
  `;
}

/* ===== APP BOOTSTRAP ===== */
// ============================================================
// app.js — Bootstrap, Sidebar, Navigation, Routing
// ============================================================

let ITEMS_BY_CAT = { FRESH: [], TRANSFER: [], NONFRESH: [] };
let ITEM_MAP = { FRESH: {}, TRANSFER: {}, NONFRESH: {} };
let CURRENT_VIEW = null;

const STORE_NAV = [
  { id:'dashboard', label:'แดชบอร์ด',            icon:'📊' },
  { id:'entry',   label:'บันทึกการตรวจนับ',     icon:'📝' },
  { id:'history', label:'ประวัติ / Export Excel', icon:'🗂️' },
];
const ADMIN_NAV = [
  { id:'dashboard', label:'แดชบอร์ด',            icon:'📊' },
  { id:'overview', label:'ภาพรวมระบบ',         icon:'📈' },
  { id:'online',   label:'ผู้ใช้งานออนไลน์',     icon:'🟢' },
  { id:'data',     label:'ข้อมูลการตรวจนับ',     icon:'🧾' },
  { id:'items',    label:'รายการสินค้า',         icon:'📦' },
  { id:'months',   label:'จัดการเดือนที่เปิด/ปิด', icon:'📅' },
  { id:'logs',     label:'Log การใช้งาน',         icon:'📜' },
  { id:'export',   label:'Export ข้อมูล (ทุกสาขา)', icon:'📤' },
  { id:'clear',    label:'ล้างข้อมูลทั้งหมด',     icon:'🗑️' },
];

document.addEventListener('DOMContentLoaded', ()=>{
  initLoginForm();

  // Set Makro logo image (embedded as data URI in data.js)
  document.querySelectorAll('.brand-logo').forEach(img=>{
    img.src = MAKRO_LOGO_DATA_URI;
  });

  // Mobile sidebar toggle
  document.getElementById('menuToggle').addEventListener('click', ()=>{
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarBackdrop').classList.add('show');
  });
  document.getElementById('sidebarBackdrop').addEventListener('click', closeSidebar);

  const restored = restoreSession();
  if(restored){
    SESSION = restored;
    startApp();
  }
});

function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('show');
}

/* ============================================================
   START APP
============================================================ */
async function startApp(){
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // Sidebar header info
  if(SESSION.role === 'store'){
    document.getElementById('sbStoreName').textContent = `${SESSION.locNo} - ${SESSION.storeName}`;
    document.getElementById('sbRole').textContent = 'บัญชีสาขา (Store)';
  } else {
    document.getElementById('sbStoreName').textContent = SESSION.name || 'ผู้ดูแลระบบ';
    document.getElementById('sbRole').textContent = 'ผู้ดูแลระบบ (Admin)';
  }

  renderSidebar();

  // เริ่มติดตามสถานะ online ของ session นี้ (สำหรับให้ admin ตรวจสอบได้)
  startPresenceTracking();

  // Step 1: โหลด items จาก embedded data ทันที (synchronous)
  ensureItemsSeeded();

  // Step 2: โหลด months active cache (1 round-trip สำหรับ active status ทั้งหมด)
  await loadMonthsCache();

  // Step 3: sync Firebase items ใน background (ไม่ block UI)
  loadItemsFromDB().catch(e=> console.warn('[startApp] Firebase items sync error:', e.message));

  const totalItems = (ITEMS_BY_CAT.FRESH||[]).length;
  toast(totalItems > 0 ? `พร้อมใช้งาน — สินค้า ${totalItems} รายการ` : 'โหลดข้อมูลสินค้า...', totalItems > 0 ? 'success' : 'default');

  navigateTo('dashboard');
}

/* ============================================================
   ITEM MASTER: seed + load
============================================================ */
function ensureItemsSeeded(){
  // Step 1: โหลด embedded ITEMS_DATA ลง memory ทันที (synchronous, ไม่รอ Firebase เลย)
  if(typeof ITEMS_DATA === 'undefined' || ITEMS_DATA.length === 0){
    console.error('[ensureItemsSeeded] ITEMS_DATA not found!');
    return;
  }
  const counters = { FRESH:0, TRANSFER:0, NONFRESH:0 };
  ITEMS_BY_CAT = { FRESH:[], TRANSFER:[], NONFRESH:[] };
  ITEM_MAP = { FRESH:{}, TRANSFER:{}, NONFRESH:{} };
  ITEMS_DATA.forEach(item=>{
    counters[item.category] = (counters[item.category]||0) + 1;
    const it = { ...item, no: counters[item.category] };
    ITEMS_BY_CAT[item.category].push(it);
    ITEM_MAP[item.category][item.code] = it;
  });
  console.log('[ensureItemsSeeded] Loaded', ITEMS_DATA.length, 'items from embedded data instantly');

  // Step 2: Seed to Firebase in background — เพิ่ม random jitter เพื่อกระจาย load
  // เมื่อหลายสาขา login พร้อมกัน แต่ละ client จะ seed คนละเวลา ลด Firebase write contention
  const jitter = 2000 + Math.floor(Math.random() * 3000); // 2–5 วิ แบบสุ่ม
  setTimeout(async ()=>{
    try{
      const existing = await dbGetOnce('items');
      // ถ้ามีข้อมูลแล้ว (ไม่ว่าจะมีแค่ FRESH เดียวก็ถือว่า seed แล้ว) ให้ skip
      if(existing && (existing.FRESH || existing.TRANSFER || existing.NONFRESH)){
        const total = Object.values(existing).reduce((s,cat)=> s + Object.keys(cat||{}).length, 0);
        if(total > 0){
          console.log('[ensureItemsSeeded] Firebase already has items — skip seed');
          return;
        }
      }
      // Double-check: อ่านอีกครั้งก่อน write เพื่อป้องกัน race condition
      // (สาขาอื่นอาจ seed ไปในระหว่างที่เรารอ jitter)
      await new Promise(r => setTimeout(r, 200));
      const recheck = await dbGetOnce('items');
      if(recheck && (recheck.FRESH || recheck.TRANSFER || recheck.NONFRESH)){
        const total2 = Object.values(recheck).reduce((s,cat)=> s + Object.keys(cat||{}).length, 0);
        if(total2 > 0){
          console.log('[ensureItemsSeeded] Race condition detected — items already seeded by another client, skip');
          return;
        }
      }
      const updates = {};
      let c2 = { FRESH:0, TRANSFER:0, NONFRESH:0 };
      ITEMS_DATA.forEach(item=>{
        c2[item.category] = (c2[item.category]||0) + 1;
        updates['items/' + item.category + '/' + item.code] = {
          code: item.code, desc: item.desc, supplier: item.supplier,
          price: item.price, uomRec: item.uomRec, packRec: item.packRec,
          uomCount: item.uomCount, packCount: item.packCount,
          subFields: item.subFields, no: c2[item.category]
        };
      });
      await dbUpdate(updates);
      console.log('[ensureItemsSeeded] Seeded', ITEMS_DATA.length, 'items to Firebase');
    }catch(e){
      console.warn('[ensureItemsSeeded] Firebase seed error (non-fatal):', e.message);
    }
  }, jitter); // random jitter 2–5 วิ เพื่อกระจาย concurrent seed requests
}

async function loadItemsFromDB(){
  // Merge Firebase items on top of embedded data
  // Firebase items take priority (admin may have edited them)
  try{
    const data = await dbGetOnce('items') || {};
    let firebaseCount = 0;
    ['FRESH','TRANSFER','NONFRESH'].forEach(cat=>{
      const obj = data[cat] || {};
      const arr = Object.values(obj);
      if(arr.length > 0){
        arr.sort((a,b)=> (a.no||0) - (b.no||0));
        ITEMS_BY_CAT[cat] = arr;
        ITEM_MAP[cat] = {};
        arr.forEach(it=> ITEM_MAP[cat][it.code] = it);
        firebaseCount += arr.length;
      }
    });
    if(firebaseCount > 0){
      console.log('[loadItemsFromDB] Firebase items loaded:', firebaseCount);
    }
  }catch(e){
    console.warn('[loadItemsFromDB] Firebase error (keeping embedded data):', e.message);
  }
}
/* ============================================================
   SIDEBAR / NAV
============================================================ */
function renderSidebar(){
  const nav = SESSION.role === 'store' ? STORE_NAV : ADMIN_NAV;
  const container = document.getElementById('sidebarNav');
  container.innerHTML = nav.map(item=>`
    <div class="nav-item" data-view="${item.id}">
      <span class="ico">${item.icon}</span>
      <span>${item.label}</span>
    </div>
  `).join('');
  container.querySelectorAll('.nav-item').forEach(el=>{
    el.addEventListener('click', ()=>{
      navigateTo(el.dataset.view);
      closeSidebar();
    });
  });
}

function setActiveNav(viewId){
  document.querySelectorAll('#sidebarNav .nav-item').forEach(el=>{
    el.classList.toggle('active', el.dataset.view === viewId);
  });
}

function setTopbar(title, sub){
  document.getElementById('topbarTitle').textContent = title;
  document.getElementById('topbarSub').textContent = sub || '';
}

/* ============================================================
   ROUTER
============================================================ */
function navigateTo(viewId){
  // ── cleanup listener ของหน้า "ผู้ใช้งานออนไลน์" เมื่อออกจากหน้านั้น ──
  // ป้องกัน listener ค้างทำงานเปลือง bandwidth/ทรัพยากรเมื่อสลับไปหน้าอื่น
  if(CURRENT_VIEW === 'online' && viewId !== 'online' && ONLINE_USERS_REF){
    try{ ONLINE_USERS_REF.off(); }catch(e){}
    ONLINE_USERS_REF = null;
  }

  CURRENT_VIEW = viewId;
  setActiveNav(viewId);

  switch(viewId){
    // Shared
    case 'dashboard': return renderDashboardView();

    // Store views
    case 'entry':   return renderEntryView();
    case 'history': return renderHistoryView();

    // Admin views
    case 'overview': return renderAdminOverview();
    case 'online':   return renderAdminOnlineUsers();
    case 'data':     return renderAdminData();
    case 'items':    return renderAdminItems();
    case 'months':   return renderAdminMonths();
    case 'logs':     return renderAdminLogs();
    case 'export':   return renderAdminExport();
    case 'clear':    return renderAdminClearAll();

    default:
      document.getElementById('content').innerHTML = '<div class="card">ไม่พบหน้านี้</div>';
  }
}