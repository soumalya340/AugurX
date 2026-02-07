import { randomBytes } from "node:crypto";
import {
  http,
  maxUint256,
  zeroAddress,
  pad,
  createPublicClient,
  getContract,
  createWalletClient,
  formatUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji, arcTestnet, seiTestnet } from "viem/chains";

/* Constants */
const GATEWAY_WALLET_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const GATEWAY_MINTER_ADDRESS = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";

const TRANSFER_VALUE = 5_000000n; // 5 USDC (6 decimals)
const MAX_FEE = 2_010000n;

// Source chains configuration
const sourceChains = [
  {
    name: "arcTestnet",
    chain: arcTestnet,
    usdcAddress: "0x3600000000000000000000000000000000000000",
    domainId: 26,
  },
  {
    name: "avalancheFuji",
    chain: avalancheFuji,
    usdcAddress: "0x5425890298aed601595a70ab815c96711a31bc65",
    domainId: 1,
  },
];

// Destination chain configuration
const destinationChain = {
  name: "seiTestnet",
  chain: seiTestnet,
  usdcAddress: "0x4fCF1784B31630811181f670Aea7A7bEF803eaED",
  domainId: 16,
};

const domain = { name: "GatewayWallet", version: "1" };

const EIP712Domain = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
] as const;

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
] as const;

const BurnIntent = [
  { name: "maxBlockHeight", type: "uint256" },
  { name: "maxFee", type: "uint256" },
  { name: "spec", type: "TransferSpec" },
] as const;

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

// Get account from environment
if (!process.env.EVM_PRIVATE_KEY) throw new Error("EVM_PRIVATE_KEY not set");
const account = privateKeyToAccount(
  process.env.EVM_PRIVATE_KEY as `0x${string}`
);

console.log(`Using account: ${account.address}`);
console.log(`Transferring from: ${sourceChains.map((c) => c.name).join(", ")}`);
console.log(`Transferring to: ${destinationChain.name}\n`);

// Create and sign burn intents for each source chain
const requests = [];

for (const sourceChain of sourceChains) {
  console.log(
    `Creating burn intent from ${sourceChain.name} → ${destinationChain.name}...`
  );

  const burnIntent = {
    maxBlockHeight: maxUint256,
    maxFee: MAX_FEE,
    spec: {
      version: 1,
      sourceDomain: sourceChain.domainId,
      destinationDomain: destinationChain.domainId,
      sourceContract: GATEWAY_WALLET_ADDRESS,
      destinationContract: GATEWAY_MINTER_ADDRESS,
      sourceToken: sourceChain.usdcAddress,
      destinationToken: destinationChain.usdcAddress,
      sourceDepositor: account.address,
      destinationRecipient: account.address,
      sourceSigner: account.address,
      destinationCaller: zeroAddress,
      value: TRANSFER_VALUE,
      salt: "0x" + randomBytes(32).toString("hex"),
      hookData: "0x",
    },
  };

  const typedData = {
    types: { EIP712Domain, TransferSpec, BurnIntent },
    domain,
    primaryType: "BurnIntent" as const,
    message: {
      ...burnIntent,
      spec: {
        ...burnIntent.spec,
        sourceContract: pad(
          burnIntent.spec.sourceContract.toLowerCase() as `0x${string}`,
          { size: 32 }
        ),
        destinationContract: pad(
          burnIntent.spec.destinationContract.toLowerCase() as `0x${string}`,
          { size: 32 }
        ),
        sourceToken: pad(
          burnIntent.spec.sourceToken.toLowerCase() as `0x${string}`,
          { size: 32 }
        ),
        destinationToken: pad(
          burnIntent.spec.destinationToken.toLowerCase() as `0x${string}`,
          { size: 32 }
        ),
        sourceDepositor: pad(
          burnIntent.spec.sourceDepositor.toLowerCase() as `0x${string}`,
          { size: 32 }
        ),
        destinationRecipient: pad(
          burnIntent.spec.destinationRecipient.toLowerCase() as `0x${string}`,
          { size: 32 }
        ),
        sourceSigner: pad(
          burnIntent.spec.sourceSigner.toLowerCase() as `0x${string}`,
          { size: 32 }
        ),
        destinationCaller: pad(
          burnIntent.spec.destinationCaller.toLowerCase() as `0x${string}`,
          { size: 32 }
        ),
      },
    },
  };

  const signature = await account.signTypedData(
    typedData as Parameters<typeof account.signTypedData>[0]
  );
  requests.push({ burnIntent: typedData.message, signature });
}

console.log("Signed burn intents.\n");
