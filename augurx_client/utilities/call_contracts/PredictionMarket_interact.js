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
 *   node PredictionMarket_interact.js createBinaryMarket <question> <outcomeYes> <outcomeNo> <resolutionTimeUnix> <initialB> <settlementAddress> [valueInEther]
 */

import "dotenv/config";
import { ethers } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set your deployed PredictionMarketFactory address
const CONTRACT_ADDRESS = "0xa9975e74422e0A4b4dF9277aB1FE595a1902a2d2";
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

    if (action === "permissionlesscreation") {
        const allowed = await contract.permissionlessCreation();
        console.log("Permissionless creation:", allowed);
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
        const valueEthArg = "1"; // 1 ETH constant

        const requiredFeeWei = await contract.creationFee();
        let valueWei;
        if (valueEthArg !== undefined && valueEthArg !== "") {
            valueWei = ethers.parseEther(String(valueEthArg));
            if (valueWei < requiredFeeWei) {
                console.error("Insufficient value: creation fee is", ethers.formatEther(requiredFeeWei), "ETH. Using that amount.");
                valueWei = requiredFeeWei;
            }
        } else {
            valueWei = requiredFeeWei;
            console.log("Using creation fee:", ethers.formatEther(valueWei), "ETH");
        }

        // Contract requires "Resolution must be future" — ensure resolution time is after now
        const nowSec = Math.floor(Date.now() / 1000);
        if (Number(resolutionTimeUnix) <= nowSec) {
            resolutionTimeUnix = String(oneYearFromNow);
            console.warn("Resolution time was in the past; using 1 year from now:", resolutionTimeUnix);
        }

        const resolutionTime = BigInt(resolutionTimeUnix);
        const initialBWei = BigInt(initialB);

        const tx = await contract.createBinaryMarket(
            question,
            [outcomeYes, outcomeNo],
            resolutionTime,
            initialBWei,
            settlementAddress,
            { value: valueWei }
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
    console.error("  node PredictionMarket_interact.js createBinaryMarket <question> <outcomeYes> <outcomeNo> <resolutionTimeUnix> <initialB> <settlementAddress> [valueInEther]");
    process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
