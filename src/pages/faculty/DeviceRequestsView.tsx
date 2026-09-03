import React, { useState, useEffect } from "react";
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
  Camera,
  Database,
} from "lucide-react";
import { Badge, Button, Skeleton } from "../../components/Common";
import { DeviceRequestItem } from "./types";
import apiClient from "../../services/apiClient";

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
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [fetchedPhotos, setFetchedPhotos] = useState<{
    officialPhotoUrl: string;
    selfieDataUrl: string;
  } | null>(null);

  // Auto-fetch photos on demand if either is missing when modal opens
  useEffect(() => {
    if (!inspectingRequest) {
      setFetchedPhotos(null);
      setLoadingPhotos(false);
      return;
    }

    const reqId = inspectingRequest._id || inspectingRequest.id;
    const currentOfficial =
      inspectingRequest.student?.profilePhotoUrl ||
      (inspectingRequest.student as any)?.profile_photo_url ||
      "";
    const currentSelfie =
      inspectingRequest.selfieDataUrl ||
      (inspectingRequest as any)?.selfie_data_url ||
      "";

    if ((!currentOfficial || !currentSelfie) && reqId) {
      setLoadingPhotos(true);
      apiClient
        .getDeviceChangeRequestPhotos(reqId)
        .then((res: any) => {
          if (res?.ok) {
            setFetchedPhotos({
              officialPhotoUrl: res.officialPhotoUrl || "",
              selfieDataUrl: res.selfieDataUrl || "",
            });
          }
        })
        .catch(() => undefined)
        .finally(() => setLoadingPhotos(false));
    }
  }, [inspectingRequest]);

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

  const activeOfficialPhoto =
    inspectingRequest?.student?.profilePhotoUrl ||
    (inspectingRequest?.student as any)?.profile_photo_url ||
    fetchedPhotos?.officialPhotoUrl ||
    "";

  const activeSelfiePhoto =
    inspectingRequest?.selfieDataUrl ||
    (inspectingRequest as any)?.selfie_data_url ||
    fetchedPhotos?.selfieDataUrl ||
    "";

  return (
    <div className="space-y-6">
      {/* Top Controls Card */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white/80 p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700 shadow-xs mb-2">
              <Sparkles size={12} className="text-emerald-600" />
              Device Transition Portal
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <Smartphone size={22} className="text-emerald-600" />
              Biometric Device Change Requests
            </h2>
            <p className="text-xs text-slate-500 font-normal mt-0.5">
              Review and approve student device resets with photographic verification.
            </p>
          </div>

          <button
            type="button"
            onClick={onLoadDeviceRequests}
            disabled={deviceRequestsLoading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/90 bg-white px-4.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-xs cursor-pointer"
          >
            <RefreshCw size={13} className={deviceRequestsLoading ? "animate-spin text-emerald-600" : "text-emerald-600"} />
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
              className={`rounded-2xl px-4.5 py-2.5 text-xs font-extrabold capitalize transition-all duration-200 cursor-pointer ${
                deviceRequestStatus === status
                  ? "bg-emerald-600 text-white shadow-[0_4px_12px_rgba(16,185,129,0.25)]"
                  : "border border-slate-200/80 bg-white/70 text-slate-600 hover:bg-white hover:border-slate-300"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {deviceRequestError && (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700 shadow-xs">
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
          <div className="flex flex-col items-center justify-center rounded-[32px] border border-dashed border-slate-200/80 bg-white/70 py-16 text-center shadow-xs">
            <Smartphone size={36} className="text-slate-300 mb-2" />
            <p className="font-extrabold text-sm text-slate-800">No device requests found</p>
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

            const selfiePhoto =
              request.selfieDataUrl || (request as any).selfie_data_url || "";
            const officialPhoto =
              student.profilePhotoUrl || (student as any).profile_photo_url || "";
            const thumbnailPhoto = selfiePhoto || officialPhoto;

            return (
              <motion.div
                key={request._id || request.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-[28px] border border-white/85 bg-white/90 p-6 shadow-[0_12px_36px_-10px_rgba(0,0,0,0.05)] backdrop-blur-2xl transition hover:shadow-md"
              >
                <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] lg:grid-cols-[160px_1fr] gap-5">
                  {/* Photo Thumbnail with Compare Button */}
                  <div className="relative group overflow-hidden rounded-2xl border-2 border-slate-200 bg-slate-50 aspect-square max-w-[160px] flex items-center justify-center shadow-inner">
                    {thumbnailPhoto ? (
                      <>
                        <img
                          src={thumbnailPhoto}
                          alt="Face verification"
                          className="h-full w-full object-cover group-hover:scale-105 transition duration-300"
                        />
                        <button
                          type="button"
                          onClick={() => setInspectingRequest(request)}
                          className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/70 text-white opacity-0 group-hover:opacity-100 transition backdrop-blur-xs font-extrabold text-[11px] gap-1.5 cursor-pointer p-2 text-center"
                        >
                          <Eye size={18} />
                          <span>Compare Faces</span>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setInspectingRequest(request)}
                        className="flex flex-col items-center justify-center gap-1.5 p-3 text-slate-400 hover:text-emerald-600 transition cursor-pointer"
                      >
                        <User size={36} />
                        <span className="text-[10px] font-bold">Compare Faces</span>
                      </button>
                    )}
                    {isPending && (
                      <div className="absolute top-2 left-2 rounded-md bg-emerald-600/90 text-[9px] font-bold text-white px-1.5 py-0.5 uppercase tracking-wide">
                        {selfiePhoto ? "Live Selfie" : "Pending"}
                      </div>
                    )}
                  </div>

                  {/* Metadata and Review Controls */}
                  <div className="flex-1 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-extrabold text-base text-slate-900 tracking-tight">
                          {student.name || "Student"}
                        </h3>
                        <p className="font-mono text-xs font-bold text-emerald-700">
                          USN: {student.enrollmentNo || "-"}
                        </p>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
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
                    <div className="rounded-2xl bg-slate-50/90 p-3.5 text-xs text-slate-600 border border-slate-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div>
                        {isPending ? (
                          <span>Verify the live selfie matches the official database record before approving.</span>
                        ) : (
                          <div>
                            <span>Reviewed by: <strong className="text-slate-800">{request.reviewedBy?.name || "Faculty"}</strong></span>
                            {status === "rejected" && request.reviewNote && (
                              <p className="mt-1 text-rose-700 font-semibold">
                                Reason: <em>"{request.reviewNote}"</em>
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setInspectingRequest(request)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-2xs shrink-0 cursor-pointer"
                      >
                        <Eye size={14} className="text-emerald-600" />
                        <span>Compare Faces →</span>
                      </button>
                    </div>

                    {/* Action Form for Pending */}
                    {isPending && (
                      <div className="space-y-3 pt-2">
                        <textarea
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5 text-xs font-medium text-slate-800 placeholder-slate-400 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition"
                          rows={2}
                          placeholder="Rejection reason note (mandatory only if rejecting)..."
                          value={deviceRejectNote[request._id || request.id] || ""}
                          onChange={(e) => {
                            const id = request._id || request.id;
                            setDeviceRejectNote((prev) => ({
                              ...prev,
                              [id]: e.target.value,
                            }));
                          }}
                        />

                        <div className="flex flex-wrap items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => onReviewDeviceRequest(request._id || request.id, "approved")}
                            disabled={deviceReviewingId === (request._id || request.id)}
                            className="inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-xs font-bold text-white shadow-[0_4px_16px_rgba(16,185,129,0.3)] hover:brightness-105 transition disabled:opacity-50 cursor-pointer"
                          >
                            <CheckCircle2 size={14} />
                            <span>Approve & Reset Device</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onReviewDeviceRequest(request._id || request.id, "rejected")}
                            disabled={deviceReviewingId === (request._id || request.id)}
                            className="inline-flex items-center gap-1.5 rounded-2xl border border-rose-200 bg-rose-50 px-4.5 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition disabled:opacity-50 cursor-pointer"
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-3xl rounded-[32px] border border-white/80 bg-white p-6 sm:p-8 shadow-2xl overflow-hidden my-6"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100/80 text-emerald-700">
                    <Fingerprint size={24} />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-lg sm:text-xl text-slate-900 tracking-tight flex items-center gap-2">
                      Biometric Face Comparison
                    </h3>
                    <p className="text-xs text-slate-500 font-medium">
                      Student: <strong className="text-slate-800">{inspectingRequest.student?.name || "Student"}</strong> • USN: <strong className="text-emerald-700 font-mono">{inspectingRequest.student?.enrollmentNo || "-"}</strong>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectingRequest(null)}
                  className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Photos Comparison Grid */}
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* 1. Official College Photo (Database) */}
                <div className="flex flex-col items-center text-center p-4 rounded-3xl border border-slate-200/80 bg-slate-50/50">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-extrabold uppercase tracking-wider mb-3">
                    <Database size={12} />
                    Official Database Photo
                  </div>

                  <div className="relative h-56 w-56 rounded-2xl border-2 border-slate-300 bg-white overflow-hidden flex items-center justify-center shadow-md">
                    {loadingPhotos ? (
                      <div className="flex flex-col items-center gap-2 text-slate-400 text-xs font-semibold animate-pulse">
                        <RefreshCw size={24} className="animate-spin text-blue-500" />
                        <span>Loading database photo...</span>
                      </div>
                    ) : activeOfficialPhoto ? (
                      <img
                        src={activeOfficialPhoto}
                        alt="Official College Record"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center p-4 text-center text-slate-400">
                        <User size={48} className="text-slate-300 mb-1" />
                        <span className="text-xs font-bold text-slate-500">No Photo in Database</span>
                        <span className="text-[10px] text-slate-400 mt-0.5">Student registered without profile image</span>
                      </div>
                    )}
                  </div>

                  <p className="mt-3 font-bold text-xs text-slate-800">
                    {inspectingRequest.student?.name || "Student"}
                  </p>
                  <p className="font-mono text-[11px] text-slate-500">
                    Registered Profile Record
                  </p>
                </div>

                {/* 2. Uploaded Verification Selfie (Live Request) */}
                <div className="flex flex-col items-center text-center p-4 rounded-3xl border border-emerald-200/80 bg-emerald-50/40">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100/90 border border-emerald-300 text-emerald-800 text-[11px] font-extrabold uppercase tracking-wider mb-3">
                    <Camera size={12} />
                    Live Captured Selfie
                  </div>

                  <div className="relative h-56 w-56 rounded-2xl border-2 border-emerald-400 bg-white overflow-hidden flex items-center justify-center shadow-md">
                    {loadingPhotos ? (
                      <div className="flex flex-col items-center gap-2 text-slate-400 text-xs font-semibold animate-pulse">
                        <RefreshCw size={24} className="animate-spin text-emerald-500" />
                        <span>Loading selfie photo...</span>
                      </div>
                    ) : activeSelfiePhoto ? (
                      <img
                        src={activeSelfiePhoto}
                        alt="Live verification selfie"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center p-4 text-center text-slate-400">
                        <Camera size={48} className="text-slate-300 mb-1" />
                        <span className="text-xs font-bold text-slate-500">No Live Photo</span>
                        <span className="text-[10px] text-slate-400 mt-0.5">Photo was cleared or not provided</span>
                      </div>
                    )}
                  </div>

                  <p className="mt-3 font-mono text-xs font-extrabold text-emerald-800">
                    USN: {inspectingRequest.student?.enrollmentNo || "-"}
                  </p>
                  <p className="text-[11px] text-emerald-600 font-semibold">
                    Submitted with Device Reset Request
                  </p>
                </div>
              </div>

              {/* Status Note or Direct Review Actions */}
              <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-xs text-slate-500 font-medium text-center sm:text-left">
                  {String(inspectingRequest.status || "").toLowerCase() === "pending" ? (
                    <span>Carefully compare facial contours, eyes, and features before approving device unbinding.</span>
                  ) : (
                    <span>Status: <strong className="uppercase text-slate-800">{inspectingRequest.status}</strong></span>
                  )}
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  {String(inspectingRequest.status || "").toLowerCase() === "pending" && (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          const id = inspectingRequest._id || inspectingRequest.id;
                          await onReviewDeviceRequest(id, "approved");
                          setInspectingRequest(null);
                        }}
                        disabled={deviceReviewingId === (inspectingRequest._id || inspectingRequest.id)}
                        className="inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:brightness-105 transition disabled:opacity-50 cursor-pointer"
                      >
                        <CheckCircle2 size={14} />
                        <span>Approve</span>
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          const id = inspectingRequest._id || inspectingRequest.id;
                          await onReviewDeviceRequest(id, "rejected");
                          setInspectingRequest(null);
                        }}
                        disabled={deviceReviewingId === (inspectingRequest._id || inspectingRequest.id)}
                        className="inline-flex items-center gap-1.5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition disabled:opacity-50 cursor-pointer"
                      >
                        <XCircle size={14} />
                        <span>Reject</span>
                      </button>
                    </>
                  )}

                  <Button
                    onClick={() => setInspectingRequest(null)}
                    variant="secondary"
                    className="rounded-2xl text-xs font-bold"
                  >
                    Close
                  </Button>
                </div>
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
