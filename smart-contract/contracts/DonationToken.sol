// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title dIDR - representasi rupiah on-chain untuk platform donasi (1 dIDR = Rp1)
/// @notice Token dicetak (mint) hanya oleh kontrak terotorisasi (factory/campaign) setelah pembayaran
///         rupiah diverifikasi oracle. Penerima dapat menukarkan (redeem) dIDR ke rekening bank;
///         token dibakar dan oracle off-ramp mengonfirmasi pembayaran dengan referensi transfer.
contract DonationToken is ERC20, ERC20Pausable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant OFFRAMP_ROLE = keccak256("OFFRAMP_ROLE");

    enum RedemptionStatus { None, Requested, Paid }

    /// @dev Dipacking dalam satu slot: 20 + 11 + 1 byte.
    struct Redemption { address account; uint88 amount; RedemptionStatus status; }

    Redemption[] public redemptions;

    event RedemptionRequested(uint256 indexed id, address indexed account, uint256 amount, bytes32 bankRef);
    event RedemptionPaid(uint256 indexed id, address indexed account, uint256 amount, bytes32 payoutRef);

    error ZeroAddress();
    error ZeroAmount();
    error AmountTooLarge();
    error InvalidRedemption();

    constructor(address admin) ERC20("Donation IDR", "dIDR") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function decimals() public pure override returns (uint8) { return 0; }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
    }

    /// @notice Tukar dIDR menjadi rupiah. `bankRef` adalah hash data rekening yang disimpan off-chain
    ///         (data rekening tidak pernah ditulis on-chain demi privasi).
    function redeem(uint256 amount, bytes32 bankRef) external returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        if (amount > type(uint88).max) revert AmountTooLarge();
        if (bankRef == bytes32(0)) revert InvalidRedemption();
        _burn(msg.sender, amount); // memanggil _update -> menolak bila paused
        id = redemptions.length;
        redemptions.push(Redemption(msg.sender, uint88(amount), RedemptionStatus.Requested));
        emit RedemptionRequested(id, msg.sender, amount, bankRef);
    }

    /// @notice Dipanggil oracle off-ramp setelah transfer bank berhasil.
    function confirmRedemption(uint256 id, bytes32 payoutRef) external onlyRole(OFFRAMP_ROLE) {
        if (id >= redemptions.length || payoutRef == bytes32(0)) revert InvalidRedemption();
        Redemption storage r = redemptions[id];
        if (r.status != RedemptionStatus.Requested) revert InvalidRedemption();
        r.status = RedemptionStatus.Paid;
        emit RedemptionPaid(id, r.account, r.amount, payoutRef);
    }

    function redemptionCount() external view returns (uint256) { return redemptions.length; }

    /// @notice Circuit breaker darurat: menghentikan seluruh transfer, mint, donasi, dan pencairan.
    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Pausable) {
        super._update(from, to, value);
    }
}
