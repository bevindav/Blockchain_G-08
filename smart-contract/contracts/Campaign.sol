// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IDonationToken is IERC20 { function mint(address to, uint256 amount) external; }
interface IDonationReceipt { function mint(address donor, uint256 amount, bytes32 orderId) external returns (uint256); }
interface ICampaignFactory {
    function token() external view returns (address);
    function receipt() external view returns (address);
    function fiatCap() external view returns (uint256);
    function hasRole(bytes32 role, address account) external view returns (bool);
    function consumeOrder(bytes32 orderId) external;
    function consumeProof(bytes32 proofHash) external;
}

/// @title Campaign - escrow donasi, milestone, persetujuan N-of-M, bukti IPFS, dan refund
/// @notice Di-deploy sebagai EIP-1167 clone oleh CampaignFactory, sehingga memakai `initialize`
///         sebagai pengganti constructor.
contract Campaign is ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 private constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 private constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    enum State { Pending, Active, Completed, Cancelled }
    enum WStatus { Pending, Approved, Executed, Rejected, Cancelled }

    struct Milestone { uint128 budget; uint128 paid; uint128 reserved; }
    /// @dev Satu slot (128+32+8+8+8+40 bit) + satu slot hash bukti.
    struct Withdrawal {
        uint128 amount; uint32 milestone; uint8 approvals; uint8 rejections; WStatus status; uint40 requestedAt;
        bytes32 proofHash;
    }
    struct Summary {
        address ngo; address recipient; State state; uint40 deadline; uint8 threshold; uint8 approverCount;
        uint256 totalBudget; uint256 totalDonated; uint256 totalPaid; uint256 reserved; uint256 balance;
        uint256 donationCount; uint256 milestoneCount; uint256 withdrawalCount; string metadataCID;
    }

    // slot 0: factory(20) + deadline(5) + state(1) + threshold(1) + approverCount(1)
    ICampaignFactory public factory;
    uint40 public deadline;
    State public state;
    uint8 public threshold;
    uint8 public approverCount;
    address public ngo;
    address public recipient;
    IERC20 public token;
    IDonationReceipt public receipt;
    uint128 public totalBudget;
    uint128 public totalDonated;
    uint128 public totalPaid;
    uint128 public reserved;
    uint128 public refundPool;
    uint128 public refundBase;
    uint256 public donationCount;
    string public metadataCID;

    Milestone[] private _milestones;
    Withdrawal[] private _withdrawals;
    address[] private _approvers;
    mapping(address => bool) public isApprover;
    /// @dev 0 = belum vote, 1 = setuju, 2 = tolak
    mapping(uint256 => mapping(address => uint8)) public votes;
    mapping(address => uint256) public contributions;
    mapping(address => bool) public refunded;

    event Activated(address indexed verifier);
    event Cancelled(address indexed by, string reason, uint256 refundPool);
    event DonationRecorded(address indexed donor, uint256 amount, bytes32 indexed orderId, uint256 receiptId);
    event WithdrawalRequested(uint256 indexed id, uint256 indexed milestone, uint256 amount, bytes32 proofHash, string proofCID);
    event WithdrawalApproved(uint256 indexed id, address indexed approver);
    event WithdrawalRejected(uint256 indexed id, address indexed approver, string reason);
    event WithdrawalClosed(uint256 indexed id, WStatus status);
    event WithdrawalExecuted(uint256 indexed id, address indexed recipient, uint256 amount);
    event ReportSubmitted(uint256 indexed withdrawalId, address indexed by, bytes32 proofHash, string proofCID);
    event Refunded(address indexed donor, uint256 amount);
    event Completed();

    error AlreadyInitialized();
    error ZeroAddress();
    error InvalidDeadline();
    error NoMilestones();
    error ZeroBudget();
    error Unauthorized();
    error InvalidState();
    error DeadlinePassed();
    error InvalidDonation();
    error ExceedsTarget();
    error ExceedsFiatCap();
    error InvalidWithdrawal();
    error ExceedsMilestone();
    error InsufficientEscrow();
    error AlreadyVoted();
    error InvalidProof();
    error NothingToRefund();

    /// @dev Mengunci kontrak implementasi agar tidak bisa di-initialize.
    constructor() { factory = ICampaignFactory(address(1)); }

    function initialize(address ngo_, address recipient_, uint40 deadline_, string calldata metadataCID_,
        uint128[] calldata budgets, address[] calldata approvers_, uint8 threshold_) external returns (uint256 target)
    {
        if (address(factory) != address(0)) revert AlreadyInitialized();
        if (ngo_ == address(0) || recipient_ == address(0)) revert ZeroAddress();
        if (deadline_ <= block.timestamp) revert InvalidDeadline();
        uint256 n = budgets.length;
        if (n == 0) revert NoMilestones();
        ICampaignFactory f = ICampaignFactory(msg.sender);
        factory = f;
        token = IERC20(f.token());
        receipt = IDonationReceipt(f.receipt());
        ngo = ngo_; recipient = recipient_; deadline = deadline_; metadataCID = metadataCID_;
        for (uint256 i; i < n; ++i) {
            if (budgets[i] == 0) revert ZeroBudget();
            _milestones.push(Milestone(budgets[i], 0, 0));
            target += budgets[i];
        }
        totalBudget = uint128(target);
        // approver sudah divalidasi unik & non-zero oleh factory
        for (uint256 i; i < approvers_.length; ++i) isApprover[approvers_[i]] = true;
        _approvers = approvers_;
        approverCount = uint8(approvers_.length);
        threshold = threshold_;
    }

    // ------------------------------------------------------------------ modifiers

    modifier onlyNgo() { if (msg.sender != ngo) revert Unauthorized(); _; }
    modifier onlyApprover() { if (!isApprover[msg.sender]) revert Unauthorized(); _; }
    modifier onlyRole(bytes32 role) { if (!factory.hasRole(role, msg.sender)) revert Unauthorized(); _; }
    modifier inState(State s) { if (state != s) revert InvalidState(); _; }

    // ------------------------------------------------------------------ lifecycle

    function activate() external onlyRole(VERIFIER_ROLE) inState(State.Pending) {
        if (block.timestamp > deadline) revert DeadlinePassed();
        state = State.Active;
        emit Activated(msg.sender);
    }

    /// @notice Membatalkan campaign (verifikator atau NGO). Seluruh saldo escrow tersisa menjadi
    ///         dana refund yang dibagi proporsional terhadap kontribusi tiap donatur.
    function cancel(string calldata reason) external {
        if (msg.sender != ngo && !factory.hasRole(VERIFIER_ROLE, msg.sender)) revert Unauthorized();
        if (state != State.Pending && state != State.Active) revert InvalidState();
        state = State.Cancelled;
        reserved = 0;
        uint256 pool = token.balanceOf(address(this));
        refundPool = uint128(pool);
        refundBase = totalDonated;
        emit Cancelled(msg.sender, reason, pool);
    }

    // ------------------------------------------------------------------ donations

    /// @notice Donasi langsung dengan dIDR (butuh `approve` terlebih dahulu).
    function donate(uint256 amount) external nonReentrant {
        _validateDonation(msg.sender, amount);
        _record(msg.sender, amount, bytes32(0));
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Donasi rupiah yang sudah diverifikasi oracle (Midtrans). `orderId` = keccak256(order id Midtrans).
    function recordFiatDonation(bytes32 orderId, address donor, uint256 amount) external nonReentrant onlyRole(ORACLE_ROLE) {
        _validateDonation(donor, amount);
        if (amount > factory.fiatCap()) revert ExceedsFiatCap();
        _record(donor, amount, orderId);
        factory.consumeOrder(orderId); // revert DuplicateOrder bila sudah pernah dicatat (global)
        IDonationToken(address(token)).mint(address(this), amount);
    }

    function _validateDonation(address donor, uint256 amount) private view {
        if (state != State.Active) revert InvalidState();
        if (block.timestamp > deadline) revert DeadlinePassed();
        if (donor == address(0) || amount == 0) revert InvalidDonation();
        if (totalDonated + amount > totalBudget) revert ExceedsTarget();
    }

    function _record(address donor, uint256 amount, bytes32 orderId) private {
        totalDonated += uint128(amount);
        contributions[donor] += amount;
        unchecked { ++donationCount; }
        uint256 id = receipt.mint(donor, amount, orderId);
        emit DonationRecorded(donor, amount, orderId, id);
    }

    // ------------------------------------------------------------------ withdrawals

    /// @notice NGO mengajukan pencairan untuk milestone tertentu disertai bukti (file di IPFS).
    /// @param proofHash keccak256 dari isi file bukti; ditolak bila pernah dipakai di campaign mana pun.
    function requestWithdrawal(uint256 milestone, uint256 amount, bytes32 proofHash, string calldata proofCID)
        external onlyNgo inState(State.Active) returns (uint256 id)
    {
        if (milestone >= _milestones.length || amount == 0) revert InvalidWithdrawal();
        if (proofHash == bytes32(0) || bytes(proofCID).length == 0) revert InvalidProof();
        Milestone storage m = _milestones[milestone];
        if (m.paid + m.reserved + amount > m.budget) revert ExceedsMilestone();
        if (reserved + amount > token.balanceOf(address(this))) revert InsufficientEscrow();
        m.reserved += uint128(amount);
        reserved += uint128(amount);
        id = _withdrawals.length;
        _withdrawals.push(Withdrawal(uint128(amount), uint32(milestone), 0, 0, WStatus.Pending, uint40(block.timestamp), proofHash));
        emit WithdrawalRequested(id, milestone, amount, proofHash, proofCID);
        factory.consumeProof(proofHash); // interaksi terakhir (CEI); revert DuplicateProof membatalkan seluruh state
    }

    function approveWithdrawal(uint256 id) external onlyApprover inState(State.Active) {
        Withdrawal storage w = _pendingVote(id);
        votes[id][msg.sender] = 1;
        unchecked { ++w.approvals; }
        emit WithdrawalApproved(id, msg.sender);
        if (w.approvals >= threshold) { w.status = WStatus.Approved; emit WithdrawalClosed(id, WStatus.Approved); }
    }

    /// @notice Bila jumlah penolakan membuat kuorum mustahil tercapai, pengajuan otomatis ditolak
    ///         dan dana yang dicadangkan dilepas kembali.
    function rejectWithdrawal(uint256 id, string calldata reason) external onlyApprover inState(State.Active) {
        Withdrawal storage w = _pendingVote(id);
        votes[id][msg.sender] = 2;
        unchecked { ++w.rejections; }
        emit WithdrawalRejected(id, msg.sender, reason);
        if (w.rejections > approverCount - threshold) _close(id, w, WStatus.Rejected);
    }

    function cancelWithdrawal(uint256 id) external onlyNgo {
        if (id >= _withdrawals.length) revert InvalidWithdrawal();
        Withdrawal storage w = _withdrawals[id];
        if (w.status != WStatus.Pending && w.status != WStatus.Approved) revert InvalidState();
        _close(id, w, WStatus.Cancelled);
    }

    /// @notice Mengeksekusi pencairan yang telah mencapai kuorum. Dana SELALU dikirim ke recipient terdaftar.
    function executeWithdrawal(uint256 id) external nonReentrant inState(State.Active) {
        if (msg.sender != ngo && !isApprover[msg.sender]) revert Unauthorized();
        if (id >= _withdrawals.length) revert InvalidWithdrawal();
        Withdrawal storage w = _withdrawals[id];
        if (w.status != WStatus.Approved) revert InvalidState();
        w.status = WStatus.Executed;
        uint128 amount = w.amount;
        Milestone storage m = _milestones[w.milestone];
        m.reserved -= amount; m.paid += amount;
        reserved -= amount; totalPaid += amount;
        if (totalPaid == totalBudget) { state = State.Completed; emit Completed(); }
        emit WithdrawalExecuted(id, recipient, amount);
        token.safeTransfer(recipient, amount);
    }

    /// @notice Bukti penyaluran setelah dana diterima (foto distribusi, kuitansi vendor, dll).
    function submitReport(uint256 withdrawalId, bytes32 proofHash, string calldata proofCID) external {
        if (msg.sender != ngo && msg.sender != recipient) revert Unauthorized();
        if (withdrawalId >= _withdrawals.length || _withdrawals[withdrawalId].status != WStatus.Executed) revert InvalidWithdrawal();
        if (proofHash == bytes32(0) || bytes(proofCID).length == 0) revert InvalidProof();
        emit ReportSubmitted(withdrawalId, msg.sender, proofHash, proofCID);
        factory.consumeProof(proofHash);
    }

    // ------------------------------------------------------------------ refund

    /// @notice Siapa pun dapat memicu refund untuk `donor`, tetapi dana selalu dikirim ke `donor` itu sendiri.
    function claimRefund(address donor) external nonReentrant inState(State.Cancelled) {
        uint256 c = contributions[donor];
        if (c == 0 || refunded[donor] || refundBase == 0) revert NothingToRefund();
        refunded[donor] = true;
        uint256 amount = c * refundPool / refundBase;
        if (amount == 0) revert NothingToRefund();
        emit Refunded(donor, amount);
        token.safeTransfer(donor, amount);
    }

    // ------------------------------------------------------------------ internal

    function _pendingVote(uint256 id) private view returns (Withdrawal storage w) {
        if (id >= _withdrawals.length) revert InvalidWithdrawal();
        w = _withdrawals[id];
        if (w.status != WStatus.Pending) revert InvalidState();
        if (votes[id][msg.sender] != 0) revert AlreadyVoted();
    }

    function _close(uint256 id, Withdrawal storage w, WStatus status) private {
        w.status = status;
        _milestones[w.milestone].reserved -= w.amount;
        reserved -= w.amount;
        emit WithdrawalClosed(id, status);
    }

    // ------------------------------------------------------------------ views

    function summary() external view returns (Summary memory s) {
        s.ngo = ngo; s.recipient = recipient; s.state = state; s.deadline = deadline;
        s.threshold = threshold; s.approverCount = approverCount;
        s.totalBudget = totalBudget; s.totalDonated = totalDonated; s.totalPaid = totalPaid; s.reserved = reserved;
        s.balance = token.balanceOf(address(this)); s.donationCount = donationCount;
        s.milestoneCount = _milestones.length; s.withdrawalCount = _withdrawals.length; s.metadataCID = metadataCID;
    }

    function getMilestones() external view returns (Milestone[] memory) { return _milestones; }
    function getWithdrawals() external view returns (Withdrawal[] memory) { return _withdrawals; }
    function getApprovers() external view returns (address[] memory) { return _approvers; }
    function milestones(uint256 i) external view returns (Milestone memory) { return _milestones[i]; }
    function withdrawals(uint256 i) external view returns (Withdrawal memory) { return _withdrawals[i]; }

    function refundableOf(address donor) external view returns (uint256) {
        if (state != State.Cancelled || refunded[donor] || refundBase == 0) return 0;
        return contributions[donor] * refundPool / refundBase;
    }
}
