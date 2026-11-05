// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract DonationReceipt is ERC721 {
    struct Receipt { address campaign; uint256 amount; bytes32 orderId; }
    address public immutable factory;
    uint256 public nextId;
    mapping(address => bool) public campaigns;
    mapping(uint256 => Receipt) public receipts;

    constructor(address factory_) ERC721("Donation Receipt", "DReceipt") {
        require(factory_ != address(0), "Zero factory");
        factory = factory_;
    }

    function registerCampaign(address campaign) external {
        require(msg.sender == factory, "Only factory");
        campaigns[campaign] = true;
    }

    function mint(address donor, uint256 amount, bytes32 orderId) external returns (uint256 id) {
        require(campaigns[msg.sender], "Only campaign");
        id = ++nextId;
        receipts[id] = Receipt(msg.sender, amount, orderId);
        _mint(donor, id);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        require(_ownerOf(tokenId) == address(0), "Soulbound");
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override { revert("Soulbound"); }
    function setApprovalForAll(address, bool) public pure override { revert("Soulbound"); }
}
