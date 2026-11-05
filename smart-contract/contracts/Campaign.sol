// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./DonationToken.sol";
import "./DonationReceipt.sol";

contract Campaign is ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum State { Pending, Active, Completed }
    struct Milestone { uint256 budget; uint256 paid; uint256 reserved; }
    struct Withdrawal { uint256 milestone; uint256 amount; uint256 approvals; bool executed; }

    DonationToken public immutable token;
    DonationReceipt public immutable receipt;
    address public immutable ngo;
    address public immutable recipient;
    address public immutable verifier;
    address public immutable oracle;
    uint256 public immutable threshold;
    State public state;
    uint256 public totalDonated;
    uint256 public totalPaid;
    uint256 public totalBudget;
    uint256 public reserved;
    mapping(address => bool) public isApprover;
    mapping(uint256 => mapping(address => bool)) public approved;
    Milestone[] public milestones;
    Withdrawal[] public withdrawals;

    event Activated();
    event DonationRecorded(address indexed donor, uint256 amount, bytes32 indexed orderId, uint256 receiptId);
    event WithdrawalRequested(uint256 indexed id, uint256 indexed milestone, uint256 amount);
    event WithdrawalApproved(uint256 indexed id, address indexed approver);
    event WithdrawalExecuted(uint256 indexed id, address indexed recipient, uint256 amount);
    event Completed();

    constructor(address token_, address receipt_, address ngo_, address recipient_, address verifier_,
        address oracle_, address[] memory approvers, uint256 threshold_, uint256[] memory budgets) {
        require(token_ != address(0) && receipt_ != address(0) && ngo_ != address(0) &&
            recipient_ != address(0) && verifier_ != address(0) && oracle_ != address(0), "Zero address");
        require(threshold_ > 0 && threshold_ <= approvers.length, "Invalid threshold");
        require(budgets.length > 0, "No milestones");
        for (uint256 i; i < approvers.length; ++i) {
            require(approvers[i] != address(0) && !isApprover[approvers[i]], "Invalid approver");
            isApprover[approvers[i]] = true;
        }
        for (uint256 i; i < budgets.length; ++i) {
            require(budgets[i] > 0, "Zero budget");
            milestones.push(Milestone(budgets[i], 0, 0));
            totalBudget += budgets[i];
        }
        token = DonationToken(token_); receipt = DonationReceipt(receipt_);
        ngo = ngo_; recipient = recipient_; verifier = verifier_; oracle = oracle_; threshold = threshold_;
    }

    function activate() external {
        require(msg.sender == verifier, "Only verifier");
        require(state == State.Pending, "Invalid state");
        state = State.Active;
        emit Activated();
    }

    function donate(uint256 amount) external nonReentrant {
        _validateDonation(msg.sender, amount);
        IERC20(address(token)).safeTransferFrom(msg.sender, address(this), amount);
        _record(msg.sender, amount, bytes32(0));
    }

    function recordFiatDonation(bytes32 orderId, address donor, uint256 amount) external nonReentrant {
        require(msg.sender == oracle, "Only oracle");
        require(orderId != bytes32(0), "Empty order");
        _validateDonation(donor, amount);
        IOrderRegistry(receipt.factory()).consumeOrder(orderId);
        token.mint(address(this), amount);
        _record(donor, amount, orderId);
    }

    function _validateDonation(address donor, uint256 amount) private view {
        require(state == State.Active, "Not active");
        require(donor != address(0) && amount > 0, "Invalid donation");
        require(totalDonated + amount <= totalBudget, "Exceeds target");
    }

    function _record(address donor, uint256 amount, bytes32 orderId) private {
        totalDonated += amount;
        uint256 id = receipt.mint(donor, amount, orderId);
        emit DonationRecorded(donor, amount, orderId, id);
    }

    function requestWithdrawal(uint256 milestone, uint256 amount) external returns (uint256 id) {
        require(msg.sender == ngo, "Only NGO");
        require(state == State.Active, "Not active");
        require(milestone < milestones.length && amount > 0, "Invalid withdrawal");
        Milestone storage m = milestones[milestone];
        require(m.paid + m.reserved + amount <= m.budget, "Exceeds milestone");
        require(reserved + amount <= token.balanceOf(address(this)), "Insufficient escrow");
        m.reserved += amount; reserved += amount;
        id = withdrawals.length;
        withdrawals.push(Withdrawal(milestone, amount, 0, false));
        emit WithdrawalRequested(id, milestone, amount);
    }

    function approveWithdrawal(uint256 id) external {
        require(isApprover[msg.sender], "Only approver");
        require(id < withdrawals.length, "Invalid withdrawal");
        Withdrawal storage w = withdrawals[id];
        require(!w.executed && !approved[id][msg.sender], "Already approved or executed");
        approved[id][msg.sender] = true; w.approvals++;
        emit WithdrawalApproved(id, msg.sender);
    }

    function executeWithdrawal(uint256 id) external nonReentrant {
        require(msg.sender == ngo, "Only NGO");
        require(id < withdrawals.length, "Invalid withdrawal");
        Withdrawal storage w = withdrawals[id];
        require(!w.executed, "Already executed");
        require(w.approvals >= threshold, "Insufficient approvals");
        w.executed = true;
        Milestone storage m = milestones[w.milestone];
        m.reserved -= w.amount; m.paid += w.amount; reserved -= w.amount; totalPaid += w.amount;
        IERC20(address(token)).safeTransfer(recipient, w.amount);
        emit WithdrawalExecuted(id, recipient, w.amount);
        if (totalPaid == totalBudget) { state = State.Completed; emit Completed(); }
    }
}

interface IOrderRegistry { function consumeOrder(bytes32 orderId) external; }
