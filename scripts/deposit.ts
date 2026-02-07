import {
  createPublicClient,
  getContract,
  http,
  erc20Abi,
  formatUnits,
} from "viem";
import {
  viemAccount,
  chainConfigs,
  parseSelectedChains,
  GATEWAY_WALLET_ADDRESS,
} from "./config.js";

const DEPOSIT_AMOUNT = 2_000000n; // 2 USDC (6 decimals)

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

async function main() {
  console.log(`Using account: ${viemAccount.address}\n`);

  const selectedChains = parseSelectedChains();
  console.log(`Depositing on: ${selectedChains.join(", ")}\n`);

  for (const chainName of selectedChains) {
    const config = chainConfigs[chainName];

    const client = createPublicClient({
      chain: config.chain,
      transport: http(),
    });

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

    console.log(`\n=== Processing ${chainName} ===`);

    const balance = await usdcContract.read.balanceOf([viemAccount.address]);
    console.log(`Current balance: ${formatUnits(balance, 6)} USDC`);

    if (balance < DEPOSIT_AMOUNT) {
      throw new Error(
        "Insufficient USDC balance. Please top up at https://faucet.circle.com"
      );
    }

    try {
      console.log(
        `Approving ${formatUnits(DEPOSIT_AMOUNT, 6)} USDC on ${chainName}...`
      );
      const approvalTx = await usdcContract.write.approve(
        [GATEWAY_WALLET_ADDRESS as `0x${string}`, DEPOSIT_AMOUNT],
        { account: viemAccount, chain: config.chain }
      );
      await client.waitForTransactionReceipt({ hash: approvalTx });
      console.log(`Approved on ${chainName}: ${approvalTx}`);

      console.log(
        `Depositing ${formatUnits(DEPOSIT_AMOUNT, 6)} USDC to Gateway Wallet`
      );
      const depositTx = await gatewayWallet.write.deposit(
        [config.usdcAddress as `0x${string}`, DEPOSIT_AMOUNT],
        { account: viemAccount, chain: config.chain }
      );
      await client.waitForTransactionReceipt({ hash: depositTx });
      console.log(`Done on ${chainName}. Deposit tx: ${depositTx}`);
    } catch (err) {
      console.error(`Error on ${chainName}:`, err);
    }
  }
}

main().catch((error) => {
  console.error("\nError:", error);
  process.exit(1);
});
