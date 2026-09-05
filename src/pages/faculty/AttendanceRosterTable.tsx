import React, { useDeferredValue, useEffect, useMemo, useRef, useState, useCallback } from "react";
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
  Zap,
  Layers,
  Eye,
  Edit3,
  MoreVertical,
  CheckCircle2,
  XCircle,
  Trash2,
  Check,
  Save,
  X,
} from "lucide-react";
import { Badge, Button, Skeleton } from "../../components/Common";
import apiClient from "../../services/apiClient";

export interface AssignedClassOption {
  key: string;
  classCode: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  year: number | string;
  semester: number | string;
  section: string;
  label: string;
}

interface SheetRow {
  name: string;
  enrollmentNo: string;
  attendance: Record<string, "P" | "A">;
}

interface EnrichedSheetRow extends SheetRow {
  attended: number;
  totalSessions: number;
  percent: number;
  isCritical: boolean;
  isWarning: boolean;
  isAtRisk: boolean;
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
  onLoadSheet: (force?: boolean) => Promise<void>;
  onExportCsv: () => void;
}

const ROW_HEIGHT = 48; // Constant row height in px for 60fps windowing
const OVERSCAN = 6; // Extra buffer rows above and below viewport

/**
 * High-performance, concurrent-safe virtual scroll windowing hook
 */
function useVirtualScroll({
  itemCount,
  itemHeight,
  overscan = OVERSCAN,
  containerRef,
}: {
  itemCount: number;
  itemHeight: number;
  overscan?: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(560);
  const rafIdRef = useRef<number | null>(null);

  // ResizeObserver to dynamically adapt to parent container height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (el.clientHeight > 0) {
      setContainerHeight(el.clientHeight);
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === el) {
          const height = entry.contentRect.height || el.clientHeight;
          if (height > 0) {
            setContainerHeight(height);
          }
        }
      }
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [containerRef]);

  // High-performance scroll listener throttled with requestAnimationFrame
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      if (rafIdRef.current !== null) return;
      rafIdRef.current = requestAnimationFrame(() => {
        if (containerRef.current) {
          setScrollTop(containerRef.current.scrollTop);
        }
        rafIdRef.current = null;
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [containerRef]);

  const totalHeight = itemCount * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    itemCount,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const paddingTop = startIndex * itemHeight;
  const paddingBottom = Math.max(0, (itemCount - endIndex) * itemHeight);

  return {
    startIndex,
    endIndex,
    paddingTop,
    paddingBottom,
    totalHeight,
  };
}

/**
 * Memoized single row component to prevent unnecessary re-renders of off-screen or unchanged rows
 */
const AttendanceTableRow = React.memo<{
  row: EnrichedSheetRow;
  sheetColumns: string[];
  tableMode: "view" | "edit";
  stagedChanges: Map<string, "P" | "A">;
  toggleCell: (enrollmentNo: string, sessionId: string, next: "P" | "A") => void;
}>(({ row, sheetColumns, tableMode, stagedChanges, toggleCell }) => {
  // Row background + left accent border by risk tier
  const rowBg = row.isCritical
    ? "bg-rose-50 border-l-4 border-rose-500"
    : row.isWarning
    ? "bg-amber-50 border-l-4 border-amber-400"
    : "bg-white";

  const rowHover = row.isCritical
    ? "hover:bg-rose-100/60"
    : row.isWarning
    ? "hover:bg-amber-100/60"
    : "hover:bg-slate-50/70";

  // 3-tier quorum badge
  const pctBadge = row.isCritical
    ? "bg-rose-100 text-rose-800 border border-rose-400"
    : row.isWarning
    ? "bg-amber-100 text-amber-800 border border-amber-400"
    : "bg-emerald-100 text-emerald-800 border border-emerald-300";

  const getEffectiveStatus = (enrollmentNo: string, colStr: string): "P" | "A" => {
    const sid = colStr.split("::")[0];
    const key = `${enrollmentNo}|${sid}`;
    if (stagedChanges.has(key)) {
      return stagedChanges.get(key)!;
    }
    return row.attendance[colStr] || "A";
  };

  return (
    <tr
      style={{ height: `${ROW_HEIGHT}px` }}
      className={`transition-colors border-b border-slate-100 ${rowBg} ${rowHover}`}
    >
      {/* Enrollment No */}
      <td className="px-5 py-2.5 font-mono font-bold text-slate-900 whitespace-nowrap">
        {row.enrollmentNo}
      </td>

      {/* Student Name + risk icon */}
      <td className="px-5 py-2.5 font-semibold text-slate-800 whitespace-nowrap">
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
      <td className="px-4 py-2.5 text-center whitespace-nowrap">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold font-mono shadow-2xs ${pctBadge}`}
        >
          {Math.round(row.percent)}%{" "}
          <span className="font-normal opacity-70">
            ({row.attended}/{row.totalSessions})
          </span>
        </span>
      </td>

      {/* Per-session heatmap cells */}
      {sheetColumns.map((col) => {
        const effectiveStatus = getEffectiveStatus(row.enrollmentNo, col);
        const sid = col.split("::")[0];
        const isStaged = stagedChanges.has(`${row.enrollmentNo}|${sid}`);
        return (
          <td
            key={col}
            onClick={() => {
              if (tableMode !== "edit") return;
              const next = effectiveStatus === "P" ? "A" : "P";
              toggleCell(row.enrollmentNo, sid, next);
            }}
            onDoubleClick={() => {
              if (tableMode !== "edit") return;
              const next = effectiveStatus === "P" ? "A" : "P";
              toggleCell(row.enrollmentNo, sid, next);
            }}
            className={`text-center font-mono font-bold text-xs select-none transition-colors duration-100 ${
              tableMode === "edit" ? "cursor-pointer hover:bg-slate-100/80 active:scale-95" : ""
            } ${
              isStaged ? "ring-2 ring-amber-400 ring-inset" : ""
            }`}
            title={tableMode === "edit" ? "Double-click to flip P/A" : undefined}
          >
            {effectiveStatus === "P" ? (
              <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">P</span>
            ) : (
              <span className="inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">A</span>
            )}
          </td>
        );
      })}
    </tr>
  );
});

AttendanceTableRow.displayName = "AttendanceTableRow";

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
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Extract all admin-assigned class code presets across faculty subjects
  const assignedClassPresets = useMemo<AssignedClassOption[]>(() => {
    const options: AssignedClassOption[] = [];
    const seen = new Set<string>();

    (mySubjects || []).forEach((sub: any) => {
      const subId = String(sub._id || sub.id || "");
      const subName = sub.name || "Subject";
      const subCode = sub.code || "";
      const assignments = Array.isArray(sub.assignments) ? sub.assignments : [];

      if (assignments.length > 0) {
        assignments.forEach((a: any) => {
          const deptObj =
            typeof a.department === "object" && a.department !== null
              ? a.department
              : (departments || []).find((d: any) => String(d._id || d.id) === String(a.department));
          const deptId = String(deptObj?._id || deptObj?.id || a.department || "");
          const deptCode = deptObj?.code || deptObj?.name || "DEPT";
          const deptName = deptObj?.name || deptCode;
          const classCode = String(a.classCode || a.class_code || "").trim();
          const sec = String(a.section || "").trim().toUpperCase();
          const yr = a.year || sub.year || "";
          const sem = a.semester || sub.semester || "";

          const key = `${subId}_${classCode || `${deptId}_${yr}_${sem}_${sec}`}`;
          if (!seen.has(key)) {
            seen.add(key);
            const label = classCode
              ? `${classCode} • ${deptCode} • Sec ${sec}`
              : `${subCode} • ${deptCode} • Sec ${sec || "All"}${yr ? ` (Y${yr} S${sem})` : ""}`;

            options.push({
              key,
              classCode,
              subjectId: subId,
              subjectName: subName,
              subjectCode: subCode,
              departmentId: deptId,
              departmentCode: deptCode,
              departmentName: deptName,
              year: yr,
              semester: sem,
              section: sec,
              label,
            });
          }
        });
      } else {
        // Fallback if no specific section assignments exist for subject
        const firstDeptId = Array.isArray(sub.departments)
          ? typeof sub.departments[0] === "object"
            ? String(sub.departments[0]?._id || sub.departments[0]?.id || "")
            : String(sub.departments[0] || "")
          : "";
        const deptObj = (departments || []).find((d: any) => String(d._id || d.id) === firstDeptId);
        const deptCode = deptObj?.code || "ALL";
        const deptName = deptObj?.name || "All Departments";
        const key = `${subId}_fallback`;
        if (!seen.has(key)) {
          seen.add(key);
          options.push({
            key,
            classCode: "",
            subjectId: subId,
            subjectName: subName,
            subjectCode: subCode,
            departmentId: firstDeptId,
            departmentCode: deptCode,
            departmentName: deptName,
            year: sub.year || "",
            semester: sub.semester || "",
            section: "",
            label: `${subCode} • ${subName} (Y${sub.year || "?"} S${sub.semester || "?"})`,
          });
        }
      }
    });

    return options;
  }, [mySubjects, departments]);

  const [selectedPresetKey, setSelectedPresetKey] = useState<string>(() => {
    if (sheetFilters.subjectId) {
      const match = assignedClassPresets.find(
        (p) =>
          p.subjectId === sheetFilters.subjectId &&
          (!sheetFilters.section || p.section === sheetFilters.section)
      );
      return match ? match.key : "";
    }
    return assignedClassPresets[0]?.key || "";
  });

  // Handler when faculty picks a class preset:
  const handleSelectPreset = (presetKey: string) => {
    setSelectedPresetKey(presetKey);
    const selected = assignedClassPresets.find((p) => p.key === presetKey);
    if (!selected) return;
    // Atomically update all underlying sheet filters
    setSheetFilters((prev) => ({
      ...prev,
      subjectId: selected.subjectId,
      departmentId: selected.departmentId,
      year: String(selected.year || ""),
      semester: String(selected.semester || ""),
      section: selected.section,
    }));
  };

  // Auto-select first assigned class preset if no filter is currently active
  useEffect(() => {
    if (!sheetFilters.subjectId && assignedClassPresets.length > 0) {
      const first = assignedClassPresets[0];
      if (first) {
        setSelectedPresetKey(first.key);
        setSheetFilters((prev) => ({
          ...prev,
          subjectId: first.subjectId,
          departmentId: first.departmentId,
          year: String(first.year || ""),
          semester: String(first.semester || ""),
          section: first.section,
        }));
      }
    }
  }, [assignedClassPresets, sheetFilters.subjectId, setSheetFilters]);

  // Keep selectedPresetKey in sync if sheetFilters changes externally
  useEffect(() => {
    if (sheetFilters.subjectId) {
      const match = assignedClassPresets.find(
        (p) =>
          p.subjectId === sheetFilters.subjectId &&
          (!sheetFilters.section || p.section === sheetFilters.section)
      );
      if (match && match.key !== selectedPresetKey) {
        setSelectedPresetKey(match.key);
      }
    }
  }, [sheetFilters.subjectId, sheetFilters.section, assignedClassPresets, selectedPresetKey]);

  // Mode: 'view' (read-only) | 'edit' (interactive)
  const [tableMode, setTableMode] = useState<"view" | "edit">("view");
  // Staged cell overrides: Key is `${enrollmentNo}|${sessionId}` -> "P" | "A"
  const [stagedChanges, setStagedChanges] = useState<Map<string, "P" | "A">>(new Map());
  // Active session header dropdown state
  const [activeHeaderMenuSessionId, setActiveHeaderMenuSessionId] = useState<string | null>(null);
  // Session delete confirmation modal state
  const [deleteConfirmSession, setDeleteConfirmSession] = useState<{
    sessionId: string;
    dateLabel: string;
  } | null>(null);
  const [isSavingChanges, setIsSavingChanges] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Close header dropdown when clicking outside
  useEffect(() => {
    if (!activeHeaderMenuSessionId) return;
    const handleClickOutside = () => setActiveHeaderMenuSessionId(null);
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [activeHeaderMenuSessionId]);

  // Reset staged edits whenever subject changes or baseline sheet rows are reloaded
  useEffect(() => {
    setStagedChanges(new Map());
    setActiveHeaderMenuSessionId(null);
  }, [sheetFilters.subjectId, sheetRows]);

  // Toggle cell handler:
  const toggleCell = useCallback(
    (enrollmentNo: string, sessionId: string, nextStatus: "P" | "A") => {
      setStagedChanges((prev) => {
        const next = new Map(prev);
        const key = `${enrollmentNo}|${sessionId}`;
        const origRow = sheetRows.find((r) => r.enrollmentNo === enrollmentNo);
        const colStr = sheetColumns.find((c) => c.split("::")[0] === sessionId);
        const origStatus: "P" | "A" = colStr && origRow?.attendance?.[colStr] === "P" ? "P" : "A";

        if (nextStatus === origStatus) {
          next.delete(key);
        } else {
          next.set(key, nextStatus);
        }
        return next;
      });
    },
    [sheetRows, sheetColumns]
  );

  // Bulk mark session:
  const bulkMarkSession = useCallback(
    (sessionId: string, targetStatus: "P" | "A") => {
      setStagedChanges((prev) => {
        const next = new Map(prev);
        const colStr = sheetColumns.find((c) => c.split("::")[0] === sessionId);
        sheetRows.forEach((row) => {
          const key = `${row.enrollmentNo}|${sessionId}`;
          const origStatus: "P" | "A" = colStr && row.attendance?.[colStr] === "P" ? "P" : "A";
          if (targetStatus === origStatus) {
            next.delete(key);
          } else {
            next.set(key, targetStatus);
          }
        });
        return next;
      });
    },
    [sheetRows, sheetColumns]
  );

  // Confirm delete session execution:
  const handleConfirmDeleteSession = async () => {
    if (!deleteConfirmSession) return;
    setIsDeletingSession(true);
    try {
      await apiClient.cancelSession(deleteConfirmSession.sessionId);
      setStagedChanges((prev) => {
        const next = new Map(prev);
        Array.from(next.keys()).forEach((k) => {
          if (k.endsWith(`|${deleteConfirmSession.sessionId}`)) {
            next.delete(k);
          }
        });
        return next;
      });
      setDeleteConfirmSession(null);
      // Re-fetch fresh sheet data bypassing any client-side cache
      await onLoadSheet(true);
    } catch (err: any) {
      alert(err?.message || "Failed to delete session");
    } finally {
      setIsDeletingSession(false);
    }
  };

  // Atomic save handler:
  const handleBatchSave = async () => {
    if (stagedChanges.size === 0) return;
    setIsSavingChanges(true);
    setSaveError(null);
    const updates = Array.from(stagedChanges.entries()).map(([key, status]) => {
      const [enrollmentNo, sessionId] = key.split("|");
      return {
        sessionId,
        enrollmentNo,
        status: status === "P" ? ("present" as const) : ("absent" as const),
      };
    });
    try {
      const res: any = await apiClient.batchUpdateMatrixAttendance({
        subjectId: sheetFilters.subjectId,
        updates,
      });
      if (!res?.ok) throw new Error(res?.error || "Batch update failed");
      // Auto refresh matrix with force=true to bypass client cache and pull fresh database state
      await onLoadSheet(true);
      // Clear staged changes after fresh sheet is loaded
      setStagedChanges(new Map());
    } catch (err: any) {
      setSaveError(err?.message || "Failed to commit attendance updates.");
    } finally {
      setIsSavingChanges(false);
    }
  };

  // Derive local rows applying staged in-memory edits at 60 FPS
  const localRows = useMemo<SheetRow[]>(() => {
    if (stagedChanges.size === 0) return sheetRows;
    return sheetRows.map((row) => {
      let hasChange = false;
      const newAttendance = { ...row.attendance };
      for (const col of sheetColumns) {
        const sid = col.split("::")[0];
        const key = `${row.enrollmentNo}|${sid}`;
        if (stagedChanges.has(key)) {
          newAttendance[col] = stagedChanges.get(key)!;
          hasChange = true;
        }
      }
      if (!hasChange) return row;
      return { ...row, attendance: newAttendance };
    });
  }, [sheetRows, sheetColumns, stagedChanges]);

  // Concurrency optimization: Defer heavy search filtering so UI inputs remain 100% responsive
  const deferredSearchTerm = useDeferredValue(searchTerm);

  // Reset scroll position on filter changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [deferredSearchTerm, filterAtRiskOnly, sheetFilters.subjectId]);

  // Compute student summary percentages + risk tier (single pass, O(n·cols))
  const enrichedRows = useMemo<EnrichedSheetRow[]>(() => {
    const totalCols = sheetColumns.length;
    return localRows.map((row) => {
      let attended = 0;
      for (let i = 0; i < sheetColumns.length; i++) {
        if (row.attendance[sheetColumns[i]] === "P") attended++;
      }
      const percent = totalCols > 0 ? (attended / totalCols) * 100 : 0;
      const isCritical = totalCols > 0 && percent < 60; // < 60%  → rose row
      const isWarning = totalCols > 0 && percent >= 60 && percent < 75; // 60–74% → amber row
      const isAtRisk = isCritical || isWarning;
      return {
        ...row,
        attended,
        totalSessions: totalCols,
        percent,
        isCritical,
        isWarning,
        isAtRisk,
      };
    });
  }, [localRows, sheetColumns]);

  // Filtered rows using deferred search query
  const filteredRows = useMemo(() => {
    const q = deferredSearchTerm.trim().toLowerCase();
    return enrichedRows.filter((row) => {
      if (filterAtRiskOnly && !row.isAtRisk) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.enrollmentNo.toLowerCase().includes(q)
      );
    });
  }, [enrichedRows, filterAtRiskOnly, deferredSearchTerm]);

  // Virtualization windowing calculations
  const { startIndex, endIndex, paddingTop, paddingBottom } = useVirtualScroll({
    itemCount: filteredRows.length,
    itemHeight: ROW_HEIGHT,
    overscan: OVERSCAN,
    containerRef: scrollContainerRef,
  });

  // Visible window slice (only ~15-20 rows rendered in DOM at any instant)
  const visibleRows = useMemo(() => {
    return filteredRows.slice(startIndex, endIndex);
  }, [filteredRows, startIndex, endIndex]);

  // Overall metrics (single pass)
  const { classAvgPercent, atRiskCount, criticalCount } = useMemo(() => {
    if (!enrichedRows.length)
      return { classAvgPercent: 0, atRiskCount: 0, criticalCount: 0 };
    let sum = 0,
      atRisk = 0,
      critical = 0;
    for (const row of enrichedRows) {
      sum += row.percent;
      if (row.isAtRisk) atRisk++;
      if (row.isCritical) critical++;
    }
    return {
      classAvgPercent: Math.round(sum / enrichedRows.length),
      atRiskCount: atRisk,
      criticalCount: critical,
    };
  }, [enrichedRows]);

  const totalColSpan = 3 + sheetColumns.length;

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

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Mode Switcher: View vs Edit Mode */}
            <div className="flex items-center gap-2">
              <label htmlFor="matrix-table-mode" className="text-xs font-semibold text-slate-500">
                Mode:
              </label>
              <select
                id="matrix-table-mode"
                value={tableMode}
                onChange={(e) => {
                  const nextMode = e.target.value as "view" | "edit";
                  if (nextMode === "view" && stagedChanges.size > 0) {
                    const confirmDiscard = window.confirm(
                      `You have ${stagedChanges.size} unsaved attendance changes. Discard them and return to View mode?`
                    );
                    if (!confirmDiscard) return;
                    setStagedChanges(new Map());
                  }
                  setTableMode(nextMode);
                }}
                className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition-all shadow-xs cursor-pointer ${
                  tableMode === "edit"
                    ? "border-amber-400 bg-amber-50 text-amber-900 ring-2 ring-amber-300"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                <option value="view">👁 View Attendance</option>
                <option value="edit">✎ Edit Attendance</option>
              </select>
            </div>

            <button
              type="button"
              onClick={onExportCsv}
              disabled={!sheetRows.length || (tableMode === "edit" && stagedChanges.size > 0)}
              title={
                tableMode === "edit" && stagedChanges.size > 0
                  ? "Save or discard staged changes before exporting"
                  : undefined
              }
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/90 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:border-emerald-400 hover:bg-emerald-50/50 shadow-xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={15} className="text-emerald-600" />
              Download CSV
            </button>
          </div>
        </div>

        {/* Interactive Edit Mode Guidance Banner */}
        {tableMode === "edit" && (
          <div className="mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-200/90 bg-amber-50/80 px-4 py-3 text-xs text-amber-900 shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-amber-600 animate-pulse" />
              <span>
                <strong>Interactive Edit Mode Active:</strong> Click or double-click any cell to toggle <strong>P &harr; A</strong>. Click <MoreVertical size={12} className="inline text-slate-600" /> on any session column header for bulk options or session deletion.
              </span>
            </div>
            {stagedChanges.size > 0 && (
              <span className="shrink-0 font-bold text-amber-800 font-mono bg-white border border-amber-300 px-2.5 py-1 rounded-xl text-[11px] shadow-2xs">
                {stagedChanges.size} staged change{stagedChanges.size > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}

        {/* Sleek Assigned Class Code Preset Bar */}
        <div className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 sm:p-5 shadow-2xs backdrop-blur-md mb-6">
          <div className="flex flex-col md:flex-row md:items-end gap-3.5">
            {/* Assigned Class Code Preset Dropdown */}
            <div className="flex-1">
              <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1.5">
                <Sparkles size={13} className="text-emerald-600" />
                Filter by Class Code (Assigned by Admin)
              </label>
              
              {assignedClassPresets.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 font-medium">
                  No assigned class codes found. Please confirm subject allocations with your administrator.
                </div>
              ) : (
                <select
                  value={selectedPresetKey}
                  onChange={(e) => handleSelectPreset(e.target.value)}
                  className="w-full rounded-xl border border-slate-300/90 bg-white px-4 py-2.5 text-xs font-bold text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 shadow-xs transition hover:border-slate-400 cursor-pointer"
                >
                  <option value="" disabled>-- Select Assigned Class --</option>
                  {assignedClassPresets.map((preset) => (
                    <option key={preset.key} value={preset.key}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {/* Generate Ledger Button */}
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => onLoadSheet(true)}
                disabled={sheetLoading || !sheetFilters.subjectId}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-6 py-2.5 text-xs font-extrabold text-white shadow-[0_8px_20px_-4px_rgba(16,185,129,0.35)] hover:shadow-[0_12px_24px_-4px_rgba(16,185,129,0.45)] hover:brightness-105 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-98"
              >
                {sheetLoading ? (
                  <RefreshCw size={15} className="animate-spin" />
                ) : (
                  <List size={15} />
                )}
                <span>Generate Matrix</span>
              </button>
            </div>
          </div>
          {/* Active Selection Metadata Preview Badge */}
          {selectedPresetKey && (
            <div className="mt-3 pt-3 border-t border-slate-200/60 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 font-medium">
              <span className="text-slate-400">Active Parameters:</span>
              <span className="bg-white px-2 py-0.5 rounded-md border border-slate-200 font-mono font-bold text-slate-700">
                Subject: {sheetFilters.subjectId ? (mySubjects.find((s: any) => String(s.id || s._id) === sheetFilters.subjectId)?.name || "Selected") : "None"}
              </span>
              {sheetFilters.section && (
                <span className="bg-white px-2 py-0.5 rounded-md border border-slate-200 font-bold text-slate-700">
                  Section: {sheetFilters.section}
                </span>
              )}
              {sheetFilters.semester && (
                <span className="bg-white px-2 py-0.5 rounded-md border border-slate-200 font-bold text-slate-700">
                  Sem: {sheetFilters.semester}
                </span>
              )}
              {sheetFilters.year && (
                <span className="bg-white px-2 py-0.5 rounded-md border border-slate-200 font-bold text-slate-700">
                  Year: {sheetFilters.year}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Quick Search & Summary Stats */}
        {sheetRows.length > 0 && (
          <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            {/* Search & At-Risk Toggle */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
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
                <AlertTriangle
                  size={13}
                  className={filterAtRiskOnly ? "text-rose-600" : "text-slate-400"}
                />
                <span>Below 75% At-Risk ({atRiskCount})</span>
              </button>
            </div>

            {/* Quick Metrics Badges & Virtualization Performance Badge */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-xl bg-emerald-50 px-2.5 py-1.5 font-bold text-emerald-800 border border-emerald-200/80 shadow-2xs">
                <Zap size={12} className="text-emerald-600 fill-emerald-500" />
                <span>60 FPS Virtualized</span>
              </span>
              <span className="rounded-xl bg-slate-100 px-3 py-1.5 font-semibold text-slate-700 border border-slate-200/60 shadow-2xs">
                Students: <strong className="font-mono text-slate-900">{filteredRows.length}</strong>
                {filteredRows.length !== sheetRows.length && (
                  <span className="text-slate-400 font-normal ml-1">
                    (of {sheetRows.length})
                  </span>
                )}
              </span>
              <span className="rounded-xl bg-slate-100 px-3 py-1.5 font-semibold text-slate-700 border border-slate-200/60 shadow-2xs">
                Sessions: <strong className="font-mono text-slate-900">{sheetColumns.length}</strong>
              </span>
              <span
                className={`rounded-xl px-3 py-1.5 font-semibold border shadow-2xs ${
                  classAvgPercent >= 75
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : classAvgPercent >= 60
                    ? "bg-amber-50 border-amber-200 text-amber-800"
                    : "bg-rose-50 border-rose-200 text-rose-800"
                }`}
              >
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

      {/* ── Roster Table Card with Windowed Rendering ─────────────────────────── */}
      <div className="rounded-3xl border border-slate-200/80 bg-white/80 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl overflow-hidden flex flex-col">
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
              <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-slate-100 bg-slate-50/80 px-5 py-2.5 text-[11px] font-semibold">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
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
                <span className="text-[10px] text-slate-400 font-medium">
                  Rendering {visibleRows.length} DOM rows (Windowed)
                </span>
              </div>
            )}

            {/* Scroll Container for Windowed / Virtualized Table */}
            <div
              ref={scrollContainerRef}
              className="w-full overflow-auto max-h-[560px] relative scroll-smooth will-change-scroll"
            >
              <table className="min-w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50/95 border-b border-slate-200 text-[11px] font-extrabold uppercase tracking-wider text-slate-600 sticky top-0 z-10 backdrop-blur-md shadow-xs">
                  <tr>
                    <th className="px-5 py-4 whitespace-nowrap bg-slate-50/95">Enrollment USN</th>
                    <th className="px-5 py-4 whitespace-nowrap bg-slate-50/95">Student Name</th>
                    <th className="px-4 py-4 text-center whitespace-nowrap bg-slate-50/95">Quorum Score</th>
                    {sheetColumns.map((colStr) => {
                      const [sessionId, dateLabel] = colStr.split("::");
                      const isMenuOpen = activeHeaderMenuSessionId === sessionId;
                      return (
                        <th
                          key={colStr}
                          className={`relative px-3 py-4 text-center font-mono font-semibold whitespace-nowrap bg-slate-50/95 transition border-l border-slate-200/50 ${
                            tableMode === "edit" ? "hover:bg-slate-100/90" : ""
                          }`}
                          title={colStr}
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            <span>{dateLabel || sessionId}</span>
                            {tableMode === "edit" && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveHeaderMenuSessionId((prev) =>
                                    prev === sessionId ? null : sessionId
                                  );
                                }}
                                className="rounded-lg p-1 text-slate-400 hover:text-slate-800 hover:bg-slate-200/80 transition cursor-pointer"
                                title="Session actions"
                              >
                                <MoreVertical size={13} />
                              </button>
                            )}
                          </div>

                          {/* Session Actions Dropdown Menu */}
                          {tableMode === "edit" && isMenuOpen && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 top-full z-30 mt-1 w-48 rounded-2xl bg-white shadow-2xl border border-slate-200 p-1.5 text-left normal-case font-sans tracking-normal font-normal"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  bulkMarkSession(sessionId, "P");
                                  setActiveHeaderMenuSessionId(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 rounded-xl transition cursor-pointer"
                              >
                                <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                                <span>Mark All Present</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  bulkMarkSession(sessionId, "A");
                                  setActiveHeaderMenuSessionId(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 rounded-xl transition cursor-pointer"
                              >
                                <XCircle size={14} className="text-rose-600 shrink-0" />
                                <span>Mark All Absent</span>
                              </button>
                              <div className="h-px bg-slate-100 my-1" />
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveHeaderMenuSessionId(null);
                                  setDeleteConfirmSession({ sessionId, dateLabel: dateLabel || sessionId });
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer"
                              >
                                <Trash2 size={14} className="text-rose-600 shrink-0" />
                                <span>Delete Session</span>
                              </button>
                            </div>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={totalColSpan}
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
                    <>
                      {/* Top Virtual Spacer */}
                      {paddingTop > 0 && (
                        <tr aria-hidden="true" style={{ height: `${paddingTop}px` }}>
                          <td colSpan={totalColSpan} className="p-0 border-0 pointer-events-none" />
                        </tr>
                      )}

                      {/* Rendered Window Slice */}
                      {visibleRows.map((row) => (
                        <AttendanceTableRow
                          key={row.enrollmentNo}
                          row={row}
                          sheetColumns={sheetColumns}
                          tableMode={tableMode}
                          stagedChanges={stagedChanges}
                          toggleCell={toggleCell}
                        />
                      ))}

                      {/* Bottom Virtual Spacer */}
                      {paddingBottom > 0 && (
                        <tr aria-hidden="true" style={{ height: `${paddingBottom}px` }}>
                          <td colSpan={totalColSpan} className="p-0 border-0 pointer-events-none" />
                        </tr>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ── Floating ACID Batch Save Bar ──────────────────────────────────────── */}
      {tableMode === "edit" && stagedChanges.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 rounded-3xl bg-slate-900/95 px-6 py-3.5 text-white shadow-2xl border border-slate-700/60 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs font-bold text-slate-200">
              <strong className="text-amber-300 font-mono text-sm mr-1">{stagedChanges.size}</strong> pending{" "}
              {stagedChanges.size === 1 ? "edit" : "edits"} staged
            </span>
          </div>

          {saveError && (
            <span className="text-[11px] text-rose-300 font-medium max-w-xs truncate">
              {saveError}
            </span>
          )}

          <div className="h-4 w-px bg-slate-700" />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStagedChanges(new Map())}
              disabled={isSavingChanges}
              className="rounded-xl px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
            >
              Discard
            </button>

            <button
              type="button"
              onClick={handleBatchSave}
              disabled={isSavingChanges}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-1.5 text-xs font-extrabold text-white shadow-md hover:brightness-110 active:scale-95 transition cursor-pointer disabled:opacity-50"
            >
              {isSavingChanges ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Save size={13} />
              )}
              <span>{isSavingChanges ? "Saving Batch..." : "Save Changes"}</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Session Delete Confirmation Modal ─────────────────────────────────── */}
      {deleteConfirmSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 text-rose-600 mb-3">
              <div className="rounded-full bg-rose-100 p-2.5">
                <AlertTriangle size={22} className="text-rose-600" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Delete Attendance Session</h3>
            </div>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Are you sure you want to permanently delete the session for{" "}
              <strong>{deleteConfirmSession.dateLabel || deleteConfirmSession.sessionId}</strong>?
              This action will permanently delete all attendance records associated with this session. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                disabled={isDeletingSession}
                onClick={() => setDeleteConfirmSession(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingSession}
                onClick={handleConfirmDeleteSession}
                className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 transition cursor-pointer disabled:opacity-50"
              >
                {isDeletingSession ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={13} />
                    <span>Delete Permanently</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

AttendanceRosterTable.displayName = "AttendanceRosterTable";
export default AttendanceRosterTable;

