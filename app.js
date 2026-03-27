/* ================================================================
   NASHVILLE — APP.JS v4
   Arquitectura: máquina de estados + storage estructurado + modo admin

   ESTADOS:
     loading    → pantalla inicial siempre
     coupon     → primera vez, genera y muestra el cupón
     returning  → ya canjeó, muestra su código con metadata
     cooldown   → generó hace poco, espera con timer
     error      → algo falló, fallback WA

   STORAGE (localStorage key: 'nash_v2'):
     {
       coupon:      string,        código generado
       generatedAt: number,        timestamp ms
       redeemedAt:  number|null,   timestamp al tocar WA
       tipo:        string,        origen del QR
       expiresAt:   number,        generatedAt + 72hs
     }

   MODO ADMIN:
     Agregar ?admin=1 a la URL para saltear el cooldown siempre.
     Útil para testing sin tener que borrar el storage.
================================================================ */

'use strict';

/* ── CONFIG ──────────────────────────────────────────────────── */
var CONFIG = {
  SCRIPT_URL:    'https://script.google.com/macros/s/AKfycbwpidh1tETWntQFplSNmdbCy7KAFSlrtBF_O3TnTkezzPIBcbpooNvsQDVRoORuijxwgg/exec',
  WA_NUMBER:     '5493517886903',
  COUPON_EXPIRY: 72,        /* horas */
  COOLDOWN_MIN:  15,        /* minutos entre generaciones */
  GEO_TIMEOUT:   3500,      /* ms máximo para geo */
  LOADER_MIN:    1000,      /* ms mínimo que se muestra el loader */
  STORAGE_KEY:   'nash_v2', /* clave en localStorage */
  CHARS:         'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', /* sin I,O,0,1 */
};

/* ── STORAGE ─────────────────────────────────────────────────── */
/*
   Toda la interacción con localStorage pasa por estas tres funciones.
   Si localStorage no está disponible (modo incógnito extremo, algunos
   iOS WebViews), las funciones devuelven null/false silenciosamente.
*/

function storageGet() {
  try {
    var raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    /* Validar que tenga los campos mínimos esperados */
    if (!parsed || !parsed.coupon || !parsed.generatedAt) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function storageSet(data) {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false; /* localStorage lleno o bloqueado */
  }
}

function storageMark(field, value) {
  /* Actualiza un campo del registro existente */
  try {
    var current = storageGet();
    if (!current) return false;
    current[field] = value;
    return storageSet(current);
  } catch (e) {
    return false;
  }
}

/* ── LÓGICA DE ESTADOS ───────────────────────────────────────── */

function isAdminMode() {
  try {
    return new URLSearchParams(window.location.search).get('admin') === '1';
  } catch (e) {
    return false;
  }
}

function getCooldownRemainingMs(record) {
  if (!record) return 0;
  if (isAdminMode()) return 0; /* Admin siempre pasa */
  var windowMs  = CONFIG.COOLDOWN_MIN * 60 * 1000;
  var elapsed   = Date.now() - record.generatedAt;
  var remaining = windowMs - elapsed;
  return remaining > 0 ? remaining : 0;
}

function isCouponExpired(record) {
  if (!record || !record.expiresAt) return true;
  return Date.now() > record.expiresAt;
}

/*
   Determina qué estado mostrar al cargar.
   Retorna: 'coupon' | 'returning' | 'cooldown'
*/
function resolveInitialState() {
  var record = storageGet();

  /* Sin historial → primera vez */
  if (!record) return { state: 'coupon', record: null };

  /* Cupón vencido → puede generar uno nuevo */
  if (isCouponExpired(record)) return { state: 'coupon', record: null };

  /* Cooldown activo → debe esperar */
  var remaining = getCooldownRemainingMs(record);
  if (remaining > 0) return { state: 'cooldown', record: record, remainingMs: remaining };

  /* Ya tiene cupón vigente → mostrar su código */
  return { state: 'returning', record: record };
}

/* ── GEO ─────────────────────────────────────────────────────── */

function getGeo() {
  return new Promise(function(resolve) {
    var done = false;
    var timer = setTimeout(function() {
      if (!done) { done = true; resolve({}); }
    }, CONFIG.GEO_TIMEOUT);

    fetch('https://ipapi.co/json/')
      .then(function(res) {
        if (!res.ok) throw new Error('geo-fail');
        return res.json();
      })
      .then(function(data) {
        clearTimeout(timer);
        if (!done) {
          done = true;
          if (data.error) { resolve({}); return; }
          resolve({
            lat:    data.latitude  != null ? data.latitude  : '',
            lon:    data.longitude != null ? data.longitude : '',
            city:   data.city   || '',
            region: data.region || '',
          });
        }
      })
      .catch(function() {
        clearTimeout(timer);
        if (!done) { done = true; resolve({}); }
      });
  });
}

/* ── LOG → SHEET ─────────────────────────────────────────────── */

function logToSheet(coupon, tipo, geo) {
  if (!CONFIG.SCRIPT_URL || CONFIG.SCRIPT_URL.indexOf('TU_APPS') !== -1) return;

  var params = new URLSearchParams({
    coupon: coupon,
    tipo:   tipo,
    lat:    geo.lat    != null ? geo.lat    : '',
    lon:    geo.lon    != null ? geo.lon    : '',
    city:   geo.city   || '',
    region: geo.region || '',
  });

  fetch(CONFIG.SCRIPT_URL + '?' + params.toString(), { mode: 'no-cors' })
    .catch(function() { /* silencioso */ });
}

/* ── GENERAR CUPÓN ───────────────────────────────────────────── */

function generateCouponCode() {
  var code = 'NASH-';
  for (var i = 0; i < 4; i++) {
    code += CONFIG.CHARS[Math.floor(Math.random() * CONFIG.CHARS.length)];
  }
  return code;
}

/* ── FORMATEAR FECHA ─────────────────────────────────────────── */

function formatDate(ts) {
  if (!ts) return '—';
  try {
    var d = new Date(ts);
    var day = String(d.getDate()).padStart(2, '0');
    var mon = String(d.getMonth() + 1).padStart(2, '0');
    var hr  = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    return day + '/' + mon + ' ' + hr + ':' + min + 'hs';
  } catch (e) {
    return '—';
  }
}

/* ── COPIAR AL PORTAPAPELES ──────────────────────────────────── */

function copyToClipboard(text, btnEl, labelEl, defaultLabel) {
  function onSuccess() {
    btnEl.classList.add('is-copied');
    labelEl.textContent = '¡Copiado!';
    setTimeout(function() {
      btnEl.classList.remove('is-copied');
      labelEl.textContent = defaultLabel || 'Copiar';
    }, 2400);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(function() {
      fallbackCopy(text, onSuccess);
    });
  } else {
    fallbackCopy(text, onSuccess);
  }
}

function fallbackCopy(text, callback) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
    if (callback) callback();
  } catch (e) { /* no se pudo copiar */ }
  document.body.removeChild(ta);
}

/* ── TIMERS ──────────────────────────────────────────────────── */

function pad2(n) {
  return String(n).padStart(2, '0');
}

/*
   Timer del cupón: cuenta regresiva de 72hs
   Se muestra en la pantalla 'coupon'
*/
function startCouponTimer(expiresAt) {
  var elH = document.getElementById('cdH');
  var elM = document.getElementById('cdM');
  var elS = document.getElementById('cdS');

  function tick() {
    var remaining = Math.max(0, expiresAt - Date.now());
    var totalSecs = Math.floor(remaining / 1000);
    var h = Math.floor(totalSecs / 3600);
    var m = Math.floor((totalSecs % 3600) / 60);
    var s = totalSecs % 60;
    elH.textContent = pad2(h);
    elM.textContent = pad2(m);
    elS.textContent = pad2(s);
    if (remaining > 0) {
      setTimeout(tick, 1000);
    }
  }

  tick();
}

/*
   Timer del cooldown: cuenta regresiva hasta que puede generar uno nuevo
   Al llegar a 0 recarga la página
*/
function startCooldownTimer(remainingMs) {
  var el = document.getElementById('cooldownDisplay');
  var endAt = Date.now() + remainingMs;

  function tick() {
    var remaining = Math.max(0, endAt - Date.now());
    var totalSecs = Math.floor(remaining / 1000);
    var m = Math.floor(totalSecs / 60);
    var s = totalSecs % 60;
    el.textContent = pad2(m) + ':' + pad2(s);

    if (remaining <= 0) {
      location.reload();
    } else {
      setTimeout(tick, 1000);
    }
  }

  tick();
}

/* ── MÁQUINA DE PANTALLAS ────────────────────────────────────── */

var currentScreen = null;

function showScreen(id) {
  /* Ocultar pantalla actual */
  if (currentScreen) {
    currentScreen.classList.add('is-off');
    currentScreen.classList.remove('is-entering');
  }

  /* Mostrar nueva */
  var next = document.getElementById(id);
  if (!next) return;
  next.classList.remove('is-off');
  /* Forzar reflow para que la animación arranque desde cero */
  void next.offsetWidth;
  next.classList.add('is-entering');
  currentScreen = next;
}

/* ── CONSTRUIR URL DE WHATSAPP ───────────────────────────────── */

function buildWaUrl(coupon) {
  var msg = [
    '¡Hola Nashville! 🍔 Vi su poster por el barrio y no pude resistirme.',
    'Quiero canjear mi cupón del 5% OFF.',
    'Mi código es: *' + coupon + '*',
    '¿Cuándo puedo hacer mi pedido?',
  ].join('\n');
  return 'https://wa.me/' + CONFIG.WA_NUMBER + '?text=' + encodeURIComponent(msg);
}

/* ── INICIALIZAR PANTALLA: COUPON ────────────────────────────── */

function initCouponScreen(tipo, geoPromise) {
  var coupon    = generateCouponCode();
  var now       = Date.now();
  var expiresAt = now + CONFIG.COUPON_EXPIRY * 60 * 60 * 1000;

  /* Guardar en storage antes de mostrar (protege contra cierre rápido) */
  var record = {
    coupon:      coupon,
    generatedAt: now,
    expiresAt:   expiresAt,
    redeemedAt:  null,
    tipo:        tipo,
  };
  storageSet(record);

  /* Poblar UI */
  document.getElementById('couponDisplay').textContent = coupon;

  var waUrl  = buildWaUrl(coupon);
  var waBtn  = document.getElementById('waBtn');
  waBtn.href = waUrl;

  /* Registrar en Sheet SOLO al tocar WhatsApp */
  var logged = false;
  waBtn.addEventListener('click', function() {
    if (logged) return;
    logged = true;
    storageMark('redeemedAt', Date.now());
    geoPromise.then(function(geo) {
      logToSheet(coupon, tipo, geo);
    });
  });

  /* Botón copiar */
  var copyBtn   = document.getElementById('copyBtn');
  var copyLabel = document.getElementById('copyLabel');
  copyBtn.addEventListener('click', function() {
    copyToClipboard(coupon, copyBtn, copyLabel, 'Copiar');
  });

  /* Timer 72hs */
  startCouponTimer(expiresAt);

  showScreen('s-coupon');
}

/* ── INICIALIZAR PANTALLA: RETURNING ─────────────────────────── */

function initReturningScreen(record) {
  /* Poblar datos del cupón guardado */
  document.getElementById('returningCode').textContent = record.coupon;
  document.getElementById('returningDate').textContent   = formatDate(record.generatedAt);
  document.getElementById('returningExpiry').textContent = formatDate(record.expiresAt);

  var statusEl = document.getElementById('returningStatus');
  statusEl.textContent = record.redeemedAt ? 'Canjeado ✓' : 'Pendiente';

  /* Botón copiar */
  var copyBtn   = document.getElementById('returningCopyBtn');
  var copyLabel = document.getElementById('returningCopyLabel');
  copyBtn.addEventListener('click', function() {
    copyToClipboard(record.coupon, copyBtn, copyLabel, 'Copiar código');
  });

  /* Botón WhatsApp */
  var waBtn  = document.getElementById('returningWaBtn');
  waBtn.href = buildWaUrl(record.coupon);
  waBtn.addEventListener('click', function() {
    /* Si no estaba marcado como canjeado, marcarlo ahora */
    if (!record.redeemedAt) {
      storageMark('redeemedAt', Date.now());
    }
  });

  showScreen('s-returning');
}

/* ── INICIALIZAR PANTALLA: COOLDOWN ──────────────────────────── */

function initCooldownScreen(record, remainingMs) {
  /* Mostrar el código que ya tiene */
  document.getElementById('cooldownCode').textContent = record.coupon;

  /* Botón WhatsApp con su código actual */
  var waBtn  = document.getElementById('cooldownWaBtn');
  waBtn.href = buildWaUrl(record.coupon);

  /* Timer de espera */
  startCooldownTimer(remainingMs);

  showScreen('s-cooldown');
}

/* ── INIT PRINCIPAL ──────────────────────────────────────────── */

function init() {
  var startedAt = Date.now();

  /* Siempre empezar con loader */
  showScreen('s-loading');

  /* Leer tipo desde URL */
  var tipo = 'desconocido';
  try {
    tipo = new URLSearchParams(window.location.search).get('tipo') || 'desconocido';
  } catch (e) { /* noop */ }

  /* Determinar estado inicial */
  var resolved = resolveInitialState();

  /* Geo en paralelo — no bloquea nunca */
  var geoPromise = getGeo();

  /*
     Esperar el mínimo del loader para que el logo se vea animado.
     Si la geo tarda más, el mínimo ya habrá pasado y se muestra inmediato.
  */
  var minWait = new Promise(function(resolve) {
    var elapsed = Date.now() - startedAt;
    var wait    = Math.max(0, CONFIG.LOADER_MIN - elapsed);
    setTimeout(resolve, wait);
  });

  minWait.then(function() {
    try {
      switch (resolved.state) {

        case 'cooldown':
          initCooldownScreen(resolved.record, resolved.remainingMs);
          break;

        case 'returning':
          initReturningScreen(resolved.record);
          break;

        case 'coupon':
        default:
          initCouponScreen(tipo, geoPromise);
          break;
      }
    } catch (err) {
      console.error('[Nashville]', err);
      showScreen('s-error');
    }
  });
}

/* ── GRAIN CANVAS ────────────────────────────────────────────── */
/*
   Dibuja grano de película una sola vez en un canvas.
   Es significativamente más performante que el SVG animado anterior
   porque: (1) se dibuja una sola vez, (2) no hace repaints continuos,
   (3) el canvas se mantiene como una sola capa del compositor.
*/
function drawGrain() {
  try {
    var canvas = document.getElementById('grainCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width  = 300;
    canvas.height = 300;

    var imageData = ctx.createImageData(300, 300);
    var data      = imageData.data;

    for (var i = 0; i < data.length; i += 4) {
      var v = Math.floor(Math.random() * 255);
      data[i]     = v; /* R */
      data[i + 1] = v; /* G */
      data[i + 2] = v; /* B */
      data[i + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);

    /* Escalar con CSS para cubrir toda la pantalla sin re-dibujar */
    canvas.style.cssText = [
      'position:absolute',
      'inset:0',
      'width:100%',
      'height:100%',
      'object-fit:cover',
      'opacity:0.038',
      'mix-blend-mode:overlay',
      'pointer-events:none',
    ].join(';');
  } catch (e) {
    /* Canvas no disponible — no es crítico */
  }
}

/* ── ARRANCAR ────────────────────────────────────────────────── */

function bootstrap() {
  drawGrain();
  init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
