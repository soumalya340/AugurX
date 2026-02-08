// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IFutarchy.sol";

/**
 * @title FutarchyEscrow
 * @notice Milestone-based escrow for futarchy crowdfunding proposals.
 *         Uses native token instead of ERC20.
 *
 * Lifecycle:
 *   PENDING → (orchestrator deposits from winning pool) → ACTIVE → milestone withdrawals → COMPLETED
 *   PENDING → (orchestrator triggers void) → VOIDED → refunds via cost basis
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

    // Fund tracking
    uint256 public fundsInReserve; // Total funds deposited from pool
    uint256 public fundingGoal; // Target amount (informational)
    uint256 public totalDeposited; // Cumulative deposits

    // Creator staking (skin in the game)
    bool public isCreatorStaked;
    uint256 public stakeAmount; // Absolute amount (configurable)

    // Milestone tracking
    uint8 public numberOfMilestones;
    uint8 public maxMilestones;
    uint256 public maxWithdrawalPerMilestone;
    string[] public milestoneData; // IPFS hashes for milestone descriptions

    // Pause mechanism (operator validates between milestones)
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

    constructor(
        address _proposalCreator,
        address _orchestrator,
        uint256 _fundingGoal,
        uint256 _stakeAmount,
        uint8 _maxMilestones,
        uint256 _maxWithdrawalPerMilestone
    ) {
        proposalCreator = _proposalCreator;
        orchestrator = _orchestrator;
        fundingGoal = _fundingGoal;
        stakeAmount = _stakeAmount;
        maxMilestones = _maxMilestones;
        maxWithdrawalPerMilestone = _maxWithdrawalPerMilestone;
        state = EscrowState.PENDING;
        paused = true;
    }

    // ── Receive native token ──────────────────────────────────────────
    receive() external payable {}

    // ═══════════════════════════════════════════════════════════════════
    // CREATOR STAKING
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Creator stakes native token as security deposit before proposal goes live.
     */
    function stake()
        external
        payable
        onlyProposalCreator
        inState(EscrowState.PENDING)
    {
        require(!isCreatorStaked, "Already staked");
        require(msg.value == stakeAmount, "Wrong stake amount");

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

        (bool ok, ) = payable(proposalCreator).call{value: stakeAmount}("");
        require(ok, "Unstake transfer failed");

        emit CreatorUnstaked(stakeAmount);
    }

    // ═══════════════════════════════════════════════════════════════════
    // FUND DEPOSIT (called by orchestrator after decision)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Orchestrator deposits native token from the winning market's settlement pool.
     */
    function depositFromPool()
        external
        payable
        onlyOrchestrator
        inState(EscrowState.PENDING)
    {
        require(msg.value > 0, "Zero deposit");

        fundsInReserve += msg.value;
        totalDeposited += msg.value;

        emit FundsDeposited(msg.value, fundsInReserve);
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
     */
    function voidAndRefund() external onlyOrchestrator {
        require(
            state == EscrowState.PENDING || state == EscrowState.ACTIVE,
            "Cannot void in current state"
        );

        state = EscrowState.VOIDED;
        paused = true;

        // If creator staked, return their stake
        if (isCreatorStaked) {
            isCreatorStaked = false;
            (bool ok, ) = payable(proposalCreator).call{value: stakeAmount}("");
            require(ok, "Stake refund failed");
            emit CreatorUnstaked(stakeAmount);
        }

        // Any funds already deposited should be returned to orchestrator
        if (fundsInReserve > 0) {
            uint256 remaining = fundsInReserve;
            fundsInReserve = 0;
            (bool ok, ) = payable(orchestrator).call{value: remaining}("");
            require(ok, "Fund return failed");
        }

        emit EscrowVoided();
    }

    // ═══════════════════════════════════════════════════════════════════
    // MILESTONE MANAGEMENT
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

        (bool ok, ) = payable(_wallet).call{value: _amount}("");
        require(ok, "Withdrawal failed");

        // If all milestones done and no funds left, mark completed
        if (numberOfMilestones >= maxMilestones || fundsInReserve == 0) {
            state = EscrowState.COMPLETED;
            emit EscrowCompleted();
        }

        emit MilestoneWithdrawn(numberOfMilestones, _amount, _wallet);
    }

    /**
     * @notice Orchestrator validates milestone (unpause/reject).
     * @param _approve True = unpause for next milestone.
     * @param _reject  If true and !_approve, void the escrow entirely
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
                // Full rejection — void escrow
                state = EscrowState.VOIDED;
                paused = true;

                // Slash creator stake — send to orchestrator for redistribution
                if (isCreatorStaked) {
                    uint256 slashedStake = stakeAmount;
                    isCreatorStaked = false;
                    (bool ok, ) = payable(orchestrator).call{
                        value: slashedStake
                    }("");
                    require(ok, "Slash transfer failed");
                }

                // Return remaining reserve to orchestrator
                if (fundsInReserve > 0) {
                    uint256 remaining = fundsInReserve;
                    fundsInReserve = 0;
                    (bool ok, ) = payable(orchestrator).call{value: remaining}(
                        ""
                    );
                    require(ok, "Reserve return failed");
                }

                emit EscrowVoided();
            }
            // else: just keep paused
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
