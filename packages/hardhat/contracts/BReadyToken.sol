// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BReadyToken (BRDY)
 * @notice ERC-20 governance token for the B-Ready DAO with vote checkpointing.
 *
 *  Uses OpenZeppelin ERC20Votes for snapshot-safe voting:
 *    - Each transfer automatically creates a checkpoint.
 *    - DAO reads getPastVotes(voter, snapshotBlock) to prevent vote-power manipulation.
 *    - Holders MUST delegate to themselves (or another address) to activate voting power.
 *
 *  1 BRDY = 1 vote in DAO proposals.
 *  Owner can mint; ownership can be transferred to BReadyDAO after deployment.
 */
contract BReadyToken is ERC20, ERC20Permit, ERC20Votes, Ownable {
    constructor(
        address _initialOwner,
        uint256 _initialSupply
    ) ERC20("B-Ready", "BRDY") ERC20Permit("B-Ready") Ownable(_initialOwner) {
        _mint(_initialOwner, _initialSupply);
        // Auto-delegate deployer so they have voting power immediately
        _delegate(_initialOwner, _initialOwner);
    }

    /**
     * @notice Mint new BRDY tokens. Only callable by owner (the DAO after setup).
     * @param to     Recipient address
     * @param amount Amount to mint (in wei)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from caller's balance.
     * @param amount Amount to burn (in wei)
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    // ──────────── Required overrides for ERC20 + ERC20Votes ────────────

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    function nonces(address owner_) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner_);
    }
}
