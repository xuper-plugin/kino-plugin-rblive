// Kino plugin: RBLive Deportes
// Todo vía WebView real (kino.browser), porque:
//  - el API protobuf llega como application/json y Kino lo corrompe al leerlo como texto;
//  - el endpoint de streams devuelve "oklp" a clientes no nativos.
// Lista:  kino.browser.page scrapea los enlaces de partido de la página en vivo.
// Reproduce: kino.browser.capture abre la página del partido y captura el .m3u8.

const SITE = "https://www.rbtvplus18.website";
const LIVE_PAGE = SITE + "/es/";

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

/** Scrapea la página en vivo y devuelve los partidos como items de Kino. */
async function liveList() {
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

  kino.log(`[rblive] live page html=${html.length} finalUrl=${page.finalUrl} items=${items.length}`);
  return items;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

/** home(): partidos en vivo en una fila. */
export async function home() {
  const items = await liveList();
  if (!items.length) throw kino.error("unavailable", "no hay partidos en vivo ahora");
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

/** liveChannels(): lista de partidos en vivo. */
export async function liveChannels(cursor) {
  const items = await liveList();
  if (!items.length) throw kino.error("unavailable", "no hay partidos en vivo ahora");
  return { items };
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
