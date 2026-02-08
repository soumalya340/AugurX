/**
 * Interact with the Crowdfund contract on Arc Testnet.
 * Contract: 0x64Fab71c43b7150Ce3e9Efd9361435342056D2c0
 *
 * Usage:
 *   node crowdfund_interact.js getBalance
 *   node crowdfund_interact.js balances [address]
 *   node crowdfund_interact.js deposit [amountInEther]
 *   node crowdfund_interact.js withdraw
 */

import "dotenv/config";
import { ethers } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONTRACT_ADDRESS = "0x64Fab71c43b7150Ce3e9Efd9361435342056D2c0";
const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network";
const CHAIN_ID = 5042002;

function loadAbi() {
    const path = join(__dirname, "crowdfund.json");
    const raw = readFileSync(path, "utf8");
    const artifact = JSON.parse(raw);
    return artifact.abi ?? artifact;
}

function getProvider() {
    return new ethers.JsonRpcProvider(ARC_TESTNET_RPC, CHAIN_ID);
}

function getWallet(provider) {
    const key = process.env.EVM_PRIVATE_KEY;
    if (!key) throw new Error("EVM_PRIVATE_KEY not set in .env");
    return new ethers.Wallet(key.trim(), provider);
}

async function main() {
    const args = process.argv.slice(2);
    const action = (args[0] || "").toLowerCase();

    const abi = loadAbi();
    const provider = getProvider();
    const signer = getWallet(provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, signer);

    console.log("Arc Testnet — Crowdfund contract:", CONTRACT_ADDRESS);
    console.log("Account:", signer.address);
    console.log("");

    if (action === "getbalance") {
        const total = await contract.getBalance();
        console.log("Contract total balance:", ethers.formatEther(total), "USDC");
        return;
    }

    if (action === "balances") {
        const address = args[1] || signer.address;
        const balance = await contract.balances(address);
        console.log("Balance for", address, ":", ethers.formatEther(balance), "USDC");
        return;
    }

    if (action === "deposit") {
        const amountEth = args[1] ?? "0.01";
        const valueWei = ethers.parseEther(amountEth);
        const tx = await contract.deposit({ value: valueWei });
        console.log("Deposit tx:", tx.hash);
        const receipt = await tx.wait();
        console.log("Confirmed in block:", receipt.blockNumber);
        return;
    }

    if (action === "withdraw") {
        const tx = await contract.withdraw();
        console.log("Withdraw tx:", tx.hash);
        const receipt = await tx.wait();
        console.log("Confirmed in block:", receipt.blockNumber);
        return;
    }

    console.error("Usage:");
    console.error("  node crowdfund_interact.js getBalance");
    console.error("  node crowdfund_interact.js balances [address]");
    console.error("  node crowdfund_interact.js deposit [amountInUSDC]");
    console.error("  node crowdfund_interact.js withdraw");
    process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
