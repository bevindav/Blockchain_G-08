// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./Campaign.sol";
import "./DonationToken.sol";
import "./DonationReceipt.sol";

/// @title CampaignFactory - registry campaign, role, recipient terdaftar, dan anti-duplikasi order/bukti
/// @notice Campaign dibuat sebagai EIP-1167 minimal proxy (clone) dari satu implementasi sehingga
///         biaya gas pembuatan campaign jauh lebih murah dibanding men-deploy kontrak penuh.
contract CampaignFactory is AccessControl {
    using Clones for address;

    bytes32 public constant NGO_ROLE = keccak256("NGO_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    DonationToken public immutable token;
    DonationReceipt public immutable receipt;
    address public immutable implementation;

    /// @notice Batas nominal per transaksi fiat (mitigasi oracle manipulation: membatasi dampak key bocor).
    uint256 public fiatCap;
    uint8 public threshold;
    address[] private approvers;

    address[] public campaigns;
    mapping(address => bool) public isCampaign;
    mapping(address => bool) public isRecipient;
    mapping(bytes32 => bool) public usedOrders;
    mapping(bytes32 => bool) public usedProofs;

    event CampaignCreated(address indexed campaign, address indexed ngo, address indexed recipient,
        uint256 target, uint256 deadline, string metadataCID);
    event RecipientRegistered(address indexed recipient, bool registered, address indexed by);
    event ApproversUpdated(address[] approvers, uint8 threshold);
    event FiatCapUpdated(uint256 cap);
    event TopUpRecorded(bytes32 indexed orderId, address indexed to, uint256 amount);

    error ZeroAddress();
    error InvalidThreshold();
    error InvalidApprover();
    error OnlyCampaign();
    error DuplicateOrder();
    error DuplicateProof();
    error RecipientNotRegistered();
    error ExceedsFiatCap();
    error ZeroAmount();

    constructor(address token_, address admin, address[] memory approvers_, uint8 threshold_, uint256 fiatCap_) {
        if (token_ == address(0) || admin == address(0)) revert ZeroAddress();
        token = DonationToken(token_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _setApprovers(approvers_, threshold_);
        fiatCap = fiatCap_;
        receipt = new DonationReceipt(address(this));
        implementation = address(new Campaign());
    }

    modifier onlyCampaign() {
        if (!isCampaign[msg.sender]) revert OnlyCampaign();
        _;
    }

    // ------------------------------------------------------------------ campaign

    /// @param recipient wallet penerima manfaat yang sudah didaftarkan verifikator
    /// @param deadline batas waktu donasi (unix timestamp)
    /// @param metadataCID CID IPFS berisi judul, deskripsi, gambar, dan rencana penggunaan tiap milestone
    /// @param budgets nominal setiap milestone (dIDR); jumlahnya menjadi target dana
    function createCampaign(address recipient, uint40 deadline, string calldata metadataCID, uint128[] calldata budgets)
        external onlyRole(NGO_ROLE) returns (address campaign)
    {
        if (!isRecipient[recipient]) revert RecipientNotRegistered();
        campaign = implementation.clone();
        isCampaign[campaign] = true;
        campaigns.push(campaign);
        receipt.registerCampaign(campaign);
        token.grantRole(token.MINTER_ROLE(), campaign);
        uint256 target = Campaign(campaign).initialize(msg.sender, recipient, deadline, metadataCID, budgets, approvers, threshold);
        emit CampaignCreated(campaign, msg.sender, recipient, target, deadline, metadataCID);
    }

    function consumeOrder(bytes32 orderId) external onlyCampaign { _consumeOrder(orderId); }

    function consumeProof(bytes32 proofHash) external onlyCampaign {
        if (usedProofs[proofHash]) revert DuplicateProof();
        usedProofs[proofHash] = true;
    }

    // ------------------------------------------------------------------ fiat on-ramp

    /// @notice Oracle mencatat top-up rupiah -> dIDR ke wallet donatur (dipakai untuk donasi via MetaMask).
    function topUp(bytes32 orderId, address to, uint256 amount) external onlyRole(ORACLE_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > fiatCap) revert ExceedsFiatCap();
        _consumeOrder(orderId);
        emit TopUpRecorded(orderId, to, amount);
        token.mint(to, amount);
    }

    // ------------------------------------------------------------------ admin / verifier

    function registerRecipient(address recipient, bool registered) external onlyRole(VERIFIER_ROLE) {
        if (recipient == address(0)) revert ZeroAddress();
        isRecipient[recipient] = registered;
        emit RecipientRegistered(recipient, registered, msg.sender);
    }

    /// @notice Mengganti approver untuk campaign BARU. Campaign lama tetap memakai snapshot saat dibuat.
    function setApprovers(address[] calldata approvers_, uint8 threshold_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setApprovers(approvers_, threshold_);
    }

    function setFiatCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        fiatCap = cap;
        emit FiatCapUpdated(cap);
    }

    // ------------------------------------------------------------------ views

    function getApprovers() external view returns (address[] memory) { return approvers; }
    function campaignCount() external view returns (uint256) { return campaigns.length; }
    function getCampaigns() external view returns (address[] memory) { return campaigns; }

    // ------------------------------------------------------------------ internal

    function _consumeOrder(bytes32 orderId) private {
        if (orderId == bytes32(0) || usedOrders[orderId]) revert DuplicateOrder();
        usedOrders[orderId] = true;
    }

    function _setApprovers(address[] memory approvers_, uint8 threshold_) private {
        uint256 n = approvers_.length;
        if (threshold_ == 0 || threshold_ > n || n > type(uint8).max) revert InvalidThreshold();
        for (uint256 i; i < n; ++i) {
            if (approvers_[i] == address(0)) revert InvalidApprover();
            for (uint256 j; j < i; ++j) if (approvers_[i] == approvers_[j]) revert InvalidApprover();
        }
        approvers = approvers_;
        threshold = threshold_;
        emit ApproversUpdated(approvers_, threshold_);
    }
}
