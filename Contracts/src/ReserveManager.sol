// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./AugurXToken.sol";

/**
 * @title ReserveManager
 * @dev Manages backing assets and maintains 1:1 INR peg
 * @notice This contract handles the minting/burning of AUGURX tokens based on deposits/withdrawals
 */
contract ReserveManager is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    // AUGURX Token contract
    AugurXToken public immutable augurxToken;

    // Supported stablecoins
    IERC20 public immutable usdc;
    IERC20 public immutable usdt;

    // Exchange rates (1 USDC/USDT = X INR, scaled by 1e18)
    uint256 public usdcToInrRate = 83e18; // 1 USDC = 83 INR (example rate)
    uint256 public usdtToInrRate = 83e18; // 1 USDT = 83 INR (example rate)

    // Reserve tracking
    mapping(address => uint256) public reserveBalances;
    uint256 public totalReserveValue; // Total value in INR (scaled by 1e18)

    // Deposit/Withdrawal tracking
    mapping(address => mapping(address => uint256)) public userDeposits; // user => token => amount
    mapping(address => uint256) public userIndrBalance; // user => AUGURX balance from deposits

    // Events
    event Deposit(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 augurxMinted
    );
    event Withdrawal(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 augurxBurned
    );
    event ExchangeRateUpdated(
        address indexed token,
        uint256 oldRate,
        uint256 newRate
    );
    event ReserveUpdated(
        address indexed token,
        uint256 oldBalance,
        uint256 newBalance
    );

    // Modifiers
    modifier onlySupportedToken(address token) {
        require(
            token == address(usdc) || token == address(usdt),
            "ReserveManager: Unsupported token"
        );
        _;
    }

    /**
     * @dev Constructor
     * @param _augurxToken Address of AUGURX token contract
     * @param _usdc Address of USDC token
     * @param _usdt Address of USDT token
     */
    constructor(address _augurxToken, address _usdc, address _usdt) {
        require(
            _augurxToken != address(0),
            "ReserveManager: AUGURX token cannot be zero address"
        );
        require(
            _usdc != address(0),
            "ReserveManager: USDC cannot be zero address"
        );
        require(
            _usdt != address(0),
            "ReserveManager: USDT cannot be zero address"
        );

        augurxToken = AugurXToken(_augurxToken);
        usdc = IERC20(_usdc);
        usdt = IERC20(_usdt);

        // Set up roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        _grantRole(TREASURY_ROLE, msg.sender);
    }

    /**
     * @dev Deposit stablecoin and mint AUGURX tokens
     * @param token Address of the stablecoin to deposit
     * @param amount Amount of stablecoin to deposit
     */
    function deposit(
        address token,
        uint256 amount
    ) external onlySupportedToken(token) whenNotPaused nonReentrant {
        require(amount > 0, "ReserveManager: Amount must be greater than zero");

        IERC20 tokenContract = IERC20(token);
        require(
            tokenContract.balanceOf(msg.sender) >= amount,
            "ReserveManager: Insufficient balance"
        );

        // Transfer tokens from user to this contract
        tokenContract.safeTransferFrom(msg.sender, address(this), amount);

        // Calculate AUGURX amount to mint based on exchange rate
        uint256 augurxAmount = calculateIndrAmount(token, amount);
        require(
            augurxAmount > 0,
            "ReserveManager: AUGURX amount must be greater than zero"
        );

        // Update user deposits tracking
        userDeposits[msg.sender][token] += amount;
        userIndrBalance[msg.sender] += augurxAmount;

        // Update reserve balances
        reserveBalances[token] += amount;
        totalReserveValue += augurxAmount;

        // Mint AUGURX tokens to user
        augurxToken.mint(msg.sender, augurxAmount, "Deposit");

        emit Deposit(msg.sender, token, amount, augurxAmount);
        emit ReserveUpdated(
            token,
            reserveBalances[token] - amount,
            reserveBalances[token]
        );
    }

    /**
     * @dev Withdraw stablecoin by burning AUGURX tokens
     * @param token Address of the stablecoin to withdraw
     * @param augurxAmount Amount of AUGURX tokens to burn
     */
    function withdraw(
        address token,
        uint256 augurxAmount
    ) external onlySupportedToken(token) whenNotPaused nonReentrant {
        require(
            augurxAmount > 0,
            "ReserveManager: AUGURX amount must be greater than zero"
        );
        require(
            augurxToken.balanceOf(msg.sender) >= augurxAmount,
            "ReserveManager: Insufficient AUGURX balance"
        );
        require(
            userIndrBalance[msg.sender] >= augurxAmount,
            "ReserveManager: Insufficient deposit balance"
        );

        // Calculate stablecoin amount to withdraw
        uint256 tokenAmount = calculateTokenAmount(token, augurxAmount);
        require(
            tokenAmount > 0,
            "ReserveManager: Token amount must be greater than zero"
        );
        require(
            reserveBalances[token] >= tokenAmount,
            "ReserveManager: Insufficient reserve balance"
        );

        // Update user deposits tracking
        userDeposits[msg.sender][token] -= tokenAmount;
        userIndrBalance[msg.sender] -= augurxAmount;

        // Update reserve balances
        reserveBalances[token] -= tokenAmount;
        totalReserveValue -= augurxAmount;

        // Burn AUGURX tokens from user
        augurxToken.burn(msg.sender, augurxAmount, "Withdrawal");

        // Transfer stablecoin to user
        IERC20(token).safeTransfer(msg.sender, tokenAmount);

        emit Withdrawal(msg.sender, token, tokenAmount, augurxAmount);
        emit ReserveUpdated(
            token,
            reserveBalances[token] + tokenAmount,
            reserveBalances[token]
        );
    }

    /**
     * @dev Calculate AUGURX amount to mint based on stablecoin amount
     * @param token Address of the stablecoin
     * @param amount Amount of stablecoin
     * @return AUGURX amount to mint
     */
    function calculateIndrAmount(
        address token,
        uint256 amount
    ) public view returns (uint256) {
        if (token == address(usdc)) {
            return (amount * usdcToInrRate) / 1e18;
        } else if (token == address(usdt)) {
            return (amount * usdtToInrRate) / 1e18;
        }
        return 0;
    }

    /**
     * @dev Calculate stablecoin amount to withdraw based on AUGURX amount
     * @param token Address of the stablecoin
     * @param augurxAmount Amount of AUGURX tokens
     * @return Stablecoin amount to withdraw
     */
    function calculateTokenAmount(
        address token,
        uint256 augurxAmount
    ) public view returns (uint256) {
        if (token == address(usdc)) {
            return (augurxAmount * 1e18) / usdcToInrRate;
        } else if (token == address(usdt)) {
            return (augurxAmount * 1e18) / usdtToInrRate;
        }
        return 0;
    }

    /**
     * @dev Update exchange rate (only operator role)
     * @param token Address of the token
     * @param newRate New exchange rate (scaled by 1e18)
     */
    function updateExchangeRate(
        address token,
        uint256 newRate
    ) external onlyRole(OPERATOR_ROLE) onlySupportedToken(token) {
        require(
            newRate > 0,
            "ReserveManager: Exchange rate must be greater than zero"
        );

        uint256 oldRate;
        if (token == address(usdc)) {
            oldRate = usdcToInrRate;
            usdcToInrRate = newRate;
        } else if (token == address(usdt)) {
            oldRate = usdtToInrRate;
            usdtToInrRate = newRate;
        }

        emit ExchangeRateUpdated(token, oldRate, newRate);
    }

    /**
     * @dev Get user's total AUGURX balance from deposits
     * @param user User address
     * @return Total AUGURX balance from deposits
     */
    function getUserIndrBalance(address user) external view returns (uint256) {
        return userIndrBalance[user];
    }

    /**
     * @dev Get user's deposit amount for a specific token
     * @param user User address
     * @param token Token address
     * @return Deposit amount
     */
    function getUserDeposit(
        address user,
        address token
    ) external view returns (uint256) {
        return userDeposits[user][token];
    }

    /**
     * @dev Get total reserve value in INR
     * @return Total reserve value (scaled by 1e18)
     */
    function getTotalReserveValue() external view returns (uint256) {
        return totalReserveValue;
    }

    /**
     * @dev Pause the contract (only admin role)
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause the contract (only admin role)
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
