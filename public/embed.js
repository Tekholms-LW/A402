/**
 * A402 Embed Widget — embed.js
 * Drop-in script for any website to embed paywalled A402 content.
 *
 * Usage:
 *   <div class="a402-content"
 *        data-vault="0x..."
 *        data-resource="video-001"
 *        data-theme="dark">        <!-- optional: "dark" | "light" | "auto" (default) -->
 *   </div>
 *   <script src="embed.js"></script>
 *
 * Self-contained: bundles a minimal keccak256, ABI encoder, and RPC client.
 * Renders inside Shadow DOM so host page CSS cannot interfere.
 * Handles: wallet connect → network switch → access check → payment → content unlock.
 *
 * (c) 2025 Apertum / A402 Protocol
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  //  CONSTANTS
  // ═══════════════════════════════════════════════════════════════

  const RPC = 'https://rpc.apertum.io/ext/bc/YDJ1r9RMkewATmA7B35q1bdV18aywzmdiXwd9zGBq3uQjsCnn/rpc';
  const CHAIN_ID = 2786;
  const CHAIN_HEX = '0x' + CHAIN_ID.toString(16);
  const EXPLORER = 'https://explorer.apertum.io';

  // ═══════════════════════════════════════════════════════════════
  //  MINIMAL KECCAK-256 (self-contained, no dependencies)
  //  Ported from js-sha3 — only keccak256 is included.
  // ═══════════════════════════════════════════════════════════════

  const keccak256 = (() => {
    const HEX_CHARS = '0123456789abcdef';
    const KECCAK_PADDING = [1, 256, 65536, 16777216];
    const SHIFT = [0, 8, 16, 24];
    const RC = [
      1, 0, 32898, 0, 32906, 2147483648, 2147516416, 2147483648,
      32907, 0, 2147483649, 0, 2147516545, 2147483648, 32777, 2147483648,
      138, 0, 136, 0, 2147516425, 0, 2147483658, 0,
      2147516555, 0, 139, 2147483648, 32905, 2147483648, 32771, 2147483648,
      32770, 2147483648, 128, 2147483648, 32778, 0, 2147483658, 2147483648,
      2147516545, 2147483648, 32896, 2147483648, 2147483649, 0, 2147516424, 2147483648,
    ];

    function keccak(bits) {
      const blockSize = (1600 - bits * 2) / 32;
      const byteCount = blockSize * 4;

      return function (message) {
        const bytes = typeof message === 'string'
          ? Array.from(new TextEncoder().encode(message))
          : Array.from(message);
        const length = bytes.length;
        const blocks = [];
        const s = new Array(50).fill(0);
        let blockCount = blockSize;

        // Absorb
        let i, index = 0, start = 0;
        const l = length;
        for (i = 0; i < blockCount + 1; ++i) blocks[i] = 0;

        for (i = 0; i < l; ++i) {
          blocks[index >> 2] |= bytes[i] << SHIFT[index & 3];
          if (++index >= byteCount) {
            index = 0;
            for (let j = 0; j < blockCount; ++j) s[j] ^= blocks[j];
            keccakF(s);
            for (let j = 0; j < blockCount + 1; ++j) blocks[j] = 0;
          }
        }

        // Padding
        blocks[index >> 2] |= KECCAK_PADDING[index & 3];
        blocks[blockCount - 1] |= 2147483648;
        for (let j = 0; j < blockCount; ++j) s[j] ^= blocks[j];
        keccakF(s);

        // Squeeze
        let hex = '';
        const outputBlocks = bits / 32;
        for (i = 0, index = 0; i < outputBlocks;) {
          const h = s[i], l2 = s[i + 1];
          hex += HEX_CHARS[(h >> 4) & 0x0f] + HEX_CHARS[h & 0x0f] +
            HEX_CHARS[(h >> 12) & 0x0f] + HEX_CHARS[(h >> 8) & 0x0f] +
            HEX_CHARS[(h >> 20) & 0x0f] + HEX_CHARS[(h >> 16) & 0x0f] +
            HEX_CHARS[(h >> 28) & 0x0f] + HEX_CHARS[(h >> 24) & 0x0f] +
            HEX_CHARS[(l2 >> 4) & 0x0f] + HEX_CHARS[l2 & 0x0f] +
            HEX_CHARS[(l2 >> 12) & 0x0f] + HEX_CHARS[(l2 >> 8) & 0x0f] +
            HEX_CHARS[(l2 >> 20) & 0x0f] + HEX_CHARS[(l2 >> 16) & 0x0f] +
            HEX_CHARS[(l2 >> 28) & 0x0f] + HEX_CHARS[(l2 >> 24) & 0x0f];
          i += 2;
        }
        return hex;
      };
    }

    function keccakF(s) {
      let h, l, n, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9,
        b0, b1, b2, b3, b4, b5, b6, b7, b8, b9,
        b10, b11, b12, b13, b14, b15, b16, b17, b18, b19,
        b20, b21, b22, b23, b24, b25, b26, b27, b28, b29,
        b30, b31, b32, b33, b34, b35, b36, b37, b38, b39,
        b40, b41, b42, b43, b44, b45, b46, b47, b48, b49;

      for (n = 0; n < 48; n += 2) {
        c0 = s[0] ^ s[10] ^ s[20] ^ s[30] ^ s[40];
        c1 = s[1] ^ s[11] ^ s[21] ^ s[31] ^ s[41];
        c2 = s[2] ^ s[12] ^ s[22] ^ s[32] ^ s[42];
        c3 = s[3] ^ s[13] ^ s[23] ^ s[33] ^ s[43];
        c4 = s[4] ^ s[14] ^ s[24] ^ s[34] ^ s[44];
        c5 = s[5] ^ s[15] ^ s[25] ^ s[35] ^ s[45];
        c6 = s[6] ^ s[16] ^ s[26] ^ s[36] ^ s[46];
        c7 = s[7] ^ s[17] ^ s[27] ^ s[37] ^ s[47];
        c8 = s[8] ^ s[18] ^ s[28] ^ s[38] ^ s[48];
        c9 = s[9] ^ s[19] ^ s[29] ^ s[39] ^ s[49];

        h = c8 ^ ((c2 << 1) | (c3 >>> 31)); l = c9 ^ ((c3 << 1) | (c2 >>> 31));
        s[0] ^= h; s[1] ^= l; s[10] ^= h; s[11] ^= l; s[20] ^= h; s[21] ^= l; s[30] ^= h; s[31] ^= l; s[40] ^= h; s[41] ^= l;
        h = c0 ^ ((c4 << 1) | (c5 >>> 31)); l = c1 ^ ((c5 << 1) | (c4 >>> 31));
        s[2] ^= h; s[3] ^= l; s[12] ^= h; s[13] ^= l; s[22] ^= h; s[23] ^= l; s[32] ^= h; s[33] ^= l; s[42] ^= h; s[43] ^= l;
        h = c2 ^ ((c6 << 1) | (c7 >>> 31)); l = c3 ^ ((c7 << 1) | (c6 >>> 31));
        s[4] ^= h; s[5] ^= l; s[14] ^= h; s[15] ^= l; s[24] ^= h; s[25] ^= l; s[34] ^= h; s[35] ^= l; s[44] ^= h; s[45] ^= l;
        h = c4 ^ ((c8 << 1) | (c9 >>> 31)); l = c5 ^ ((c9 << 1) | (c8 >>> 31));
        s[6] ^= h; s[7] ^= l; s[16] ^= h; s[17] ^= l; s[26] ^= h; s[27] ^= l; s[36] ^= h; s[37] ^= l; s[46] ^= h; s[47] ^= l;
        h = c6 ^ ((c0 << 1) | (c1 >>> 31)); l = c7 ^ ((c1 << 1) | (c0 >>> 31));
        s[8] ^= h; s[9] ^= l; s[18] ^= h; s[19] ^= l; s[28] ^= h; s[29] ^= l; s[38] ^= h; s[39] ^= l; s[48] ^= h; s[49] ^= l;

        b0 = s[0]; b1 = s[1];
        b32 = (s[11] << 4) | (s[10] >>> 28); b33 = (s[10] << 4) | (s[11] >>> 28);
        b14 = (s[20] << 3) | (s[21] >>> 29); b15 = (s[21] << 3) | (s[20] >>> 29);
        b46 = (s[31] << 9) | (s[30] >>> 23); b47 = (s[30] << 9) | (s[31] >>> 23);
        b28 = (s[40] << 18) | (s[41] >>> 14); b29 = (s[41] << 18) | (s[40] >>> 14);
        b20 = (s[2] << 1) | (s[3] >>> 31); b21 = (s[3] << 1) | (s[2] >>> 31);
        b2 = (s[13] << 12) | (s[12] >>> 20); b3 = (s[12] << 12) | (s[13] >>> 20);
        b34 = (s[22] << 10) | (s[23] >>> 22); b35 = (s[23] << 10) | (s[22] >>> 22);
        b16 = (s[33] << 13) | (s[32] >>> 19); b17 = (s[32] << 13) | (s[33] >>> 19);
        b48 = (s[42] << 2) | (s[43] >>> 30); b49 = (s[43] << 2) | (s[42] >>> 30);
        b40 = (s[5] << 30) | (s[4] >>> 2); b41 = (s[4] << 30) | (s[5] >>> 2);
        b22 = (s[14] << 6) | (s[15] >>> 26); b23 = (s[15] << 6) | (s[14] >>> 26);
        b4 = (s[25] << 11) | (s[24] >>> 21); b5 = (s[24] << 11) | (s[25] >>> 21);
        b36 = (s[34] << 15) | (s[35] >>> 17); b37 = (s[35] << 15) | (s[34] >>> 17);
        b18 = (s[45] << 29) | (s[44] >>> 3); b19 = (s[44] << 29) | (s[45] >>> 3);
        b10 = (s[6] << 28) | (s[7] >>> 4); b11 = (s[7] << 28) | (s[6] >>> 4);
        b42 = (s[17] << 23) | (s[16] >>> 9); b43 = (s[16] << 23) | (s[17] >>> 9);
        b24 = (s[26] << 25) | (s[27] >>> 7); b25 = (s[27] << 25) | (s[26] >>> 7);
        b6 = (s[36] << 21) | (s[37] >>> 11); b7 = (s[37] << 21) | (s[36] >>> 11);
        b38 = (s[47] << 24) | (s[46] >>> 8); b39 = (s[46] << 24) | (s[47] >>> 8);
        b30 = (s[8] << 27) | (s[9] >>> 5); b31 = (s[9] << 27) | (s[8] >>> 5);
        b12 = (s[18] << 20) | (s[19] >>> 12); b13 = (s[19] << 20) | (s[18] >>> 12);
        b44 = (s[29] << 7) | (s[28] >>> 25); b45 = (s[28] << 7) | (s[29] >>> 25);
        b26 = (s[38] << 8) | (s[39] >>> 24); b27 = (s[39] << 8) | (s[38] >>> 24);
        b8 = (s[48] << 14) | (s[49] >>> 18); b9 = (s[49] << 14) | (s[48] >>> 18);

        s[0] = b0 ^ (~b2 & b4); s[1] = b1 ^ (~b3 & b5);
        s[10] = b10 ^ (~b12 & b14); s[11] = b11 ^ (~b13 & b15);
        s[20] = b20 ^ (~b22 & b24); s[21] = b21 ^ (~b23 & b25);
        s[30] = b30 ^ (~b32 & b34); s[31] = b31 ^ (~b33 & b35);
        s[40] = b40 ^ (~b42 & b44); s[41] = b41 ^ (~b43 & b45);
        s[2] = b2 ^ (~b4 & b6); s[3] = b3 ^ (~b5 & b7);
        s[12] = b12 ^ (~b14 & b16); s[13] = b13 ^ (~b15 & b17);
        s[22] = b22 ^ (~b24 & b26); s[23] = b23 ^ (~b25 & b27);
        s[32] = b32 ^ (~b34 & b36); s[33] = b33 ^ (~b35 & b37);
        s[42] = b42 ^ (~b44 & b46); s[43] = b43 ^ (~b45 & b47);
        s[4] = b4 ^ (~b6 & b8); s[5] = b5 ^ (~b7 & b9);
        s[14] = b14 ^ (~b16 & b18); s[15] = b15 ^ (~b17 & b19);
        s[24] = b24 ^ (~b26 & b28); s[25] = b25 ^ (~b27 & b29);
        s[34] = b34 ^ (~b36 & b38); s[35] = b35 ^ (~b37 & b39);
        s[44] = b44 ^ (~b46 & b48); s[45] = b45 ^ (~b47 & b49);
        s[6] = b6 ^ (~b8 & b0); s[7] = b7 ^ (~b9 & b1);
        s[16] = b16 ^ (~b18 & b10); s[17] = b17 ^ (~b19 & b11);
        s[26] = b26 ^ (~b28 & b20); s[27] = b27 ^ (~b29 & b21);
        s[36] = b36 ^ (~b38 & b30); s[37] = b37 ^ (~b39 & b31);
        s[46] = b46 ^ (~b48 & b40); s[47] = b47 ^ (~b49 & b41);
        s[8] = b8 ^ (~b0 & b2); s[9] = b9 ^ (~b1 & b3);
        s[18] = b18 ^ (~b10 & b12); s[19] = b19 ^ (~b11 & b13);
        s[28] = b28 ^ (~b20 & b22); s[29] = b29 ^ (~b21 & b23);
        s[38] = b38 ^ (~b30 & b32); s[39] = b39 ^ (~b31 & b33);
        s[48] = b48 ^ (~b40 & b42); s[49] = b49 ^ (~b41 & b43);

        s[0] ^= RC[n]; s[1] ^= RC[n + 1];
      }
    }

    return keccak(256);
  })();

  // ═══════════════════════════════════════════════════════════════
  //  ABI ENCODING HELPERS
  // ═══════════════════════════════════════════════════════════════

  function fnSel(sig) { return keccak256(sig).slice(0, 8); }
  function padUint(n) { return BigInt(n).toString(16).padStart(64, '0'); }
  function padAddr(a) { return a.replace('0x', '').toLowerCase().padStart(64, '0'); }
  function encStr(s) {
    const b = new TextEncoder().encode(s);
    let h = '';
    for (const c of b) h += c.toString(16).padStart(2, '0');
    return padUint(b.length) + h.padEnd(Math.ceil(h.length / 64) * 64, '0');
  }
  function hexStr(h) {
    let s = '';
    for (let i = 0; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
    return s;
  }
  function fromWei(w) {
    const s = BigInt(w).toString().padStart(19, '0');
    const whole = s.slice(0, -18) || '0';
    const frac = s.slice(-18).replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
  }

  // ═══════════════════════════════════════════════════════════════
  //  RPC
  // ═══════════════════════════════════════════════════════════════

  let rpcId = 1;
  async function rpc(method, params) {
    const r = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return d.result;
  }
  async function ethCall(to, data) { return rpc('eth_call', [{ to, data }, 'latest']); }

  // ═══════════════════════════════════════════════════════════════
  //  ON-CHAIN READS
  // ═══════════════════════════════════════════════════════════════

  async function getResource(vault, resourceId) {
    const s = fnSel('getResource(string)');
    const data = '0x' + s + padUint(32) + encStr(resourceId);
    const result = await ethCall(vault, data);
    const d = result.slice(2);

    const price = BigInt('0x' + d.slice(0, 64)).toString();
    const lifetime = BigInt('0x' + d.slice(64, 128)) === 1n;
    const active = BigInt('0x' + d.slice(128, 192)) === 1n;
    const exists = BigInt('0x' + d.slice(192, 256)) === 1n;

    const typeOff = Number(BigInt('0x' + d.slice(256, 320))) * 2;
    const typeLen = Number(BigInt('0x' + d.slice(typeOff, typeOff + 64)));
    const contentType = hexStr(d.slice(typeOff + 64, typeOff + 64 + typeLen * 2));

    const refOff = Number(BigInt('0x' + d.slice(320, 384))) * 2;
    const refLen = Number(BigInt('0x' + d.slice(refOff, refOff + 64)));
    const contentRef = hexStr(d.slice(refOff + 64, refOff + 64 + refLen * 2));

    const totalPayments = Number(BigInt('0x' + d.slice(384, 448)));

    return { price, lifetime, active, exists, contentType, contentRef, totalPayments };
  }

  async function hasAccess(vault, resourceId, userAddress) {
    const s = fnSel('hasAccess(string,address)');
    const data = '0x' + s + padUint(64) + padAddr(userAddress) + encStr(resourceId);
    const result = await ethCall(vault, data);
    return BigInt(result) === 1n;
  }

  // ═══════════════════════════════════════════════════════════════
  //  CONTENT SOURCE DETECTION
  // ═══════════════════════════════════════════════════════════════

  function detectSource(ref) {
    if (!ref) return { type: 'unknown', value: '' };
    if (ref.startsWith('ipfs://') || ref.includes('/ipfs/') || ref.includes('/ipns/'))
      return { type: 'ipfs', value: ref };
    if (/\.(mp4|webm|ogg|mov|m3u8)(\?.*)?$/i.test(ref) && ref.startsWith('http'))
      return { type: 'direct', value: ref };
    // Bare YouTube IDs (11 chars) or anything else → treat as YouTube
    if (/^[a-zA-Z0-9_-]{11}$/.test(ref)) return { type: 'youtube', value: ref };
    // YouTube URL
    const ytMatch = ref.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/
    );
    if (ytMatch) return { type: 'youtube', value: ytMatch[1] };
    // Bare CID
    if (/^(Qm[a-zA-Z0-9]{44,}|bafy[a-zA-Z0-9]{50,})$/.test(ref))
      return { type: 'ipfs', value: 'ipfs://' + ref };
    // Generic URL
    if (ref.startsWith('http')) return { type: 'direct', value: ref };
    return { type: 'unknown', value: ref };
  }

  // ═══════════════════════════════════════════════════════════════
  //  THEME DETECTION
  // ═══════════════════════════════════════════════════════════════

  function resolveTheme(requested) {
    if (requested === 'light') return 'light';
    if (requested === 'dark') return 'dark';
    // Auto-detect from host page
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  }

  // ═══════════════════════════════════════════════════════════════
  //  CSS (injected into Shadow DOM)
  // ═══════════════════════════════════════════════════════════════

  function buildCSS(theme) {
    const dark = theme === 'dark';
    return `
      :host {
        display: block;
        width: 100%;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        line-height: 1.5;
        color-scheme: ${dark ? 'dark' : 'light'};
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }

      .a402-widget {
        --bg: ${dark ? '#0b0d13' : '#ffffff'};
        --bg-card: ${dark ? '#0f1219' : '#f8f9fb'};
        --bg-overlay: ${dark ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.6)'};
        --border: ${dark ? '#1c2233' : '#e2e5ea'};
        --text: ${dark ? '#b8bfce' : '#4a5568'};
        --text-bright: ${dark ? '#eaf0f9' : '#1a202c'};
        --text-dim: ${dark ? '#5c6478' : '#a0aec0'};
        --blue: #3272e8;
        --blue-light: #5a94f5;
        --green: #22c55e;
        --amber: #eab308;
        --red: #ef4444;
        --mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
        --r: 12px;
        width: 100%;
        border-radius: var(--r);
        overflow: hidden;
        border: 1px solid var(--border);
        background: var(--bg);
      }

      /* ── Video area ── */
      .video-area {
        position: relative;
        width: 100%;
        aspect-ratio: 16 / 9;
        background: #000;
        overflow: hidden;
      }
      .video-area iframe, .video-area video {
        width: 100%; height: 100%; border: none;
        position: absolute; inset: 0;
      }
      .video-area img.thumb {
        width: 100%; height: 100%; object-fit: cover;
        position: absolute; inset: 0; z-index: 0;
      }

      /* ── Lock overlay ── */
      .lock-overlay {
        position: absolute; inset: 0; z-index: 5;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        background: var(--bg-overlay);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        transition: opacity 0.4s ease;
        gap: 10px;
      }
      .lock-overlay.hidden { opacity: 0; pointer-events: none; }
      .lock-icon svg {
        width: 40px; height: 40px;
        stroke: rgba(255,255,255,0.7); fill: none;
        stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;
      }
      .lock-text {
        font-size: 13px; color: rgba(255,255,255,0.8);
        text-align: center; line-height: 1.6;
      }
      .lock-text strong { display: block; font-size: 15px; color: #fff; }

      /* ── Info bar ── */
      .info-bar {
        padding: 16px 18px;
        display: flex; flex-direction: column; gap: 12px;
        background: var(--bg-card);
      }
      .info-top {
        display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
        flex-wrap: wrap;
      }
      .info-left { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .res-name {
        font-size: 14px; font-weight: 600; color: var(--text-bright);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .res-meta {
        display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
      }
      .chip {
        font-family: var(--mono); font-size: 10px; font-weight: 500;
        padding: 3px 8px; border-radius: 5px;
        background: ${dark ? 'rgba(50,114,232,0.08)' : 'rgba(50,114,232,0.06)'};
        color: var(--blue-light);
        border: 1px solid ${dark ? 'rgba(50,114,232,0.12)' : 'rgba(50,114,232,0.1)'};
      }
      .chip.lifetime {
        background: ${dark ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.06)'};
        color: var(--green);
        border-color: ${dark ? 'rgba(34,197,94,0.12)' : 'rgba(34,197,94,0.1)'};
      }
      .chip.paused {
        background: ${dark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)'};
        color: var(--red);
        border-color: ${dark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.1)'};
      }

      .price-tag {
        font-family: var(--mono); font-size: 18px; font-weight: 600;
        color: var(--text-bright); white-space: nowrap;
        display: flex; align-items: baseline; gap: 4px;
      }
      .price-tag .cur {
        font-size: 11px; font-weight: 400; color: var(--blue-light);
      }

      /* ── Action button ── */
      .action-btn {
        width: 100%; padding: 12px 20px;
        border-radius: 8px; border: none;
        font-family: inherit; font-size: 13px; font-weight: 600;
        cursor: pointer; transition: all 0.15s ease;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        color: #fff;
        background: linear-gradient(135deg, var(--blue), #4a6af5);
        box-shadow: 0 4px 14px rgba(50,114,232,0.25);
      }
      .action-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(50,114,232,0.35);
      }
      .action-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
      .action-btn svg {
        width: 16px; height: 16px;
        stroke: currentColor; fill: none;
        stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
      }
      .action-btn.success {
        background: var(--green); box-shadow: none; cursor: default;
      }

      /* ── Status ── */
      .status {
        font-family: var(--mono); font-size: 11px; line-height: 1.5;
        padding: 8px 12px; border-radius: 6px;
        display: none;
      }
      .status.show { display: block; }
      .status.info {
        background: ${dark ? 'rgba(50,114,232,0.08)' : 'rgba(50,114,232,0.05)'};
        color: var(--blue-light);
        border: 1px solid ${dark ? 'rgba(50,114,232,0.12)' : 'rgba(50,114,232,0.1)'};
      }
      .status.error {
        background: ${dark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.05)'};
        color: var(--red);
        border: 1px solid ${dark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.1)'};
      }
      .status.pending {
        background: ${dark ? 'rgba(234,179,8,0.08)' : 'rgba(234,179,8,0.05)'};
        color: var(--amber);
        border: 1px solid ${dark ? 'rgba(234,179,8,0.12)' : 'rgba(234,179,8,0.1)'};
      }
      .status.success {
        background: ${dark ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.05)'};
        color: var(--green);
        border: 1px solid ${dark ? 'rgba(34,197,94,0.12)' : 'rgba(34,197,94,0.1)'};
      }
      .status a { color: inherit; }

      /* ── Footer ── */
      .a402-footer {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 18px;
        border-top: 1px solid var(--border);
        font-family: var(--mono); font-size: 9.5px; color: var(--text-dim);
      }
      .a402-footer a { color: var(--blue-light); text-decoration: none; }
      .a402-footer .chain-dot {
        width: 5px; height: 5px; border-radius: 50%; background: var(--green);
        display: inline-block; margin-right: 4px;
        animation: a402pulse 2.5s ease infinite;
      }

      /* ── Spinner ── */
      .spinner {
        width: 14px; height: 14px;
        border: 2px solid rgba(255,255,255,0.2);
        border-top-color: #fff; border-radius: 50%;
        animation: a402spin 0.6s linear infinite;
      }

      /* ── Unlocked minimal bar ── */
      .unlocked-bar {
        display: none; padding: 6px 18px;
        font-family: var(--mono); font-size: 10px; color: var(--green);
        background: ${dark ? 'rgba(34,197,94,0.06)' : 'rgba(34,197,94,0.04)'};
        border-top: 1px solid ${dark ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.08)'};
        align-items: center; gap: 6px;
      }
      .unlocked-bar svg {
        width: 12px; height: 12px; stroke: var(--green); fill: none;
        stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
      }

      @keyframes a402spin { to { transform: rotate(360deg); } }
      @keyframes a402pulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }
      @keyframes a402fadeIn { from{opacity:0;transform:translateY(4px);} to{opacity:1;transform:translateY(0);} }
      .fade-in { animation: a402fadeIn 0.3s ease; }
    `;
  }

  // ═══════════════════════════════════════════════════════════════
  //  WIDGET CLASS
  // ═══════════════════════════════════════════════════════════════

  class A402Widget {
    constructor(hostEl) {
      this.hostEl = hostEl;
      this.vault = hostEl.dataset.vault;
      this.resourceId = hostEl.dataset.resource;
      this.theme = resolveTheme(hostEl.dataset.theme || 'auto');
      this.resource = null;   // on-chain data
      this.userAddress = null;
      this.state = 'loading'; // loading | locked | connecting | paying | unlocked | error

      // Shadow DOM
      this.shadow = hostEl.attachShadow({ mode: 'open' });
      this.init();
    }

    // ── Build and mount ──
    async init() {
      // Inject styles
      const style = document.createElement('style');
      style.textContent = buildCSS(this.theme);
      this.shadow.appendChild(style);

      // Root element
      this.root = document.createElement('div');
      this.root.className = 'a402-widget fade-in';
      this.shadow.appendChild(this.root);

      // Validate
      if (!this.vault || !this.resourceId) {
        this.renderError('Missing data-vault or data-resource attribute.');
        return;
      }

      // Loading state
      this.root.innerHTML = `
        <div class="video-area">
          <div class="lock-overlay">
            <div class="spinner" style="width:24px;height:24px;border-width:3px;border-color:rgba(255,255,255,0.15);border-top-color:#fff;"></div>
            <div class="lock-text">Loading resource from chain...</div>
          </div>
        </div>
      `;

      try {
        this.resource = await getResource(this.vault, this.resourceId);
        if (!this.resource.exists) {
          this.renderError(`Resource "${this.resourceId}" not found in this vault.`);
          return;
        }
        this.state = 'locked';
        this.render();
        this.tryAutoConnect();
      } catch (err) {
        this.renderError('Failed to load resource: ' + err.message);
      }
    }

    // ── Main render ──
    render() {
      const res = this.resource;
      const source = detectSource(res.contentRef);
      const priceAptm = fromWei(res.price);
      const cType = res.contentType;

      // Type-aware thumbnail/preview
      let thumbHtml = '';
      const typePreview = {
        article: { icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>', label: 'Gated Article', color: '#8b5cf6' },
        file: { icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>', label: 'Paid Download', color: '#eab308' },
        api: { icon: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>', label: 'API Access', color: '#06b6d4' },
      };

      if (cType === 'video' || !typePreview[cType]) {
        if (source.type === 'youtube') {
          thumbHtml = `<img class="thumb" src="https://img.youtube.com/vi/${source.value}/hqdefault.jpg" alt="">`;
        }
      } else {
        const tp = typePreview[cType];
        thumbHtml = `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:linear-gradient(135deg,#0a0b0d,#141620);">
          <svg viewBox="0 0 24 24" style="width:48px;height:48px;stroke:${tp.color};fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;opacity:0.3;">${tp.icon}</svg>
          <span style="font-size:11px;color:rgba(255,255,255,0.15);font-family:var(--mono);">${tp.label}</span>
        </div>`;
      }

      // Chips
      let chips = '';
      if (res.lifetime) chips += '<span class="chip lifetime">♾ Lifetime</span>';
      if (!res.active) chips += '<span class="chip paused">Paused</span>';
      chips += `<span class="chip">${res.contentType}</span>`;

      this.root.innerHTML = `
        <div class="video-area" id="videoArea">
          ${thumbHtml}
          <div class="lock-overlay" id="lockOverlay">
            <div class="lock-icon">
              <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            <div class="lock-text">
              <strong>Content Locked</strong>
              Pay via A402 to unlock
            </div>
          </div>
        </div>
        <div class="info-bar" id="infoBar">
          <div class="info-top">
            <div class="info-left">
              <div class="res-name" title="${this.resourceId}">${this.resourceId}</div>
              <div class="res-meta">${chips}</div>
            </div>
            <div class="price-tag">${priceAptm}<span class="cur">APTM</span></div>
          </div>
          <button class="action-btn" id="actionBtn" ${!res.active ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><circle cx="18" cy="16" r="2"/></svg>
            ${res.active ? 'Connect Wallet' : 'Resource Paused'}
          </button>
          <div class="status" id="statusBar"></div>
        </div>
        <div class="unlocked-bar" id="unlockedBar">
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          <span id="unlockedLabel">Access Granted</span>
        </div>
        <div class="a402-footer">
          <span><span class="chain-dot"></span>Apertum · A402</span>
          <a href="${EXPLORER}/address/${this.vault}" target="_blank" rel="noopener">View Vault</a>
        </div>
      `;

      // Bind button
      this.shadow.getElementById('actionBtn').addEventListener('click', () => this.onAction());
    }

    // ── Try auto-connect if wallet already connected ──
    async tryAutoConnect() {
      if (!window.ethereum) return;
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length === 0) return;
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        if (chainId !== CHAIN_HEX) return;

        this.userAddress = accounts[0];
        // Check access silently
        if (this.resource.lifetime) {
          const has = await hasAccess(this.vault, this.resourceId, this.userAddress);
          if (has) {
            this.unlock();
            return;
          }
        }
        // Already connected, show pay button
        this.showPayButton();
      } catch { /* silent */ }
    }

    // ── Action button handler ──
    async onAction() {
      if (this.state === 'unlocked') return;
      if (!this.userAddress) {
        await this.connectWallet();
      } else {
        await this.pay();
      }
    }

    // ── Connect wallet ──
    async connectWallet() {
      if (!window.ethereum) {
        this.setStatus('error', 'No wallet detected. Install MetaMask or a Web3 wallet.');
        return;
      }

      const btn = this.shadow.getElementById('actionBtn');
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Connecting...';
      this.state = 'connecting';

      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        this.userAddress = accounts[0];

        // Switch to Apertum
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        if (chainId !== CHAIN_HEX) {
          this.setStatus('info', 'Switching to Apertum network...');
          try {
            await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
          } catch (e) {
            if (e.code === 4902) {
              await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [{
                  chainId: CHAIN_HEX,
                  chainName: 'Apertum',
                  nativeCurrency: { name: 'APTM', symbol: 'APTM', decimals: 18 },
                  rpcUrls: [RPC],
                  blockExplorerUrls: [EXPLORER],
                }],
              });
            } else throw e;
          }
        }

        // Check lifetime access
        if (this.resource.lifetime) {
          this.setStatus('info', 'Checking existing access...');
          const has = await hasAccess(this.vault, this.resourceId, this.userAddress);
          if (has) {
            this.unlock();
            return;
          }
        }

        this.showPayButton();

      } catch (err) {
        this.setStatus('error', err.code === 4001 ? 'Connection rejected.' : 'Failed: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><circle cx="18" cy="16" r="2"/></svg> Connect Wallet`;
        this.state = 'locked';
      }
    }

    // ── Show pay button ──
    showPayButton() {
      const btn = this.shadow.getElementById('actionBtn');
      const priceAptm = fromWei(this.resource.price);
      const lifetimeLabel = this.resource.lifetime ? ' · Lifetime' : '';
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Pay ${priceAptm} APTM${lifetimeLabel}`;
      this.setStatus('info', this.resource.lifetime
        ? 'Pay once to unlock this content forever.'
        : 'Click to pay and unlock.');
      this.state = 'locked';
    }

    // ── Pay ──
    async pay() {
      const btn = this.shadow.getElementById('actionBtn');
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Confirm in wallet...';
      this.setStatus('pending', 'Confirm the transaction in your wallet...');
      this.state = 'paying';

      try {
        // Generate nonce
        const nonceBytes = new Uint8Array(32);
        crypto.getRandomValues(nonceBytes);
        const nonce = '0x' + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');

        // Encode payForAccess(string, bytes32)
        const s = fnSel('payForAccess(string,bytes32)');
        const data = '0x' + s + padUint(64) + nonce.replace('0x', '') + encStr(this.resourceId);

        const txHash = await window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [{
            from: this.userAddress,
            to: this.vault,
            data,
            value: '0x' + BigInt(this.resource.price).toString(16),
          }],
        });

        this.setStatus('pending', 'Transaction sent! Confirming on Apertum...');
        btn.innerHTML = '<div class="spinner"></div> Confirming...';

        // Poll for receipt
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 1500));
          const receipt = await rpc('eth_getTransactionReceipt', [txHash]);
          if (receipt) {
            if (receipt.status !== '0x1') throw new Error('Transaction reverted on-chain');
            break;
          }
          if (i === 29) throw new Error('Confirmation timeout — check explorer');
        }

        const msg = this.resource.lifetime
          ? '✓ Lifetime access granted!'
          : '✓ Payment verified — content unlocked!';
        this.setStatus('success', `${msg} <a href="${EXPLORER}/tx/${txHash}" target="_blank" rel="noopener">View tx</a>`);
        this.unlock();

      } catch (err) {
        this.setStatus('error', err.code === 4001 ? 'Transaction rejected.' : 'Failed: ' + err.message);
        this.showPayButton();
      }
    }

    // ── Unlock content ──
    unlock() {
      this.state = 'unlocked';
      const overlay = this.shadow.getElementById('lockOverlay');
      if (overlay) overlay.classList.add('hidden');

      const source = detectSource(this.resource.contentRef);
      const area = this.shadow.getElementById('videoArea');
      const cType = this.resource.contentType;

      if (cType === 'video' || (!['article','file','api'].includes(cType))) {
        // ── Video renderer ──
        if (source.type === 'youtube') {
          const iframe = document.createElement('iframe');
          iframe.src = `https://www.youtube.com/embed/${source.value}?autoplay=1&rel=0&modestbranding=1`;
          iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
          iframe.allowFullscreen = true;
          iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;z-index:2;';
          area.appendChild(iframe);
        } else if (source.type === 'ipfs') {
          const url = source.value.startsWith('ipfs://')
            ? 'https://ipfs.io/ipfs/' + source.value.replace('ipfs://', '')
            : source.value;
          const video = document.createElement('video');
          video.src = url;
          video.controls = true;
          video.autoplay = true;
          video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:2;background:#000;';
          area.appendChild(video);
        } else if (source.type === 'direct') {
          const video = document.createElement('video');
          video.src = source.value;
          video.controls = true;
          video.autoplay = true;
          video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:2;background:#000;';
          area.appendChild(video);
        }

      } else if (cType === 'article') {
        // ── Article renderer ──
        area.style.aspectRatio = 'auto';
        area.style.minHeight = '300px';
        area.style.maxHeight = '600px';
        area.style.overflow = 'auto';
        area.style.background = 'var(--bg-card)';
        area.style.padding = '24px';

        const articleContainer = document.createElement('div');
        articleContainer.style.cssText = 'font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;line-height:1.8;color:var(--text);z-index:2;position:relative;';
        articleContainer.innerHTML = '<div class="spinner" style="margin:20px auto;"></div><div style="text-align:center;font-size:12px;color:var(--text-dim);">Loading article...</div>';
        area.appendChild(articleContainer);

        // Resolve URL
        let url = this.resource.contentRef;
        if (url.startsWith('ipfs://')) url = 'https://ipfs.io/ipfs/' + url.replace('ipfs://', '');
        else if (/^(Qm|bafy)/.test(url)) url = 'https://ipfs.io/ipfs/' + url;

        fetch(url).then(r => r.text()).then(text => {
          // Simple markdown-like rendering (bold, italic, headers, paragraphs, links, code)
          let html = text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/^### (.+)$/gm, '<h3 style="font-size:16px;font-weight:600;color:var(--text-bright);margin:16px 0 8px;">$1</h3>')
            .replace(/^## (.+)$/gm, '<h2 style="font-size:18px;font-weight:600;color:var(--text-bright);margin:20px 0 10px;">$1</h2>')
            .replace(/^# (.+)$/gm, '<h1 style="font-size:22px;font-weight:700;color:var(--text-bright);margin:24px 0 12px;">$1</h1>')
            .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text-bright);">$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code style="background:var(--bg);padding:2px 6px;border-radius:4px;font-family:var(--mono);font-size:12px;">$1</code>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--blue-light);">$1</a>')
            .replace(/\n\n/g, '</p><p style="margin-bottom:12px;">')
            .replace(/\n/g, '<br>');
          // If content starts with <html or <!DOCTYPE, render as-is
          if (text.trim().match(/^(<html|<!doctype)/i)) {
            html = text;
          }
          articleContainer.innerHTML = '<p style="margin-bottom:12px;">' + html + '</p>';
        }).catch(err => {
          articleContainer.innerHTML = `<div style="text-align:center;padding:20px;"><div style="color:var(--red);font-size:13px;margin-bottom:6px;">Failed to load article</div><div style="font-size:11px;color:var(--text-dim);">${err.message}</div><a href="${url}" target="_blank" rel="noopener" style="display:inline-block;margin-top:10px;color:var(--blue-light);font-size:12px;">Open directly</a></div>`;
        });

      } else if (cType === 'file') {
        // ── File download renderer ──
        area.style.aspectRatio = 'auto';
        area.style.minHeight = '160px';
        area.style.background = 'var(--bg-card)';
        area.style.display = 'flex';
        area.style.alignItems = 'center';
        area.style.justifyContent = 'center';
        area.style.padding = '32px';

        let url = this.resource.contentRef;
        if (url.startsWith('ipfs://')) url = 'https://ipfs.io/ipfs/' + url.replace('ipfs://', '');
        else if (/^(Qm|bafy)/.test(url)) url = 'https://ipfs.io/ipfs/' + url;

        let fileName = 'Download File';
        try { fileName = url.split('/').pop().split('?')[0] || 'Download File'; } catch {}

        const dlDiv = document.createElement('div');
        dlDiv.style.cssText = 'text-align:center;z-index:2;position:relative;';
        dlDiv.innerHTML = `
          <svg viewBox="0 0 24 24" style="width:48px;height:48px;stroke:var(--green);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;margin-bottom:12px;">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <div style="font-size:14px;font-weight:600;color:var(--text-bright);margin-bottom:4px;">${fileName}</div>
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:16px;">Your payment is verified — download is ready.</div>
          <a href="${url}" target="_blank" rel="noopener" download
            style="display:inline-flex;align-items:center;gap:8px;padding:12px 24px;border-radius:8px;background:var(--green);color:#000;font-size:13px;font-weight:600;text-decoration:none;transition:filter 0.15s;">
            <svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download
          </a>
        `;
        area.appendChild(dlDiv);

      } else if (cType === 'api') {
        // ── API access renderer ──
        area.style.aspectRatio = 'auto';
        area.style.minHeight = '200px';
        area.style.background = 'var(--bg-card)';
        area.style.padding = '28px';

        // Generate a pseudo-token from the user's address + resource + timestamp
        const tokenData = this.userAddress + ':' + this.resourceId + ':' + Date.now();
        const token = 'a402_' + keccak256(tokenData).slice(0, 48);

        const apiDiv = document.createElement('div');
        apiDiv.style.cssText = 'z-index:2;position:relative;';
        apiDiv.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
            <svg viewBox="0 0 24 24" style="width:28px;height:28px;stroke:#06b6d4;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;">
              <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
            </svg>
            <div>
              <div style="font-size:14px;font-weight:600;color:var(--text-bright);">API Access Granted</div>
              <div style="font-size:11px;color:var(--text-dim);">Your access token is ready. Include it in your API requests.</div>
            </div>
          </div>
          <div style="margin-bottom:14px;">
            <div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Endpoint</div>
            <div style="padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-family:var(--mono);font-size:12px;color:var(--blue-light);word-break:break-all;">${this.resource.contentRef}</div>
          </div>
          <div style="margin-bottom:14px;">
            <div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Access Token</div>
            <div style="display:flex;gap:8px;align-items:center;">
              <div style="flex:1;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-family:var(--mono);font-size:11px;color:var(--green);word-break:break-all;" id="apiToken">${token}</div>
              <button style="padding:8px 14px;border-radius:6px;border:1px solid var(--border);background:var(--bg);font-family:var(--mono);font-size:10px;color:var(--text-dim);cursor:pointer;white-space:nowrap;" id="copyTokenBtn">Copy</button>
            </div>
          </div>
          <div style="padding:10px 14px;background:rgba(6,182,212,0.06);border:1px solid rgba(6,182,212,0.1);border-radius:8px;font-family:var(--mono);font-size:11px;color:var(--text-dim);line-height:1.6;">
            <strong style="color:var(--text);">Usage:</strong> curl -H "Authorization: Bearer ${token}" ${this.resource.contentRef}
          </div>
        `;
        area.appendChild(apiDiv);

        // Copy token button
        const copyBtn = apiDiv.querySelector('#copyTokenBtn');
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(token);
          copyBtn.textContent = 'Copied!';
          copyBtn.style.color = 'var(--green)';
          copyBtn.style.borderColor = 'var(--green)';
          setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.style.color = ''; copyBtn.style.borderColor = ''; }, 2000);
        });
      }

      // Collapse info bar, show unlocked bar
      const infoBar = this.shadow.getElementById('infoBar');
      if (infoBar) infoBar.style.display = 'none';

      const unlockedBar = this.shadow.getElementById('unlockedBar');
      if (unlockedBar) {
        unlockedBar.style.display = 'flex';
        this.shadow.getElementById('unlockedLabel').textContent =
          this.resource.lifetime ? 'Lifetime Access' : 'Access Granted';
      }
    }

    // ── Helpers ──
    setStatus(type, msg) {
      const el = this.shadow.getElementById('statusBar');
      if (!el) return;
      el.className = 'status show ' + type;
      el.innerHTML = msg;
    }

    renderError(msg) {
      this.state = 'error';
      this.root.innerHTML = `
        <div style="padding:32px 24px;text-align:center;">
          <div style="font-size:14px;font-weight:600;color:var(--red);margin-bottom:6px;">Error</div>
          <div style="font-size:12px;color:var(--text-dim);">${msg}</div>
        </div>
        <div class="a402-footer">
          <span>A402 · Apertum</span>
          <span></span>
        </div>
      `;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  INITIALIZATION — scan DOM and mount widgets
  // ═══════════════════════════════════════════════════════════════

  function mount() {
    const elements = document.querySelectorAll('.a402-content:not([data-a402-mounted])');
    elements.forEach(el => {
      el.setAttribute('data-a402-mounted', 'true');
      new A402Widget(el);
    });
  }

  // Run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  // Observe for dynamically added elements (SPA support)
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.classList && node.classList.contains('a402-content') && !node.hasAttribute('data-a402-mounted')) {
          mount();
          return;
        }
        if (node.querySelector && node.querySelector('.a402-content:not([data-a402-mounted])')) {
          mount();
          return;
        }
      }
    }
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // Expose for programmatic use
  window.A402 = { mount, Widget: A402Widget };

})();
