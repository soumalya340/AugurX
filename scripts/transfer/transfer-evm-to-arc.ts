/**
 * Transfer USDC: EVM chain → Arc Testnet (via Circle Gateway).
 * Destination is always arcTestnet; you pass source chain, amount, and optionally final recipient.
 *
 * Usage: npm run transfer-evm-to-arc -- <sourceChain> [amountUSDC] [destinationAddress]
 * Example: npm run transfer-evm-to-arc -- baseSepolia 1
 * Example: npm run transfer-evm-to-arc -- baseSepolia 0.5 0xRecipient...
 * (amount defaults to 1 USDC; destination defaults to your account)
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

const DESTINATION_CHAIN: ChainKey = "arcTestnet";

const validChains = Object.keys(chainConfigs) as ChainKey[];

const USDC_DECIMALS = 6;

function parseCli(): {
  source: ChainKey;
  transferValue: bigint;
  destinationAddress: string;
} {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error(
      "Usage: npm run transfer-evm-to-arc -- <sourceChain> [amountUSDC] [destinationAddress]"
    );
    console.error(`Example: npm run transfer-evm-to-arc -- baseSepolia 1`);
    console.error(
      `Example: npm run transfer-evm-to-arc -- baseSepolia 0.5 0xRecipient...`
    );
    console.error(`Valid source chains: ${validChains.join(", ")}`);
    console.error(`Destination chain is always: ${DESTINATION_CHAIN}`);
    process.exit(1);
  }
  const [source, amountArg, destinationArg] = args as [
    ChainKey,
    string | undefined,
    string | undefined
  ];
  if (!validChains.includes(source)) {
    console.error(
      `Invalid source chain: ${source}. Valid: ${validChains.join(", ")}`
    );
    process.exit(1);
  }
  if (source === DESTINATION_CHAIN) {
    console.error(
      `Source must not be ${DESTINATION_CHAIN} (destination is fixed).`
    );
    process.exit(1);
  }
  const amount = amountArg !== undefined ? parseFloat(amountArg) : 1;
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error("Amount must be a positive number (USDC).");
    process.exit(1);
  }
  const transferValue = BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
  const destinationAddress =
    destinationArg && ethers.isAddress(destinationArg)
      ? ethers.getAddress(destinationArg)
      : account;
  return { source, transferValue, destinationAddress };
}
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

async function main() {
  const {
    source: SOURCE_CHAIN,
    transferValue,
    destinationAddress,
  } = parseCli();

  console.log(`Account: ${account}`);
  console.log(`Route: ${SOURCE_CHAIN} → ${DESTINATION_CHAIN} (EVM → Arc)`);
  console.log(
    `Amount: ${ethers.formatUnits(transferValue, USDC_DECIMALS)} USDC`
  );
  console.log(`Mint recipient on Arc: ${destinationAddress}\n`);

  const sourceConfig = chainConfigs[SOURCE_CHAIN];
  const destConfig = chainConfigs[DESTINATION_CHAIN];

  console.log("Balances before transfer:");

  // —— Vault balances (before transfer) — sender and recipient chains
  await getVaultBalances({
    chains: [SOURCE_CHAIN, DESTINATION_CHAIN],
    title: "Vault balances (before transfer)",
  });

  // —— Wallet balances (before transfer) — source and destination chains
  await logWalletBalances(
    SOURCE_CHAIN,
    DESTINATION_CHAIN,
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
  const required = amountFormatted + 0.01;
  console.log(
    `  ${SOURCE_CHAIN} Gateway balance: ${available.toFixed(6)} USDC`
  );

  if (available < required) {
    console.log(
      `\nInsufficient Gateway balance on ${SOURCE_CHAIN}. Need at least ~${required.toFixed(
        2
      )} USDC, but only have ${available.toFixed(6)} USDC.`
    );
    console.log(`\nAttempting to deposit ${required.toFixed(2)} USDC...`);

    try {
      const depositAmount = BigInt(Math.ceil(required * 10 ** 6));
      await depositToGateway([SOURCE_CHAIN], depositAmount, false);
      console.log(`\nDeposit successful!`);
      console.log(
        `Waiting for Gateway API to credit balance (can take ~2–20 min)...\n`
      );
      await waitForGatewayBalance(SOURCE_CHAIN, required, {
        pollIntervalMs: 30_000,
        timeoutMs: 25 * 60 * 1000,
      });
      console.log(`Continuing with transfer...\n`);
    } catch (err) {
      throw new Error(
        `Failed to deposit on ${SOURCE_CHAIN}: ${err}. Please deposit manually: npm run deposit -- ${SOURCE_CHAIN}`
      );
    }
  }

  console.log("Balances after deposit:");
  await getVaultBalances({
    chains: [SOURCE_CHAIN, DESTINATION_CHAIN],
    title: "Vault balances (after deposit)",
  });

  await logWalletBalances(
    SOURCE_CHAIN,
    DESTINATION_CHAIN,
    "Wallet balances (after deposit)"
  );

  // —— 2. Create and sign burn intent (burn on source EVM)
  console.log(
    `\nCreating and signing burn intent (source: ${SOURCE_CHAIN})...`
  );
  const intent = createBurnIntent(
    SOURCE_CHAIN,
    DESTINATION_CHAIN,
    transferValue,
    account,
    destinationAddress
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

  // —— 4. Mint on destination (Arc); requires native token on destination for gas
  console.log(`Minting on ${destConfig.chain.name} (${DESTINATION_CHAIN})...`);
  const destProvider = new ethers.JsonRpcProvider(destConfig.chain.rpcUrl);
  const signerWallet = wallet.connect(destProvider);

  const minter = new ethers.Contract(
    GATEWAY_MINTER_ADDRESS,
    gatewayMinterAbi,
    signerWallet
  );

  try {
    const mintTx = await minter.gatewayMint(attestation, operatorSig);
    await mintTx.wait();

    console.log(
      `\nMinted ${ethers.formatUnits(
        transferValue,
        USDC_DECIMALS
      )} USDC on ${DESTINATION_CHAIN} to ${destinationAddress}`
    );
    console.log(`Mint tx hash: ${mintTx.hash}`);

    // —— Vault balances (after transfer) — sender and recipient chains
    await getVaultBalances({
      chains: [SOURCE_CHAIN, DESTINATION_CHAIN],
      title: "Vault balances (after transfer)",
    });

    // —— Wallet balances (after transfer) — source and destination chains
    await logWalletBalances(
      SOURCE_CHAIN,
      DESTINATION_CHAIN,
      "Wallet balances (after transfer)"
    );
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "INSUFFICIENT_FUNDS") {
      throw new Error(
        `Insufficient native token (ETH/USDC) on ${DESTINATION_CHAIN} to pay for gas. ` +
          `Your burn/attestation succeeded; you need a small amount of testnet native token on the destination chain to complete the mint. ` +
          `Arc Testnet: https://faucet.circle.com | Console https://console.circle.com/faucet`
      );
    }
    throw err;
  }
}

main().catch((error) => {
  console.error("\nError:", error);
  process.exit(1);
});
