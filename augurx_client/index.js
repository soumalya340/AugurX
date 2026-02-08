// augurx_client/index.js

import "dotenv/config";
import express from "express";
import { ethers } from "ethers";
import { chainConfigs } from "./utilities/utils/config.ts";
import {
  prepareBurnIntent,
  executeWithSignature,
} from "./utilities/transfer/unified_signed_transfer.ts";

const VALID_CHAINS = Object.keys(chainConfigs).filter(
  (c) => c !== "arcTestnet"
);

const app = express();
app.use(express.json());

// JSON.stringify doesn't support BigInt; convert to string so responses serialize
app.use((_req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    return originalJson(
      JSON.parse(
        JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v))
      )
    );
  };
  next();
});

const PORT = process.env.PORT || 3000;

/**
 * POST /prepare-transfer
 * 
 * Prepares unsigned burn intent for user to sign
 * 
 * Body: {
 *   "userAddress": "0x...",
 *   "isEvmToArc": true,
 *   "chainToTransfer": "baseSepolia",
 *   "amount": 1
 * }
 */
app.post("/prepare-transfer", async (req, res) => {
  console.log("Prepare transfer request:", req.body);
  const { userAddress, isEvmToArc, chainToTransfer, amount } = req.body;

  if (!userAddress || !ethers.isAddress(userAddress)) {
    return res.status(400).json({ error: "Valid userAddress required" });
  }

  if (typeof isEvmToArc !== "boolean") {
    return res.status(400).json({ error: "isEvmToArc must be boolean" });
  }

  if (!chainToTransfer || !VALID_CHAINS.includes(chainToTransfer)) {
    return res.status(400).json({
      error: `Invalid chainToTransfer. Valid: ${VALID_CHAINS.join(", ")}`,
    });
  }

  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "amount must be positive number" });
  }

  try {
    const result = await prepareBurnIntent({
      userAddress,
      isEvmToArc,
      chainToTransfer,
      amount,
    });
    res.json(result);
  } catch (err) {
    console.error("Prepare failed:", err);
    res.status(500).json({ error: err?.message || "Prepare failed" });
  }
});

/**
 * POST /execute-transfer
 * 
 * Submits signed burn intent to Circle, returns mint tx params
 * 
 * Body: {
 *   "signature": "0x...",
 *   "typedData": {...},
 *   "transferDetails": {...}
 * }
 */
app.post("/execute-transfer", async (req, res) => {
  console.log("Execute transfer request received");
  const { signature, typedData, transferDetails } = req.body;

  if (!signature || !typedData || !transferDetails) {
    return res.status(400).json({
      error: "signature, typedData, and transferDetails required",
    });
  }

  try {
    const result = await executeWithSignature({
      signature,
      typedData,
      transferDetails,
    });
    res.json(result);
  } catch (err) {
    console.error("Execute failed:", err);
    res.status(500).json({ error: err?.message || "Execute failed" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`API running at http://localhost:${PORT}`);
  console.log("Endpoints:");
  console.log("  POST /prepare-transfer");
  console.log("  POST /execute-transfer");
});