import {
  createPublicClient,
  createWalletClient,
  getContract,
  http,
  erc20Abi,
  formatUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

/* Constants */
const GATEWAY_WALLET_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const DEPOSIT_AMOUNT = 10_000_000n; // 10 USDC (6 decimals)

const gatewayWalletAbi = [
  {
    type: "function",
    name: "deposit",
    inputs: [
      { name: "token", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

if (!process.env.EVM_PRIVATE_KEY) throw new Error("EVM_PRIVATE_KEY not set");
const account = privateKeyToAccount(
  process.env.EVM_PRIVATE_KEY as `0x${string}`
);

// Set up clients
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

const walletClient = createWalletClient({
  account,
  chain: arcTestnet,
  transport: http(),
});

// Get contract instances
const usdc = getContract({
  address: USDC_ADDRESS,
  abi: erc20Abi,
  client: walletClient,
});

const gatewayWallet = getContract({
  address: GATEWAY_WALLET_ADDRESS,
  abi: gatewayWalletAbi,
  client: walletClient,
});

// Approve Gateway Wallet to spend USDC
console.log(`Approving ${formatUnits(DEPOSIT_AMOUNT, 6)} USDC...`);

const approvalTx = await usdc.write.approve(
  [gatewayWallet.address, DEPOSIT_AMOUNT],
  { account }
);
await publicClient.waitForTransactionReceipt({ hash: approvalTx });
console.log(`Approved: ${approvalTx}`);

console.log(
  `Depositing ${formatUnits(DEPOSIT_AMOUNT, 6)} USDC to Gateway Wallet...`
);

const depositTx = await gatewayWallet.write.deposit(
  [usdc.address, DEPOSIT_AMOUNT],
  { account }
);
await publicClient.waitForTransactionReceipt({ hash: depositTx });
console.log(`Deposit tx: ${depositTx}`);
