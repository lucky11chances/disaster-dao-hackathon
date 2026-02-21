// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./BReadyToken.sol";

/**
 * @title ImpactClaim
 * @notice ERC-1155 impact certificates (Hypercert-like) with built-in M-of-N evaluation.
 *
 *  Lifecycle:  Pending → ApprovedForFunding → Funded
 *
 *  - Claim creation requires a minimum BRDY balance (anti-spam).
 *  - Whitelisted reviewers submit on-chain evaluations (Pass/Fail).
 *  - When M out of N reviewers pass a claim, status becomes ApprovedForFunding.
 *  - The DAO calls markFunded() after successful payout.
 *
 *  Ownership should be transferred to BReadyDAO after deployment so that
 *  reviewer management and threshold changes are governed, not admin-controlled.
 */
contract ImpactClaim is ERC1155, Ownable {
    // ──────────── Enums ────────────
    enum ClaimStatus {
        Pending,
        ApprovedForFunding,
        Funded
    }

    // ──────────── Structs ────────────
    struct Claim {
        address creator; // The NGO / relief org that submitted the claim
        address recipient; // Address to receive funding
        string tokenURI; // IPFS / Arweave URI with metadata + evidence
        string impactScope; // e.g. "Flood relief - 12,000 meals delivered"
        uint64 impactStart; // Start timestamp of the impact period
        uint64 impactEnd; // End timestamp of the impact period
        ClaimStatus status;
        uint256 passCount; // Number of Pass evaluations
        uint256 totalEvals; // Total evaluations submitted
    }

    struct Evaluation {
        address reviewer;
        bool pass; // true = Pass, false = Fail
        string evidenceURI; // Optional evidence link
        uint256 timestamp;
    }

    // ──────────── State ────────────
    uint256 public nextClaimId = 1;
    uint256 public requiredPasses; // M — minimum passes needed

    mapping(uint256 => Claim) public claims;
    mapping(uint256 => Evaluation[]) public evaluations;
    mapping(address => bool) public isReviewer;

    // reviewer → claimId → already evaluated?
    mapping(address => mapping(uint256 => bool)) public hasEvaluated;

    // Authorised DAO address (can mark claims as Funded)
    address public dao;

    // Anti-spam: minimum BRDY balance to create a claim
    BReadyToken public token;
    uint256 public claimThreshold;

    // ──────────── Events ────────────
    event ClaimCreated(uint256 indexed claimId, address indexed creator, string impactScope, string tokenURI);
    event Evaluated(uint256 indexed claimId, address indexed reviewer, bool pass);
    event ClaimApproved(uint256 indexed claimId);
    event ClaimFunded(uint256 indexed claimId);
    event ReviewerAdded(address indexed reviewer);
    event ReviewerRemoved(address indexed reviewer);
    event ClaimThresholdUpdated(uint256 newThreshold);

    // ──────────── Modifiers ────────────
    modifier onlyReviewer() {
        require(isReviewer[msg.sender], "Not a whitelisted reviewer");
        _;
    }

    modifier onlyDAO() {
        require(msg.sender == dao, "Only DAO can call");
        _;
    }

    // ──────────── Constructor ────────────
    constructor(
        address _owner,
        uint256 _requiredPasses,
        address _token,
        uint256 _claimThreshold
    ) ERC1155("") Ownable(_owner) {
        requiredPasses = _requiredPasses;
        token = BReadyToken(_token);
        claimThreshold = _claimThreshold;
    }

    // ──────────── Admin (governed by DAO after ownership transfer) ────────────

    function setDAO(address _dao) external onlyOwner {
        dao = _dao;
    }

    function addReviewer(address _reviewer) external onlyOwner {
        isReviewer[_reviewer] = true;
        emit ReviewerAdded(_reviewer);
    }

    function removeReviewer(address _reviewer) external onlyOwner {
        isReviewer[_reviewer] = false;
        emit ReviewerRemoved(_reviewer);
    }

    function setRequiredPasses(uint256 _m) external onlyOwner {
        requiredPasses = _m;
    }

    function setClaimThreshold(uint256 _threshold) external onlyOwner {
        claimThreshold = _threshold;
        emit ClaimThresholdUpdated(_threshold);
    }

    // ──────────── Claim Lifecycle ────────────

    /**
     * @notice Mint a new impact claim.
     *         Requires caller to hold >= claimThreshold BRDY (anti-spam).
     * @param _recipient   Address to receive funding if approved.
     * @param _tokenURI    URI pointing to metadata + evidence (IPFS).
     * @param _impactScope Human-readable impact description.
     * @param _impactStart Start of the impact period (unix timestamp).
     * @param _impactEnd   End of the impact period (unix timestamp).
     * @return claimId     The ID of the newly minted claim.
     */
    function createClaim(
        address _recipient,
        string calldata _tokenURI,
        string calldata _impactScope,
        uint64 _impactStart,
        uint64 _impactEnd
    ) external returns (uint256 claimId) {
        require(token.balanceOf(msg.sender) >= claimThreshold, "Insufficient BRDY to create claim");
        require(_recipient != address(0), "Zero recipient");
        require(_impactEnd >= _impactStart, "Invalid time range");

        claimId = nextClaimId++;

        claims[claimId] = Claim({
            creator: msg.sender,
            recipient: _recipient,
            tokenURI: _tokenURI,
            impactScope: _impactScope,
            impactStart: _impactStart,
            impactEnd: _impactEnd,
            status: ClaimStatus.Pending,
            passCount: 0,
            totalEvals: 0
        });

        // Mint 1 SFT to the creator as a certificate
        _mint(msg.sender, claimId, 1, "");

        emit ClaimCreated(claimId, msg.sender, _impactScope, _tokenURI);
    }

    /**
     * @notice Submit an evaluation for a pending claim.
     * @param _claimId     The claim to evaluate.
     * @param _pass        true = Pass, false = Fail.
     * @param _evidenceURI Optional link to reviewer's evidence.
     */
    function evaluate(uint256 _claimId, bool _pass, string calldata _evidenceURI) external onlyReviewer {
        Claim storage c = claims[_claimId];
        require(c.creator != address(0), "Claim does not exist");
        require(c.status == ClaimStatus.Pending, "Claim not pending");
        require(!hasEvaluated[msg.sender][_claimId], "Already evaluated");

        hasEvaluated[msg.sender][_claimId] = true;

        evaluations[_claimId].push(
            Evaluation({ reviewer: msg.sender, pass: _pass, evidenceURI: _evidenceURI, timestamp: block.timestamp })
        );

        c.totalEvals++;
        if (_pass) {
            c.passCount++;
        }

        emit Evaluated(_claimId, msg.sender, _pass);

        // Check M-of-N threshold
        if (c.passCount >= requiredPasses) {
            c.status = ClaimStatus.ApprovedForFunding;
            emit ClaimApproved(_claimId);
        }
    }

    /**
     * @notice Mark a claim as Funded. Only callable by the DAO contract.
     * @param _claimId The claim that has been funded.
     */
    function markFunded(uint256 _claimId) external onlyDAO {
        Claim storage c = claims[_claimId];
        require(c.status == ClaimStatus.ApprovedForFunding, "Not approved");
        c.status = ClaimStatus.Funded;
        emit ClaimFunded(_claimId);
    }

    // ──────────── View helpers ────────────

    function getClaimStatus(uint256 _claimId) external view returns (ClaimStatus) {
        return claims[_claimId].status;
    }

    function getEvaluationCount(uint256 _claimId) external view returns (uint256) {
        return evaluations[_claimId].length;
    }

    function getEvaluation(uint256 _claimId, uint256 _index) external view returns (Evaluation memory) {
        return evaluations[_claimId][_index];
    }

    function uri(uint256 _claimId) public view override returns (string memory) {
        return claims[_claimId].tokenURI;
    }
}
