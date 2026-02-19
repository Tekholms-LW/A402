/**
 * Apertum A402 Prototype Server — Dual-Mode Video Edition
 *
 * Supports YouTube videos, IPFS-hosted videos, and direct video URLs.
 * Contract: A402Verifier (v2) with lifetime access support.
 *
 * Flow:
 *   1. Client connects wallet → sends address to /api/check-access
 *   2. Server calls hasAccess(resourceId, user) on-chain via eth_call (free)
 *   3. If user already has access → skip payment, serve content immediately
 *   4. If not → standard 402 flow: pay via payForAccess(), verify, unlock
 *
 * Video source priority: VIDEO_URL env var > YOUTUBE_VIDEO_ID env var
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ─── Contract ────────────────────────────────────────────────────
const VERIFIER_CONTRACT = process.env.VERIFIER_CONTRACT || '0x461dA8e28B276586EB9dC4F010EbfF7F126A7076';

// ─── Configuration ────────────────────────────────────────────────
const CONFIG = {
  chainId: 2786,
  caip2: 'eip155:2786',
  rpcUrl: process.env.APERTUM_RPC || 'https://rpc.apertum.io/ext/bc/YDJ1r9RMkewATmA7B35q1bdV18aywzmdiXwd9zGBq3uQjsCnn/rpc',
  verifierContract: VERIFIER_CONTRACT,
  creatorAddress: process.env.PAYMENT_ADDRESS || '0x0000000000000000000000000000000000000000',
  price: process.env.PRICE || '0.001',
  resourceId: process.env.RESOURCE_ID || 'video-001',
  youtubeVideoId: process.env.YOUTUBE_VIDEO_ID || '',
  videoUrl: process.env.VIDEO_URL || '',
  lifetimeAccess: (process.env.LIFETIME_ACCESS || 'true').toLowerCase() === 'true',
  currency: 'APTM',
  decimals: 18,
};

const IPFS_GATEWAY = process.env.IPFS_GATEWAY || 'https://ipfs.io';

function toWei(aptm) {
  const parts = aptm.split('.');
  const whole = parts[0] || '0';
  const frac = (parts[1] || '').padEnd(18, '0').slice(0, 18);
  return BigInt(whole + frac).toString();
}

const priceWei = toWei(CONFIG.price);

// ─── Content source detection ─────────────────────────────────────
function detectContentSource(ref) {
  if (!ref) return { type: 'unknown', videoUrl: null };
  const trimmed = ref.trim();

  if (trimmed.startsWith('ipfs://')) {
    const cid = trimmed.replace('ipfs://', '');
    return { type: 'ipfs', videoUrl: `${IPFS_GATEWAY}/ipfs/${cid}` };
  }
  if (trimmed.includes('/ipfs/') || trimmed.includes('/ipns/')) {
    return { type: 'ipfs', videoUrl: trimmed };
  }
  if (/\.(mp4|webm|ogg|mov|m3u8)(\?.*)?$/i.test(trimmed) && trimmed.startsWith('http')) {
    return { type: 'direct', videoUrl: trimmed };
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const ytMatch = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) return { type: 'youtube', videoUrl: `https://www.youtube.com/embed/${ytMatch[1]}`, videoId: ytMatch[1] };
    return { type: 'direct', videoUrl: trimmed };
  }
  if (/^(Qm[a-zA-Z0-9]{44,}|bafy[a-zA-Z0-9]{50,})$/.test(trimmed)) {
    return { type: 'ipfs', videoUrl: `${IPFS_GATEWAY}/ipfs/${trimmed}` };
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return { type: 'youtube', videoUrl: `https://www.youtube.com/embed/${trimmed}`, videoId: trimmed };
  }
  return { type: 'unknown', videoUrl: null };
}

/**
 * Resolve the configured content ref to a response payload.
 * Returns { videoId?, videoUrl, contentType }
 * Backward compatible: still includes videoId for YouTube sources.
 */
function resolveContentPayload() {
  const ref = CONFIG.videoUrl || CONFIG.youtubeVideoId || 'dQw4w9WgXcQ';
  const source = detectContentSource(ref);

  if (source.type === 'youtube') {
    const ytId = source.videoId || ref;
    return {
      videoId: ytId,
      videoUrl: `https://www.youtube.com/embed/${ytId}`,
      contentType: 'youtube',
    };
  }

  return {
    videoUrl: source.videoUrl,
    contentType: source.type,
  };
}

// ─── In-memory payment ledger ─────────────────────────────────────
const payments = new Map();

// ─── Static files ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── RPC helper ───────────────────────────────────────────────────
async function rpcCall(method, params) {
  const response = await fetch(CONFIG.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const data = await response.json();
  if (data.error) throw new Error(`RPC error: ${data.error.message}`);
  return data.result;
}

// ─── ABI encoding helpers ─────────────────────────────────────────
function padAddress(addr) {
  return addr.replace('0x', '').toLowerCase().padStart(64, '0');
}

function padUint256(val) {
  return BigInt(val).toString(16).padStart(64, '0');
}

function encodeString(str) {
  const hex = Buffer.from(str, 'utf8').toString('hex');
  const len = padUint256(str.length);
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
  return len + padded;
}

let HAS_ACCESS_SELECTOR;
try {
  const { keccak256 } = require('js-sha3');
  HAS_ACCESS_SELECTOR = '0x' + keccak256('hasAccess(string,address)').slice(0, 8);
} catch {
  HAS_ACCESS_SELECTOR = '0x13bd20e2';
}

function encodeHasAccess(resourceId, userAddress) {
  const sel = HAS_ACCESS_SELECTOR.slice(2);
  const strOffset = padUint256(64);
  const addr = padAddress(userAddress);
  const strEncoded = encodeString(resourceId);
  return '0x' + sel + strOffset + addr + strEncoded;
}

// ─── Check on-chain lifetime access ──────────────────────────────
async function checkOnChainAccess(resourceId, userAddress) {
  try {
    const calldata = encodeHasAccess(resourceId, userAddress);
    const result = await rpcCall('eth_call', [{
      to: CONFIG.verifierContract,
      data: calldata,
    }, 'latest']);

    if (result && result !== '0x' && result !== '0x0') {
      return BigInt(result) === 1n;
    }
    return false;
  } catch (err) {
    console.log('On-chain access check unavailable:', err.message);
    return false;
  }
}

// ─── Endpoints ────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  const content = resolveContentPayload();
  res.json({
    status: 'ok',
    chain: CONFIG.caip2,
    verifierContract: CONFIG.verifierContract,
    creatorAddress: CONFIG.creatorAddress,
    lifetimeAccess: CONFIG.lifetimeAccess,
    contentType: content.contentType,
  });
});

app.get('/api/payment-info', (req, res) => {
  res.json({
    chainId: CONFIG.chainId,
    caip2: CONFIG.caip2,
    rpcUrl: CONFIG.rpcUrl,
    verifierContract: CONFIG.verifierContract,
    creatorAddress: CONFIG.creatorAddress,
    resourceId: CONFIG.resourceId,
    price: CONFIG.price,
    priceWei,
    currency: CONFIG.currency,
    decimals: CONFIG.decimals,
    lifetimeAccess: CONFIG.lifetimeAccess,
    description: CONFIG.lifetimeAccess
      ? 'Pay once for lifetime access via A402 contract'
      : 'Pay per access via A402 contract',
  });
});

app.get('/api/nonce', (req, res) => {
  const nonce = '0x' + crypto.randomBytes(32).toString('hex');
  res.json({ nonce });
});

// ─── Check Access ─────────────────────────────────────────────────
app.get('/api/check-access', async (req, res) => {
  const userAddress = req.query.address;
  if (!userAddress) {
    return res.status(400).json({ error: 'address query parameter is required' });
  }

  // 1. Check in-memory ledger first
  for (const [, payment] of payments) {
    if (payment.verified && payment.payer?.toLowerCase() === userAddress.toLowerCase()) {
      return res.json({
        hasAccess: true,
        source: 'session',
        message: 'Access granted (verified this session)',
        ...resolveContentPayload(),
      });
    }
  }

  // 2. Check on-chain
  if (CONFIG.lifetimeAccess) {
    const onChain = await checkOnChainAccess(CONFIG.resourceId, userAddress);
    if (onChain) {
      console.log(`♻️  Lifetime access confirmed on-chain for ${userAddress} → ${CONFIG.resourceId}`);
      return res.json({
        hasAccess: true,
        source: 'on-chain',
        lifetime: true,
        message: 'Lifetime access confirmed — you already paid for this content!',
        ...resolveContentPayload(),
      });
    }
  }

  // 3. No access found
  res.json({
    hasAccess: false,
    lifetimeAccess: CONFIG.lifetimeAccess,
    message: CONFIG.lifetimeAccess
      ? 'No access found. Pay once to unlock this content forever.'
      : 'No access found. Payment required.',
  });
});

// ─── Protected resource ───────────────────────────────────────────
app.get('/api/video', (req, res) => {
  const txHash = req.headers['x-payment-tx'] || req.query.txHash;

  if (!txHash) {
    return res.status(402).json({
      status: 402,
      message: 'Payment Required',
      'x-payment-required': {
        network: CONFIG.caip2,
        chainId: CONFIG.chainId,
        verifierContract: CONFIG.verifierContract,
        creator: CONFIG.creatorAddress,
        resourceId: CONFIG.resourceId,
        amount: CONFIG.price,
        amountWei: priceWei,
        asset: CONFIG.currency,
        lifetimeAccess: CONFIG.lifetimeAccess,
        method: 'payForAccess(string,address,uint256,bytes32)',
        description: CONFIG.lifetimeAccess
          ? 'Pay once via A402Verifier for lifetime access'
          : 'Pay via A402Verifier to unlock content',
      },
    });
  }

  const payment = payments.get(txHash.toLowerCase());
  if (payment?.verified) {
    return res.json({
      status: 200,
      message: 'Payment verified!',
      ...resolveContentPayload(),
    });
  }

  res.status(402).json({ status: 402, message: 'Payment not yet verified.' });
});

// ─── Verify payment via contract event logs ───────────────────────
app.post('/api/verify', async (req, res) => {
  const { txHash } = req.body;
  if (!txHash) return res.status(400).json({ error: 'txHash is required' });

  const normalizedHash = txHash.toLowerCase();

  if (payments.get(normalizedHash)?.verified) {
    return res.json({
      verified: true,
      message: 'Payment already verified',
      ...resolveContentPayload(),
    });
  }

  try {
    const receipt = await rpcCall('eth_getTransactionReceipt', [txHash]);

    if (!receipt) {
      const tx = await rpcCall('eth_getTransactionByHash', [txHash]);
      if (!tx) return res.status(404).json({ verified: false, error: 'Transaction not found' });
      return res.status(202).json({ verified: false, message: 'Pending — try again shortly.', pending: true });
    }

    if (receipt.status !== '0x1') {
      return res.status(400).json({ verified: false, error: 'Transaction reverted on-chain' });
    }

    const tx = await rpcCall('eth_getTransactionByHash', [txHash]);
    if (!tx || tx.to?.toLowerCase() !== CONFIG.verifierContract.toLowerCase()) {
      return res.status(400).json({
        verified: false,
        error: `Transaction not sent to A402 contract (${CONFIG.verifierContract})`,
      });
    }

    const contractLogs = (receipt.logs || []).filter(
      log => log.address?.toLowerCase() === CONFIG.verifierContract.toLowerCase()
    );

    if (contractLogs.length === 0) {
      return res.status(400).json({
        verified: false,
        error: 'No events from contract — call may have failed',
      });
    }

    let verifiedLog = null;

    for (const log of contractLogs) {
      if (!log.topics || log.topics.length < 3) continue;

      const logCreator = '0x' + log.topics[2].slice(-40);
      if (logCreator.toLowerCase() !== CONFIG.creatorAddress.toLowerCase()) continue;

      const data = log.data.slice(2);
      if (data.length < 128) continue;

      const logAmount = BigInt('0x' + data.slice(64, 128));
      if (logAmount < BigInt(priceWei)) continue;

      const logPayer = '0x' + log.topics[1].slice(-40);
      verifiedLog = { payer: logPayer, creator: logCreator, amount: logAmount.toString() };
      break;
    }

    if (!verifiedLog) {
      return res.status(400).json({
        verified: false,
        error: 'Payment event not found with matching creator and amount',
      });
    }

    payments.set(normalizedHash, {
      verified: true,
      payer: verifiedLog.payer,
      creator: verifiedLog.creator,
      amount: verifiedLog.amount,
      timestamp: Date.now(),
    });

    const accessType = CONFIG.lifetimeAccess ? 'lifetime' : 'session';
    console.log(`✅ Verified (${accessType}): ${verifiedLog.payer} → ${verifiedLog.creator} | ${verifiedLog.amount} wei | tx: ${txHash}`);

    res.json({
      verified: true,
      lifetime: CONFIG.lifetimeAccess,
      message: CONFIG.lifetimeAccess
        ? 'Payment verified! You now have lifetime access to this content.'
        : 'Payment verified! Content unlocked.',
      payer: verifiedLog.payer,
      ...resolveContentPayload(),
    });

  } catch (err) {
    console.error('Verification error:', err);
    res.status(500).json({ verified: false, error: 'Verification failed: ' + err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const mode = CONFIG.lifetimeAccess ? 'LIFETIME' : 'PER-ACCESS';
  const content = resolveContentPayload();
  const sourceLabel = content.contentType === 'youtube'
    ? `YouTube: ${content.videoId}`
    : `${content.contentType.toUpperCase()}: ${(content.videoUrl || '').slice(0, 40)}...`;

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║   🔷 Apertum A402 — Dual-Mode Video Edition                  ║
║                                                               ║
║   Server:     http://localhost:${PORT}                          ║
║   Chain:      Apertum (eip155:2786)                           ║
║   Contract:   ${VERIFIER_CONTRACT}       ║
║   Creator:    ${CONFIG.creatorAddress.slice(0, 10)}...${CONFIG.creatorAddress.slice(-6)}                              ║
║   Price:      ${CONFIG.price} APTM + gas                           ║
║   Mode:       ${mode.padEnd(10)}                                    ║
║   Resource:   ${CONFIG.resourceId}                                      ║
║   Source:     ${sourceLabel.slice(0, 44).padEnd(44)}   ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
