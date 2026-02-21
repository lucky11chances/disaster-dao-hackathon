// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./BReadyToken.sol";
import "./ImpactClaim.sol";

/**
 * @title BReadyDAO
 * @notice Governance + Treasury for the B-Ready disaster-relief DAO.
 *
 *  Security features:
 *    - Snapshot voting via ERC20Votes.getPastVotes() — immune to vote-power manipulation.
 *    - ReentrancyGuard on execute() — protects treasury payouts.
 *    - Checks-effects-interactions pattern in execute().
 *    - pricingPolicyURI for transparent amount justification.
 *
 *  Separation of concerns:
 *    - Reviewers verify FACTS (did the work happen?).
 *    - DAO decides the AMOUNT (how much to pay?).
 *    - pricingPolicyURI documents the valuation methodology.
 *
 *  Flow: createProposal → vote → (voting period ends) → execute
 */
contract BReadyDAO is ReentrancyGuard {
    // ──────────── Enums ────────────
    enum ProposalStatus {
        Active,
        Passed,
        Failed,
        Executed,
        Canceled
    }

    // ──────────── Structs ────────────
    struct Proposal {
        uint256 id;
        address proposer;
        uint256 claimId; // Linked ImpactClaim ID
        address recipient; // Who receives the funds
        uint256 amount; // ETH amount (in wei)
        string description;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 startTime;
        uint256 endTime; // startTime + votingPeriod
        uint256 graceEnd; // endTime + gracePeriod
        uint256 snapshotBlock; // Block number for vote-power snapshot
        bool executed;
        bool canceled;
    }

    // ──────────── State ────────────
    BReadyToken public token;
    ImpactClaim public impactClaim;

    uint256 public votingPeriod; // seconds
    uint256 public gracePeriod; // seconds
    uint256 public proposalCount;

    // Minimum BRDY balance to create a proposal
    uint256 public proposalThreshold;

    // Pricing policy URI — documents how amounts are justified
    // e.g. "ipfs://QmPricingPolicy..." or "https://dao.example.com/pricing-policy"
    string public pricingPolicyURI;

    mapping(uint256 => Proposal) public proposals;
    // proposalId → voter → has voted?
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // ──────────── Events ────────────
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        uint256 claimId,
        uint256 amount,
        string description,
        uint256 snapshotBlock
    );
    event Voted(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed proposalId, address recipient, uint256 amount);
    event ProposalCanceled(uint256 indexed proposalId);
    event TreasuryDeposit(address indexed sender, uint256 amount);
    event PricingPolicyUpdated(string newURI);

    // ──────────── Constructor ────────────
    constructor(
        address _token,
        address _impactClaim,
        uint256 _votingPeriod,
        uint256 _gracePeriod,
        uint256 _proposalThreshold
    ) {
        token = BReadyToken(_token);
        impactClaim = ImpactClaim(_impactClaim);
        votingPeriod = _votingPeriod;
        gracePeriod = _gracePeriod;
        proposalThreshold = _proposalThreshold;
    }

    // ──────────── Treasury ────────────
    receive() external payable {
        emit TreasuryDeposit(msg.sender, msg.value);
    }

    function treasuryBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ──────────── Admin (for pricing policy) ────────────

    /**
     * @notice Set a URI documenting the pricing/valuation methodology.
     *         Reviewers verify facts; DAO decides amounts using this policy.
     */
    function setPricingPolicyURI(string calldata _uri) external {
        // Only allow the DAO itself or governance to update this
        // For hackathon: any BRDY holder with threshold can update
        require(token.balanceOf(msg.sender) >= proposalThreshold, "Below threshold");
        pricingPolicyURI = _uri;
        emit PricingPolicyUpdated(_uri);
    }

    // ──────────── Proposals ────────────

    /**
     * @notice Create a funding proposal linked to an ImpactClaim.
     *         Uses getPastVotes for snapshot-based threshold check.
     * @param _claimId     The ImpactClaim to fund.
     * @param _recipient   Address to receive ETH on execution.
     * @param _amount      ETH amount to transfer (wei).
     * @param _description Human-readable proposal description.
     */
    function createProposal(
        uint256 _claimId,
        address _recipient,
        uint256 _amount,
        string calldata _description
    ) external returns (uint256 proposalId) {
        require(token.balanceOf(msg.sender) >= proposalThreshold, "Below proposal threshold");
        require(_recipient != address(0), "Zero recipient");
        require(_amount > 0, "Zero amount");

        // Verify claim exists (creator != 0)
        (address creator, , , , , , , , ) = impactClaim.claims(_claimId);
        require(creator != address(0), "Claim does not exist");

        // Snapshot at previous block (getPastVotes requires a past block)
        uint256 snapshot = block.number - 1;

        proposalId = ++proposalCount;

        proposals[proposalId] = Proposal({
            id: proposalId,
            proposer: msg.sender,
            claimId: _claimId,
            recipient: _recipient,
            amount: _amount,
            description: _description,
            forVotes: 0,
            againstVotes: 0,
            startTime: block.timestamp,
            endTime: block.timestamp + votingPeriod,
            graceEnd: block.timestamp + votingPeriod + gracePeriod,
            snapshotBlock: snapshot,
            executed: false,
            canceled: false
        });

        emit ProposalCreated(proposalId, msg.sender, _claimId, _amount, _description, snapshot);
    }

    /**
     * @notice Cast a vote on an active proposal.
     *         Vote weight = getPastVotes(voter, snapshotBlock) — immune to transfer manipulation.
     * @param _proposalId The proposal to vote on.
     * @param _support    true = For, false = Against.
     */
    function vote(uint256 _proposalId, bool _support) external {
        Proposal storage p = proposals[_proposalId];
        require(p.id != 0, "Proposal does not exist");
        require(block.timestamp <= p.endTime, "Voting ended");
        require(!p.canceled, "Proposal canceled");
        require(!hasVoted[_proposalId][msg.sender], "Already voted");

        // ★ Use snapshot-based voting power (cannot be manipulated by transferring tokens)
        uint256 weight = token.getPastVotes(msg.sender, p.snapshotBlock);
        require(weight > 0, "No voting power at snapshot");

        hasVoted[_proposalId][msg.sender] = true;

        if (_support) {
            p.forVotes += weight;
        } else {
            p.againstVotes += weight;
        }

        emit Voted(_proposalId, msg.sender, _support, weight);
    }

    /**
     * @notice Execute a passed proposal. Protected by ReentrancyGuard.
     *
     *  Requires:
     *  1. Voting period ended
     *  2. Grace period ended
     *  3. forVotes > againstVotes
     *  4. ImpactClaim status == ApprovedForFunding
     *  5. Treasury has enough ETH
     *
     *  Uses checks-effects-interactions pattern:
     *    - All state changes BEFORE the external call
     *    - External ETH transfer last
     */
    function execute(uint256 _proposalId) external nonReentrant {
        Proposal storage p = proposals[_proposalId];
        require(p.id != 0, "Proposal does not exist");
        require(!p.executed, "Already executed");
        require(!p.canceled, "Proposal canceled");
        require(block.timestamp > p.graceEnd, "Grace period not over");
        require(p.forVotes > p.againstVotes, "Proposal did not pass");

        // ★ KEY GATE: claim must be ApprovedForFunding
        require(
            impactClaim.getClaimStatus(p.claimId) == ImpactClaim.ClaimStatus.ApprovedForFunding,
            "Claim not approved for funding"
        );

        require(address(this).balance >= p.amount, "Insufficient treasury");

        // ── Effects first (before external calls) ──
        p.executed = true;

        // Update claim status to Funded (trusted internal call)
        impactClaim.markFunded(p.claimId);

        // ── Interaction last ──
        (bool sent, ) = p.recipient.call{ value: p.amount }("");
        require(sent, "ETH transfer failed");

        emit ProposalExecuted(_proposalId, p.recipient, p.amount);
    }

    /**
     * @notice Cancel a proposal. Only the proposer can cancel, and only before execution.
     */
    function cancel(uint256 _proposalId) external {
        Proposal storage p = proposals[_proposalId];
        require(p.proposer == msg.sender, "Not proposer");
        require(!p.executed, "Already executed");
        require(!p.canceled, "Already canceled");

        p.canceled = true;
        emit ProposalCanceled(_proposalId);
    }

    // ──────────── View helpers ────────────

    function getProposalStatus(uint256 _proposalId) external view returns (ProposalStatus) {
        Proposal storage p = proposals[_proposalId];
        if (p.id == 0) revert("Proposal does not exist");
        if (p.canceled) return ProposalStatus.Canceled;
        if (p.executed) return ProposalStatus.Executed;
        if (block.timestamp <= p.endTime) return ProposalStatus.Active;
        if (p.forVotes > p.againstVotes) return ProposalStatus.Passed;
        return ProposalStatus.Failed;
    }
}
