// augurx_client/utilities/transfer/user_signed_transfer.ts

import { ethers } from "ethers";
import { randomBytes } from "node:crypto";
import {
  chainConfigs,
  GATEWAY_WALLET_ADDRESS,
  GATEWAY_MINTER_ADDRESS,
  type ChainKey,
} from "../utils/config.js";

const ARC_CHAIN: ChainKey = "arcTestnet";
const USDC_DECIMALS = 6;
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

function addressToBytes32(address: string): string {
  return ethers.zeroPadValue(address.toLowerCase(), 32);
}

function createBurnIntent(
  sourceChain: ChainKey,
  destChain: ChainKey,
  transferValue: bigint,
  userAddress: string
) {
  const sourceConfig = chainConfigs[sourceChain];
  const destConfig = chainConfigs[destChain];

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
      sourceDepositor: userAddress,
      destinationRecipient: userAddress,
      sourceSigner: userAddress,
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
        destinationContract: addressToBytes32(burnIntent.spec.destinationContract),
        sourceToken: addressToBytes32(burnIntent.spec.sourceToken),
        destinationToken: addressToBytes32(burnIntent.spec.destinationToken),
        sourceDepositor: addressToBytes32(burnIntent.spec.sourceDepositor),
        destinationRecipient: addressToBytes32(burnIntent.spec.destinationRecipient),
        sourceSigner: addressToBytes32(burnIntent.spec.sourceSigner),
        destinationCaller: addressToBytes32(burnIntent.spec.destinationCaller),
      },
    },
  };
}

export type PrepareTransferInput = {
  userAddress: string;
  isEvmToArc: boolean;
  chainToTransfer: ChainKey;
  amount: number;
};

export type PrepareTransferOutput = {
  typedData: {
    domain: typeof domain;
    types: { TransferSpec: typeof TransferSpec; BurnIntent: typeof BurnIntent };
    primaryType: "BurnIntent";
    message: any;
  };
  transferDetails: {
    sourceChain: ChainKey;
    destChain: ChainKey;
    amount: string;
    amountFormatted: string;
  };
};

export async function prepareBurnIntent(
  input: PrepareTransferInput
): Promise<PrepareTransferOutput> {
  const { userAddress, isEvmToArc, chainToTransfer, amount } = input;

  if (!ethers.isAddress(userAddress)) {
    throw new Error("Invalid user address");
  }

  const transferValue = BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
  const sourceChain = isEvmToArc ? chainToTransfer : ARC_CHAIN;
  const destChain = isEvmToArc ? ARC_CHAIN : chainToTransfer;
  const sourceConfig = chainConfigs[sourceChain];

  // Check gateway balance
  const balanceRes = await fetch(
    "https://gateway-api-testnet.circle.com/v1/balances",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "USDC",
        sources: [{ domain: sourceConfig.domainId, depositor: userAddress }],
      }),
    }
  );

  const balanceData = await balanceRes.json();
  const sourceBalance = balanceData?.balances?.find(
    (b: { domain: number }) => b.domain === sourceConfig.domainId
  );
  const available = sourceBalance ? parseFloat(sourceBalance.balance) : 0;
  const required = amount + 0.01;

  if (available < required) {
    throw new Error(
      `Insufficient Gateway balance on ${sourceChain}. Need ${required.toFixed(2)} USDC, have ${available.toFixed(6)} USDC. Deposit at: npm run deposit -- ${sourceChain}`
    );
  }

  // Create burn intent
  const intent = createBurnIntent(sourceChain, destChain, transferValue, userAddress);
  const typedData = burnIntentTypedData(intent);

  return {
    typedData: {
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    },
    transferDetails: {
      sourceChain,
      destChain,
      amount: transferValue.toString(),
      amountFormatted: ethers.formatUnits(transferValue, USDC_DECIMALS),
    },
  };
}

export type ExecuteTransferInput = {
  signature: string;
  typedData: PrepareTransferOutput["typedData"];
  transferDetails: PrepareTransferOutput["transferDetails"];
};

export type ExecuteTransferOutput = {
  mintTxParams: {
    to: string;
    data: string;
    chainId: number;
    value: string;
  };
  destChain: ChainKey;
  destChainName: string;
};

export async function executeWithSignature(
  input: ExecuteTransferInput
): Promise<ExecuteTransferOutput> {
  const { signature, typedData, transferDetails } = input;
  const { destChain } = transferDetails;

  // Submit to Circle Gateway API
  const requests = [
    {
      burnIntent: typedData.message,
      signature,
    },
  ];

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
    throw new Error("Missing attestation or signature in Gateway response");
  }

  // Encode mint call
  const destConfig = chainConfigs[destChain];
  const iface = new ethers.Interface([
    "function gatewayMint(bytes attestationPayload, bytes signature)",
  ]);
  const mintData = iface.encodeFunctionData("gatewayMint", [
    attestation,
    operatorSig,
  ]);

  return {
    mintTxParams: {
      to: GATEWAY_MINTER_ADDRESS,
      data: mintData,
      chainId: destConfig.chain.id,
      value: "0",
    },
    destChain,
    destChainName: destConfig.chain.name,
  };
}