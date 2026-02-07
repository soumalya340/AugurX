// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IFutarchy.sol";

/**
 * @title FutarchyEscrow
 * @notice Milestone-based escrow for futarchy crowdfunding proposals.
 *         Upgraded from PredictionMarketCollabCollab to accept funds from prediction markets
 *         instead of flat-priced NFT mints.
 *
 * Lifecycle:
 *   PENDING → (orchestrator deposits from winning pool) → ACTIVE → milestone withdrawals → COMPLETED
 *   PENDING → (orchestrator triggers void) → VOIDED → refunds via cost basis
 *
 * Key changes from PredictionMarketCollabCollab:
 *   - Removed NFT minting (shares tracked in BinaryMarket)
 *   - Removed flat salePrice (pricing comes from LMSR)
 *   - Added depositFromPool() for orchestrator to route funds
 *   - Added voidAndRefund() for losing proposal cleanup
 *   - Kept milestone-based withdrawals with pause/validate flow
 *   - Kept creator staking mechanism
 *   - Added configurable fund split (escrow vs settlement reserve)
 */
contract FutarchyEscrow is ReentrancyGuard {
    // ── Enums ──────────────────────────────────────────────────────────

    enum EscrowState {
        PENDING, // Waiting for decision outcome
        ACTIVE, // Won — milestone fund release enabled
        VOIDED, // Lost — refunds enabled
        COMPLETED // All milestones done, creator unstaked
    }

    // ── State ──────────────────────────────────────────────────────────

    EscrowState public state;

    address public immutable proposalCreator;
    address public orchestrator;
    address public linkedMarket; // The BinaryMarket this escrow is paired with

    IERC20 public immutable collateralToken;

    // Fund tracking
    uint256 public fundsInReserve; // Total funds deposited from pool
    uint256 public fundingGoal; // Target amount (informational, not enforced like PredictionMarketCollab)
    uint256 public totalDeposited; // Cumulative deposits

    // Creator staking (from PredictionMarketCollab — skin in the game)
    bool public isCreatorStaked;
    uint256 public stakeAmount; // Absolute amount (configurable, was 20% in PredictionMarketCollab)

    // Milestone tracking (from PredictionMarketCollab)
    uint8 public numberOfMilestones;
    uint8 public maxMilestones;
    uint256 public maxWithdrawalPerMilestone;
    string[] public milestoneData; // IPFS hashes for milestone descriptions

    // Pause mechanism (from PredictionMarketCollab — operator validates between milestones)
    bool public paused;

    // ── Events ─────────────────────────────────────────────────────────

    event EscrowActivated(uint256 fundsDeposited);
    event EscrowVoided();
    event FundsDeposited(uint256 amount, uint256 totalReserve);
    event MilestoneSubmitted(uint8 milestoneNumber, string data);
    event MilestoneWithdrawn(
        uint8 milestoneNumber,
        uint256 amount,
        address wallet
    );
    event CreatorStaked(uint256 amount);
    event CreatorUnstaked(uint256 amount);
    event EscrowCompleted();
    event Validated(bool approved, bool rejected);

    // ── Modifiers ──────────────────────────────────────────────────────

    modifier onlyOrchestrator() {
        require(msg.sender == orchestrator, "FutarchyEscrow: Not orchestrator");
        _;
    }

    modifier onlyProposalCreator() {
        require(msg.sender == proposalCreator, "FutarchyEscrow: Not creator");
        _;
    }

    modifier inState(EscrowState _state) {
        require(state == _state, "FutarchyEscrow: Invalid state");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "FutarchyEscrow: Paused");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────

    /**
     * @param _proposalCreator    Address of the proposal creator
     * @param _orchestrator       FutarchyCrowdfund orchestrator address
     * @param _collateralToken    USDC or stablecoin address
     * @param _fundingGoal        Target funding amount
     * @param _stakeAmount        Required creator stake
     * @param _maxMilestones      Maximum number of milestone withdrawals
     * @param _maxWithdrawalPerMilestone  Cap per milestone (was 20% in PredictionMarketCollab)
     */
    constructor(
        address _proposalCreator,
        address _orchestrator,
        address _collateralToken,
        uint256 _fundingGoal,
        uint256 _stakeAmount,
        uint8 _maxMilestones,
        uint256 _maxWithdrawalPerMilestone
    ) {
        proposalCreator = _proposalCreator;
        orchestrator = _orchestrator;
        collateralToken = IERC20(_collateralToken);
        fundingGoal = _fundingGoal;
        stakeAmount = _stakeAmount;
        maxMilestones = _maxMilestones;
        maxWithdrawalPerMilestone = _maxWithdrawalPerMilestone;
        state = EscrowState.PENDING;
        paused = true;
    }

    // ═══════════════════════════════════════════════════════════════════
    // CREATOR STAKING (preserved from PredictionMarketCollab)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Creator stakes funds as security deposit before proposal goes live.
     *         In PredictionMarketCollab this was 20% of crowdFundingGoal.
     *         Here the amount is configurable via constructor.
     */
    function stake() external onlyProposalCreator inState(EscrowState.PENDING) {
        require(!isCreatorStaked, "Already staked");

        require(
            collateralToken.transferFrom(
                msg.sender,
                address(this),
                stakeAmount
            ),
            "Stake transfer failed"
        );

        isCreatorStaked = true;
        emit CreatorStaked(stakeAmount);
    }

    /**
     * @notice Creator unstakes after all milestones are completed
     */
    function unstake()
        external
        onlyProposalCreator
        inState(EscrowState.COMPLETED)
    {
        require(isCreatorStaked, "Not staked");

        isCreatorStaked = false;

        require(
            collateralToken.transfer(proposalCreator, stakeAmount),
            "Unstake transfer failed"
        );

        emit CreatorUnstaked(stakeAmount);
    }

    // ═══════════════════════════════════════════════════════════════════
    // FUND DEPOSIT (called by orchestrator after decision)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Orchestrator deposits funds from the winning market's settlement pool.
     *         This is the escrow portion (e.g., 70-80% of pool).
     *         The remaining portion stays in the market for parimutuel settlement.
     * @param _amount USDC amount to deposit
     */
    function depositFromPool(
        uint256 _amount
    ) external onlyOrchestrator inState(EscrowState.PENDING) {
        require(_amount > 0, "Zero deposit");

        require(
            collateralToken.transferFrom(msg.sender, address(this), _amount),
            "Deposit transfer failed"
        );

        fundsInReserve += _amount;
        totalDeposited += _amount;

        emit FundsDeposited(_amount, fundsInReserve);
    }

    /**
     * @notice Orchestrator activates escrow after depositing funds (winning proposal)
     */
    function activateEscrow()
        external
        onlyOrchestrator
        inState(EscrowState.PENDING)
    {
        require(isCreatorStaked, "Creator must stake first");
        require(fundsInReserve > 0, "No funds deposited");

        state = EscrowState.ACTIVE;
        paused = true; // Start paused — creator must initiate first milestone

        emit EscrowActivated(fundsInReserve);
    }

    /**
     * @notice Orchestrator voids escrow (losing proposal)
     *         Refunds are handled at the orchestrator level via cost basis.
     */
    function voidAndRefund() external onlyOrchestrator {
        require(
            state == EscrowState.PENDING || state == EscrowState.ACTIVE,
            "Cannot void in current state"
        );

        state = EscrowState.VOIDED;
        paused = true;

        // If creator staked, return their stake (they didn't lose — their proposal just wasn't chosen)
        if (isCreatorStaked) {
            isCreatorStaked = false;
            require(
                collateralToken.transfer(proposalCreator, stakeAmount),
                "Stake refund failed"
            );
            emit CreatorUnstaked(stakeAmount);
        }

        // Any funds already deposited should be returned to orchestrator for redistribution
        if (fundsInReserve > 0) {
            uint256 remaining = fundsInReserve;
            fundsInReserve = 0;
            require(
                collateralToken.transfer(orchestrator, remaining),
                "Fund return failed"
            );
        }

        emit EscrowVoided();
    }

    // ═══════════════════════════════════════════════════════════════════
    // MILESTONE MANAGEMENT (preserved from PredictionMarketCollab)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Submit milestone description (IPFS hash)
     */
    function submitMilestoneInfo(
        string calldata _data
    ) external onlyProposalCreator inState(EscrowState.ACTIVE) {
        milestoneData.push(_data);
        emit MilestoneSubmitted(uint8(milestoneData.length), _data);
    }

    /**
     * @notice Creator initiates first milestone funding (unpauses).
     *         Mirrors PredictionMarketCollab's intiateProposalFunding().
     */
    function initiateFirstMilestone()
        external
        onlyProposalCreator
        inState(EscrowState.ACTIVE)
    {
        require(numberOfMilestones == 0, "Already initiated");
        require(fundsInReserve > 0, "No funds");
        paused = false;
    }

    /**
     * @notice Creator withdraws funds for current milestone.
     *         Capped at maxWithdrawalPerMilestone (was 20% in PredictionMarketCollab).
     *         Auto-pauses after each withdrawal — orchestrator/operator must validate to unpause.
     * @param _wallet Address to send funds to
     * @param _amount Amount to withdraw (must be <= cap)
     */
    function withdrawMilestone(
        address _wallet,
        uint256 _amount
    )
        external
        onlyProposalCreator
        inState(EscrowState.ACTIVE)
        whenNotPaused
        nonReentrant
    {
        require(numberOfMilestones < maxMilestones, "All milestones used");
        require(_amount <= maxWithdrawalPerMilestone, "Exceeds milestone cap");
        require(_amount <= fundsInReserve, "Insufficient reserve");
        require(_wallet != address(0), "Zero address");

        fundsInReserve -= _amount;
        paused = true; // Pause until next validation
        numberOfMilestones++;

        require(
            collateralToken.transfer(_wallet, _amount),
            "Withdrawal failed"
        );

        // If all milestones done and no funds left, mark completed
        if (numberOfMilestones >= maxMilestones || fundsInReserve == 0) {
            state = EscrowState.COMPLETED;
            emit EscrowCompleted();
        }

        emit MilestoneWithdrawn(numberOfMilestones, _amount, _wallet);
    }

    /**
     * @notice Orchestrator validates milestone (unpause/reject).
     *         Mirrors PredictionMarketCollab's validate() but called by orchestrator instead of operator.
     * @param _approve True = unpause for next milestone. False = keep paused or reject.
     * @param _reject  If true and !_approve, void the escrow entirely (funds redistribute)
     */
    function validate(
        bool _approve,
        bool _reject
    ) external onlyOrchestrator inState(EscrowState.ACTIVE) {
        if (_approve) {
            if (fundsInReserve == 0) {
                state = EscrowState.COMPLETED;
                emit EscrowCompleted();
            } else {
                paused = false;
            }
        } else {
            if (_reject) {
                // Full rejection — void escrow, enable refunds
                state = EscrowState.VOIDED;
                paused = true;

                // Slash creator stake — distribute to backers via orchestrator
                if (isCreatorStaked) {
                    uint256 slashedStake = stakeAmount;
                    isCreatorStaked = false;
                    // Stake goes to orchestrator for redistribution to backers
                    require(
                        collateralToken.transfer(orchestrator, slashedStake),
                        "Slash transfer failed"
                    );
                }

                // Return remaining reserve to orchestrator
                if (fundsInReserve > 0) {
                    uint256 remaining = fundsInReserve;
                    fundsInReserve = 0;
                    require(
                        collateralToken.transfer(orchestrator, remaining),
                        "Reserve return failed"
                    );
                }

                emit EscrowVoided();
            }
            // else: just keep paused (creator can submit more milestone info)
        }

        emit Validated(_approve, _reject);
    }

    // ═══════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    function isVoided() external view returns (bool) {
        return state == EscrowState.VOIDED;
    }

    function isActive() external view returns (bool) {
        return state == EscrowState.ACTIVE;
    }

    function isCompleted() external view returns (bool) {
        return state == EscrowState.COMPLETED;
    }

    function getMilestoneCount() external view returns (uint256) {
        return milestoneData.length;
    }

    function getEscrowInfo()
        external
        view
        returns (
            EscrowState currentState,
            uint256 reserve,
            uint256 deposited,
            uint8 milestonesUsed,
            uint8 milestonesMax,
            bool creatorStaked,
            bool isPaused
        )
    {
        return (
            state,
            fundsInReserve,
            totalDeposited,
            numberOfMilestones,
            maxMilestones,
            isCreatorStaked,
            paused
        );
    }
}
