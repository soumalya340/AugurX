// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {PredictionMarketFactory} from "../src/predictionMarket/PredictionMarketFactory.sol";
import {PrizeDistributor} from "../src/predictionMarket/PrizeDistributor.sol";

/**
 * @title DeployPredictionMarket
 * @notice Deploys the prediction market stack: PredictionMarketFactory, PrizeDistributor.
 *         The deployer address is used as the settlement resolver for markets.
 * @dev Env: PRIVATE_KEY, COLLATERAL_TOKEN (USDC). Optional: CREATION_FEE (default 0), MIN_SEED_AMOUNT (default 1e4), PERMISSIONLESS (default true).
 */
contract DeployPredictionMarket is Script {
    function run() external {
        uint256 deployerPrivateKey = _readPrivateKey();
        address deployer = vm.addr(deployerPrivateKey);

        address collateralToken = vm.envAddress("COLLATERAL_TOKEN");
        uint256 creationFee = vm.envOr("CREATION_FEE", uint256(0));
        uint256 minSeedAmount = vm.envOr("MIN_SEED_AMOUNT", uint256(1e4)); // 0.01 USDC (6 decimals)
        bool permissionless = vm.envOr("PERMISSIONLESS", true);

        vm.startBroadcast(deployerPrivateKey);

        PredictionMarketFactory factory = new PredictionMarketFactory(
            creationFee,
            minSeedAmount,
            permissionless
        );
        console.log("PredictionMarketFactory at:", address(factory));

        PrizeDistributor distributor = new PrizeDistributor(collateralToken);
        console.log("PrizeDistributor at:", address(distributor));

        vm.stopBroadcast();

        console.log("---");
        console.log("Deployer:", deployer);
        console.log("Use deployer address as settlementLogic when creating markets.");
        console.log("Set PrizeDistributor on each market after resolution via setPrizeDistributor.");
    }

    function _readPrivateKey() internal view returns (uint256) {
        string memory pk = vm.envString("PRIVATE_KEY");
        bytes memory b = bytes(pk);
        if (b.length >= 2 && b[0] == "0" && (b[1] == "x" || b[1] == "X")) {
            return vm.parseUint(pk);
        }
        return vm.parseUint(string(abi.encodePacked("0x", pk)));
    }

}
