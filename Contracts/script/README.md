# Deployment Scripts

## Arc Testnet

- **Chain ID:** 5042002  
- **RPC:** `https://rpc.testnet.arc.network` (alias: `arc_testnet` in `foundry.toml`)  
- **Currency:** USDC  

---

## 1. DeployCrowdfund.s.sol

Deploys the simple `Crowdfund` contract.

```bash
source .env && forge script script/DeployCrowdfund.s.sol:DeployCrowdfund \
  --rpc-url arc_testnet --broadcast --private-key $PRIVATE_KEY --chain-id 5042002
```

---

## 2. DeployPredictionMarket.s.sol (prediction market stack)

Deploys **SimpleSettlementResolver**, **PredictionMarketFactory**, and **PrizeDistributor** (used by `src/predictionMarket/`).

**Required in `.env`:**
- `PRIVATE_KEY`
- `COLLATERAL_TOKEN` — USDC contract address on the network

**Optional:**
- `CREATION_FEE` (default: 0)
- `MIN_SEED_AMOUNT` (default: 10000 = 0.01 USDC for 6 decimals)
- `PERMISSIONLESS` (default: true)

**Example:**
```bash
export COLLATERAL_TOKEN=0x...   # USDC on Arc Testnet
source .env && forge script script/DeployPredictionMarket.s.sol:DeployPredictionMarket \
  --rpc-url arc_testnet --broadcast --private-key $PRIVATE_KEY --chain-id 5042002
```

After deployment, use the **SimpleSettlementResolver** address as `settlementLogic` when calling `factory.createBinaryMarket(...)` or `createCategoricalMarket(...)`. Resolve markets via `resolver.resolveMarket(marketAddress, winningOutcome)` (owner only). Set **PrizeDistributor** on each market after resolution with `market.setPrizeDistributor(distributor)`.

---

## 3. DeployFutarchy.s.sol (futarchy stack)

Deploys **FutarchyCrowdfund** (which deploys **DecisionOracle** internally). Uses an existing **PredictionMarketFactory** and USDC.

**Required in `.env`:**
- `PRIVATE_KEY`
- `MARKET_FACTORY` — address of deployed `PredictionMarketFactory`
- `COLLATERAL_TOKEN` — USDC contract address

**Example (deploy prediction market first, then futarchy):**
```bash
# 1) Deploy prediction market stack
export COLLATERAL_TOKEN=0x...
source .env && forge script script/DeployPredictionMarket.s.sol:DeployPredictionMarket \
  --rpc-url arc_testnet --broadcast --private-key $PRIVATE_KEY --chain-id 5042002

# 2) Set MARKET_FACTORY to the logged PredictionMarketFactory address, then:
export MARKET_FACTORY=0x...
source .env && forge script script/DeployFutarchy.s.sol:DeployFutarchy \
  --rpc-url arc_testnet --broadcast --private-key $PRIVATE_KEY --chain-id 5042002
```

FutarchyCrowdfund creates proposals with two conditional markets and two FutarchyEscrows; it uses itself as the settlement resolver for those markets.
