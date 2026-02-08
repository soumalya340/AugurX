import dotenv from "dotenv";
dotenv.config();

import {
  createPublicClient,
  getContract,
  http,
  formatUnits,
  erc20Abi,
} from "viem";
import { account, chainConfigs, type ChainKey } from "./config.js";

const validChains = Object.keys(chainConfigs) as ChainKey[];

export type WalletBalanceResult = {
  chain: ChainKey;
  nativeSymbol: string;
  nativeBalance: string;
  usdcBalance: string;
  isArc: boolean;
};

export type GetWalletBalanceOptions = {
  /** If true, do not log to console (only return data). */
  silent?: boolean;
  /** Optional label (e.g. "Source", "Destination") printed when not silent. */
  label?: string;
};

/**
 * Fetch wallet balance (native token + USDC) for one chain. Usable as module or via CLI.
 * On Arc Testnet only USDC is shown (native gas token).
 */
export async function getWalletBalance(
  chainName: ChainKey,
  options: GetWalletBalanceOptions = {}
): Promise<WalletBalanceResult> {
  const { silent = false, label } = options;
  const config = chainConfigs[chainName];
  const depositorAddress = account as `0x${string}`;

  const client = createPublicClient({
    chain: config.chain,
    transport: http(config.chain.rpcUrl),
  });

  const isArc = chainName === "arcTestnet";

  if (!silent && label !== undefined) {
    console.log(`  [${label}] ${chainName} (${config.chain.name}):`);
  }

  if (isArc) {
    const usdcContract = getContract({
      address: config.usdcAddress as `0x${string}`,
      abi: erc20Abi,
      client,
    });
    const usdcBalance = await usdcContract.read.balanceOf([depositorAddress]);
    const usdcFormatted = formatUnits(usdcBalance, 6);
    if (!silent) {
      console.log(`    USDC: ${usdcFormatted} (native gas token on Arc)`);
    }
    return {
      chain: chainName,
      nativeSymbol: "USDC",
      nativeBalance: usdcFormatted,
      usdcBalance: usdcFormatted,
      isArc: true,
    };
  }

  const [nativeBalance, usdcBalance] = await Promise.all([
    client.getBalance({ address: depositorAddress }),
    (async () => {
      const usdcContract = getContract({
        address: config.usdcAddress as `0x${string}`,
        abi: erc20Abi,
        client,
      });
      return usdcContract.read.balanceOf([depositorAddress]);
    })(),
  ]);

  const nativeSymbol = config.chain.nativeCurrency?.symbol ?? "ETH";
  const nativeDecimals = config.chain.nativeCurrency?.decimals ?? 18;
  const nativeFormatted = formatUnits(nativeBalance, nativeDecimals);
  const usdcFormatted = formatUnits(usdcBalance, 6);

  if (!silent) {
    console.log(`    ${nativeSymbol}: ${nativeFormatted}`);
    console.log(`    USDC: ${usdcFormatted}`);
  }

  return {
    chain: chainName,
    nativeSymbol,
    nativeBalance: nativeFormatted,
    usdcBalance: usdcFormatted,
    isArc: false,
  };
}

/** Log wallet balances for source and destination chains (before/after transfer). */
export async function logWalletBalances(
  sourceChain: ChainKey,
  destChain: ChainKey,
  sectionTitle: string
): Promise<void> {
  console.log(`\n${sectionTitle}`);
  await getWalletBalance(sourceChain, { label: "Source" });
  await getWalletBalance(destChain, { label: "Destination" });
}

function parseChainFromCli(): ChainKey {
  const arg = process.argv[2];
  if (!arg || !validChains.includes(arg as ChainKey)) {
    console.error("Usage: npm run wallet-balance -- <chainName>");
    console.error(`Valid chains: ${validChains.join(", ")}`);
    process.exit(1);
  }
  return arg as ChainKey;
}

async function main() {
  const chainName = parseChainFromCli();
  console.log(`Chain: ${chainConfigs[chainName].chain.name} (${chainName})`);
  console.log(`Account: ${account}\n`);
  await getWalletBalance(chainName);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("\nError:", error);
    process.exit(1);
  });
}
