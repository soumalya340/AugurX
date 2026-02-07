// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BinaryMarket
 * @notice LMSR-based AMM for binary (Yes/No) prediction markets
 * @dev Uses Hybrid LMSR: pricing only, settlement is parimutuel
 */
contract BinaryMarket is ReentrancyGuard {
    using Math for uint256;

    // Outcome indices: 0 = YES, 1 = NO
    uint256 public constant OUTCOME_YES = 0;
    uint256 public constant OUTCOME_NO = 1;
    uint256 public constant OUTCOME_COUNT = 2;

    // Market info
    uint256 public immutable marketId;
    string public question;
    string[2] public outcomeNames;
    uint256 public resolutionTime;
    address public immutable creator;

    // Settlement resolver
    address public settlementContract;

    // LMSR Parameters
    uint256 public b; // Liquidity parameter (adaptive)
    uint256 public constant B_SCALING_FACTOR = 10; // b = max(initial, pool/10)
    uint256 public immutable initialB;

    // Share quantities for LMSR cost function
    // q_yes and q_no represent outstanding shares
    uint256 public qYes;
    uint256 public qNo;

    // Trading token (USDC)
    IERC20 public immutable collateralToken;
    uint256 public constant DECIMALS = 6; // USDC decimals

    // Settlement pool (parimutuel) - SEPARATE from LMSR math
    uint256 public settlementPool;

    // User shares (for settlement)
    mapping(address => uint256) public yesShares;
    mapping(address => uint256) public noShares;
    uint256 public totalYesShares;
    uint256 public totalNoShares;

    // Market state
    bool public isResolved;
    uint256 public winningOutcome; // 0 or 1
    bool public isSettled;

    // Events
    event SharesPurchased(
        address indexed buyer,
        bool isYes,
        uint256 shares,
        uint256 cost
    );
    event SharesSold(
        address indexed seller,
        bool isYes,
        uint256 shares,
        uint256 refund
    );
    event MarketResolved(uint256 winningOutcome);
    event AdaptiveBUpdated(uint256 newB);

    modifier onlySettlementContract() {
        require(msg.sender == settlementContract, "Only settlement resolver");
        _;
    }

    modifier notResolved() {
        require(!isResolved, "Market already resolved");
        _;
    }

    constructor(
        uint256 _marketId,
        string memory _question,
        string[2] memory _outcomeNames,
        uint256 _resolutionTime,
        uint256 _initialB,
        address _settlementContract,
        address _creator,
        address _quoteTokenAddr
    ) {
        marketId = _marketId;
        question = _question;
        outcomeNames = _outcomeNames;
        resolutionTime = _resolutionTime;
        initialB = _initialB;
        b = _initialB;
        settlementContract = _settlementContract;
        creator = _creator;

        // USDC on most chains, or configurable
        collateralToken = IERC20(_quoteTokenAddr); // Replace with actual
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LMSR PRICING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Calculate LMSR cost function C(q) = b * ln(sum(e^(q_i/b)))
     * @param _qYes Current YES shares
     * @param _qNo Current NO shares
     * @return cost The cost value (in 1e18 precision, then converted)
     */
    function calculateCost(
        uint256 _qYes,
        uint256 _qNo
    ) public view returns (uint256) {
        // For numerical stability in Solidity, we use log2 and convert
        // C(q) = b * ln(e^(qYes/b) + e^(qNo/b))

        uint256 term1 = (_qYes * 1e18) / b; // Scaled for precision
        uint256 term2 = (_qNo * 1e18) / b;

        // Approximate e^x using series or lookup (simplified here)
        // In production, use a more precise exp implementation
        uint256 exp1 = expApprox(term1);
        uint256 exp2 = expApprox(term2);

        uint256 sum = exp1 + exp2;

        // ln(sum) = log2(sum) * ln(2)
        uint256 log2Sum = Math.log2(sum);
        uint256 lnSum = (log2Sum * 693147180559945309) / 1e18; // ln(2) * 1e18

        return (b * lnSum) / 1e18;
    }

    /**
     * @notice Approximate exponential function e^x
     * @dev Simplified - use more precise library in production
     */
    function expApprox(uint256 x) internal pure returns (uint256) {
        // x is in 1e18 scale
        // e^x ≈ 1 + x + x^2/2! + x^3/3! for small x
        // For large x, this overflows - use bounds checking

        if (x > 20 * 1e18) return type(uint256).max / 2; // Prevent overflow

        uint256 result = 1e18; // 1.0
        uint256 term = 1e18;

        for (uint256 i = 1; i <= 10; i++) {
            term = (term * x) / (i * 1e18);
            result += term;
            if (term < 1) break; // Convergence
        }

        return result;
    }

    /**
     * @notice Get current price (probability) of an outcome
     * @param _outcome 0 for YES, 1 for NO
     * @return price Probability in 1e6 (1,000,000 = 100%)
     */
    function getPrice(uint256 _outcome) external view returns (uint256) {
        require(_outcome < OUTCOME_COUNT, "Invalid outcome");

        uint256 expYes = expApprox((qYes * 1e18) / b);
        uint256 expNo = expApprox((qNo * 1e18) / b);
        uint256 sum = expYes + expNo;

        if (_outcome == OUTCOME_YES) {
            return ((expYes * 1e6) / sum);
        } else {
            return ((expNo * 1e6) / sum);
        }
    }

    /**
     * @notice Calculate cost to buy shares
     * @param _outcome Which outcome to buy (0=YES, 1=NO)
     * @param _shareAmount Number of shares to buy
     * @return cost Total USDC cost (in 6 decimals)
     */
    function getBuyCost(
        uint256 _outcome,
        uint256 _shareAmount
    ) external view returns (uint256) {
        require(_outcome < OUTCOME_COUNT, "Invalid outcome");

        uint256 newQYes = qYes;
        uint256 newQNo = qNo;

        if (_outcome == OUTCOME_YES) {
            newQYes += _shareAmount;
        } else {
            newQNo += _shareAmount;
        }

        uint256 costBefore = calculateCost(qYes, qNo);
        uint256 costAfter = calculateCost(newQYes, newQNo);

        // Convert to USDC decimals (6)
        uint256 cost = ((costAfter - costBefore) * 1e6) / 1e18;
        return cost > 0 ? cost : 1; // Minimum 1 unit
    }

    /**
     * @notice Calculate refund for selling shares
     * @param _outcome Which outcome to sell
     * @param _shareAmount Number of shares to sell
     * @return refund USDC amount returned (in 6 decimals)
     */
    function getSellRefund(
        uint256 _outcome,
        uint256 _shareAmount
    ) external view returns (uint256) {
        require(_outcome < OUTCOME_COUNT, "Invalid outcome");

        uint256 newQYes = qYes;
        uint256 newQNo = qNo;

        if (_outcome == OUTCOME_YES) {
            require(qYes >= _shareAmount, "Insufficient shares outstanding");
            newQYes -= _shareAmount;
        } else {
            require(qNo >= _shareAmount, "Insufficient shares outstanding");
            newQNo -= _shareAmount;
        }

        uint256 costBefore = calculateCost(qYes, qNo);
        uint256 costAfter = calculateCost(newQYes, newQNo);

        // Cost decreases, so refund is the difference
        uint256 refund = ((costBefore - costAfter) * 1e6) / 1e18;
        return refund;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TRADING FUNCTIONS (swapIn / swapOut)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Buy shares (swapIn) - LMSR pricing, funds go to settlement pool
     * @param _outcome 0=YES, 1=NO
     * @param _shareAmount Shares to purchase
     * @param _maxCost Maximum cost willing to pay (slippage protection)
     */
    function swapIn(
        uint256 _outcome,
        uint256 _shareAmount,
        uint256 _maxCost
    ) external nonReentrant notResolved {
        require(_outcome < OUTCOME_COUNT, "Invalid outcome");
        require(_shareAmount > 0, "Amount must be > 0");

        // Calculate cost using LMSR
        uint256 cost = this.getBuyCost(_outcome, _shareAmount);
        require(cost <= _maxCost, "Slippage exceeded");
        require(cost > 0, "Cost too low");

        // Transfer collateral from user
        require(
            collateralToken.transferFrom(msg.sender, address(this), cost),
            "Transfer failed"
        );

        // Update LMSR quantities
        if (_outcome == OUTCOME_YES) {
            qYes += _shareAmount;
        } else {
            qNo += _shareAmount;
        }

        // Update settlement pool (parimutuel) - THIS IS THE KEY HYBRID INNOVATION
        settlementPool += cost;

        // Mint shares to user (for settlement tracking)
        if (_outcome == OUTCOME_YES) {
            yesShares[msg.sender] += _shareAmount;
            totalYesShares += _shareAmount;
        } else {
            noShares[msg.sender] += _shareAmount;
            totalNoShares += _shareAmount;
        }

        // Adaptive b update: b = max(initialB, settlementPool / B_SCALING_FACTOR)
        updateAdaptiveB();

        emit SharesPurchased(msg.sender, _outcome == 0, _shareAmount, cost);
    }

    /**
     * @notice Sell shares (swapOut) - LMSR pricing
     * @param _outcome 0=YES, 1=NO
     * @param _shareAmount Shares to sell
     * @param _minRefund Minimum refund acceptable (slippage protection)
     */
    function swapOut(
        uint256 _outcome,
        uint256 _shareAmount,
        uint256 _minRefund
    ) external nonReentrant notResolved {
        require(_outcome < OUTCOME_COUNT, "Invalid outcome");
        require(_shareAmount > 0, "Amount must be > 0");

        // Check user has shares
        if (_outcome == OUTCOME_YES) {
            require(
                yesShares[msg.sender] >= _shareAmount,
                "Insufficient shares"
            );
        } else {
            require(
                noShares[msg.sender] >= _shareAmount,
                "Insufficient shares"
            );
        }

        // Calculate refund using LMSR
        uint256 refund = this.getSellRefund(_outcome, _shareAmount);
        require(refund >= _minRefund, "Slippage exceeded");

        // Burn user shares first (reentrancy protection)
        if (_outcome == OUTCOME_YES) {
            yesShares[msg.sender] -= _shareAmount;
            totalYesShares -= _shareAmount;
        } else {
            noShares[msg.sender] -= _shareAmount;
            totalNoShares -= _shareAmount;
        }

        // Update LMSR quantities
        if (_outcome == OUTCOME_YES) {
            qYes -= _shareAmount;
        } else {
            qNo -= _shareAmount;
        }

        // Reduce settlement pool
        settlementPool -= refund;

        // Transfer refund to user
        require(
            collateralToken.transfer(msg.sender, refund),
            "Transfer failed"
        );

        // Update adaptive b
        updateAdaptiveB();

        emit SharesSold(msg.sender, _outcome == 0, _shareAmount, refund);
    }

    /**
     * @notice Update liquidity parameter b based on pool size
     * @dev b grows with trading volume for deeper liquidity
     */
    function updateAdaptiveB() internal {
        uint256 poolBasedB = settlementPool / B_SCALING_FACTOR;
        uint256 newB = Math.max(initialB, poolBasedB);

        if (newB != b) {
            b = newB;
            emit AdaptiveBUpdated(b);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RESOLUTION & SETTLEMENT INTERFACE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Called by SettlementLogic contract to resolve market
     * @param _winningOutcome 0 for YES, 1 for NO
     */
    function resolve(uint256 _winningOutcome) external onlySettlementContract {
        require(!isResolved, "Already resolved");
        require(block.timestamp >= resolutionTime, "Too early to resolve");
        require(_winningOutcome < OUTCOME_COUNT, "Invalid outcome");

        winningOutcome = _winningOutcome;
        isResolved = true;

        emit MarketResolved(_winningOutcome);
    }

    /**
     * @notice Calculate payout per winning share
     * @return payout Amount each winning share receives (USDC 6 decimals)
     */
    function getPayoutPerShare() external view returns (uint256) {
        require(isResolved, "Not resolved");

        uint256 winningShares = (winningOutcome == OUTCOME_YES)
            ? totalYesShares
            : totalNoShares;
        require(winningShares > 0, "No winners");

        // Parimutuel: total pool / total winning shares
        return (settlementPool * 1e6) / winningShares; // Extra precision
    }

    /**
     * @notice Claim winnings (called by PrizeDistributor or directly)
     */
    function claimWinnings() external nonReentrant returns (uint256) {
        require(isResolved, "Not resolved");
        require(!isSettled, "Already settled");

        uint256 userShares;
        if (winningOutcome == OUTCOME_YES) {
            userShares = yesShares[msg.sender];
            yesShares[msg.sender] = 0;
        } else {
            userShares = noShares[msg.sender];
            noShares[msg.sender] = 0;
        }

        require(userShares > 0, "No winning shares");

        uint256 winningShares = (winningOutcome == OUTCOME_YES)
            ? totalYesShares
            : totalNoShares;
        uint256 payout = (settlementPool * userShares) / winningShares;

        require(
            collateralToken.transfer(msg.sender, payout),
            "Transfer failed"
        );

        return payout;
    }

    // View functions
    function getMarketInfo()
        external
        view
        returns (
            uint256 _marketId,
            string memory _question,
            uint256 _qYes,
            uint256 _qNo,
            uint256 _b,
            uint256 _settlementPool,
            bool _isResolved,
            uint256 _winningOutcome
        )
    {
        return (
            marketId,
            question,
            qYes,
            qNo,
            b,
            settlementPool,
            isResolved,
            winningOutcome
        );
    }
}
