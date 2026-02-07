import dotenv from "dotenv";
dotenv.config();

import { account } from "./config.js";

const DOMAINS: Record<string, number> = {
  sepolia: 0,
  avalancheFuji: 1,
  baseSepolia: 6,
  arcTestnet: 26,
  hyperliquidEvmTestnet: 19,
  seiTestnet: 16,
  sonicTestnet: 13,
  worldchainSepolia: 14,
};

console.log(`Using account: ${account}`);
console.log(
  "(Gateway unified balance — deposit first: npm run deposit -- <chain>)\n"
);

async function main() {
  const body = {
    token: "USDC",
    sources: Object.entries(DOMAINS).map(([_, domainId]) => ({
      domain: domainId,
      depositor: account,
    })),
  };

  const res = await fetch(
    "https://gateway-api-testnet.circle.com/v1/balances",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const result = await res.json();

  if (!res.ok) {
    throw new Error(`Gateway API ${res.status}: ${JSON.stringify(result)}`);
  }

  const balances = result.balances;
  if (!Array.isArray(balances)) {
    console.error("Unexpected API response:", result);
    throw new Error("API did not return a balances array");
  }

  let total = 0;
  for (const b of balances) {
    const chain =
      Object.keys(DOMAINS).find((k) => DOMAINS[k] === b.domain) ??
      `Domain ${b.domain}`;
    const amount = parseFloat(b.balance ?? "0");
    console.log(`${chain}: ${amount.toFixed(6)} USDC`);
    total += amount;
  }

  console.log(`\nTotal: ${total.toFixed(6)} USDC`);
}

main().catch((error) => {
  console.error("\nError:", error);
  process.exit(1);
});
