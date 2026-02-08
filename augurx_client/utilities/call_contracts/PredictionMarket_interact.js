/**
 * Interact with the PredictionMarketFactory contract on Arc Testnet.
 * Uses ABI from PredictionMarketFactory.json.
 *
 * Usage:
 *   node PredictionMarket_interact.js marketCount
 *   node PredictionMarket_interact.js creationFee
 *   node PredictionMarket_interact.js minSeedAmount
 *   node PredictionMarket_interact.js owner
 *   node PredictionMarket_interact.js permissionlessCreation
 *   node PredictionMarket_interact.js authorizedCreators [address]
 *   node PredictionMarket_interact.js markets [marketId]
 *   node PredictionMarket_interact.js createBinaryMarket <question> <outcomeYes> <outcomeNo> <resolutionTimeUnix> <initialB> <settlementAddress>
 *   (value sent is 1 ETH or contract creation fee if higher; on-chain creator = signer = EVM_PRIVATE_KEY)
 *
 * Example (creator will be signer address, set EVM_PRIVATE_KEY to 0x48eE... to use that as creator):
 *   node utilities/call_contracts/PredictionMarket_interact.js createBinaryMarket "Will ETH hit $5000 by Dec 2025?" "Yes" "No" 1767225600 1000000000000000000 0x0000000000000000000000000000000000000000
 */

import dotenv from "dotenv";
import { ethers } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set your deployed PredictionMarketFactory address
const CONTRACT_ADDRESS = "0x34797D579d3906fBB2bAA64D427728b9529AD4BD";
const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network";
const CHAIN_ID = 5042002;

function loadAbi() {
    const path = join(__dirname, "PredictionMarketFactory.json");
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

    console.log("Arc Testnet — PredictionMarketFactory:", CONTRACT_ADDRESS);
    console.log("Account:", signer.address);
    console.log("");

    if (action === "marketcount") {
        const count = await contract.marketCount();
        console.log("Market count:", count.toString());
        return;
    }

    if (action === "creationfee") {
        const fee = await contract.creationFee();
        console.log("Creation fee (wei):", fee.toString());
        console.log("Creation fee (ether):", ethers.formatEther(fee));
        return;
    }

    if (action === "minseedamount") {
        const min = await contract.minSeedAmount();
        console.log("Min seed amount (wei):", min.toString());
        console.log("Min seed amount (ether):", ethers.formatEther(min));
        return;
    }

    if (action === "owner") {
        const ownerAddr = await contract.owner();
        console.log("Owner:", ownerAddr);
        return;
    }

    if (action === "authorizedcreators") {
        const address = args[1] || signer.address;
        const authorized = await contract.authorizedCreators(address);
        console.log("Authorized creator for", address, ":", authorized);
        return;
    }

    if (action === "markets") {
        const marketId = args[1] ?? "0";
        const info = await contract.markets(marketId);
        console.log("Market", marketId, ":");
        console.log("  marketAddress:", info.marketAddress);
        console.log("  marketType:", info.marketType.toString());
        console.log("  status:", info.status.toString());
        console.log("  creator:", info.creator);
        console.log("  question:", info.question);
        console.log("  resolutionTime:", info.resolutionTime.toString());
        console.log("  settlementContract:", info.settlementContract);
        return;
    }

    if (action === "createbinarymarket") {
        const question = args[1] ?? "Will ETH hit $5000 by Dec 2025?";
        const outcomeYes = args[2] ?? "Yes";
        const outcomeNo = args[3] ?? "No";
        const oneYearFromNow = Math.floor(Date.now() / 1000) + 86400 * 365;
        let resolutionTimeUnix = args[4] ?? String(oneYearFromNow);
        const initialB = args[5] ?? "1000000000000000000"; // 1e18
        const settlementAddress = args[6] ?? ethers.ZeroAddress;
        const creatorAddress = args[7] ?? signer.address;

        // Contract requires "Resolution must be future" — ensure resolution time is after now
        const nowSec = Math.floor(Date.now() / 1000);
        if (Number(resolutionTimeUnix) <= nowSec) {
            resolutionTimeUnix = String(oneYearFromNow);
            console.warn("Resolution time was in the past; using 1 year from now:", resolutionTimeUnix);
        }

        const resolutionTime = BigInt(resolutionTimeUnix);
        const initialBWei = BigInt(initialB);

        console.log("Creator (signer / msg.sender):", signer.address);

        try {
            const tx = await contract.createBinaryMarket(
                question,
                [outcomeYes, outcomeNo],
                resolutionTime,
                initialBWei,
                settlementAddress,
                creatorAddress,
            );
            console.log("CreateBinaryMarket tx:", tx.hash);
            const receipt = await tx.wait();
            console.log("Confirmed in block:", receipt.blockNumber);

            // Try to get MarketCreated event
            const iface = contract.interface;
            for (const log of receipt.logs) {
                try {
                    const parsed = iface.parseLog({ topics: log.topics, data: log.data });
                    if (parsed && parsed.name === "MarketCreated") {
                        console.log("MarketCreated — marketId:", parsed.args.marketId.toString(), "marketAddress:", parsed.args.marketAddress);
                    }
                } catch (_) { }
            }
        } catch (err) {
            const msg = err?.reason || err?.shortMessage || err?.message || "";
            if (msg.includes("Only owner can call this function")) {
                const owner = await contract.owner().catch(() => null);
                console.error("Error: Only the factory owner can create markets.");
                if (owner) console.error("Factory owner:", owner);
                console.error("Your address:", signer.address);
                console.error("Use EVM_PRIVATE_KEY for the owner wallet.");
                console.error("Check owner: node utilities/call_contracts/PredictionMarket_interact.js owner");
                process.exit(1);
            }
            throw err;
        }
        return;
    }

    console.error("Usage:");
    console.error("  node PredictionMarket_interact.js marketCount");
    console.error("  node PredictionMarket_interact.js creationFee");
    console.error("  node PredictionMarket_interact.js minSeedAmount");
    console.error("  node PredictionMarket_interact.js owner");
    console.error("  node PredictionMarket_interact.js permissionlessCreation");
    console.error("  node PredictionMarket_interact.js authorizedCreators [address]");
    console.error("  node PredictionMarket_interact.js markets [marketId]");
    console.error("  node PredictionMarket_interact.js createBinaryMarket <question> <outcomeYes> <outcomeNo> <resolutionTimeUnix> <initialB> <settlementAddress>");
    process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
