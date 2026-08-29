import React, { useMemo, useState } from "react";
import {
  Download,
  Filter,
  List,
  RefreshCw,
  Search,
  Users,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  FileSpreadsheet,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { Badge, Button, Skeleton } from "../../components/Common";

interface SheetRow {
  name: string;
  enrollmentNo: string;
  attendance: Record<string, "P" | "A">;
}

interface AttendanceRosterTableProps {
  departments: any[];
  mySubjects: any[];
  sheetFilters: {
    departmentId: string;
    year: string;
    semester: string;
    section: string;
    subjectId: string;
  };
  sheetColumns: string[];
  sheetRows: SheetRow[];
  sheetLoading: boolean;
  setSheetFilters: React.Dispatch<
    React.SetStateAction<{
      departmentId: string;
      year: string;
      semester: string;
      section: string;
      subjectId: string;
    }>
  >;
  onLoadSheet: () => Promise<void>;
  onExportCsv: () => void;
}

export const AttendanceRosterTable: React.FC<AttendanceRosterTableProps> = React.memo(({
  departments,
  mySubjects,
  sheetFilters,
  sheetColumns,
  sheetRows,
  sheetLoading,
  setSheetFilters,
  onLoadSheet,
  onExportCsv,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterAtRiskOnly, setFilterAtRiskOnly] = useState(false);

  // Compute student summary percentages + risk tier (single pass, O(n·cols))
  const enrichedRows = useMemo(() => {
    const totalCols = sheetColumns.length;
    return sheetRows.map((row) => {
      let attended = 0;
      for (let i = 0; i < sheetColumns.length; i++) {
        if (row.attendance[sheetColumns[i]] === "P") attended++;
      }
      const percent    = totalCols > 0 ? (attended / totalCols) * 100 : 0;
      const isCritical = totalCols > 0 && percent < 60;          // < 60%  → rose row
      const isWarning  = totalCols > 0 && percent >= 60 && percent < 75; // 60–74% → amber row
      const isAtRisk   = isCritical || isWarning;
      return { ...row, attended, totalSessions: totalCols, percent, isCritical, isWarning, isAtRisk };
    });
  }, [sheetRows, sheetColumns]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return enrichedRows.filter((row) => {
      if (filterAtRiskOnly && !row.isAtRisk) return false;
      if (!q) return true;
      return row.name.toLowerCase().includes(q) || row.enrollmentNo.toLowerCase().includes(q);
    });
  }, [enrichedRows, filterAtRiskOnly, searchTerm]);

  // Overall metrics (single pass)
  const { classAvgPercent, atRiskCount, criticalCount } = useMemo(() => {
    if (!enrichedRows.length) return { classAvgPercent: 0, atRiskCount: 0, criticalCount: 0 };
    let sum = 0, atRisk = 0, critical = 0;
    for (const row of enrichedRows) {
      sum += row.percent;
      if (row.isAtRisk)   atRisk++;
      if (row.isCritical) critical++;
    }
    return { classAvgPercent: Math.round(sum / enrichedRows.length), atRiskCount: atRisk, criticalCount: critical };
  }, [enrichedRows]);

  return (
    <div className="space-y-6">
      {/* Filters Hub Card */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white/80 p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100 mb-5">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700 shadow-xs mb-2">
              <Sparkles size={12} className="text-emerald-600" />
              Attendance Master Ledger
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <FileSpreadsheet size={22} className="text-emerald-600" />
              Attendance Master Matrix
            </h2>
            <p className="text-xs text-slate-500 font-normal mt-0.5">
              Generate date-wise attendance registers, track class quorum, and export CSV reports.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onExportCsv}
              disabled={!sheetRows.length}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/90 bg-white px-4.5 py-2.5 text-xs font-bold text-slate-700 hover:border-emerald-400 hover:bg-emerald-50/50 shadow-xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={15} className="text-emerald-600" />
              Download CSV
            </button>
          </div>
        </div>

        {/* Filter Selection Grid */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 items-end">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Department
            </label>
            <select
              className="w-full rounded-2xl border border-slate-200/90 bg-white px-3.5 py-3 text-xs font-semibold text-slate-800 transition-all duration-200 focus:border-emerald-500/90 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 shadow-xs hover:border-slate-300"
              value={sheetFilters.departmentId}
              onChange={(e) =>
                setSheetFilters((p) => ({ ...p, departmentId: e.target.value }))
              }
            >
              <option value="">All Departments</option>
              {departments.map((d: any) => (
                <option key={d._id || d.id} value={d._id || d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Year
            </label>
            <select
              className="w-full rounded-2xl border border-slate-200/90 bg-white px-3.5 py-3 text-xs font-semibold text-slate-800 transition-all duration-200 focus:border-emerald-500/90 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 shadow-xs hover:border-slate-300"
              value={sheetFilters.year}
              onChange={(e) =>
                setSheetFilters((p) => ({ ...p, year: e.target.value }))
              }
            >
              <option value="">All Years</option>
              {[1, 2, 3, 4].map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Semester
            </label>
            <select
              className="w-full rounded-2xl border border-slate-200/90 bg-white px-3.5 py-3 text-xs font-semibold text-slate-800 transition-all duration-200 focus:border-emerald-500/90 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 shadow-xs hover:border-slate-300"
              value={sheetFilters.semester}
              onChange={(e) =>
                setSheetFilters((p) => ({ ...p, semester: e.target.value }))
              }
            >
              <option value="">All Semesters</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <option key={s} value={s}>
                  Semester {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Section
            </label>
            <select
              className="w-full rounded-2xl border border-slate-200/90 bg-white px-3.5 py-3 text-xs font-semibold text-slate-800 transition-all duration-200 focus:border-emerald-500/90 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 shadow-xs hover:border-slate-300"
              value={sheetFilters.section}
              onChange={(e) =>
                setSheetFilters((p) => ({ ...p, section: e.target.value }))
              }
            >
              <option value="">All Sections</option>
              {["A", "B", "C", "D"].map((sec) => (
                <option key={sec} value={sec}>
                  Section {sec}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Subject <span className="text-emerald-600">*</span>
            </label>
            <div className="flex gap-2">
              <select
                className="w-full rounded-2xl border border-slate-200/90 bg-white px-3.5 py-3 text-xs font-semibold text-slate-800 transition-all duration-200 focus:border-emerald-500/90 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 shadow-xs hover:border-slate-300"
                value={sheetFilters.subjectId}
                onChange={(e) =>
                  setSheetFilters((p) => ({ ...p, subjectId: e.target.value }))
                }
              >
                <option value="">-- Choose Subject --</option>
                {mySubjects.map((s: any) => (
                  <option key={s._id || s.id} value={s._id || s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={onLoadSheet}
                disabled={sheetLoading || !sheetFilters.subjectId}
                className="inline-flex items-center gap-1.5 shrink-0 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-5 py-3 text-xs font-extrabold text-white shadow-[0_8px_20px_-4px_rgba(16,185,129,0.35)] hover:shadow-[0_12px_24px_-4px_rgba(16,185,129,0.45)] hover:brightness-105 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sheetLoading ? (
                  <RefreshCw size={15} className="animate-spin" />
                ) : (
                  <List size={15} />
                )}
                <span>Generate</span>
              </button>
            </div>
          </div>
        </div>

        {/* Quick Search & Summary Stats */}
        {sheetRows.length > 0 && (
          <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            {/* Search & At-Risk Toggle */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search student or USN..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="rounded-2xl border border-slate-200 bg-slate-50/70 pl-9 pr-3.5 py-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
                />
              </div>

              <button
                type="button"
                onClick={() => setFilterAtRiskOnly(!filterAtRiskOnly)}
                className={`inline-flex items-center gap-1.5 rounded-2xl border px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
                  filterAtRiskOnly
                    ? "border-rose-300 bg-rose-50 text-rose-700 shadow-2xs"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <AlertTriangle size={13} className={filterAtRiskOnly ? "text-rose-600" : "text-slate-400"} />
                <span>Below 75% At-Risk ({atRiskCount})</span>
              </button>
            </div>

            {/* Quick Metrics Badges */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-xl bg-slate-100 px-3 py-1.5 font-semibold text-slate-700 border border-slate-200/60 shadow-2xs">
                Total Enrolled: <strong className="font-mono text-slate-900">{sheetRows.length}</strong>
              </span>
              <span className="rounded-xl bg-slate-100 px-3 py-1.5 font-semibold text-slate-700 border border-slate-200/60 shadow-2xs">
                Sessions: <strong className="font-mono text-slate-900">{sheetColumns.length}</strong>
              </span>
              <span className={`rounded-xl px-3 py-1.5 font-semibold border shadow-2xs ${
                classAvgPercent >= 75
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : classAvgPercent >= 60
                    ? "bg-amber-50 border-amber-200 text-amber-800"
                    : "bg-rose-50 border-rose-200 text-rose-800"
              }`}>
                Avg Quorum: <strong className="font-mono">{classAvgPercent}%</strong>
              </span>
              {criticalCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-xl bg-rose-50 border border-rose-300 px-3 py-1.5 font-semibold text-rose-800 shadow-2xs">
                  <AlertTriangle size={11} className="text-rose-600" />
                  Critical (&lt;60%): <strong className="font-mono ml-0.5">{criticalCount}</strong>
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Roster Table Card ─────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200/80 bg-white/80 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl overflow-hidden">
        {sheetLoading ? (
          <div className="p-8 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <>
            {/* ── Heatmap legend — only when data is loaded ── */}
            {sheetRows.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-100 bg-slate-50/80 px-5 py-2.5 text-[11px] font-semibold">
                <span className="text-slate-500 font-bold uppercase tracking-wider">Legend:</span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-flex h-5 w-7 items-center justify-center rounded border border-emerald-200 bg-emerald-50 text-[10px] font-bold text-emerald-800">P</span>
                  <span className="text-slate-600">Present</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-flex h-5 w-7 items-center justify-center rounded border border-rose-200 bg-rose-50 text-[10px] font-bold text-rose-700">A</span>
                  <span className="text-slate-600">Absent</span>
                </span>
                <span className="h-4 w-px bg-slate-200" />
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-1 rounded-full bg-amber-400 inline-block shrink-0" />
                  <span className="text-slate-600">Row: 60–74% Warning</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-1 rounded-full bg-rose-500 inline-block shrink-0" />
                  <span className="text-slate-600">Row: &lt;60% Critical</span>
                </span>
              </div>
            )}

            <div className="w-full overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-extrabold uppercase tracking-wider text-slate-600 sticky top-0 backdrop-blur-md">
                  <tr>
                    <th className="px-5 py-4 whitespace-nowrap">Enrollment USN</th>
                    <th className="px-5 py-4 whitespace-nowrap">Student Name</th>
                    <th className="px-4 py-4 text-center whitespace-nowrap">Quorum Score</th>
                    {sheetColumns.map((c) => {
                      const label = c.split("::")[1] || c;
                      return (
                        <th
                          key={c}
                          className="px-3 py-4 text-center font-mono font-semibold whitespace-nowrap hover:bg-slate-100 transition"
                          title={c}
                        >
                          {label}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3 + sheetColumns.length}
                        className="px-6 py-16 text-center text-slate-400 text-xs"
                      >
                        <Users size={32} className="mx-auto mb-2 text-slate-300" />
                        <p className="font-bold text-sm text-slate-700">No attendance records loaded</p>
                        <p className="text-slate-400 text-xs mt-0.5">
                          Select your assigned subject above and click "Generate" to construct the matrix.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => {
                      // ── Row background + left accent border by risk tier ──────
                      const rowBg =
                        row.isCritical
                          ? "bg-rose-50  border-l-4 border-rose-500"
                          : row.isWarning
                            ? "bg-amber-50 border-l-4 border-amber-400"
                            : "bg-white";
                      const rowHover =
                        row.isCritical
                          ? "hover:bg-rose-100/60"
                          : row.isWarning
                            ? "hover:bg-amber-100/60"
                            : "hover:bg-slate-50/70";

                      // ── 3-tier quorum badge ───────────────────────────────────
                      const pctBadge =
                        row.isCritical
                          ? "bg-rose-100 text-rose-800 border border-rose-400"
                          : row.isWarning
                            ? "bg-amber-100 text-amber-800 border border-amber-400"
                            : "bg-emerald-100 text-emerald-800 border border-emerald-300";

                      return (
                        <tr
                          key={row.enrollmentNo}
                          className={`transition-colors ${rowBg} ${rowHover}`}
                        >
                          {/* Enrollment No */}
                          <td className="px-5 py-3.5 font-mono font-bold text-slate-900 whitespace-nowrap">
                            {row.enrollmentNo}
                          </td>

                          {/* Student Name + risk icon */}
                          <td className="px-5 py-3.5 font-semibold text-slate-800 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {row.isCritical && (
                                <AlertTriangle
                                  size={12}
                                  className="shrink-0 text-rose-500"
                                  aria-label="Critical: below 60%"
                                />
                              )}
                              {row.isWarning && (
                                <AlertTriangle
                                  size={12}
                                  className="shrink-0 text-amber-500"
                                  aria-label="Warning: 60–74%"
                                />
                              )}
                              <span className="truncate max-w-[160px]" title={row.name}>
                                {row.name}
                              </span>
                            </div>
                          </td>

                          {/* Quorum % badge */}
                          <td className="px-4 py-3.5 text-center whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold font-mono shadow-2xs ${pctBadge}`}
                            >
                              {Math.round(row.percent)}%{" "}
                              <span className="font-normal opacity-70">
                                ({row.attended}/{row.totalSessions})
                              </span>
                            </span>
                          </td>

                          {/* Per-session heatmap cells — P: emerald-50, A: rose-50 */}
                          {sheetColumns.map((c) => {
                            const status = row.attendance[c];
                            const isPresent = status === "P";
                            return (
                              <td
                                key={`${row.enrollmentNo}-${c}`}
                                className="px-2 py-3.5 text-center"
                              >
                                <span
                                  className={`inline-flex h-6 w-7 items-center justify-center rounded-md text-[10px] font-bold ${
                                    isPresent
                                      ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                      : "bg-rose-50 text-rose-700 border border-rose-200"
                                  }`}
                                >
                                  {status || "A"}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

AttendanceRosterTable.displayName = "AttendanceRosterTable";
export default AttendanceRosterTable;
