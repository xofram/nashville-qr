/* ============================================================
   NASHVILLE — APP.JS v3
   Flujo: cooldown check → loader → cupón → [click WA] → log
   ============================================================ */

// ── CONFIG ───────────────────────────────────────────────────
const CONFIG = {
  SCRIPT_URL:    'https://script.google.com/macros/s/AKfycbwpidh1tETWntQFplSNmdbCy7KAFSlrtBF_O3TnTkezzPIBcbpooNvsQDVRoORuijxwgg/exec',
  WA_NUMBER:     '5493517886903',
  COUPON_EXPIRY: 72,    // horas de validez del cupón
  COOLDOWN_MIN:  15,    // minutos entre generaciones
  GEO_TIMEOUT:   3000,  // ms máximo para esperar geo
  STORAGE_KEY:   'nash_last_gen',
};
// ─────────────────────────────────────────────────────────────

// ── COOLDOWN ─────────────────────────────────────────────────

function getCooldownState() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCooldownState(coupon) {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
      coupon,
      generatedAt: Date.now(),
    }));
  } catch { /* localStorage bloqueado → ignorar */ }
}

function getRemainingCooldownMs() {
  const state = getCooldownState();
  if (!state) return 0;
  const windowMs  = CONFIG.COOLDOWN_MIN * 60 * 1000;
  const remaining = windowMs - (Date.now() - state.generatedAt);
  return remaining > 0 ? remaining : 0;
}

// ── GEO ──────────────────────────────────────────────────────

async function getGeo() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.GEO_TIMEOUT);
    const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return {};
    const data = await res.json();
    if (data.error) return {};
    return {
      lat:    data.latitude  ?? '',
      lon:    data.longitude ?? '',
      city:   data.city      ?? '',
      region: data.region    ?? '',
    };
  } catch {
    return {};
  }
}

// ── LOG → SHEET ──────────────────────────────────────────────

function logScan({ tipo, coupon, geo }) {
  if (!CONFIG.SCRIPT_URL || CONFIG.SCRIPT_URL.includes('TU_APPS')) return;
  const params = new URLSearchParams({
    tipo,
    coupon,
    lat:    geo.lat    ?? '',
    lon:    geo.lon    ?? '',
    city:   geo.city   ?? '',
    region: geo.region ?? '',
  });
  fetch(CONFIG.SCRIPT_URL + '?' + params.toString(), { mode: 'no-cors' }).catch(() => {});
}

// ── COUNTDOWN CUPÓN (72hs) ───────────────────────────────────

function startCouponCountdown(hours) {
  let total = hours * 3600;
  const elH = document.getElementById('cdHours');
  const elM = document.getElementById('cdMinutes');
  const elS = document.getElementById('cdSeconds');
  const pad = function(n) { return String(n).padStart(2, '0'); };
  function tick() {
    if (total <= 0) { elH.textContent = elM.textContent = elS.textContent = '00'; return; }
    elH.textContent = pad(Math.floor(total / 3600));
    elM.textContent = pad(Math.floor((total % 3600) / 60));
    elS.textContent = pad(total % 60);
    total--;
  }
  tick();
  setInterval(tick, 1000);
}

// ── COUNTDOWN COOLDOWN ───────────────────────────────────────

function startCooldownCountdown(remainingMs) {
  let total = Math.ceil(remainingMs / 1000);
  const el  = document.getElementById('cooldownTimer');
  const pad = function(n) { return String(n).padStart(2, '0'); };
  function tick() {
    if (total <= 0) { location.reload(); return; }
    el.textContent = pad(Math.floor(total / 60)) + ':' + pad(total % 60);
    total--;
  }
  tick();
  setInterval(tick, 1000);
}

// ── COPIAR ───────────────────────────────────────────────────

function setupCopyButton(coupon) {
  var btn   = document.getElementById('copyBtn');
  var label = document.getElementById('copyLabel');
  btn.addEventListener('click', function() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(coupon).catch(function() { fallbackCopy(coupon); });
    } else {
      fallbackCopy(coupon);
    }
    btn.classList.add('copied');
    label.textContent = '¡Copiado!';
    setTimeout(function() {
      btn.classList.remove('copied');
      label.textContent = 'Copiar código';
    }, 2400);
  });
}

function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); } catch(e) {}
  document.body.removeChild(ta);
}

// ── PANTALLAS ────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s) {
    s.classList.add('is-hidden');
  });
  document.getElementById(id).classList.remove('is-hidden');
}

// ── INIT ─────────────────────────────────────────────────────

function init() {
  var startedAt = Date.now();
  showScreen('screenLoading');

  // 1. Cooldown check — antes de hacer cualquier otra cosa
  var remainingMs = getRemainingCooldownMs();
  if (remainingMs > 0) {
    showScreen('screenCooldown');
    startCooldownCountdown(remainingMs);
    return;
  }

  // 2. Tipo desde URL
  var tipo = new URLSearchParams(window.location.search).get('tipo') || 'desconocido';

  // 3. Generar cupón
  var chars  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var coupon = 'NASH-';
  for (var i = 0; i < 4; i++) {
    coupon += chars[Math.floor(Math.random() * chars.length)];
  }

  // 4. Guardar cooldown en el dispositivo YA
  //    (antes de la geo, para que aunque falle todo, no genere de nuevo)
  saveCooldownState(coupon);

  // 5. Geo en paralelo — no bloquea la UI
  var geoPromise = getGeo();

  // 6. Poblar UI inmediatamente
  document.getElementById('couponCode').textContent = coupon;

  var msg = [
    '¡Hola Nashville! 🍔 Vi su poster por el barrio y no pude resistirme.',
    'Quiero canjear mi cupón del 5% OFF.',
    'Mi código es: *' + coupon + '*',
    '¿Cuándo puedo hacer mi pedido?',
  ].join('\n');

  var waBtn = document.getElementById('waBtn');
  waBtn.href = 'https://wa.me/' + CONFIG.WA_NUMBER + '?text=' + encodeURIComponent(msg);

  // 7. Registrar en Sheet SOLO cuando el usuario toca WhatsApp
  var logged = false;
  waBtn.addEventListener('click', function() {
    if (logged) return;
    logged = true;
    geoPromise.then(function(geo) {
      logScan({ tipo: tipo, coupon: coupon, geo: geo });
    });
  });

  // 8. Extras
  setupCopyButton(coupon);
  startCouponCountdown(CONFIG.COUPON_EXPIRY);

  // 9. Loader mínimo 900ms para que el logo se vea animado
  var elapsed = Date.now() - startedAt;
  var wait    = Math.max(0, 900 - elapsed);
  setTimeout(function() { showScreen('screenCoupon'); }, wait);
}

// Arrancar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
