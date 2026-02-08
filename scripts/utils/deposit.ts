import {
  createPublicClient,
  getContract,
  http,
  erc20Abi,
  formatUnits,
} from "viem";
import {
  account,
  viemAccount,
  chainConfigs,
  parseSelectedChains,
  GATEWAY_WALLET_ADDRESS,
  type ChainKey,
} from "./config.js";

const DEFAULT_DEPOSIT_AMOUNT = 1_000000n; // 1 USDC (6 decimals)

// Gateway Wallet ABI (minimal - only deposit function)
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

/**
 * Deposit USDC to Gateway Wallet on specified chain(s).
 * @param chains - Array of chain keys to deposit on. If not provided, uses CLI args or defaults to arcTestnet.
 * @param amount - Amount in USDC (with 6 decimals). Defaults to 1 USDC.
 * @param silent - If true, reduces console output (useful when called from other scripts).
 */
export async function depositToGateway(
  chains?: ChainKey[],
  amount: bigint = DEFAULT_DEPOSIT_AMOUNT,
  silent: boolean = false
): Promise<void> {
  const selectedChains = chains ?? parseSelectedChains();

  if (!silent) {
    console.log(`Using account: ${account}\n`);
    console.log(`Depositing on: ${selectedChains.join(", ")}\n`);
  }

  for (const chainName of selectedChains) {
    const config = chainConfigs[chainName];

    // Create client for current chain
    const client = createPublicClient({
      chain: config.chain,
      transport: http(),
    });

    // Get contract instances
    const usdcContract = getContract({
      address: config.usdcAddress as `0x${string}`,
      abi: erc20Abi,
      client,
    });

    const gatewayWallet = getContract({
      address: GATEWAY_WALLET_ADDRESS as `0x${string}`,
      abi: gatewayWalletAbi,
      client,
    });

    if (!silent) {
      console.log(`\n=== Processing ${chainName} ===`);
    }

    // Check USDC balance
    const balance = await usdcContract.read.balanceOf([
      account as `0x${string}`,
    ]);
    if (!silent) {
      console.log(`Current balance: ${formatUnits(balance, 6)} USDC`);
    }

    if (balance < amount) {
      throw new Error(
        `Insufficient USDC balance on ${chainName}. Have ${formatUnits(
          balance,
          6
        )} USDC, need ${formatUnits(
          amount,
          6
        )} USDC. Please top up at https://faucet.circle.com`
      );
    }

    try {
      // [1] Approve Gateway Wallet to spend USDC
      if (!silent) {
        console.log(
          `Approving ${formatUnits(amount, 6)} USDC on ${chainName}...`
        );
      }
      const approvalTx = await usdcContract.write.approve(
        [GATEWAY_WALLET_ADDRESS as `0x${string}`, amount],
        { account: viemAccount }
      );
      await client.waitForTransactionReceipt({ hash: approvalTx });
      if (!silent) {
        console.log(`Approved on ${chainName}: ${approvalTx}`);
      }

      // [2] Deposit USDC into Gateway Wallet
      if (!silent) {
        console.log(
          `Depositing ${formatUnits(amount, 6)} USDC to Gateway Wallet`
        );
      }
      const depositTx = await gatewayWallet.write.deposit(
        [config.usdcAddress as `0x${string}`, amount],
        { account: viemAccount }
      );
      await client.waitForTransactionReceipt({ hash: depositTx });
      if (!silent) {
        console.log(`Done on ${chainName}. Deposit tx: ${depositTx}`);
      }
    } catch (err) {
      console.error(`Error on ${chainName}:`, err);
      throw err;
    }
  }
}

async function main() {
  await depositToGateway();
}

// Only run main if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("\nError:", error);
    process.exit(1);
  });
}

export default depositToGateway;
