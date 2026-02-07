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

See [DEPLOY.md](../DEPLOY.md) for full Arc Testnet details (RPC, WebSocket, alternatives) and XRPL EVM deployment.
