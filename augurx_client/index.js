// augurx_client/index.js

import dotenv from "dotenv";
import express from "express";
import { ethers } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { chainConfigs } from "./utilities/utils/config.ts";
import {
  prepareBurnIntent,
  executeWithSignature,
} from "./utilities/transfer/unified_signed_transfer.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

// --- PredictionMarketFactory setup ---
const PM_CONTRACT_ADDRESS = "0x34797D579d3906fBB2bAA64D427728b9529AD4BD";
const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = 5042002;

function loadPredictionMarketAbi() {
  const path = join(__dirname, "utilities", "call_contracts", "PredictionMarketFactory.json");
  const artifact = JSON.parse(readFileSync(path, "utf8"));
  return artifact.abi ?? artifact;
}

const pmProvider = new ethers.JsonRpcProvider(ARC_TESTNET_RPC, ARC_CHAIN_ID);
const pmKey = process.env.EVM_PRIVATE_KEY;
if (!pmKey) console.warn("EVM_PRIVATE_KEY not set — prediction market write endpoints will fail");
const pmSigner = pmKey ? new ethers.Wallet(pmKey.trim(), pmProvider) : null;
const pmAbi = loadPredictionMarketAbi();
const pmContract = new ethers.Contract(
  PM_CONTRACT_ADDRESS,
  pmAbi,
  pmSigner ?? pmProvider
);

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

// --- Prediction Market READ endpoints ---

app.get("/prediction-market/market-count", async (_req, res) => {
  try {
    const count = await pmContract.marketCount();
    res.json({ marketCount: count.toString() });
  } catch (err) {
    console.error("marketCount failed:", err);
    res.status(500).json({ error: err?.message || "Failed to get market count" });
  }
});

app.get("/prediction-market/creation-fee", async (_req, res) => {
  try {
    const fee = await pmContract.creationFee();
    res.json({ feeWei: fee.toString(), feeEther: ethers.formatEther(fee) });
  } catch (err) {
    console.error("creationFee failed:", err);
    res.status(500).json({ error: err?.message || "Failed to get creation fee" });
  }
});

app.get("/prediction-market/min-seed-amount", async (_req, res) => {
  try {
    const min = await pmContract.minSeedAmount();
    res.json({ minSeedAmountWei: min.toString(), minSeedAmountEther: ethers.formatEther(min) });
  } catch (err) {
    console.error("minSeedAmount failed:", err);
    res.status(500).json({ error: err?.message || "Failed to get min seed amount" });
  }
});

app.get("/prediction-market/owner", async (_req, res) => {
  try {
    const owner = await pmContract.owner();
    res.json({ owner });
  } catch (err) {
    console.error("owner failed:", err);
    res.status(500).json({ error: err?.message || "Failed to get owner" });
  }
});

app.get("/prediction-market/permissionless-creation", async (_req, res) => {
  try {
    const allowed = await pmContract.permissionlessCreation();
    res.json({ permissionlessCreation: allowed });
  } catch (err) {
    console.error("permissionlessCreation failed:", err);
    res.status(500).json({ error: err?.message || "Failed to get permissionless creation status" });
  }
});

app.get("/prediction-market/authorized-creators/:address", async (req, res) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid Ethereum address" });
  }
  try {
    const authorized = await pmContract.authorizedCreators(address);
    res.json({ address, authorized });
  } catch (err) {
    console.error("authorizedCreators failed:", err);
    res.status(500).json({ error: err?.message || "Failed to check authorized creator" });
  }
});

app.get("/prediction-market/markets/:marketId", async (req, res) => {
  const { marketId } = req.params;
  try {
    const info = await pmContract.markets(marketId);
    res.json({
      marketId,
      marketAddress: info.marketAddress,
      marketType: info.marketType.toString(),
      status: info.status.toString(),
      creator: info.creator,
      question: info.question,
      resolutionTime: info.resolutionTime.toString(),
      settlementContract: info.settlementContract,
    });
  } catch (err) {
    console.error("markets failed:", err);
    res.status(500).json({ error: err?.message || "Failed to get market info" });
  }
});

// --- Prediction Market WRITE endpoint ---

const PM_API_KEY = "0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";

/**
 * POST /prediction-market/create-binary-market
 *
 * Headers: { "x-api-key": "0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0" }
 *
 * Body: {
 *   "question": "Will ETH hit $5000 by Dec 2025?",
 *   "outcomeYes": "Yes",
 *   "outcomeNo": "No",
 *   "resolutionTimeUnix": 1735689600,
 *   "initialB": "1000000000000000000",
 *   "settlementAddress": "0x0000000000000000000000000000000000000000",
 *   "creatorAddress": "0x48eE6eda30eAbA8D1308bb6A8371C4DF519F69C4"  // optional; on-chain creator is the signer (msg.sender)
 * }
 */
app.post("/prediction-market/create-binary-market", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== PM_API_KEY) {
    return res.status(401).json({ error: "Unauthorized: invalid or missing x-api-key" });
  }

  if (!pmSigner) {
    return res.status(503).json({ error: "EVM_PRIVATE_KEY not configured" });
  }

  const { question, outcomeYes, outcomeNo, resolutionTimeUnix, initialB, settlementAddress, creatorAddress } = req.body;

  if (!question) {
    return res.status(400).json({ error: "question is required" });
  }

  if (!creatorAddress || !ethers.isAddress(creatorAddress)) {
    return res.status(400).json({ error: "Valid creatorAddress is required" });
  }

  const yesLabel = outcomeYes || "Yes";
  const noLabel = outcomeNo || "No";
  const settlement = settlementAddress || ethers.ZeroAddress;
  const initialBWei = BigInt(initialB || "1000000000000000000");

  const nowSec = Math.floor(Date.now() / 1000);
  const oneYearFromNow = nowSec + 86400 * 365;
  let resolutionTime = resolutionTimeUnix ? BigInt(resolutionTimeUnix) : BigInt(oneYearFromNow);

  if (Number(resolutionTime) <= nowSec) {
    resolutionTime = BigInt(oneYearFromNow);
  }

  try {
    const tx = await pmContract.createBinaryMarket(
      question,
      [yesLabel, noLabel],
      resolutionTime,
      initialBWei,
      settlement,
      creatorAddress,
    );
    console.log("CreateBinaryMarket tx:", tx.hash);
    const receipt = await tx.wait();

    const result = { txHash: tx.hash, blockNumber: receipt.blockNumber };

    const iface = pmContract.interface;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === "MarketCreated") {
          result.marketId = parsed.args.marketId.toString();
          result.marketAddress = parsed.args.marketAddress;
        }
      } catch (_) {}
    }

    res.json(result);
  } catch (err) {
    const msg = err?.reason || err?.shortMessage || err?.message || "";
    console.error("createBinaryMarket failed:", err);
    if (msg.includes("Only owner can call this function")) {
      const owner = await pmContract.owner().catch(() => null);
      return res.status(403).json({
        error: "Only the factory owner can create markets",
        factoryOwner: owner,
        signerAddress: pmSigner.address,
      });
    }
    res.status(500).json({ error: msg || "Failed to create binary market" });
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
  console.log("  GET  /prediction-market/market-count");
  console.log("  GET  /prediction-market/creation-fee");
  console.log("  GET  /prediction-market/min-seed-amount");
  console.log("  GET  /prediction-market/owner");
  console.log("  GET  /prediction-market/permissionless-creation");
  console.log("  GET  /prediction-market/authorized-creators/:address");
  console.log("  GET  /prediction-market/markets/:marketId");
  console.log("  POST /prediction-market/create-binary-market");
});