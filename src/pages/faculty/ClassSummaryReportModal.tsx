import React, { useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Users,
  UserCheck,
  UserX,
  FileSpreadsheet,
  Download,
  PlusCircle,
  X,
  Search,
  Check,
  Sparkles,
  Calendar,
  Clock,
  ShieldCheck,
  BookOpen,
} from "lucide-react";
import { FinalizedClassSummary } from "./types";

interface ClassSummaryReportModalProps {
  isOpen: boolean;
  summary: FinalizedClassSummary | null;
  onClose: () => void;
  onViewAttendanceSheet: (summary: FinalizedClassSummary) => void;
  onStartNextClass: () => void;
}

export const ClassSummaryReportModal: React.FC<ClassSummaryReportModalProps> = React.memo(({
  isOpen,
  summary,
  onClose,
  onViewAttendanceSheet,
  onStartNextClass,
}) => {
  const [activeRosterTab, setActiveRosterTab] = useState<"all" | "present" | "absent">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedCsv, setCopiedCsv] = useState(false);

  const formattedDate = useMemo(() => {
    if (!summary?.startTime) return new Date().toLocaleDateString();
    const d = new Date(summary.startTime);
    return d.toLocaleDateString([], {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, [summary?.startTime]);

  const formattedTime = useMemo(() => {
    if (!summary?.startTime) return new Date().toLocaleTimeString();
    const d = new Date(summary.startTime);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [summary?.startTime]);

  // Filtered attendees for the preview list
  const filteredAttendees = useMemo(() => {
    let list = summary?.attendees || [];
    if (activeRosterTab === "present") {
      list = list.filter((a) => a.status === "present");
    } else if (activeRosterTab === "absent") {
      list = list.filter((a) => a.status === "absent");
    }

    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.enrollmentNo.toLowerCase().includes(q)
    );
  }, [summary?.attendees, activeRosterTab, searchQuery]);

  // Export CSV Handler
  const handleExportCsv = useCallback(() => {
    if (!summary) return;

    const esc = (v: any) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const header = [
      `"SmartAttend Class Attendance Report"`,
      `"Subject: ${summary.subjectCode} - ${summary.subjectName}"`,
      `"Department: ${summary.departmentName} (Section ${summary.section})"`,
      `"Date: ${formattedDate} ${formattedTime}"`,
      `"Total Quorum: ${summary.totalStrength} | Present: ${summary.presentCount} | Absent: ${summary.absentCount} | Attendance: ${summary.attendancePercentage}%"`,
      "",
      ["#", "Enrollment Number", "Student Name", "Status", "Timestamp"].map(esc).join(","),
    ];

    const rows = summary.attendees.map((att, idx) => {
      const timeStr = att.timestamp
        ? new Date(att.timestamp).toLocaleTimeString()
        : "-";
      return [
        idx + 1,
        esc(att.enrollmentNo),
        esc(att.name),
        att.status === "present" ? "Present" : "Absent",
        esc(timeStr),
      ].join(",");
    });

    const csvContent = [...header, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeSubCode = (summary.subjectCode || "Class").replace(/[^a-zA-Z0-9_-]/g, "_");
    link.href = url;
    link.download = `Attendance_${safeSubCode}_Sec${summary.section}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    setCopiedCsv(true);
    setTimeout(() => setCopiedCsv(false), 2500);
  }, [summary, formattedDate, formattedTime]);

  const pctNumber = parseFloat(summary?.attendancePercentage || "0") || 0;

  if (!isOpen || !summary) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-md animate-in fade-in duration-200">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="relative my-6 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[32px] border border-white/40 bg-white shadow-[0_24px_70px_rgba(0,0,0,0.25)]"
      >
        {/* Header Hero Banner */}
        <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-7 py-6 text-white border-b border-emerald-500/20">
          <div className="absolute -top-16 -right-16 h-60 w-60 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.3)_0%,transparent_70%)] blur-2xl pointer-events-none" />

          <div className="relative z-10 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2.5 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-3.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-emerald-300 shadow-2xs">
                <Sparkles size={13} className="text-emerald-400" />
                <span>Attendance Saved Successfully</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
                <span>🎉</span>
                <span>
                  {summary.subjectCode} - {summary.subjectName}
                </span>
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2.5 text-xs text-slate-300 font-medium">
                <span className="inline-flex items-center gap-1 bg-white/10 px-2.5 py-0.5 rounded-lg border border-white/10 text-white font-semibold">
                  <BookOpen size={13} className="text-emerald-400" />
                  Section {summary.section}
                </span>
                <span className="text-slate-400">•</span>
                <span>{summary.departmentName}</span>
                <span className="text-slate-400">•</span>
                <span className="inline-flex items-center gap-1 text-slate-300">
                  <Calendar size={13} /> {formattedDate}
                </span>
                <span className="inline-flex items-center gap-1 text-slate-400 font-mono">
                  <Clock size={13} /> {formattedTime}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
              title="Close summary"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="overflow-y-auto p-6 sm:p-7 space-y-6 bg-slate-50/50">
          {/* Main KPI Stats Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            {/* Total Strength */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
              <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-wider">
                <Users size={15} className="text-slate-600" />
                <span>Total Strength</span>
              </div>
              <p className="mt-2 font-mono text-2xl font-black text-slate-900">
                {summary.totalStrength}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400 font-medium">Enrolled Students</p>
            </div>

            {/* Verified Present */}
            <div className="rounded-2xl border border-emerald-200/90 bg-emerald-50/80 p-4 shadow-2xs">
              <div className="flex items-center gap-2 text-emerald-800 text-xs font-bold uppercase tracking-wider">
                <UserCheck size={15} className="text-emerald-600" />
                <span>Present</span>
              </div>
              <p className="mt-2 font-mono text-2xl font-black text-emerald-700">
                {summary.presentCount}
              </p>
              <p className="mt-0.5 text-[11px] text-emerald-600/80 font-medium">Verified check-ins</p>
            </div>

            {/* Absentees */}
            <div className="rounded-2xl border border-rose-200/90 bg-rose-50/80 p-4 shadow-2xs">
              <div className="flex items-center gap-2 text-rose-800 text-xs font-bold uppercase tracking-wider">
                <UserX size={15} className="text-rose-600" />
                <span>Absent</span>
              </div>
              <p className="mt-2 font-mono text-2xl font-black text-rose-700">
                {summary.absentCount}
              </p>
              <p className="mt-0.5 text-[11px] text-rose-600/80 font-medium">Unverified/absent</p>
            </div>

            {/* Attendance % */}
            <div className="rounded-2xl border border-teal-200/90 bg-teal-50/80 p-4 shadow-2xs">
              <div className="flex items-center gap-2 text-teal-800 text-xs font-bold uppercase tracking-wider">
                <ShieldCheck size={15} className="text-teal-600" />
                <span>Attendance</span>
              </div>
              <p className="mt-2 font-mono text-2xl font-black text-teal-700">
                {summary.attendancePercentage}%
              </p>
              {/* Progress bar indicator */}
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    pctNumber >= 75
                      ? "bg-emerald-500"
                      : pctNumber >= 50
                      ? "bg-amber-500"
                      : "bg-rose-500"
                  }`}
                  style={{ width: `${Math.min(100, pctNumber)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Mini Roster Explorer */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 shadow-2xs space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100">
              {/* Tabs */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl border border-slate-200/60 w-fit">
                <button
                  type="button"
                  onClick={() => setActiveRosterTab("all")}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                    activeRosterTab === "all"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  All ({summary.attendees.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveRosterTab("present")}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition cursor-pointer flex items-center gap-1 ${
                    activeRosterTab === "present"
                      ? "bg-emerald-600 text-white shadow-2xs"
                      : "text-emerald-700 hover:bg-emerald-50"
                  }`}
                >
                  <Check size={12} /> Present ({summary.presentCount})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveRosterTab("absent")}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition cursor-pointer flex items-center gap-1 ${
                    activeRosterTab === "absent"
                      ? "bg-rose-600 text-white shadow-2xs"
                      : "text-rose-700 hover:bg-rose-50"
                  }`}
                >
                  <X size={12} /> Absent ({summary.absentCount})
                </button>
              </div>

              {/* Quick Search */}
              <div className="relative max-w-xs w-full">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter student or USN..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-8 pr-3 py-1.5 text-xs font-medium text-slate-800 placeholder-slate-400 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 transition"
                />
              </div>
            </div>

            {/* Attendee Items List */}
            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {filteredAttendees.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 font-medium">
                  No students found matching the selected filter.
                </div>
              ) : (
                filteredAttendees.map((att) => (
                  <div
                    key={att.enrollmentNo}
                    className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-100/60 px-3 py-2 text-xs transition duration-150"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono text-slate-500 font-semibold bg-white px-2 py-0.5 rounded border border-slate-200 text-[11px]">
                        {att.enrollmentNo}
                      </span>
                      <span className="font-bold text-slate-800 truncate">{att.name}</span>
                    </div>

                    <div className="shrink-0">
                      {att.status === "present" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100/80 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-800 border border-emerald-200">
                          <Check size={11} /> Present
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100/80 px-2.5 py-0.5 text-[10px] font-extrabold text-rose-800 border border-rose-200">
                          <X size={11} /> Absent
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer Action Buttons */}
        <div className="border-t border-slate-200 bg-white px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleExportCsv}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-2.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 hover:border-slate-400 active:scale-95 transition shadow-2xs cursor-pointer"
          >
            {copiedCsv ? (
              <>
                <Check size={15} className="text-emerald-600" />
                <span className="text-emerald-700 font-bold">CSV Exported!</span>
              </>
            ) : (
              <>
                <Download size={15} className="text-slate-600" />
                <span>Export CSV</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => onViewAttendanceSheet(summary)}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-2xl border border-teal-300 bg-teal-50 px-5 py-2.5 text-xs font-extrabold text-teal-800 hover:bg-teal-100 hover:border-teal-400 active:scale-95 transition shadow-2xs cursor-pointer"
            >
              <FileSpreadsheet size={15} className="text-teal-700" />
              <span>View in Attendance Sheet</span>
            </button>

            <button
              type="button"
              onClick={onStartNextClass}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-6 py-2.5 text-xs font-black text-white shadow-[0_8px_20px_-4px_rgba(16,185,129,0.4)] hover:brightness-105 active:scale-95 transition cursor-pointer"
            >
              <PlusCircle size={15} />
              <span>Start Next Class</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
});

ClassSummaryReportModal.displayName = "ClassSummaryReportModal";
export default ClassSummaryReportModal;
