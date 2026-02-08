/**
 * Gateway module: run EVM↔Arc USDC transfers via Circle Gateway.
 *
 * Export-only API (no CLI). Use as:
 *   import { transfer } from "./utilities/gateway.js";
 *   await transfer({ isEvmToArc: true, chainToTransfer: "baseSepolia", amount: 1 });
 */

import { unifiedTransfer } from "./transfer/unified_transfer.js";
import type { ChainKey } from "./utils/config.js";

/** Options for a single gateway transfer. */
export type GatewayTransferOptions = {
  /** `true` = EVM chain → Arc Testnet; `false` = Arc Testnet → EVM chain. */
  isEvmToArc: boolean;
  /** Chain to use: for EVM→Arc this is the source chain; for Arc→EVM this is the destination chain (e.g. "baseSepolia", "sepolia"). */
  chainToTransfer: string;
  /** Amount of USDC to transfer (number, e.g. 1 or 0.5). */
  amount: number;
};

/**
 * Run a single gateway transfer.
 *
 * @param options - Direction (isEvmToArc), chain (chainToTransfer), and amount in USDC.
 * @returns Promise that resolves when the transfer completes, or rejects on error.
 */
export function transfer(options: GatewayTransferOptions): Promise<void> {
  return unifiedTransfer({
    isEvmToArc: options.isEvmToArc,
    chainToTransfer: options.chainToTransfer as ChainKey,
    amount: options.amount,
  });
}
