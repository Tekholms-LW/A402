/**
 * Apertum A402 Prototype Server — Lifetime Access Edition
 *
 * Contract: A402Verifier (v2) with lifetime access support
 *
 * New flow:
 *   1. Client connects wallet → sends address to /api/check-access
 *   2. Server calls hasAccess(resourceId, user) on-chain via eth_call (free)
 *   3. If user already has access → skip payment, serve content immediately
 *   4. If not → standard 402 flow: pay via payForAccess(), verify, unlock
 *
 * The contract stores lifetime grants in an on-chain mapping so access
 * survives server restarts, works across any frontend, and is independently
 * verifiable by anyone.
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

// Event topic: keccak256("AccessPaid(address,address,string,uint256,bool,uint256)")
// We'll match by contract address + log structure (topic count) since the
// event signature changes with the v2 contract. For the original contract,
// we fall back to matching VideoAccessPaid.
// In production, precompute the exact topic hash after deploying v2.

// ─── Configuration ────────────────────────────────────────────────
const CONFIG = {
  chainId: 2786,
  caip2: 'eip155:2786',
  rpcUrl: process.env.APERTUM_RPC || 'https://rpc.apertum.io/ext/bc/YDJ1r9RMkewATmA7B35q1bdV18aywzmdiXwd9zGBq3uQjsCnn/rpc',
  verifierContract: VERIFIER_CONTRACT,
  creatorAddress: process.env.PAYMENT_ADDRESS || '0x0000000000000000000000000000000000000000',
  price: process.env.PRICE || '0.001',
  resourceId: process.env.RESOURCE_ID || 'video-001',
  youtubeVideoId: process.env.YOUTUBE_VIDEO_ID || 'dQw4w9WgXcQ',
  lifetimeAccess: (process.env.LIFETIME_ACCESS || 'true').toLowerCase() === 'true',
  currency: 'APTM',
  decimals: 18,
};

function toWei(aptm) {
  const parts = aptm.split('.');
  const whole = parts[0] || '0';
  const frac = (parts[1] || '').padEnd(18, '0').slice(0, 18);
  return BigInt(whole + frac).toString();
}

const priceWei = toWei(CONFIG.price);

// ─── In-memory payment ledger (supplements on-chain state) ───────
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

/**
 * Encode hasAccess(string resourceId, address user) for eth_call.
 *
 * Function selector: keccak256("hasAccess(string,address)") first 4 bytes
 * We precompute this. The server uses js-sha3 (installed as dev dep) or
 * we hardcode it after computing once.
 *
 * ABI layout for (string, address):
 *   Word 0: offset to string data (0x40 = 64, past the 2 head words)
 *   Word 1: address (left-padded to 32 bytes)
 *   Word 2: string length
 *   Word 3+: string data (right-padded)
 */
let HAS_ACCESS_SELECTOR;
try {
  const { keccak256 } = require('js-sha3');
  HAS_ACCESS_SELECTOR = '0x' + keccak256('hasAccess(string,address)').slice(0, 8);
} catch {
  // Precomputed fallback (keccak256 of "hasAccess(string,address)")
  // Compute this once and hardcode if js-sha3 isn't available
  HAS_ACCESS_SELECTOR = '0x13bd20e2'; // keccak256("hasAccess(string,address)") first 4 bytes
}

function encodeHasAccess(resourceId, userAddress) {
  const sel = HAS_ACCESS_SELECTOR.slice(2);
  const strOffset = padUint256(64); // 0x40 — offset past 2 head words
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

    // Result is ABI-encoded bool (32 bytes, 0x...0001 = true)
    if (result && result !== '0x' && result !== '0x0') {
      const value = BigInt(result);
      return value === 1n;
    }
    return false;
  } catch (err) {
    // If the contract doesn't have hasAccess() (v1), this will revert — that's fine
    console.log('On-chain access check unavailable (v1 contract or RPC error):', err.message);
    return false;
  }
}

// ─── Endpoints ────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    chain: CONFIG.caip2,
    verifierContract: CONFIG.verifierContract,
    creatorAddress: CONFIG.creatorAddress,
    lifetimeAccess: CONFIG.lifetimeAccess,
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

// ─── Check Access (the new key endpoint) ──────────────────────────
// Client sends their wallet address, server checks on-chain if they
// already have lifetime access. Zero gas — it's a view function call.
app.get('/api/check-access', async (req, res) => {
  const userAddress = req.query.address;
  if (!userAddress) {
    return res.status(400).json({ error: 'address query parameter is required' });
  }

  // 1. Check in-memory ledger first (fast path for current session)
  for (const [, payment] of payments) {
    if (payment.verified && payment.payer?.toLowerCase() === userAddress.toLowerCase()) {
      return res.json({
        hasAccess: true,
        source: 'session',
        message: 'Access granted (verified this session)',
        videoId: CONFIG.youtubeVideoId,
        videoUrl: `https://www.youtube.com/embed/${CONFIG.youtubeVideoId}`,
      });
    }
  }

  // 2. Check on-chain (lifetime access mapping in the contract)
  if (CONFIG.lifetimeAccess) {
    const onChain = await checkOnChainAccess(CONFIG.resourceId, userAddress);
    if (onChain) {
      console.log(`♻️  Lifetime access confirmed on-chain for ${userAddress} → ${CONFIG.resourceId}`);
      return res.json({
        hasAccess: true,
        source: 'on-chain',
        lifetime: true,
        message: 'Lifetime access confirmed — you already paid for this content!',
        videoId: CONFIG.youtubeVideoId,
        videoUrl: `https://www.youtube.com/embed/${CONFIG.youtubeVideoId}`,
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
      videoId: CONFIG.youtubeVideoId,
      videoUrl: `https://www.youtube.com/embed/${CONFIG.youtubeVideoId}`,
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
      videoId: CONFIG.youtubeVideoId,
      videoUrl: `https://www.youtube.com/embed/${CONFIG.youtubeVideoId}`,
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

    // Parse event logs from the contract
    const contractLogs = (receipt.logs || []).filter(
      log => log.address?.toLowerCase() === CONFIG.verifierContract.toLowerCase()
    );

    if (contractLogs.length === 0) {
      return res.status(400).json({
        verified: false,
        error: 'No events from contract — call may have failed',
      });
    }

    // Find a payment event with matching creator and sufficient amount
    // Works with both v1 (VideoAccessPaid) and v2 (AccessPaid) events:
    // Both have indexed payer at topics[1] and indexed creator at topics[2]
    // Both have amount in the data section
    let verifiedLog = null;

    for (const log of contractLogs) {
      if (!log.topics || log.topics.length < 3) continue;

      const logCreator = '0x' + log.topics[2].slice(-40);
      if (logCreator.toLowerCase() !== CONFIG.creatorAddress.toLowerCase()) continue;

      const data = log.data.slice(2);
      if (data.length < 128) continue; // need at least 2 words

      // Amount is in the data — position depends on event version:
      // v1 VideoAccessPaid: data = (string_offset, amount, timestamp) → amount at word 1
      // v2 AccessPaid: data = (string_offset, amount, bool, timestamp) → amount at word 1
      // Both have amount at word 1 (hex chars 64..128)
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
      videoId: CONFIG.youtubeVideoId,
      videoUrl: `https://www.youtube.com/embed/${CONFIG.youtubeVideoId}`,
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
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║   🔷 Apertum A402 — Lifetime Access Edition                  ║
║                                                               ║
║   Server:     http://localhost:${PORT}                          ║
║   Chain:      Apertum (eip155:2786)                           ║
║   Contract:   ${VERIFIER_CONTRACT}       ║
║   Creator:    ${CONFIG.creatorAddress.slice(0, 10)}...${CONFIG.creatorAddress.slice(-6)}                              ║
║   Price:      ${CONFIG.price} APTM + gas                           ║
║   Mode:       ${mode.padEnd(10)}                                    ║
║   Resource:   ${CONFIG.resourceId}                                      ║
║   Video:      ${CONFIG.youtubeVideoId}                             ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
