import { ethers } from "hardhat";
async function main() {
    const ic = await ethers.getContract("ImpactClaim");
    const nextId = await ic.nextClaimId();
    console.log("Next Claim ID:", nextId.toString());
    for (let i = 1; i < Number(nextId); i++) {
        const c = await ic.claims(i);
        console.log(`\nClaim #${i}:`);
        console.log("  Status:", c.status.toString(), "(0=Pending, 1=Approved, 2=Funded)");
        console.log("  PassCount:", c.passCount.toString());
        console.log("  Creator:", c.creator);
    }
}
main();
