"use client";

import { useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { formatEther, parseEther } from "viem";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import {
    DocumentTextIcon,
    HandThumbUpIcon,
    HandThumbDownIcon,
    PlayIcon,
    XMarkIcon,
    CheckBadgeIcon,
    ClockIcon,
} from "@heroicons/react/24/outline";

const ProposalsPage: NextPage = () => {
    const { address } = useAccount();

    const { data: proposalCount } = useScaffoldReadContract({
        contractName: "BReadyDAO",
        functionName: "proposalCount",
    });

    const { data: treasuryBalance } = useScaffoldReadContract({
        contractName: "BReadyDAO",
        functionName: "treasuryBalance",
    });

    const { data: tokenBalance } = useScaffoldReadContract({
        contractName: "BReadyToken",
        functionName: "balanceOf",
        args: [address],
    });

    const pCount = proposalCount ? Number(proposalCount) : 0;

    return (
        <div className="flex flex-col items-center grow pt-8 px-4">
            <h1 className="text-4xl font-bold mb-2">
                <DocumentTextIcon className="w-10 h-10 inline mr-2 text-blue-500" />
                Proposals
            </h1>
            <p className="opacity-60 mb-6 text-center max-w-lg">
                Create funding proposals for approved impact claims. 1 BRDY = 1 vote.
            </p>

            <div className="flex gap-4 mb-6 flex-wrap justify-center">
                <div className="badge badge-lg badge-outline">📄 {pCount} Proposals</div>
                <div className="badge badge-lg badge-outline">💰 Treasury: {treasuryBalance ? parseFloat(formatEther(treasuryBalance)).toFixed(4) : "0"} ETH</div>
                <div className="badge badge-lg badge-outline">🪙 Your BRDY: {tokenBalance ? parseFloat(formatEther(tokenBalance)).toLocaleString() : "0"}</div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full max-w-6xl">
                {/* Create Proposal */}
                <CreateProposalForm />

                {/* Proposals List */}
                <div className="space-y-4">
                    <h2 className="text-2xl font-semibold">All Proposals</h2>
                    {pCount === 0 ? (
                        <div className="card bg-base-200 p-8 text-center opacity-60">No proposals yet.</div>
                    ) : (
                        Array.from({ length: pCount }, (_, i) => i + 1)
                            .reverse()
                            .map(id => <ProposalCard key={id} proposalId={BigInt(id)} />)
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── Create Proposal Form ───
const CreateProposalForm = () => {
    const [claimId, setClaimId] = useState("");
    const [recipient, setRecipient] = useState("");
    const [amount, setAmount] = useState("");
    const [description, setDescription] = useState("");

    const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "BReadyDAO" });

    const handleSubmit = async () => {
        if (!claimId || !recipient || !amount || !description) return;
        try {
            await writeContractAsync({
                functionName: "createProposal",
                args: [BigInt(claimId), recipient, parseEther(amount), description],
            });
            setClaimId("");
            setRecipient("");
            setAmount("");
            setDescription("");
        } catch (e) {
            console.error("Create proposal error:", e);
        }
    };

    return (
        <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
                <h2 className="card-title text-2xl mb-4">📋 Create Proposal</h2>

                <div className="form-control mb-3">
                    <label className="label"><span className="label-text font-semibold">Claim ID *</span></label>
                    <input
                        type="number"
                        placeholder="e.g., 1"
                        className="input input-bordered"
                        value={claimId}
                        onChange={e => setClaimId(e.target.value)}
                    />
                    <label className="label"><span className="label-text-alt opacity-50">The approved Impact Claim to fund</span></label>
                </div>

                <div className="form-control mb-3">
                    <label className="label"><span className="label-text font-semibold">Recipient Address *</span></label>
                    <input
                        type="text"
                        placeholder="0x..."
                        className="input input-bordered"
                        value={recipient}
                        onChange={e => setRecipient(e.target.value)}
                    />
                </div>

                <div className="form-control mb-3">
                    <label className="label"><span className="label-text font-semibold">Amount (ETH) *</span></label>
                    <input
                        type="number"
                        step="0.01"
                        placeholder="e.g., 3.0"
                        className="input input-bordered"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                    />
                </div>

                <div className="form-control mb-4">
                    <label className="label"><span className="label-text font-semibold">Description *</span></label>
                    <textarea
                        placeholder="e.g., Fund Claim #1 - 12,000 meals delivered during flood"
                        className="textarea textarea-bordered"
                        rows={3}
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                    />
                </div>

                <button
                    className="btn btn-primary w-full"
                    onClick={handleSubmit}
                    disabled={isMining || !claimId || !recipient || !amount || !description}
                >
                    {isMining ? <span className="loading loading-spinner"></span> : "Submit Proposal"}
                </button>
            </div>
        </div>
    );
};

// ─── Proposal Card ───
const ProposalCard = ({ proposalId }: { proposalId: bigint }) => {
    const { address } = useAccount();

    const { data: proposalData } = useScaffoldReadContract({
        contractName: "BReadyDAO",
        functionName: "proposals",
        args: [proposalId],
    });

    const { data: statusEnum } = useScaffoldReadContract({
        contractName: "BReadyDAO",
        functionName: "getProposalStatus",
        args: [proposalId],
    });

    const { data: hasVoted } = useScaffoldReadContract({
        contractName: "BReadyDAO",
        functionName: "hasVoted",
        args: [proposalId, address],
    });

    const { writeContractAsync: voteAsync, isMining: isVoting } = useScaffoldWriteContract({ contractName: "BReadyDAO" });
    const { writeContractAsync: executeAsync, isMining: isExecuting } = useScaffoldWriteContract({ contractName: "BReadyDAO" });
    const { writeContractAsync: cancelAsync, isMining: isCanceling } = useScaffoldWriteContract({ contractName: "BReadyDAO" });

    if (!proposalData) return null;

    const [
        id, proposer, pClaimId, recipient, pAmount,
        description, forVotes, againstVotes, startTime, endTime, graceEnd,
        executed, canceled
    ] = proposalData;

    if (Number(id) === 0) return null;

    const statusLabels = ["Active", "Passed", "Failed", "Executed", "Canceled"];
    const statusColors = ["badge-warning", "badge-success", "badge-error", "badge-info", "badge-neutral"];
    const statusNum = statusEnum !== undefined ? Number(statusEnum) : 0;

    const now = Math.floor(Date.now() / 1000);
    const isActive = statusNum === 0;
    const canExecute = statusNum === 1;

    const handleVote = async (support: boolean) => {
        try {
            await voteAsync({ functionName: "vote", args: [proposalId, support] });
        } catch (e) {
            console.error("Vote error:", e);
        }
    };

    const handleExecute = async () => {
        try {
            await executeAsync({ functionName: "execute", args: [proposalId] });
        } catch (e) {
            console.error("Execute error:", e);
        }
    };

    const handleCancel = async () => {
        try {
            await cancelAsync({ functionName: "cancel", args: [proposalId] });
        } catch (e) {
            console.error("Cancel error:", e);
        }
    };

    const totalVotes = Number(forVotes) + Number(againstVotes);
    const forPct = totalVotes > 0 ? (Number(forVotes) / totalVotes) * 100 : 0;

    return (
        <div className="card bg-base-100 shadow-md border border-base-300">
            <div className="card-body py-4">
                <div className="flex justify-between items-start">
                    <h3 className="font-bold text-lg">Proposal #{id?.toString()}</h3>
                    <div className={`badge ${statusColors[statusNum]} gap-1`}>
                        {statusNum === 0 && <ClockIcon className="w-4 h-4" />}
                        {statusNum === 1 && <CheckBadgeIcon className="w-4 h-4" />}
                        {statusNum === 3 && <PlayIcon className="w-4 h-4" />}
                        {statusLabels[statusNum]}
                    </div>
                </div>
                <p className="text-sm">{description?.toString()}</p>
                <div className="text-xs opacity-60 space-y-1 mt-1">
                    <p>Claim: #{pClaimId?.toString()} | Amount: {formatEther(pAmount || 0n)} ETH</p>
                    <p>Proposer: {proposer?.toString().slice(0, 6)}...{proposer?.toString().slice(-4)}</p>
                    <p>Recipient: {recipient?.toString().slice(0, 6)}...{recipient?.toString().slice(-4)}</p>
                    <p>Voting ends: {new Date(Number(endTime) * 1000).toLocaleString()}</p>
                </div>

                {/* Vote meter */}
                <div className="mt-2">
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-success">For: {forVotes ? formatEther(forVotes) : "0"} BRDY</span>
                        <span className="text-error">Against: {againstVotes ? formatEther(againstVotes) : "0"} BRDY</span>
                    </div>
                    <div className="w-full bg-base-300 rounded-full h-3">
                        <div className="bg-success h-3 rounded-full" style={{ width: `${forPct}%` }}></div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 mt-3">
                    {isActive && !hasVoted && (
                        <>
                            <button className="btn btn-success btn-sm flex-1" onClick={() => handleVote(true)} disabled={isVoting}>
                                <HandThumbUpIcon className="w-4 h-4" /> Vote For
                            </button>
                            <button className="btn btn-error btn-sm flex-1" onClick={() => handleVote(false)} disabled={isVoting}>
                                <HandThumbDownIcon className="w-4 h-4" /> Vote Against
                            </button>
                        </>
                    )}
                    {hasVoted && isActive && <div className="badge badge-outline badge-sm">✅ You voted</div>}

                    {canExecute && (
                        <button className="btn btn-info btn-sm w-full" onClick={handleExecute} disabled={isExecuting}>
                            <PlayIcon className="w-4 h-4" /> Execute
                        </button>
                    )}

                    {isActive && address === proposer?.toString() && (
                        <button className="btn btn-ghost btn-sm" onClick={handleCancel} disabled={isCanceling}>
                            <XMarkIcon className="w-4 h-4" /> Cancel
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProposalsPage;
