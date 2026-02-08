/**
 * Unified gateway CLI: run either EVM→Arc or Arc→EVM transfers from a single entry point.
 *
 * Usage:
 *   npm run gateway -- evm-to-arc <sourceChain> [amountUSDC] [destinationAddress]
 *   npm run gateway -- arc-to-evm <destinationChain> [amountUSDC]
 *
 * Examples:
 *   npm run gateway -- evm-to-arc baseSepolia 1
 *   npm run gateway -- evm-to-arc baseSepolia 0.5 0xRecipient...
 *   npm run gateway -- arc-to-evm baseSepolia 1
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const VALID_DIRECTIONS = ["evm-to-arc", "arc-to-evm"] as const;
type Direction = (typeof VALID_DIRECTIONS)[number];

function printUsage(): void {
  console.error(`
Unified Gateway CLI - Transfer USDC via Circle Gateway

Usage:
  npm run gateway -- <direction> [args...]

Directions:
  evm-to-arc   Transfer from an EVM chain to Arc Testnet
               Args: <sourceChain> [amountUSDC] [destinationAddress]
               Example: evm-to-arc baseSepolia 1
               Example: evm-to-arc baseSepolia 0.5 0xRecipient...

  arc-to-evm   Transfer from Arc Testnet to an EVM chain (source is fixed)
               Args: <destinationChain> [amountUSDC]
               Example: arc-to-evm baseSepolia 1

Amount defaults to 1 USDC when omitted.
`);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    printUsage();
    process.exit(1);
  }

  const [direction, ...rest] = args as [string, ...string[]];

  if (!VALID_DIRECTIONS.includes(direction as Direction)) {
    console.error(
      `Invalid direction: "${direction}". Use evm-to-arc or arc-to-evm.`
    );
    printUsage();
    process.exit(1);
  }

  const script =
    direction === "evm-to-arc"
      ? "transfer/transfer-evm-to-arc.ts"
      : "transfer/transfer-arc-to-evm.ts";
  const scriptPath = join(ROOT, script);

  const child = spawn("npx", ["tsx", scriptPath, ...rest], {
    stdio: "inherit",
    cwd: ROOT,
  });

  child.on("close", (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    process.exit(code ?? 0);
  });

  child.on("error", (err) => {
    console.error("Failed to spawn transfer script:", err);
    process.exit(1);
  });
}

main();
