import "dotenv/config";
import express from "express";
import { ethers } from "ethers";
import { privateKeyToAccount } from "viem/accounts";
import { chainConfigs } from "./utilities/utils/config.ts";
import { transfer } from "./utilities/gateway.ts";

// ── Account Setup ──────────────────────────────────────────────────────────
const rawKey = (process.env.EVM_PRIVATE_KEY || "").trim();
if (!rawKey) throw new Error("EVM_PRIVATE_KEY not set in environment");
const evmPrivateKey = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;

const wallet = new ethers.Wallet(evmPrivateKey);
const viemAccount = privateKeyToAccount(evmPrivateKey);
const account = wallet.address;

// Valid chains for gateway (must match utilities/gateway.ts usage)
const VALID_CHAINS = Object.keys(chainConfigs);

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/**
 * POST /transfer
 *
 * Body: GatewayTransferOptions
 * {
 *   "isEvmToArc": true,                // true = EVM→Arc, false = Arc→EVM
 *   "chainToTransfer": "baseSepolia",   // EVM chain (source or destination)
 *   "amount": 1                         // USDC amount
 * }
 */
app.post("/transfer", async (req, res) => {
    console.log("Transfer request received:", req.body);
    const { isEvmToArc, chainToTransfer, amount } = req.body;

    if (typeof isEvmToArc !== "boolean") {
        return res.status(400).json({
            error: "isEvmToArc must be a boolean.",
        });
    }

    if (!chainToTransfer || !VALID_CHAINS.includes(chainToTransfer)) {
        return res.status(400).json({
            error: `Invalid chainToTransfer. Valid chains: ${VALID_CHAINS.join(", ")}`,
        });
    }

    if (chainToTransfer === "arcTestnet") {
        return res.status(400).json({
            error:
                'Do not pass "arcTestnet" as chainToTransfer. It is automatically used as source or destination.',
        });
    }

    if (typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({
            error: "amount must be a positive number (USDC).",
        });
    }

    try {
        await transfer({ isEvmToArc, chainToTransfer, amount });
        res.json({ success: true });
    } catch (err) {
        console.error("Transfer failed:", err);
        res.status(500).json({
            error: err?.message || "Transfer failed",
        });
    }
});

app.get("/health", (_req, res) => {
    res.json({ status: "ok", account });
});

app.listen(PORT, () => {
    console.log(`API is running at http://localhost:${PORT}`);
    console.log(`Account: ${account}`);
});
