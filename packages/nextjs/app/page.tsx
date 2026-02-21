"use client";

import { useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { useSendTransaction } from "wagmi";
import { formatEther, parseEther } from "viem";
import Link from "next/link";
import { useScaffoldReadContract, useScaffoldWriteContract, useScaffoldEventHistory, useTargetNetwork } from "~~/hooks/scaffold-eth";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { getBlockExplorerTxLink } from "~~/utils/scaffold-eth/networks";
import {
  ShieldCheckIcon,
  DocumentTextIcon,
  UserGroupIcon,
  BanknotesIcon,
} from "@heroicons/react/24/outline";

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();

  // ─── Read DAO stats ───
  const { data: treasuryBalance } = useScaffoldReadContract({
    contractName: "BReadyDAO",
    functionName: "treasuryBalance",
  });

  const { data: proposalCount } = useScaffoldReadContract({
    contractName: "BReadyDAO",
    functionName: "proposalCount",
  });

  const { data: votingPeriod } = useScaffoldReadContract({
    contractName: "BReadyDAO",
    functionName: "votingPeriod",
  });

  const { data: gracePeriod } = useScaffoldReadContract({
    contractName: "BReadyDAO",
    functionName: "gracePeriod",
  });

  const { data: nextClaimId } = useScaffoldReadContract({
    contractName: "ImpactClaim",
    functionName: "nextClaimId",
  });

  const { data: requiredPasses } = useScaffoldReadContract({
    contractName: "ImpactClaim",
    functionName: "requiredPasses",
  });

  const { data: tokenBalance } = useScaffoldReadContract({
    contractName: "BReadyToken",
    functionName: "balanceOf",
    args: [connectedAddress],
  });

  const { data: totalSupply } = useScaffoldReadContract({
    contractName: "BReadyToken",
    functionName: "totalSupply",
  });

  const { data: votingPower } = useScaffoldReadContract({
    contractName: "BReadyToken",
    functionName: "getVotes",
    args: [connectedAddress],
  });

  const { data: delegates } = useScaffoldReadContract({
    contractName: "BReadyToken",
    functionName: "delegates",
    args: [connectedAddress],
  });

  // Derived values
  const claimCount = nextClaimId ? Number(nextClaimId) - 1 : 0;
  const pCount = proposalCount ? Number(proposalCount) : 0;
  const treasury = treasuryBalance ? formatEther(treasuryBalance) : "0";
  const myTokens = tokenBalance ? formatEther(tokenBalance) : "0";
  const supply = totalSupply ? formatEther(totalSupply) : "0";
  const myVotes = votingPower ? formatEther(votingPower) : "0";
  const myVotesNum = parseFloat(myVotes);
  const supplyNum = parseFloat(supply);
  const votingPowerPct = supplyNum > 0 ? ((myVotesNum / supplyNum) * 100).toFixed(2) : "0.00";
  const needsDelegate = connectedAddress && delegates && delegates === "0x0000000000000000000000000000000000000000";

  // ─── Fund treasury ───
  const [fundAmount, setFundAmount] = useState("");
  const { data: daoContractData } = useDeployedContractInfo("BReadyDAO");
  const { sendTransactionAsync, isPending: isFunding } = useSendTransaction();

  // ─── Delegate ───
  const { writeContractAsync: delegateAsync, isMining: isDelegating } = useScaffoldWriteContract({
    contractName: "BReadyToken",
  });

  const handleDelegate = async () => {
    if (!connectedAddress) return;
    try {
      await delegateAsync({ functionName: "delegate", args: [connectedAddress] });
    } catch (e) {
      console.error("Delegate error:", e);
    }
  };

  const handleFundTreasury = async () => {
    if (!fundAmount || parseFloat(fundAmount) <= 0 || !daoContractData?.address) return;
    try {
      await sendTransactionAsync({
        to: daoContractData.address,
        value: parseEther(fundAmount),
      });
      setFundAmount("");
    } catch (e) {
      console.error("Fund treasury error:", e);
    }
  };

  // ─── Event History ───
  const { data: claimCreatedEvents } = useScaffoldEventHistory({
    contractName: "ImpactClaim",
    eventName: "ClaimCreated",
    fromBlock: 0n,
    watch: true,
  });

  const { data: proposalCreatedEvents } = useScaffoldEventHistory({
    contractName: "BReadyDAO",
    eventName: "ProposalCreated",
    fromBlock: 0n,
    watch: true,
  });

  const { data: proposalExecutedEvents } = useScaffoldEventHistory({
    contractName: "BReadyDAO",
    eventName: "ProposalExecuted",
    fromBlock: 0n,
    watch: true,
  });

  return (
    <div className="flex flex-col items-center grow pt-8 px-4">
      {/* Hero */}
      <div className="text-center mb-10">
        <h1 className="text-5xl font-extrabold">
          <span className="bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
            Disaster DAO
          </span>
        </h1>
        <p className="mt-3 text-lg opacity-70 max-w-xl mx-auto">
          Disaster preparedness & relief governance. Fund verified impact, vote on proposals, and build resilient
          communities — all on-chain.
        </p>
        {connectedAddress && (
          <div className="mt-3 flex flex-col items-center gap-2">
            <div className="badge badge-lg badge-outline badge-primary gap-2">
              🪙 BRDY: {parseFloat(myTokens).toLocaleString()} | 🗳️ Voting Power: {votingPowerPct}%
            </div>
            {needsDelegate && (
              <button
                className="btn btn-warning btn-sm animate-pulse"
                onClick={handleDelegate}
                disabled={isDelegating}
              >
                {isDelegating ? <span className="loading loading-spinner loading-xs"></span> : "⚠️ Activate Voting Power (Self-Delegate)"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full max-w-5xl mb-10">
        <StatCard
          icon={<BanknotesIcon className="w-8 h-8 text-green-500" />}
          title="Treasury"
          value={`${parseFloat(treasury).toFixed(4)} ETH`}
          subtitle="Available for disaster relief"
        />
        <StatCard
          icon={<DocumentTextIcon className="w-8 h-8 text-blue-500" />}
          title="Proposals"
          value={pCount.toString()}
          subtitle="Funding proposals"
        />
        <StatCard
          icon={<ShieldCheckIcon className="w-8 h-8 text-purple-500" />}
          title="Impact Claims"
          value={claimCount.toString()}
          subtitle="Verified impact certificates"
        />
        <StatCard
          icon={<UserGroupIcon className="w-8 h-8 text-orange-500" />}
          title="Governance"
          value={`${votingPeriod ? Number(votingPeriod) / 60 : "-"} min`}
          subtitle={`Vote + ${gracePeriod ? Number(gracePeriod) / 60 : "-"} min grace`}
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl mb-10">
        <Link href="/claims" className="card bg-base-100 shadow-xl hover:shadow-2xl transition-shadow cursor-pointer">
          <div className="card-body items-center text-center">
            <ShieldCheckIcon className="w-12 h-12 text-purple-500 mb-2" />
            <h2 className="card-title">Impact Claims</h2>
            <p className="text-sm opacity-70">Submit or evaluate disaster relief impact certificates</p>
            <div className="badge badge-primary mt-2">Create Claim →</div>
          </div>
        </Link>
        <Link href="/proposals" className="card bg-base-100 shadow-xl hover:shadow-2xl transition-shadow cursor-pointer">
          <div className="card-body items-center text-center">
            <DocumentTextIcon className="w-12 h-12 text-blue-500 mb-2" />
            <h2 className="card-title">Proposals</h2>
            <p className="text-sm opacity-70">Create and vote on funding proposals for approved claims</p>
            <div className="badge badge-secondary mt-2">View Proposals →</div>
          </div>
        </Link>
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body items-center text-center">
            <BanknotesIcon className="w-12 h-12 text-green-500 mb-2" />
            <h2 className="card-title">Fund Treasury</h2>
            <p className="text-sm opacity-70">Deposit ETH into the DAO treasury for disaster relief</p>
            <div className="flex gap-2 mt-2 w-full">
              <input
                type="number"
                step="0.01"
                placeholder="ETH amount"
                className="input input-bordered input-sm flex-1"
                value={fundAmount}
                onChange={e => setFundAmount(e.target.value)}
              />
              <button
                className="btn btn-success btn-sm"
                disabled={isFunding || !fundAmount}
                onClick={handleFundTreasury}
              >
                {isFunding ? "..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="w-full max-w-5xl bg-base-200 rounded-3xl p-8 mb-10">
        <h2 className="text-2xl font-bold text-center mb-6">How B-Ready DAO Works</h2>
        <div className="flex flex-col md:flex-row gap-4 justify-center">
          <Step num={1} title="Submit Impact" desc="NGO mints an Impact Claim with evidence (receipts, photos, logs)" />
          <Arrow />
          <Step num={2} title="Evaluate" desc="Whitelisted reviewers verify the claim on-chain (M-of-N threshold)" />
          <Arrow />
          <Step num={3} title="Propose Funding" desc="DAO member creates a funding proposal linked to the approved claim" />
          <Arrow />
          <Step num={4} title="Vote & Execute" desc="BRDY holders vote. If passed, treasury funds the recipient automatically" />
        </div>
      </div>

      {/* Activity History */}
      <div className="w-full max-w-5xl bg-base-100 shadow-xl rounded-3xl p-8 mb-10 border border-base-200">
        <h2 className="text-2xl font-bold mb-6">Activity History</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Claim History */}
          <div>
            <h3 className="font-semibold text-lg mb-4 text-purple-500">Claim History</h3>
            <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
              {!claimCreatedEvents || claimCreatedEvents.length === 0 ? (
                <p className="text-sm opacity-50">No claims created yet.</p>
              ) : (
                claimCreatedEvents.map((evt: any, idx) => {
                  return (
                    <details key={idx} className="collapse collapse-arrow bg-base-200 mb-2 border border-base-300">
                      <summary className="collapse-title p-3 min-h-0 text-sm font-semibold flex justify-between items-center cursor-pointer">
                        <span>Claim #{evt.args.claimId?.toString()}</span>
                        <span className="opacity-70 font-normal text-[11px]">{evt.args.creator?.slice(0, 6)}...</span>
                      </summary>
                      <div className="collapse-content pb-3 text-[11px] opacity-80 space-y-2 break-all">
                        <div className="divider my-0 h-1"></div>
                        <p><span className="font-semibold text-base-content">Creator:</span><br /> {evt.args.creator}</p>
                        <p><span className="font-semibold text-base-content">Recipient:</span><br /> {evt.args.recipient}</p>
                        <p><span className="font-semibold text-base-content">Impact Scope:</span><br /> {evt.args.impactScope}</p>
                        <p><span className="font-semibold text-base-content">Evidence URI:</span><br /> {evt.args.tokenURI}</p>
                      </div>
                    </details>
                  );
                })
              )}
            </div>
          </div>

          {/* Proposal History */}
          <div>
            <h3 className="font-semibold text-lg mb-4 text-blue-500">Proposal History</h3>
            <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
              {!proposalCreatedEvents || proposalCreatedEvents.length === 0 ? (
                <p className="text-sm opacity-50">No proposals yet.</p>
              ) : (
                proposalCreatedEvents.map((evt: any, idx) => {
                  return (
                    <details key={idx} className="collapse collapse-arrow bg-base-200 mb-2 border border-base-300">
                      <summary className="collapse-title p-3 min-h-0 text-sm font-semibold flex justify-between items-center cursor-pointer">
                        <span>Proposal #{evt.args.proposalId?.toString()}</span>
                        <span className="opacity-70 font-normal text-[11px]">{formatEther(evt.args.amount || 0n)} ETH</span>
                      </summary>
                      <div className="collapse-content pb-3 text-[11px] opacity-80 space-y-2 break-all">
                        <div className="divider my-0 h-1"></div>
                        <p><span className="font-semibold text-base-content">Claim ID:</span> #{evt.args.claimId?.toString()}</p>
                        <p><span className="font-semibold text-base-content">Proposer:</span><br /> {evt.args.proposer}</p>
                        <p><span className="font-semibold text-base-content">Description:</span><br /> {evt.args.description}</p>
                        <p><span className="font-semibold text-base-content">Amount:</span> {formatEther(evt.args.amount || 0n)} ETH</p>
                      </div>
                    </details>
                  );
                })
              )}
            </div>
          </div>

          {/* Fund History */}
          <div>
            <h3 className="font-semibold text-lg mb-4 text-green-500">Fund History</h3>
            <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
              {!proposalExecutedEvents || proposalExecutedEvents.length === 0 ? (
                <p className="text-sm opacity-50">No funds distributed yet.</p>
              ) : (
                proposalExecutedEvents.map((evt: any, idx) => {
                  return (
                    <details key={idx} className="collapse collapse-arrow bg-base-200 mb-2 border border-base-300">
                      <summary className="collapse-title p-3 min-h-0 text-sm font-semibold flex justify-between items-center cursor-pointer">
                        <span className="text-success">Funded #{evt.args.proposalId?.toString()}</span>
                        <span className="opacity-70 font-normal text-[11px] text-success">{formatEther(evt.args.amount || 0n)} ETH</span>
                      </summary>
                      <div className="collapse-content pb-3 text-[11px] opacity-80 space-y-2 break-all">
                        <div className="divider my-0 h-1"></div>
                        <p><span className="font-semibold text-base-content">Paid To:</span><br /> {evt.args.recipient}</p>
                        <p><span className="font-semibold text-base-content">Amount:</span> {formatEther(evt.args.amount || 0n)} ETH</p>
                      </div>
                    </details>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Helper Components ──

const StatCard = ({
  icon,
  title,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  subtitle: string;
}) => (
  <div className="card bg-base-100 shadow-lg">
    <div className="card-body flex flex-row items-center gap-4 py-4">
      {icon}
      <div>
        <p className="text-xs uppercase tracking-wide opacity-50">{title}</p>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs opacity-50">{subtitle}</p>
      </div>
    </div>
  </div>
);

const Step = ({ num, title, desc }: { num: number; title: string; desc: string }) => (
  <div className="flex flex-col items-center text-center flex-1">
    <div className="w-10 h-10 rounded-full bg-primary text-primary-content flex items-center justify-center font-bold text-lg mb-2">
      {num}
    </div>
    <h3 className="font-semibold">{title}</h3>
    <p className="text-xs opacity-60 mt-1">{desc}</p>
  </div>
);

const Arrow = () => (
  <div className="hidden md:flex items-center text-2xl opacity-30">→</div>
);

export default Home;
