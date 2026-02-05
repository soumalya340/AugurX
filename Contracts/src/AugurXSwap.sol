// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./AugurXToken.sol";

/**
 * @title AUGURXSwap
 * @dev AMM-style swap interface for AUGURX-USDC trading
 * @notice Provides liquidity and swap functionality for AUGURX tokens
 */
contract AugurXSwap is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant LIQUIDITY_PROVIDER_ROLE =
        keccak256("LIQUIDITY_PROVIDER_ROLE");

    // Core contracts
    AugurXToken public immutable augurxToken;
    IERC20 public immutable usdc;

    // Pool state
    uint256 public augurxReserve;
    uint256 public usdcReserve;
    uint256 public totalLiquidityTokens;

    // Liquidity provider tracking
    mapping(address => uint256) public liquidityProviderShares;
    mapping(address => uint256) public liquidityProviderDeposits;

    // Swap parameters
    uint256 public constant FEE_RATE = 30; // 0.3% fee (30 basis points)
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MINIMUM_LIQUIDITY = 1000; // Minimum liquidity tokens

    // Price impact protection
    uint256 public constant MAX_PRICE_IMPACT = 5e16; // 5% maximum price impact

    // Events
    event LiquidityAdded(
        address indexed provider,
        uint256 augurxAmount,
        uint256 usdcAmount,
        uint256 liquidityTokens
    );
    event LiquidityRemoved(
        address indexed provider,
        uint256 augurxAmount,
        uint256 usdcAmount,
        uint256 liquidityTokens
    );
    event SwapExecuted(
        address indexed user,
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut
    );
    event FeeCollected(uint256 augurxFee, uint256 usdcFee);
    event ReserveUpdated(uint256 augurxReserve, uint256 usdcReserve);

    // Modifiers
    modifier onlyValidToken(address token) {
        require(
            token == address(augurxToken) || token == address(usdc),
            "AUGURXSwap: Invalid token"
        );
        _;
    }

    modifier onlySufficientReserves() {
        require(
            augurxReserve > 0 && usdcReserve > 0,
            "AUGURXSwap: Insufficient reserves"
        );
        _;
    }

    /**
     * @dev Constructor
     * @param _augurxToken Address of AUGURX token contract
     * @param _usdc Address of USDC token
     */
    constructor(address _augurxToken, address _usdc) {
        require(
            _augurxToken != address(0),
            "AUGURXSwap: AUGURX token cannot be zero address"
        );
        require(_usdc != address(0), "AUGURXSwap: USDC cannot be zero address");

        augurxToken = AugurXToken(_augurxToken);
        usdc = IERC20(_usdc);

        // Set up roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        _grantRole(LIQUIDITY_PROVIDER_ROLE, msg.sender);
    }

    /**
     * @dev Add liquidity to the pool
     * @param augurxAmount Amount of AUGURX tokens to add
     * @param usdcAmount Amount of USDC to add
     * @param minLiquidity Minimum liquidity tokens expected
     */
    function addLiquidity(
        uint256 augurxAmount,
        uint256 usdcAmount,
        uint256 minLiquidity
    ) external whenNotPaused nonReentrant {
        require(
            augurxAmount > 0 && usdcAmount > 0,
            "AUGURXSwap: Amounts must be greater than zero"
        );
        require(
            augurxToken.balanceOf(msg.sender) >= augurxAmount,
            "AUGURXSwap: Insufficient AUGURX balance"
        );
        require(
            usdc.balanceOf(msg.sender) >= usdcAmount,
            "AUGURXSwap: Insufficient USDC balance"
        );

        uint256 liquidityTokens;

        if (totalLiquidityTokens == 0) {
            // First liquidity provision
            liquidityTokens =
                sqrt(augurxAmount * usdcAmount) -
                MINIMUM_LIQUIDITY;
            require(liquidityTokens > 0, "AUGURXSwap: Insufficient liquidity");

            // Lock minimum liquidity
            totalLiquidityTokens = MINIMUM_LIQUIDITY;
        } else {
            // Calculate liquidity tokens based on existing reserves
            uint256 augurxLiquidity = (augurxAmount * totalLiquidityTokens) /
                augurxReserve;
            uint256 usdcLiquidity = (usdcAmount * totalLiquidityTokens) /
                usdcReserve;
            liquidityTokens = augurxLiquidity < usdcLiquidity
                ? augurxLiquidity
                : usdcLiquidity;
        }

        require(
            liquidityTokens >= minLiquidity,
            "AUGURXSwap: Insufficient liquidity tokens"
        );

        // Transfer tokens from user
        IERC20(address(augurxToken)).safeTransferFrom(
            msg.sender,
            address(this),
            augurxAmount
        );
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Update reserves
        augurxReserve += augurxAmount;
        usdcReserve += usdcAmount;
        totalLiquidityTokens += liquidityTokens;

        // Update liquidity provider tracking
        liquidityProviderShares[msg.sender] += liquidityTokens;
        liquidityProviderDeposits[msg.sender] += augurxAmount + usdcAmount;

        emit LiquidityAdded(
            msg.sender,
            augurxAmount,
            usdcAmount,
            liquidityTokens
        );
        emit ReserveUpdated(augurxReserve, usdcReserve);
    }

    /**
     * @dev Remove liquidity from the pool
     * @param liquidityTokens Amount of liquidity tokens to burn
     * @param minIndr Minimum AUGURX tokens expected
     * @param minUsdc Minimum USDC expected
     */
    function removeLiquidity(
        uint256 liquidityTokens,
        uint256 minIndr,
        uint256 minUsdc
    ) external whenNotPaused nonReentrant {
        require(
            liquidityTokens > 0,
            "AUGURXSwap: Liquidity tokens must be greater than zero"
        );
        require(
            liquidityProviderShares[msg.sender] >= liquidityTokens,
            "AUGURXSwap: Insufficient liquidity shares"
        );

        // Calculate amounts to return
        uint256 augurxAmount = (liquidityTokens * augurxReserve) /
            totalLiquidityTokens;
        uint256 usdcAmount = (liquidityTokens * usdcReserve) /
            totalLiquidityTokens;

        require(
            augurxAmount >= minIndr && usdcAmount >= minUsdc,
            "AUGURXSwap: Insufficient amounts"
        );

        // Update reserves
        augurxReserve -= augurxAmount;
        usdcReserve -= usdcAmount;
        totalLiquidityTokens -= liquidityTokens;

        // Update liquidity provider tracking
        liquidityProviderShares[msg.sender] -= liquidityTokens;
        liquidityProviderDeposits[msg.sender] -= augurxAmount + usdcAmount;

        // Transfer tokens to user
        IERC20(address(augurxToken)).safeTransfer(msg.sender, augurxAmount);
        usdc.safeTransfer(msg.sender, usdcAmount);

        emit LiquidityRemoved(
            msg.sender,
            augurxAmount,
            usdcAmount,
            liquidityTokens
        );
        emit ReserveUpdated(augurxReserve, usdcReserve);
    }

    /**
     * @dev Swap tokens
     * @param tokenIn Address of input token
     * @param amountIn Amount of input tokens
     * @param minAmountOut Minimum amount of output tokens expected
     */
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut
    )
        external
        whenNotPaused
        nonReentrant
        onlyValidToken(tokenIn)
        onlySufficientReserves
    {
        require(amountIn > 0, "AUGURXSwap: Amount must be greater than zero");

        address tokenOut = tokenIn == address(augurxToken)
            ? address(usdc)
            : address(augurxToken);

        // Check user balance
        if (tokenIn == address(augurxToken)) {
            require(
                augurxToken.balanceOf(msg.sender) >= amountIn,
                "AUGURXSwap: Insufficient AUGURX balance"
            );
        } else {
            require(
                usdc.balanceOf(msg.sender) >= amountIn,
                "AUGURXSwap: Insufficient USDC balance"
            );
        }

        // Calculate output amount
        uint256 amountOut = calculateSwapOutput(tokenIn, amountIn);
        require(
            amountOut >= minAmountOut,
            "AUGURXSwap: Insufficient output amount"
        );

        // Check price impact
        require(
            _checkPriceImpact(tokenIn, amountIn, amountOut),
            "AUGURXSwap: Price impact too high"
        );

        // Calculate fees
        uint256 fee = (amountIn * FEE_RATE) / FEE_DENOMINATOR;
        uint256 amountInAfterFee = amountIn - fee;

        // Transfer input tokens from user
        if (tokenIn == address(augurxToken)) {
            IERC20(address(augurxToken)).safeTransferFrom(
                msg.sender,
                address(this),
                amountIn
            );
        } else {
            usdc.safeTransferFrom(msg.sender, address(this), amountIn);
        }

        // Update reserves
        if (tokenIn == address(augurxToken)) {
            augurxReserve += amountInAfterFee;
            usdcReserve -= amountOut;
        } else {
            usdcReserve += amountInAfterFee;
            augurxReserve -= amountOut;
        }

        // Transfer output tokens to user
        if (tokenOut == address(augurxToken)) {
            IERC20(address(augurxToken)).safeTransfer(msg.sender, amountOut);
        } else {
            usdc.safeTransfer(msg.sender, amountOut);
        }

        // Handle fees
        _handleFees(tokenIn, fee);

        emit SwapExecuted(msg.sender, tokenIn, amountIn, tokenOut, amountOut);
        emit ReserveUpdated(augurxReserve, usdcReserve);
    }

    /**
     * @dev Calculate swap output amount
     * @param tokenIn Address of input token
     * @param amountIn Amount of input tokens
     * @return Output amount
     */
    function calculateSwapOutput(
        address tokenIn,
        uint256 amountIn
    ) public view returns (uint256) {
        require(amountIn > 0, "AUGURXSwap: Amount must be greater than zero");

        uint256 reserveIn;
        uint256 reserveOut;

        if (tokenIn == address(augurxToken)) {
            reserveIn = augurxReserve;
            reserveOut = usdcReserve;
        } else {
            reserveIn = usdcReserve;
            reserveOut = augurxReserve;
        }

        require(
            reserveIn > 0 && reserveOut > 0,
            "AUGURXSwap: Insufficient reserves"
        );

        // Calculate fee
        uint256 fee = (amountIn * FEE_RATE) / FEE_DENOMINATOR;
        uint256 amountInAfterFee = amountIn - fee;

        // Constant product formula: (x + Δx) * (y - Δy) = x * y
        // Δy = (y * Δx) / (x + Δx)
        uint256 numerator = amountInAfterFee * reserveOut;
        uint256 denominator = reserveIn + amountInAfterFee;

        return numerator / denominator;
    }

    /**
     * @dev Check price impact
     * @param tokenIn Address of input token
     * @param amountIn Amount of input tokens
     * @param amountOut Amount of output tokens
     * @return Whether price impact is acceptable
     */
    function _checkPriceImpact(
        address tokenIn,
        uint256 amountIn,
        uint256 amountOut
    ) internal view returns (bool) {
        uint256 reserveIn = tokenIn == address(augurxToken)
            ? augurxReserve
            : usdcReserve;
        uint256 reserveOut = tokenIn == address(augurxToken)
            ? usdcReserve
            : augurxReserve;

        // Calculate price impact
        uint256 priceImpact = (amountIn * 1e18) / reserveIn;

        return priceImpact <= MAX_PRICE_IMPACT;
    }

    /**
     * @dev Handle fees
     * @param tokenIn Address of input token
     * @param fee Fee amount
     */
    function _handleFees(address tokenIn, uint256 fee) internal {
        if (fee > 0) {
            // Distribute fees to liquidity providers
            // For now, fees are kept in the contract for future distribution
            // This can be enhanced to distribute fees to liquidity providers

            if (tokenIn == address(augurxToken)) {
                emit FeeCollected(fee, 0);
            } else {
                emit FeeCollected(0, fee);
            }
        }
    }

    /**
     * @dev Get current exchange rate
     * @param tokenIn Address of input token
     * @return Exchange rate (scaled by 1e18)
     */
    function getExchangeRate(address tokenIn) external view returns (uint256) {
        if (tokenIn == address(augurxToken)) {
            return (usdcReserve * 1e18) / augurxReserve;
        } else {
            return (augurxReserve * 1e18) / usdcReserve;
        }
    }

    /**
     * @dev Get pool information
     * @return augurxReserve, usdcReserve, totalLiquidityTokens
     */
    function getPoolInfo() external view returns (uint256, uint256, uint256) {
        return (augurxReserve, usdcReserve, totalLiquidityTokens);
    }

    /**
     * @dev Get liquidity provider information
     * @param provider Address of liquidity provider
     * @return shares, deposits
     */
    function getLiquidityProviderInfo(
        address provider
    ) external view returns (uint256, uint256) {
        return (
            liquidityProviderShares[provider],
            liquidityProviderDeposits[provider]
        );
    }

    /**
     * @dev Calculate square root (for liquidity calculation)
     * @param x Input value
     * @return Square root
     */
    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;

        uint256 z = (x + 1) / 2;
        uint256 y = x;

        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }

        return y;
    }

    /**
     * @dev Emergency withdraw (only admin)
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(
        address token,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            token == address(augurxToken) || token == address(usdc),
            "AUGURXSwap: Invalid token"
        );

        if (token == address(augurxToken)) {
            IERC20(address(augurxToken)).safeTransfer(msg.sender, amount);
        } else {
            usdc.safeTransfer(msg.sender, amount);
        }
    }

    /**
     * @dev Pause the contract (only admin)
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause the contract (only admin)
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
