import dotenv from "dotenv";
dotenv.config();

import { Wallet } from "ethers";
import { privateKeyToAccount } from "viem/accounts";

/* Account Setup */
if (!process.env.EVM_PRIVATE_KEY) {
  throw new Error("EVM_PRIVATE_KEY not set in environment");
}
// Normalize: trim and ensure 0x prefix for viem (hex string required)
const rawKey = process.env.EVM_PRIVATE_KEY.trim();
const evmPrivateKey: `0x${string}` = rawKey.startsWith("0x")
  ? (rawKey as `0x${string}`)
  : (`0x${rawKey}` as `0x${string}`);

export const wallet = new Wallet(evmPrivateKey);
export const viemAccount = privateKeyToAccount(evmPrivateKey);
/** Address string for ethers scripts; use viemAccount for viem (deposit). */
export const account = wallet.address;

/* Gateway Contract Addresses */
export const GATEWAY_WALLET_ADDRESS: string =
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
export const GATEWAY_MINTER_ADDRESS: string =
  "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";

/* Chain Type Definition */
export type ChainConfig = {
  name: string;
  id: number;
  rpcUrl: string;
  rpcUrls: { default: { http: string[] } };
};

function chainWithRpc(name: string, id: number, rpcUrl: string) {
  return {
    name,
    id,
    rpcUrl,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

/* Chain Configuration */
export const chainConfigs = {
  sepolia: {
    chain: chainWithRpc("Sepolia", 11155111, "https://rpc.sepolia.org"),
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    domainId: 0,
  },
  baseSepolia: {
    chain: chainWithRpc("Base Sepolia", 84532, "https://sepolia.base.org"),
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    domainId: 6,
  },
  avalancheFuji: {
    chain: chainWithRpc(
      "Avalanche Fuji",
      43113,
      "https://api.avax-test.network/ext/bc/C/rpc"
    ),
    usdcAddress: "0x5425890298aed601595a70ab815c96711a31bc65",
    domainId: 1,
  },
  arcTestnet: {
    chain: chainWithRpc(
      "Arc Testnet",
      5042002,
      "https://rpc.testnet.arc.network"
    ),
    usdcAddress: "0x3600000000000000000000000000000000000000",
    domainId: 26,
  },
  hyperliquidEvmTestnet: {
    chain: chainWithRpc(
      "Hyperliquid EVM Testnet",
      998,
      "https://api.hyperliquid-testnet.xyz/evm"
    ),
    usdcAddress: "0x2B3370eE501B4a559b57D449569354196457D8Ab",
    domainId: 19,
  },
  seiTestnet: {
    chain: chainWithRpc(
      "Sei Testnet",
      713715,
      "https://evm-rpc-testnet.sei-apis.com"
    ),
    usdcAddress: "0x4fCF1784B31630811181f670Aea7A7bEF803eaED",
    domainId: 16,
  },
  sonicTestnet: {
    chain: chainWithRpc(
      "Sonic Testnet",
      64165,
      "https://rpc.testnet.soniclabs.com"
    ),
    usdcAddress: "0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51",
    domainId: 13,
  },
  worldchainSepolia: {
    chain: chainWithRpc(
      "Worldchain Sepolia",
      4801,
      "https://worldchain-sepolia.g.alchemy.com/public"
    ),
    usdcAddress: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88",
    domainId: 14,
  },
} as const;

export type ChainKey = keyof typeof chainConfigs;

/* CLI Argument Parsing Helper */
export function parseSelectedChains(): ChainKey[] {
  const args = process.argv.slice(2);
  const validChains = Object.keys(chainConfigs) as ChainKey[];

  if (args.length === 0) {
    return ["arcTestnet"] as ChainKey[]; // default when no chain specified
  }

  if (args.length === 1 && args[0] === "all") {
    return validChains;
  }

  const invalid = args.filter((c) => !validChains.includes(c as ChainKey));
  if (invalid.length > 0) {
    console.error(`Unsupported chain: ${invalid.join(", ")}`);
    console.error(`Valid chains: ${validChains.join(", ")}, all`);
    process.exit(1);
  }

  return [...new Set(args)] as ChainKey[];
}
