// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IFutarchyMarket
 * @notice Interface for prediction markets used in futarchy proposals
 */
interface IFutarchyMarket {
    function getPrice(uint256 outcome) external view returns (uint256);

    function getBuyCost(
        uint256 outcome,
        uint256 shareAmount
    ) external view returns (uint256);

    function getSellRefund(
        uint256 outcome,
        uint256 shareAmount
    ) external view returns (uint256);

    function swapIn(
        uint256 outcome,
        uint256 shareAmount,
        uint256 maxCost
    ) external;

    function swapOut(
        uint256 outcome,
        uint256 shareAmount,
        uint256 minRefund
    ) external;

    function resolve(uint256 winningOutcome) external;

    function claimWinnings() external returns (uint256);

    function settlementPool() external view returns (uint256);

    function isResolved() external view returns (bool);

    function winningOutcome() external view returns (uint256);

    function qYes() external view returns (uint256);

    function qNo() external view returns (uint256);

    function b() external view returns (uint256);

    function yesShares(address user) external view returns (uint256);

    function noShares(address user) external view returns (uint256);

    function totalYesShares() external view returns (uint256);

    function totalNoShares() external view returns (uint256);

    function yesCostBasis(address user) external view returns (uint256);

    function noCostBasis(address user) external view returns (uint256);

    function previewClaim(address user) external view returns (uint256);

    function hasClaimed(address user) external view returns (bool);
}

/**
 * @title IDecisionOracle
 * @notice Interface for the TWAP-based decision oracle
 */
interface IDecisionOracle {
    function recordPrice(uint256 proposalId) external;

    function getTWAP(
        uint256 proposalId,
        address market
    ) external view returns (uint256);

    function canDecide(uint256 proposalId) external view returns (bool);

    function getDecision(
        uint256 proposalId
    ) external view returns (address winner, address loser);
}

/**
 * @title IFutarchyEscrow
 * @notice Interface for the milestone-based escrow (upgraded PredictionMarketCollab)
 */
interface IFutarchyEscrow {
    function depositFromPool(uint256 amount) external;

    function activateEscrow() external;

    function voidAndRefund() external;

    function withdrawMilestone(address wallet, uint256 amount) external;

    function isVoided() external view returns (bool);

    function isActive() external view returns (bool);

    function fundsInReserve() external view returns (uint256);
}
