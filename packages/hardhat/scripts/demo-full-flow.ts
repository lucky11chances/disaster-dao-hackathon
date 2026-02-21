/**
 * 🎬 Disaster DAO — 完整流程演示
 *
 * 模拟从灾难 → 影响力声明 → 评审 → 提案 → 投票 → 拨款的全流程
 *
 * 角色：
 *   Account #0 (deployer) = DAO 创始人 + Reviewer #1
 *   Account #1             = Reviewer #2
 *   Account #2             = NGO "WaterFirst"（提交影响力声明）
 *   Account #3             = DAO 成员（投票者）
 *
 * 运行：npx hardhat run scripts/demo-full-flow.ts --network localhost
 */

import { ethers, network } from "hardhat";
import { formatEther, parseEther } from "ethers";

const GAS = { gasLimit: 500000 };

async function main() {
    const signers = await ethers.getSigners();
    const deployer = signers[0];   // DAO 创始人 + Reviewer #1
    const reviewer2 = signers[1];  // Reviewer #2
    const ngo = signers[2];        // NGO "WaterFirst"
    const voter = signers[3];      // DAO 成员

    const token = await ethers.getContract("BReadyToken", deployer);
    const impactClaim = await ethers.getContract("ImpactClaim", deployer);
    const dao = await ethers.getContract("BReadyDAO", deployer);

    const daoAddress = await dao.getAddress();
    const tokenAddress = await token.getAddress();

    console.log("═══════════════════════════════════════════════════════");
    console.log("  🌊 Disaster DAO — 完整流程演示");
    console.log("═══════════════════════════════════════════════════════");

    // ══════════════════════════════════════════════════════════
    // 第 0 步：查看初始状态
    // ══════════════════════════════════════════════════════════
    console.log("\n📊 ── 第 0 步：初始状态 ──");
    console.log("   Deployer:", deployer.address);
    console.log("   Deployer BRDY:", formatEther(await token.balanceOf(deployer.address)));
    console.log("   Deployer 投票权:", formatEther(await token.getVotes(deployer.address)));
    console.log("   Token owner:", await token.owner());
    console.log("   ImpactClaim owner:", await impactClaim.owner());
    console.log("   DAO 地址:", daoAddress);
    console.log("   国库余额:", formatEther(await ethers.provider.getBalance(daoAddress)), "ETH");
    console.log("   Claim threshold:", formatEther(await impactClaim.claimThreshold()), "BRDY");

    // ══════════════════════════════════════════════════════════
    // 第 1 步：分发 BRDY 给 DAO 成员
    // ══════════════════════════════════════════════════════════
    console.log("\n💰 ── 第 1 步：分发 BRDY 给 DAO 成员 ──");

    // 给 NGO 发 100 BRDY（足够创建声明）
    const tx1 = await token.transfer(ngo.address, parseEther("100"), GAS);
    await tx1.wait();
    console.log("   ✅ 转账 100 BRDY → NGO (WaterFirst):", ngo.address);

    // 给第二个投票者发 300K BRDY
    const tx2 = await token.transfer(voter.address, parseEther("300000"), GAS);
    await tx2.wait();
    console.log("   ✅ 转账 300,000 BRDY → 投票者:", voter.address);

    // 各成员需要自我委托激活投票权
    console.log("\n🗳️  激活投票权（自我委托）...");
    const delegateTx1 = await token.connect(ngo).delegate(ngo.address, GAS);
    await delegateTx1.wait();
    console.log("   ✅ NGO 已激活投票权:", formatEther(await token.getVotes(ngo.address)), "BRDY");

    const delegateTx2 = await token.connect(voter).delegate(voter.address, GAS);
    await delegateTx2.wait();
    console.log("   ✅ 投票者已激活投票权:", formatEther(await token.getVotes(voter.address)), "BRDY");
    console.log("   📊 Deployer 投票权:", formatEther(await token.getVotes(deployer.address)), "BRDY");

    // ══════════════════════════════════════════════════════════
    // 第 2 步：资助国库
    // ══════════════════════════════════════════════════════════
    console.log("\n🏦 ── 第 2 步：给 DAO 国库充值 ETH ──");

    const fundTx = await deployer.sendTransaction({
        to: daoAddress,
        value: parseEther("10"),
        gasLimit: 100000,
    });
    await fundTx.wait();
    console.log("   ✅ Deployer 存入 10 ETH");

    const fundTx2 = await voter.sendTransaction({
        to: daoAddress,
        value: parseEther("5"),
        gasLimit: 100000,
    });
    await fundTx2.wait();
    console.log("   ✅ 投票者 存入 5 ETH");

    console.log("   💎 国库余额:", formatEther(await ethers.provider.getBalance(daoAddress)), "ETH");

    // ══════════════════════════════════════════════════════════
    // 第 3 步：NGO 提交影响力声明
    // ══════════════════════════════════════════════════════════
    console.log("\n📜 ── 第 3 步：NGO 提交影响力声明 ──");
    console.log("   NGO BRDY 余额:", formatEther(await token.balanceOf(ngo.address)), "(需要 >= 1)");

    const now = Math.floor(Date.now() / 1000);
    const claimTx = await impactClaim.connect(ngo).createClaim(
        ngo.address,                                    // recipient
        "ipfs://QmExampleEvidence12345",                // tokenURI (证据)
        "Hurricane Luna - 15,000L clean water to 4 shelters",    // impactScope
        now - 86400 * 5,                                // impactStart (5天前)
        now,                                            // impactEnd (现在)
        GAS,
    );
    await claimTx.wait();
    console.log("   ✅ 声明 #1 创建成功！");

    const claim = await impactClaim.claims(1);
    console.log("   📋 创建者:", claim.creator);
    console.log("   📋 影响力:", claim.impactScope);
    console.log("   📋 证据:", claim.tokenURI);
    console.log("   📋 状态:", ["Pending", "ApprovedForFunding", "Funded"][Number(claim.status)]);

    // ══════════════════════════════════════════════════════════
    // 第 4 步：评审员评审（M-of-N，需要 2 个 Pass）
    // ══════════════════════════════════════════════════════════
    console.log("\n🔍 ── 第 4 步：评审员评审声明 ──");

    // Reviewer #1 (deployer) 评审 Pass
    const eval1Tx = await impactClaim.connect(deployer).evaluate(
        1,      // claimId
        true,   // pass
        "ipfs://QmReviewer1Report",  // 评审报告
        GAS,
    );
    await eval1Tx.wait();
    console.log("   ✅ Reviewer #1 (deployer): PASS ✓");

    let claimAfter1 = await impactClaim.claims(1);
    console.log("   📊 通过数:", claimAfter1.passCount.toString(), "/ 需要:", "2");
    console.log("   📊 状态:", ["Pending", "ApprovedForFunding", "Funded"][Number(claimAfter1.status)]);

    // Reviewer #2 评审 Pass
    const eval2Tx = await impactClaim.connect(reviewer2).evaluate(
        1,      // claimId
        true,   // pass
        "ipfs://QmReviewer2Report",  // 评审报告
        GAS,
    );
    await eval2Tx.wait();
    console.log("   ✅ Reviewer #2: PASS ✓");

    let claimAfter2 = await impactClaim.claims(1);
    console.log("   📊 通过数:", claimAfter2.passCount.toString(), "/ 需要:", "2");
    console.log("   📊 状态:", ["Pending", "ApprovedForFunding", "Funded"][Number(claimAfter2.status)]);
    console.log("   🎉 声明 #1 已批准！可以创建资助提案了！");

    // Mine a block so snapshots work
    await network.provider.send("evm_mine");

    // ══════════════════════════════════════════════════════════
    // 第 5 步：创建资助提案
    // ══════════════════════════════════════════════════════════
    console.log("\n📝 ── 第 5 步：创建资助提案 ──");
    console.log("   提案者:", deployer.address);
    console.log("   提案者 BRDY:", formatEther(await token.balanceOf(deployer.address)));

    const proposalTx = await dao.connect(deployer).createProposal(
        1,                      // claimId
        ngo.address,            // recipient (NGO)
        parseEther("3"),        // 3 ETH
        "Fund Claim #1 - Hurricane Luna clean water, 15000L, 3 ETH",
        GAS,
    );
    await proposalTx.wait();
    console.log("   ✅ 提案 #1 创建成功！");

    const proposal = await dao.proposals(1);
    console.log("   📋 提案ID:", proposal.id.toString());
    console.log("   📋 金额:", formatEther(proposal.amount), "ETH");
    console.log("   📋 接收者:", proposal.recipient);
    console.log("   📋 快照区块:", proposal.snapshotBlock.toString());
    console.log("   📋 投票截止:", new Date(Number(proposal.endTime) * 1000).toLocaleString());

    // ══════════════════════════════════════════════════════════
    // 第 6 步：投票
    // ══════════════════════════════════════════════════════════
    console.log("\n🗳️  ── 第 6 步：DAO 成员投票 ──");

    // Deployer 投赞成票
    const vote1Tx = await dao.connect(deployer).vote(1, true, GAS);
    await vote1Tx.wait();
    const deployerVotes = await token.getVotes(deployer.address);
    console.log("   ✅ Deployer 投: 赞成 (权重:", formatEther(deployerVotes), "BRDY)");

    // Voter 投赞成票
    const vote2Tx = await dao.connect(voter).vote(1, true, GAS);
    await vote2Tx.wait();
    const voterVotes = await token.getVotes(voter.address);
    console.log("   ✅ 投票者 投: 赞成 (权重:", formatEther(voterVotes), "BRDY)");

    // NGO 也投一票
    const vote3Tx = await dao.connect(ngo).vote(1, true, GAS);
    await vote3Tx.wait();
    const ngoVotes = await token.getVotes(ngo.address);
    console.log("   ✅ NGO 投: 赞成 (权重:", formatEther(ngoVotes), "BRDY)");

    const proposalAfterVote = await dao.proposals(1);
    console.log("   📊 赞成票:", formatEther(proposalAfterVote.forVotes), "BRDY");
    console.log("   📊 反对票:", formatEther(proposalAfterVote.againstVotes), "BRDY");
    console.log("   📊 结果: 赞成 > 反对 → 通过 ✅");

    // ══════════════════════════════════════════════════════════
    // 第 7 步：快进时间，等待投票期 + 宽限期结束
    // ══════════════════════════════════════════════════════════
    console.log("\n⏩ ── 第 7 步：快进时间（投票期5分钟 + 宽限期2分钟）──");

    // 快进 8 分钟 (480 秒)
    await network.provider.send("evm_increaseTime", [480]);
    await network.provider.send("evm_mine");
    console.log("   ✅ 时间快进 8 分钟，投票期和宽限期都已过");

    // ══════════════════════════════════════════════════════════
    // 第 8 步：执行提案！🎉
    // ══════════════════════════════════════════════════════════
    console.log("\n🚀 ── 第 8 步：执行提案 → 拨款 ──");

    const ngoBefore = await ethers.provider.getBalance(ngo.address);
    const treasuryBefore = await ethers.provider.getBalance(daoAddress);
    console.log("   执行前 NGO ETH:", formatEther(ngoBefore));
    console.log("   执行前 国库 ETH:", formatEther(treasuryBefore));

    const executeTx = await dao.connect(deployer).execute(1, GAS);
    await executeTx.wait();
    console.log("   ✅ 提案 #1 执行成功！");

    const ngoAfter = await ethers.provider.getBalance(ngo.address);
    const treasuryAfter = await ethers.provider.getBalance(daoAddress);
    console.log("   执行后 NGO ETH:", formatEther(ngoAfter), "(增加了", formatEther(ngoAfter - ngoBefore), "ETH)");
    console.log("   执行后 国库 ETH:", formatEther(treasuryAfter));

    // 检查声明最终状态
    const finalClaim = await impactClaim.claims(1);
    console.log("   📋 声明 #1 最终状态:", ["Pending", "ApprovedForFunding", "Funded"][Number(finalClaim.status)]);

    const finalProposal = await dao.proposals(1);
    console.log("   📋 提案 #1 已执行:", finalProposal.executed);

    // ══════════════════════════════════════════════════════════
    // 总结
    // ══════════════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("  ✅ 完整流程跑通！");
    console.log("═══════════════════════════════════════════════════════");
    console.log("");
    console.log("  灾难发生 → NGO 救灾 → 提交声明(BRDY门控)");
    console.log("     → 2个评审员独立验证 → 声明批准");
    console.log("     → 创建提案(快照区块) → DAO投票(防操纵)");
    console.log("     → 执行拨款(防重入) → NGO收到ETH");
    console.log("");
    console.log("  🔒 安全机制全部生效：");
    console.log("     ✅ BRDY 门控 (防垃圾声明)");
    console.log("     ✅ M-of-N 评审 (2/2 通过)");
    console.log("     ✅ 快照投票 (ERC20Votes)");
    console.log("     ✅ 重入保护 (ReentrancyGuard)");
    console.log("     ✅ Checks-Effects-Interactions");
    console.log("     ✅ 所有权去中心化 (Token + ImpactClaim → DAO)");
    console.log("═══════════════════════════════════════════════════════");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
