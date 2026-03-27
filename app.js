/* ============================================================
   NASHVILLE — APP.JS
   Flujo: loader → genera cupón → log silencioso → muestra UI
   ============================================================ */

// ── CONFIG — editá solo esta sección ────────────────────────
const CONFIG = {
  SCRIPT_URL:     'https://script.google.com/macros/s/AKfycbxY2gzL8OgKvxv_xFSvFqX6izVqxiD5OKe9ZGS9ooBMm7wS-PGhSddr3vX98TYRkXmJfQ/exec',   // ← URL del deploy de Apps Script
  WA_NUMBER:      '5493517886903',
  COUPON_EXPIRY:  72,                           // horas
  GEO_TIMEOUT:    3000,                         // ms para abandonar geo si tarda
};
// ─────────────────────────────────────────────────────────────

// ── Utilidades ───────────────────────────────────────────────

/**
 * Genera un cupón tipo NASH-XXXX
 * Excluye caracteres ambiguos (I, O, 0, 1)
 */
function generateCoupon() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'NASH-';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Obtiene geolocalización por IP con timeout
 * Nunca lanza — devuelve objeto vacío si falla
 */
async function getGeo() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.GEO_TIMEOUT);

    const res = await fetch(
      'https://ip-api.com/json/?fields=status,lat,lon,city,regionName',
      { signal: controller.signal }
    );
    clearTimeout(timer);

    if (!res.ok) return {};
    const data = await res.json();
    if (data.status !== 'success') return {};

    return {
      lat:    data.lat,
      lon:    data.lon,
      city:   data.city,
      region: data.regionName,
    };
  } catch {
    return {};
  }
}

/**
 * Registra el scan en Google Sheets (fire-and-forget)
 * Usa mode: no-cors → no podemos leer la respuesta, pero llega
 */
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

  // Pequeño delay para no bloquear el render de la UI
  setTimeout(() => {
    fetch(`${CONFIG.SCRIPT_URL}?${params}`, { mode: 'no-cors' })
      .catch(() => { /* silencioso — Apps Script responde ok de todas formas */ });
  }, 300);
}

// ── Countdown ────────────────────────────────────────────────

function startCountdown(hours) {
  let total = hours * 60 * 60; // segundos

  const elH = document.getElementById('cdHours');
  const elM = document.getElementById('cdMinutes');
  const elS = document.getElementById('cdSeconds');

  function pad(n) { return String(n).padStart(2, '0'); }

  function tick() {
    if (total <= 0) {
      elH.textContent = '00';
      elM.textContent = '00';
      elS.textContent = '00';
      return;
    }

    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;

    elH.textContent = pad(h);
    elM.textContent = pad(m);
    elS.textContent = pad(s);

    total--;
  }

  tick(); // primer render inmediato
  setInterval(tick, 1000);
}

// ── Copiar al portapapeles ───────────────────────────────────

function setupCopyButton(coupon) {
  const btn   = document.getElementById('copyBtn');
  const label = document.getElementById('copyLabel');

  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(coupon);
    } catch {
      // Fallback para browsers que bloquean clipboard API
      const ta = document.createElement('textarea');
      ta.value = coupon;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }

    btn.classList.add('copied');
    label.textContent = '¡Copiado!';

    setTimeout(() => {
      btn.classList.remove('copied');
      label.textContent = 'Copiar código';
    }, 2200);
  });
}

// ── Pantallas ────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// ── Init ─────────────────────────────────────────────────────

async function init() {
  showScreen('screenLoading');

  try {
    // Leer parámetro de la URL (?tipo=poste, etc.)
    const params = new URLSearchParams(window.location.search);
    const tipo   = params.get('tipo') || 'desconocido';

    // Generar cupón
    const coupon = generateCoupon();

    // Geo en paralelo (no bloquea si tarda)
    const geo = await getGeo();

    // Loggear scan (async, no bloquea UI)
    logScan({ tipo, coupon, geo });

    // Poblar UI
    document.getElementById('couponCode').textContent = coupon;

    // Armar mensaje WhatsApp
    const msg = [
      '¡Hola Nashville! 🍔 Vi su poster por el barrio y no pude resistirme.',
      `Quiero canjear mi cupón del 5% OFF.`,
      `Mi código es: *${coupon}*`,
      '¿Cuándo puedo hacer mi pedido?',
    ].join('\n');

    const waUrl = `https://wa.me/${CONFIG.WA_NUMBER}?text=${encodeURIComponent(msg)}`;
    document.getElementById('waBtn').href = waUrl;

    // Setup extras
    setupCopyButton(coupon);
    startCountdown(CONFIG.COUPON_EXPIRY);

    // Mostrar pantalla principal
    showScreen('screenCoupon');

  } catch (err) {
    console.error('[Nashville]', err);
    showScreen('screenError');
  }
}

// Arrancar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
