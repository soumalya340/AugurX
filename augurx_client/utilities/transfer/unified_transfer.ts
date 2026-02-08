/**
 * Unified Transfer: USDC between EVM chain ↔ Arc Testnet (via Circle Gateway).
 *
 * - EVM → Arc: arcTestnet is the destination; you pass source EVM chain.
 * - Arc → EVM: arcTestnet is the source; you pass destination EVM chain.
 *
 * Call from other modules only (no CLI):
 *   import { unifiedTransfer } from "./transfer/unified_transfer.js";
 *   await unifiedTransfer({ isEvmToArc: true, chainToTransfer: "baseSepolia", amount: 1 });
 *
 * Flow:
 * 1. Check unified Gateway balance on source (deposit if insufficient).
 * 2. Create and sign burn intent (burn on source).
 * 3. Submit to Gateway API → get attestation + operator signature.
 * 4. Call gatewayMint on destination with attestation → USDC minted.
 */

import dotenv from "dotenv";
dotenv.config();

import { ethers } from "ethers";
import { randomBytes } from "node:crypto";
import {
  wallet,
  account,
  chainConfigs,
  GATEWAY_WALLET_ADDRESS,
  GATEWAY_MINTER_ADDRESS,
  type ChainKey,
} from "../utils/config.js";
import { depositToGateway } from "../utils/deposit.js";
import {
  getVaultBalances,
  waitForGatewayBalance,
} from "../utils/vault_balances.js";
import { logWalletBalances } from "../utils/wallet_balance.js";

const ARC_CHAIN: ChainKey = "arcTestnet";
const validChains = Object.keys(chainConfigs) as ChainKey[];
const validEvmChains = validChains.filter((c) => c !== ARC_CHAIN);

const USDC_DECIMALS = 6;

/** Options for a unified gateway transfer (call from other modules). */
export type UnifiedTransferOptions = {
  /** `true` = EVM chain → Arc; `false` = Arc → EVM chain. */
  isEvmToArc: boolean;
  /** EVM chain: source for EVM→Arc, destination for Arc→EVM (e.g. "baseSepolia"). */
  chainToTransfer: ChainKey;
  /** Amount of USDC to transfer (e.g. 1 or 0.5). */
  amount: number;
};

// ── Constants & typed-data helpers ───────────────────────────────────────────

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

function addressToBytes32(address: string): string {
  return ethers.zeroPadValue(address.toLowerCase(), 32);
}

function createBurnIntent(
  sourceChain: ChainKey,
  destChain: ChainKey,
  transferValue: bigint,
  depositorAddress: string,
  recipientAddress?: string
) {
  const sourceConfig = chainConfigs[sourceChain];
  const destConfig = chainConfigs[destChain];
  const recipient = recipientAddress ?? depositorAddress;

  return {
    maxBlockHeight: ethers.MaxUint256,
    maxFee: MAX_FEE,
    spec: {
      version: 1,
      sourceDomain: sourceConfig.domainId,
      destinationDomain: destConfig.domainId,
      sourceContract: GATEWAY_WALLET_ADDRESS,
      destinationContract: GATEWAY_MINTER_ADDRESS,
      sourceToken: sourceConfig.usdcAddress,
      destinationToken: destConfig.usdcAddress,
      sourceDepositor: depositorAddress,
      destinationRecipient: recipient,
      sourceSigner: depositorAddress,
      destinationCaller: ethers.ZeroAddress,
      value: transferValue,
      salt: "0x" + randomBytes(32).toString("hex"),
      hookData: "0x",
    },
  };
}

function burnIntentTypedData(burnIntent: ReturnType<typeof createBurnIntent>) {
  return {
    types: { TransferSpec, BurnIntent },
    domain,
    primaryType: "BurnIntent" as const,
    message: {
      ...burnIntent,
      spec: {
        ...burnIntent.spec,
        sourceContract: addressToBytes32(burnIntent.spec.sourceContract),
        destinationContract: addressToBytes32(
          burnIntent.spec.destinationContract
        ),
        sourceToken: addressToBytes32(burnIntent.spec.sourceToken),
        destinationToken: addressToBytes32(burnIntent.spec.destinationToken),
        sourceDepositor: addressToBytes32(burnIntent.spec.sourceDepositor),
        destinationRecipient: addressToBytes32(
          burnIntent.spec.destinationRecipient
        ),
        sourceSigner: addressToBytes32(burnIntent.spec.sourceSigner),
        destinationCaller: addressToBytes32(burnIntent.spec.destinationCaller),
      },
    },
  };
}

// ── Exported transfer (call from other modules) ──────────────────────────────

/**
 * Run a unified gateway transfer. Call from other modules only.
 *
 * @param options - isEvmToArc, chainToTransfer (EVM chain), amount in USDC.
 * @throws If chain is invalid, amount <= 0, or any step fails.
 */
export async function unifiedTransfer(
  options: UnifiedTransferOptions
): Promise<void> {
  const { isEvmToArc, chainToTransfer, amount } = options;

  if (!validChains.includes(chainToTransfer) || chainToTransfer === ARC_CHAIN) {
    throw new Error(
      `Invalid chain: ${chainToTransfer}. Valid EVM chains: ${validEvmChains.join(", ")}`
    );
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be a positive number (USDC).");
  }

  const transferValue = BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
  const sourceChain = isEvmToArc ? chainToTransfer : ARC_CHAIN;
  const destChain = isEvmToArc ? ARC_CHAIN : chainToTransfer;

  const directionLabel = isEvmToArc ? "EVM → Arc" : "Arc → EVM";

  console.log(`Account: ${account}`);
  console.log(`Route: ${sourceChain} → ${destChain} (${directionLabel})`);
  console.log(
    `Amount: ${ethers.formatUnits(transferValue, USDC_DECIMALS)} USDC\n`
  );

  const sourceConfig = chainConfigs[sourceChain];
  const destConfig = chainConfigs[destChain];

  // —— Vault balances (before transfer)
  await getVaultBalances({
    chains: [sourceChain, destChain],
    title: "Vault balances (before transfer)",
  });

  // —— Wallet balances (before transfer)
  await logWalletBalances(
    sourceChain,
    destChain,
    "Wallet balances (before transfer)"
  );

  // —— 1. Check unified Gateway balance on source
  console.log("\nChecking unified Gateway balance...");
  const balanceRes = await fetch(
    "https://gateway-api-testnet.circle.com/v1/balances",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "USDC",
        sources: [{ domain: sourceConfig.domainId, depositor: account }],
      }),
    }
  );
  const balanceData = await balanceRes.json();
  const sourceBalance = balanceData?.balances?.find(
    (b: { domain: number }) => b.domain === sourceConfig.domainId
  );
  const available = sourceBalance ? parseFloat(sourceBalance.balance) : 0;
  const amountFormatted = Number(
    ethers.formatUnits(transferValue, USDC_DECIMALS)
  );
  const required = amountFormatted + 0.01; // amount + small fee buffer
  console.log(
    `  ${sourceChain} Gateway balance: ${available.toFixed(6)} USDC`
  );

  if (available < required) {
    console.log(
      `\nInsufficient Gateway balance on ${sourceChain}. Need at least ~${required.toFixed(
        2
      )} USDC, but only have ${available.toFixed(6)} USDC.`
    );
    console.log(`\nAttempting to deposit ${required.toFixed(2)} USDC...`);

    try {
      const depositAmount = BigInt(Math.ceil(required * 10 ** 6));
      await depositToGateway([sourceChain], depositAmount, false);
      await waitForGatewayBalance(sourceChain, required, {
        pollIntervalMs: 30_000,
        timeoutMs: 25 * 60 * 1000,
      });
      console.log(`Continuing with transfer...\n`);
    } catch (err) {
      throw new Error(
        `Failed to deposit on ${sourceChain}: ${err}. Please deposit manually: npm run deposit -- ${sourceChain}`
      );
    }
  }

  // —— 2. Create and sign burn intent (burn on source)
  console.log(
    `\nCreating and signing burn intent (source: ${sourceChain})...`
  );
  const intent = createBurnIntent(
    sourceChain,
    destChain,
    transferValue,
    account
  );
  const typedData = burnIntentTypedData(intent);
  const signature = await wallet.signTypedData(
    typedData.domain,
    { TransferSpec, BurnIntent },
    typedData.message
  );

  const requests = [
    {
      burnIntent: typedData.message,
      signature,
    },
  ];

  // —— 3. Gateway API: attestation + operator signature
  console.log("Requesting attestation from Gateway API...");
  const response = await fetch(
    "https://gateway-api-testnet.circle.com/v1/transfer",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requests, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
      ),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gateway API error: ${response.status} ${text}`);
  }

  const json = await response.json();
  const attestation = json?.attestation;
  const operatorSig = json?.signature;

  if (!attestation || !operatorSig) {
    throw new Error("Missing attestation or signature in response");
  }

  // —— 4. Mint on destination
  console.log(`Minting on ${destConfig.chain.name} (${destChain})...`);
  const destProvider = new ethers.JsonRpcProvider(destConfig.chain.rpcUrl);
  const destWallet = wallet.connect(destProvider);

  const minter = new ethers.Contract(
    GATEWAY_MINTER_ADDRESS,
    gatewayMinterAbi,
    destWallet
  );

  try {
    const mintTx = await minter.gatewayMint(attestation, operatorSig);
    await mintTx.wait();

    console.log(
      `\nMinted ${ethers.formatUnits(
        transferValue,
        USDC_DECIMALS
      )} USDC on ${destChain}`
    );
    console.log(`Tx hash: ${mintTx.hash}`);

    // —— Vault balances (after transfer)
    await getVaultBalances({
      chains: [sourceChain, destChain],
      title: "Vault balances (after transfer)",
    });

    // —— Wallet balances (after transfer)
    await logWalletBalances(
      sourceChain,
      destChain,
      "Wallet balances (after transfer)"
    );
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "INSUFFICIENT_FUNDS") {
      throw new Error(
        `Insufficient native token on ${destChain} to pay for gas. ` +
          `Your burn/attestation succeeded; you need a small amount of testnet native token on the destination chain to complete the mint.`
      );
    }
    throw err;
  }
}
