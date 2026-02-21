# Disaster DAO — 架构详解

## 1. 我们解决的问题

传统灾难救助资金存在三个根本问题：

| 问题 | 描述 |
|------|------|
| **资金去向不透明** | 捐赠者给了钱，但完全无法追踪资金的实际用途 |
| **影响力无法验证** | 救助组织自我报告成果，没有中立的防篡改评估机制 |
| **决策权集中** | 少数NGO高管决定优先救助哪些危机，受灾社区没有话语权 |

**Disaster DAO 的核心理念：影响力必须先在链上被证明，资金才能流动。**

---

## 2. 系统架构总览

```
┌──────────────────────────────────────────────────────────┐
│                    Disaster DAO 系统                      │
│                                                          │
│  ┌─────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │ BReadyToken │  │  ImpactClaim   │  │  BReadyDAO    │  │
│  │ (ERC-20 +   │  │  (ERC-1155)    │  │  (治理合约)    │  │
│  │ ERC20Votes) │  │                │  │               │  │
│  │             │  │ • createClaim()│  │ • 创建提案     │  │
│  │ • mint()    │  │   (BRDY门控)    │  │ • 快照投票     │  │
│  │ • delegate()│  │ • evaluate()   │  │ • 执行         │  │
│  │ • getPast   │  │ • markFunded() │  │   (防重入)     │  │
│  │   Votes()   │  │                │  │ • 取消         │  │
│  │             │  │ 待审核 →       │  │               │  │
│  │ 1 BRDY      │  │ 已批准 →       │  │ 国库：        │  │
│  │ = 1 票       │  │ 已拨款         │  │ 接收 ETH      │  │
│  └──────┬──────┘  └──────┬─────────┘  └──────┬────────┘  │
│         │  getPastVotes  │  检查状态           │          │
│         │◄───────────────┤  才能执行           │          │
│         │  快照投票权重   │◄──────────────────┤          │
│         │                │  调用 markFunded   │          │
│         │                │◄──────────────────┤          │
└─────────┴────────────────┴───────────────────┴───────────┘
```

### 合约之间的核心交互

1. **BReadyDAO → BReadyToken**：使用 `getPastVotes(投票者, 快照区块)` 获取防篡改的投票权重
2. **BReadyDAO → ImpactClaim**：执行前检查 `getClaimStatus() == ApprovedForFunding`；拨款后调用 `markFunded()`
3. **ImpactClaim → BReadyToken**：检查 `balanceOf(创建者) >= claimThreshold`（防垃圾声明）
4. **ImpactClaim 所有权**：部署后转移给 BReadyDAO（Disaster DAO）— 评审员管理由治理控制，而非管理员

---

## 3. 合约一：BReadyToken（BRDY 治理代币）

**文件：** `contracts/BReadyToken.sol` | **标准：** ERC-20 + ERC20Votes + ERC20Permit

| 特性 | 说明 |
|------|------|
| **名称 / 符号** | B-Ready / BRDY |
| **初始供应量** | 部署时铸造 1,000,000 BRDY 给部署者 |
| **铸造权** | 仅 `owner` 可铸造，可将所有权转移给 DAO |
| **投票检查点** | 继承 `ERC20Votes` — 每次转账自动创建检查点 |
| **快照投票** | `getPastVotes(voter, blockNumber)` 返回历史投票权重 |
| **自我委托** | 持有者必须调用 `delegate(self)` 激活投票权。构造函数自动为部署者委托 |
| **Permit** | 通过 ERC20Permit (EIP-2612) 支持无 gas 授权 |

### 为什么用 ERC20Votes？（安全修复）

不使用检查点时，`balanceOf(投票者)` 在投票时是不安全的：
- 攻击者买入 1M BRDY → 投票 → 转给另一个地址 → 从新地址再投票
- 或者：攻击者投票后卖出代币，相当于"免费投票"

**ERC20Votes** 在每次转账时存储检查点。`getPastVotes(voter, snapshotBlock)` 读取提案创建时的余额——**不受后续转账影响**。

```solidity
// 在 BReadyDAO.vote() 中：
uint256 weight = token.getPastVotes(msg.sender, p.snapshotBlock);
// snapshotBlock = 提案创建时的 block.number - 1
```

---

## 4. 合约二：ImpactClaim（Hypercert 影响力证书）

**文件：** `contracts/ImpactClaim.sol` | **标准：** ERC-1155

### Claim 数据结构

```solidity
struct Claim {
    address creator;       // 提交声明的 NGO / 救助组织
    address recipient;     // 批准后接收资金的地址
    string  tokenURI;      // IPFS URI → 照片、收据、分发记录
    string  impactScope;   // "洪灾救助 - 送达12,000份餐食"
    uint64  impactStart;   // 影响力时间段开始
    uint64  impactEnd;     // 影响力时间段结束
    ClaimStatus status;    // Pending → ApprovedForFunding → Funded
    uint256 passCount;     // 通过评审的数量
    uint256 totalEvals;    // 总评审数量
}
```

### 声明生命周期

```
   ┌──────────┐   M个评审通过    ┌──────────────────┐   DAO执行提案   ┌─────────┐
   │ 待审核    │ ─────────────▶ │ 已批准待拨款      │ ────────────▶ │ 已拨款   │
   │ Pending  │               │ ApprovedForFunding│              │ Funded  │
   └──────────┘               └──────────────────┘              └─────────┘
```

### 防垃圾机制：BRDY 门控

`createClaim()` 要求 `token.balanceOf(msg.sender) >= claimThreshold`。防止垃圾声明淹没评审员和 DAO。

```solidity
require(token.balanceOf(msg.sender) >= claimThreshold, "Insufficient BRDY to create claim");
```

默认门槛：1 BRDY。可通过 `setClaimThreshold()` 配置（所有权已转给 DAO，因此需要治理投票）。

### M-of-N 评审系统

- **M** = `requiredPasses`（所需最低通过数，如 M=2）
- **N** = 白名单评审员总数
- 每个评审员对每个声明只能评审**一次**（Pass/Fail + 可选证据）
- 当 `passCount >= M` → 状态变为 `ApprovedForFunding`

### 治理化管理函数

部署后，**所有权转移给 BReadyDAO**：

| 函数 | 转移前 | 转移后 |
|------|--------|--------|
| `addReviewer()` | 部署者直接调用 | 需要 DAO 提案 + 投票 |
| `removeReviewer()` | 部署者直接调用 | 需要 DAO 提案 + 投票 |
| `setRequiredPasses()` | 部署者直接调用 | 需要 DAO 提案 + 投票 |
| `setClaimThreshold()` | 部署者直接调用 | 需要 DAO 提案 + 投票 |

### Hypercerts 如何被应用

| Hypercert 概念 | 我们的实现 |
|----------------|-----------|
| 工作范围 | `impactScope` — 人类可读的影响力描述 |
| 时间范围 | `impactStart` / `impactEnd` — Unix 时间戳 |
| 证据 | `tokenURI` — IPFS 链接（照片、收据、分发日志） |
| 创建者 | `creator` — NGO 的以太坊地址 |
| 受益方 | `recipient` — 资金接收地址 |
| 验证 | **M-of-N 链上评审**（我们的独创增强！） |
| 证书 | 铸造 ERC-1155 代币给创建者 |

**我们的增强：** 标准 Hypercerts 是自我报告的。我们添加了 M-of-N 评审层 + BRDY 门控，声明必须经过独立验证才有资格获得资金。

---

## 5. 合约三：BReadyDAO（治理 + 国库）

**文件：** `contracts/BReadyDAO.sol` | **继承：** `ReentrancyGuard`

### 提案数据结构

```solidity
struct Proposal {
    uint256 id;
    address proposer;
    uint256 claimId;        // ★ 关联的 ImpactClaim ID
    address recipient;      // 资金接收者
    uint256 amount;         // ETH 金额（wei）
    string  description;
    uint256 forVotes;       // 赞成票（BRDY 数量）
    uint256 againstVotes;   // 反对票（BRDY 数量）
    uint256 startTime;
    uint256 endTime;        // 投票结束时间
    uint256 graceEnd;       // 宽限期结束时间
    uint256 snapshotBlock;  // ★ getPastVotes 快照区块
    bool    executed;
    bool    canceled;
}
```

### 快照投票

创建提案时存储 `snapshotBlock = block.number - 1`。所有投票使用此快照：

```solidity
// 创建提案时：
uint256 snapshot = block.number - 1;

// 投票时：
uint256 weight = token.getPastVotes(msg.sender, p.snapshotBlock);
```

提案创建后转移代币**对该提案的投票权重没有任何影响**。

### 执行门控 — 带重入保护

```solidity
function execute(uint256 _proposalId) external nonReentrant {
    // ── 检查 ──
    require(!p.executed);                              // 1. 未执行过
    require(!p.canceled);                              // 2. 未取消
    require(block.timestamp > p.graceEnd);             // 3. 宽限期已过
    require(p.forVotes > p.againstVotes);              // 4. 赞成 > 反对
    require(impactClaim.getClaimStatus(p.claimId)
        == ApprovedForFunding);                        // 5. ★ 关键门控
    require(address(this).balance >= p.amount);        // 6. 国库够

    // ── 效果优先（外部调用之前）──
    p.executed = true;
    impactClaim.markFunded(p.claimId);

    // ── 最后才交互 ──
    (bool sent, ) = p.recipient.call{value: p.amount}("");
    require(sent, "ETH transfer failed");
}
```

**三重保护：**
1. `nonReentrant` 修饰符（OpenZeppelin ReentrancyGuard）
2. Checks-Effects-Interactions 模式：状态变更在 ETH 转账**之前**
3. 返回值检查：`require(sent, "ETH transfer failed")`

### 定价策略

**职责分离：**
- **评审员** 验证**事实**——"这个 NGO 是否送了 15,000 升水？"
- **DAO** 决定**金额**——"应该支付多少 ETH？"
- `pricingPolicyURI` 记录估值方法论（IPFS 文档，解释每餐成本、每升成本等）

### 国库

- DAO 合约直接持有 ETH
- 任何人可存入——**没有管理员提款功能**
- ETH 唯一出路：`execute()` + 完整验证 + 投票 + 重入保护

### 投票规则

| 规则 | 值 |
|------|------|
| 投票权重 | `getPastVotes(voter, snapshotBlock)` — 快照安全 |
| 投票期 | 5 分钟（演示用；可配置） |
| 宽限期 | 投票结束后 2 分钟 |
| 提案门槛 | 必须持有 BRDY 才能创建提案 |
| 防重复投票 | `hasVoted` mapping |

---

## 6. 完整示例：飓风 Luna

### 背景

2026年2月1日，飓风 Luna 袭击 Puerto Vida，50,000人流离失所。Disaster DAO 有 5 个 BRDY 持有者（各 200K，均已自我委托），3 个评审员，国库 10 ETH。`requiredPasses = 2`。

### 第一步：捐赠者资助国库

```
Frank 存入 5 ETH → BReadyDAO.receive()
Grace 存入 3 ETH → BReadyDAO.receive()
Harry 存入 2 ETH → BReadyDAO.receive()
→ 国库余额：20 ETH
```

### 第二步：NGO 提交影响力声明（BRDY 门控）

WaterFirst NGO 持有 100 BRDY（高于 `claimThreshold`），在 2月2日-7日 送达了 15,000升清洁水：

```
ImpactClaim.createClaim(...)
→ ✅ BRDY 余额检查通过
→ 声明 #1 创建（状态：Pending 待审核）
→ WaterFirst 获得 ERC-1155 代币 #1
```

### 第三步：评审员评审

```
Martinez 博士（UNICEF）：evaluate(1, pass=true, "ipfs://QmReport...")
Sarah（红十字会）：       evaluate(1, pass=true, "ipfs://QmVerify...")
→ passCount=2 >= requiredPasses=2
→ 声明 #1 状态 → ApprovedForFunding ✅
```

### 第四步：创建资助提案（带快照）

Alice 在区块 #1000 创建提案：

```
BReadyDAO.createProposal(claimId: 1, amount: 3 ETH, ...)
→ 提案 #1 创建
→ snapshotBlock = 999（block.number - 1）
→ 所有投票将使用 getPastVotes(voter, 999)
```

### 第五步：BRDY 持有者投票（快照安全）

即使投票期间有人转移代币，投票权重固定在 snapshotBlock 999：

```
Alice:  vote(1, 赞成) → getPastVotes(Alice, 999) = 200K ✅
Bob:    vote(1, 赞成) → getPastVotes(Bob, 999) = 200K ✅
Carol:  vote(1, 赞成) → getPastVotes(Carol, 999) = 200K ✅
Dave:   vote(1, 反对) → getPastVotes(Dave, 999) = 200K ✅
→ 赞成：600K | 反对：200K → 通过 ✅
```

### 第六步：执行（带重入保护）

宽限期结束后：

```
BReadyDAO.execute(1)  // nonReentrant
✅ 未执行、未取消
✅ 宽限期已过
✅ 600K > 200K（投票通过）
✅ 声明 #1 == ApprovedForFunding ← 关键门控
✅ 国库 20 ETH >= 3 ETH
── 效果优先 ──
  p.executed = true
  impactClaim.markFunded(1) → 声明 #1 = Funded
── 最后交互 ──
  3 ETH 转账到 WaterFirst NGO
→ 国库剩余：17 ETH
```

**从灾难 → 影响力 → 验证 → 投票 → 拨款，全程链上、防篡改、防重入。**

---

## 7. 安全模型

| 防护措施 | 防止的风险 |
|----------|-----------|
| `ERC20Votes` 快照 | 通过代币转移操纵投票权重 |
| `nonReentrant` 在 execute | 重入攻击窃取国库 |
| Checks-Effects-Interactions | 外部调用导致的状态损坏 |
| `onlyReviewer` | 非白名单账户评审 |
| `hasEvaluated` | 重复评审 |
| M-of-N 门槛 | 单个评审员独自批准 |
| `hasVoted` | 重复投票 |
| `proposalThreshold` | 垃圾提案 |
| `claimThreshold`（BRDY 门控） | 垃圾声明淹没评审员 |
| 执行门控 | 资助未验证的声明 |
| 宽限期 | 仓促执行 |
| `onlyDAO` on markFunded | 未授权修改状态 |
| 无管理员提款 | Owner 无法提取国库 |
| ImpactClaim 所有权 → DAO | 管理员无法单方面更改评审员/门槛 |

---

## 8. 部署流程

```
1. 部署 BReadyToken(deployer, 1M)                 → 地址 A（自动委托部署者）
2. 部署 ImpactClaim(deployer, M=2, A, 1 BRDY)    → 地址 B（BRDY 门控声明）
3. 部署 BReadyDAO(A, B, 5分钟, 2分钟, 门槛)       → 地址 C（ReentrancyGuard）
4. ImpactClaim.setDAO(C)                          → 只有 C 能调用 markFunded
5. ImpactClaim.addReviewer(deployer)              → 用于测试
6. ImpactClaim.transferOwnership(C)               → ★ 治理化，非管理员控制
7. 验证 deployer getVotes() == 1M                 → 检查点已激活
```

---

## 总结

Disaster DAO = **影响力优先治理** + 纵深防御：

1. **影响力声明** → 链上 Hypercert（ERC-1155）+ BRDY 门控防垃圾
2. **影响力验证** → M-of-N 独立评审员门槛（由 DAO 治理）
3. **资金治理** → ERC20Votes 快照投票（免疫操纵）
4. **资金只在** 验证 AND 治理都通过时才能流动
5. **国库保护** → ReentrancyGuard + Checks-Effects-Interactions
6. **全程链上** → 永久、防篡改的审计记录
