# augurx_client

API server for cross-chain USDC transfers and prediction market interactions on Arc Testnet.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file:
   ```
   EVM_PRIVATE_KEY=<your-private-key>
   PORT=3000
   ```

3. Start the server:
   ```bash
   npm start       # production
   npm run dev     # development (auto-reload)
   ```

## API Endpoints

### Health Check

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/health` | Returns `{ status: "ok" }` |

### Cross-Chain Transfers

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/prepare-transfer` | Prepare an unsigned burn intent for the user to sign |
| POST | `/execute-transfer` | Submit a signed burn intent, returns mint tx params |

#### POST `/prepare-transfer`

```json
{
  "userAddress": "0x...",
  "isEvmToArc": true,
  "chainToTransfer": "baseSepolia",
  "amount": 1
}
```

#### POST `/execute-transfer`

```json
{
  "signature": "0x...",
  "typedData": { "..." },
  "transferDetails": { "..." }
}
```

### Prediction Market

Interacts with the PredictionMarketFactory contract (`0x34797D579d3906fBB2bAA64D427728b9529AD4BD`) on Arc Testnet.

#### Read Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/prediction-market/market-count` | Total number of markets created |
| GET | `/prediction-market/creation-fee` | Market creation fee (wei and ether) |
| GET | `/prediction-market/min-seed-amount` | Minimum seed amount (wei and ether) |
| GET | `/prediction-market/owner` | Contract owner address |
| GET | `/prediction-market/permissionless-creation` | Whether open market creation is enabled |
| GET | `/prediction-market/authorized-creators/:address` | Check if an address is an authorized creator |
| GET | `/prediction-market/markets/:marketId` | Get details for a specific market |

#### Write Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/prediction-market/create-binary-market` | Create a new binary prediction market |

#### POST `/prediction-market/create-binary-market`

**Requires API key** in the `x-api-key` header.

```json
// Headers: { "x-api-key": "0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0" }

{
  "question": "Will ETH hit $5000 by Dec 2025?",
  "outcomeYes": "Yes",
  "outcomeNo": "No",
  "resolutionTimeUnix": 1735689600,
  "initialB": "1000000000000000000",
  "settlementAddress": "0x0000000000000000000000000000000000000000",
  "creatorAddress": "0x..."
}
```

`question` and `creatorAddress` are required. Other fields have sensible defaults:
- `outcomeYes` / `outcomeNo` default to `"Yes"` / `"No"`
- `resolutionTimeUnix` defaults to 1 year from now
- `initialB` defaults to `1e18`
- `settlementAddress` defaults to the zero address

**Response:**

```json
{
  "txHash": "0x...",
  "blockNumber": 12345,
  "marketId": "0",
  "marketAddress": "0x..."
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EVM_PRIVATE_KEY` | Yes (for write endpoints) | Private key for signing transactions on Arc Testnet |
| `PORT` | No | Server port (default: `3000`) |
