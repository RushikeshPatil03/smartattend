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

  // Compute student summary percentages
  const enrichedRows = useMemo(() => {
    const totalCols = sheetColumns.length;
    return sheetRows.map((row) => {
      let attended = 0;
      sheetColumns.forEach((col) => {
        if (row.attendance[col] === "P") {
          attended += 1;
        }
      });
      const percent = totalCols > 0 ? (attended / totalCols) * 100 : 0;
      const isAtRisk = totalCols > 0 && percent < 75;
      return {
        ...row,
        attended,
        totalSessions: totalCols,
        percent,
        isAtRisk,
      };
    });
  }, [sheetRows, sheetColumns]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return enrichedRows.filter((row) => {
      if (filterAtRiskOnly && !row.isAtRisk) {
        return false;
      }
      const q = searchTerm.trim().toLowerCase();
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.enrollmentNo.toLowerCase().includes(q)
      );
    });
  }, [enrichedRows, filterAtRiskOnly, searchTerm]);

  // Overall metrics
  const classAvgPercent = useMemo(() => {
    if (!enrichedRows.length) return 0;
    const sum = enrichedRows.reduce((acc, curr) => acc + curr.percent, 0);
    return Math.round(sum / enrichedRows.length);
  }, [enrichedRows]);

  const atRiskCount = useMemo(() => {
    return enrichedRows.filter((r) => r.isAtRisk).length;
  }, [enrichedRows]);

  return (
    <div className="space-y-6">
      {/* Filters Hub Card */}
      <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100 mb-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <FileSpreadsheet size={20} className="text-emerald-600" />
              Attendance Master Matrix
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Generate date-wise attendance registers, track semester quorum, and export CSV reports
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onExportCsv}
              disabled={!sheetRows.length}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:border-emerald-400 hover:bg-emerald-50/50 shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={14} className="text-emerald-600" />
              Download CSV
            </button>
          </div>
        </div>

        {/* Filter Selection Grid */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 items-end">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Department
            </label>
            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-800 transition focus:border-emerald-500 focus:outline-none shadow-sm"
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
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Year
            </label>
            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-800 transition focus:border-emerald-500 focus:outline-none shadow-sm"
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
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Semester
            </label>
            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-800 transition focus:border-emerald-500 focus:outline-none shadow-sm"
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
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Section
            </label>
            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-800 transition focus:border-emerald-500 focus:outline-none shadow-sm"
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
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Subject <span className="text-emerald-600">*</span>
            </label>
            <div className="flex gap-2">
              <select
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-800 transition focus:border-emerald-500 focus:outline-none shadow-sm"
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
                className="inline-flex items-center gap-1.5 shrink-0 rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sheetLoading ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <List size={14} />
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
                  className="rounded-2xl border border-slate-200 bg-slate-50/60 pl-9 pr-3 py-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => setFilterAtRiskOnly(!filterAtRiskOnly)}
                className={`inline-flex items-center gap-1.5 rounded-2xl border px-3 py-2 text-xs font-bold transition ${
                  filterAtRiskOnly
                    ? "border-rose-300 bg-rose-50 text-rose-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <AlertTriangle size={13} className={filterAtRiskOnly ? "text-rose-600" : "text-slate-400"} />
                <span>Below 75% At-Risk ({atRiskCount})</span>
              </button>
            </div>

            {/* Quick Metrics Badges */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-xl bg-slate-100 px-3 py-1.5 font-semibold text-slate-700">
                Total Enrolled: <strong className="font-mono text-slate-900">{sheetRows.length}</strong>
              </span>
              <span className="rounded-xl bg-slate-100 px-3 py-1.5 font-semibold text-slate-700">
                Sessions: <strong className="font-mono text-slate-900">{sheetColumns.length}</strong>
              </span>
              <span className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-1.5 font-semibold text-emerald-800">
                Average Quorum: <strong className="font-mono text-emerald-900">{classAvgPercent}%</strong>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Roster Table Card */}
      <div className="rounded-3xl border border-slate-200/80 bg-white/90 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl overflow-hidden">
        {sheetLoading ? (
          <div className="p-8 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600 sticky top-0 backdrop-blur-md">
                <tr>
                  <th className="px-5 py-3.5">Enrollment USN</th>
                  <th className="px-5 py-3.5">Student Name</th>
                  <th className="px-4 py-3.5 text-center">Score</th>
                  {sheetColumns.map((c) => {
                    const label = c.split("::")[1] || c;
                    return (
                      <th key={c} className="px-3 py-3.5 text-center font-mono font-normal">
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
                      <p className="font-semibold text-slate-600">No attendance records loaded</p>
                      <p className="text-slate-400 mt-0.5">
                        Select your assigned subject above and click "Generate" to construct the matrix.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr
                      key={row.enrollmentNo}
                      className={`hover:bg-slate-50/80 transition ${
                        row.isAtRisk ? "bg-rose-50/20" : ""
                      }`}
                    >
                      <td className="px-5 py-3.5 font-mono font-bold text-slate-900">
                        {row.enrollmentNo}
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-slate-800">
                        {row.name}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold font-mono ${
                            row.percent >= 75
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {Math.round(row.percent)}% ({row.attended}/{row.totalSessions})
                        </span>
                      </td>
                      {sheetColumns.map((c) => {
                        const status = row.attendance[c];
                        const isPresent = status === "P";
                        return (
                          <td key={`${row.enrollmentNo}-${c}`} className="px-3 py-3.5 text-center">
                            <span
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-lg font-bold text-[10px] ${
                                isPresent
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-slate-100 text-slate-400"
                              }`}
                            >
                              {status || "A"}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
});

AttendanceRosterTable.displayName = "AttendanceRosterTable";
export default AttendanceRosterTable;
