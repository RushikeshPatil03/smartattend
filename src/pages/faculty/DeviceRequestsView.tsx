import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Smartphone,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Eye,
  AlertCircle,
  User,
  Fingerprint,
  X,
  Sparkles,
} from "lucide-react";
import { Badge, Button, Skeleton } from "../../components/Common";
import { DeviceRequestItem } from "./types";

interface DeviceRequestsViewProps {
  deviceRequests: DeviceRequestItem[];
  deviceRequestsLoading: boolean;
  deviceRequestStatus: "all" | "pending" | "approved" | "rejected";
  deviceRequestError: string;
  deviceRejectNote: Record<string, string>;
  deviceReviewingId: string;
  setDeviceRequestStatus: (status: "all" | "pending" | "approved" | "rejected") => void;
  setDeviceRejectNote: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onLoadDeviceRequests: () => Promise<void>;
  onReviewDeviceRequest: (
    requestId: string,
    decision: "approved" | "rejected"
  ) => Promise<void>;
}

export const DeviceRequestsView: React.FC<DeviceRequestsViewProps> = React.memo(({
  deviceRequests,
  deviceRequestsLoading,
  deviceRequestStatus,
  deviceRequestError,
  deviceRejectNote,
  deviceReviewingId,
  setDeviceRequestStatus,
  setDeviceRejectNote,
  onLoadDeviceRequests,
  onReviewDeviceRequest,
}) => {
  // Biometric inspector modal state
  const [inspectingRequest, setInspectingRequest] = useState<DeviceRequestItem | null>(null);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
        return "green";
      case "rejected":
        return "red";
      case "expired":
        return "gray";
      default:
        return "yellow";
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Card */}
      <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Smartphone size={20} className="text-emerald-600" />
              Biometric Device Change Requests
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Review and approve hardware passkey re-bindings and student device transitions
            </p>
          </div>

          <button
            type="button"
            onClick={onLoadDeviceRequests}
            disabled={deviceRequestsLoading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm"
          >
            <RefreshCw size={13} className={deviceRequestsLoading ? "animate-spin text-emerald-600" : ""} />
            <span>Refresh Feed</span>
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="mt-4 flex flex-wrap gap-2">
          {(["all", "pending", "approved", "rejected"] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setDeviceRequestStatus(status)}
              className={`rounded-2xl px-4 py-2 text-xs font-bold capitalize transition cursor-pointer ${
                deviceRequestStatus === status
                  ? "bg-emerald-600 text-white shadow-[0_4px_12px_rgba(16,185,129,0.3)]"
                  : "border border-slate-200 bg-slate-50/70 text-slate-600 hover:bg-white"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {deviceRequestError && (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
          <AlertCircle size={16} className="shrink-0" />
          <span>{deviceRequestError}</span>
        </div>
      )}

      {/* Requests Feed */}
      <div className="space-y-4">
        {deviceRequestsLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full rounded-3xl" />
            <Skeleton className="h-32 w-full rounded-3xl" />
          </div>
        ) : deviceRequests.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/60 py-16 text-center">
            <Smartphone size={32} className="text-slate-300 mb-2" />
            <p className="font-bold text-sm text-slate-700">No device requests found</p>
            <p className="text-xs text-slate-500 mt-0.5">
              There are currently no {deviceRequestStatus === "all" ? "" : deviceRequestStatus} requests for your department.
            </p>
          </div>
        ) : (
          deviceRequests.map((request) => {
            const student = request.student || {};
            const status = String(request.status || "pending").toLowerCase();
            const isPending = status === "pending";
            const expiresAt = request.expiresAt ? new Date(request.expiresAt) : null;
            const reviewedAt = request.reviewedAt ? new Date(request.reviewedAt) : null;

            return (
              <motion.div
                key={request._id || request.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-3xl border border-slate-200/80 bg-white/90 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl transition hover:shadow-md"
              >
                <div className={isPending ? "grid grid-cols-1 lg:grid-cols-[160px_1fr] gap-5" : "space-y-3"}>
                  {/* Selfie Preview for Pending */}
                  {isPending && (
                    <div className="relative group overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 aspect-square max-w-[160px] flex items-center justify-center">
                      {request.selfieDataUrl ? (
                        <>
                          <img
                            src={request.selfieDataUrl}
                            alt="Live verification"
                            className="h-full w-full object-cover group-hover:scale-105 transition duration-300"
                          />
                          <button
                            type="button"
                            onClick={() => setInspectingRequest(request)}
                            className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/50 text-white opacity-0 group-hover:opacity-100 transition backdrop-blur-xs font-bold text-[10px] gap-1 cursor-pointer"
                          >
                            <Eye size={16} /> Compare
                          </button>
                        </>
                      ) : (
                        <div className="text-xs text-slate-400 font-medium">No live photo</div>
                      )}
                    </div>
                  )}

                  {/* Metadata and Review Controls */}
                  <div className="flex-1 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-base text-slate-900">
                          {student.name || "Student"}
                        </h3>
                        <p className="font-mono text-xs font-semibold text-emerald-700">
                          USN: {student.enrollmentNo || "-"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {student.email || "-"} • Year {student.year || "-"}, Sem {student.semester || "-"}, Sec {student.section || "-"}
                        </p>
                      </div>

                      <div className="text-right">
                        <Badge color={getStatusColor(status) as any}>
                          {status.toUpperCase()}
                        </Badge>
                        <p className="text-[11px] font-mono text-slate-400 mt-1">
                          {isPending
                            ? `Expires: ${expiresAt ? expiresAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "soon"}`
                            : `Reviewed: ${reviewedAt ? reviewedAt.toLocaleDateString() : ""}`}
                        </p>
                      </div>
                    </div>

                    {/* Reviewer Note or Context */}
                    <div className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
                      {isPending ? (
                        <div className="flex items-center justify-between gap-2">
                          <span>Verify the live selfie photo matches official college records before approving.</span>
                          {request.selfieDataUrl && (
                            <button
                              type="button"
                              onClick={() => setInspectingRequest(request)}
                              className="text-emerald-700 font-bold hover:underline shrink-0"
                            >
                              Open Identity Inspector →
                            </button>
                          )}
                        </div>
                      ) : (
                        <div>
                          <span>Reviewed by: <strong className="text-slate-800">{request.reviewedBy?.name || "Faculty"}</strong></span>
                          {status === "rejected" && request.reviewNote && (
                            <p className="mt-1 text-rose-700">
                              Reason: <em>"{request.reviewNote}"</em>
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action Form for Pending */}
                    {isPending && (
                      <div className="space-y-3 pt-2">
                        <textarea
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 p-3 text-xs font-medium text-slate-800 placeholder-slate-400 focus:bg-white focus:border-emerald-500 focus:outline-none"
                          rows={2}
                          placeholder="Rejection reason note (mandatory only if rejecting)..."
                          value={deviceRejectNote[request._id] || ""}
                          onChange={(e) =>
                            setDeviceRejectNote((prev) => ({
                              ...prev,
                              [request._id]: e.target.value,
                            }))
                          }
                        />

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onReviewDeviceRequest(request._id, "approved")}
                            disabled={deviceReviewingId === request._id}
                            className="inline-flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm transition disabled:opacity-50 cursor-pointer"
                          >
                            <CheckCircle2 size={14} />
                            <span>Approve & Reset Passkey</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onReviewDeviceRequest(request._id, "rejected")}
                            disabled={deviceReviewingId === request._id}
                            className="inline-flex items-center gap-1.5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition disabled:opacity-50 cursor-pointer"
                          >
                            <XCircle size={14} />
                            <span>Reject</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Split-View Biometric Identity Inspector Modal */}
      <AnimatePresence>
        {inspectingRequest && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Fingerprint className="text-emerald-600" size={20} />
                  <h3 className="font-bold text-base text-slate-900">
                    Biometric Identity Inspector
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectingRequest(null)}
                  className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Registered Profile Photo */}
                <div className="flex flex-col items-center text-center">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Official College Photo
                  </span>
                  <div className="h-48 w-48 rounded-2xl border-2 border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center shadow-inner">
                    {inspectingRequest.student?.profilePhotoUrl ? (
                      <img
                        src={inspectingRequest.student.profilePhotoUrl}
                        alt="Official profile"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <User size={48} className="text-slate-300" />
                    )}
                  </div>
                  <p className="mt-2 font-bold text-xs text-slate-800">
                    {inspectingRequest.student?.name || "Student"}
                  </p>
                </div>

                {/* Uploaded Verification Selfie */}
                <div className="flex flex-col items-center text-center">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 mb-2">
                    Live Captured Selfie
                  </span>
                  <div className="h-48 w-48 rounded-2xl border-2 border-emerald-400 bg-emerald-50/50 overflow-hidden flex items-center justify-center shadow-md">
                    {inspectingRequest.selfieDataUrl ? (
                      <img
                        src={inspectingRequest.selfieDataUrl}
                        alt="Captured selfie"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-slate-400">No image captured</span>
                    )}
                  </div>
                  <p className="mt-2 font-mono text-xs text-emerald-700 font-bold">
                    USN: {inspectingRequest.student?.enrollmentNo || "-"}
                  </p>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end">
                <Button
                  onClick={() => setInspectingRequest(null)}
                  variant="secondary"
                  className="rounded-2xl text-xs"
                >
                  Close Inspector
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
});

DeviceRequestsView.displayName = "DeviceRequestsView";
export default DeviceRequestsView;
