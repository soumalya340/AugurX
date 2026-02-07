// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IFutarchy.sol";

/**
 * @title DecisionOracle
 * @notice TWAP-based oracle that compares two conditional prediction markets
 *         and determines which proposal wins based on time-weighted average price.
 *
 * @dev Flow:
 *   1. Orchestrator registers a proposal with two market addresses + decision window
 *   2. Anyone can call recordPrice() periodically during the TWAP window to snapshot prices
 *   3. After the decision deadline, orchestrator calls getDecision() to determine winner
 *
 * TWAP prevents last-block price manipulation by averaging prices over the entire window.
 * Minimum 5 snapshots required for a valid decision.
 */
contract DecisionOracle is ReentrancyGuard {
    // ── Structs ────────────────────────────────────────────────────────

    struct PriceSnapshot {
        uint256 priceA; // YES price of market A (1e6 scale, 500000 = 50%)
        uint256 priceB; // YES price of market B
        uint256 timestamp;
    }

    struct ProposalOracle {
        address marketA;
        address marketB;
        uint256 twapStartTime; // When TWAP recording begins
        uint256 decisionDeadline; // When decision can be made
        uint256 minSnapshotInterval; // Minimum seconds between snapshots (anti-spam)
        uint256 lastSnapshotTime;
        bool isRegistered;
        bool isDecided;
        address winnerMarket;
        address loserMarket;
        uint256 finalTwapA; // Final TWAP for market A (1e6)
        uint256 finalTwapB; // Final TWAP for market B (1e6)
    }

    // ── State ──────────────────────────────────────────────────────────

    mapping(uint256 => ProposalOracle) public proposals;
    mapping(uint256 => PriceSnapshot[]) public snapshots;

    address public orchestrator;
    uint256 public constant MIN_SNAPSHOTS = 5;

    // ── Events ─────────────────────────────────────────────────────────

    event ProposalRegistered(
        uint256 indexed proposalId,
        address marketA,
        address marketB,
        uint256 twapStartTime,
        uint256 decisionDeadline
    );
    event PriceRecorded(
        uint256 indexed proposalId,
        uint256 priceA,
        uint256 priceB,
        uint256 timestamp,
        uint256 snapshotIndex
    );
    event DecisionMade(
        uint256 indexed proposalId,
        address winner,
        address loser,
        uint256 twapA,
        uint256 twapB
    );

    // ── Modifiers ──────────────────────────────────────────────────────

    modifier onlyOrchestrator() {
        require(msg.sender == orchestrator, "DecisionOracle: Not orchestrator");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────

    constructor(address _orchestrator) {
        orchestrator = _orchestrator;
    }

    // ═══════════════════════════════════════════════════════════════════
    // REGISTRATION (called by orchestrator)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Register a proposal's two markets for TWAP tracking
     * @param _proposalId       Unique proposal identifier
     * @param _marketA          Address of conditional market A
     * @param _marketB          Address of conditional market B
     * @param _twapStartTime    When to start recording prices
     * @param _decisionDeadline When the decision can be finalized
     * @param _minSnapshotInterval Minimum seconds between price snapshots
     */
    function registerProposal(
        uint256 _proposalId,
        address _marketA,
        address _marketB,
        uint256 _twapStartTime,
        uint256 _decisionDeadline,
        uint256 _minSnapshotInterval
    ) external onlyOrchestrator {
        require(!proposals[_proposalId].isRegistered, "Already registered");
        require(
            _marketA != address(0) && _marketB != address(0),
            "Zero address"
        );
        require(
            _decisionDeadline > _twapStartTime,
            "Deadline must be after start"
        );
        require(_minSnapshotInterval > 0, "Interval must be > 0");

        proposals[_proposalId] = ProposalOracle({
            marketA: _marketA,
            marketB: _marketB,
            twapStartTime: _twapStartTime,
            decisionDeadline: _decisionDeadline,
            minSnapshotInterval: _minSnapshotInterval,
            lastSnapshotTime: 0,
            isRegistered: true,
            isDecided: false,
            winnerMarket: address(0),
            loserMarket: address(0),
            finalTwapA: 0,
            finalTwapB: 0
        });

        emit ProposalRegistered(
            _proposalId,
            _marketA,
            _marketB,
            _twapStartTime,
            _decisionDeadline
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // TWAP RECORDING (callable by anyone — incentivized off-chain)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Record current prices from both markets
     * @dev Anyone can call this. Minimum interval enforced to prevent spam.
     *      Records YES price (outcome 0) from each market as the conviction signal.
     * @param _proposalId The proposal to record prices for
     */
    function recordPrice(uint256 _proposalId) external {
        ProposalOracle storage prop = proposals[_proposalId];

        require(prop.isRegistered, "Not registered");
        require(!prop.isDecided, "Already decided");
        require(block.timestamp >= prop.twapStartTime, "TWAP not started");
        require(block.timestamp <= prop.decisionDeadline, "Past deadline");
        require(
            block.timestamp >= prop.lastSnapshotTime + prop.minSnapshotInterval,
            "Too soon since last snapshot"
        );

        // Read YES price (outcome 0) from both markets
        // Price is in 1e6 scale (500000 = 50%, 750000 = 75%)
        uint256 priceA = IFutarchyMarket(prop.marketA).getPrice(0);
        uint256 priceB = IFutarchyMarket(prop.marketB).getPrice(0);

        snapshots[_proposalId].push(
            PriceSnapshot({
                priceA: priceA,
                priceB: priceB,
                timestamp: block.timestamp
            })
        );

        prop.lastSnapshotTime = block.timestamp;

        emit PriceRecorded(
            _proposalId,
            priceA,
            priceB,
            block.timestamp,
            snapshots[_proposalId].length - 1
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // DECISION (called by orchestrator after deadline)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Check if enough data exists to make a decision
     */
    function canDecide(uint256 _proposalId) external view returns (bool) {
        ProposalOracle storage prop = proposals[_proposalId];
        return (prop.isRegistered &&
            !prop.isDecided &&
            block.timestamp >= prop.decisionDeadline &&
            snapshots[_proposalId].length >= MIN_SNAPSHOTS);
    }

    /**
     * @notice Compute TWAPs and determine the winning market
     * @dev Uses time-weighted average: sum(price_i * duration_i) / total_duration
     *      Duration for each snapshot = time until next snapshot (or deadline for last)
     * @param _proposalId The proposal to decide
     * @return winner Address of the winning market
     * @return loser  Address of the losing market
     */
    function getDecision(
        uint256 _proposalId
    ) external onlyOrchestrator returns (address winner, address loser) {
        ProposalOracle storage prop = proposals[_proposalId];

        require(prop.isRegistered, "Not registered");
        require(!prop.isDecided, "Already decided");
        require(block.timestamp >= prop.decisionDeadline, "Too early");

        PriceSnapshot[] storage snaps = snapshots[_proposalId];
        require(snaps.length >= MIN_SNAPSHOTS, "Insufficient snapshots");

        // ── Compute time-weighted average price ──
        uint256 weightedSumA = 0;
        uint256 weightedSumB = 0;
        uint256 totalDuration = 0;

        for (uint256 i = 0; i < snaps.length; i++) {
            // Duration = time until next snapshot (or deadline for last one)
            uint256 endTime;
            if (i < snaps.length - 1) {
                endTime = snaps[i + 1].timestamp;
            } else {
                endTime = prop.decisionDeadline;
            }

            uint256 duration = endTime - snaps[i].timestamp;

            weightedSumA += snaps[i].priceA * duration;
            weightedSumB += snaps[i].priceB * duration;
            totalDuration += duration;
        }

        require(totalDuration > 0, "Zero duration");

        uint256 twapA = weightedSumA / totalDuration;
        uint256 twapB = weightedSumB / totalDuration;

        // Higher TWAP = market believes this proposal will produce better outcome
        if (twapA >= twapB) {
            winner = prop.marketA;
            loser = prop.marketB;
        } else {
            winner = prop.marketB;
            loser = prop.marketA;
        }

        prop.isDecided = true;
        prop.winnerMarket = winner;
        prop.loserMarket = loser;
        prop.finalTwapA = twapA;
        prop.finalTwapB = twapB;

        emit DecisionMade(_proposalId, winner, loser, twapA, twapB);

        return (winner, loser);
    }

    // ═══════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    function getSnapshotCount(
        uint256 _proposalId
    ) external view returns (uint256) {
        return snapshots[_proposalId].length;
    }

    function getSnapshot(
        uint256 _proposalId,
        uint256 _index
    )
        external
        view
        returns (uint256 priceA, uint256 priceB, uint256 timestamp)
    {
        PriceSnapshot storage snap = snapshots[_proposalId][_index];
        return (snap.priceA, snap.priceB, snap.timestamp);
    }

    function getProposalInfo(
        uint256 _proposalId
    )
        external
        view
        returns (
            address marketA,
            address marketB,
            uint256 decisionDeadline,
            bool isDecided,
            address winnerMarket,
            uint256 finalTwapA,
            uint256 finalTwapB,
            uint256 snapshotCount
        )
    {
        ProposalOracle storage prop = proposals[_proposalId];
        return (
            prop.marketA,
            prop.marketB,
            prop.decisionDeadline,
            prop.isDecided,
            prop.winnerMarket,
            prop.finalTwapA,
            prop.finalTwapB,
            snapshots[_proposalId].length
        );
    }
}
