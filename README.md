# Apertum x402 Prototype — A402Verifier Contract Edition

A locally-run prototype implementing the **x402 micropayment protocol** on **Apertum** (chain ID 2786), with payments routed through the **A402Verifier** smart contract for on-chain verification, replay protection, and transparent fund forwarding.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (index.html)                                            │
│                                                                  │
│  1. Connect wallet → switch to Apertum (2786)                    │
│  2. Fetch nonce from server (replay protection)                  │
│  3. ABI-encode payForVideo(resourceId, creator, amount, nonce)   │
│  4. Send tx to A402Verifier contract with APTM value             │
│  5. Submit txHash to server for verification                     │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│  A402Verifier Contract (0x461dA8...7076)                         │
│                                                                  │
│  - Checks nonce hasn't been used (replay protection)             │
│  - Verifies msg.value == amount                                  │
│  - Forwards APTM to creator address                              │
│  - Emits VideoAccessPaid(payer, creator, resourceId, amount, ts) │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│  Express Server (server.js)                                      │
│                                                                  │
│  POST /api/verify { txHash }                                     │
│  - Fetches tx receipt from Apertum RPC                           │
│  - Confirms tx was sent to verifier contract                     │
│  - Parses VideoAccessPaid event log                              │
│  - Verifies: event topic, creator address, payment amount        │
│  - On success → returns unlisted YouTube video URL               │
└──────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Configure `.env`

```env
PAYMENT_ADDRESS=0xYourWalletAddressHere    # Creator wallet (receives APTM)
YOUTUBE_VIDEO_ID=your_unlisted_video_id     # YouTube video ID to gate
PRICE=0.001                                 # Price in APTM
RESOURCE_ID=video-001                       # Resource identifier for the contract
```

### 2. Install & Run

```bash
npm install
npm start
```

### 3. Open

Visit [http://localhost:3000](http://localhost:3000) with MetaMask installed.

## Requirements

- **Node.js** 18+
- **MetaMask** (or any injected EVM wallet)
- Small amount of **APTM** (price + gas, roughly ~0.002 APTM total)

## Contract Details

| Field | Value |
|---|---|
| Contract | `0x461dA8e28B276586EB9dC4F010EbfF7F126A7076` |
| Chain | Apertum (2786) |
| Function | `payForVideo(string resourceId, address creator, uint256 amount, bytes32 nonce)` |
| Event | `VideoAccessPaid(address indexed payer, address indexed creator, string resourceId, uint256 amount, uint256 timestamp)` |
| Explorer | [View on Apertum Explorer](https://explorer.apertum.io/address/0x461dA8e28B276586EB9dC4F010EbfF7F126A7076) |

The contract provides:
- **Exact payment enforcement** — `require(msg.value == amount)`
- **Replay protection** — unique `bytes32 nonce` per payment, tracked in `usedNonces` mapping
- **Transparent forwarding** — APTM is sent directly to the creator address via low-level call
- **On-chain event** — `VideoAccessPaid` log enables trustless server-side verification

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Server status, contract address, creator |
| `/api/payment-info` | GET | Full payment details (contract, price, resourceId) |
| `/api/video` | GET | Protected resource — 402 or video URL |
| `/api/verify` | POST | Verify tx via contract event logs |
| `/api/nonce` | GET | Generate unique bytes32 nonce |

## How Verification Works

The server doesn't just check that a transfer happened — it verifies the **contract's event log**:

1. Fetch `eth_getTransactionReceipt` from Apertum RPC
2. Confirm `tx.to` matches the verifier contract address
3. Find logs emitted by the contract with the `VideoAccessPaid` event topic
4. Decode the event: check `creator` address matches AND `amount` >= required price
5. Only then unlock the video

## Project Structure

```
├── server.js              # Express backend (402 flow + contract event verification)
├── public/
│   └── index.html         # Frontend (wallet, ABI encoding, payment UI)
├── .env                   # Configuration
├── package.json
└── README.md
```

## Built With

- [Apertum](https://apertum.io) — High-performance EVM L1 (Avalanche subnet)
- [x402 Standard](https://github.com/coinbase/x402) — HTTP-native micropayment protocol
- A402Verifier — Custom Solidity contract for verified payments
- Express.js, vanilla JS, js-sha3 (CDN), MetaMask
