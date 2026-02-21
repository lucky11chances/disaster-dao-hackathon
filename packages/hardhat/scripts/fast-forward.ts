import { network } from "hardhat";

async function main() {
    console.log("⏩ 快进时间 8 分钟（480 秒）...");

    await network.provider.send("evm_increaseTime", [480]);
    await network.provider.send("evm_mine");

    console.log("✅ 时间已快进！现在您可以在页面上刷新并执行（Execute）提案了。");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
