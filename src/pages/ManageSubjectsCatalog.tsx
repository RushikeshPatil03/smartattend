import React, { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Input } from "../components/Common";
import {
  BookOpen,
  Layers3,
  Plus,
  Trash,
  X,
  Edit,
  ChevronDown,
  ChevronRight,
  Check,
  Building2,
  Users,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import apiClient from "../services/apiClient";
import { useApp } from "../store";

const YEAR_CONFIG = [
  { year: 1, label: "Year 1", semesters: [1, 2] },
  { year: 2, label: "Year 2", semesters: [3, 4] },
  { year: 3, label: "Year 3", semesters: [5, 6] },
  { year: 4, label: "Year 4", semesters: [7, 8] },
];

const SECTION_OPTIONS = ["A", "B", "C", "D"];
const ROMAN_SEMESTERS: Record<number, string> = {
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
  5: "V",
  6: "VI",
  7: "VII",
  8: "VIII",
};

const getId = (item: any) => String(item?._id || item?.id || "");

const ManageSubjectsCatalog: React.FC = () => {
  const {
    subjects = [],
    departments = [],
    users = [],
    sessions = [],
    addSubject,
    deleteSubject,
    fetchSubjects,
    allotSubject,
  } = useApp();

  const [selectedYear, setSelectedYear] = useState(1);
  const [selectedSemester, setSelectedSemester] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");

  const [showAllot, setShowAllot] = useState(false);
  const [allotTargetSubject, setAllotTargetSubject] = useState<any | null>(null);
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<string[]>([]);
  const [selectedSectionsByDept, setSelectedSectionsByDept] = useState<Record<string, string[]>>({});
  const [openDeptAccordions, setOpenDeptAccordions] = useState<Record<string, boolean>>({});
  const [expandedSectionRows, setExpandedSectionRows] = useState<Record<string, boolean>>({});
  const [facultyByAssignment, setFacultyByAssignment] = useState<Record<string, string[]>>({});
  const [applyFacultyId, setApplyFacultyId] = useState("");
  const [allotLoading, setAllotLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetchSubjects(false, controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetchSubjects]);

  const currentYearConfig = YEAR_CONFIG.find((e) => e.year === selectedYear) || YEAR_CONFIG[0];

  useEffect(() => {
    if (!currentYearConfig.semesters.includes(selectedSemester)) {
      setSelectedSemester(currentYearConfig.semesters[0]);
    }
  }, [currentYearConfig, selectedSemester]);

  const faculties = useMemo(
    () => users.filter((u: any) => String(u?.role).toUpperCase() === "FACULTY").sort((a: any, b: any) => String(a?.name || "").localeCompare(String(b?.name || ""))),
    [users]
  );

  const visibleSubjects = useMemo(
    () =>
      [...subjects]
        .filter((s: any) => Number(s?.year) === selectedYear && Number(s?.semester) === selectedSemester)
        .sort((a: any, b: any) => `${a?.code || ""} ${a?.name || ""}`.localeCompare(`${b?.code || ""} ${b?.name || ""}`)),
    [subjects, selectedYear, selectedSemester]
  );

  const subjectSummary = useMemo(() => {
    const totalSubjects = visibleSubjects.length;
    const totalAssignments = visibleSubjects.reduce((count: number, subject: any) => count + Number(subject?.assignmentCount || 0), 0);
    return { totalSubjects, totalAssignments };
  }, [visibleSubjects]);

  const generatedRows = useMemo(() => {
    if (!allotTargetSubject) return [];
    return selectedDepartmentIds.flatMap((departmentId) => {
      const department = departments.find((d: any) => getId(d) === departmentId);
      if (!department) return [];
      const activeSections = selectedSectionsByDept[departmentId] || [];
      return activeSections.map((section) => {
        const rowKey = `${departmentId}:${section}`;
        const classCode = `${String(department.code || "").toUpperCase()}${allotTargetSubject.year}${allotTargetSubject.semester}${section}-${String(allotTargetSubject.code || "").toUpperCase()}`;
        return {
          rowKey,
          departmentId,
          departmentName: department.name,
          departmentCode: String(department.code || "").toUpperCase(),
          section,
          classCode,
          facultyIds: facultyByAssignment[rowKey] || [],
        };
      });
    });
  }, [
    allotTargetSubject,
    departments,
    facultyByAssignment,
    selectedDepartmentIds,
    selectedSectionsByDept,
  ]);

  const departmentsWithAllotmentData = useMemo(() => {
    if (!allotTargetSubject) return [];
    return selectedDepartmentIds.map((departmentId) => {
      const department = departments.find((d: any) => getId(d) === departmentId);
      const activeSections = selectedSectionsByDept[departmentId] || [];
      const sections = activeSections.map((section) => {
        const rowKey = `${departmentId}:${section}`;
        const classCode = `${String(department?.code || "").toUpperCase()}${allotTargetSubject.year}${allotTargetSubject.semester}${section}-${String(allotTargetSubject.code || "").toUpperCase()}`;
        return {
          rowKey,
          departmentId,
          departmentName: department?.name || "Department",
          departmentCode: String(department?.code || "").toUpperCase(),
          section,
          classCode,
          facultyIds: facultyByAssignment[rowKey] || [],
        };
      });

      const assignedSectionsCount = sections.reduce(
        (acc, s) => acc + (s.facultyIds.length > 0 ? 1 : 0),
        0
      );

      return {
        departmentId,
        department,
        name: department?.name || "Department",
        code: String(department?.code || "").toUpperCase(),
        activeSections,
        sections,
        assignedSectionsCount,
      };
    });
  }, [
    allotTargetSubject,
    selectedDepartmentIds,
    departments,
    selectedSectionsByDept,
    facultyByAssignment,
  ]);

  const resetAddForm = () => {
    setName("");
    setCode("");
    setShowAdd(false);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;
    setLoading(true);
    const res = await addSubject({ name: name.trim(), code: code.trim().toUpperCase(), year: selectedYear, semester: selectedSemester, departmentIds: [] });
    if (res?.ok) {
      await fetchSubjects();
      resetAddForm();
    } else {
      alert(res?.error || "Failed to create subject");
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    setDeleteLoadingId(id);
    try {
      const res = await deleteSubject(id);
      if (!res?.ok) {
        alert(res?.error || "Failed to delete subject");
      } else {
        setConfirmDeleteId(null);
      }
    } catch (err: any) {
      alert(err?.message || "Failed to delete subject");
    } finally {
      setDeleteLoadingId(null);
    }
  };

  const startEdit = (subject: any) => {
    setEditingId(getId(subject));
    setEditName(subject?.name || "");
    setEditCode(subject?.code || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditCode("");
  };

  const saveEdit = async (subject: any) => {
    const id = getId(subject);
    if (!editName.trim() || !editCode.trim()) return alert("Please provide name and code");
    setLoading(true);
    try {
      const res: any = await apiClient.put(`/api/subject/${encodeURIComponent(id)}`, { name: editName.trim(), code: editCode.trim().toUpperCase(), year: subject.year, semester: subject.semester });
      if (!res?.ok) alert(res?.error || "Failed to update subject");
      else {
        await fetchSubjects();
        cancelEdit();
      }
    } catch (err: any) {
      alert(err?.message || "Failed to update subject");
    } finally {
      setLoading(false);
    }
  };

  const openAllotModal = (subject: any) => {
    const existingAssignments = Array.isArray(subject?.assignments)
      ? subject.assignments
      : [];
    const departmentIds: string[] = Array.from(
      new Set(
        existingAssignments
          .map((a: any) => String(getId(a.department) || ""))
          .filter(Boolean)
      )
    );

    const nextSectionsByDept: Record<string, string[]> = {};
    const nextFacultyByAssignment: Record<string, string[]> = {};
    const nextOpenAccordions: Record<string, boolean> = {};

    existingAssignments.forEach((assignment: any) => {
      const departmentId = getId(assignment.department);
      const facultyId = getId(assignment.faculty);
      const section = String(assignment?.section || "").toUpperCase();

      if (departmentId && section) {
        if (!nextSectionsByDept[departmentId]) {
          nextSectionsByDept[departmentId] = [];
        }
        if (!nextSectionsByDept[departmentId].includes(section)) {
          nextSectionsByDept[departmentId].push(section);
        }

        if (facultyId) {
          const key = `${departmentId}:${section}`;
          const cur = nextFacultyByAssignment[key] || [];
          if (!cur.includes(facultyId)) {
            nextFacultyByAssignment[key] = [...cur, facultyId];
          }
        }
      }
    });

    departmentIds.forEach((deptId) => {
      if (!nextSectionsByDept[deptId] || nextSectionsByDept[deptId].length === 0) {
        nextSectionsByDept[deptId] = [...SECTION_OPTIONS];
      }
      nextOpenAccordions[deptId] = true;
    });

    setAllotTargetSubject(subject);
    setSelectedDepartmentIds(departmentIds);
    setSelectedSectionsByDept(nextSectionsByDept);
    setFacultyByAssignment(nextFacultyByAssignment);
    setOpenDeptAccordions(nextOpenAccordions);
    setExpandedSectionRows({});
    setApplyFacultyId("");
    setShowAllot(true);
  };

  const toggleDepartment = (departmentId: string) => {
    setSelectedDepartmentIds((cur) => {
      const exists = cur.includes(departmentId);
      if (exists) {
        return cur.filter((d) => d !== departmentId);
      } else {
        setSelectedSectionsByDept((prev) => ({
          ...prev,
          [departmentId]: prev[departmentId]?.length
            ? prev[departmentId]
            : [...SECTION_OPTIONS],
        }));
        setOpenDeptAccordions((prev) => ({
          ...prev,
          [departmentId]: true,
        }));
        return [...cur, departmentId];
      }
    });
  };

  const toggleDepartmentSection = (departmentId: string, section: string) => {
    setSelectedSectionsByDept((prev) => {
      const current = prev[departmentId] || [];
      const updated = current.includes(section)
        ? current.filter((s) => s !== section)
        : [...current, section].sort();
      return { ...prev, [departmentId]: updated };
    });
  };

  const selectAllDepartmentSections = (departmentId: string) => {
    setSelectedSectionsByDept((prev) => ({
      ...prev,
      [departmentId]: [...SECTION_OPTIONS],
    }));
  };

  const clearAllDepartmentSections = (departmentId: string) => {
    setSelectedSectionsByDept((prev) => ({
      ...prev,
      [departmentId]: [],
    }));
  };

  const toggleDeptAccordion = (departmentId: string) => {
    setOpenDeptAccordions((prev) => ({
      ...prev,
      [departmentId]: !prev[departmentId],
    }));
  };

  const toggleSectionRowExpand = (rowKey: string) => {
    setExpandedSectionRows((prev) => ({
      ...prev,
      [rowKey]: !prev[rowKey],
    }));
  };

  const applyFacultyToDept = (departmentId: string, facultyId: string) => {
    if (!facultyId) return;
    const sections = selectedSectionsByDept[departmentId] || [];
    setFacultyByAssignment((cur) => {
      const next = { ...cur };
      sections.forEach((sec) => {
        const rowKey = `${departmentId}:${sec}`;
        const existing = next[rowKey] || [];
        if (!existing.includes(facultyId)) {
          next[rowKey] = [...existing, facultyId];
        }
      });
      return next;
    });
  };

  const toggleRowFaculty = (rowKey: string, facultyId: string) => {
    setFacultyByAssignment((cur) => {
      const existing = cur[rowKey] || [];
      const updated = existing.includes(facultyId)
        ? existing.filter((id) => id !== facultyId)
        : [...existing, facultyId];
      return { ...cur, [rowKey]: updated };
    });
  };

  const applyFacultyToAll = () => {
    if (!applyFacultyId) return;
    setFacultyByAssignment((cur) => {
      const next = { ...cur };
      generatedRows.forEach((r) => {
        const existing = next[r.rowKey] || [];
        if (!existing.includes(applyFacultyId)) {
          next[r.rowKey] = [...existing, applyFacultyId];
        }
      });
      return next;
    });
  };

  const handleAllotSave = async () => {
    if (!allotTargetSubject) return;
    if (!selectedDepartmentIds.length) return alert("Select at least one department.");
    const completedAssignments: any[] = [];
    generatedRows.forEach((r) => {
      (r.facultyIds || []).forEach((facultyId: string) => {
        completedAssignments.push({
          departmentId: r.departmentId,
          facultyId,
          section: r.section,
          classCode: r.classCode,
        });
      });
    });
    if (!completedAssignments.length) return alert("Assign at least one faculty before saving allotments.");
    setAllotLoading(true);
    const res = await allotSubject(getId(allotTargetSubject), completedAssignments);
    if (res?.ok) {
      await fetchSubjects();
      setShowAllot(false);
    } else alert(res?.error || "Failed to save allotments");
    setAllotLoading(false);
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-slate-200">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Subject Catalog</h2>
            <p className="mt-1 text-sm text-slate-500">Browse subjects by academic year and semester, then generate section-wise faculty allotments.</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Badge color="blue">{currentYearConfig.label}</Badge>
            <Badge color="gray">Semester {ROMAN_SEMESTERS[selectedSemester]}</Badge>
            <Badge color="yellow">{subjectSummary.totalAssignments} active allotments</Badge>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {YEAR_CONFIG.map((entry) => (
            <button key={entry.year} type="button" onClick={() => setSelectedYear(entry.year)} className={`rounded-2xl border p-4 text-left transition-all ${selectedYear === entry.year ? "border-blue-300 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{entry.label}</p>
                  <p className="mt-1 text-xs text-slate-500">Semesters {entry.semesters.map((s) => ROMAN_SEMESTERS[s]).join(" & ")}</p>
                </div>
                <Layers3 size={18} className={selectedYear === entry.year ? "text-blue-600" : "text-slate-400"} />
              </div>
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          {currentYearConfig.semesters.map((semester) => (
            <button key={semester} type="button" onClick={() => setSelectedSemester(semester)} className={`rounded-full px-4 py-2 text-sm font-semibold transition-all ${selectedSemester === semester ? "bg-blue-600 text-white shadow-sm shadow-blue-900/15" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              Semester {ROMAN_SEMESTERS[semester]}
            </button>
          ))}
        </div>
      </Card>

      <Card className="border-blue-100 bg-gradient-to-br from-blue-50 via-white to-sky-50">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Active Context</p>
            <h3 className="mt-2 text-xl font-semibold text-slate-900">{currentYearConfig.label} · Semester {ROMAN_SEMESTERS[selectedSemester]}</h3>
            <p className="mt-1 text-sm text-slate-500">Add subjects directly inside this semester to avoid wrong academic mapping.</p>
          </div>

          <Button onClick={() => setShowAdd((c) => !c)}><Plus size={16} /> {showAdd ? "Close Form" : "Add Subject"}</Button>
        </div>

        {showAdd && (
          <form onSubmit={handleAdd} className="mt-5 grid gap-4 md:grid-cols-3">
            <Input label="Subject Name" placeholder="Big Data Analytics" value={name} onChange={(e) => setName(e.target.value)} required />
            <Input label="Subject Code" placeholder="BDA" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required />
            <div className="flex items-end gap-2">
              <Button type="submit" className="w-full" disabled={loading}>{loading ? "Saving..." : "Save Subject"}</Button>
              <Button type="button" variant="secondary" onClick={resetAddForm} disabled={loading}>Cancel</Button>
            </div>
          </form>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Semester Subjects</h3>
            <p className="text-sm text-slate-500">{subjectSummary.totalSubjects} subject{subjectSummary.totalSubjects === 1 ? "" : "s"} in Semester {ROMAN_SEMESTERS[selectedSemester]}</p>
          </div>
          <Badge color="gray">Year {selectedYear}</Badge>
        </div>

        <div className="mt-5 space-y-3">
          {visibleSubjects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center">
              <BookOpen className="mx-auto text-slate-300" size={28} />
              <p className="mt-3 text-sm font-medium text-slate-600">No subjects added for this semester yet.</p>
              <p className="mt-1 text-sm text-slate-400">Use Add Subject to create the semester catalog first.</p>
            </div>
          ) : (
            visibleSubjects.map((subject: any) => {
              const subjectId = getId(subject);
              const assignmentCount = Number(subject?.assignmentCount || 0);
              const assignmentDepartments = Array.isArray(subject?.assignments) ? [...new Set(subject.assignments.map((a: any) => a?.department?.name).filter(Boolean))] : [];

              return (
                <div key={subjectId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      {editingId === subjectId ? (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <input className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" value={editName} onChange={(e) => setEditName(e.target.value)} />
                            <input className="w-36 rounded-md border border-slate-300 px-2 py-1 text-sm" value={editCode} onChange={(e) => setEditCode(e.target.value.toUpperCase())} />
                            <div className="flex gap-2">
                              <button className="rounded-md bg-emerald-600 px-3 py-1 text-white text-sm" onClick={() => saveEdit(subject)} disabled={loading}>Save</button>
                              <button className="rounded-md border px-3 py-1 text-sm" onClick={cancelEdit}>Cancel</button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-lg font-semibold text-slate-900">{subject.name}</h4>
                            <Badge color="blue">{subject.code}</Badge>
                            <Badge color={assignmentCount > 0 ? "green" : "gray"}>{assignmentCount} allotment{assignmentCount === 1 ? "" : "s"}</Badge>
                          </div>
                          <div className="mt-2 text-sm text-slate-500">Departments: {assignmentDepartments.length > 0 ? assignmentDepartments.join(", ") : "Not allotted yet"}</div>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button variant="outline" onClick={() => openAllotModal(subject)}>Allot</Button>
                      <button className="p-2 text-slate-700 hover:bg-slate-50 rounded-lg" onClick={() => startEdit(subject)}><Edit size={16} /></button>
                      <Button
                        variant="danger"
                        onClick={() => setConfirmDeleteId(confirmDeleteId === subjectId ? null : subjectId)}
                        disabled={loading || deleteLoadingId === subjectId}
                      >
                        <Trash size={16} />
                      </Button>
                    </div>
                  </div>

                  {confirmDeleteId === subjectId && (
                    <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/80 p-4 shadow-xs animate-in fade-in duration-150">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                            <TriangleAlert size={18} />
                          </div>
                          <div>
                            <h5 className="text-sm font-bold text-rose-900">
                              Delete Subject: {subject.name} ({subject.code})?
                            </h5>
                            <p className="mt-0.5 text-xs text-rose-700">
                              {(() => {
                                const subjectSessionCount = Number(
                                  subject?.sessionCount ||
                                    subject?.totalSessions ||
                                    sessions.filter((s: any) => {
                                      const sId = String(
                                        s?.subject?._id ||
                                          s?.subject?.id ||
                                          s?.subjectId ||
                                          s?.subject ||
                                          ""
                                      );
                                      return (
                                        sId === subjectId ||
                                        (s?.subject?.code &&
                                          s?.subject?.code === subject?.code)
                                      );
                                    }).length ||
                                    0
                                );
                                if (subjectSessionCount > 0) {
                                  return `⚠️ This subject has ${subjectSessionCount} recorded attendance session${
                                    subjectSessionCount === 1 ? "" : "s"
                                  } and ${assignmentCount} faculty allotment${
                                    assignmentCount === 1 ? "" : "s"
                                  }. Deletion cannot be undone.`;
                                }
                                if (assignmentCount > 0) {
                                  return `⚠️ This subject has ${assignmentCount} active faculty allotment${
                                    assignmentCount === 1 ? "" : "s"
                                  }. All associated section allotments will be removed permanently.`;
                                }
                                return "This subject has no recorded attendance sessions. Deletion cannot be undone.";
                              })()}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={deleteLoadingId === subjectId}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <Button
                            variant="danger"
                            className="!px-3 !py-1.5 !text-xs whitespace-nowrap"
                            onClick={() => handleDelete(subjectId)}
                            disabled={deleteLoadingId === subjectId}
                          >
                            {deleteLoadingId === subjectId ? "Deleting..." : "Confirm Delete"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {Array.isArray(subject?.assignments) && subject.assignments.length > 0 && (
                    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full min-w-[640px] text-left text-sm">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="px-4 py-3 font-medium">Class Code</th>
                            <th className="px-4 py-3 font-medium">Department</th>
                            <th className="px-4 py-3 font-medium">Section</th>
                            <th className="px-4 py-3 font-medium">Faculty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {subject.assignments.map((assignment: any) => (
                            <tr key={getId(assignment) || `${subjectId}-${assignment.classCode}`} className="border-t border-slate-100">
                              <td className="px-4 py-3 font-medium text-slate-800">{assignment.classCode}</td>
                              <td className="px-4 py-3">{assignment?.department?.name || "-"}</td>
                              <td className="px-4 py-3">{assignment?.section || "-"}</td>
                              <td className="px-4 py-3">{assignment?.faculty?.name || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>

      {showAllot && allotTargetSubject && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center overflow-hidden bg-black/50 p-3 sm:p-4">
          <div className="flex h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:h-[calc(100dvh-2rem)]">
            <div className="shrink-0 flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6 sm:py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Allot Subject</p>
                <h3 className="mt-2 text-xl font-semibold text-slate-900">{allotTargetSubject.name} ({allotTargetSubject.code})</h3>
                <p className="mt-1 text-sm text-slate-500">{`Year ${allotTargetSubject.year} · Semester ${ROMAN_SEMESTERS[allotTargetSubject.semester]}`}</p>
              </div>

              <button type="button" onClick={() => setShowAllot(false)} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
            </div>

            <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[280px_1fr]">
              <div className="max-h-64 overflow-auto border-b border-slate-200 bg-slate-50 p-4 sm:p-6 lg:max-h-none lg:border-b-0 lg:border-r">
                <h4 className="text-sm font-semibold text-slate-900">1. Choose Departments</h4>
                <p className="mt-1 text-sm text-slate-500">Each selected department generates sections A to D automatically.</p>

                <div className="mt-4 space-y-2">
                  {departments.map((department: any) => {
                    const departmentId = getId(department);
                    const checked = selectedDepartmentIds.includes(departmentId);
                    return (
                      <label key={departmentId} className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition ${checked ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                        <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" checked={checked} onChange={() => toggleDepartment(departmentId)} />
                        <div>
                          <div className="font-medium text-slate-800">{department.name}</div>
                          <div className="text-xs text-slate-500">{String(department.code || "").toUpperCase()}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex min-h-0 flex-col overflow-hidden">
                <div className="shrink-0 border-b border-slate-200 px-4 py-4 sm:px-6">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">
                        2. Configure Department Sections & Faculty
                      </h4>
                      <p className="mt-1 text-xs text-slate-500">
                        Enable sections (A, B, C, D) per department, then click a section to assign faculty. Class codes are generated automatically.
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <select
                        className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs bg-white text-slate-800"
                        value={applyFacultyId}
                        onChange={(e) => setApplyFacultyId(e.target.value)}
                      >
                        <option value="">Same faculty for all classes</option>
                        {faculties.map((f: any) => (
                          <option key={getId(f)} value={getId(f)}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="secondary"
                        className="!py-1.5 !text-xs"
                        onClick={applyFacultyToAll}
                        disabled={!applyFacultyId || generatedRows.length === 0}
                      >
                        Copy to All Sections
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
                  {departmentsWithAllotmentData.length === 0 ? (
                    <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                      <Building2 size={32} className="mb-2 text-slate-300" />
                      <p className="font-semibold text-slate-700">No departments selected</p>
                      <p className="mt-1 text-xs text-slate-400">
                        Select one or more departments from the left panel to configure section allotments.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {departmentsWithAllotmentData.map((deptGroup) => {
                        const isOpen = openDeptAccordions[deptGroup.departmentId] !== false;
                        return (
                          <div
                            key={deptGroup.departmentId}
                            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs transition"
                          >
                            {/* DEPARTMENT ACCORDION HEADER */}
                            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/90 px-4 py-3 sm:px-5">
                              <button
                                type="button"
                                onClick={() => toggleDeptAccordion(deptGroup.departmentId)}
                                className="flex items-center gap-2.5 text-left font-semibold text-slate-900 transition hover:text-blue-600"
                              >
                                <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-xs">
                                  {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                </span>
                                <div>
                                  <span className="text-sm font-bold text-slate-900">
                                    {deptGroup.name}
                                  </span>
                                  <span className="ml-2 rounded-md bg-slate-200/70 px-2 py-0.5 text-xs font-bold text-slate-700">
                                    {deptGroup.code}
                                  </span>
                                </div>
                              </button>

                              {/* COMPACT SECTION CHIPS ROW */}
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-semibold text-slate-500">
                                  Sections:
                                </span>
                                <div className="flex items-center gap-1">
                                  {SECTION_OPTIONS.map((sec) => {
                                    const isSecActive = deptGroup.activeSections.includes(sec);
                                    return (
                                      <button
                                        key={sec}
                                        type="button"
                                        onClick={() =>
                                          toggleDepartmentSection(deptGroup.departmentId, sec)
                                        }
                                        className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold transition-all ${
                                          isSecActive
                                            ? "bg-blue-600 text-white shadow-xs"
                                            : "border border-slate-300 bg-white text-slate-600 hover:border-blue-400 hover:bg-blue-50/50"
                                        }`}
                                        title={
                                          isSecActive
                                            ? `Click to remove Section ${sec}`
                                            : `Click to add Section ${sec}`
                                        }
                                      >
                                        {sec}
                                      </button>
                                    );
                                  })}
                                </div>

                                <div className="ml-1 flex items-center gap-1 border-l border-slate-200 pl-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      selectAllDepartmentSections(deptGroup.departmentId)
                                    }
                                    className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-50"
                                  >
                                    All
                                  </button>
                                  <span className="text-slate-300">/</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      clearAllDepartmentSections(deptGroup.departmentId)
                                    }
                                    className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100"
                                  >
                                    None
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* ACCORDION CONTENT */}
                            {isOpen && (
                              <div className="border-t border-slate-100 p-4 sm:p-5">
                                {deptGroup.sections.length === 0 ? (
                                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
                                    No active sections for {deptGroup.name}. Click section chips (A, B, C, D) above to enable them.
                                  </div>
                                ) : (
                                  <div className="space-y-2.5">
                                    {deptGroup.sections.map((secRow) => {
                                      const isExpanded = expandedSectionRows[secRow.rowKey] || secRow.facultyIds.length === 0;
                                      const hasFaculty = secRow.facultyIds.length > 0;

                                      return (
                                        <div
                                          key={secRow.rowKey}
                                          className={`rounded-xl border transition-all ${
                                            hasFaculty
                                              ? "border-slate-200 bg-white"
                                              : "border-amber-200/80 bg-amber-50/20"
                                          }`}
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                                            <div className="flex flex-wrap items-center gap-2.5">
                                              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-xs font-bold text-blue-700">
                                                {secRow.section}
                                              </span>
                                              <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-slate-800">
                                                {secRow.classCode}
                                              </span>

                                              {/* Faculty chips */}
                                              {hasFaculty ? (
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                  {secRow.facultyIds.map((fId: string) => {
                                                    const fObj = faculties.find(
                                                      (f: any) => getId(f) === fId
                                                    );
                                                    return (
                                                      <span
                                                        key={fId}
                                                        className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800"
                                                      >
                                                        <span>{fObj?.name || fId}</span>
                                                        <button
                                                          type="button"
                                                          onClick={() =>
                                                            toggleRowFaculty(secRow.rowKey, fId)
                                                          }
                                                          className="cursor-pointer text-blue-500 hover:text-blue-800"
                                                          title="Remove faculty"
                                                        >
                                                          <X size={12} />
                                                        </button>
                                                      </span>
                                                    );
                                                  })}
                                                </div>
                                              ) : (
                                                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                                                  <span>⚠️ No faculty assigned</span>
                                                </span>
                                              )}
                                            </div>

                                            <button
                                              type="button"
                                              onClick={() => toggleSectionRowExpand(secRow.rowKey)}
                                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                                            >
                                              <span>{isExpanded ? "Collapse" : "Configure Faculty"}</span>
                                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                            </button>
                                          </div>

                                          {/* EXPANDABLE FACULTY SELECTOR */}
                                          {isExpanded && (
                                            <div className="border-t border-slate-100 bg-slate-50/70 p-3 sm:px-4 sm:py-3">
                                              <label className="mb-1 block text-xs font-semibold text-slate-600">
                                                Assign / Add Co-Faculty for Section {secRow.section}:
                                              </label>
                                              <select
                                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                                value=""
                                                onChange={(e) => {
                                                  if (e.target.value) {
                                                    toggleRowFaculty(secRow.rowKey, e.target.value);
                                                  }
                                                }}
                                              >
                                                <option value="">+ Select faculty to assign...</option>
                                                {faculties.map((faculty: any) => {
                                                  const fId = getId(faculty);
                                                  const isSelected = secRow.facultyIds.includes(fId);
                                                  return (
                                                    <option
                                                      key={fId}
                                                      value={fId}
                                                      disabled={isSelected}
                                                    >
                                                      {isSelected
                                                        ? `✓ ${faculty.name} (Assigned)`
                                                        : `${faculty.name} (${faculty.email})`}
                                                    </option>
                                                  );
                                                })}
                                              </select>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="shrink-0 flex items-center justify-between border-t border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6">
                  <span className="text-xs text-slate-600">
                    <strong className="font-semibold text-slate-800">
                      {generatedRows.length}
                    </strong>{" "}
                    section classes configured across{" "}
                    <strong className="font-semibold text-slate-800">
                      {departmentsWithAllotmentData.length}
                    </strong>{" "}
                    departments
                  </span>
                  <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={() => setShowAllot(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleAllotSave} disabled={allotLoading}>
                      {allotLoading ? "Saving..." : "Save Allotments"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageSubjectsCatalog;
