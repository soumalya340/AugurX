// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CategoricalMarket
 * @notice LMSR-based AMM for categorical (multiple outcome) prediction markets
 */
contract CategoricalMarket is ReentrancyGuard {
    using Math for uint256;

    // Market configuration
    uint256 public immutable marketId;
    string public question;
    string[] public outcomeNames;
    uint256 public immutable outcomeCount;
    uint256 public resolutionTime;
    address public immutable creator;

    // External contracts
    address public settlementContract;

    // LMSR Parameters
    uint256 public b;
    uint256 public constant B_SCALING_FACTOR = 10;
    uint256 public immutable initialB;

    // LMSR quantities: q[i] = outstanding shares for outcome i
    uint256[] public q;

    // Settlement pool (parimutuel)
    uint256 public settlementPool;
    IERC20 public immutable collateralToken;

    // User shares tracking
    mapping(address => mapping(uint256 => uint256)) public userShares; // user => outcome => amount
    uint256[] public totalSharesPerOutcome;

    // Market state
    bool public isResolved;
    uint256 public winningOutcome;
    bool public isSettled;

    // Events
    event SharesPurchased(
        address indexed buyer,
        uint256 outcome,
        uint256 shares,
        uint256 cost
    );
    event SharesSold(
        address indexed seller,
        uint256 outcome,
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
        string[] memory _outcomeNames,
        uint256 _resolutionTime,
        uint256 _initialB,
        uint256 _outcomeCount,
        address _settlementContract,
        address _creator,
        address _quoteTokenAddr
    ) {
        marketId = _marketId;
        question = _question;
        outcomeNames = _outcomeNames;
        outcomeCount = _outcomeCount;
        resolutionTime = _resolutionTime;
        initialB = _initialB;
        b = _initialB;
        settlementContract = _settlementContract;
        creator = _creator;

        // Initialize arrays
        q = new uint256[](_outcomeCount);
        totalSharesPerOutcome = new uint256[](_outcomeCount);

        collateralToken = IERC20(_quoteTokenAddr);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LMSR PRICING FOR N OUTCOMES
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Calculate C(q) = b * ln(sum_i(e^(q_i/b)))
     */
    function calculateCost(uint256[] memory _q) public view returns (uint256) {
        uint256 sumExp = 0;

        for (uint256 i = 0; i < outcomeCount; i++) {
            uint256 term = (_q[i] * 1e18) / b;
            sumExp += expApprox(term);
        }

        uint256 log2Sum = Math.log2(sumExp);
        uint256 lnSum = (log2Sum * 693147180559945309) / 1e18;

        return (b * lnSum) / 1e18;
    }

    function expApprox(uint256 x) internal pure returns (uint256) {
        if (x > 20 * 1e18) return type(uint256).max / 2;

        uint256 result = 1e18;
        uint256 term = 1e18;

        for (uint256 i = 1; i <= 10; i++) {
            term = (term * x) / (i * 1e18);
            result += term;
            if (term < 1) break;
        }
        return result;
    }

    /**
     * @notice Get price (probability) for specific outcome
     */
    function getPrice(uint256 _outcome) external view returns (uint256) {
        require(_outcome < outcomeCount, "Invalid outcome");

        uint256 sumExp = 0;
        uint256[] memory exps = new uint256[](outcomeCount);

        for (uint256 i = 0; i < outcomeCount; i++) {
            exps[i] = expApprox((q[i] * 1e18) / b);
            sumExp += exps[i];
        }

        return ((exps[_outcome] * 1e6) / sumExp);
    }

    /**
     * @notice Calculate cost to buy shares of specific outcome
     */
    function getBuyCost(
        uint256 _outcome,
        uint256 _shareAmount
    ) external view returns (uint256) {
        require(_outcome < outcomeCount, "Invalid outcome");

        uint256[] memory newQ = new uint256[](outcomeCount);
        for (uint256 i = 0; i < outcomeCount; i++) {
            newQ[i] = q[i];
        }
        newQ[_outcome] += _shareAmount;

        uint256 costBefore = calculateCost(q);
        uint256 costAfter = calculateCost(newQ);

        uint256 cost = ((costAfter - costBefore) * 1e6) / 1e18;
        return cost > 0 ? cost : 1;
    }

    /**
     * @notice Calculate refund for selling shares
     */
    function getSellRefund(
        uint256 _outcome,
        uint256 _shareAmount
    ) external view returns (uint256) {
        require(_outcome < outcomeCount, "Invalid outcome");
        require(q[_outcome] >= _shareAmount, "Insufficient liquidity");

        uint256[] memory newQ = new uint256[](outcomeCount);
        for (uint256 i = 0; i < outcomeCount; i++) {
            newQ[i] = q[i];
        }
        newQ[_outcome] -= _shareAmount;

        uint256 costBefore = calculateCost(q);
        uint256 costAfter = calculateCost(newQ);

        uint256 refund = ((costBefore - costAfter) * 1e6) / 1e18;
        return refund;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TRADING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function swapIn(
        uint256 _outcome,
        uint256 _shareAmount,
        uint256 _maxCost
    ) external nonReentrant notResolved {
        require(_outcome < outcomeCount, "Invalid outcome");
        require(_shareAmount > 0, "Amount must be > 0");

        uint256 cost = this.getBuyCost(_outcome, _shareAmount);
        require(cost <= _maxCost, "Slippage exceeded");

        require(
            collateralToken.transferFrom(msg.sender, address(this), cost),
            "Transfer failed"
        );

        q[_outcome] += _shareAmount;
        settlementPool += cost;
        userShares[msg.sender][_outcome] += _shareAmount;
        totalSharesPerOutcome[_outcome] += _shareAmount;

        updateAdaptiveB();

        emit SharesPurchased(msg.sender, _outcome, _shareAmount, cost);
    }

    function swapOut(
        uint256 _outcome,
        uint256 _shareAmount,
        uint256 _minRefund
    ) external nonReentrant notResolved {
        require(_outcome < outcomeCount, "Invalid outcome");
        require(
            userShares[msg.sender][_outcome] >= _shareAmount,
            "Insufficient shares"
        );

        uint256 refund = this.getSellRefund(_outcome, _shareAmount);
        require(refund >= _minRefund, "Slippage exceeded");

        userShares[msg.sender][_outcome] -= _shareAmount;
        totalSharesPerOutcome[_outcome] -= _shareAmount;
        q[_outcome] -= _shareAmount;
        settlementPool -= refund;

        require(
            collateralToken.transfer(msg.sender, refund),
            "Transfer failed"
        );

        updateAdaptiveB();

        emit SharesSold(msg.sender, _outcome, _shareAmount, refund);
    }

    function updateAdaptiveB() internal {
        uint256 poolBasedB = settlementPool / B_SCALING_FACTOR;
        uint256 newB = Math.max(initialB, poolBasedB);
        if (newB != b) {
            b = newB;
            emit AdaptiveBUpdated(b);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RESOLUTION INTERFACE
    // ═══════════════════════════════════════════════════════════════════════

    function resolve(uint256 _winningOutcome) external onlySettlementContract {
        require(!isResolved, "Already resolved");
        require(block.timestamp >= resolutionTime, "Too early");
        require(_winningOutcome < outcomeCount, "Invalid outcome");

        winningOutcome = _winningOutcome;
        isResolved = true;

        emit MarketResolved(_winningOutcome);
    }

    function claimWinnings() external nonReentrant returns (uint256) {
        require(isResolved, "Not resolved");

        uint256 userSharesWinning = userShares[msg.sender][winningOutcome];
        require(userSharesWinning > 0, "No winning shares");

        userShares[msg.sender][winningOutcome] = 0;

        uint256 winningTotal = totalSharesPerOutcome[winningOutcome];
        uint256 payout = (settlementPool * userSharesWinning) / winningTotal;

        require(
            collateralToken.transfer(msg.sender, payout),
            "Transfer failed"
        );

        return payout;
    }
}
