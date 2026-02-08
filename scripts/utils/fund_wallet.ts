/**
 * Fund Wallet Utility: Treasury-sponsored cross-chain USDC transfers.
 *
 * Only whitelisted addresses can use this service.
 *
 * Two flows:
 *
 * EVM → Arc (evm-to-arc):
 *   - User has no gas on Arc Testnet.
 *   - Treasury mints USDC to Arc on behalf of user, then forwards to destination minus commission.
 *
 * Arc → EVM (arc-to-evm):
 *   - User has no gas on Arc to initiate the burn.
 *   - Treasury initiates burn from Arc (using treasury's Gateway balance on Arc).
 *   - Treasury deducts the same USDC amount from its own EVM wallet on the destination chain
 *     and sends it directly to the user's address (net of commission).
 *   - Treasury recoups when the Gateway mint eventually settles on EVM.
 *
 * Usage:
 *   npx tsx utils/fund_wallet.ts evm-to-arc <sourceEvmChain> <destinationAddress> <amountUSDC>
 *   npx tsx utils/fund_wallet.ts arc-to-evm <destinationEvmChain> <destinationAddress> <amountUSDC>
 */

import dotenv from "dotenv";
dotenv.config();

import { ethers } from "ethers";
import { randomBytes } from "node:crypto";
import { chainConfigs, GATEWAY_WALLET_ADDRESS, GATEWAY_MINTER_ADDRESS, type ChainKey } from "./config.js";

// ── Whitelist ──────────────────────────────────────────────────────────────────
// Only these addresses may use the treasury-sponsored transfer service.
const WHITELISTED_ADDRESSES: string[] = [
  // Add addresses here (case-insensitive comparison is used)
  "0x48eE6eda30eAbA8D1308bb6A8371C4DF519F69C4",
];

// ── Constants ─────────────────────────────────────────────────────────────────
const ARC_CHAIN: ChainKey = "arcTestnet";
const USDC_DECIMALS = 6;
const COMMISSION_BPS = 25; // 0.25%
const MAX_FEE = 2_010000n;

const domain = { name: "GatewayWallet", version: "1" };

const TransferSpec = [
  { name: "version", type: "uint32" },
  { name: "sourceDomain", type: "uint32" },
  { name: "destinationDomain", type: "uint32" },
  { name: "sourceContract", type: "bytes32" },
  { name: "destinationContract", type: "bytes32" },
  { name: "sourceToken", type: "bytes32" },
  { name: "destinationToken", type: "bytes32" },
  { name: "sourceDepositor", type: "bytes32" },
  { name: "destinationRecipient", type: "bytes32" },
  { name: "sourceSigner", type: "bytes32" },
  { name: "destinationCaller", type: "bytes32" },
  { name: "value", type: "uint256" },
  { name: "salt", type: "bytes32" },
  { name: "hookData", type: "bytes" },
];

const BurnIntent = [
  { name: "maxBlockHeight", type: "uint256" },
  { name: "maxFee", type: "uint256" },
  { name: "spec", type: "TransferSpec" },
];

const gatewayMinterAbi = [
  {
    type: "function",
    name: "gatewayMint",
    inputs: [
      { name: "attestationPayload", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const erc20Abi = [
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// ── Treasury wallet ───────────────────────────────────────────────────────────

function getTreasuryWallet(provider?: ethers.Provider): ethers.Wallet {
  const key =
    process.env.TREASURY_PRIVATE_KEY?.trim() ||
    process.env.EVM_PRIVATE_KEY?.trim();
  if (!key) {
    throw new Error(
      "TREASURY_PRIVATE_KEY (or EVM_PRIVATE_KEY) must be set in .env"
    );
  }
  const hexKey = key.startsWith("0x") ? key : `0x${key}`;
  const w = new ethers.Wallet(hexKey);
  return provider ? w.connect(provider) : w;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isWhitelisted(address: string): boolean {
  return WHITELISTED_ADDRESSES.some(
    (a) => a.toLowerCase() === address.toLowerCase()
  );
}

function addressToBytes32(address: string): string {
  return ethers.zeroPadValue(address.toLowerCase(), 32);
}

function buildBurnIntent(
  sourceChain: ChainKey,
  destChain: ChainKey,
  value: bigint,
  depositor: string,
  recipient: string
) {
  const src = chainConfigs[sourceChain];
  const dst = chainConfigs[destChain];
  return {
    maxBlockHeight: ethers.MaxUint256,
    maxFee: MAX_FEE,
    spec: {
      version: 1,
      sourceDomain: src.domainId,
      destinationDomain: dst.domainId,
      sourceContract: GATEWAY_WALLET_ADDRESS,
      destinationContract: GATEWAY_MINTER_ADDRESS,
      sourceToken: src.usdcAddress,
      destinationToken: dst.usdcAddress,
      sourceDepositor: depositor,
      destinationRecipient: recipient,
      sourceSigner: depositor,
      destinationCaller: ethers.ZeroAddress,
      value,
      salt: "0x" + randomBytes(32).toString("hex"),
      hookData: "0x",
    },
  };
}

function buildTypedData(intent: ReturnType<typeof buildBurnIntent>) {
  return {
    types: { TransferSpec, BurnIntent },
    domain,
    primaryType: "BurnIntent" as const,
    message: {
      ...intent,
      spec: {
        ...intent.spec,
        sourceContract: addressToBytes32(intent.spec.sourceContract),
        destinationContract: addressToBytes32(intent.spec.destinationContract),
        sourceToken: addressToBytes32(intent.spec.sourceToken),
        destinationToken: addressToBytes32(intent.spec.destinationToken),
        sourceDepositor: addressToBytes32(intent.spec.sourceDepositor),
        destinationRecipient: addressToBytes32(intent.spec.destinationRecipient),
        sourceSigner: addressToBytes32(intent.spec.sourceSigner),
        destinationCaller: addressToBytes32(intent.spec.destinationCaller),
      },
    },
  };
}

async function requestAttestation(
  typedData: ReturnType<typeof buildTypedData>,
  signature: string
): Promise<{ attestation: string; operatorSig: string }> {
  const response = await fetch(
    "https://gateway-api-testnet.circle.com/v1/transfer",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        [{ burnIntent: typedData.message, signature }],
        (_key, value) => (typeof value === "bigint" ? value.toString() : value)
      ),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gateway API error: ${response.status} ${text}`);
  }
  const json = await response.json();
  if (!json?.attestation || !json?.signature) {
    throw new Error("Missing attestation or signature in Gateway response");
  }
  return { attestation: json.attestation, operatorSig: json.signature };
}

// ── Flow 1: EVM → Arc (treasury mints on Arc, forwards to destination) ───────

async function evmToArc(
  sourceChain: ChainKey,
  destinationAddress: string,
  transferValue: bigint
): Promise<void> {
  const treasury = getTreasuryWallet();
  const treasuryAddress = await treasury.getAddress();
  const commission = (transferValue * BigInt(COMMISSION_BPS)) / 10_000n;
  const amountToForward = transferValue - commission;

  console.log(`[EVM→Arc] Treasury: ${treasuryAddress}`);
  console.log(
    `[EVM→Arc] Minting ${ethers.formatUnits(transferValue, USDC_DECIMALS)} USDC on Arc → forwarding ${ethers.formatUnits(amountToForward, USDC_DECIMALS)} USDC to ${destinationAddress}`
  );
  console.log(
    `[EVM→Arc] Commission: ${ethers.formatUnits(commission, USDC_DECIMALS)} USDC (0.25%)`
  );

  // Check treasury Gateway balance on source EVM chain
  const srcConfig = chainConfigs[sourceChain];
  const balanceRes = await fetch(
    "https://gateway-api-testnet.circle.com/v1/balances",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "USDC",
        sources: [{ domain: srcConfig.domainId, depositor: treasuryAddress }],
      }),
    }
  );
  const balanceData = await balanceRes.json();
  const srcBalance = balanceData?.balances?.find(
    (b: { domain: number }) => b.domain === srcConfig.domainId
  );
  const available = srcBalance ? parseFloat(srcBalance.balance) : 0;
  const required = Number(ethers.formatUnits(transferValue, USDC_DECIMALS)) + 0.01;
  console.log(
    `[EVM→Arc] Treasury Gateway balance on ${sourceChain}: ${available.toFixed(6)} USDC`
  );
  if (available < required) {
    throw new Error(
      `Treasury has insufficient Gateway balance on ${sourceChain}. Available: ${available.toFixed(6)}, required: ~${required.toFixed(2)} USDC`
    );
  }

  // Build burn intent: treasury is depositor, mint recipient is treasury (on Arc)
  const intent = buildBurnIntent(
    sourceChain,
    ARC_CHAIN,
    transferValue,
    treasuryAddress,
    treasuryAddress
  );
  const typedData = buildTypedData(intent);
  const signature = await treasury.signTypedData(
    typedData.domain,
    { TransferSpec, BurnIntent },
    typedData.message
  );

  console.log(`[EVM→Arc] Requesting attestation...`);
  const { attestation, operatorSig } = await requestAttestation(typedData, signature);

  // Mint on Arc using treasury wallet (treasury pays gas on Arc)
  const arcConfig = chainConfigs[ARC_CHAIN];
  const arcProvider = new ethers.JsonRpcProvider(arcConfig.chain.rpcUrl);
  const treasuryOnArc = treasury.connect(arcProvider);
  const minter = new ethers.Contract(GATEWAY_MINTER_ADDRESS, gatewayMinterAbi, treasuryOnArc);

  console.log(`[EVM→Arc] Minting on Arc Testnet...`);
  const mintTx = await minter.gatewayMint(attestation, operatorSig);
  await mintTx.wait();
  console.log(`[EVM→Arc] Mint tx: ${mintTx.hash}`);

  // Forward (amount - commission) to destination
  const usdc = new ethers.Contract(arcConfig.usdcAddress, erc20Abi, treasuryOnArc);
  console.log(
    `[EVM→Arc] Forwarding ${ethers.formatUnits(amountToForward, USDC_DECIMALS)} USDC to ${destinationAddress}...`
  );
  const fwdTx = await usdc.transfer(destinationAddress, amountToForward);
  await fwdTx.wait();
  console.log(`[EVM→Arc] Forward tx: ${fwdTx.hash}`);
  console.log(`[EVM→Arc] Done.`);
}

// ── Flow 2: Arc → EVM (treasury burns from Arc, sends from its EVM balance) ──

async function arcToEvm(
  destinationChain: ChainKey,
  destinationAddress: string,
  transferValue: bigint
): Promise<void> {
  const treasury = getTreasuryWallet();
  const treasuryAddress = await treasury.getAddress();
  const commission = (transferValue * BigInt(COMMISSION_BPS)) / 10_000n;
  const amountToSend = transferValue - commission;

  console.log(`[Arc→EVM] Treasury: ${treasuryAddress}`);
  console.log(
    `[Arc→EVM] Burning ${ethers.formatUnits(transferValue, USDC_DECIMALS)} USDC from Arc → sending ${ethers.formatUnits(amountToSend, USDC_DECIMALS)} USDC to ${destinationAddress} on ${destinationChain}`
  );
  console.log(
    `[Arc→EVM] Commission: ${ethers.formatUnits(commission, USDC_DECIMALS)} USDC (0.25%)`
  );

  // Step 1: Check treasury's USDC balance on the destination EVM chain
  const dstConfig = chainConfigs[destinationChain];
  const evmProvider = new ethers.JsonRpcProvider(dstConfig.chain.rpcUrl);
  const treasuryOnEvm = treasury.connect(evmProvider);
  const usdcOnEvm = new ethers.Contract(dstConfig.usdcAddress, erc20Abi, evmProvider);
  const evmBalance = await usdcOnEvm.balanceOf(treasuryAddress);

  console.log(
    `[Arc→EVM] Treasury EVM balance on ${destinationChain}: ${ethers.formatUnits(evmBalance, USDC_DECIMALS)} USDC`
  );
  if (evmBalance < amountToSend) {
    throw new Error(
      `Treasury has insufficient USDC on ${destinationChain}. Available: ${ethers.formatUnits(evmBalance, USDC_DECIMALS)}, need: ${ethers.formatUnits(amountToSend, USDC_DECIMALS)} USDC`
    );
  }

  // Step 2: Check treasury's Gateway balance on Arc
  const arcConfig = chainConfigs[ARC_CHAIN];
  const balanceRes = await fetch(
    "https://gateway-api-testnet.circle.com/v1/balances",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "USDC",
        sources: [{ domain: arcConfig.domainId, depositor: treasuryAddress }],
      }),
    }
  );
  const balanceData = await balanceRes.json();
  const arcBalance = balanceData?.balances?.find(
    (b: { domain: number }) => b.domain === arcConfig.domainId
  );
  const arcAvailable = arcBalance ? parseFloat(arcBalance.balance) : 0;
  const arcRequired = Number(ethers.formatUnits(transferValue, USDC_DECIMALS)) + 0.01;
  console.log(
    `[Arc→EVM] Treasury Gateway balance on Arc: ${arcAvailable.toFixed(6)} USDC`
  );
  if (arcAvailable < arcRequired) {
    throw new Error(
      `Treasury has insufficient Gateway balance on Arc. Available: ${arcAvailable.toFixed(6)}, required: ~${arcRequired.toFixed(2)} USDC`
    );
  }

  // Step 3: Send USDC from treasury's EVM wallet to destination immediately
  console.log(
    `[Arc→EVM] Sending ${ethers.formatUnits(amountToSend, USDC_DECIMALS)} USDC from treasury EVM wallet to ${destinationAddress}...`
  );
  const usdcOnEvmWithSigner = new ethers.Contract(dstConfig.usdcAddress, erc20Abi, treasuryOnEvm);
  const sendTx = await usdcOnEvmWithSigner.transfer(destinationAddress, amountToSend);
  await sendTx.wait();
  console.log(`[Arc→EVM] Send tx: ${sendTx.hash}`);

  // Step 4: Burn on Arc (treasury burns its own Gateway balance to recoup the EVM funds)
  const intent = buildBurnIntent(
    ARC_CHAIN,
    destinationChain,
    transferValue,
    treasuryAddress,
    treasuryAddress // minted back to treasury on EVM side to rebalance
  );
  const typedData = buildTypedData(intent);
  const arcProvider = new ethers.JsonRpcProvider(arcConfig.chain.rpcUrl);
  const treasuryOnArc = treasury.connect(arcProvider);
  const signature = await treasuryOnArc.signTypedData(
    typedData.domain,
    { TransferSpec, BurnIntent },
    typedData.message
  );

  console.log(`[Arc→EVM] Requesting attestation for Arc burn...`);
  const { attestation, operatorSig } = await requestAttestation(typedData, signature);

  // Step 5: Mint on destination EVM chain (back to treasury to rebalance)
  const minter = new ethers.Contract(GATEWAY_MINTER_ADDRESS, gatewayMinterAbi, treasuryOnEvm);
  console.log(`[Arc→EVM] Minting on ${destinationChain} (rebalancing treasury)...`);
  const mintTx = await minter.gatewayMint(attestation, operatorSig);
  await mintTx.wait();
  console.log(`[Arc→EVM] Rebalance mint tx: ${mintTx.hash}`);
  console.log(`[Arc→EVM] Done.`);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseCli(): {
  flow: "evm-to-arc" | "arc-to-evm";
  chain: ChainKey;
  destination: string;
  value: bigint;
} {
  const args = process.argv.slice(2);
  const validChains = Object.keys(chainConfigs) as ChainKey[];

  if (args.length < 4) {
    console.error(
      "Usage: npx tsx utils/fund_wallet.ts <flow> <chain> <destinationAddress> <amountUSDC>"
    );
    console.error(
      "  flow: evm-to-arc | arc-to-evm"
    );
    console.error(`  chain: ${validChains.filter((c) => c !== ARC_CHAIN).join(" | ")}`);
    console.error("  Example: npx tsx utils/fund_wallet.ts evm-to-arc baseSepolia 0xAbc... 1");
    console.error("  Example: npx tsx utils/fund_wallet.ts arc-to-evm baseSepolia 0xAbc... 1");
    process.exit(1);
  }

  const [flow, chain, destination, amountArg] = args as [
    "evm-to-arc" | "arc-to-evm",
    ChainKey,
    string,
    string
  ];

  if (flow !== "evm-to-arc" && flow !== "arc-to-evm") {
    console.error(`Invalid flow: ${flow}. Must be evm-to-arc or arc-to-evm`);
    process.exit(1);
  }
  if (!validChains.includes(chain) || chain === ARC_CHAIN) {
    console.error(
      `Invalid chain: ${chain}. Must be one of: ${validChains.filter((c) => c !== ARC_CHAIN).join(", ")}`
    );
    process.exit(1);
  }
  if (!ethers.isAddress(destination)) {
    console.error(`Invalid destination address: ${destination}`);
    process.exit(1);
  }
  const amount = parseFloat(amountArg);
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error("Amount must be a positive number (USDC).");
    process.exit(1);
  }

  return {
    flow,
    chain,
    destination: ethers.getAddress(destination),
    value: BigInt(Math.round(amount * 10 ** USDC_DECIMALS)),
  };
}

async function main() {
  const { flow, chain, destination, value } = parseCli();

  // Whitelist check
  if (!isWhitelisted(destination)) {
    throw new Error(
      `Address ${destination} is not whitelisted for treasury-sponsored transfers.`
    );
  }

  console.log(`Flow: ${flow}`);
  console.log(`Chain: ${chain}`);
  console.log(`Destination: ${destination}`);
  console.log(
    `Amount: ${ethers.formatUnits(value, USDC_DECIMALS)} USDC\n`
  );

  if (flow === "evm-to-arc") {
    await evmToArc(chain, destination, value);
  } else {
    await arcToEvm(chain, destination, value);
  }
}

main().catch((err) => {
  console.error("\nError:", err.message ?? err);
  process.exit(1);
});
