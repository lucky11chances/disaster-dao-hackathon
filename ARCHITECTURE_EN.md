# Disaster DAO — Architecture Deep Dive

## 1. The Problem We Solve

Traditional disaster relief funding is broken:

| Problem | Description |
|---------|-------------|
| **Opaque Fund Allocation** | Donors have no visibility into how funds are spent |
| **No Impact Verification** | Relief orgs self-report impact with no neutral verification |
| **Centralized Decision-Making** | A few executives decide which crises get priority |

**Disaster DAO** fixes this with a transparent, verifiable, community-governed system where impact is **proven on-chain before money moves**.

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Disaster DAO System                      │
│                                                               │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ BReadyToken  │  │   ImpactClaim    │  │   BReadyDAO    │  │
│  │  (ERC-20 +   │  │   (ERC-1155)     │  │  (Governance)  │  │
│  │  ERC20Votes) │  │                  │  │                │  │
│  │              │  │ • createClaim()  │  │ • createProp() │  │
│  │ • mint()     │  │   (BRDY-gated)  │  │ • vote()       │  │
│  │ • delegate() │  │ • evaluate()     │  │   (snapshot)   │  │
│  │ • getVotes() │  │ • markFunded()   │  │ • execute()    │  │
│  │ • getPast    │  │                  │  │   (nonReentrant│  │
│  │   Votes()   │  │ Pending →        │  │ • cancel()     │  │
│  │              │  │ Approved →       │  │                │  │
│  │ 1 BRDY =     │  │ Funded           │  │ Treasury:      │  │
│  │ 1 Vote       │  │                  │  │ receive() ETH  │  │
│  └──────┬───────┘  └──────┬───────────┘  └──────┬─────────┘  │
│         │                 │                      │            │
│         │  getPastVotes   │  checks status       │            │
│         │◄────────────────┤  before execute()    │            │
│         │  for vote weight│◄─────────────────────┤            │
│         │  at snapshot    │  calls markFunded()  │            │
│         │                 │◄─────────────────────┤            │
└─────────┴─────────────────┴──────────────────────┴────────────┘
```

### Key Interactions

1. **BReadyDAO → BReadyToken**: Uses `getPastVotes(voter, snapshotBlock)` for tamper-proof vote weight; checks `balanceOf(proposer) >= threshold` for proposals
2. **BReadyDAO → ImpactClaim**: Checks `getClaimStatus() == ApprovedForFunding` before execute; calls `markFunded()` after payout
3. **ImpactClaim → BReadyToken**: Checks `balanceOf(creator) >= claimThreshold` before allowing claim creation (anti-spam)
4. **ImpactClaim ownership**: Transferred to BReadyDAO (Disaster DAO) after deployment — reviewer management is governed, not admin-controlled

---

## 3. Contract #1: BReadyToken (BRDY)

**File:** `contracts/BReadyToken.sol` | **Standard:** ERC-20 + ERC20Votes + ERC20Permit

| Feature | Detail |
|---------|--------|
| **Name / Symbol** | B-Ready / BRDY |
| **Initial Supply** | 1,000,000 BRDY minted to deployer |
| **Mint** | `onlyOwner` — can be transferred to DAO for governance-controlled minting |
| **Burn** | Any holder can burn their own tokens |
| **Vote Checkpointing** | Inherits `ERC20Votes` — every transfer creates a checkpoint |
| **Snapshot Voting** | `getPastVotes(voter, blockNumber)` returns historical voting power |
| **Self-Delegation** | Holders must `delegate(self)` to activate voting power. Constructor auto-delegates deployer. |
| **Permit** | Gasless approvals via ERC20Permit (EIP-2612) |

### Why ERC20Votes? (Security Fix)

Without checkpointing, `balanceOf(voter)` at vote-time is unsafe:
- Attacker buys 1M BRDY → votes on Proposal A → transfers to alt account → votes again on same proposal from another address
- Or: attacker votes, then sells tokens, effectively "free voting"

**ERC20Votes** stores checkpoints on every transfer. `getPastVotes(voter, snapshotBlock)` reads the voter's balance *at the block the proposal was created* — immune to manipulation.

```solidity
// In BReadyDAO.vote():
uint256 weight = token.getPastVotes(msg.sender, p.snapshotBlock);
// snapshotBlock = block.number - 1 at proposal creation time
```

### Token Distribution

At deployment, 1M BRDY goes to the deployer (auto-delegated) who distributes to founding DAO members. Recipients must call `delegate(self)` to activate their voting power.

---

## 4. Contract #2: ImpactClaim (Hypercert)

**File:** `contracts/ImpactClaim.sol` | **Standard:** ERC-1155

This is where **Hypercerts** are applied. Each impact claim is an on-chain certificate representing work done during disaster relief.

### Claim Structure

```solidity
struct Claim {
    address creator;       // NGO that submitted the claim
    address recipient;     // Address to receive funding
    string  tokenURI;      // IPFS URI → photos, receipts, delivery logs
    string  impactScope;   // "Flood relief - 12,000 meals delivered"
    uint64  impactStart;   // Start of impact period
    uint64  impactEnd;     // End of impact period
    ClaimStatus status;    // Pending → ApprovedForFunding → Funded
    uint256 passCount;     // Number of Pass evaluations
    uint256 totalEvals;    // Total evaluations
}
```

### Claim Lifecycle

```
   ┌──────────┐   M reviewers pass   ┌────────────────────┐   DAO executes   ┌─────────┐
   │ Pending  │ ──────────────────▶  │ ApprovedForFunding │ ──────────────▶  │ Funded  │
   └──────────┘                      └────────────────────┘                  └─────────┘
```

### Anti-Spam: BRDY-Gated Claim Creation

`createClaim()` requires `token.balanceOf(msg.sender) >= claimThreshold`. This prevents spam flooding that would overwhelm reviewers and the DAO.

```solidity
require(token.balanceOf(msg.sender) >= claimThreshold, "Insufficient BRDY to create claim");
```

Default threshold: 1 BRDY. Configurable via `setClaimThreshold()` (governed by DAO after ownership transfer).

### M-of-N Evaluation System

- **M** = `requiredPasses` (e.g., 2)
- **N** = number of whitelisted reviewers
- Each reviewer evaluates exactly once per claim (Pass/Fail + optional evidence URI)
- When `passCount >= M` → status becomes `ApprovedForFunding`

### Governed Admin Functions

After deployment, **ownership is transferred to BReadyDAO**. This means:

| Function | Before Transfer | After Transfer |
|----------|----------------|----------------|
| `addReviewer()` | Deployer calls directly | Requires DAO proposal + vote |
| `removeReviewer()` | Deployer calls directly | Requires DAO proposal + vote |
| `setRequiredPasses()` | Deployer calls directly | Requires DAO proposal + vote |
| `setClaimThreshold()` | Deployer calls directly | Requires DAO proposal + vote |

### How Hypercerts Are Applied

| Hypercert Concept | Our Implementation |
|-------------------|-------------------|
| Work Scope | `impactScope` — human-readable description |
| Time Range | `impactStart` / `impactEnd` — unix timestamps |
| Evidence | `tokenURI` — IPFS link to photos, receipts |
| Creator | `creator` — NGO's Ethereum address |
| Beneficiary | `recipient` — funding destination |
| Verification | **M-of-N on-chain evaluation** (our enhancement!) |
| Certificate | ERC-1155 token minted to the creator |

**Our Enhancement:** Standard Hypercerts are self-reported. We add an M-of-N review layer so claims must be independently verified before becoming eligible for funding.

---

## 5. Contract #3: BReadyDAO (Governance + Treasury)

**File:** `contracts/BReadyDAO.sol` | **Inherits:** `ReentrancyGuard`

### Proposal Structure

```solidity
struct Proposal {
    uint256 id;
    address proposer;
    uint256 claimId;        // ★ Linked to an ImpactClaim
    address recipient;      // Who receives ETH
    uint256 amount;         // ETH amount (wei)
    string  description;
    uint256 forVotes;       // Total BRDY voting "for"
    uint256 againstVotes;   // Total BRDY voting "against"
    uint256 startTime;
    uint256 endTime;        // startTime + votingPeriod
    uint256 graceEnd;       // endTime + gracePeriod
    uint256 snapshotBlock;  // ★ Block for getPastVotes snapshot
    bool    executed;
    bool    canceled;
}
```

### Snapshot Voting

When a proposal is created, `snapshotBlock = block.number - 1` is stored. All votes use this snapshot:

```solidity
// In createProposal():
uint256 snapshot = block.number - 1;

// In vote():
uint256 weight = token.getPastVotes(msg.sender, p.snapshotBlock);
```

This means transferring tokens after a proposal is created **has zero effect on voting power** for that proposal.

### The Execute Gate — With ReentrancyGuard

```solidity
function execute(uint256 _proposalId) external nonReentrant {
    // ── Checks ──
    require(!p.executed, "Already executed");
    require(!p.canceled, "Proposal canceled");
    require(block.timestamp > p.graceEnd, "Grace period not over");
    require(p.forVotes > p.againstVotes, "Did not pass");
    // ★★★ THE KEY GATE ★★★
    require(impactClaim.getClaimStatus(p.claimId) == ApprovedForFunding);
    require(address(this).balance >= p.amount, "Insufficient treasury");

    // ── Effects (before external call) ──
    p.executed = true;
    impactClaim.markFunded(p.claimId);

    // ── Interaction (last) ──
    (bool sent, ) = p.recipient.call{value: p.amount}("");
    require(sent, "ETH transfer failed");
}
```

**Three layers of protection:**
1. `nonReentrant` modifier from OpenZeppelin's `ReentrancyGuard`
2. Checks-effects-interactions pattern: `p.executed = true` set **before** the ETH transfer
3. Return value checked: `require(sent, "ETH transfer failed")`

### Pricing Policy

**Separation of concerns:**
- **Reviewers** verify **facts** — "did this NGO deliver 15,000L of water?"
- **DAO** decides the **amount** — "how much ETH should we pay for this?"
- `pricingPolicyURI` documents the valuation methodology (e.g., an IPFS document explaining cost-per-meal, cost-per-liter, etc.)

```solidity
string public pricingPolicyURI;
function setPricingPolicyURI(string calldata _uri) external { ... }
```

### Treasury

- DAO contract holds ETH directly
- Anyone deposits via `receive()` — **no admin withdrawal exists**
- ETH only exits through `execute()` after full verification + vote + reentrancy protection

### Voting Rules

| Rule | Value |
|------|-------|
| Vote weight | `getPastVotes(voter, snapshotBlock)` — snapshot-safe |
| Voting period | 5 minutes (demo; configurable) |
| Grace period | 2 minutes after voting ends |
| Proposal threshold | Must hold BRDY to create proposals |
| Double-vote prevention | `hasVoted` mapping |

---

## 6. Full Example: Hurricane Luna

### Background

Hurricane Luna hits Puerto Vida on Feb 1, 2026. 50,000 displaced. The Disaster DAO has 5 BRDY holders (200K each, all self-delegated), 3 reviewers, and 10 ETH in treasury. `requiredPasses = 2`.

### Step 1: Fund Treasury

Donors send ETH: Frank (5 ETH) + Grace (3 ETH) + Harry (2 ETH) → **Treasury: 20 ETH**

### Step 2: NGO Submits Impact Claim (BRDY-gated)

WaterFirst NGO holds 100 BRDY (above `claimThreshold`). They delivered 15,000L of clean water (Feb 2-7):

```
ImpactClaim.createClaim(
    recipient:    0xWaterFirst,
    tokenURI:     "ipfs://QmEvidence...",   // 47 photos, 12 receipts, 3,200 signatures
    impactScope:  "Hurricane Luna - 15,000L clean water to 4 shelters",
    impactStart:  Feb 2,
    impactEnd:    Feb 7
)
→ ✅ BRDY balance check passed
→ Claim #1 created (status: Pending)
→ WaterFirst receives ERC-1155 token #1
```

### Step 3: Reviewers Evaluate

```
Dr. Martinez (UNICEF):  evaluate(1, pass=true,  "ipfs://QmFieldReport...")
Sarah (Red Cross):      evaluate(1, pass=true,  "ipfs://QmVerification...")
→ passCount=2 >= requiredPasses=2
→ Claim #1 status → ApprovedForFunding ✅
```

### Step 4: Create Funding Proposal (with snapshot)

Alice (BRDY holder) creates a proposal at block #1000:

```
BReadyDAO.createProposal(
    claimId: 1,  recipient: 0xWaterFirst,
    amount: 3 ETH,  description: "Fund Claim #1 - 15K liters clean water"
)
→ Proposal #1 created
→ snapshotBlock = 999 (block.number - 1)
→ All votes will use getPastVotes(voter, 999)
```

### Step 5: BRDY Holders Vote (snapshot-safe)

Even if someone transfers tokens during voting, their voting power is fixed at snapshotBlock 999:

```
Alice:  vote(1, for)     → getPastVotes(Alice, 999) = 200K ✅
Bob:    vote(1, for)     → getPastVotes(Bob, 999) = 200K ✅
Carol:  vote(1, for)     → getPastVotes(Carol, 999) = 200K ✅
Dave:   vote(1, against) → getPastVotes(Dave, 999) = 200K ✅
→ For: 600K | Against: 200K → PASSED ✅
```

### Step 6: Execute (with reentrancy protection)

After grace period ends:

```
BReadyDAO.execute(1)  // nonReentrant
✅ Not executed, not canceled
✅ Grace period ended
✅ 600K > 200K (passed)
✅ Claim #1 == ApprovedForFunding  ← THE KEY GATE
✅ Treasury 20 ETH >= 3 ETH
── Effects first ──
  p.executed = true
  impactClaim.markFunded(1)  → Claim #1 = Funded
── Then interaction ──
  3 ETH sent to WaterFirst NGO
→ Treasury: 17 ETH remaining
```

**Complete, tamper-proof, reentrancy-safe trail from disaster → impact → verification → funding.**

---

## 7. Security Model

| Guard | Prevents |
|-------|----------|
| `ERC20Votes` snapshot | Vote-power manipulation via token transfers |
| `nonReentrant` on execute | Reentrancy attacks on treasury payouts |
| Checks-effects-interactions | State corruption from external calls |
| `onlyReviewer` | Non-whitelisted evaluation |
| `hasEvaluated` | Double evaluation |
| M-of-N threshold | Single-reviewer approval |
| `hasVoted` | Double voting |
| `proposalThreshold` | Spam proposals |
| `claimThreshold` (BRDY-gated) | Spam claims flooding reviewers |
| Execute gate | Funding unverified claims |
| Grace period | Rushed execution |
| `onlyDAO` on markFunded | Unauthorized status changes |
| No admin withdrawal | Owner cannot drain treasury |
| ImpactClaim ownership → DAO | Admin cannot unilaterally change reviewers/thresholds |

---

## 8. Deployment Wiring

```
1. Deploy BReadyToken(deployer, 1M)              → address A  (auto-delegates deployer)
2. Deploy ImpactClaim(deployer, M=2, A, 1 BRDY)  → address B  (BRDY-gated claims)
3. Deploy BReadyDAO(A, B, 5min, 2min, threshold)  → address C  (ReentrancyGuard)
4. ImpactClaim.setDAO(C)                          → only C can markFunded
5. ImpactClaim.addReviewer(deployer)              → for testing
6. ImpactClaim.transferOwnership(C)               → ★ governed, not admin
7. Verify deployer getVotes() == 1M               → checkpoints active
```

---

## Summary

Disaster DAO = **Impact-First Governance** with defense-in-depth:

1. **Impact claimed** → on-chain Hypercert (ERC-1155) with BRDY-gated anti-spam
2. **Impact verified** → M-of-N independent reviewer threshold (governed by DAO)
3. **Funding governed** → snapshot voting via ERC20Votes (immune to manipulation)
4. **Money flows only** when BOTH verification AND governance approve
5. **Treasury protected** → ReentrancyGuard + checks-effects-interactions
6. **Every step on-chain** → permanent, tamper-proof audit trail
