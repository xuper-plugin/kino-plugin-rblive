// Kino plugin: RBLive Deportes
// Partidos en vivo de fútbol, baloncesto y tenis desde rbtvplus18 / rblive.
// Flujo: tokens sfver → match/live (protobuf) → channel/detail → AES/CTR sign → HLS

const DATA_EU = "https://apis-data-defra10.tcpwe138stya.ru";
const DATA_US = "https://apis-data10.tcpwe138stya.ru";
const LIVE    = "https://apis-live.ta2mnt200stayr2.cfd";
const DIGIT   = "snd";

const H_DATA = {
  "Origin":  "https://www.rbtvplus18.website",
  "Referer": "https://www.rbtvplus18.website/es",
  "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
};
const H_LIVE = { ...H_DATA, "digit": DIGIT, "language": "4" };

// ─── AES-256-CTR (pure JS, para firmar la rb-session) ───────────────────────
// Implementación mínima sólo para AES/CTR/NoPadding, confirmada del APK.

const AES_SBOX = new Uint8Array([
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
]);

const AES_RCON = new Uint8Array([0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36]);

function xtime(x) { return ((x << 1) ^ ((x & 0x80) ? 0x1b : 0)) & 0xff; }

function aesSubWord(w) {
  return (AES_SBOX[(w >> 24) & 0xff] << 24) | (AES_SBOX[(w >> 16) & 0xff] << 16) |
         (AES_SBOX[(w >> 8)  & 0xff] <<  8) |  AES_SBOX[ w        & 0xff];
}

function rotWord(w) { return ((w << 8) | (w >>> 24)) >>> 0; }

function aesKeyExpand(key) {
  const nk = key.length / 4;      // 8 for AES-256
  const nr = nk + 6;              // 14 rounds for AES-256
  const w  = new Uint32Array((nr + 1) * 4);
  for (let i = 0; i < nk; i++) {
    w[i] = ((key[i*4] << 24) | (key[i*4+1] << 16) | (key[i*4+2] << 8) | key[i*4+3]) >>> 0;
  }
  for (let i = nk; i < (nr + 1) * 4; i++) {
    let temp = w[i - 1];
    if (i % nk === 0) temp = (aesSubWord(rotWord(temp)) ^ (AES_RCON[i/nk - 1] << 24)) >>> 0;
    else if (nk > 6 && i % nk === 4) temp = aesSubWord(temp);
    w[i] = (w[i - nk] ^ temp) >>> 0;
  }
  return w;
}

function aesEncryptBlock(state, rk) {
  const nr = rk.length / 4 - 1;
  let s = [...state];

  function ark(r) {
    for (let c = 0; c < 4; c++) {
      s[c*4]   ^= (rk[r*4+c] >> 24) & 0xff;
      s[c*4+1] ^= (rk[r*4+c] >> 16) & 0xff;
      s[c*4+2] ^= (rk[r*4+c] >>  8) & 0xff;
      s[c*4+3] ^=  rk[r*4+c]        & 0xff;
    }
  }

  // AddRoundKey(0)
  for (let c = 0; c < 4; c++) {
    s[c*4]   ^= (rk[c] >> 24) & 0xff;
    s[c*4+1] ^= (rk[c] >> 16) & 0xff;
    s[c*4+2] ^= (rk[c] >>  8) & 0xff;
    s[c*4+3] ^=  rk[c]        & 0xff;
  }

  for (let round = 1; round <= nr; round++) {
    // SubBytes
    for (let i = 0; i < 16; i++) s[i] = AES_SBOX[s[i]];
    // ShiftRows
    const t1=s[1],t5=s[5],t9=s[9],t13=s[13];
    s[1]=t5; s[5]=t9;  s[9]=t13; s[13]=t1;
    const t2=s[2],t6=s[6],t10=s[10],t14=s[14];
    s[2]=t10; s[6]=t14; s[10]=t2; s[14]=t6;
    const t3=s[3],t7=s[7],t11=s[11],t15=s[15];
    s[3]=t15; s[7]=t3; s[11]=t7; s[15]=t11;
    // MixColumns (skip on last round)
    if (round < nr) {
      for (let c = 0; c < 4; c++) {
        const a0=s[c*4],a1=s[c*4+1],a2=s[c*4+2],a3=s[c*4+3];
        s[c*4]   = xtime(a0)^xtime(a1)^a1^a2^a3;
        s[c*4+1] = a0^xtime(a1)^xtime(a2)^a2^a3;
        s[c*4+2] = a0^a1^xtime(a2)^xtime(a3)^a3;
        s[c*4+3] = xtime(a0)^a0^a1^a2^xtime(a3);
      }
    }
    // AddRoundKey
    for (let c = 0; c < 4; c++) {
      s[c*4]   ^= (rk[round*4+c] >> 24) & 0xff;
      s[c*4+1] ^= (rk[round*4+c] >> 16) & 0xff;
      s[c*4+2] ^= (rk[round*4+c] >>  8) & 0xff;
      s[c*4+3] ^=  rk[round*4+c]        & 0xff;
    }
  }
  return new Uint8Array(s);
}

function aesCtr(keyBytes, ivBytes, plaintext) {
  const rk = aesKeyExpand(keyBytes);
  const out = new Uint8Array(plaintext.length);
  const ctr = new Uint8Array(16);
  ctr.set(ivBytes);
  for (let i = 0; i < plaintext.length; i += 16) {
    // Build AES input from counter (column-major: Java/Android CTR layout)
    const block = [
      ctr[0],ctr[1],ctr[2],ctr[3],  ctr[4],ctr[5],ctr[6],ctr[7],
      ctr[8],ctr[9],ctr[10],ctr[11], ctr[12],ctr[13],ctr[14],ctr[15],
    ];
    const ks = aesEncryptBlock(block, rk);
    for (let j = 0; j < 16 && i+j < plaintext.length; j++) {
      out[i+j] = plaintext[i+j] ^ ks[j];
    }
    // Increment counter big-endian (from byte 15)
    for (let k = 15; k >= 0; k--) { if (++ctr[k]) break; }
  }
  return out;
}

// ─── Base64 (sin btoa — QuickJS puede no tenerlo) ───────────────────────────

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i+1] ?? 0, c = bytes[i+2] ?? 0;
    s += B64[a >> 2];
    s += B64[((a & 3) << 4) | (b >> 4)];
    s += (i+1 < bytes.length) ? B64[((b & 15) << 2) | (c >> 6)] : "=";
    s += (i+2 < bytes.length) ? B64[c & 63] : "=";
  }
  return s;
}

function utf8(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) { bytes.push(0xc0 | (c >> 6)); bytes.push(0x80 | (c & 0x3f)); }
    else { bytes.push(0xe0 | (c >> 12)); bytes.push(0x80 | ((c >> 6) & 0x3f)); bytes.push(0x80 | (c & 0x3f)); }
  }
  return new Uint8Array(bytes);
}

// ─── Firma de URL del stream (encodeStreamTokenA del APK) ────────────────────

function signUrl(rbSession, streamUrl, aesKey, aesIv) {
  const keyBytes = utf8(aesKey);
  const ivBytes  = utf8(aesIv);
  const ct = aesCtr(keyBytes, ivBytes, utf8(rbSession));
  let b64 = base64(ct).replace(/\n/g, "").replace(/\r/g, "");
  const urlSafe = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, ".");
  const suffix  = rbSession.length > 14 && rbSession[14] === "7" ? "b" : "a";
  const token   = encodeURIComponent(urlSafe) + suffix;

  // Reconstruir URL: {origin}/token-{token}{pathname}{search}
  const cut = streamUrl.indexOf("://");
  if (cut < 0) return streamUrl;
  const rest  = streamUrl.slice(cut + 3);
  const slash = rest.indexOf("/");
  const origin   = streamUrl.slice(0, cut + 3) + (slash < 0 ? rest : rest.slice(0, slash));
  const pathSearch = slash < 0 ? "" : rest.slice(slash);
  return `${origin}/token-${token}${pathSearch}`;
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
  if (code !== 200) {
    kino.log(`[rblive] pb code=${code}`);
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
  for (const entryBuf of (top[10] || [])) {
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
    const raw = new Uint8Array(await r.arrayBuffer());
    Object.assign(tokens, parseBsTokens(raw));
  }
  return tokens;
}

// ─── Match/live → lista de canales ──────────────────────────────────────────

/** Extrae entradas de match/live. Devuelve [{id, matchId, title, sport}] */
function parseLive(data) {
  const matches = [];
  const seen = new Set();

  function walk(buf, depth) {
    if (depth > 5) return;
    const f = parseFlat(buf);
    // Buscar varint en rango matchId (2M-5.5M para fútbol/basket/tenis)
    for (const [fn, vals] of Object.entries(f)) {
      for (const v of vals) {
        if (typeof v === "number" && v >= 2_000_000 && v <= 5_500_000 && !seen.has(v)) {
          seen.add(v);
          // Recoger strings cerca (todos los campos string del mismo sub-mensaje)
          const strs = [];
          for (const vals2 of Object.values(f)) {
            for (const v2 of vals2) {
              if (v2 instanceof Uint8Array && v2.length > 2 && v2.length < 100) {
                const s = bytes2str(v2);
                // Texto imprimible que no parezca URL ni hash
                if (/^[A-Za-zÀ-ɏ][A-Za-z0-9À-ɏ &\-'\.]{2,}$/.test(s)) strs.push(s);
              }
            }
          }
          matches.push({ matchId: v, strings: strs });
        }
        // Recursión en sub-mensajes
        if (v instanceof Uint8Array && v.length > 4) walk(v, depth + 1);
      }
    }
  }

  walk(data, 0);
  return matches;
}

function sportLabel(matchId) {
  if (matchId >= 4_000_000) return "⚽";
  if (matchId >= 3_000_000) return "🎾";
  if (matchId >= 2_200_000) return "🏀";
  return "🔴";
}

// ─── Stream IDs desde match/detail ──────────────────────────────────────────

function parseStreamIds(data) {
  const ids = [];
  const seen = new Set();
  function walk(buf, depth) {
    if (depth > 6) return;
    const f = parseFlat(buf);
    for (const vals of Object.values(f)) {
      for (const v of vals) {
        // streamId: varint 6-7 dígitos (900k-2M)
        if (typeof v === "number" && v >= 900_000 && v <= 2_000_000 && !seen.has(v)) {
          seen.add(v);
          ids.push(v);
        }
        if (v instanceof Uint8Array && v.length > 4) walk(v, depth + 1);
      }
    }
  }
  walk(data, 0);
  return ids;
}

// ─── URL del stream (channel/detail en LIVE API) ─────────────────────────────

async function fetchStreamUrl(matchId, streamId) {
  const url = `${LIVE}/channel/detail`;
  const params = `?sportType=1&streamId=${streamId}&matchId=${matchId}&digit=${DIGIT}&language=4`;
  const r = await kino.fetch(url + params, { headers: H_LIVE });
  const raw = new Uint8Array(await r.arrayBuffer());
  kino.log(`[rblive] channel/detail status=${r.status} bytes=${raw.length}`);

  const rbSession = r.headers ? r.headers.get("rb-session") : "";

  if (!r.ok || raw.length < 10) return null;

  // Buscar URL HLS en el protobuf (string con "http" y ".m3u8")
  let streamUrl = "";
  function walkUrl(buf, depth) {
    if (depth > 5) return;
    const f = parseFlat(buf);
    for (const vals of Object.values(f)) {
      for (const v of vals) {
        if (v instanceof Uint8Array) {
          const s = bytes2str(v);
          if (s.startsWith("http") && (s.includes(".m3u8") || s.includes("stream") || s.includes(".ts"))) {
            if (s.length > streamUrl.length) streamUrl = s;
          }
          if (v.length > 4) walkUrl(v, depth + 1);
        }
      }
    }
  }
  walkUrl(raw, 0);

  return { streamUrl, rbSession };
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

/** liveCategories(): categorías de deportes disponibles. */
export async function liveCategories() {
  return [
    { id: "0", name: "Todos" },
    { id: "1", name: "Fútbol" },
    { id: "2", name: "Basketball" },
    { id: "3", name: "Baseball" },
    { id: "4", name: "Tenis" },
    { id: "5", name: "Voleibol" },
    { id: "6", name: "Hockey" },
  ];
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

  const raw  = new Uint8Array(await r.arrayBuffer());
  const data = pbData(raw);
  if (!data) throw kino.error("unavailable", "match/live response invalid");

  const matches = parseLive(data);
  kino.log(`[rblive] ${matches.length} matches en vivo`);

  const items = matches.slice(0, 80).map((m) => {
    const icon  = sportLabel(m.matchId);
    const title = m.strings.length > 0
      ? m.strings.slice(0, 2).join(" vs ")
      : `Match ${m.matchId}`;
    return {
      id:    `m${m.matchId}`,
      ref:   String(m.matchId),
      title: `${icon} ${title}`,
    };
  });

  if (!items.length) throw kino.error("unavailable", "no live matches right now");
  return { items };
}

/** resolve(ref): obtiene la URL HLS firmada para un partido. */
export async function resolve(ref) {
  const matchId = Number(ref);
  if (!matchId) throw kino.error("not_found", "invalid ref");

  // Secretos AES (sellados en kino-plugin.json)
  const aesKey = await kino.secrets.get("aes_key");
  const aesIv  = await kino.secrets.get("aes_iv");

  // 1. Token para match/detail
  const tokens = await fetchTokens();
  const tokenDetail = tokens["/api/match/detail"];
  if (!tokenDetail) throw kino.error("unavailable", "no sfver token for match/detail");

  // 2. Stream IDs desde match/detail
  const detailUrl = `${DATA_EU}/sfver${tokenDetail}/api/match/detail?sportType=1&matchId=${matchId}&language=4&stream=true`;
  const dr = await kino.fetch(detailUrl, { headers: H_DATA });
  if (!dr.ok) throw kino.error("unavailable", `match/detail ${dr.status}`);
  const detailRaw  = new Uint8Array(await dr.arrayBuffer());
  const detailData = pbData(detailRaw);
  const streamIds  = detailData ? parseStreamIds(detailData) : [];
  kino.log(`[rblive] matchId=${matchId} streamIds=${streamIds.join(",")}`);

  if (!streamIds.length) throw kino.error("not_found", "no streams for this match");

  // 3. Intentar cada stream hasta conseguir la URL
  for (const sid of streamIds.slice(0, 5)) {
    const detail = await fetchStreamUrl(matchId, sid);
    if (!detail) continue;
    const { streamUrl, rbSession } = detail;

    kino.log(`[rblive] sid=${sid} url=${streamUrl?.slice(0,60)} rb=${rbSession?.slice(0,30)}`);

    if (streamUrl && rbSession && aesKey && aesIv) {
      // Firmar la URL con AES/CTR (método encodeStreamTokenA del APK)
      const signed = signUrl(rbSession, streamUrl, aesKey, aesIv);
      kino.log(`[rblive] signed=${signed.slice(0,80)}`);
      return {
        url: signed,
        mime: "application/x-mpegURL",
        headers: {
          "Referer":    "https://www.rbtvplus18.website/",
          "Origin":     "https://www.rbtvplus18.website",
          "User-Agent": H_DATA["User-Agent"],
        },
      };
    }

    if (streamUrl && !rbSession) {
      // URL sin firma (posiblemente ya firmada o CDN abierto)
      return {
        url: streamUrl,
        mime: "application/x-mpegURL",
        headers: H_DATA,
      };
    }
  }

  throw kino.error("unavailable", "all streams returned oklp or empty");
}
