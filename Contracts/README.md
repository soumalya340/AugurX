# Deployment Scripts

## Arc Testnet

- **Chain ID:** 5042002
- **RPC:** `https://rpc.testnet.arc.network` (alias in `foundry.toml`: `arc_testnet`)
- **Currency:** USDC

### DeployCrowdfund.s.sol

Deploys the Crowdfund contract to Arc Testnet:

```bash
source .env && forge script script/DeployCrowdfund.s.sol:DeployCrowdfund \
  --rpc-url arc_testnet \
  --broadcast \
  --private-key $PRIVATE_KEY \
  --chain-id 5042002
```

### DeployFutarchy.s.sol

Deploys **FutarchyCrowdfund** (and **DecisionOracle**). Requires `MARKET_FACTORY` and `COLLATERAL_TOKEN` (USDC) in `.env`. Deploy the prediction market stack first, then set `MARKET_FACTORY` to the logged factory address.

```bash
export MARKET_FACTORY=0x...   # PredictionMarketFactory address from DeployPredictionMarket
export COLLATERAL_TOKEN=0x... # USDC on Arc Testnet
source .env && forge script script/DeployFutarchy.s.sol:DeployFutarchy \
  --rpc-url arc_testnet \
  --broadcast \
  --private-key $PRIVATE_KEY \
  --chain-id 5042002
```

See [script/README.md](script/README.md) for all scripts (Crowdfund, PredictionMarket, Futarchy) and env details. See [DEPLOY.md](../DEPLOY.md) for full Arc Testnet details (RPC, WebSocket, alternatives) and XRPL EVM deployment.
