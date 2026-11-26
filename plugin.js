// Kino plugin: RBLive Deportes
// Partidos en vivo desde rbtvplus18 / rblive.
// Lista: tokens sfver → match/live (protobuf). Reproducción: kino.browser.capture
// abre la página del partido en un WebView real y captura el .m3u8 (evade el "oklp").

const DATA_EU = "https://apis-data-defra10.tcpwe138stya.ru";
const DATA_US = "https://apis-data10.tcpwe138stya.ru";
const DIGIT   = "snd";

const H_DATA = {
  "Origin":  "https://www.rbtvplus18.website",
  "Referer": "https://www.rbtvplus18.website/es",
  "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
};

// ─── Base64 (sin btoa — QuickJS puede no tenerlo) ───────────────────────────

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Decodifica base64 (std o url-safe) a Uint8Array. kino.fetch devuelve el
// cuerpo con r.base64(); no existe r.arrayBuffer() en el sandbox de Kino.
function unbase64(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  const out = [];
  for (let i = 0; i < s.length; i += 4) {
    const a = B64.indexOf(s[i]), b = B64.indexOf(s[i+1]);
    const c = s[i+2] ? B64.indexOf(s[i+2]) : -1;
    const d = s[i+3] ? B64.indexOf(s[i+3]) : -1;
    out.push((a << 2) | (b >> 4));
    if (c >= 0) out.push(((b & 15) << 4) | (c >> 2));
    if (d >= 0) out.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(out);
}

/** Cuerpo de una respuesta kino.fetch como Uint8Array. */
function bodyBytes(r) {
  return unbase64(r.base64());
}

// ─── Protobuf helpers ────────────────────────────────────────────────────────

function varint(buf, pos) {
  let v = 0, s = 0;
  while (pos < buf.length) {
    const b = buf[pos++];
    v |= (b & 0x7f) << s;
    s += 7;
    if (!(b & 0x80)) break;
  }
  return { v, pos };
}

/** Parser plano: devuelve {fieldNum: [valores]} para un bloque protobuf. */
function parseFlat(buf) {
  const out = {};
  let pos = 0;
  while (pos < buf.length) {
    const { v: tag, pos: p1 } = varint(buf, pos);
    pos = p1;
    if (!tag) break;
    const fn = tag >> 3;
    const wt = tag & 7;
    let val;
    if (wt === 0) {
      const r = varint(buf, pos); val = r.v; pos = r.pos;
    } else if (wt === 1) {
      val = buf.slice(pos, pos + 8); pos += 8;
    } else if (wt === 2) {
      const r = varint(buf, pos); pos = r.pos;
      val = buf.slice(pos, pos + r.v); pos += r.v;
    } else if (wt === 5) {
      val = buf.slice(pos, pos + 4); pos += 4;
    } else break;
    (out[fn] || (out[fn] = [])).push(val);
  }
  return out;
}

function bytes2str(b) {
  try {
    let s = "";
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      if (c < 128) s += String.fromCharCode(c);
      else if ((c & 0xe0) === 0xc0 && i+1 < b.length) { s += String.fromCharCode(((c & 0x1f) << 6) | (b[++i] & 0x3f)); }
      else if ((c & 0xf0) === 0xe0 && i+2 < b.length) { s += String.fromCharCode(((c & 0x0f) << 12) | ((b[++i] & 0x3f) << 6) | (b[++i] & 0x3f)); }
      else s += "?";
    }
    return s;
  } catch { return ""; }
}

/** Verificar que PBResponse.code == 200 y devolver field[10] (data). */
function pbData(raw) {
  if (!raw || raw.length < 4) return null;
  const top = parseFlat(raw);
  const code = (top[2] || [])[0];
  // En éxito el campo 2 (code) se omite; sólo descartar si viene un code de error explícito.
  if (code !== undefined && code !== 200 && code !== 0) {
    kino.log(`[rblive] pb code=${code} msg=${bytes2str((top[3]||[])[0]||new Uint8Array())}`);
    return null;
  }
  return (top[10] || [])[0] || null;
}

// ─── Tokens sfver ────────────────────────────────────────────────────────────
// Mapa endpoint_id → path (IDs decimales del APK: ApiConstants.smali)
const EP_MAP = {
  100: "/api/match/live", 101: "/api/match/schedule", 190: "/api/match/count",
  102: "/api/match/detail", 103: "/api/match/event",   104: "/api/match/statistic",
  105: "/api/match/trend",  106: "/api/match/lineup",  107: "/api/match/analysis",
  200: "/api/league/detail", 210: "/api/league/season/list",
  220: "/api/league/match/list", 230: "/api/league/team/total/list",
  231: "/api/league/player/total/list", 240: "/api/league/team/standing/list",
};

function parseBsTokens(raw) {
  const tokens = {};
  const top = parseFlat(raw);
  const data = (top[10] || [])[0];
  if (!(data instanceof Uint8Array)) return tokens;
  // data = { 1: [ {1: epId, 2: sig}, ... ] }
  const df = parseFlat(data);
  for (const entryBuf of (df[1] || [])) {
    if (!(entryBuf instanceof Uint8Array)) continue;
    const ef = parseFlat(entryBuf);
    const epId = (ef[1] || [])[0];
    const sigBuf = (ef[2] || [])[0];
    if (epId !== undefined && sigBuf instanceof Uint8Array) {
      const path = EP_MAP[epId] || `ep_${epId}`;
      tokens[path] = bytes2str(sigBuf);
    }
  }
  return tokens;
}

async function fetchTokens() {
  const tokens = {};
  for (const [group, sportType] of [["home", 0], ["match", 1]]) {
    const url = `${DATA_EU}/api/common/bs/${group}?sportType=${sportType}`;
    const r = await kino.fetch(url, { headers: H_DATA });
    if (!r.ok) { kino.log(`[rblive] bs/${group} ${r.status}`); continue; }
    const raw = bodyBytes(r);
    Object.assign(tokens, parseBsTokens(raw));
  }
  return tokens;
}

// ─── Match/live → lista de canales ──────────────────────────────────────────

// PBSportType → segmento de URL del sitio (del enum del APK).
const SPORT_SEG = {
  1: "football", 2: "basketball", 3: "tennis", 4: "baseball", 6: "cricket",
  7: "moto", 8: "rugby", 9: "american-football", 10: "aussie-rules", 11: "hockey",
  12: "badminton", 13: "volleyball", 14: "fighting", 15: "cycling", 16: "handball",
  17: "golf", 18: "darts", 19: "athletics",
};
function sportSegment(sport) { return SPORT_SEG[sport] || "football"; }

function subStr(sub, field) {
  const v = (sub[field] || [])[0];
  return v instanceof Uint8Array ? bytes2str(v) : "";
}

/** URL de la página del partido en el sitio (el WebView la reproduce). */
function matchWatchUrl(m) {
  const seg    = sportSegment(m.sport);
  const league = m.leagueSlug || "live";
  const teams  = m.teamsSlug || "match";
  return `https://www.rbtvplus18.website/es/${seg}/${league}-${m.matchId}/${teams}.html`;
}

/** Extrae entradas de match/live: {matchId, sport, title, teamsSlug, leagueSlug} */
function parseLive(data) {
  const matches = [];
  const seen = new Set();

  function walk(buf, depth) {
    if (depth > 6) return;
    const f = parseFlat(buf);
    const mId   = (f[1] || [])[0];
    const sport = (f[2] || [])[0];
    const isMatch = typeof mId === "number" && mId >= 2_000_000 && mId <= 5_500_000 &&
                    typeof sport === "number" && sport >= 1 && sport <= 90 && f[30];

    if (isMatch && !seen.has(mId)) {
      seen.add(mId);
      // título: el sub-mensaje f30 con s2 = "Equipo A vs Equipo B"
      let title = "";
      for (const x of (f[30] || [])) {
        if (!(x instanceof Uint8Array)) continue;
        const t = subStr(parseFlat(x), 2);
        if (t && t.includes(" vs ")) { title = t; break; }
        if (t && !title) title = t;
      }
      // slug: cualquier sub-campo con s20 (equipos) y s21 (liga)
      let teamsSlug = "", leagueSlug = "";
      for (const vals of Object.values(f)) {
        for (const x of vals) {
          if (!(x instanceof Uint8Array) || x.length < 8) continue;
          const sub = parseFlat(x);
          const s20 = subStr(sub, 20);
          if (s20 && /^[a-z0-9-]+$/.test(s20)) { teamsSlug = s20; leagueSlug = subStr(sub, 21); }
        }
      }
      matches.push({ matchId: mId, sport, title, teamsSlug, leagueSlug });
    }

    for (const vals of Object.values(f)) {
      for (const v of vals) {
        if (v instanceof Uint8Array && v.length > 4) walk(v, depth + 1);
      }
    }
  }

  walk(data, 0);
  return matches;
}

function sportLabel(sport) {
  return { 1:"⚽", 2:"🏀", 3:"🎾", 4:"⚾", 6:"🏏", 8:"🏉", 9:"🏈", 11:"🏒", 13:"🏐", 16:"🤾", 17:"⛳" }[sport] || "🔴";
}

// ─── Exports ─────────────────────────────────────────────────────────────────

/** home(): pantalla de inicio con los partidos en vivo como categorías. */
export async function home() {
  const channels = await liveChannelsImpl();
  return [{
    id:    "live-now",
    title: "⚽ En Vivo Ahora",
    items: channels.items.map((ch) => ({
      id:    ch.id,
      ref:   ch.ref,
      title: ch.title,
      kind:  "live",
    })),
  }];
}

/** liveCategories(): categoría para la pestaña En Vivo nativa (Kino agrupa por categoryId). */
export async function liveCategories() {
  return [{ id: "deportes", title: "Deportes", genre: "deportes" }];
}

/** liveChannels(): devuelve la lista de partidos en vivo ahora mismo. */
export async function liveChannels(cursor) {
  return liveChannelsImpl(cursor);
}

async function liveChannelsImpl(cursor) {
  // 1. Tokens sfver
  const tokens = await fetchTokens();
  const tokenLive = tokens["/api/match/live"];
  if (!tokenLive) throw kino.error("unavailable", "no sfver token for match/live");

  // 2. match/live
  const url = `${DATA_EU}/sfver${tokenLive}/api/match/live?sportType=0&language=4&stream=true`;
  const r = await kino.fetch(url, { headers: H_DATA });
  if (!r.ok) throw kino.error("unavailable", `match/live ${r.status}`);

  const raw  = bodyBytes(r);
  const data = pbData(raw);
  if (!data) throw kino.error("unavailable", "match/live response invalid");

  const matches = parseLive(data);
  kino.log(`[rblive] ${matches.length} matches en vivo`);

  const items = matches.slice(0, 80).map((m) => {
    const icon  = sportLabel(m.sport);
    const title = m.title || `Match ${m.matchId}`;
    return {
      id:         `m${m.matchId}`,
      ref:        matchWatchUrl(m),
      title:      `${icon} ${title}`,
      categoryId: "deportes",
    };
  });

  if (!items.length) throw kino.error("unavailable", "no live matches right now");
  return { items };
}

/**
 * resolve(ref): abre la página del partido en un WebView real (kino.browser.capture).
 * El sitio ejecuta su propio JS (tokens sfver, rb-session, firma AES/CTR y el check anti-bot
 * que devuelve "oklp" a clientes no nativos), y capturamos el request del .m3u8 con sus headers.
 * ref = URL de la página del partido (ver matchWatchUrl).
 */
export async function resolve(ref) {
  const watchUrl = String(ref);
  if (!/^https:\/\//.test(watchUrl)) throw kino.error("not_found", "invalid ref");

  kino.log(`[rblive] capture ${watchUrl}`);
  const cap = await kino.browser.capture(watchUrl, {
    match: "\\.m3u8",
    timeoutMs: 24000,
  });

  const media = (cap && cap.media) || [];
  kino.log(`[rblive] capture media=${media.length} finalUrl=${cap && cap.finalUrl}`);
  const hls = media.find((m) => /\.m3u8/i.test(m.url)) || media[0];
  if (!hls) throw kino.error("unavailable", "no se capturó stream (¿partido fuera de línea?)");

  return {
    url:  hls.url,
    mime: hls.mime || "application/x-mpegURL",
    headers: hls.headers || {},
  };
}
