// Kino plugin: RBLive Deportes
// Todo vía WebView real (kino.browser), porque:
//  - el API protobuf llega como application/json y Kino lo corrompe al leerlo como texto;
//  - el endpoint de streams devuelve "oklp" a clientes no nativos.
// kino.browser SOLO corre en primer plano (mientras la persona usa la app). Por eso:
//  - liveChannels (primer plano) scrapea la lista con kino.browser.page y la cachea;
//  - home (warm-up en segundo plano) lee SOLO de la caché, sin navegador;
//  - resolve captura el .m3u8 con kino.browser.capture.

const SITE = "https://www.rbtvplus18.website";
const LIVE_PAGE = SITE + "/es/";

const CACHE_KEY = "live-items";
const CACHE_TTL = 10 * 60 * 1000; // 10 min

const SPORT_ICON = {
  football: "⚽", basketball: "🏀", tennis: "🎾", baseball: "⚾", cricket: "🏏",
  rugby: "🏉", "american-football": "🏈", hockey: "🏒", volleyball: "🏐",
  handball: "🤾", golf: "⛳", "aussie-rules": "🏉", badminton: "🏸",
  moto: "🏍", fighting: "🥊", cycling: "🚴", darts: "🎯", athletics: "🏃",
};

/** "unan-managua-vs-hyh-export-sebaco-fc" → "Unan Managua vs Hyh Export Sebaco Fc" */
function titleFromSlug(slug) {
  return slug
    .replace(/-vs-/g, " ||VS|| ")
    .replace(/-/g, " ")
    .replace(/\s*\|\|VS\|\|\s*/g, " vs ")
    .replace(/\b[a-záéíóúñ]/g, (c) => c.toUpperCase())
    .trim();
}

// ─── Caché ───────────────────────────────────────────────────────────────────

function cachedItems() {
  try {
    const raw = kino.storage.get(CACHE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveItems(items) {
  try { kino.storage.set(CACHE_KEY, JSON.stringify(items), { ttlMs: CACHE_TTL }); } catch {}
}

// ─── Scrape de la lista en vivo (primer plano) ───────────────────────────────

async function scrapeLive() {
  const page = await kino.browser.page(LIVE_PAGE, {
    waitFor: "/es/[a-z0-9-]+/[a-z0-9-]+-[0-9]{6,}/",
    timeoutMs: 22000,
  });
  const html = page.html || "";

  // href de partido: /es/{sport}/{league}-{matchId}/{teams}.html
  const re = /\/es\/([a-z0-9-]+)\/([a-z0-9-]+)-(\d{6,})\/([a-z0-9-]+)\.html/gi;
  const items = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const sport = m[1], league = m[2], matchId = m[3], teams = m[4];
    if (seen.has(matchId)) continue;
    seen.add(matchId);
    const icon = SPORT_ICON[sport] || "🔴";
    items.push({
      id:    `m${matchId}`,
      ref:   `${SITE}/es/${sport}/${league}-${matchId}/${teams}.html`,
      title: `${icon} ${titleFromSlug(teams)}`,
    });
  }

  kino.log(`[rblive] scrape html=${html.length} finalUrl=${page.finalUrl} items=${items.length}`);
  return items;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

/** home(): warm-up en segundo plano → solo caché (el navegador está bloqueado aquí). */
export async function home() {
  const items = cachedItems();
  if (!items.length) return [];
  return [{
    id:    "live-now",
    title: "⚽ En Vivo Ahora",
    items: items.map((it) => ({ ...it, kind: "live" })),
  }];
}

/** liveCategories(): categorías de deportes. */
export async function liveCategories() {
  return [{ id: "all", name: "Todos" }];
}

/** liveChannels(): primer plano → scrape con navegador, con fallback a caché. */
export async function liveChannels(cursor) {
  try {
    const items = await scrapeLive();
    if (items.length) { saveItems(items); return { items }; }
  } catch (e) {
    kino.log(`[rblive] scrape falló: ${e && e.message}`);
  }
  const cached = cachedItems();
  if (cached.length) return { items: cached };
  throw kino.error("unavailable", "no se pudo cargar la lista en vivo");
}

/**
 * resolve(ref): abre la página del partido en un WebView real y captura el .m3u8.
 * El sitio ejecuta su propio JS (tokens, firma AES/CTR, anti-"oklp"); solo capturamos.
 * ref = URL de la página del partido.
 */
export async function resolve(ref) {
  const watchUrl = String(ref);
  if (!/^https:\/\//.test(watchUrl)) throw kino.error("not_found", "ref inválido");

  kino.log(`[rblive] capture ${watchUrl}`);
  const cap = await kino.browser.capture(watchUrl, { match: "\\.m3u8", timeoutMs: 24000 });

  const media = (cap && cap.media) || [];
  kino.log(`[rblive] capture media=${media.length} finalUrl=${cap && cap.finalUrl}`);
  const hls = media.find((x) => /\.m3u8/i.test(x.url)) || media[0];
  if (!hls) throw kino.error("unavailable", "no se capturó stream (¿partido fuera de línea?)");

  return {
    url:     hls.url,
    mime:    hls.mime || "application/x-mpegURL",
    headers: hls.headers || {},
  };
}
