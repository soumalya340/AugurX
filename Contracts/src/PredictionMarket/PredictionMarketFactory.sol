// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "./Binary.sol";
import "./CategoricalMarket.sol";

contract PredictionMarketFactory {
    using Math for uint256;

    // Market types
    enum MarketType {
        BINARY,
        CATEGORICAL
    }

    // Market status
    enum MarketStatus {
        ACTIVE,
        RESOLVED,
        SETTLED
    }

    struct MarketInfo {
        address marketAddress;
        MarketType marketType;
        MarketStatus status;
        address creator;
        string question;
        uint256 resolutionTime;
        address settlementContract;
    }

    // State variables
    mapping(uint256 => MarketInfo) public markets;
    mapping(address => bool) public authorizedCreators;
    uint256 public marketCount;

    // Platform parameters
    uint256 public creationFee;
    uint256 public minSeedAmount; // Minimal LMSR seed (e.g., 0.01 USDC)
    bool public permissionlessCreation;

    // Events
    event MarketCreated(
        uint256 indexed marketId,
        address indexed marketAddress,
        MarketType marketType,
        address creator,
        string question
    );

    // Constructor
    constructor(
        uint256 _creationFee,
        uint256 _minSeedAmount,
        bool _permissionless
    ) {
        creationFee = _creationFee;
        minSeedAmount = _minSeedAmount;
        permissionlessCreation = _permissionless;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MARKET CREATION FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Create a binary Yes/No market
     * @param _question The market question (e.g., "Will ETH hit $5000 by Dec 2025?")
     * @param _outcomeNames Array with exactly 2 outcomes ["Yes", "No"]
     * @param _resolutionTime Timestamp when market can be resolved
     * @param _initialB Initial liquidity parameter (can be small, grows adaptively)
     * @param _settlementLogic Address of settlement resolver contract
     */
    function createBinaryMarket(
        string calldata _question,
        string[2] calldata _outcomeNames,
        uint256 _resolutionTime,
        uint256 _initialB,
        address _settlementLogic,
        address _quoteTokenAddr
    ) external payable returns (uint256 marketId, address marketAddress) {
        require(msg.value >= creationFee, "Insufficient creation fee");
        require(_resolutionTime > block.timestamp, "Resolution must be future");
        require(
            permissionlessCreation || authorizedCreators[msg.sender],
            "Unauthorized creator"
        );

        marketId = marketCount++;

        // Deploy Binary Market with minimal seed
        BinaryMarket newMarket = new BinaryMarket(
            marketId,
            _question,
            _outcomeNames,
            _resolutionTime,
            Math.max(_initialB, minSeedAmount), // Ensure minimum b
            _settlementLogic,
            msg.sender,
            _quoteTokenAddr
        );

        marketAddress = address(newMarket);

        markets[marketId] = MarketInfo({
            marketAddress: marketAddress,
            marketType: MarketType.BINARY,
            status: MarketStatus.ACTIVE,
            creator: msg.sender,
            question: _question,
            resolutionTime: _resolutionTime,
            settlementContract: _settlementLogic
        });

        emit MarketCreated(
            marketId,
            marketAddress,
            MarketType.BINARY,
            msg.sender,
            _question
        );

        return (marketId, marketAddress);
    }

    /**
     * @notice Create categorical market with multiple outcomes
     * @param _question The market question
     * @param _outcomeNames Array of outcome names (3-8 outcomes recommended)
     * @param _resolutionTime Timestamp when market can be resolved
     * @param _initialB Initial liquidity parameter
     * @param _settlementLogic Address of settlement resolver contract
     */
    function createCategoricalMarket(
        string calldata _question,
        string[] calldata _outcomeNames,
        uint256 _resolutionTime,
        uint256 _initialB,
        address _settlementLogic,
        address _quoteTokenAddr
    ) external payable returns (uint256 marketId, address marketAddress) {
        require(msg.value >= creationFee, "Insufficient creation fee");
        require(_outcomeNames.length >= 2, "Min 2 outcomes");
        require(_outcomeNames.length <= 10, "Max 10 outcomes");
        require(_resolutionTime > block.timestamp, "Resolution must be future");
        require(
            permissionlessCreation || authorizedCreators[msg.sender],
            "Unauthorized creator"
        );

        marketId = marketCount++;

        CategoricalMarket newMarket = new CategoricalMarket(
            marketId,
            _question,
            _outcomeNames,
            _resolutionTime,
            Math.max(_initialB, minSeedAmount),
            _outcomeNames.length,
            _settlementLogic,
            msg.sender,
            _quoteTokenAddr
        );

        marketAddress = address(newMarket);

        markets[marketId] = MarketInfo({
            marketAddress: marketAddress,
            marketType: MarketType.CATEGORICAL,
            status: MarketStatus.ACTIVE,
            creator: msg.sender,
            question: _question,
            resolutionTime: _resolutionTime,
            settlementContract: _settlementLogic
        });

        emit MarketCreated(
            marketId,
            marketAddress,
            MarketType.CATEGORICAL,
            msg.sender,
            _question
        );

        return (marketId, marketAddress);
    }

    // Admin functions for creator authorization
    function setAuthorizedCreator(address _creator, bool _authorized) external {
        // Only owner/governance
        authorizedCreators[_creator] = _authorized;
    }

    function updateCreationFee(uint256 _newFee) external {
        creationFee = _newFee;
    }
}
