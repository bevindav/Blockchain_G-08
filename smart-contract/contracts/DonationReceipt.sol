// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @title DonationReceipt - kuitansi donasi ERC-721 soulbound (ERC-5192)
/// @notice Metadata dan gambar kuitansi dibangkitkan sepenuhnya on-chain sehingga tidak bergantung pada
///         server mana pun dan tidak dapat diubah. Kuitansi fiat dapat dicari lewat hash order id.
contract DonationReceipt is ERC721 {
    using Strings for uint256;
    using Strings for address;

    /// @dev Dipacking: 20 + 8 byte (slot 1), 16 byte (slot 2), 32 byte (slot 3).
    struct Receipt { address campaign; uint64 timestamp; uint128 amount; bytes32 orderId; }

    address public immutable factory;
    uint256 public nextId;
    mapping(address => bool) public campaigns;
    mapping(uint256 => Receipt) public receipts;
    mapping(bytes32 => uint256) public receiptOfOrder;

    /// @dev ERC-5192 minimal soulbound
    event Locked(uint256 tokenId);

    error OnlyFactory();
    error OnlyCampaign();
    error Soulbound();
    error ZeroAddress();

    constructor(address factory_) ERC721("Donation Receipt", "DRCPT") {
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
    }

    function registerCampaign(address campaign) external {
        if (msg.sender != factory) revert OnlyFactory();
        campaigns[campaign] = true;
    }

    function mint(address donor, uint256 amount, bytes32 orderId) external returns (uint256 id) {
        if (!campaigns[msg.sender]) revert OnlyCampaign();
        id = ++nextId;
        receipts[id] = Receipt(msg.sender, uint64(block.timestamp), uint128(amount), orderId);
        if (orderId != bytes32(0)) receiptOfOrder[orderId] = id;
        _mint(donor, id);
        emit Locked(id);
    }

    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0xb45a3c0e || super.supportsInterface(interfaceId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        address owner = _requireOwned(tokenId);
        Receipt memory r = receipts[tokenId];
        string memory kind = r.orderId == bytes32(0) ? "dIDR (MetaMask)" : "Rupiah (Payment Gateway)";
        bytes memory head = abi.encodePacked(
            '{"name":"Kuitansi Donasi #', tokenId.toString(),
            '","description":"Kuitansi donasi soulbound yang diterbitkan otomatis oleh smart contract.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(_svg(tokenId, r, kind))), '",'
        );
        bytes memory attrs = abi.encodePacked(
            '"attributes":[{"trait_type":"Campaign","value":"', r.campaign.toHexString(),
            '"},{"trait_type":"Donor","value":"', owner.toHexString(),
            '"},{"trait_type":"Amount (IDR)","display_type":"number","value":', uint256(r.amount).toString()
        );
        bytes memory tail = abi.encodePacked(
            '},{"trait_type":"Channel","value":"', kind,
            '"},{"trait_type":"Timestamp","display_type":"date","value":', uint256(r.timestamp).toString(), '}]}'
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes.concat(head, attrs, tail))));
    }

    function _svg(uint256 tokenId, Receipt memory r, string memory kind) private pure returns (string memory) {
        bytes memory a = abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240">',
            '<rect width="400" height="240" rx="16" fill="#0f766e"/>',
            '<text x="24" y="44" fill="#fff" font-family="sans-serif" font-size="20" font-weight="bold">Kuitansi Donasi #',
            tokenId.toString(), '</text>'
        );
        bytes memory b = abi.encodePacked(
            '<text x="24" y="96" fill="#ccfbf1" font-family="sans-serif" font-size="14">Nominal</text>',
            '<text x="24" y="126" fill="#fff" font-family="sans-serif" font-size="28" font-weight="bold">Rp ',
            uint256(r.amount).toString(), '</text>'
        );
        bytes memory c = abi.encodePacked(
            '<text x="24" y="168" fill="#ccfbf1" font-family="monospace" font-size="10">Campaign ',
            r.campaign.toHexString(), '</text>',
            '<text x="24" y="210" fill="#ccfbf1" font-family="sans-serif" font-size="12">', kind, ' - soulbound</text></svg>'
        );
        return string(bytes.concat(a, b, c));
    }

    /// @dev Hanya mint (from == 0) yang diizinkan; transfer & burn ditolak.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override { revert Soulbound(); }
    function setApprovalForAll(address, bool) public pure override { revert Soulbound(); }
}
