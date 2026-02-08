/**
 * Transfer USDC from baseSepolia → Arc testnet (EVM to Arc).
 * API at http://localhost:3000. Uses dotenv for PRIVATE_KEY and optional overrides.
 *
 * Usage:
 *   node scripts/transferEvmToArc_api_call.js [amount]
 *
 * .env (or env):
 *   PRIVATE_KEY=0x...   (required)
 *   API_BASE=http://localhost:3000  (optional)
 *   USER_ADDRESS=0x...  (optional; defaults to wallet from PRIVATE_KEY)
 *   SOURCE_CHAIN=baseSepolia  (optional; defaults to baseSepolia)
 */

import "dotenv/config";
import { ethers } from "ethers";

const API_BASE = process.env.API_BASE || "http://localhost:3000";

async function prepareEvmToArc(userAddress, amount, sourceChain = "baseSepolia") {
  const res = await fetch(`${API_BASE}/prepare-transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userAddress,
      isEvmToArc: true,
      chainToTransfer: sourceChain,
      amount: Number(amount),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function executeTransfer({ signature, typedData, transferDetails }) {
  const res = await fetch(`${API_BASE}/execute-transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signature, typedData, transferDetails }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("PRIVATE_KEY is required. Set it in .env or environment.");
    process.exit(1);
  }

  const wallet = new ethers.Wallet(privateKey);
  const userAddress = process.env.USER_ADDRESS || wallet.address;
  const amount = process.argv[2] ? Number(process.argv[2]) : Number(process.env.AMOUNT || 1);
  const sourceChain = process.env.SOURCE_CHAIN || "baseSepolia";

  console.log(`baseSepolia → Arc testnet: prepare (${amount} USDC)...`);
  const prepared = await prepareEvmToArc(userAddress, amount, sourceChain);
  console.log("Signing burn intent...");

  const signature = await wallet.signTypedData(
    prepared.typedData.domain,
    {
      BurnIntent: prepared.typedData.types.BurnIntent,
      TransferSpec: prepared.typedData.types.TransferSpec,
    },
    prepared.typedData.message
  );

  console.log("Execute transfer...");
  const result = await executeTransfer({
    signature,
    typedData: prepared.typedData,
    transferDetails: prepared.transferDetails,
  });
  console.log("Result:", result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
