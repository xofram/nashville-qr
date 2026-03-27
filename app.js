'use strict';
/* ============================================================
   NASHVILLE — APP.JS v5
   Estados: loading → coupon | returning | cooldown | error
   Storage key: nash_v2
   Admin: ?admin=1 saltea cooldown
   Log: solo al tocar WhatsApp
============================================================ */

var CFG = {
  SCRIPT:   'https://script.google.com/macros/s/AKfycbwpidh1tETWntQFplSNmdbCy7KAFSlrtBF_O3TnTkezzPIBcbpooNvsQDVRoORuijxwgg/exec',
  WA:       '5493517886903',
  EXPIRY_H: 72,
  COOL_MIN: 10080, /* 7 días = 7 × 24 × 60 min */
  GEO_MS:   3500,
  LOAD_MS:  950,
  KEY:      'nash_v2',
  CHARS:    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
};

/* ── STORAGE ─────────────────────────────────────────────────
   Todas las operaciones de localStorage pasan por aquí.
   Si localStorage no está disponible, nunca lanza.
──────────────────────────────────────────────────────────── */
var Store = {
  get: function() {
    try {
      var r = localStorage.getItem(CFG.KEY);
      if (!r) return null;
      var p = JSON.parse(r);
      if (!p || !p.coupon || !p.generatedAt) return null;
      return p;
    } catch(e) { return null; }
  },
  set: function(data) {
    try { localStorage.setItem(CFG.KEY, JSON.stringify(data)); return true; }
    catch(e) { return false; }
  },
  patch: function(key, val) {
    try {
      var d = this.get();
      if (!d) return false;
      d[key] = val;
      return this.set(d);
    } catch(e) { return false; }
  },
  clear: function() {
    try { localStorage.removeItem(CFG.KEY); } catch(e) {}
  }
};

/* ── HELPERS ─────────────────────────────────────────────────*/
function isAdmin() {
  try { return new URLSearchParams(location.search).get('admin') === '1'; }
  catch(e) { return false; }
}

function getTipo() {
  try { return new URLSearchParams(location.search).get('tipo') || 'desconocido'; }
  catch(e) { return 'desconocido'; }
}

function pad(n) { return String(n).padStart(2,'0'); }

function fmt(ts) {
  if (!ts) return '—';
  var d = new Date(ts);
  return pad(d.getDate()) + '/' + pad(d.getMonth()+1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + 'hs';
}

function genCode() {
  var c = 'NASH-';
  for (var i=0; i<4; i++) c += CFG.CHARS[Math.floor(Math.random()*CFG.CHARS.length)];
  return c;
}

function waUrl(code) {
  var msg = [
    '¡Hola Nashville! 🍔 Vi su poster por el barrio y no pude resistirme.',
    'Quiero canjear mi cupón del 5% OFF.',
    'Mi código es: *' + code + '*',
    '¿Cuándo puedo hacer mi pedido?',
  ].join('\n');
  return 'https://wa.me/' + CFG.WA + '?text=' + encodeURIComponent(msg);
}

/* ── GEO ─────────────────────────────────────────────────────*/
function getGeo() {
  return new Promise(function(resolve) {
    var settled = false;
    var done = function(v) { if (!settled) { settled=true; resolve(v||{}); } };
    setTimeout(function() { done({}); }, CFG.GEO_MS);
    fetch('https://ipapi.co/json/')
      .then(function(r){ return r.ok ? r.json() : Promise.reject(); })
      .then(function(d){ done(d.error ? {} : { lat:d.latitude||'', lon:d.longitude||'', city:d.city||'', region:d.region||'' }); })
      .catch(function(){ done({}); });
  });
}

/* ── LOG → SHEET ─────────────────────────────────────────────*/
function logSheet(code, tipo, geo) {
  if (!CFG.SCRIPT || CFG.SCRIPT.indexOf('TU_APPS') !== -1) return;
  var p = new URLSearchParams({
    coupon: code, tipo: tipo,
    lat: geo.lat||'', lon: geo.lon||'',
    city: geo.city||'', region: geo.region||'',
  });
  fetch(CFG.SCRIPT + '?' + p, { mode:'no-cors' }).catch(function(){});
}

/* ── COPIAR ──────────────────────────────────────────────────*/
function doCopy(text, btn, labelEl, def) {
  function ok() {
    btn.classList.add('copied');
    labelEl.textContent = '¡Copiado!';
    setTimeout(function(){ btn.classList.remove('copied'); labelEl.textContent = def; }, 2400);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(ok).catch(function(){ fallback(text, ok); });
  } else { fallback(text, ok); }
}

function fallback(text, cb) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); cb(); } catch(e){}
  document.body.removeChild(ta);
}

/* ── MÁQUINA DE PANTALLAS ────────────────────────────────────
   Usa display:none via clase .off — simple y confiable.
   No depende de classList en elementos null.
──────────────────────────────────────────────────────────── */
function show(id) {
  /* Ocultar todas */
  var screens = document.querySelectorAll('.screen');
  for (var i=0; i<screens.length; i++) {
    screens[i].classList.add('off');
    screens[i].classList.remove('enter');
  }
  /* Mostrar la pedida */
  var el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('off');
  void el.offsetWidth; /* forzar reflow para animación */
  el.classList.add('enter');
}

/* ── TIMERS ──────────────────────────────────────────────────*/
function startCouponTimer(expiresAt) {
  var H = document.getElementById('cdH');
  var M = document.getElementById('cdM');
  var S = document.getElementById('cdS');
  (function tick(){
    var rem = Math.max(0, expiresAt - Date.now());
    var t   = Math.floor(rem/1000);
    H.textContent = pad(Math.floor(t/3600));
    M.textContent = pad(Math.floor((t%3600)/60));
    S.textContent = pad(t%60);
    if (rem > 0) setTimeout(tick, 1000);
  })();
}

function startCoolTimer(endAt) {
  var el = document.getElementById('cdTimer');
  (function tick(){
    var rem = Math.max(0, endAt - Date.now());
    var t   = Math.floor(rem/1000);
    var d   = Math.floor(t / 86400);
    var h   = Math.floor((t % 86400) / 3600);
    var m   = Math.floor((t % 3600) / 60);
    var s   = t % 60;
    /* Si quedan más de 1 día mostrar "Xd Yh", si no MM:SS */
    if (d > 0) {
      el.textContent = d + 'd ' + pad(h) + 'h';
    } else if (h > 0) {
      el.textContent = pad(h) + ':' + pad(m) + 'h';
    } else {
      el.textContent = pad(m) + ':' + pad(s);
    }
    if (rem <= 0) { location.reload(); }
    else setTimeout(tick, 1000);
  })();
}

/* ── ESTADOS ─────────────────────────────────────────────────*/

function stateCoupon(tipo, geoP) {
  var code  = genCode();
  var now   = Date.now();
  var exp   = now + CFG.EXPIRY_H * 3600000;

  Store.set({ coupon:code, generatedAt:now, expiresAt:exp, redeemedAt:null, tipo:tipo });

  document.getElementById('couponCode').textContent = code;
  document.getElementById('waBtn').href = waUrl(code);

  /* Log solo al tocar WA */
  var logged = false;
  document.getElementById('waBtn').addEventListener('click', function(){
    if (logged) return;
    logged = true;
    Store.patch('redeemedAt', Date.now());
    geoP.then(function(geo){ logSheet(code, tipo, geo); });
  });

  /* Copiar */
  var cb = document.getElementById('copyBtn');
  var cl = document.getElementById('copyLabel');
  cb.addEventListener('click', function(){ doCopy(code, cb, cl, 'Copiar'); });

  startCouponTimer(exp);
  show('s-coupon');
}

function stateReturning(rec) {
  document.getElementById('retCode').textContent   = rec.coupon;
  document.getElementById('retDate').textContent   = fmt(rec.generatedAt);
  document.getElementById('retExpiry').textContent = fmt(rec.expiresAt);
  document.getElementById('retStatus').textContent = rec.redeemedAt ? 'Canjeado ✓' : 'Pendiente';

  var cb = document.getElementById('retCopyBtn');
  var cl = document.getElementById('retCopyLabel');
  cb.addEventListener('click', function(){ doCopy(rec.coupon, cb, cl, 'Copiar código'); });

  var wb = document.getElementById('retWaBtn');
  wb.href = waUrl(rec.coupon);
  wb.addEventListener('click', function(){
    if (!rec.redeemedAt) Store.patch('redeemedAt', Date.now());
  });

  show('s-returning');
}

function stateCooldown(rec, remMs) {
  document.getElementById('cdCode').textContent = rec.coupon;
  document.getElementById('cdWaBtn').href       = waUrl(rec.coupon);
  startCoolTimer(Date.now() + remMs);
  show('s-cooldown');
}

/* ── INIT ────────────────────────────────────────────────────*/
function init() {
  var t0    = Date.now();
  var tipo  = getTipo();
  var rec   = Store.get();
  var geoP  = getGeo(); /* arranca en paralelo siempre */

  /* Resolver estado */
  var state = 'coupon';
  var remMs = 0;

  if (rec) {
    /* Cupón expirado → tratar como primera vez */
    if (rec.expiresAt && Date.now() > rec.expiresAt) {
      Store.clear();
      rec = null;
    } else {
      /* Cooldown activo? */
      if (!isAdmin()) {
        remMs = Math.max(0, (rec.generatedAt + CFG.COOL_MIN*60000) - Date.now());
      }
      state = remMs > 0 ? 'cooldown' : 'returning';
    }
  }

  /* Esperar loader mínimo, luego mostrar estado */
  var wait = Math.max(0, CFG.LOAD_MS - (Date.now() - t0));
  setTimeout(function(){
    try {
      if (state === 'cooldown')   { stateCooldown(rec, remMs); }
      else if (state === 'returning') { stateReturning(rec); }
      else { stateCoupon(tipo, geoP); }
    } catch(e) {
      console.error('[Nashville]', e);
      show('s-error');
    }
  }, wait);
}

/* ── ARRANCAR ────────────────────────────────────────────────*/
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
