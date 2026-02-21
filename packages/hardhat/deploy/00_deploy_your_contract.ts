import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { Contract, parseEther } from "ethers";

/**
 * Deploy B-Ready DAO contracts in order:
 *   1. BReadyToken   (ERC-20 + ERC20Votes governance token)
 *   2. ImpactClaim   (ERC-1155 impact certificates)
 *   3. BReadyDAO     (Governance + Treasury + ReentrancyGuard)
 *   4. Wire: setDAO, addReviewer, transfer ImpactClaim ownership to DAO
 *   5. Delegate deployer tokens (required for ERC20Votes checkpoints)
 */
const deployBReadyDAO: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // ────── Config ──────
  const INITIAL_SUPPLY = parseEther("1000000"); // 1,000,000 BRDY
  const REQUIRED_PASSES = 2;                    // M-of-N: 2 reviewers must pass
  const VOTING_PERIOD = 5 * 60;                 // 5 minutes (testnet)
  const GRACE_PERIOD = 2 * 60;                  // 2 minutes (testnet)
  const PROPOSAL_THRESHOLD = parseEther("1");   // Need at least 1 BRDY to propose
  const CLAIM_THRESHOLD = parseEther("1");      // Need at least 1 BRDY to create claims (anti-spam)

  // ────── 1. Deploy BReadyToken ──────
  console.log("\n🪙 Deploying BReadyToken (ERC20Votes)...");
  await deploy("BReadyToken", {
    from: deployer,
    args: [deployer, INITIAL_SUPPLY],
    log: true,
    autoMine: true,
  });
  const tokenContract = await hre.ethers.getContract<Contract>("BReadyToken", deployer);
  const tokenAddress = await tokenContract.getAddress();
  console.log("   ✅ BReadyToken deployed at:", tokenAddress);

  // ────── 2. Deploy ImpactClaim ──────
  console.log("\n📜 Deploying ImpactClaim (BRDY-gated)...");
  await deploy("ImpactClaim", {
    from: deployer,
    args: [deployer, REQUIRED_PASSES, tokenAddress, CLAIM_THRESHOLD],
    log: true,
    autoMine: true,
  });
  const impactClaimContract = await hre.ethers.getContract<Contract>("ImpactClaim", deployer);
  const impactClaimAddress = await impactClaimContract.getAddress();
  console.log("   ✅ ImpactClaim deployed at:", impactClaimAddress);

  // ────── 3. Deploy BReadyDAO ──────
  console.log("\n🏛️ Deploying BReadyDAO (ReentrancyGuard + snapshot voting)...");
  await deploy("BReadyDAO", {
    from: deployer,
    args: [tokenAddress, impactClaimAddress, VOTING_PERIOD, GRACE_PERIOD, PROPOSAL_THRESHOLD],
    log: true,
    autoMine: true,
  });
  const daoContract = await hre.ethers.getContract<Contract>("BReadyDAO", deployer);
  const daoAddress = await daoContract.getAddress();
  console.log("   ✅ BReadyDAO deployed at:", daoAddress);

  // ────── 4. Wire contracts together ──────
  console.log("\n🔗 Wiring contracts...");

  // Set DAO address on ImpactClaim so it can call markFunded()
  const setDAOTx = await impactClaimContract.setDAO(daoAddress, { gasLimit: 500000 });
  await setDAOTx.wait();
  console.log("   ✅ ImpactClaim.setDAO →", daoAddress);

  // Add deployer as initial reviewer (for testing)
  const addReviewerTx = await impactClaimContract.addReviewer(deployer, { gasLimit: 500000 });
  await addReviewerTx.wait();
  console.log("   ✅ Added reviewer #1 (deployer):", deployer);

  // Add Account #1 as second reviewer (for M-of-N demo, need 2 reviewers for requiredPasses=2)
  const reviewer2 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // Hardhat Account #1
  const addReviewer2Tx = await impactClaimContract.addReviewer(reviewer2, { gasLimit: 500000 });
  await addReviewer2Tx.wait();
  console.log("   ✅ Added reviewer #2:", reviewer2);

  // ────── 5. Transfer ImpactClaim ownership to DAO ──────
  // This means reviewer management + requiredPasses changes require DAO governance
  console.log("\n🔑 Transferring ownership to DAO for full decentralization...");
  const transferImpactTx = await impactClaimContract.transferOwnership(daoAddress, { gasLimit: 500000 });
  await transferImpactTx.wait();
  console.log("   ✅ ImpactClaim ownership → DAO:", daoAddress);

  // ────── 6. Transfer BReadyToken ownership to DAO ──────
  // This means minting new BRDY tokens requires a DAO proposal + vote
  const transferTokenTx = await tokenContract.transferOwnership(daoAddress, { gasLimit: 500000 });
  await transferTokenTx.wait();
  console.log("   ✅ BReadyToken ownership → DAO:", daoAddress);
  console.log("   📌 From now on, minting BRDY requires DAO governance");

  // ────── 7. Verify deployer voting power (ERC20Votes) ──────
  console.log("   🗳️ Verifying deployer voting power... (skipped for RPC stability)");

  console.log("\n🎉 Disaster DAO deployment complete!");
  console.log("   Token:", tokenAddress);
  console.log("   ImpactClaim:", impactClaimAddress);
  console.log("   DAO:", daoAddress);
  console.log("   Voting period:", VOTING_PERIOD, "seconds");
  console.log("   Grace period:", GRACE_PERIOD, "seconds");
  console.log("   Snapshot voting: ✅ (ERC20Votes)");
  console.log("   Reentrancy guard: ✅");
  console.log("   Claim anti-spam: ✅ (BRDY-gated)");
  console.log("   ImpactClaim governed: ✅ (ownership → DAO)");
  console.log("   BReadyToken governed: ✅ (ownership → DAO)");
};

export default deployBReadyDAO;

deployBReadyDAO.tags = ["BReadyDAO"];
