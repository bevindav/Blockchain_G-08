// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./Campaign.sol";

contract CampaignFactory is AccessControl {
    bytes32 public constant NGO_ROLE = keccak256("NGO_ROLE");
    DonationToken public immutable token;
    DonationReceipt public immutable receipt;
    address public immutable verifier;
    address public immutable oracle;
    address[] private approvers;
    uint256 public immutable threshold;
    address[] public campaigns;
    mapping(address => bool) public isCampaign;
    mapping(bytes32 => bool) public usedOrders;
    event CampaignCreated(address indexed campaign, address indexed ngo, address indexed recipient);

    constructor(address token_, address admin, address verifier_, address oracle_, address[] memory approvers_, uint256 threshold_) {
        require(token_ != address(0) && admin != address(0) && verifier_ != address(0) && oracle_ != address(0), "Zero address");
        require(threshold_ > 0 && threshold_ <= approvers_.length, "Invalid threshold");
        for (uint256 i; i < approvers_.length; ++i) {
            require(approvers_[i] != address(0), "Zero approver");
            for (uint256 j; j < i; ++j) require(approvers_[i] != approvers_[j], "Duplicate approver");
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        token = DonationToken(token_); verifier = verifier_; oracle = oracle_;
        approvers = approvers_; threshold = threshold_;
        receipt = new DonationReceipt(address(this));
    }

    function createCampaign(address recipient, uint256[] calldata budgets) external onlyRole(NGO_ROLE) returns (address) {
        Campaign campaign = new Campaign(address(token), address(receipt), msg.sender, recipient, verifier, oracle, approvers, threshold, budgets);
        address deployed = address(campaign);
        campaigns.push(deployed); isCampaign[deployed] = true;
        receipt.registerCampaign(deployed);
        token.grantRole(token.MINTER_ROLE(), deployed);
        emit CampaignCreated(deployed, msg.sender, recipient);
        return deployed;
    }

    function consumeOrder(bytes32 orderId) external {
        require(isCampaign[msg.sender], "Only campaign");
        require(!usedOrders[orderId], "Duplicate order");
        usedOrders[orderId] = true;
    }

    function campaignCount() external view returns (uint256) { return campaigns.length; }
}
