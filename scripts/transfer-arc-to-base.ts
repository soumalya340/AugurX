/**
 * Transfer USDC: Arc Testnet → Base Sepolia
 *
 * Flow:
 * 1. Check unified Gateway balance on Arc (user must have deposited first).
 * 2. Create and sign burn intent (burn from Arc).
 * 3. Submit to Gateway API → get attestation + operator signature.
 * 4. Call gatewayMint on Base Sepolia with attestation → USDC minted to your wallet.
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
} from "./config.js";

const SOURCE_CHAIN = "arcTestnet" as const;
const DESTINATION_CHAIN = "baseSepolia" as const;

const TRANSFER_VALUE = 1_000000n; // 1 USDC (6 decimals)
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

function createBurnIntent(depositorAddress: string, recipientAddress?: string) {
  const sourceConfig = chainConfigs[SOURCE_CHAIN];
  const destConfig = chainConfigs[DESTINATION_CHAIN];
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
      value: TRANSFER_VALUE,
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
  console.log(`Account: ${account}`);
  console.log(`Route: ${SOURCE_CHAIN} → ${DESTINATION_CHAIN}`);
  console.log(`Amount: ${ethers.formatUnits(TRANSFER_VALUE, 6)} USDC\n`);

  const sourceConfig = chainConfigs[SOURCE_CHAIN];
  const destConfig = chainConfigs[DESTINATION_CHAIN];

  // —— 1. Optional: check unified Gateway balance (run `npm run balances` to see per-chain)
  console.log("Checking unified Gateway balance...");
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
  const arcBalance = balanceData?.balances?.find(
    (b: { domain: number }) => b.domain === sourceConfig.domainId
  );
  const available = arcBalance ? parseFloat(arcBalance.balance) : 0;
  const amountFormatted = Number(ethers.formatUnits(TRANSFER_VALUE, 6));
  const required = amountFormatted + 0.01; // amount + small fee buffer
  console.log(`  Arc Testnet Gateway balance: ${available.toFixed(6)} USDC`);

  if (available < required) {
    throw new Error(
      `Insufficient Gateway balance on ${SOURCE_CHAIN}. Need at least ~${required.toFixed(
        2
      )} USDC. Deposit first: npm run deposit -- ${SOURCE_CHAIN}`
    );
  }

  // —— 2. Create and sign burn intent (burn on Arc)
  console.log("\nCreating and signing burn intent (source: Arc Testnet)...");
  const intent = createBurnIntent(account);
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

  // —— 4. Mint on Base Sepolia
  console.log(`Minting on ${destConfig.chain.name} (Base Sepolia)...`);
  const destProvider = new ethers.JsonRpcProvider(destConfig.chain.rpcUrl);
  const destWallet = wallet.connect(destProvider);

  const minter = new ethers.Contract(
    GATEWAY_MINTER_ADDRESS,
    gatewayMinterAbi,
    destWallet
  );

  const mintTx = await minter.gatewayMint(attestation, operatorSig);
  await mintTx.wait();

  console.log(
    `\nMinted ${ethers.formatUnits(TRANSFER_VALUE, 6)} USDC on Base Sepolia`
  );
  console.log(`Tx hash: ${mintTx.hash}`);
}

main().catch((error) => {
  console.error("\nError:", error);
  process.exit(1);
});
