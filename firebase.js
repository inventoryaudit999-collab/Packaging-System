/* ============================================================
   firebase.js — Firebase Configuration & Database Helpers
   CP Axtra Makro Packaging Count System
============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyDYSCqX52ubME3P3rfO7bcqg0TTfUVvWNc",
  authDomain: "packing-cost.firebaseapp.com",
  databaseURL: "https://packing-cost-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "packing-cost",
  storageBucket: "packing-cost.firebasestorage.app",
  messagingSenderId: "384560968075",
  appId: "1:384560968075:web:f66bee0746bada60a5bf8e"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

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
