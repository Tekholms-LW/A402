# A402 Protocol — Micropayments on Apertum

An on-chain micropayment protocol implementing the [x402 standard](https://github.com/coinbase/x402) on **Apertum** (chain ID 2786). Creators deploy upgradeable personal vaults via a factory contract, set prices in APTM or ERC-20 tokens, and viewers pay to unlock content — all verified on-chain with sub-second finality.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Frontend (Creator Studio / Embed Widget / Viewer Page)          │
│                                                                  │
│  1. Connect wallet → switch to Apertum (2786)                    │
│  2. Factory checks: hasVault(address) → getVault(address)        │
│  3. Load resource: vault.getResource(resourceId)                 │
│  4. Payment: APTM via payForAccess() or ERC-20 via               │
│     payForAccessWithToken() / payForAccessWithPermit()            │
│  5. Verify: vault.hasAccess(resourceId, userAddress) → unlock    │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│  A402FactoryV2 (0x88408192d8548CD864f58E7d3c6f97fD577d4451)     │
│                                                                  │
│  - Deploys ERC-1967 proxy vaults per creator (one per address)   │
│  - Manages global implementation address (UUPS upgrades)         │
│  - Token allowlist (which ERC-20s can be used for payment)       │
│  - Protocol fee configuration (basis points, max 5%)             │
│  - Full vault registry for discovery/indexing                    │
└────────────────────────────────┬─────────────────────────────────┘
                                 │ deploys
┌────────────────────────────────▼─────────────────────────────────┐
│  CreatorVaultV2 Proxy (one per creator)                          │
│  Implementation: 0xF650c0Be28A05c81DB57142040B6c00944dBF878      │
│                                                                  │
│  - Resource management (add, update, pause, content types)       │
│  - Native APTM payments with replay protection (bytes32 nonce)   │
│  - ERC-20 token payments (USDC, etc.) via transferFrom           │
│  - EIP-2612 permit support for gasless ERC-20 approvals          │
│  - Per-resource token pricing (APTM + any number of ERC-20s)     │
│  - Lifetime access grants (on-chain, permanent)                  │
│  - Revenue tracking per resource, per token                      │
│  - Withdrawals: native APTM + any ERC-20 token                  │
│  - UUPS upgradeable (factory or owner authorized)                │
│  - Storage gap for future versions                               │
│                                                                  │
│  Events:                                                         │
│  AccessPaid(payer, resourceId, amount, token, lifetime, ts)      │
│  AccessPaidIndexed(payer, resourceHash, amount, token)           │
│  ResourceAdded / ResourceUpdated / TokenPriceSet                 │
└──────────────────────────────────────────────────────────────────┘
```

## Deployed Contracts

| Contract | Address |
|---|---|
| **A402FactoryV2** | `0x88408192d8548CD864f58E7d3c6f97fD577d4451` |
| **CreatorVaultV2** (implementation) | `0xF650c0Be28A05c81DB57142040B6c00944dBF878` |
| Chain | Apertum (2786) |
| Explorer | [explorer.apertum.io](https://explorer.apertum.io) |

## Frontend Components

| File | Purpose |
|---|---|
| `creator-studio.html` | Full creator dashboard — wallet onboarding, vault creation, add content wizard with APTM + ERC-20 pricing, content management with inline editing, revenue dashboard with charts, embed code generator |
| `embed.js` | Embeddable payment widget — Shadow DOM isolated, self-contained (no dependencies), dark/light themes, token selector for multi-token payments, approve → pay flow for ERC-20s |
| `watch.html` | Standalone viewer page — resource display, token selector, payment flow, auto-unlock for lifetime holders, supports video/article/file/API content types |

## Quick Start

### For Creators

1. Open `creator-studio.html` in a browser with MetaMask
2. Connect wallet → auto-switches to Apertum (2786)
3. If no vault exists, click **Create Vault** (one transaction, ~0.002 APTM gas)
4. **Add Content** — enter resource ID, set APTM price, optionally set ERC-20 token prices, choose content type (video, article, file, API), provide content reference
5. Copy the embed code and paste it on your website

### For Viewers

Visit any page with an A402 embed widget or a `watch.html` link:

1. Connect wallet
2. Select payment token (APTM or any accepted ERC-20)
3. If paying with ERC-20: approve token spend → confirm payment
4. If paying with APTM: confirm single transaction
5. Content unlocks. Lifetime resources stay unlocked permanently.

### For Developers

Embed the widget on any page:

```html
<div data-a402-vault="0xVAULT_ADDRESS"
     data-a402-resource="video-001"
     data-a402-theme="dark">
</div>
<script src="embed.js"></script>
```

Or use the npm package:

```jsx
import { A402Video } from '@apertum/a402-embed/react';

<A402Video
  vault="0xVAULT_ADDRESS"
  resource="video-001"
  theme="dark"
  onPaymentSuccess={(tx) => console.log('Paid:', tx)}
/>
```

## Contract Interface

### Factory — A402FactoryV2

| Function | Description |
|---|---|
| `createVault()` | Deploy a new vault proxy for `msg.sender` |
| `hasVault(address)` → `bool` | Check if an address has a vault |
| `getVault(address)` → `address` | Get a creator's vault proxy address |
| `vaultCount()` → `uint256` | Total vaults deployed |
| `getAllowedTokens()` → `(address[], string[], uint8[])` | Protocol-wide token allowlist |
| `setImplementation(address)` | Update implementation for new vaults (owner only) |
| `upgradeVault(address, address)` | Upgrade a specific vault (owner only) |
| `batchUpgradeVaults(address[], address)` | Upgrade multiple vaults at once (owner only) |
| `addAllowedToken(address, string, uint8)` | Add ERC-20 to allowlist (owner only) |
| `setProtocolFee(uint256)` | Set fee in basis points, max 500 (owner only) |

### Vault — CreatorVaultV2

**Resource Management (creator only):**

| Function | Description |
|---|---|
| `addResource(string id, uint256 price, bool lifetime, string type, string ref)` | Add a new gated resource |
| `updateResource(string id, uint256 price, bool lifetime, bool active)` | Update price, access mode, or pause |
| `updateContentRef(string id, string newRef)` | Change the content reference |
| `setTokenPrice(string id, address token, uint256 price)` | Set ERC-20 price for a resource |
| `removeTokenPrice(string id, address token)` | Remove a token from accepted payments |

**Payments (viewer):**

| Function | Description |
|---|---|
| `payForAccess(string id, bytes32 nonce)` | Pay with native APTM (`msg.value`) |
| `payForAccessWithToken(string id, bytes32 nonce, address token)` | Pay with ERC-20 (requires prior `approve`) |
| `payForAccessWithPermit(string id, address token, bytes32 nonce, uint256 deadline, uint8 v, bytes32 r, bytes32 s)` | Pay with ERC-20 using EIP-2612 gasless permit |

**Read Functions:**

| Function | Description |
|---|---|
| `getResource(string id)` → `(id, price, lifetime, active, type, ref, revenue, payments)` | Full resource details |
| `getResourceByIndex(uint256)` → same | Enumerate resources by index |
| `resourceCount()` → `uint256` | Total resources in this vault |
| `hasAccess(string id, address user)` → `bool` | Check if a user has lifetime access |
| `getAcceptedTokens(string id)` → `(address[], uint256[])` | Accepted tokens and their prices |
| `getTokenPrice(string id, address token)` → `(uint256, bool)` | Price and active status for a token |
| `getVaultStats()` → `(resources, payments, revenue, tokens)` | Aggregate vault statistics |
| `version()` → `uint256` | Returns `2` |

**Withdrawals (creator only):**

| Function | Description |
|---|---|
| `withdraw()` | Withdraw all native APTM |
| `withdrawERC20(address token)` | Withdraw all of a specific ERC-20 token |

## Payment Flows

### Native APTM

```
Viewer                          Vault Contract
  │                                 │
  ├─ payForAccess(id, nonce) ──────▶│  verify nonce, price, active
  │  (msg.value = price)            │  record payment + revenue
  │                                 │  grant lifetime access (if applicable)
  │◀── AccessPaid event ───────────┤  emit event
  │                                 │
  ├─ hasAccess(id, addr) ─────────▶│  return true
```

### ERC-20 Token (approve flow)

```
Viewer                Token Contract          Vault Contract
  │                       │                       │
  ├─ approve(vault, amt)─▶│                       │
  │◀── approval tx ───────┤                       │
  │                       │                       │
  ├─ payForAccessWithToken(id, nonce, token) ────▶│  check nonce, price
  │                       │◀── transferFrom ──────┤  pull tokens from viewer
  │                       │──── tokens ──────────▶│  record payment
  │◀── AccessPaid event ─────────────────────────┤  grant access
```

### ERC-20 Token (gasless permit — single transaction)

```
Viewer                              Vault Contract
  │                                     │
  ├─ sign EIP-2612 permit (off-chain)   │
  │                                     │
  ├─ payForAccessWithPermit(id, token,  │
  │    nonce, deadline, v, r, s) ──────▶│  call token.permit()
  │                                     │  call token.transferFrom()
  │                                     │  record payment + grant access
  │◀── AccessPaid event ───────────────┤
```

## Content Types

| Type | Content Ref | Unlock Behavior |
|---|---|---|
| `video` | YouTube ID, IPFS hash, or direct URL | Embedded player (YouTube iframe or HTML5) |
| `article` | IPFS hash or URL to text/markdown | Fetched and rendered inline |
| `file` | IPFS hash or direct download URL | Download button with resolved link |
| `api` | API endpoint URL | Generated access token + endpoint + usage example |

## Upgrade Path

The system uses UUPS proxies (ERC-1967) for upgradeability. Each vault is a proxy that delegatecalls to the shared implementation.

**To deploy a new version (e.g., V3):**

1. Deploy the new `CreatorVaultV3` implementation contract
2. `factory.setImplementation(v3Address)` — new vaults auto-use V3
3. `factory.batchUpgradeVaults([vault1, vault2, ...], v3Address)` — upgrade existing vaults
4. Verify: `vault.version()` returns `3`

**Storage layout rules for future versions:**

- Never reorder, remove, or change types of existing storage variables
- Append new variables before the `__gap` array and reduce its size
- New functions and modified logic are always safe

## Network Details

| Field | Value |
|---|---|
| Network | Apertum |
| Chain ID | `2786` |
| RPC | `https://rpc.apertum.io/ext/bc/YDJ1r9RMkewATmA7B35q1bdV18aywzmdiXwd9zGBq3uQjsCnn/rpc` |
| Symbol | APTM |
| Explorer | `https://explorer.apertum.io` |
| Finality | ~1 second |

## Project Structure

```
├── creator-studio.html    # Creator dashboard (vault + resource + revenue management)
├── embed.js               # Embeddable payment widget (Shadow DOM, self-contained)
├── watch.html             # Standalone viewer/payment page
├── A402FactoryV2.sol      # Factory contract (vault deployer, upgrades, token allowlist)
├── CreatorVaultV2.sol     # Vault implementation (resources, payments, withdrawals)
├── ERC1967Proxy.sol       # Proxy contract (deployed by factory per creator)
└── README.md
```

## Built With

- [Apertum](https://apertum.io) — High-performance EVM L1 (Avalanche subnet, sub-second finality)
- [x402 Standard](https://github.com/coinbase/x402) — HTTP-native micropayment protocol
- UUPS Proxy Pattern (ERC-1967) — Upgradeable vault contracts
- Vanilla JS — Zero-dependency frontend (no build step, no framework)
