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

/** Primera URL http(s) dentro de un sub-mensaje protobuf (recursivo). */
function firstHttp(buf, depth) {
  if (!(buf instanceof Uint8Array) || (depth || 0) > 3) return "";
  const sub = parseFlat(buf);
  for (const vals of Object.values(sub)) {
    for (const v of vals) {
      if (v instanceof Uint8Array) {
        const s = bytes2str(v);
        // quitar el sufijo de redimensión del CDN (…png!w80) para tener resolución completa
        if (s.startsWith("http")) return s.split(/[\s"']/)[0].replace(/!.*$/, "");
        const deep = firstHttp(v, (depth || 0) + 1);
        if (deep) return deep;
      }
    }
  }
  return "";
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
      // logos de los equipos: campo 4 de cada PBDataTeam (f30[i].10). Vienen con el host viejo
      // (tcrbg61levl.cfd, NXDOMAIN); teamLogo() lo cambia por el host actual.
      const teamLogos = [];
      for (const x of (f[30] || [])) {
        if (!(x instanceof Uint8Array)) continue;
        const tf = parseFlat(x);
        const tv = tf[10] && tf[10][0] instanceof Uint8Array ? parseFlat(tf[10][0]) : null;
        if (!tv) continue;
        const lg = tv[4] && tv[4][0] instanceof Uint8Array ? bytes2str(tv[4][0]) : "";
        teamLogos.push(lg);
      }
      matches.push({ matchId: mId, sport, title, teamsSlug, leagueSlug, homeLogo: teamLogos[0] || "", awayLogo: teamLogos[1] || "" });
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
  return { 1:"⚽", 2:"🏀", 3:"🎾", 4:"⚾", 6:"🏏", 7:"🏍", 8:"🏉", 9:"🏈", 10:"🏉",
           11:"🏒", 12:"🏸", 13:"🏐", 14:"🥊", 15:"🚴", 16:"🤾", 17:"⛳", 18:"🎯", 19:"🏃" }[sport] || "🔴";
}

const SPORT_NAME = {
  1:"Fútbol", 2:"Basketball", 3:"Tenis", 4:"Béisbol", 6:"Cricket", 7:"Motor",
  8:"Rugby", 9:"Fútbol Americano", 10:"Fútbol Australiano", 11:"Hockey",
  12:"Bádminton", 13:"Voleibol", 14:"Combate", 15:"Ciclismo", 16:"Balonmano",
  17:"Golf", 18:"Dardos", 19:"Atletismo",
};
function sportName(sport) { return SPORT_NAME[sport] || "Otros"; }
function sportCat(sport) { return SPORT_NAME[sport] ? String(sport) : "otros"; }

// Color por deporte para la tarjeta genérica (los logos reales viven en un CDN que no resuelve).
const SPORT_COLOR = {
  1:"16a34a", 2:"ea580c", 3:"65a30d", 4:"dc2626", 6:"0891b2", 7:"7c3aed",
  8:"b45309", 9:"9333ea", 10:"a16207", 11:"2563eb", 12:"db2777", 13:"0d9488",
  14:"be123c", 15:"0284c7", 16:"ca8a04", 17:"15803d", 18:"78350f", 19:"4f46e5",
};
/** Acorta un texto con … para que el placeholder lo muestre grande y parejo. */
function shortText(str, max) {
  str = String(str).trim();
  return str.length > max ? str.slice(0, max - 1).trim() + "…" : str;
}

const LOGO_HOST = "https://logos1.tcpwe138stya.ru";
/**
 * Corrige la URL del logo del equipo: el protobuf trae el host viejo (tcrbg61levl.cfd, que ya no
 * resuelve). Se reemplaza por el host actual (LOGO_HOST) y se quita el sufijo de resize (!w80)
 * para traer el logo a resolución completa. La ruta (/aelogo/... o /linlogo/...) se conserva.
 */
function teamLogo(raw) {
  const m = String(raw || "").match(/https?:\/\/[^/]+(\/[^\s"']+)/);
  return m ? LOGO_HOST + m[1].replace(/!.*$/, "") : "";
}

/** Placa de color con el título (cuando el equipo no tiene logo real). */
function placaTitulo(m) {
  const bg = SPORT_COLOR[m.sport] || "334155";
  const raw = m.title || sportName(m.sport);
  const vs = raw.split(/\s+vs\s+/i);
  const text = vs.length === 2
    ? `${shortText(vs[0], 16)}\nvs\n${shortText(vs[1], 16)}`
    : shortText(raw, 22);
  return `https://placehold.co/400x600/${bg}/ffffff/png?text=${encodeURIComponent(text)}`;
}

/**
 * Imagen de tarjeta: el logo real del equipo local, encajado con su proporción (sin estirarlo a 2:3)
 * sobre un fondo del color del deporte, vía el proxy de imágenes images.weserv.nl. Si el equipo no
 * tiene logo, una placa de color con el título del partido.
 */
function matchImage(m) {
  const bg = SPORT_COLOR[m.sport] || "334155";
  const home = teamLogo(m.homeLogo);
  if (home) {
    const src = "ssl:" + home.replace(/^https?:\/\//, "");
    return `https://images.weserv.nl/?url=${encodeURIComponent(src)}&w=400&h=600&fit=contain&cbg=${bg}&pad=24`;
  }
  return placaTitulo(m);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

const MATCHES_CACHE_KEY = "matches-cache";
const MATCHES_TTL = 60 * 1000; // 60s: suaviza las múltiples llamadas (una por categoría) y refresca al rotar

/**
 * Descarga y parsea los partidos en vivo, con caché corta en kino.storage.
 * Kino llama liveCategories + liveChannels (una por categoría) casi a la vez: la caché
 * evita N peticiones a match/live (y el 429). Al expirar, un fetch nuevo trae los partidos rotados.
 * force=true ignora la caché (para el refresco manual).
 */
async function fetchMatches(force) {
  if (!force) {
    try {
      const cached = kino.storage.get(MATCHES_CACHE_KEY);
      if (cached) { const arr = JSON.parse(cached); if (Array.isArray(arr)) return arr; }
    } catch {}
  }
  const tokens = await fetchTokens();
  const tokenLive = tokens["/api/match/live"];
  if (!tokenLive) throw kino.error("unavailable", "no sfver token for match/live");

  const url = `${DATA_EU}/sfver${tokenLive}/api/match/live?sportType=0&language=4&stream=true`;
  const r = await kino.fetch(url, { headers: H_DATA });
  if (!r.ok) throw kino.error("unavailable", `match/live ${r.status}`);

  const data = pbData(bodyBytes(r));
  if (!data) throw kino.error("unavailable", "match/live response invalid");

  const matches = parseLive(data);
  kino.log(`[rblive] ${matches.length} matches en vivo (force=${!!force})`);
  try { kino.storage.set(MATCHES_CACHE_KEY, JSON.stringify(matches), { ttlMs: MATCHES_TTL }); } catch {}
  return matches;
}

/** home(): pantalla de inicio con los partidos en vivo. */
export async function home() {
  const matches = await fetchMatches();
  if (!matches.length) throw kino.error("unavailable", "no hay partidos en vivo ahora");
  return [{
    id:    "live-now",
    title: "⚽ En Vivo Ahora",
    items: matches.slice(0, 120).map((m) => {
      const it = matchToItem(m);
      return {
        id:    it.id,
        ref:   it.ref,
        title: it.title,
        kind:  "live",
        ...(it.logo ? { poster: it.logo } : {}),
      };
    }),
  }];
}

function matchToItem(m) {
  const icon  = sportLabel(m.sport);
  const title = m.title || `Match ${m.matchId}`;
  return {
    id:         `m${m.matchId}`,
    ref:        matchWatchUrl(m),
    title:      `${icon} ${title}`,
    categoryId: sportCat(m.sport),
    logo:       matchImage(m),
  };
}

/** liveCategories(): una categoría por deporte presente en los partidos en vivo. */
export async function liveCategories() {
  const matches = await fetchMatches();
  const seen = new Set();
  const cats = [];
  for (const m of matches) {
    const id = sportCat(m.sport);
    if (seen.has(id)) continue;
    seen.add(id);
    cats.push({ id, title: sportName(m.sport), genre: "deportes" });
  }
  return cats.length ? cats : [{ id: "otros", title: "Deportes", genre: "deportes" }];
}

/** liveChannels({categoryId}): los partidos de ESA categoría (Kino la pide por deporte). */
export async function liveChannels(arg) {
  const categoryId = arg && arg.categoryId;
  const matches = await fetchMatches();
  const list = categoryId ? matches.filter((m) => sportCat(m.sport) === categoryId) : matches;
  return { items: list.slice(0, 200).map(matchToItem), next: null };
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

  kino.log(`[rblive] resolve ${watchUrl}`);

  // Hasta 2 intentos: algunos partidos cargan la página pero disparan el .m3u8 tarde
  // (justo al límite del timeout). Sólo se reintenta si la página se movió (redirección o
  // varias peticiones) pero no alcanzó a soltar el stream; un partido realmente fuera de
  // línea no da señales y no vale la pena hacer esperar otros 24 s al usuario.
  for (let attempt = 1; attempt <= 2; attempt++) {
    // sin "match": usa el patrón de medios por defecto (m3u8, mpd, mp4, /hls/…) para no perder nada.
    const opts = { timeoutMs: 24000 };
    if (kino.browser.captureAll) { opts.captureAll = true; opts.returnCookiesOnTimeout = true; }
    const cap = await kino.browser.capture(watchUrl, opts) || {};

    const media = cap.media || [];
    const reqs  = cap.requests || [];
    kino.log(`[rblive] cap#${attempt} finalUrl=${cap.finalUrl} media=${media.length} reqs=${reqs.length} timedOut=${cap.timedOut}`);
    media.slice(0, 5).forEach((m, i) => kino.log(`[rblive]  media[${i}] mime=${m.mime} ${String(m.url).slice(0, 120)}`));

    const hls = media.find((m) => /\.m3u8/i.test(m.url)) || media[0];
    if (hls) {
      kino.log(`[rblive] OK (intento ${attempt}) ${String(hls.url).slice(0, 120)}`);
      return {
        url:  hls.url,
        mime: hls.mime || "application/x-mpegURL",
        headers: hls.headers || {},
      };
    }

    const movedOn = (cap.finalUrl && cap.finalUrl !== watchUrl) || reqs.length > 3;
    if (attempt === 1 && cap.timedOut && movedOn) {
      kino.log(`[rblive] reintento: la página cargó pero el stream no disparó a tiempo`);
      continue;
    }
    reqs.slice(0, 10).forEach((r, i) => kino.log(`[rblive]  req[${i}] ${String(r.url).slice(0, 120)}`));
    break;
  }

  throw kino.error("unavailable", "Este partido no tiene transmisión disponible todavía. Prueba con otro o vuelve cuando empiece.");
}

// ─── Pantalla propia: tabs de categoría + buscador + auto-refresco + botón ───

async function screenItems(force) {
  const matches = await fetchMatches(force);
  return matches.slice(0, 120).map((m) => ({
    id:       `m${m.matchId}`,
    ref:      matchWatchUrl(m),
    teams:    m.title || `Match ${m.matchId}`,
    homeLogo: teamLogo(m.homeLogo),
    awayLogo: teamLogo(m.awayLogo),
    icon:     sportLabel(m.sport),
    cat:      sportCat(m.sport),
    catName:  sportName(m.sport),
  }));
}

/** Filtra los items por categoría (tab) y texto de búsqueda. */
function visibleItems(items, tab, q) {
  let list = items || [];
  if (tab && tab !== "all") list = list.filter((it) => it.cat === tab);
  if (q) { const ql = q.toLowerCase(); list = list.filter((it) => (it.teams || "").toLowerCase().includes(ql)); }
  return list;
}

/** Una fila (lista) con los dos escudos lado a lado, el "vs", los equipos y el deporte; al tocar, reproduce. */
function matchRow(it) {
  const logo = (url) => {
    const n = { type: "Image", aspect: "1:1", fit: "contain", width: 48, height: 48,
      fallback: { type: "Text", text: it.icon, textAlign: "center", style: "h3" } };
    if (url) n.url = url;
    return n;
  };
  return {
    type: "Card",
    variant: "filled",
    padding: 12,
    onTap: { go: { play: { ref: it.ref, kind: "live", title: it.teams } } },
    children: [{
      type: "Row",
      crossAxisAlignment: "center",
      gap: 12,
      children: [
        logo(it.homeLogo),
        { type: "Text", text: "vs", color: "muted", style: "caption" },
        logo(it.awayLogo),
        { type: "Column", flex: 1, gap: 4, children: [
          { type: "Text", text: it.teams, style: "h5", maxLines: 2 },
          { type: "Text", text: `${it.icon} ${it.catName}`, color: "muted", style: "caption" },
        ] },
      ],
    }],
  };
}

/** screen(): Scaffold con AppBar fusionado a la barra de Kino (una sola barra), tabs en la barra,
 *  botón Actualizar como acción, y el cuerpo con el buscador y la grilla. */
export async function screen({ state }) {
  const s = state || {};
  const items = s.items;
  const tab = s.tab || "all";
  const q = s.q || "";

  const appBar = {
    type: "AppBar",
    mergeWithKinoBar: true,
    dense: true,
    leading: { type: "IconButton", icon: "close", labelText: "Cerrar", onPressed: { go: { close: true } } },
    title: "En Vivo",
    actions: [
      { type: "IconButton", icon: "refresh", labelText: "Actualizar", onPressed: { event: "refresh" } },
    ],
  };

  const search = { type: "TextField", key: "q", kind: "search", value: q,
    hint: "Buscar equipo o liga…", onChanged: { event: "search" } };

  let body;
  if (items == null) {
    body = { type: "Column", padding: 12, gap: 12, children: [search, { type: "CircularProgressIndicator", text: "Cargando…" }] };
  } else {
    // tabs por deporte presente → en el bottom del AppBar
    const seen = new Set();
    const tabs = [{ value: "all", label: "Todos" }];
    for (const it of items) {
      if (seen.has(it.cat)) continue;
      seen.add(it.cat);
      tabs.push({ value: it.cat, label: it.catName });
    }
    if (tabs.length > 2) {
      appBar.bottom = { type: "TabBar", tabs, value: tabs.some((t) => t.value === tab) ? tab : "all", onChanged: { event: "tab" } };
    }

    const vis = visibleItems(items, tab, q);
    const children = [search];
    if (!vis.length) {
      children.push({ type: "emptyState", title: q ? "Sin resultados" : "Sin partidos en vivo", icon: "live" });
    } else {
      children.push({ type: "ListView", flex: 1, columns: 1, items: vis.map(matchRow) });
    }
    body = { type: "Column", padding: 12, gap: 12, children };
  }

  return { type: "Scaffold", appBar, body };
}

/**
 * screenEvent(): open/tick cargan la lista (cache); refresh fuerza; tab/search ajustan los filtros
 * conservando la lista. Un tap en una tarjeta reproduce (titleGrid kind:"live" → resolve).
 */
export async function screenEvent({ name, value, state }) {
  const s = state || {};
  let items = s.items;
  let tab = s.tab || "all";
  let q = s.q || "";

  if (name === "tab") {
    tab = String(value == null ? "all" : value);
  } else if (name === "search") {
    q = String(value == null ? "" : value);
  } else {
    items = await screenItems(name === "refresh"); // open / tick / refresh
  }
  if (!items) items = await screenItems(false); // fallback si no llegó el state

  const ans = { state: { items, tab, q } };
  if (name === "refresh") ans.toast = "Lista actualizada";
  return ans;
}
