"use client";

import { useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { ShieldCheckIcon, CheckCircleIcon, XCircleIcon, ClockIcon } from "@heroicons/react/24/outline";

const ClaimsPage: NextPage = () => {
    const { address } = useAccount();

    // ─── Read claims count ───
    const { data: nextClaimId } = useScaffoldReadContract({
        contractName: "ImpactClaim",
        functionName: "nextClaimId",
    });

    const { data: requiredPasses } = useScaffoldReadContract({
        contractName: "ImpactClaim",
        functionName: "requiredPasses",
    });

    const { data: isReviewer } = useScaffoldReadContract({
        contractName: "ImpactClaim",
        functionName: "isReviewer",
        args: [address],
    });

    const claimCount = nextClaimId ? Number(nextClaimId) - 1 : 0;

    return (
        <div className="flex flex-col items-center grow pt-8 px-4">
            <h1 className="text-4xl font-bold mb-2">
                <ShieldCheckIcon className="w-10 h-10 inline mr-2 text-purple-500" />
                Impact Claims
            </h1>
            <p className="opacity-60 mb-6 text-center max-w-lg">
                Submit disaster relief impact certificates, evaluate pending claims, and track approval status.
            </p>

            <div className="flex gap-4 mb-6 flex-wrap justify-center">
                <div className="badge badge-lg badge-outline">📄 {claimCount} Total Claims</div>
                <div className="badge badge-lg badge-outline">🔍 M={requiredPasses?.toString() || "-"} passes required</div>
                {isReviewer && <div className="badge badge-lg badge-success gap-1">✅ You are a Reviewer</div>}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full max-w-6xl">
                {/* Create Claim */}
                <CreateClaimForm />

                {/* Claims List */}
                <div className="space-y-4">
                    <h2 className="text-2xl font-semibold">All Claims</h2>
                    {claimCount === 0 ? (
                        <div className="card bg-base-200 p-8 text-center opacity-60">No claims yet. Be the first to submit one!</div>
                    ) : (
                        Array.from({ length: claimCount }, (_, i) => i + 1)
                            .reverse()
                            .map(id => <ClaimCard key={id} claimId={BigInt(id)} isReviewer={!!isReviewer} />)
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── Create Claim Form ───
const CreateClaimForm = () => {
    const [recipient, setRecipient] = useState("");
    const [tokenURI, setTokenURI] = useState("");
    const [impactScope, setImpactScope] = useState("");
    const [impactStart, setImpactStart] = useState("");
    const [impactEnd, setImpactEnd] = useState("");

    const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "ImpactClaim" });

    const handleSubmit = async () => {
        if (!recipient || !impactScope) return;
        const start = impactStart ? BigInt(Math.floor(new Date(impactStart).getTime() / 1000)) : BigInt(0);
        const end = impactEnd ? BigInt(Math.floor(new Date(impactEnd).getTime() / 1000)) : BigInt(Math.floor(Date.now() / 1000));

        try {
            await writeContractAsync({
                functionName: "createClaim",
                args: [recipient, tokenURI || "", impactScope, start, end],
            });
            setRecipient("");
            setTokenURI("");
            setImpactScope("");
            setImpactStart("");
            setImpactEnd("");
        } catch (e) {
            console.error("Create claim error:", e);
        }
    };

    return (
        <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
                <h2 className="card-title text-2xl mb-4">📝 Submit New Claim</h2>

                <div className="form-control mb-3">
                    <label className="label"><span className="label-text font-semibold">Recipient Address *</span></label>
                    <input
                        type="text"
                        placeholder="0x..."
                        className="input input-bordered"
                        value={recipient}
                        onChange={e => setRecipient(e.target.value)}
                    />
                    <label className="label"><span className="label-text-alt opacity-50">Address that will receive funding</span></label>
                </div>

                <div className="form-control mb-3">
                    <label className="label"><span className="label-text font-semibold">Impact Scope *</span></label>
                    <input
                        type="text"
                        placeholder="e.g., Flood relief - 12,000 meals delivered"
                        className="input input-bordered"
                        value={impactScope}
                        onChange={e => setImpactScope(e.target.value)}
                    />
                </div>

                <div className="form-control mb-3">
                    <label className="label"><span className="label-text font-semibold">Evidence URI</span></label>
                    <input
                        type="text"
                        placeholder="ipfs://... or https://..."
                        className="input input-bordered"
                        value={tokenURI}
                        onChange={e => setTokenURI(e.target.value)}
                    />
                    <label className="label"><span className="label-text-alt opacity-50">Link to receipts, photos, delivery logs</span></label>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="form-control">
                        <label className="label"><span className="label-text font-semibold">Impact Start</span></label>
                        <input
                            type="datetime-local"
                            className="input input-bordered"
                            value={impactStart}
                            onChange={e => setImpactStart(e.target.value)}
                        />
                    </div>
                    <div className="form-control">
                        <label className="label"><span className="label-text font-semibold">Impact End</span></label>
                        <input
                            type="datetime-local"
                            className="input input-bordered"
                            value={impactEnd}
                            onChange={e => setImpactEnd(e.target.value)}
                        />
                    </div>
                </div>

                <button
                    className="btn btn-primary w-full"
                    onClick={handleSubmit}
                    disabled={isMining || !recipient || !impactScope}
                >
                    {isMining ? <span className="loading loading-spinner"></span> : "Submit Impact Claim"}
                </button>
            </div>
        </div>
    );
};

// ─── Claim Card ───
const ClaimCard = ({ claimId, isReviewer }: { claimId: bigint; isReviewer: boolean }) => {
    const { address } = useAccount();
    const [evidenceURI, setEvidenceURI] = useState("");

    const { data: claimData } = useScaffoldReadContract({
        contractName: "ImpactClaim",
        functionName: "claims",
        args: [claimId],
    });

    const { data: hasEvaluated } = useScaffoldReadContract({
        contractName: "ImpactClaim",
        functionName: "hasEvaluated",
        args: [address, claimId],
    });

    const { writeContractAsync: evaluateAsync, isMining } = useScaffoldWriteContract({ contractName: "ImpactClaim" });

    if (!claimData || !claimData[0] || claimData[0] === "0x0000000000000000000000000000000000000000") return null;

    const [creator, recipient, tokenURI, impactScope, impactStart, impactEnd, status, passCount, totalEvals] = claimData;

    const statusLabels = ["Pending", "Approved", "Funded"];
    const statusColors = ["badge-warning", "badge-success", "badge-info"];
    const statusIcons = [
        <ClockIcon key="p" className="w-4 h-4" />,
        <CheckCircleIcon key="a" className="w-4 h-4" />,
        <ShieldCheckIcon key="f" className="w-4 h-4" />,
    ];

    const statusNum = Number(status);

    const handleEvaluate = async (pass: boolean) => {
        try {
            await evaluateAsync({
                functionName: "evaluate",
                args: [claimId, pass, evidenceURI],
            });
            setEvidenceURI("");
        } catch (e) {
            console.error("Evaluate error:", e);
        }
    };

    return (
        <div className="card bg-base-100 shadow-md border border-base-300">
            <div className="card-body py-4">
                <div className="flex justify-between items-start">
                    <h3 className="font-bold text-lg">Claim #{claimId.toString()}</h3>
                    <div className={`badge ${statusColors[statusNum]} gap-1`}>
                        {statusIcons[statusNum]} {statusLabels[statusNum]}
                    </div>
                </div>
                <p className="text-sm font-medium">{impactScope}</p>
                <div className="text-xs opacity-60 space-y-1 mt-1">
                    <p>Creator: {creator?.toString().slice(0, 6)}...{creator?.toString().slice(-4)}</p>
                    <p>Recipient: {recipient?.toString().slice(0, 6)}...{recipient?.toString().slice(-4)}</p>
                    {tokenURI && (
                        <p>Evidence: <a href={tokenURI?.toString()} target="_blank" rel="noreferrer" className="link link-primary">{tokenURI?.toString().slice(0, 40)}...</a></p>
                    )}
                    <p>Period: {new Date(Number(impactStart) * 1000).toLocaleDateString()} — {new Date(Number(impactEnd) * 1000).toLocaleDateString()}</p>
                    <p>Evaluations: {passCount?.toString()} passes / {totalEvals?.toString()} total</p>
                </div>

                {/* Evaluate buttons */}
                {isReviewer && statusNum === 0 && !hasEvaluated && (
                    <div className="mt-3 border-t border-base-300 pt-3">
                        <p className="text-xs font-semibold mb-2">📋 Your Evaluation:</p>
                        <input
                            type="text"
                            placeholder="Evidence URI (optional)"
                            className="input input-bordered input-sm w-full mb-2"
                            value={evidenceURI}
                            onChange={e => setEvidenceURI(e.target.value)}
                        />
                        <div className="flex gap-2">
                            <button
                                className="btn btn-success btn-sm flex-1"
                                onClick={() => handleEvaluate(true)}
                                disabled={isMining}
                            >
                                <CheckCircleIcon className="w-4 h-4" /> Pass
                            </button>
                            <button
                                className="btn btn-error btn-sm flex-1"
                                onClick={() => handleEvaluate(false)}
                                disabled={isMining}
                            >
                                <XCircleIcon className="w-4 h-4" /> Fail
                            </button>
                        </div>
                    </div>
                )}
                {hasEvaluated && statusNum === 0 && (
                    <div className="mt-2 badge badge-outline badge-sm">✅ You've already evaluated</div>
                )}
            </div>
        </div>
    );
};

export default ClaimsPage;
