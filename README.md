# AugurX

**Permissionless PredictionInfrastructure**
Build the future of forecasting with our Hybrid LMSR engine, cross-chain liquidity via Circle Gateway, and futarchy governance. Deploy prediction markets in minutes, not months

---

## Project Structure

```
AugurX/
├── contracts/          # Solidity smart contracts (Foundry)
├── augurx_client/      # Node.js API server + on-chain interaction utilities
└── scripts/            # CLI scripts for bridge transfers and contract calls
```

---

## `contracts/` — Smart Contracts (Foundry)

Solidity contracts compiled and deployed with [Foundry](https://book.getfoundry.sh/). Deployed on **Arc Testnet** (chain ID 5042002).

### Source contracts (`contracts/src/`)

| Contract | Purpose |
|---|---|
| `predictionMarket/PredictionMarketFactory.sol` | Factory that creates and tracks binary/categorical prediction markets |
| `predictionMarket/Binary.sol` | Binary (Yes/No) market implementation using logarithmic market scoring |
| `predictionMarket/CategoricalMarket.sol` | Multi-outcome categorical market |
| `predictionMarket/FixedPointMath.sol` | Fixed-point arithmetic library for market math |
| `predictionMarket/PrizeDistributor.sol` | Handles payout distribution to winning bettors |
| `predictionMarket/SettlementResolver.sol` | Resolves markets based on oracle outcomes |
| `futarchy/IFutarchy.sol` | Interface for Futarchy governance mechanism |
| `futarchy/FutarchyEscrow.sol` | Escrow contract holding funds pending futarchy decisions |
| `futarchy/FutarchyCrowdfund.sol` | Crowdfunding tied to futarchy market outcomes |
| `futarchy/DecisionOracle.sol` | Oracle that feeds real-world outcomes into futarchy decisions |
| `crowdfund.sol` | Standalone crowdfunding contract |

### Deploy scripts (`contracts/script/`)

| Script | What it deploys |
|---|---|
| `DeployPredictionMarket.s.sol` | `PredictionMarketFactory` to Arc Testnet |
| `DeployCrowdfund.s.sol` | `crowdfund` contract to Arc Testnet |
| `DeployFutarchy.s.sol` | Futarchy suite (escrow, crowdfund, oracle) |

### Supporting folders

- **`contracts/lib/`** — Git submodules: `forge-std` (testing/scripting) and `openzeppelin-contracts` (standard contract libraries)
- **`contracts/broadcast/`** — Foundry deployment receipts (transaction hashes, addresses per run)
- **`contracts/cache/`** — Foundry build cache

---

## `augurx_client/` — API Server & Utilities

Express.js API server (`index.js`) that acts as a backend for cross-chain USDC transfers (via Circle Gateway) and prediction market interactions.

### API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/prepare-transfer` | Builds an unsigned burn intent for a USDC cross-chain transfer |
| `POST` | `/execute-transfer` | Submits the signed burn intent to Circle Gateway and returns mint tx params |
| `GET` | `/prediction-market/market-count` | Returns total number of deployed markets |
| `GET` | `/prediction-market/creation-fee` | Returns the fee required to create a new market |
| `GET` | `/prediction-market/min-seed-amount` | Returns minimum liquidity seed for a market |
| `GET` | `/prediction-market/owner` | Returns factory contract owner |
| `GET` | `/prediction-market/permissionless-creation` | Whether anyone can create markets |
| `GET` | `/prediction-market/authorized-creators/:address` | Checks if an address is an authorized creator |
| `GET` | `/prediction-market/markets/:marketId` | Fetches info for a specific market |
| `POST` | `/prediction-market/create-binary-market` | Creates a new binary (Yes/No) prediction market on-chain |
| `GET` | `/health` | Health check |

### Sub-folders

| Folder | Purpose |
|---|---|
| `utilities/transfer/` | `unified_signed_transfer.ts` — core logic for preparing Circle Gateway burn intents and executing signed transfers |
| `utilities/call_contracts/` | Scripts and ABIs for direct contract interaction (`PredictionMarket_interact.js`, `crowdfund_interact.js`) plus compiled ABIs (`PredictionMarketFactory.json`, `crowdfund.json`) |
| `utilities/utils/` | Shared helpers: `config.ts` (chain configs, USDC addresses, gateway addresses), `deposit.ts`, `vault_balances.ts`, `wallet_balance.ts` |

### Running the server

```bash
cd augurx_client
yarn install
node index.js        # starts at http://localhost:3000
```

**Environment (`.env`)**

| Variable | Required | Description |
|---|---|---|
| `EVM_PRIVATE_KEY` | Yes | Wallet key for signing prediction market transactions |

---

## `scripts/` — CLI Transfer & Utility Scripts

Standalone Node.js scripts for bridging tokens and interacting with contracts directly from the command line. All scripts read configuration from a `.env` file.

### Bridge scripts

| Script | Direction | Description |
|---|---|---|
| `transferArcToEvm_api_call.js` | Arc → baseSepolia | Calls the local API to prepare a burn intent, signs it, and executes an ARC-to-EVM bridge transfer |
| `transferEvmToArc_api_call.js` | baseSepolia → Arc | Same flow in reverse (EVM to Arc) |

**Usage**

```bash
# Default amount: 1
node scripts/transferArcToEvm_api_call.js
node scripts/transferArcToEvm_api_call.js 2.5

node scripts/transferEvmToArc_api_call.js
node scripts/transferEvmToArc_api_call.js 0.5
```

**Environment (`.env`)**

| Variable | Required | Description |
|---|---|---|
| `PRIVATE_KEY` | Yes | Wallet private key for signing burn intents |
| `USER_ADDRESS` | No | Recipient address; defaults to derived address of `PRIVATE_KEY` |
| `API_BASE` | No | API server URL; defaults to `http://localhost:3000` |
| `AMOUNT` | No | Default token amount if not passed as CLI argument |
| `SOURCE_CHAIN` | No | Source chain for EVM→Arc transfer; defaults to `baseSepolia` |

### npm scripts (in `scripts/package.json`)

```bash
npm run transfer_api_arc_to_evm   # node transferArcToEvm_api_call.js
npm run transfer_api_evm_to_arc   # node transferEvmToArc_api_call.js
npm run crowdfund                  # node call_contracts/crowdfund_interact.js
npm run deposit                    # tsx deposit.ts
npm run balances                   # tsx balances.ts
npm run vault-balances             # tsx vault_balances.ts
npm run wallet-balance             # tsx wallet_balance.ts
```

---

## Supported Chains

The Circle Gateway bridge supports transfers between Arc Testnet and any of:

| Chain | Chain ID |
|---|---|
| Sepolia | 11155111 |
| Base Sepolia | 84532 |
| Avalanche Fuji | 43113 |
| Hyperliquid EVM Testnet | 998 |
| Sei Testnet | 713715 |
| Sonic Testnet | 64165 |
| Worldchain Sepolia | 4801 |
