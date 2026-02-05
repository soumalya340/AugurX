// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AUGURXToken
 * @dev Indian Digital Rupee - 1:1 INR pegged stablecoin
 * @notice This contract implements the AUGURX token with mint/burn functionality
 *         and access controls for treasury management
 */
contract AugurXToken is ERC20, AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // Reserve Manager contract address
    address public reserveManager;

    // Events
    event ReserveManagerUpdated(
        address indexed oldManager,
        address indexed newManager
    );
    event TokensMinted(address indexed to, uint256 amount, string reason);
    event TokensBurned(address indexed from, uint256 amount, string reason);

    // Modifiers
    modifier onlyReserveManager() {
        require(
            msg.sender == reserveManager,
            "AUGURX: Only Reserve Manager can call this function"
        );
        _;
    }

    /**
     * @dev Constructor that initializes the AUGURX token
     * @param _reserveManager Address of the Reserve Manager contract
     */
    constructor(address _reserveManager) ERC20("Indian Digital Rupee", "AUGURX") {
        require(
            _reserveManager != address(0),
            "AUGURX: Reserve Manager cannot be zero address"
        );

        reserveManager = _reserveManager;

        // Set up roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, _reserveManager);
        _grantRole(BURNER_ROLE, _reserveManager);
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    /**
     * @dev Mint new AUGURX tokens (only Reserve Manager)
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     * @param reason Reason for minting (for transparency)
     */
    function mint(
        address to,
        uint256 amount,
        string calldata reason
    ) external onlyRole(MINTER_ROLE) whenNotPaused nonReentrant {
        require(to != address(0), "AUGURX: Cannot mint to zero address");
        require(amount > 0, "AUGURX: Amount must be greater than zero");

        _mint(to, amount);
        emit TokensMinted(to, amount, reason);
    }

    /**
     * @dev Burn AUGURX tokens (only Reserve Manager)
     * @param from Address to burn tokens from
     * @param amount Amount of tokens to burn
     * @param reason Reason for burning (for transparency)
     */
    function burn(
        address from,
        uint256 amount,
        string calldata reason
    ) external onlyRole(BURNER_ROLE) whenNotPaused nonReentrant {
        require(from != address(0), "AUGURX: Cannot burn from zero address");
        require(amount > 0, "AUGURX: Amount must be greater than zero");
        require(
            balanceOf(from) >= amount,
            "AUGURX: Insufficient balance to burn"
        );

        _burn(from, amount);
        emit TokensBurned(from, amount, reason);
    }

    /**
     * @dev Update Reserve Manager address (only admin)
     * @param _newReserveManager New Reserve Manager address
     */
    function updateReserveManager(
        address _newReserveManager
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            _newReserveManager != address(0),
            "AUGURX: Reserve Manager cannot be zero address"
        );

        address oldManager = reserveManager;
        reserveManager = _newReserveManager;

        // Update roles
        _revokeRole(MINTER_ROLE, oldManager);
        _revokeRole(BURNER_ROLE, oldManager);
        _grantRole(MINTER_ROLE, _newReserveManager);
        _grantRole(BURNER_ROLE, _newReserveManager);

        emit ReserveManagerUpdated(oldManager, _newReserveManager);
    }

    /**
     * @dev Pause the contract (only pauser role)
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause the contract (only pauser role)
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @dev Override _update to include pause functionality (OZ v5.x)
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override whenNotPaused {
        super._update(from, to, value);
    }

    /**
     * @dev Get total supply with 18 decimals
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
