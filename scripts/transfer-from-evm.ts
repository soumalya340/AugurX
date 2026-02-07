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
} from "./config.js";

const DESTINATION_CHAIN: ChainKey = "baseSepolia";
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

function createBurnIntent(params: {
  sourceChain: ChainKey;
  depositorAddress: string;
  recipientAddress?: string;
}) {
  const {
    sourceChain,
    depositorAddress,
    recipientAddress = depositorAddress,
  } = params;
  const sourceConfig = chainConfigs[sourceChain];
  const destConfig = chainConfigs[DESTINATION_CHAIN];

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
      destinationRecipient: recipientAddress,
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
  console.log(`Using account: ${account}`);

  // Set source chain to arcTestnet as requested
  const selectedChains: ChainKey[] = ["arcTestnet"];
  console.log(`Transferring balance from: ${selectedChains.join(", ")} → ${DESTINATION_CHAIN}`);

  // Check balance on source chain first
  console.log("\nChecking USDC balance on Arc Testnet...");
  const sourceChainConfig = chainConfigs["arcTestnet"];
  const sourceProvider = new ethers.JsonRpcProvider(sourceChainConfig.chain.rpcUrl);

  const usdcAbi = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)"
  ];
  const usdcContract = new ethers.Contract(
    sourceChainConfig.usdcAddress,
    usdcAbi,
    sourceProvider
  );

  const balance = await usdcContract.balanceOf(account);
  const decimals = await usdcContract.decimals();
  const balanceFormatted = ethers.formatUnits(balance, decimals);
  console.log(`Balance: ${balanceFormatted} USDC`);

  if (balance < TRANSFER_VALUE) {
    throw new Error(`Insufficient balance. Need ${ethers.formatUnits(TRANSFER_VALUE, decimals)} USDC but only have ${balanceFormatted} USDC`);
  }

  const requests: {
    burnIntent: ReturnType<typeof burnIntentTypedData>["message"];
    signature: string;
  }[] = [];

  for (const chainName of selectedChains) {
    console.log(
      `\nCreating burn intent from ${chainName} → ${DESTINATION_CHAIN}...`
    );

    const intent = createBurnIntent({
      sourceChain: chainName,
      depositorAddress: account,
    });

    const typedData = burnIntentTypedData(intent);
    const signature = await wallet.signTypedData(
      typedData.domain,
      { TransferSpec, BurnIntent },
      typedData.message
    );

    requests.push({ burnIntent: typedData.message, signature });
  }
  console.log("Signed burn intents.");

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
  console.log("Gateway API response:", JSON.stringify(json, null, 2));

  const attestation = json?.attestation;
  const operatorSig = json?.signature;

  if (!attestation || !operatorSig) {
    throw new Error("Missing attestation or signature in response");
  }

  const destConfig = chainConfigs[DESTINATION_CHAIN];
  const destProvider = new ethers.JsonRpcProvider(destConfig.chain.rpcUrl);
  const destWallet = wallet.connect(destProvider);

  const destinationGatewayMinterContract = new ethers.Contract(
    GATEWAY_MINTER_ADDRESS,
    gatewayMinterAbi,
    destWallet
  );

  console.log(`Minting funds on ${destConfig.chain.name}...`);
  const mintTx = await destinationGatewayMinterContract.gatewayMint(
    attestation,
    operatorSig
  );

  await mintTx.wait();

  const totalMinted = BigInt(requests.length) * TRANSFER_VALUE;
  console.log(`Minted ${ethers.formatUnits(totalMinted, 6)} USDC`);
  console.log(`Mint transaction hash (${DESTINATION_CHAIN}):`, mintTx.hash);
}

main().catch((error) => {
  console.error("\nError:", error);
  process.exit(1);
});
