# Circle Gateway USDC Scripts

Scripts for depositing and transferring USDC via Circle Gateway (testnet) across EVM and Arc chains.

## Setup

1. **Install dependencies**

   ```bash
   yarn install
   ```

2. **Configure environment**

   Copy `.env.example` to `.env` and set your EVM private key:

   ```bash
   cp .env.example .env
   # Edit .env and set EVM_PRIVATE_KEY=0x...
   ```

   Get testnet USDC and native tokens: [Circle faucet](https://faucet.circle.com), [Console faucet](https://console.circle.com/faucet).

---

## Commands

Use `yarn <script>` or `npm run <script> -- [args]`. Examples use `yarn`.

### Deposit USDC to Gateway

Deposit USDC from your wallet into the Gateway (required before transferring).

```bash
# Default: deposit 1 USDC on Arc Testnet
yarn deposit

# Deposit on specific chain(s)
yarn deposit baseSepolia
yarn deposit arcTestnet baseSepolia

# Deposit on all supported chains
yarn deposit all
```

**Valid chain names:** `sepolia`, `baseSepolia`, `avalancheFuji`, `arcTestnet`, `hyperliquidEvmTestnet`, `seiTestnet`, `sonicTestnet`, `worldchainSepolia`

---

### Transfer: EVM → Arc Testnet

Move USDC from an EVM chain to Arc Testnet. If your Gateway balance on the source chain is too low, the script will attempt to deposit first, then poll until the Gateway API credits the balance before continuing.

```bash
# Transfer 1 USDC (default) from Base Sepolia to Arc Testnet
yarn transfer-evm-to-arc baseSepolia

# Transfer a specific amount (USDC)
yarn transfer-evm-to-arc baseSepolia 0.5
yarn transfer-evm-to-arc baseSepolia 2
```

---

### Transfer: Arc Testnet (or any source) → EVM

Move USDC from a source chain (e.g. Arc Testnet) to a destination EVM chain.

```bash
# Transfer 1 USDC (default) from Arc Testnet to Base Sepolia
yarn transfer-arc-to-evm arcTestnet baseSepolia

# Transfer a specific amount (USDC)
yarn transfer-arc-to-evm arcTestnet baseSepolia 2.5
```

---

### Gateway (vault) balances

Show your unified Gateway USDC balance per chain (what you can use for transfers).

```bash
yarn vault-balances
```

---

### Wallet balance

Show your on-chain wallet balance (native token + USDC) for a single chain.

```bash
yarn wallet-balance baseSepolia
yarn wallet-balance arcTestnet
```

Valid chain names: same as in **Deposit** above.
