// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IFutarchy.sol";
import "./DecisionOracle.sol";
import "./FutarchyEscrow.sol";

// ── Minimal factory interface to deploy markets ─────────────────────
// We deploy BinaryMarkets via the existing PredictionMarketFactory
interface IPredictionMarketFactory {
    function createBinaryMarket(
        string calldata question,
        string[2] calldata outcomeNames,
        uint256 resolutionTime,
        uint256 initialB,
        address settlementLogic
    ) external payable returns (uint256 marketId, address marketAddress);
}

/**
 * @title FutarchyCrowdfund
 * @notice Orchestrator that merges prediction markets (LMSR) with
 *         milestone-based crowdfunding via futarchy.
 *         Uses native token instead of ERC20.
 *
 * Flow:
 *   1. createProposal() — deploys two conditional BinaryMarkets + two FutarchyEscrows
 *   2. Trading phase — users buy/sell shares in both markets via LMSR
 *   3. TWAP recording — anyone calls oracle.recordPrice() periodically
 *   4. executeDecision() — oracle picks winner, orchestrator routes funds
 *        → Winner market: escrow portion deposited to FutarchyEscrow, rest stays for settlement
 *        → Loser market: escrow voided, users refund via cost basis in the market
 *   5. Winner market continues until resolution (metric measured), then settles parimutuel
 *   6. Milestone withdrawals happen in parallel via FutarchyEscrow
 */
contract FutarchyCrowdfund is Ownable, ReentrancyGuard {
    using Math for uint256;

    // ── Structs ────────────────────────────────────────────────────────

    enum ProposalPhase {
        TRADING, // Markets open, TWAP recording
        DECIDED, // Oracle picked winner, funds routed
        WINNER_RESOLVED, // Winning market resolved (metric measured)
        CANCELLED // Emergency cancellation
    }

    struct Proposal {
        // Identity
        uint256 proposalId;
        string questionA;
        string questionB;
        string metricDescription; // What success metric is being tracked
        // Markets
        address marketA;
        address marketB;
        uint256 marketIdA;
        uint256 marketIdB;
        // Escrows
        address escrowA;
        address escrowB;
        // Creators
        address creatorA;
        address creatorB;
        // Timing
        uint256 tradingStartTime;
        uint256 decisionDeadline; // When TWAP comparison happens
        uint256 resolutionTime; // When the actual metric is measured
        // Decision
        ProposalPhase phase;
        address winnerMarket;
        address loserMarket;
        address winnerEscrow;
        address loserEscrow;
        // Fund split config
        uint256 escrowBps; // Basis points to escrow (e.g., 7000 = 70%)
        uint256 settlementBps; // Basis points to settlement reserve (e.g., 3000 = 30%)
    }

    // ── State ──────────────────────────────────────────────────────────

    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;

    IPredictionMarketFactory public immutable marketFactory;
    DecisionOracle public immutable oracle;

    // Platform config
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public defaultEscrowBps = 7000; // 70% to escrow
    uint256 public defaultSettlementBps = 3000; // 30% stays for settlement
    uint256 public defaultInitialB = 1e6; // 1 unit initial b
    uint256 public defaultStakePercent = 20; // 20% stake
    uint8 public defaultMaxMilestones = 5;
    uint256 public snapshotInterval = 3600; // 1 hour between TWAP snapshots

    // ── Events ─────────────────────────────────────────────────────────

    event ProposalCreated(
        uint256 indexed proposalId,
        address marketA,
        address marketB,
        address escrowA,
        address escrowB,
        uint256 decisionDeadline,
        uint256 resolutionTime
    );
    event DecisionExecuted(
        uint256 indexed proposalId,
        address winnerMarket,
        address loserMarket,
        uint256 escrowDeposit,
        uint256 settlementReserve
    );
    event WinnerResolved(uint256 indexed proposalId, uint256 winningOutcome);
    event LoserRefundsEnabled(uint256 indexed proposalId, address loserMarket);
    event ProposalCancelled(uint256 indexed proposalId);

    // ── Constructor ────────────────────────────────────────────────────

    constructor(
        address _marketFactory
    ) Ownable(msg.sender) {
        marketFactory = IPredictionMarketFactory(_marketFactory);

        // Deploy oracle with this contract as the orchestrator
        oracle = new DecisionOracle(address(this));
    }

    // ── Receive native token ──────────────────────────────────────────
    receive() external payable {}

    // ═══════════════════════════════════════════════════════════════════
    // PROPOSAL CREATION
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Create a futarchy proposal with two competing options.
     *
     * @param _questionA          Question for conditional market A
     * @param _questionB          Question for conditional market B
     * @param _metricDescription  Description of the success metric
     * @param _creatorA           Creator/proposer for option A
     * @param _creatorB           Creator/proposer for option B
     * @param _decisionDeadline   When TWAP comparison happens
     * @param _resolutionTime     When actual metric is measured (must be after decision)
     * @param _fundingGoalA       Funding goal for proposal A escrow
     * @param _fundingGoalB       Funding goal for proposal B escrow
     */
    function createProposal(
        string calldata _questionA,
        string calldata _questionB,
        string calldata _metricDescription,
        address _creatorA,
        address _creatorB,
        uint256 _decisionDeadline,
        uint256 _resolutionTime,
        uint256 _fundingGoalA,
        uint256 _fundingGoalB
    ) external onlyOwner returns (uint256 proposalId) {
        require(_decisionDeadline > block.timestamp, "Decision must be future");
        require(
            _resolutionTime > _decisionDeadline,
            "Resolution must be after decision"
        );
        require(
            _creatorA != address(0) && _creatorB != address(0),
            "Zero creator"
        );

        proposalId = proposalCount++;

        // ── Deploy two BinaryMarkets via factory ──
        string[2] memory outcomeNames = ["High", "Low"];

        (uint256 mIdA, address mktA) = marketFactory.createBinaryMarket(
            _questionA,
            outcomeNames,
            _resolutionTime,
            defaultInitialB,
            address(this) // This contract is the settlement resolver
        );

        (uint256 mIdB, address mktB) = marketFactory.createBinaryMarket(
            _questionB,
            outcomeNames,
            _resolutionTime,
            defaultInitialB,
            address(this)
        );

        // ── Deploy two FutarchyEscrows ──
        uint256 stakeA = (_fundingGoalA * defaultStakePercent) / 100;
        uint256 stakeB = (_fundingGoalB * defaultStakePercent) / 100;
        uint256 milestoneCapA = (_fundingGoalA * defaultStakePercent) / 100;
        uint256 milestoneCapB = (_fundingGoalB * defaultStakePercent) / 100;

        FutarchyEscrow escrowA = new FutarchyEscrow(
            _creatorA,
            address(this),
            _fundingGoalA,
            stakeA,
            defaultMaxMilestones,
            milestoneCapA
        );

        FutarchyEscrow escrowB = new FutarchyEscrow(
            _creatorB,
            address(this),
            _fundingGoalB,
            stakeB,
            defaultMaxMilestones,
            milestoneCapB
        );

        // ── Store proposal ──
        Proposal storage prop = proposals[proposalId];
        prop.proposalId = proposalId;
        prop.questionA = _questionA;
        prop.questionB = _questionB;
        prop.metricDescription = _metricDescription;
        prop.marketA = mktA;
        prop.marketB = mktB;
        prop.marketIdA = mIdA;
        prop.marketIdB = mIdB;
        prop.escrowA = address(escrowA);
        prop.escrowB = address(escrowB);
        prop.creatorA = _creatorA;
        prop.creatorB = _creatorB;
        prop.tradingStartTime = block.timestamp;
        prop.decisionDeadline = _decisionDeadline;
        prop.resolutionTime = _resolutionTime;
        prop.phase = ProposalPhase.TRADING;
        prop.escrowBps = defaultEscrowBps;
        prop.settlementBps = defaultSettlementBps;

        // ── Register with oracle for TWAP tracking ──
        oracle.registerProposal(
            proposalId,
            mktA,
            mktB,
            block.timestamp, // TWAP starts now
            _decisionDeadline,
            snapshotInterval
        );

        emit ProposalCreated(
            proposalId,
            mktA,
            mktB,
            address(escrowA),
            address(escrowB),
            _decisionDeadline,
            _resolutionTime
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // DECISION EXECUTION (after TWAP deadline)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Execute the futarchy decision after TWAP deadline.
     *
     * Steps:
     *   1. Oracle compares TWAPs → picks winner
     *   2. Winner's pool: split into escrow (70%) + settlement reserve (30%)
     *   3. Escrow portion transferred to winner's FutarchyEscrow
     *   4. Loser's escrow voided
     *   5. Loser's market users can get cost-basis refunds
     *
     * @param _proposalId The proposal to execute
     */
    function executeDecision(uint256 _proposalId) external nonReentrant {
        Proposal storage prop = proposals[_proposalId];
        require(prop.phase == ProposalPhase.TRADING, "Not in trading phase");
        require(oracle.canDecide(_proposalId), "Cannot decide yet");

        // ── Step 1: Get oracle decision ──
        (address winnerMkt, address loserMkt) = oracle.getDecision(_proposalId);

        // Determine corresponding escrows
        address winnerEscrow;
        address loserEscrow;
        if (winnerMkt == prop.marketA) {
            winnerEscrow = prop.escrowA;
            loserEscrow = prop.escrowB;
        } else {
            winnerEscrow = prop.escrowB;
            loserEscrow = prop.escrowA;
        }

        prop.winnerMarket = winnerMkt;
        prop.loserMarket = loserMkt;
        prop.winnerEscrow = winnerEscrow;
        prop.loserEscrow = loserEscrow;
        prop.phase = ProposalPhase.DECIDED;

        // ── Step 2: Route winner's pool funds ──
        uint256 winnerPool = IFutarchyMarket(winnerMkt).settlementPool();

        if (winnerPool > 0) {
            uint256 escrowPortion = (winnerPool * prop.escrowBps) /
                BPS_DENOMINATOR;
            // settlementReserve stays in the market contract for eventual parimutuel payout

            if (escrowPortion > 0) {
                // Deposit native token to winner escrow
                FutarchyEscrow(payable(winnerEscrow)).depositFromPool{value: escrowPortion}();
                FutarchyEscrow(payable(winnerEscrow)).activateEscrow();
            }

            emit DecisionExecuted(
                _proposalId,
                winnerMkt,
                loserMkt,
                escrowPortion,
                winnerPool - escrowPortion
            );
        }

        // ── Step 3: Void loser's escrow ──
        FutarchyEscrow(payable(loserEscrow)).voidAndRefund();

        emit LoserRefundsEnabled(_proposalId, loserMkt);
    }

    // ═══════════════════════════════════════════════════════════════════
    // WINNER RESOLUTION (after metric is measured)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Resolve the winning market after the actual metric is measured.
     *
     * @param _proposalId      The proposal
     * @param _winningOutcome  0 = metric was HIGH (good), 1 = metric was LOW (bad)
     */
    function resolveWinnerMarket(
        uint256 _proposalId,
        uint256 _winningOutcome
    ) external onlyOwner {
        Proposal storage prop = proposals[_proposalId];
        require(
            prop.phase == ProposalPhase.DECIDED,
            "Must be in DECIDED phase"
        );
        require(block.timestamp >= prop.resolutionTime, "Too early to resolve");

        // Resolve the winning market — this triggers parimutuel settlement
        IFutarchyMarket(prop.winnerMarket).resolve(_winningOutcome);

        prop.phase = ProposalPhase.WINNER_RESOLVED;

        emit WinnerResolved(_proposalId, _winningOutcome);
    }

    // ═══════════════════════════════════════════════════════════════════
    // ESCROW MANAGEMENT (pass-through to winner's escrow)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Validate a milestone on the winning escrow
     */
    function validateMilestone(
        uint256 _proposalId,
        bool _approve,
        bool _reject
    ) external onlyOwner {
        Proposal storage prop = proposals[_proposalId];
        require(
            prop.phase == ProposalPhase.DECIDED ||
                prop.phase == ProposalPhase.WINNER_RESOLVED,
            "Invalid phase"
        );
        FutarchyEscrow(payable(prop.winnerEscrow)).validate(_approve, _reject);
    }

    // ═══════════════════════════════════════════════════════════════════
    // EMERGENCY
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Emergency cancellation — voids both escrows
     */
    function cancelProposal(uint256 _proposalId) external onlyOwner {
        Proposal storage prop = proposals[_proposalId];
        require(
            prop.phase == ProposalPhase.TRADING,
            "Can only cancel during trading"
        );

        prop.phase = ProposalPhase.CANCELLED;

        // Void both escrows
        FutarchyEscrow(payable(prop.escrowA)).voidAndRefund();
        FutarchyEscrow(payable(prop.escrowB)).voidAndRefund();

        emit ProposalCancelled(_proposalId);
    }

    // ═══════════════════════════════════════════════════════════════════
    // CONFIG (owner only)
    // ═══════════════════════════════════════════════════════════════════

    function setEscrowSplit(
        uint256 _escrowBps,
        uint256 _settlementBps
    ) external onlyOwner {
        require(
            _escrowBps + _settlementBps == BPS_DENOMINATOR,
            "Must sum to 10000"
        );
        defaultEscrowBps = _escrowBps;
        defaultSettlementBps = _settlementBps;
    }

    function setSnapshotInterval(uint256 _interval) external onlyOwner {
        require(_interval > 0, "Must be > 0");
        snapshotInterval = _interval;
    }

    function setDefaultInitialB(uint256 _b) external onlyOwner {
        defaultInitialB = _b;
    }

    function setDefaultMaxMilestones(uint8 _max) external onlyOwner {
        defaultMaxMilestones = _max;
    }

    // ═══════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    function getProposal(
        uint256 _proposalId
    )
        external
        view
        returns (
            address marketA,
            address marketB,
            address escrowA,
            address escrowB,
            ProposalPhase phase,
            address winnerMarket,
            uint256 decisionDeadline,
            uint256 resolutionTime
        )
    {
        Proposal storage p = proposals[_proposalId];
        return (
            p.marketA,
            p.marketB,
            p.escrowA,
            p.escrowB,
            p.phase,
            p.winnerMarket,
            p.decisionDeadline,
            p.resolutionTime
        );
    }

    function getMarketPrices(
        uint256 _proposalId
    )
        external
        view
        returns (
            uint256 priceA_yes,
            uint256 priceA_no,
            uint256 priceB_yes,
            uint256 priceB_no,
            uint256 poolA,
            uint256 poolB
        )
    {
        Proposal storage p = proposals[_proposalId];
        priceA_yes = IFutarchyMarket(p.marketA).getPrice(0);
        priceA_no = IFutarchyMarket(p.marketA).getPrice(1);
        priceB_yes = IFutarchyMarket(p.marketB).getPrice(0);
        priceB_no = IFutarchyMarket(p.marketB).getPrice(1);
        poolA = IFutarchyMarket(p.marketA).settlementPool();
        poolB = IFutarchyMarket(p.marketB).settlementPool();
    }
}
