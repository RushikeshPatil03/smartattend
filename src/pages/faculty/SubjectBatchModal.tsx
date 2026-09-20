import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  X,
  Plus,
  Trash2,
  Users,
  Layers,
  CheckSquare,
  Square,
  Search,
  Wand2,
  RefreshCw,
  GripVertical,
  Check,
  Building2,
  BookOpen,
  Save,
  AlertTriangle,
} from "lucide-react";
import apiClient from "../../services/apiClient";

export interface SubjectBatch {
  id?: string;
  subject_id?: string;
  faculty_id?: string;
  department_id?: string;
  year?: number;
  semester?: number;
  section?: string;
  batch_number: number;
  batch_name: string;
  student_enrollments: string[];
}

export interface CohortStudent {
  id: string;
  name: string;
  enrollment_no: string;
  year: number;
  semester: number;
  section: string;
  email?: string;
}

interface SubjectBatchModalProps {
  subject: any;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (batches: SubjectBatch[]) => void;
  departments?: any[];
}

export const SubjectBatchModal: React.FC<SubjectBatchModalProps> = React.memo(({
  subject,
  isOpen,
  onClose,
  onSaved,
  departments = [],
}) => {
  const subjectId = String(subject?._id || subject?.id || "");
  const subjectCode = subject?.code || "";
  const subjectName = subject?.name || "Subject";
  const subjectYear = Number(subject?.year || 1);
  const subjectSemester = Number(subject?.semester || 1);

  // Section options from assignments
  const sectionOptions = useMemo(() => {
    const assignments = Array.isArray(subject?.assignments) ? subject.assignments : [];
    const secs = new Set<string>();
    assignments.forEach((a: any) => {
      const sec = String(a.section || "").trim().toUpperCase();
      if (sec) secs.add(sec);
    });
    return Array.from(secs).sort();
  }, [subject]);

  const [selectedSection, setSelectedSection] = useState<string>(() => {
    return sectionOptions[0] || "";
  });

  const [batches, setBatches] = useState<
    Array<{ id?: string; batchName: string; studentEnrollments: string[] }>
  >([
    { batchName: "Batch 1", studentEnrollments: [] },
    { batchName: "Batch 2", studentEnrollments: [] },
  ]);

  const [cohortStudents, setCohortStudents] = useState<CohortStudent[]>([]);
  const [loadingCohort, setLoadingCohort] = useState(false);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Selection & drag-sweep states
  const [selectedUsns, setSelectedUsns] = useState<Set<string>>(new Set());
  const [studentSearch, setStudentSearch] = useState("");
  const [activeBatchTab, setActiveBatchTab] = useState<"ALL" | "UNASSIGNED" | number>("ALL");
  const [dragOverBatchIdx, setDragOverBatchIdx] = useState<number | null>(null);

  const [isMouseDown, setIsMouseDown] = useState(false);
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const cohortAbortRef = useRef<AbortController | null>(null);

  // Global mouseup to release sweep selection
  useEffect(() => {
    const handleGlobalMouseUp = () => setIsMouseDown(false);
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  // Fetch initial data when modal opens
  useEffect(() => {
    if (!isOpen || !subjectId) return;

    let isMounted = true;
    setError(null);
    setSuccessMsg(null);
    setSelectedUsns(new Set());
    setStudentSearch("");
    setActiveBatchTab("ALL");

    // 1) Fetch existing batches
    const loadBatches = async () => {
      setLoadingBatches(true);
      try {
        const res: any = await apiClient.getSubjectBatches(subjectId);
        if (isMounted && res?.ok && Array.isArray(res.batches) && res.batches.length > 0) {
          const loaded = res.batches.map((b: any) => ({
            id: b.id,
            batchName: b.batch_name || `Batch ${b.batch_number || 1}`,
            studentEnrollments: Array.isArray(b.student_enrollments)
              ? b.student_enrollments.map((u: any) => String(u).trim().toUpperCase()).filter(Boolean)
              : [],
          }));
          setBatches(loaded);
          fetchCohort(selectedSection, loaded);
        } else if (isMounted) {
          setBatches([
            { batchName: "Batch 1", studentEnrollments: [] },
            { batchName: "Batch 2", studentEnrollments: [] },
          ]);
        }
      } catch (err: any) {
        console.error("Failed to load subject batches:", err);
      } finally {
        if (isMounted) setLoadingBatches(false);
      }
    };

    loadBatches();

    return () => {
      isMounted = false;
    };
  }, [isOpen, subjectId]);

  // Fetch cohort students whenever selectedSection changes
  const fetchCohort = useCallback(
    async (sec: string, currentBatches?: Array<{ studentEnrollments: string[] }>) => {
      if (cohortAbortRef.current) {
        cohortAbortRef.current.abort();
      }
      const controller = new AbortController();
      cohortAbortRef.current = controller;

      setLoadingCohort(true);
      try {
        const activeBatches = currentBatches || batches;
        const allBatchUsns = activeBatches.flatMap((b) => b.studentEnrollments);

        const firstDept =
          (Array.isArray(subject?.departments) && subject.departments[0]
            ? typeof subject.departments[0] === "object"
              ? subject.departments[0]?._id || subject.departments[0]?.id
              : subject.departments[0]
            : null) ||
          (Array.isArray(subject?.assignments) && subject.assignments[0]
            ? typeof subject.assignments[0]?.department === "object"
              ? subject.assignments[0]?.department?.id || subject.assignments[0]?.department?._id
              : subject.assignments[0]?.department
            : null) ||
          "";

        const queryParams: any = {
          years: [subjectYear],
          semesters: [subjectSemester],
        };
        if (firstDept) {
          queryParams.departmentId = firstDept;
        }
        if (sec && sec !== "ALL") {
          queryParams.section = sec;
        }
        if (allBatchUsns.length > 0) {
          queryParams.usns = allBatchUsns;
        }

        // Use cohort-students endpoint
        const res: any = await apiClient.getCohortStudents(queryParams, controller.signal);
        if (res?.ok && Array.isArray(res.students)) {
          setCohortStudents(res.students);
        } else {
          setCohortStudents([]);
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.error("Failed to fetch students for subject batches:", err);
          setCohortStudents([]);
        }
      } finally {
        setLoadingCohort(false);
      }
    },
    [subject, subjectYear, subjectSemester, batches]
  );

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => {
      fetchCohort(selectedSection);
    }, 150);
    return () => clearTimeout(t);
  }, [isOpen, selectedSection, fetchCohort]);

  // Map each student USN to their assigned batch index
  const studentBatchMap = useMemo(() => {
    const map = new Map<string, number>();
    batches.forEach((b, bIdx) => {
      b.studentEnrollments.forEach((u) => {
        map.set(u.toUpperCase(), bIdx);
      });
    });
    return map;
  }, [batches]);

  // Unified student list: Combines cohort students with any students already enrolled in batches
  // This guarantees that enrolled students NEVER vanish even if there is a department or section filter mismatch
  const unifiedStudents = useMemo(() => {
    const list = [...cohortStudents];
    const presentUsns = new Set(cohortStudents.map((s) => s.enrollment_no.toUpperCase()));

    batches.forEach((b) => {
      b.studentEnrollments.forEach((u) => {
        const upper = u.trim().toUpperCase();
        if (upper && !presentUsns.has(upper)) {
          presentUsns.add(upper);
          list.push({
            id: `enrolled-${upper}`,
            name: `Student (${upper})`,
            enrollment_no: upper,
            year: subjectYear,
            semester: subjectSemester,
            section: selectedSection && selectedSection !== "ALL" ? selectedSection : "A",
          });
        }
      });
    });

    return list;
  }, [cohortStudents, batches, subjectYear, subjectSemester, selectedSection]);

  // Filter cohort students by search term and tab
  const filteredCohortStudents = useMemo(() => {
    const searchLower = studentSearch.trim().toLowerCase();
    return unifiedStudents.filter((s) => {
      const usnUpper = s.enrollment_no.toUpperCase();
      const matchSearch =
        !searchLower ||
        s.enrollment_no.toLowerCase().includes(searchLower) ||
        s.name.toLowerCase().includes(searchLower);

      if (!matchSearch) return false;

      if (activeBatchTab === "UNASSIGNED") {
        return !studentBatchMap.has(usnUpper);
      }
      if (typeof activeBatchTab === "number") {
        return studentBatchMap.get(usnUpper) === activeBatchTab;
      }
      return true;
    });
  }, [unifiedStudents, studentSearch, activeBatchTab, studentBatchMap]);

  // Handle Mark Select & Drag-Sweep
  const handleStudentMouseDown = (usn: string, index: number, e: React.MouseEvent) => {
    const usnUpper = usn.toUpperCase();
    if (e.shiftKey && lastClickedIndex !== null) {
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);
      const rangeUsns = filteredCohortStudents
        .slice(start, end + 1)
        .map((s) => s.enrollment_no.toUpperCase());
      setSelectedUsns((prev) => {
        const next = new Set(prev);
        rangeUsns.forEach((u) => next.add(u));
        return next;
      });
      return;
    }

    setIsMouseDown(true);
    setLastClickedIndex(index);
    setSelectedUsns((prev) => {
      const next = new Set(prev);
      if (next.has(usnUpper)) {
        next.delete(usnUpper);
      } else {
        next.add(usnUpper);
      }
      return next;
    });
  };

  const handleStudentMouseEnter = (usn: string, index: number) => {
    if (isMouseDown) {
      const usnUpper = usn.toUpperCase();
      setSelectedUsns((prev) => {
        const next = new Set(prev);
        next.add(usnUpper);
        return next;
      });
      setLastClickedIndex(index);
    }
  };

  // Drag and drop to batch card
  const handleDragStart = (e: React.DragEvent, usn: string) => {
    const usnUpper = usn.toUpperCase();
    const usnsToDrag = selectedUsns.has(usnUpper)
      ? Array.from(selectedUsns)
      : [usnUpper];
    e.dataTransfer.setData("application/json", JSON.stringify(usnsToDrag));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleBatchDrop = (e: React.DragEvent, targetBatchIdx: number) => {
    e.preventDefault();
    setDragOverBatchIdx(null);
    try {
      const raw = e.dataTransfer.getData("application/json");
      if (!raw) return;
      const usns: string[] = JSON.parse(raw);
      if (!Array.isArray(usns) || usns.length === 0) return;

      const usnSet = new Set(usns.map((u) => u.toUpperCase()));
      setBatches((prev) =>
        prev.map((b, idx) => {
          if (idx === targetBatchIdx) {
            const combined = Array.from(new Set([...b.studentEnrollments, ...usnSet]));
            return { ...b, studentEnrollments: combined };
          } else {
            const filtered = b.studentEnrollments.filter((u) => !usnSet.has(u.toUpperCase()));
            return { ...b, studentEnrollments: filtered };
          }
        })
      );
      setSelectedUsns(new Set());
    } catch (err) {
      console.error("Failed to drop student data:", err);
    }
  };

  // Assign selected to batch
  const assignSelectedToBatch = (batchIdx: number) => {
    if (selectedUsns.size === 0) return;
    const usns = Array.from(selectedUsns);
    setBatches((prev) =>
      prev.map((b, idx) => {
        if (idx === batchIdx) {
          const combined = Array.from(new Set([...b.studentEnrollments, ...usns]));
          return { ...b, studentEnrollments: combined };
        } else {
          const filtered = b.studentEnrollments.filter((u) => !selectedUsns.has(u.toUpperCase()));
          return { ...b, studentEnrollments: filtered };
        }
      })
    );
    setSelectedUsns(new Set());
  };

  const unassignSelected = () => {
    if (selectedUsns.size === 0) return;
    setBatches((prev) =>
      prev.map((b) => ({
        ...b,
        studentEnrollments: b.studentEnrollments.filter((u) => !selectedUsns.has(u.toUpperCase())),
      }))
    );
    setSelectedUsns(new Set());
  };

  // Auto Split Evenly
  const handleAutoSplit = () => {
    if (unifiedStudents.length === 0 || batches.length === 0) return;
    const total = unifiedStudents.length;
    const numBatches = batches.length;
    const chunkSize = Math.ceil(total / numBatches);

    const nextBatches = batches.map((b, idx) => {
      const start = idx * chunkSize;
      const end = Math.min(start + chunkSize, total);
      const slice = unifiedStudents.slice(start, end).map((s) => s.enrollment_no.toUpperCase());
      return {
        ...b,
        studentEnrollments: slice,
      };
    });

    setBatches(nextBatches);
    setSelectedUsns(new Set());
  };

  const handleSelectAllVisible = () => {
    const allVisible = filteredCohortStudents.map((s) => s.enrollment_no.toUpperCase());
    setSelectedUsns(new Set(allVisible));
  };

  const handleClearSelection = () => {
    setSelectedUsns(new Set());
  };

  // Save batches to backend
  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload = {
        batches: batches.map((b, idx) => ({
          id: b.id,
          batch_number: idx + 1,
          batch_name: b.batchName.trim() || `Batch ${idx + 1}`,
          student_enrollments: b.studentEnrollments,
          year: subjectYear,
          semester: subjectSemester,
          section: selectedSection || null,
        })),
      };

      const res: any = await apiClient.saveSubjectBatches(subjectId, payload);
      if (!res?.ok) {
        throw new Error(res?.error || "Failed to save batches");
      }

      setSuccessMsg("Subject batches saved successfully!");
      onSaved?.(res.batches || []);
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      console.error("Save batches error:", err);
      setError(err?.message || "Failed to save batches. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-5xl bg-white rounded-3xl shadow-2xl border border-slate-200 p-5 sm:p-7 space-y-4 max-h-[92vh] flex flex-col transition-all duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 mb-1">
              <Layers size={11} className="text-emerald-600" />
              Lab & Practical Batches
            </div>
            <h3 className="font-extrabold text-slate-900 text-lg sm:text-xl flex items-center gap-2">
              <span className="font-mono text-emerald-700">{subjectCode}</span>
              <span>•</span>
              <span className="truncate max-w-[320px] sm:max-w-md">{subjectName}</span>
            </h3>
            <p className="text-xs text-slate-500">
              Configure multiple batches, drag and assign students, or auto-split evenly for laboratory sessions.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Section Picker & Cohort Context */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/80 p-3 rounded-2xl border border-slate-200/80 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
              <Building2 size={13} className="text-slate-400" />
              Year {subjectYear} • Sem {subjectSemester}
            </span>

            {sectionOptions.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500">Section:</span>
                <select
                  value={selectedSection}
                  onChange={(e) => setSelectedSection(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-2xs"
                >
                  <option value="ALL">All Sections</option>
                  {sectionOptions.map((sec) => (
                    <option key={sec} value={sec}>
                      Section {sec}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-slate-500">
              {loadingCohort && unifiedStudents.length === 0 ? (
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <RefreshCw size={12} className="animate-spin" /> Loading students...
                </span>
              ) : (
                <span>
                  <strong className="text-slate-800">{unifiedStudents.length}</strong> students enrolled
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Batch Allocation Studio (Two Columns / Responsive) */}
        <div className="flex-1 min-h-0 flex flex-col space-y-3 overflow-hidden">
          {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div>
              <h4 className="font-extrabold text-slate-900 text-sm flex items-center gap-1.5">
                <Layers size={14} className="text-emerald-600" />
                Batch Studio & Drag-Select
              </h4>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAutoSplit}
                disabled={unifiedStudents.length === 0 || batches.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-[11px] font-bold shadow-xs hover:bg-emerald-500 disabled:opacity-40 transition cursor-pointer"
                title="Evenly divides the student list across all active batches"
              >
                <Wand2 size={13} /> Auto-Split Evenly
              </button>
              <button
                type="button"
                onClick={() => {
                  setBatches((prev) => [
                    ...prev,
                    { batchName: `Batch ${prev.length + 1}`, studentEnrollments: [] },
                  ]);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-700 text-[11px] font-bold hover:bg-slate-100 cursor-pointer shadow-2xs"
              >
                <Plus size={13} /> Add Batch
              </button>
            </div>
          </div>

          {/* Active Batches Row / Drop Targets */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 shrink-0 max-h-36 overflow-y-auto p-1">
            {batches.map((b, bIdx) => {
              const isDropTarget = dragOverBatchIdx === bIdx;
              const count = b.studentEnrollments.length;

              return (
                <div
                  key={bIdx}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverBatchIdx(bIdx);
                  }}
                  onDragLeave={() => setDragOverBatchIdx(null)}
                  onDrop={(e) => handleBatchDrop(e, bIdx)}
                  className={`p-2.5 rounded-2xl border transition-all ${
                    isDropTarget
                      ? "bg-emerald-100 border-emerald-500 scale-[1.02] shadow-md"
                      : "bg-white border-slate-200/90 shadow-2xs hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <input
                      type="text"
                      value={b.batchName}
                      onChange={(e) => {
                        const next = [...batches];
                        next[bIdx].batchName = e.target.value;
                        setBatches(next);
                      }}
                      className="font-extrabold text-xs text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-emerald-500 outline-none w-32"
                    />
                    {batches.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setBatches(batches.filter((_, i) => i !== bIdx))}
                        className="text-slate-400 hover:text-rose-600 p-0.5"
                        title="Delete Batch"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span className="font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-100">
                      {count} Students
                    </span>
                    <span className="text-[10px] text-slate-400">Drag items here</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Filters & Selection Action Bar */}
          <div className="space-y-2 pt-1 border-t border-slate-200 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Batch Filter Tabs */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => setActiveBatchTab("ALL")}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                    activeBatchTab === "ALL"
                      ? "bg-slate-800 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  All ({unifiedStudents.length})
                </button>
                {batches.map((b, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveBatchTab(idx)}
                    className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                      activeBatchTab === idx
                        ? "bg-emerald-600 text-white"
                        : "bg-white text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {b.batchName} ({b.studentEnrollments.length})
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setActiveBatchTab("UNASSIGNED")}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                    activeBatchTab === "UNASSIGNED"
                      ? "bg-amber-600 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Unassigned
                </button>
              </div>

              {/* Search input */}
              <div className="relative w-48">
                <Search size={12} className="absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter by USN / Name"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  className="w-full pl-7 pr-2 py-1 rounded-xl border border-slate-300 text-[11px] outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Selection Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAllVisible}
                  className="text-[11px] font-bold text-slate-700 hover:text-emerald-700 cursor-pointer"
                >
                  Select All
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="text-[11px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  Deselect
                </button>
                <span className="text-[11px] font-extrabold text-emerald-700 ml-1">
                  {selectedUsns.size} selected
                </span>
              </div>

              {/* Quick Batch Assignment Buttons */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-slate-400 font-medium">Assign to:</span>
                {batches.map((b, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={selectedUsns.size === 0}
                    onClick={() => assignSelectedToBatch(idx)}
                    className="px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-[10px] hover:bg-emerald-100 disabled:opacity-30 cursor-pointer"
                  >
                    {b.batchName}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={selectedUsns.size === 0}
                  onClick={unassignSelected}
                  className="px-2 py-1 rounded-md bg-slate-100 border border-slate-200 text-slate-600 font-bold text-[10px] hover:bg-slate-200 disabled:opacity-30 cursor-pointer"
                >
                  Unassign
                </button>
              </div>
            </div>
          </div>

          {/* Students List Container with Drag & Select */}
          <div
            className="flex-1 min-h-[180px] overflow-y-auto border border-slate-200 rounded-xl bg-white p-1.5 select-none"
            style={{ userSelect: "none" }}
          >
            {(loadingCohort || loadingBatches) && unifiedStudents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                <RefreshCw size={18} className="animate-spin mb-1 text-emerald-600" />
                <span className="text-xs font-semibold">Loading students...</span>
              </div>
            ) : filteredCohortStudents.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                {unifiedStudents.length === 0
                  ? "No students found for this subject's year and semester. Check if students are registered."
                  : "No students match your filter criteria."}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredCohortStudents.map((stu, sIdx) => {
                  const usnUpper = stu.enrollment_no.toUpperCase();
                  const isSelected = selectedUsns.has(usnUpper);
                  const assignedBatchIdx = studentBatchMap.get(usnUpper);
                  const batchName =
                    assignedBatchIdx !== undefined
                      ? batches[assignedBatchIdx]?.batchName
                      : null;

                  return (
                    <div
                      key={stu.id || stu.enrollment_no}
                      draggable
                      onDragStart={(e) => handleDragStart(e, stu.enrollment_no)}
                      onMouseDown={(e) => handleStudentMouseDown(stu.enrollment_no, sIdx, e)}
                      onMouseEnter={() => handleStudentMouseEnter(stu.enrollment_no, sIdx)}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs transition cursor-grab active:cursor-grabbing border ${
                        isSelected
                          ? "bg-emerald-50 border-emerald-400 text-emerald-950 font-semibold"
                          : "bg-white border-slate-100 hover:bg-slate-50 text-slate-800"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <GripVertical size={13} className="text-slate-300 shrink-0" />
                        <span className="text-emerald-600">
                          {isSelected ? (
                            <CheckSquare size={15} className="text-emerald-600" />
                          ) : (
                            <Square size={15} className="text-slate-300" />
                          )}
                        </span>
                        <span className="font-mono font-extrabold text-[11px] text-slate-900">
                          {stu.enrollment_no}
                        </span>
                        <span className="text-slate-600 truncate max-w-[160px] sm:max-w-[220px]">
                          {stu.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {stu.section && (
                          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            Sec {stu.section}
                          </span>
                        )}
                        {batchName ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <Check size={10} /> {batchName}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                            Unassigned
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-2xl flex items-center gap-2 shrink-0">
            <AlertTriangle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-2xl flex items-center gap-2 shrink-0">
            <Check size={15} className="shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 disabled:opacity-50 transition cursor-pointer shadow-sm"
          >
            {saving ? (
              <>
                <RefreshCw size={13} className="animate-spin" /> Saving Batches...
              </>
            ) : (
              <>
                <Save size={13} /> Save Batches
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
});

SubjectBatchModal.displayName = "SubjectBatchModal";
export default SubjectBatchModal;
