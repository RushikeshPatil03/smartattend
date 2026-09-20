import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Plus,
  X,
  Calendar,
  Award,
  Edit3,
  Trash2,
  Users,
  Sparkles,
  Building2,
  Layers,
  CheckSquare,
  Square,
  Search,
  Wand2,
  RefreshCw,
  GripVertical,
  Check,
  UserCheck,
  Play,
} from "lucide-react";
import apiClient from "../../services/apiClient";

export interface ActivityBatch {
  id?: string;
  activity_id?: string;
  batch_number: number;
  batch_name: string;
  student_enrollments: string[];
}

export interface Activity {
  id: string;
  faculty: string;
  department: string;
  name: string;
  type: "EVENT" | "TRAINING";
  event_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  years?: number[] | null;
  semesters?: number[] | null;
  semester?: number | null;
  section?: string | null;
  created_at?: string;
  dept?: { id: string; name: string; code: string };
  batches?: ActivityBatch[];
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

export type ActivityItem = Activity;

interface ActivitiesViewProps {
  onStartActivitySession?: (activity: ActivityItem, batch?: ActivityBatch) => void;
}

const YEAR_OPTIONS = [
  { label: "1st Year", value: 1, sems: [1, 2] },
  { label: "2nd Year", value: 2, sems: [3, 4] },
  { label: "3rd Year", value: 3, sems: [5, 6] },
  { label: "4th Year", value: 4, sems: [7, 8] },
];

const SEMESTER_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

export const ActivitiesView: React.FC<ActivitiesViewProps> = React.memo(({
  onStartActivitySession,
}) => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [type, setType] = useState<"TRAINING" | "EVENT">("TRAINING");
  const [eventDate, setEventDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [selectedSemesters, setSelectedSemesters] = useState<number[]>([]);
  const [section, setSection] = useState("");
  const [enableBatches, setEnableBatches] = useState(false);
  const [batches, setBatches] = useState<
    Array<{ batchName: string; studentEnrollments: string[] }>
  >([{ batchName: "Default Batch", studentEnrollments: [] }]);

  // Cohort Students for Batch Assignment
  const [cohortStudents, setCohortStudents] = useState<CohortStudent[]>([]);
  const [loadingCohort, setLoadingCohort] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [activeBatchTab, setActiveBatchTab] = useState<"ALL" | number | "UNASSIGNED">("ALL");
  const [selectedUsns, setSelectedUsns] = useState<Set<string>>(new Set());
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [dragOverBatchIdx, setDragOverBatchIdx] = useState<number | null>(null);

  const cohortAbortRef = useRef<AbortController | null>(null);

  // Load activities list
  const loadActivities = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res: any = await apiClient.get("/api/activities", signal);
      if (res?.ok && Array.isArray(res.activities)) {
        setActivities(res.activities);
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("Failed to load activities:", err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadActivities(controller.signal);
    return () => controller.abort();
  }, [loadActivities]);

  // Fetch cohort students automatically based on years/semesters/section
  const fetchCohortStudents = useCallback(
    async (years: number[], semesters: number[], sec: string) => {
      if (cohortAbortRef.current) {
        cohortAbortRef.current.abort();
      }
      const controller = new AbortController();
      cohortAbortRef.current = controller;

      setLoadingCohort(true);
      try {
        const res: any = await apiClient.getCohortStudents(
          { years, semesters, section: sec.trim() || undefined },
          controller.signal
        );
        if (res?.ok && Array.isArray(res.students)) {
          setCohortStudents(res.students);
        } else {
          setCohortStudents([]);
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.error("Failed to fetch cohort students:", err);
          setCohortStudents([]);
        }
      } finally {
        setLoadingCohort(false);
      }
    },
    []
  );

  // Fetch students whenever modal opens or years/semesters/section change
  useEffect(() => {
    if (!modalOpen) return;
    const timeout = setTimeout(() => {
      fetchCohortStudents(selectedYears, selectedSemesters, section);
    }, 250);
    return () => clearTimeout(timeout);
  }, [modalOpen, selectedYears, selectedSemesters, section, fetchCohortStudents]);

  // Mouse up listener for drag-select
  useEffect(() => {
    const handleMouseUp = () => setIsMouseDown(false);
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // Quick Year toggle with smart semester suggestion
  const handleToggleYear = (year: number) => {
    setSelectedYears((prev) => {
      const exists = prev.includes(year);
      const nextYears = exists ? prev.filter((y) => y !== year) : [...prev, year].sort();

      // If user toggles on a year and that year's sems weren't selected, add them
      if (!exists) {
        const yearOpt = YEAR_OPTIONS.find((y) => y.value === year);
        if (yearOpt) {
          setSelectedSemesters((prevSems) => {
            const set = new Set([...prevSems, ...yearOpt.sems]);
            return Array.from(set).sort();
          });
        }
      }
      return nextYears;
    });
  };

  const handleSelectAllYears = () => {
    if (selectedYears.length === 4) {
      setSelectedYears([]);
    } else {
      setSelectedYears([1, 2, 3, 4]);
      setSelectedSemesters([1, 2, 3, 4, 5, 6, 7, 8]);
    }
  };

  // Quick Semester toggle
  const handleToggleSemester = (sem: number) => {
    setSelectedSemesters((prev) => {
      const exists = prev.includes(sem);
      return exists ? prev.filter((s) => s !== sem) : [...prev, sem].sort();
    });
  };

  const handleSelectAllSemesters = () => {
    if (selectedSemesters.length === 8) {
      setSelectedSemesters([]);
    } else {
      setSelectedSemesters([1, 2, 3, 4, 5, 6, 7, 8]);
    }
  };

  // Map USN -> Batch Index
  const studentBatchMap = useMemo(() => {
    const map = new Map<string, number>();
    batches.forEach((b, idx) => {
      (b.studentEnrollments || []).forEach((u) => {
        map.set(String(u).trim().toUpperCase(), idx);
      });
    });
    return map;
  }, [batches]);

  // Filtered Cohort Students
  const filteredCohortStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return cohortStudents.filter((stu) => {
      const usnUpper = String(stu.enrollment_no || "").trim().toUpperCase();
      // Search
      if (q) {
        const matchName = (stu.name || "").toLowerCase().includes(q);
        const matchUsn = (stu.enrollment_no || "").toLowerCase().includes(q);
        if (!matchName && !matchUsn) return false;
      }
      // Tab filter
      if (activeBatchTab === "UNASSIGNED") {
        return !studentBatchMap.has(usnUpper);
      }
      if (typeof activeBatchTab === "number") {
        return studentBatchMap.get(usnUpper) === activeBatchTab;
      }
      return true;
    });
  }, [cohortStudents, studentSearch, activeBatchTab, studentBatchMap]);

  // Handle Mark Select (Checkbox / Click) & Drag-Select (Mouse Sweep)
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

  // Drag and Drop
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
      console.error("Failed to parse dropped student data:", err);
    }
  };

  // Batch Assignment Actions
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
    if (cohortStudents.length === 0 || batches.length === 0) return;
    const total = cohortStudents.length;
    const numBatches = batches.length;
    const chunkSize = Math.ceil(total / numBatches);

    const nextBatches = batches.map((b, idx) => {
      const start = idx * chunkSize;
      const end = Math.min(start + chunkSize, total);
      const slice = cohortStudents.slice(start, end).map((s) => s.enrollment_no.toUpperCase());
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

  // Modal open handlers
  const handleOpenCreate = () => {
    setEditingActivity(null);
    setName("");
    setType("TRAINING");
    setEventDate("");
    setStartDate("");
    setEndDate("");
    setSelectedYears([]);
    setSelectedSemesters([]);
    setSection("");
    setEnableBatches(false);
    setBatches([{ batchName: "Batch 1", studentEnrollments: [] }]);
    setSelectedUsns(new Set());
    setStudentSearch("");
    setActiveBatchTab("ALL");
    setError(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (act: Activity) => {
    setEditingActivity(act);
    setName(act.name || "");
    setType(act.type || "TRAINING");
    setEventDate(act.event_date || "");
    setStartDate(act.start_date || "");
    setEndDate(act.end_date || "");

    const years = Array.isArray(act.years) ? act.years : [];
    const semesters = Array.isArray(act.semesters)
      ? act.semesters
      : act.semester
      ? [act.semester]
      : [];
    setSelectedYears(years);
    setSelectedSemesters(semesters);
    setSection(act.section || "");

    const existingBatches = (act.batches || []).map((b) => ({
      batchName: b.batch_name || `Batch ${b.batch_number}`,
      studentEnrollments: Array.isArray(b.student_enrollments)
        ? b.student_enrollments.map((u) => String(u).toUpperCase())
        : [],
    }));

    if (existingBatches.length > 0) {
      setBatches(existingBatches);
      setEnableBatches(
        existingBatches.length > 1 || existingBatches[0].batchName !== "Default Batch"
      );
    } else {
      setBatches([{ batchName: "Batch 1", studentEnrollments: [] }]);
      setEnableBatches(false);
    }

    setSelectedUsns(new Set());
    setStudentSearch("");
    setActiveBatchTab("ALL");
    setError(null);
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this activity and its batches?")) {
      return;
    }
    try {
      const res: any = await apiClient.delete(`/api/activities/${id}`);
      if (res?.ok) {
        setActivities((prev) => prev.filter((a) => a.id !== id));
      } else {
        alert(res?.error || "Failed to delete activity");
      }
    } catch (err: any) {
      console.error("Delete activity error:", err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        type,
        eventDate: type === "EVENT" ? eventDate : null,
        startDate: type === "TRAINING" ? startDate : null,
        endDate: type === "TRAINING" ? endDate : null,
        years: selectedYears,
        semesters: selectedSemesters,
        semester: selectedSemesters.length > 0 ? selectedSemesters[0] : null,
        section: section ? section.trim().toUpperCase() : null,
        batches: enableBatches
          ? batches.map((b, i) => ({
              batchName: b.batchName.trim() || `Batch ${i + 1}`,
              studentEnrollments: b.studentEnrollments,
            }))
          : [{ batchName: "Default Batch", studentEnrollments: [] }],
      };

      const res: any = editingActivity
        ? await apiClient.put(`/api/activities/${editingActivity.id}`, payload)
        : await apiClient.post("/api/activities", payload);

      if (res?.ok) {
        await loadActivities();
        setModalOpen(false);
      } else {
        setError(res?.error || "Failed to save activity");
      }
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white/80 p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100 mb-6">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700 shadow-xs mb-2">
              <Sparkles size={12} className="text-emerald-600" />
              Co-Curricular & Special Events
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <Award size={22} className="text-emerald-600" />
              Activity & Training Hub
            </h2>
            <p className="text-xs text-slate-500 font-normal mt-0.5">
              Manage multi-day workshops, seminars, training bootcamps, and segment cohort batches with automated USN population.
            </p>
          </div>

          <button
            type="button"
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-emerald-600 text-white text-xs font-bold shadow-md hover:bg-emerald-500 transition cursor-pointer shrink-0"
          >
            <Plus size={16} /> Create Activity
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 rounded-[28px] bg-slate-100/70 animate-pulse" />
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[32px] border border-dashed border-slate-200/80 bg-white/70 py-16 text-center shadow-xs">
            <Award size={36} className="text-slate-300 mb-2" />
            <p className="font-extrabold text-sm text-slate-800">No activities registered yet</p>
            <p className="text-xs text-slate-500 mt-0.5 max-w-sm">
              Create a training bootcamp or one-day event to conduct flexible attendance outside regular courses.
            </p>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition cursor-pointer"
            >
              <Plus size={14} /> Create Activity
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {activities.map((act) => {
              const isEvent = act.type === "EVENT";
              const batchList = act.batches || [];

              return (
                <div
                  key={act.id}
                  className="group relative flex flex-col justify-between rounded-[28px] border border-slate-200/80 bg-white/90 p-6 shadow-xs hover:shadow-md hover:border-emerald-400/80 transition-all duration-200 backdrop-blur-md"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={`inline-block rounded-xl px-3 py-1 font-mono text-[10px] font-extrabold shadow-2xs border ${
                          isEvent
                            ? "bg-cyan-50 text-cyan-800 border-cyan-200"
                            : "bg-emerald-50 text-emerald-800 border-emerald-200"
                        }`}
                      >
                        {act.type}
                      </span>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(act)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                          title="Edit Activity"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(act.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                          title="Delete Activity"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <h3 className="mt-3 font-extrabold text-base text-slate-900 leading-snug group-hover:text-emerald-700 transition">
                      {act.name}
                    </h3>

                    <div className="mt-3 space-y-1.5 text-xs text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <Calendar size={13} className="text-slate-400 shrink-0" />
                        <span>
                          {isEvent
                            ? act.event_date || "Event Date Not Set"
                            : `${act.start_date || "N/A"}${act.end_date ? ` to ${act.end_date}` : ""}`}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Building2 size={13} className="text-slate-400 shrink-0" />
                        <span className="truncate max-w-[200px]">
                          {act.dept?.name || act.dept?.code || "Department"}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Users size={13} className="text-slate-400 shrink-0" />
                        <span>
                          {Array.isArray(act.years) && act.years.length > 0
                            ? `Yr ${act.years.join(", ")}`
                            : "All Years"}
                          {" • "}
                          {Array.isArray(act.semesters) && act.semesters.length > 0
                            ? `Sem ${act.semesters.join(", ")}`
                            : act.semester
                            ? `Sem ${act.semester}`
                            : "All Sems"}
                          {act.section ? ` • Sec ${act.section}` : " • All Sections"}
                        </span>
                      </div>
                    </div>

                    {/* Batches indicator */}
                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 mb-1.5">
                        <span className="flex items-center gap-1">
                          <Layers size={12} className="text-slate-400" />
                          Batches ({batchList.length || 1})
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {batchList.map((b) => (
                          <span
                            key={b.id || b.batch_number}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-semibold"
                          >
                            {b.batch_name}
                            {Array.isArray(b.student_enrollments) && b.student_enrollments.length > 0 && (
                              <span className="opacity-70 font-mono">({b.student_enrollments.length})</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Action Bar: Divert to Take Attendance Tab */}
                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      <div className="text-[11px] text-slate-500 font-medium truncate">
                        {batchList.length > 1 ? `${batchList.length} Batches` : "Cohort Session"}
                      </div>
                      <button
                        type="button"
                        onClick={() => onStartActivitySession?.(act)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white px-3.5 py-1.5 text-xs font-bold shadow-xs transition cursor-pointer shrink-0"
                        title="Divert to Take Attendance tab for this activity"
                      >
                        <Play size={12} className="fill-current" />
                        <span>Take Attendance</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal for Create/Update Activity */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
          <div
            className={`w-full ${
              enableBatches ? "max-w-5xl" : "max-w-xl"
            } bg-white rounded-3xl shadow-2xl border border-slate-200 p-5 sm:p-7 space-y-4 max-h-[92vh] flex flex-col transition-all duration-200`}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <div>
                <h3 className="font-extrabold text-slate-900 text-lg sm:text-xl">
                  {editingActivity ? "Update Activity" : "Create New Activity"}
                </h3>
                <p className="text-xs text-slate-500">
                  Configure multi-year, multi-semester parameters and batch allocations.
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl font-bold border border-rose-200">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-4 pr-1 text-xs">
              <div className={enableBatches ? "grid grid-cols-1 lg:grid-cols-12 gap-6" : "space-y-4"}>
                {/* Left Column: Basic Details & Year/Sem Selection */}
                <div className={enableBatches ? "lg:col-span-5 space-y-4" : "space-y-4"}>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Activity Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. AWS Cloud Bootcamp, Robotics Expo"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-emerald-500 outline-none text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Type</label>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setType("TRAINING")}
                        className={`py-2 px-3 rounded-xl font-bold border transition text-xs cursor-pointer ${
                          type === "TRAINING"
                            ? "bg-emerald-50 border-emerald-400 text-emerald-800 shadow-2xs"
                            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        Training (Multi-Day)
                      </button>
                      <button
                        type="button"
                        onClick={() => setType("EVENT")}
                        className={`py-2 px-3 rounded-xl font-bold border transition text-xs cursor-pointer ${
                          type === "EVENT"
                            ? "bg-cyan-50 border-cyan-400 text-cyan-800 shadow-2xs"
                            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        Event (Single Day)
                      </button>
                    </div>
                  </div>

                  {type === "EVENT" ? (
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Event Date</label>
                      <input
                        type="date"
                        required
                        value={eventDate}
                        onChange={(e) => setEventDate(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-300 outline-none text-xs"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Start Date</label>
                        <input
                          type="date"
                          required
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none text-xs"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">End Date</label>
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none text-xs"
                        />
                      </div>
                    </div>
                  )}

                  {/* Multi-Select Year */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="font-bold text-slate-700">Target Years (Multiple)</label>
                      <button
                        type="button"
                        onClick={handleSelectAllYears}
                        className="text-[11px] text-emerald-600 font-bold hover:underline cursor-pointer"
                      >
                        {selectedYears.length === 4 ? "Clear All" : "Select All Years"}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      {YEAR_OPTIONS.map((y) => {
                        const isSelected = selectedYears.includes(y.value);
                        return (
                          <button
                            key={y.value}
                            type="button"
                            onClick={() => handleToggleYear(y.value)}
                            className={`py-1.5 px-2.5 rounded-xl border font-bold text-xs transition cursor-pointer text-center ${
                              isSelected
                                ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                            }`}
                          >
                            {y.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Multi-Select Semester */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="font-bold text-slate-700">Target Semesters (Multiple)</label>
                      <button
                        type="button"
                        onClick={handleSelectAllSemesters}
                        className="text-[11px] text-emerald-600 font-bold hover:underline cursor-pointer"
                      >
                        {selectedSemesters.length === 8 ? "Clear All" : "Select All Sems"}
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {SEMESTER_OPTIONS.map((sem) => {
                        const isSelected = selectedSemesters.includes(sem);
                        return (
                          <button
                            key={sem}
                            type="button"
                            onClick={() => handleToggleSemester(sem)}
                            className={`py-1.5 px-2 rounded-xl border font-bold text-xs transition cursor-pointer text-center ${
                              isSelected
                                ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                            }`}
                          >
                            Sem {sem}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Section */}
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Section Filter (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. ALL, A, B"
                      value={section}
                      onChange={(e) => setSection(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-300 outline-none text-xs uppercase"
                    />
                  </div>

                  {/* Batch Toggle Button */}
                  <div className="pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-slate-800 block text-xs">Batch Segmentation</span>
                        <span className="text-[11px] text-slate-500">
                          {enableBatches ? "Multiple batches configured" : "Single unified cohort"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !enableBatches;
                          setEnableBatches(next);
                          if (next && batches.length === 0) {
                            setBatches([
                              { batchName: "Batch 1", studentEnrollments: [] },
                              { batchName: "Batch 2", studentEnrollments: [] },
                            ]);
                          }
                        }}
                        className="text-xs text-emerald-600 font-bold hover:underline cursor-pointer"
                      >
                        {enableBatches ? "Disable Multiple Batches" : "+ Configure Multiple Batches"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Column / Batch Studio (When batches enabled) */}
                {enableBatches && (
                  <div className="lg:col-span-7 bg-slate-50/70 rounded-2xl border border-slate-200 p-4 flex flex-col space-y-3">
                    {/* Header with Auto-Split & Batch Controls */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                      <div>
                        <h4 className="font-extrabold text-slate-900 text-sm flex items-center gap-1.5">
                          <Layers size={14} className="text-emerald-600" />
                          Batch Allocation Studio
                        </h4>
                        <p className="text-[11px] text-slate-500">
                          {loadingCohort
                            ? "Fetching cohort students from selected year/sem..."
                            : `${cohortStudents.length} eligible students loaded from department`}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleAutoSplit}
                          disabled={cohortStudents.length === 0 || batches.length === 0}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-[11px] font-bold shadow-xs hover:bg-emerald-500 disabled:opacity-40 transition cursor-pointer"
                          title="Evenly divides the loaded student list across all active batches"
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
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-700 text-[11px] font-bold hover:bg-slate-100 cursor-pointer"
                        >
                          <Plus size={13} /> Add Batch
                        </button>
                      </div>
                    </div>

                    {/* Active Batches Row / Drop Targets */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
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
                            className={`p-2.5 rounded-xl border transition-all ${
                              isDropTarget
                                ? "bg-emerald-100 border-emerald-500 scale-[1.02]"
                                : "bg-white border-slate-200"
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
                                className="font-extrabold text-xs text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-emerald-500 outline-none w-28"
                              />
                              {batches.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setBatches(batches.filter((_, i) => i !== bIdx))}
                                  className="text-slate-400 hover:text-rose-600 p-0.5"
                                  title="Delete Batch"
                                >
                                  <X size={12} />
                                </button>
                              )}
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-slate-500">
                              <span className="font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md">
                                {count} Students
                              </span>
                              <span className="text-[10px] text-slate-400">Drag items here</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Quick Filters & Selection Action Bar */}
                    <div className="space-y-2 pt-1 border-t border-slate-200">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {/* Batch Filter Tabs */}
                        <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px]">
                          <button
                            type="button"
                            onClick={() => setActiveBatchTab("ALL")}
                            className={`px-2 py-1 rounded-lg font-bold transition cursor-pointer ${
                              activeBatchTab === "ALL"
                                ? "bg-slate-800 text-white"
                                : "bg-white text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            All ({cohortStudents.length})
                          </button>
                          {batches.map((b, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setActiveBatchTab(idx)}
                              className={`px-2 py-1 rounded-lg font-bold transition cursor-pointer ${
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
                            className={`px-2 py-1 rounded-lg font-bold transition cursor-pointer ${
                              activeBatchTab === "UNASSIGNED"
                                ? "bg-amber-600 text-white"
                                : "bg-white text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            Unassigned
                          </button>
                        </div>

                        {/* Search input */}
                        <div className="relative w-44">
                          <Search size={12} className="absolute left-2.5 top-2 text-slate-400" />
                          <input
                            type="text"
                            placeholder="Filter by USN / Name"
                            value={studentSearch}
                            onChange={(e) => setStudentSearch(e.target.value)}
                            className="w-full pl-7 pr-2 py-1 rounded-lg border border-slate-300 text-[11px] outline-none"
                          />
                        </div>
                      </div>

                      {/* Selection Toolbar */}
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-2 rounded-xl border border-slate-200">
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
                      className="flex-1 min-h-[220px] max-h-[300px] overflow-y-auto border border-slate-200 rounded-xl bg-white p-1.5 select-none"
                      style={{ userSelect: "none" }}
                    >
                      {loadingCohort ? (
                        <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                          <RefreshCw size={18} className="animate-spin mb-1" />
                          <span className="text-xs font-semibold">Loading student roster...</span>
                        </div>
                      ) : filteredCohortStudents.length === 0 ? (
                        <div className="text-center py-8 text-slate-400 text-xs">
                          {cohortStudents.length === 0
                            ? "No students found for the selected years/semesters. Try selecting different years or clearing the section filter."
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
                                draggable={true}
                                onDragStart={(e) => handleDragStart(e, usnUpper)}
                                onMouseDown={(e) => handleStudentMouseDown(usnUpper, sIdx, e)}
                                onMouseEnter={() => handleStudentMouseEnter(usnUpper, sIdx)}
                                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition ${
                                  isSelected
                                    ? "bg-emerald-50 border-emerald-300 shadow-2xs"
                                    : "bg-white border-slate-100 hover:bg-slate-50"
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-slate-300 hover:text-slate-500 cursor-grab">
                                    <GripVertical size={13} />
                                  </span>
                                  {isSelected ? (
                                    <CheckSquare size={14} className="text-emerald-600 shrink-0" />
                                  ) : (
                                    <Square size={14} className="text-slate-300 shrink-0" />
                                  )}
                                  <span className="font-mono font-bold text-slate-800 text-[11px]">
                                    {stu.enrollment_no}
                                  </span>
                                  <span className="text-slate-600 font-medium truncate max-w-[140px] text-[11px]">
                                    {stu.name}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-slate-400 font-mono">
                                    Y{stu.year}·S{stu.semester}
                                    {stu.section ? `·${stu.section}` : ""}
                                  </span>
                                  {batchName ? (
                                    <span className="inline-block px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                      {batchName}
                                    </span>
                                  ) : (
                                    <span className="inline-block px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-400 text-[10px] font-medium">
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
                )}
              </div>

              {/* Modal Footer */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between shrink-0">
                <span className="text-[11px] text-slate-400">
                  {enableBatches
                    ? `${batches.length} batch(es) configured • Click and drag to multi-select or use Shift+Click`
                    : "Single batch mode active"}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-100 cursor-pointer text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 disabled:opacity-50 cursor-pointer text-xs shadow-md"
                  >
                    {submitting ? "Saving..." : "Save Activity"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
});

ActivitiesView.displayName = "ActivitiesView";
export const ActivitiesTab = ActivitiesView;
export default ActivitiesView;
