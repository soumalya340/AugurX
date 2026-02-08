# AugurX
Futarchy prediction markets for hackathons. AI  agents analyze GitHub/Twitter/on-chain → DAO approves → Yes/No markets created. Bet via Yellow Network, early-believer bonuses, AI auto-resolution. MVP: single-track demo. Turning subjective judging into incentivized crowd

---

## Transfer ARC (arc testnet → baseSepolia)

The `transferArcToEvm_api_call.js` script moves ARC from **arc testnet** to **baseSepolia** using the local API. It calls the API to prepare a burn intent, signs it with your wallet, then submits the signed transfer to complete the bridge.

**Prerequisites**

- API running at `http://localhost:3000` (e.g. from `augurx_client`).
- A `.env` file (in project root or `scripts/`) with your wallet private key.

**Command**

```bash
# Default amount: 1 ARC
node scripts/transferArcToEvm_api_call.js

# Custom amount (e.g. 2.5 ARC)
node scripts/transferArcToEvm_api_call.js 2.5
```

**Environment (`.env`)**

| Variable       | Required | Description |
|----------------|----------|-------------|
| `PRIVATE_KEY`  | Yes      | Wallet private key (e.g. `0x...`) used to sign the burn intent. |
| `USER_ADDRESS` | No       | Recipient address; defaults to the address of `PRIVATE_KEY`. |
| `API_BASE`     | No       | API URL; defaults to `http://localhost:3000`. |
| `AMOUNT`       | No       | Default amount in ARC if you don’t pass it as a CLI argument. |
