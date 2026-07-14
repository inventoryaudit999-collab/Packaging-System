// ============================================================
//  firebase.js — Firebase Realtime Database config + helpers
//  Makro Packaging Count System | CP Axtra – Store Operations
// ============================================================
'use strict';

// ─── Firebase Config ─────────────────────────────────────────
// แก้ค่าด้านล่างให้ตรงกับ Firebase project ของคุณ
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",   // ← ใส่ apiKey จริง
  authDomain:        "makro-packaging-count.firebaseapp.com",
  databaseURL:       "https://makro-packaging-count-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "makro-packaging-count",
  storageBucket:     "makro-packaging-count.appspot.com",
  messagingSenderId: "000000000000",
  appId:             "1:000000000000:web:xxxxxxxxxxxxxxxxxxxx"
};

// ─── Init Firebase ───────────────────────────────────────────
let _db = null;

function initFirebase() {
  try {
    if (typeof firebase === 'undefined') {
      console.warn('[firebase.js] Firebase SDK not loaded — running in offline mode');
      return false;
    }
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    _db = firebase.database();
    console.log('[firebase.js] Firebase initialized ✅');
    return true;
  } catch (e) {
    console.error('[firebase.js] Firebase init failed:', e);
    return false;
  }
}

// ─── DB Reference Helper ─────────────────────────────────────
function dbRef(path) {
  if (!_db) {
    console.warn('[firebase.js] DB not ready, path:', path);
    return null;
  }
  return _db.ref(path);
}

// ─── Write helpers ────────────────────────────────────────────
function dbSet(path, value) {
  const ref = dbRef(path);
  if (!ref) return Promise.resolve(null);
  return ref.set(value);
}

function dbUpdate(path, value) {
  const ref = dbRef(path);
  if (!ref) return Promise.resolve(null);
  return ref.update(value);
}

function dbPush(path, value) {
  const ref = dbRef(path);
  if (!ref) return Promise.resolve({ key: 'local_' + Date.now() });
  return ref.push(value);
}

// ─── Read helpers ─────────────────────────────────────────────
function dbGet(path) {
  const ref = dbRef(path);
  if (!ref) return Promise.resolve(null);
  return ref.get().then(snap => snap.exists() ? snap.val() : null);
}

function dbOnce(path, callback) {
  const ref = dbRef(path);
  if (!ref) { callback(null); return; }
  ref.once('value', snap => callback(snap.exists() ? snap.val() : null));
}

function dbListen(path, callback) {
  const ref = dbRef(path);
  if (!ref) return () => {};
  ref.on('value', snap => callback(snap.exists() ? snap.val() : null));
  return () => ref.off('value');
}

function dbRemove(path) {
  const ref = dbRef(path);
  if (!ref) return Promise.resolve();
  return ref.remove();
}

// ─── Timestamp helper ─────────────────────────────────────────
function dbTimestamp() {
  if (_db && firebase.database.ServerValue) {
    return firebase.database.ServerValue.TIMESTAMP;
  }
  return Date.now();
}

// ─── Auto-init on load ────────────────────────────────────────
initFirebase();

// ─── Exports (global) ─────────────────────────────────────────
window.DB = {
  ref:       dbRef,
  set:       dbSet,
  update:    dbUpdate,
  push:      dbPush,
  get:       dbGet,
  once:      dbOnce,
  listen:    dbListen,
  remove:    dbRemove,
  timestamp: dbTimestamp,
  isReady:   () => _db !== null
};
