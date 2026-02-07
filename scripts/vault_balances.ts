import dotenv from "dotenv";
dotenv.config();

import { account, chainConfigs, type ChainKey } from "./config.js";

const GATEWAY_BALANCES_URL =
  "https://gateway-api-testnet.circle.com/v1/balances";

export type VaultBalanceEntry = { chain: string; balance: number };

export type GetVaultBalancesOptions = {
  /** If set, only return balances for these chains (sender + recipient). */
  chains?: ChainKey[];
  /** If true, do not log to console (only return data). */
  silent?: boolean;
  /** Optional title printed above the balance list (ignored if silent). */
  title?: string;
};

/**
 * Fetch Gateway (vault) USDC balances. Usable as a module or run directly.
 * @returns Array of { chain, balance } for each chain (or only requested chains).
 */
export async function getVaultBalances(
  options: GetVaultBalancesOptions = {}
): Promise<VaultBalanceEntry[]> {
  const { chains, silent = false, title } = options;

  const domainEntries = chains
    ? chains.map((key) => ({
        chainKey: key,
        domainId: chainConfigs[key].domainId,
      }))
    : (
        Object.entries(chainConfigs) as [
          ChainKey,
          (typeof chainConfigs)[ChainKey]
        ][]
      ).map(([chainKey, config]) => ({ chainKey, domainId: config.domainId }));

  const body = {
    token: "USDC",
    sources: domainEntries.map(({ domainId }) => ({
      domain: domainId,
      depositor: account,
    })),
  };

  const res = await fetch(GATEWAY_BALANCES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  if (!res.ok) {
    throw new Error(`Gateway API ${res.status}: ${JSON.stringify(result)}`);
  }

  const balances = result.balances;
  if (!Array.isArray(balances)) {
    throw new Error("API did not return a balances array");
  }

  const domainToChain = new Map(
    domainEntries.map(({ chainKey, domainId }) => [domainId, chainKey])
  );

  const entries: VaultBalanceEntry[] = [];
  let total = 0;

  for (const b of balances) {
    const chain = domainToChain.get(b.domain) ?? `Domain ${b.domain}`;
    const balance = parseFloat(b.balance ?? "0");
    entries.push({ chain, balance });
    total += balance;
  }

  if (!silent) {
    if (title) console.log(`\n${title}`);
    for (const { chain, balance } of entries) {
      console.log(`${chain}: ${balance.toFixed(6)} USDC`);
    }
    console.log(`Total: ${total.toFixed(6)} USDC`);
  }

  return entries;
}

export type WaitForGatewayBalanceOptions = {
  pollIntervalMs?: number;
  timeoutMs?: number;
};

/**
 * Poll Gateway API until the given chain's balance is at least requiredMin.
 * Use after depositing so the transfer can proceed once the API has indexed the deposit.
 */
export async function waitForGatewayBalance(
  chainName: ChainKey,
  requiredMin: number,
  options: WaitForGatewayBalanceOptions = {}
): Promise<void> {
  const { pollIntervalMs = 30_000, timeoutMs = 25 * 60 * 1000 } = options;
  const domainId = chainConfigs[chainName].domainId;
  const body = {
    token: "USDC",
    sources: [{ domain: domainId, depositor: account }],
  };
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(GATEWAY_BALANCES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (!res.ok)
      throw new Error(`Gateway API ${res.status}: ${JSON.stringify(result)}`);
    const b = result.balances?.find(
      (x: { domain: number }) => x.domain === domainId
    );
    const available = b ? parseFloat(b.balance ?? "0") : 0;
    if (available >= requiredMin) {
      console.log(
        `  Gateway balance on ${chainName} is now ${available.toFixed(
          6
        )} USDC. Proceeding with transfer.\n`
      );
      return;
    }
    console.log(
      `  Waiting for Gateway to credit deposit (need ${requiredMin.toFixed(
        2
      )} USDC, have ${available.toFixed(6)}) — polling again in ${
        pollIntervalMs / 1000
      }s...`
    );
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(
    `Timeout: Gateway balance on ${chainName} did not reach ${requiredMin} USDC within ${
      timeoutMs / 60000
    } minutes. Check block confirmations for the chain.`
  );
}

/** Run when file is executed directly (e.g. npm run vault-balances). */
function isMainModule(): boolean {
  const arg = process.argv[1] ?? "";
  return arg.includes("vault_balances");
}

async function main() {
  console.log(`Using account: ${account}`);
  console.log(
    "(Gateway unified balance — deposit first: npm run deposit -- <chain>)\n"
  );
  await getVaultBalances();
}

if (isMainModule()) {
  main().catch((error) => {
    console.error("\nError:", error);
    process.exit(1);
  });
}
