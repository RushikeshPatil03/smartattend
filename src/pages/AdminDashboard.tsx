import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../store";
import { Button, Card, Input, Badge } from "../components/Common";
import CollegeHeader from "../components/CollegeHeader";
import ManageDepartments from "./ManageDepartments";
import ManageSubjectsCatalog from "./ManageSubjectsCatalog";
import {
  Activity,
  BarChart3,
  Users,
  Building2,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  LoaderCircle,
  Plus,
  TriangleAlert,
  Shield,
  Copy,
  GraduationCap,
  UserCheck,
  X,
  Link2,
  Sparkles,
  Lock,
  Unlock,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  QrCode,
} from "lucide-react";
import QRCode from "react-qr-code";
import apiClient from "../services/apiClient";

type StudentAnalyticsSubject = {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  facultyNames: string[];
  totalClassesConducted: number;
  classesAttended: number;
  classesMissed: number;
  attendancePercentage: number;
  lastClassAt: string | null;
};

type StudentAnalyticsData = {
  student: {
    id: string;
    name: string;
    email: string;
    enrollmentNo: string;
    semester: number;
    section: string;
    year: number;
    departmentName: string | null;
    departmentCode: string | null;
    profilePhotoUrl?: string;
  };
  overview: {
    totalClassesConducted: number;
    classesAttended: number;
    classesMissed: number;
    overallAttendancePercentage: number;
    subjectCount: number;
    strongSubjects: number;
    riskSubjects: number;
  };
  subjects: StudentAnalyticsSubject[];
  recentSessions: Array<{
    sessionId: string;
    subjectName: string;
    subjectCode: string;
    facultyName: string;
    status: "present" | "absent";
    attendanceCode: "P" | "A";
    startTime: string | null;
    endTime: string | null;
  }>;
};

function formatPct(value: number | null | undefined) {
  const safeValue = Number(value || 0);
  return `${safeValue.toFixed(safeValue % 1 === 0 ? 0 : 1)}%`;
}

function getAttendanceTone(percentage: number) {
  if (percentage >= 85) {
    return {
      badge: "green" as const,
      text: "Excellent",
      accent: "from-emerald-500 via-green-500 to-lime-400",
      rail: "bg-emerald-100",
      fill: "bg-[linear-gradient(90deg,_#10b981_0%,_#22c55e_55%,_#84cc16_100%)]",
      textColor: "text-emerald-700",
    };
  }
  if (percentage >= 75) {
    return {
      badge: "blue" as const,
      text: "Healthy",
      accent: "from-sky-500 via-blue-500 to-cyan-400",
      rail: "bg-sky-100",
      fill: "bg-[linear-gradient(90deg,_#0ea5e9_0%,_#2563eb_55%,_#22d3ee_100%)]",
      textColor: "text-sky-700",
    };
  }
  if (percentage >= 60) {
    return {
      badge: "yellow" as const,
      text: "Watchlist",
      accent: "from-amber-400 via-orange-400 to-yellow-300",
      rail: "bg-amber-100",
      fill: "bg-[linear-gradient(90deg,_#f59e0b_0%,_#fb923c_55%,_#facc15_100%)]",
      textColor: "text-amber-700",
    };
  }
  return {
    badge: "red" as const,
    text: "Critical",
    accent: "from-rose-500 via-red-500 to-orange-400",
    rail: "bg-rose-100",
    fill: "bg-[linear-gradient(90deg,_#f43f5e_0%,_#ef4444_55%,_#fb923c_100%)]",
    textColor: "text-rose-700",
  };
}

const normalizeId = (value: any): string => {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const raw =
      value._id ??
      value.id ??
      value.$oid ??
      (typeof value.toString === "function" && value.toString() !== "[object Object]"
        ? value.toString()
        : "");
    if (raw) {
      return typeof raw === "object" ? normalizeId(raw) : String(raw).trim();
    }
  }
  return "";
};

const extractUserDepartmentId = (user: any): string => {
  if (!user) return "";
  return (
    normalizeId(user.departmentId) ||
    normalizeId(user.department) ||
    normalizeId(user.department_id) ||
    ""
  );
};

const NAV_ITEMS = [
  {
    id: "users" as const,
    label: "Manage Users",
    icon: Users,
    iconBg: "bg-blue-50 text-blue-600 border border-blue-100/80",
    activeIconBg: "bg-blue-600 text-white shadow-xs",
  },
  {
    id: "depts" as const,
    label: "Departments",
    icon: Building2,
    iconBg: "bg-purple-50 text-purple-600 border border-purple-100/80",
    activeIconBg: "bg-purple-600 text-white shadow-xs",
  },
  {
    id: "subjects" as const,
    label: "Subjects",
    icon: BookOpen,
    iconBg: "bg-teal-50 text-teal-600 border border-teal-100/80",
    activeIconBg: "bg-teal-600 text-white shadow-xs",
  },
] as const;

const AdminDashboard: React.FC = () => {
  const {
    currentUser,
    users = [],
    departments = [],
    subjects = [],
    fetchDepartments,
    fetchSubjects,
    fetchUsers,
    logout,
    generateRegistrationLink,
    updateCurrentUser,
    updateFacultyDeviceLock,
  } = useApp();

  const [activeTab, setActiveTab] = useState<"users" | "depts" | "subjects">("users");

  // 🌟 Admin College Name (local UI state)
  const [collegeName, setCollegeName] = useState(
    currentUser?.collegeName || "Your College Name"
  );
  const [collegePhotoUrl, setCollegePhotoUrl] = useState(
    currentUser?.profilePhotoUrl || ""
  );
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  const [showGenModal, setShowGenModal] = useState(false);
  const [genType, setGenType] = useState<"student" | "faculty">("student");
  const [expiryHours, setExpiryHours] = useState<number>(24);
  const [maxRegistrations, setMaxRegistrations] = useState<number>(1);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [generatedConfig, setGeneratedConfig] = useState<any>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genCooldownRemaining, setGenCooldownRemaining] = useState<number>(0);
  const [activeMetricModal, setActiveMetricModal] = useState<
    null | "all" | "students" | "faculty"
  >(null);
  const [metricDepartmentFilter, setMetricDepartmentFilter] = useState("");
  const [metricSemesterFilter, setMetricSemesterFilter] = useState("");
  const [metricSectionFilter, setMetricSectionFilter] = useState("");
  const [metricSearchInput, setMetricSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [metricSortField, setMetricSortField] = useState<
    "name" | "department" | "semester" | "role" | "status"
  >("name");
  const [metricSortDirection, setMetricSortDirection] = useState<"asc" | "desc">(
    "asc"
  );
  const [metricPage, setMetricPage] = useState(1);
  const [metricPageSize, setMetricPageSize] = useState(25);

  const [studentAnalyticsOpen, setStudentAnalyticsOpen] = useState(false);
  const [studentAnalyticsLoading, setStudentAnalyticsLoading] = useState(false);
  const [studentAnalyticsError, setStudentAnalyticsError] = useState<string | null>(null);
  const [studentAnalyticsData, setStudentAnalyticsData] = useState<StudentAnalyticsData | null>(null);
  const [lockingFacultyIds, setLockingFacultyIds] = useState<Record<string, boolean>>({});
  const [deviceLockMessages, setDeviceLockMessages] = useState<Record<string, string>>({});

  const [linkCountdown, setLinkCountdown] = useState("");
  const [isLinkExpired, setIsLinkExpired] = useState(false);

  useEffect(() => {
    if (genCooldownRemaining <= 0) return;
    const timer = setInterval(() => {
      setGenCooldownRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [genCooldownRemaining]);

  useEffect(() => {
    if (!generatedLink || !generatedConfig) {
      setLinkCountdown("");
      setIsLinkExpired(false);
      return;
    }

    const expiryTimestamp = generatedConfig?.expiresAt
      ? new Date(generatedConfig.expiresAt).getTime()
      : Date.now() + (Number(generatedConfig?.expiryHours) || expiryHours || 24) * 3600 * 1000;

    const updateCountdown = () => {
      const now = Date.now();
      const diffMs = expiryTimestamp - now;

      if (diffMs <= 0) {
        setLinkCountdown("Expired");
        setIsLinkExpired(true);
        return;
      }

      setIsLinkExpired(false);
      const totalSeconds = Math.floor(diffMs / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (hours > 0) {
        setLinkCountdown(`${hours}h ${minutes}m`);
      } else if (minutes > 0) {
        setLinkCountdown(`${minutes}m ${seconds}s`);
      } else {
        setLinkCountdown(`${seconds}s`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [generatedLink, generatedConfig, expiryHours]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(metricSearchInput.trim().toLowerCase());
    }, 200);
    return () => clearTimeout(timer);
  }, [metricSearchInput]);

  useEffect(() => {
    setMetricPage(1);
  }, [
    metricDepartmentFilter,
    metricSemesterFilter,
    metricSectionFilter,
    debouncedSearch,
    activeMetricModal,
  ]);

  useEffect(() => {
    setCollegeName(currentUser?.collegeName || "Your College Name");
    setCollegePhotoUrl(currentUser?.profilePhotoUrl || "");
  }, [currentUser?.collegeName, currentUser?.profilePhotoUrl]);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    if (!departments.length || !subjects.length || !users.length) {
      Promise.all([
        fetchDepartments(false, signal),
        fetchSubjects(false, signal),
        fetchUsers(signal),
      ]).catch((err) => {
        if (err?.name !== "AbortError" && !signal.aborted) {
          console.error("Admin dashboard data fetch error:", err);
        }
      });
    }

    return () => {
      controller.abort();
    };
  }, [
    departments.length,
    subjects.length,
    users.length,
    fetchDepartments,
    fetchSubjects,
    fetchUsers,
  ]);

  const sortedUsers = useMemo(
    () =>
      [...(users || [])].sort((a: any, b: any) => {
        const roleCompare = String(a?.role || "").localeCompare(
          String(b?.role || "")
        );
        if (roleCompare !== 0) return roleCompare;
        return String(a?.name || "").localeCompare(String(b?.name || ""));
      }),
    [users]
  );

  const stats = useMemo(() => {
    const allUsers = users || [];
    let studentCount = 0;
    let facultyCount = 0;
    let boundedStudents = 0;
    let unboundedStudents = 0;
    let boundedFaculty = 0;
    let unboundedFaculty = 0;
    let lockedFaculty = 0;
    let anyDeviceFaculty = 0;

    for (const u of allUsers) {
      const role = String(u?.role || "").toUpperCase();
      const isBounded = String(u?.status || "") === "Bounded";

      if (role === "STUDENT") {
        studentCount++;
        if (isBounded) boundedStudents++;
        else unboundedStudents++;
      } else if (role === "FACULTY") {
        facultyCount++;
        if (isBounded) boundedFaculty++;
        else unboundedFaculty++;

        if (u?.deviceLockEnabled === false) {
          anyDeviceFaculty++;
        } else {
          lockedFaculty++;
        }
      }
    }

    const totalUsers = allUsers.length;
    const totalBounded = boundedStudents + boundedFaculty;
    const totalBoundedPct =
      totalUsers > 0 ? Math.round((totalBounded / totalUsers) * 100) : 0;
    const studentBoundedPct =
      studentCount > 0 ? Math.round((boundedStudents / studentCount) * 100) : 0;
    const facultyBoundedPct =
      facultyCount > 0 ? Math.round((boundedFaculty / facultyCount) * 100) : 0;

    return {
      totalUsers,
      totalStudents: studentCount,
      totalFaculty: facultyCount,
      boundedStudents,
      unboundedStudents,
      studentBoundedPct,
      boundedFaculty,
      unboundedFaculty,
      facultyBoundedPct,
      lockedFaculty,
      anyDeviceFaculty,
      totalBounded,
      totalBoundedPct,
    };
  }, [users]);

  const metricCards = useMemo(
    () => [
      {
        key: "all" as const,
        label: "Total Users",
        value: stats.totalUsers,
        icon: Users,
        accent: "text-blue-700 bg-blue-50 border-blue-200",
        progressPct: stats.totalBoundedPct,
        progressLabel: "Bound to Device",
        progressColor: "bg-gradient-to-r from-blue-500 to-indigo-600",
        renderSecondary: (
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span>
              <strong className="font-bold text-slate-900">{stats.totalFaculty}</strong>{" "}
              Faculty
            </span>
            <span className="font-bold text-slate-300">|</span>
            <span>
              <strong className="font-bold text-slate-900">{stats.totalStudents}</strong>{" "}
              Students
            </span>
          </div>
        ),
      },
      {
        key: "students" as const,
        label: "Students",
        value: stats.totalStudents,
        icon: GraduationCap,
        accent: "text-emerald-700 bg-emerald-50 border-emerald-200",
        progressPct: stats.studentBoundedPct,
        progressLabel: "Bound to Device",
        progressColor: "bg-gradient-to-r from-emerald-500 to-teal-500",
        renderSecondary:
          stats.unboundedStudents > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
              <TriangleAlert size={13} className="shrink-0 text-amber-600" />
              <span>{stats.unboundedStudents} Unbounded (no device)</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
              <CheckCircle2 size={13} className="shrink-0 text-emerald-600" />
              <span>All Devices Bound</span>
            </span>
          ),
      },
      {
        key: "faculty" as const,
        label: "Faculty",
        value: stats.totalFaculty,
        icon: UserCheck,
        accent: "text-amber-700 bg-amber-50 border-amber-200",
        progressPct: stats.facultyBoundedPct,
        progressLabel: "Bound to Device",
        progressColor: "bg-gradient-to-r from-amber-500 to-orange-500",
        renderSecondary: (
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span>
              <strong className="font-bold text-slate-900">{stats.lockedFaculty}</strong>{" "}
              Device Locked
            </span>
            <span className="font-bold text-slate-300">|</span>
            <span>
              <strong className="font-bold text-slate-900">{stats.anyDeviceFaculty}</strong>{" "}
              Any-Device
            </span>
          </div>
        ),
      },
    ],
    [stats]
  );

  const openMetricModal = (
    metric: "all" | "students" | "faculty"
  ) => {
    setActiveMetricModal(metric);
    setMetricDepartmentFilter("");
    setMetricSemesterFilter("");
    setMetricSectionFilter("");
    setMetricSearchInput("");
    setDebouncedSearch("");
    setMetricPage(1);
    setMetricSortField("name");
    setMetricSortDirection("asc");
  };

  const handleMetricSort = useCallback(
    (field: "name" | "department" | "semester" | "role" | "status") => {
      setMetricSortField((prevField) => {
        if (prevField === field) {
          setMetricSortDirection((prevDir) =>
            prevDir === "asc" ? "desc" : "asc"
          );
          return prevField;
        }
        setMetricSortDirection("asc");
        return field;
      });
    },
    []
  );

  const metricModalTitle = useMemo(() => {
    switch (activeMetricModal) {
      case "students":
        return "Students";
      case "faculty":
        return "Faculty";
      case "all":
        return "All Users";
      default:
        return "";
    }
  }, [activeMetricModal]);

  const departmentMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const d of departments || []) {
      const id = normalizeId(d);
      if (id) map.set(id, d);
    }
    return map;
  }, [departments]);

  const metricUsers = useMemo(() => {
    const targetDept = metricDepartmentFilter.trim();
    const targetSem = metricSemesterFilter.trim();
    const targetSec = metricSectionFilter.trim().toUpperCase();
    const isStudents = activeMetricModal === "students";
    const isFaculty = activeMetricModal === "faculty";

    return (sortedUsers || []).filter((user: any) => {
      const userRole = String(user?.role || "").toUpperCase();
      if (isStudents && userRole !== "STUDENT") return false;
      if (isFaculty && userRole !== "FACULTY") return false;

      if (targetDept) {
        const userDept = extractUserDepartmentId(user);
        if (userDept !== targetDept) {
          return false;
        }
      }

      if (isStudents) {
        if (targetSem && String(user?.semester ?? "").trim() !== targetSem) {
          return false;
        }
        if (
          targetSec &&
          String(user?.section ?? "").trim().toUpperCase() !== targetSec
        ) {
          return false;
        }
      }

      return true;
    });
  }, [
    sortedUsers,
    activeMetricModal,
    metricDepartmentFilter,
    metricSemesterFilter,
    metricSectionFilter,
  ]);

  const filteredAndSortedMetricUsers = useMemo(() => {
    let result = metricUsers;

    if (debouncedSearch) {
      result = result.filter((u: any) => {
        const name = String(u?.name || "").toLowerCase();
        const email = String(u?.email || "").toLowerCase();
        const enrollment = String(
          u?.enrollmentNo || u?.enrollment_no || ""
        ).toLowerCase();
        const deptName = String(
          u?.departmentName ||
            (typeof u?.department === "object" ? u?.department?.name : "") ||
            departmentMap.get(extractUserDepartmentId(u))?.name ||
            ""
        ).toLowerCase();

        return (
          name.includes(debouncedSearch) ||
          email.includes(debouncedSearch) ||
          enrollment.includes(debouncedSearch) ||
          deptName.includes(debouncedSearch)
        );
      });
    }

    if (metricSortField) {
      result = [...result].sort((a: any, b: any) => {
        let valA = "";
        let valB = "";

        if (metricSortField === "name") {
          valA = String(a?.name || "").toLowerCase();
          valB = String(b?.name || "").toLowerCase();
        } else if (metricSortField === "department") {
          valA = String(
            a?.departmentName ||
              (typeof a?.department === "object" ? a?.department?.name : "") ||
              departmentMap.get(extractUserDepartmentId(a))?.name ||
              ""
          ).toLowerCase();
          valB = String(
            b?.departmentName ||
              (typeof b?.department === "object" ? b?.department?.name : "") ||
              departmentMap.get(extractUserDepartmentId(b))?.name ||
              ""
          ).toLowerCase();
        } else if (metricSortField === "semester") {
          const semA = Number(a?.semester) || 0;
          const semB = Number(b?.semester) || 0;
          return metricSortDirection === "asc" ? semA - semB : semB - semA;
        } else if (metricSortField === "role") {
          valA = String(a?.role || "").toLowerCase();
          valB = String(b?.role || "").toLowerCase();
        } else if (metricSortField === "status") {
          valA = String(a?.status || "").toLowerCase();
          valB = String(b?.status || "").toLowerCase();
        }

        const cmp = valA.localeCompare(valB);
        return metricSortDirection === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [
    metricUsers,
    debouncedSearch,
    metricSortField,
    metricSortDirection,
    departmentMap,
  ]);

  const totalFilteredMetricUsers = filteredAndSortedMetricUsers.length;
  const totalMetricPages = Math.max(
    1,
    Math.ceil(totalFilteredMetricUsers / metricPageSize)
  );
  const safeMetricPage = Math.min(Math.max(1, metricPage), totalMetricPages);

  const paginatedMetricUsers = useMemo(() => {
    const startIndex = (safeMetricPage - 1) * metricPageSize;
    return filteredAndSortedMetricUsers.slice(
      startIndex,
      startIndex + metricPageSize
    );
  }, [filteredAndSortedMetricUsers, safeMetricPage, metricPageSize]);

  const handleOpenGenModal = useCallback(() => {
    setShowGenModal(true);
    setGenError(null);
    setGeneratedLink(null);
    setGeneratedToken(null);
    setGeneratedConfig(null);
    setCopyMessage("");
    setExpiryHours(24);
    setMaxRegistrations(1);
  }, []);

  const handleGenerate = async () => {
    if (genLoading || genCooldownRemaining > 0) return;

    setGenError(null);
    setGeneratedToken(null);
    setGeneratedLink(null);
    setGeneratedConfig(null);
    setCopyMessage("");
    setGenLoading(true);

    try {
      const safeExpiryHours = Math.min(Math.max(Number(expiryHours) || 24, 1), 24 * 365);
      const safeMaxRegistrations = Math.min(
        Math.max(Number(maxRegistrations) || 1, 1),
        10000
      );

      const res = await generateRegistrationLink(
        genType,
        safeExpiryHours,
        safeMaxRegistrations
      );
      if (!res) {
        setGenError("No response from server.");
        return;
      }

      if (res.ok === false) {
        if (
          (res.error || "").toLowerCase().includes("unauthor") ||
          res.status === 401
        ) {
          setGenError("You are not authorized. Please log in again as Admin.");
          return;
        }
        setGenError(res.error || "Failed to generate registration link");
        return;
      }

      const token = res.token || (res.record && res.record.token);
      const nextLink = res.link || (token
        ? `${window.location.origin}/register?token=${token}&role=${genType}`
        : "");

      if (!token || !nextLink) {
        setGenError("Server did not return a token.");
        return;
      }

      setGeneratedToken(token);
      setGeneratedLink(nextLink);
      setGeneratedConfig(
        res.config || {
          expiryHours: safeExpiryHours,
          maxRegistrations: safeMaxRegistrations,
        }
      );
      setGenCooldownRemaining(5);
    } catch (err: any) {
      setGenError(err?.message || "Network error");
    } finally {
      setGenLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    setProfileErr(null);
    setProfileMsg(null);
    setProfileSaving(true);

    try {
      const res: any = await apiClient.updateAdminProfile({
        collegeName,
        profilePhotoUrl: collegePhotoUrl || null,
      });

      if (!res?.ok) {
        setProfileErr(res?.error || "Failed to save profile.");
        return;
      }

      const nextCollege = String(res?.admin?.collegeName || collegeName || "").trim();
      const nextPhoto = String(res?.admin?.profilePhotoUrl || "").trim();
      setCollegeName(nextCollege);
      setCollegePhotoUrl(nextPhoto);
      updateCurrentUser({
        collegeName: nextCollege,
        profilePhotoUrl: nextPhoto || null,
      });
      setProfileMsg("Profile updated.");
    } catch (err: any) {
      setProfileErr(err?.message || "Failed to save profile.");
    } finally {
      setProfileSaving(false);
    }
  };

  const openStudentAnalytics = async (student: any) => {
    setStudentAnalyticsOpen(true);
    setStudentAnalyticsLoading(true);
    setStudentAnalyticsError(null);
    setStudentAnalyticsData(null);

    try {
      const res: any = await apiClient.getStudentAnalytics(String(student?.id || ""));
      if (!res?.ok) {
        setStudentAnalyticsError(res?.error || "Failed to load student analytics.");
        return;
      }
      setStudentAnalyticsData(res as StudentAnalyticsData);
    } catch (err: any) {
      setStudentAnalyticsError(err?.message || "Failed to load student analytics.");
    } finally {
      setStudentAnalyticsLoading(false);
    }
  };

  const closeStudentAnalytics = () => {
    setStudentAnalyticsOpen(false);
    setStudentAnalyticsLoading(false);
    setStudentAnalyticsError(null);
    setStudentAnalyticsData(null);
  };

  const handleFacultyDeviceLockToggle = async (faculty: any) => {
    const facultyId = String(faculty?.id || "");
    if (!facultyId || lockingFacultyIds[facultyId]) return;

    const nextEnabled = !(faculty?.deviceLockEnabled !== false);
    setDeviceLockMessages((prev) => {
      const next = { ...prev };
      delete next[facultyId];
      return next;
    });
    setLockingFacultyIds((prev) => ({ ...prev, [facultyId]: true }));

    try {
      const res: any = await updateFacultyDeviceLock(facultyId, nextEnabled);
      if (!res?.ok) {
        setDeviceLockMessages((prev) => ({
          ...prev,
          [facultyId]: res?.error || "Unable to update faculty device access.",
        }));
      }
    } catch (err: any) {
      setDeviceLockMessages((prev) => ({
        ...prev,
        [facultyId]: err?.message || "Unable to update faculty device access.",
      }));
    } finally {
      setLockingFacultyIds((prev) => {
        const next = { ...prev };
        delete next[facultyId];
        return next;
      });
    }
  };

  const topPerformerSubject = useMemo(() => {
    if (!studentAnalyticsData?.subjects?.length) return null;
    return [...studentAnalyticsData.subjects].sort((a, b) => {
      if (b.attendancePercentage !== a.attendancePercentage) {
        return b.attendancePercentage - a.attendancePercentage;
      }
      return b.classesAttended - a.classesAttended;
    })[0];
  }, [studentAnalyticsData]);

  const attentionSubject = useMemo(() => {
    if (!studentAnalyticsData?.subjects?.length) return null;
    return [...studentAnalyticsData.subjects]
      .filter((subject) => subject.totalClassesConducted > 0)
      .sort((a, b) => {
        if (a.attendancePercentage !== b.attendancePercentage) {
          return a.attendancePercentage - b.attendancePercentage;
        }
        return b.classesMissed - a.classesMissed;
      })[0] || null;
  }, [studentAnalyticsData]);

  // Copy to Clipboard
  const copyToken = async () => {
    if (!generatedLink) return;
    if (!navigator.clipboard?.writeText) {
      prompt("Copy this link:", generatedLink);
      return;
    }
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopyMessage("Copied");
    } catch {
      setCopyMessage("Select the link and copy it manually.");
    }
  };

  return (
    <div className="grid min-h-screen grid-cols-1 gap-6 px-4 py-4 sm:px-6 lg:grid-cols-4 lg:px-8">
      <div className="lg:col-span-4">
        <CollegeHeader
          className="surface-card"
          collegeName={collegeName}
          profilePhotoUrl={collegePhotoUrl}
          title="Admin Dashboard"
          subtitle="Manage users, departments, subjects, and registration access."
          eyebrow="Admin Portal"
          user={currentUser}
          roleLabel="Admin"
          onLogout={logout}
        />
      </div>

      {/* LEFT SIDEBAR */}
      <div className="lg:col-span-1">
        <Card className="sticky top-4 !p-3 sm:!p-4">
          <div className="flex flex-col gap-1.5">
            <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Navigation
            </div>

            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`group relative flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? "border-l-[3px] border-blue-600 bg-blue-50/80 font-semibold text-blue-800 shadow-xs"
                      : "border-l-[3px] border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                      isActive ? item.activeIconBg : item.iconBg
                    }`}
                  >
                    <Icon size={17} />
                  </span>
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}

            <div className="my-2.5 border-t border-slate-100" />

            <div className="px-1">
              <button
                type="button"
                onClick={handleOpenGenModal}
                className="group relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition-all duration-200 hover:shadow-lg hover:shadow-blue-500/30 hover:brightness-105 active:scale-[0.98]"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/20 text-white backdrop-blur-xs">
                  <Plus size={15} strokeWidth={2.5} />
                </span>
                <span className="truncate">Generate Registration Link</span>
              </button>
            </div>
          </div>
        </Card>
      </div>

      {/* MAIN CONTENT */}
      <div className="min-w-0 space-y-6 lg:col-span-3">

        {/* Campus profile is now editable from the profile menu. */}

        {/* USERS */}
        {activeTab === "users" && (
          <div>
            <div className="mb-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {metricCards.map((card) => {
                const Icon = card.icon;
                return (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => openMetricModal(card.key)}
                    className="group min-w-0 text-left focus:outline-none"
                  >
                    <Card className="flex min-h-[175px] flex-col justify-between p-5 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-slate-300 group-hover:shadow-md">
                      <div>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                              {card.label}
                            </p>
                            <p className="mt-1.5 text-3xl font-bold leading-none text-slate-950">
                              {card.value}
                            </p>
                          </div>
                          <div
                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${card.accent}`}
                          >
                            <Icon size={19} />
                          </div>
                        </div>

                        <div className="mt-3.5 flex items-center">
                          {card.renderSecondary}
                        </div>
                      </div>

                      <div className="mt-4 border-t border-slate-100/90 pt-3">
                        <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-slate-500">
                          <span className="flex items-center gap-1">
                            <span>{card.progressLabel}</span>
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-700">
                              {card.progressPct}%
                            </span>
                            <span className="flex items-center gap-1 text-slate-400 transition-colors group-hover:text-blue-600">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500"></span>
                              </span>
                            </span>
                          </div>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${card.progressColor}`}
                            style={{
                              width: `${Math.min(Math.max(card.progressPct, 0), 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </Card>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* DEPARTMENTS */}
        {activeTab === "depts" && <ManageDepartments />}

        {/* SUBJECTS */}
        {activeTab === "subjects" && <ManageSubjectsCatalog />}
      </div>

      {/* TOKEN / USER METRIC MODAL */}
      {activeMetricModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-5">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-xl">
            {/* STICKY MODAL HEADER WITH SEARCH */}
            <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3.5 sm:px-6">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {metricModalTitle}
                </h3>
                <p className="text-xs text-slate-500">
                  Showing {paginatedMetricUsers.length} of {totalFilteredMetricUsers} record
                  {totalFilteredMetricUsers === 1 ? "" : "s"}
                  {totalFilteredMetricUsers !== metricUsers.length
                    ? ` (filtered from ${metricUsers.length})`
                    : ""}
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                {/* SEARCH BAR */}
                <div className="relative w-56 sm:w-72">
                  <Search
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="text"
                    placeholder="Search name, email, roll no..."
                    value={metricSearchInput}
                    onChange={(e) => setMetricSearchInput(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-8 text-xs font-medium text-slate-800 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  />
                  {metricSearchInput && (
                    <button
                      type="button"
                      onClick={() => setMetricSearchInput("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setActiveMetricModal(null)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* FILTERS */}
            {(activeMetricModal === "students" ||
              activeMetricModal === "faculty") && (
              <div className="border-b border-slate-200 bg-slate-50/50 px-4 py-3.5 sm:px-6">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Department
                    </label>
                    <select
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-500"
                      value={metricDepartmentFilter}
                      onChange={(e) => setMetricDepartmentFilter(e.target.value)}
                    >
                      <option value="">All Departments</option>
                      {departments.map((department: any) => {
                        const deptId = normalizeId(department);
                        return (
                          <option
                            key={deptId || department.name}
                            value={deptId}
                          >
                            {department.name}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {activeMetricModal === "students" ? (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">
                          Semester
                        </label>
                        <select
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-500"
                          value={metricSemesterFilter}
                          onChange={(e) => setMetricSemesterFilter(e.target.value)}
                        >
                          <option value="">All Semesters</option>
                          {[1, 2, 3, 4, 5, 6, 7, 8].map((semester) => (
                            <option key={semester} value={semester}>
                              {semester}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">
                          Section
                        </label>
                        <select
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-500"
                          value={metricSectionFilter}
                          onChange={(e) => setMetricSectionFilter(e.target.value)}
                        >
                          <option value="">All Sections</option>
                          {["A", "B", "C", "D"].map((section) => (
                            <option key={section} value={section}>
                              {section}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  ) : null}

                  <div className="flex items-end">
                    <Button
                      variant="secondary"
                      className="!py-1.5 !text-xs w-full"
                      onClick={() => {
                        setMetricDepartmentFilter("");
                        setMetricSemesterFilter("");
                        setMetricSectionFilter("");
                        setMetricSearchInput("");
                      }}
                    >
                      Reset Filters
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* TABLE */}
            <div className="flex-1 overflow-auto px-4 py-4 sm:px-6">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-xs">
                  <tr>
                    <th
                      onClick={() => handleMetricSort("name")}
                      className="cursor-pointer select-none px-4 py-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Name</span>
                        {metricSortField === "name" ? (
                          metricSortDirection === "asc" ? (
                            <ArrowUp size={13} className="text-blue-600" />
                          ) : (
                            <ArrowDown size={13} className="text-blue-600" />
                          )
                        ) : (
                          <ArrowUpDown size={13} className="text-slate-400" />
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => handleMetricSort("role")}
                      className="cursor-pointer select-none px-4 py-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Role</span>
                        {metricSortField === "role" ? (
                          metricSortDirection === "asc" ? (
                            <ArrowUp size={13} className="text-blue-600" />
                          ) : (
                            <ArrowDown size={13} className="text-blue-600" />
                          )
                        ) : (
                          <ArrowUpDown size={13} className="text-slate-400" />
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => handleMetricSort("department")}
                      className="cursor-pointer select-none px-4 py-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Department</span>
                        {metricSortField === "department" ? (
                          metricSortDirection === "asc" ? (
                            <ArrowUp size={13} className="text-blue-600" />
                          ) : (
                            <ArrowDown size={13} className="text-blue-600" />
                          )
                        ) : (
                          <ArrowUpDown size={13} className="text-slate-400" />
                        )}
                      </div>
                    </th>
                    {activeMetricModal === "students" ? (
                      <>
                        <th
                          onClick={() => handleMetricSort("semester")}
                          className="cursor-pointer select-none px-4 py-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Semester</span>
                            {metricSortField === "semester" ? (
                              metricSortDirection === "asc" ? (
                                <ArrowUp size={13} className="text-blue-600" />
                              ) : (
                                <ArrowDown size={13} className="text-blue-600" />
                              )
                            ) : (
                              <ArrowUpDown size={13} className="text-slate-400" />
                            )}
                          </div>
                        </th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-600">
                          Section
                        </th>
                      </>
                    ) : null}
                    <th
                      onClick={() => handleMetricSort("status")}
                      className="cursor-pointer select-none px-4 py-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Status</span>
                        {metricSortField === "status" ? (
                          metricSortDirection === "asc" ? (
                            <ArrowUp size={13} className="text-blue-600" />
                          ) : (
                            <ArrowDown size={13} className="text-blue-600" />
                          )
                        ) : (
                          <ArrowUpDown size={13} className="text-slate-400" />
                        )}
                      </div>
                    </th>
                    {activeMetricModal === "students" ? (
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">
                        Analytics
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {paginatedMetricUsers.length === 0 ? (
                    <tr>
                      <td
                        colSpan={activeMetricModal === "students" ? 7 : 4}
                        className="px-4 py-12 text-center text-sm text-slate-400"
                      >
                        No records match your search or filter criteria.
                      </td>
                    </tr>
                  ) : (
                    paginatedMetricUsers.map((user: any) => (
                      <tr
                        key={`${activeMetricModal}-${user.id || user._id}`}
                        className="border-t transition-colors hover:bg-slate-50/70"
                      >
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-800">
                            {user.name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {user.email}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge>{user.role}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {user.departmentName ||
                            (typeof user.department === "object"
                              ? user.department?.name
                              : null) ||
                            departmentMap.get(extractUserDepartmentId(user))?.name ||
                            "Unassigned"}
                        </td>
                        {activeMetricModal === "students" ? (
                          <>
                            <td className="px-4 py-3">{user.semester || "-"}</td>
                            <td className="px-4 py-3">
                              {String(user.section || "-").toUpperCase()}
                            </td>
                          </>
                        ) : null}
                        <td className="px-4 py-3">
                          {String(user.role || "").toUpperCase() === "FACULTY" ? (
                            <div className="flex flex-col gap-2">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={user.deviceLockEnabled !== false}
                                disabled={!!lockingFacultyIds[String(user.id || "")]}
                                onClick={() => handleFacultyDeviceLockToggle(user)}
                                className={`group inline-flex w-fit items-center gap-3 rounded-full border px-2 py-1 transition-all disabled:cursor-wait disabled:opacity-70 ${
                                  user.deviceLockEnabled !== false
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-slate-200 bg-slate-50 text-slate-600"
                                }`}
                              >
                                <span
                                  className={`relative h-7 w-14 rounded-full transition-colors ${
                                    user.deviceLockEnabled !== false
                                      ? "bg-emerald-600"
                                      : "bg-slate-400"
                                  }`}
                                >
                                  <span
                                    className={`absolute top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform ${
                                      user.deviceLockEnabled !== false
                                        ? "translate-x-8 text-emerald-700"
                                        : "translate-x-1 text-slate-500"
                                    }`}
                                  >
                                    {lockingFacultyIds[String(user.id || "")] ? (
                                      <LoaderCircle size={12} className="animate-spin" />
                                    ) : user.deviceLockEnabled !== false ? (
                                      <Lock size={12} />
                                    ) : (
                                      <Unlock size={12} />
                                    )}
                                  </span>
                                </span>
                                <span className="min-w-24 text-left text-xs font-semibold">
                                  {user.deviceLockEnabled !== false
                                    ? "Device locked"
                                    : "Any device"}
                                </span>
                              </button>

                              {deviceLockMessages[String(user.id || "")] ? (
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-600">
                                  <TriangleAlert size={13} className="shrink-0" />
                                  <span>{deviceLockMessages[String(user.id || "")]}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-slate-500">
                                  {user.deviceLockEnabled !== false
                                    ? "Login allowed only from registered device"
                                    : "Password login allowed from any device"}
                                </span>
                              )}
                            </div>
                          ) : (
                            <Badge color={user.status === "Bounded" ? "green" : "red"}>
                              {user.status}
                            </Badge>
                          )}
                        </td>
                        {activeMetricModal === "students" ? (
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="outline"
                              className="whitespace-nowrap !text-xs !py-1.5"
                              onClick={() => openStudentAnalytics(user)}
                            >
                              <BarChart3 size={15} />
                              See Analytics
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* PAGINATION FOOTER */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/90 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3 text-xs text-slate-600">
                <span>
                  Showing{" "}
                  <strong className="font-semibold text-slate-800">
                    {totalFilteredMetricUsers === 0
                      ? 0
                      : (safeMetricPage - 1) * metricPageSize + 1}
                  </strong>{" "}
                  to{" "}
                  <strong className="font-semibold text-slate-800">
                    {Math.min(safeMetricPage * metricPageSize, totalFilteredMetricUsers)}
                  </strong>{" "}
                  of{" "}
                  <strong className="font-semibold text-slate-800">
                    {totalFilteredMetricUsers}
                  </strong>{" "}
                  records
                </span>

                <div className="flex items-center gap-1.5">
                  <label className="text-slate-500">Rows:</label>
                  <select
                    value={metricPageSize}
                    onChange={(e) => {
                      setMetricPageSize(Number(e.target.value));
                      setMetricPage(1);
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-500"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="!px-2.5 !py-1 !text-xs"
                  disabled={safeMetricPage <= 1}
                  onClick={() => setMetricPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={14} />
                  Previous
                </Button>

                <span className="text-xs font-semibold text-slate-700">
                  Page {safeMetricPage} of {totalMetricPages}
                </span>

                <Button
                  variant="outline"
                  className="!px-2.5 !py-1 !text-xs"
                  disabled={safeMetricPage >= totalMetricPages}
                  onClick={() =>
                    setMetricPage((p) => Math.min(totalMetricPages, p + 1))
                  }
                >
                  Next
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {studentAnalyticsOpen && (
        <div className="fixed inset-0 z-[60] flex items-stretch justify-center overflow-hidden bg-slate-950/60 p-3 sm:p-4">
          <div className="flex h-[calc(100dvh-1.5rem)] w-full max-w-[1180px] flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl sm:h-[calc(100dvh-2rem)]">
            <div className="relative shrink-0 overflow-hidden border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.2),_transparent_34%),linear-gradient(135deg,_#0f172a_0%,_#0f766e_52%,_#14b8a6_100%)] px-4 py-3 text-white sm:px-5 sm:py-4">
              <div className="absolute right-0 top-0 h-28 w-28 rounded-full bg-white/10 blur-3xl" />
              <div className="relative flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/90">
                    <Activity size={14} />
                    Student Analytics
                  </div>
                  <h3 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
                    {studentAnalyticsData?.student?.name || "Attendance Performance"}
                  </h3>
                  <p className="mt-1 max-w-3xl text-xs text-teal-50/90 sm:text-sm">
                    Subject-wise attendance performance, class coverage, and recent participation in one focused view.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeStudentAnalytics}
                  className="rounded-xl border border-white/15 bg-white/10 p-2 text-white transition hover:bg-white/20"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-[linear-gradient(180deg,_#f8fafc_0%,_#f0fdfa_100%)] px-3 py-3 sm:px-4 sm:py-4">
              {studentAnalyticsLoading ? (
                <div className="flex min-h-[360px] items-center justify-center">
                  <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-200 bg-white/90 px-8 py-10 text-center shadow-sm">
                    <LoaderCircle size={30} className="animate-spin text-teal-600" />
                    <div>
                      <p className="text-base font-semibold text-slate-900">Loading attendance analytics</p>
                      <p className="mt-1 text-sm text-slate-500">Pulling subject totals, attended classes, and recent session history.</p>
                    </div>
                  </div>
                </div>
              ) : studentAnalyticsError ? (
                <div className="flex min-h-[320px] items-center justify-center">
                  <div className="max-w-md rounded-3xl border border-rose-200 bg-white px-6 py-8 text-center shadow-sm">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
                      <TriangleAlert size={24} />
                    </div>
                    <p className="text-lg font-semibold text-slate-900">Unable to load analytics</p>
                    <p className="mt-2 text-sm text-slate-600">{studentAnalyticsError}</p>
                    <div className="mt-5 flex justify-center">
                      <Button variant="secondary" onClick={closeStudentAnalytics}>Close</Button>
                    </div>
                  </div>
                </div>
              ) : studentAnalyticsData ? (
                <div className="space-y-4">
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                    <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
                      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                        <div className="flex min-w-0 items-center gap-4">
                          {studentAnalyticsData.student.profilePhotoUrl ? (
                            <img
                              src={studentAnalyticsData.student.profilePhotoUrl}
                              alt={studentAnalyticsData.student.name}
                              className="h-14 w-14 rounded-2xl border border-slate-200 object-cover shadow-sm"
                            />
                          ) : (
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-base font-bold text-slate-500">
                              {String(studentAnalyticsData.student.name || "S").slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0 pt-0.5">
                            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Student Profile</p>
                            <h4 className="truncate text-lg font-semibold text-slate-900">{studentAnalyticsData.student.name}</h4>
                            <p className="truncate text-sm text-slate-500">{studentAnalyticsData.student.email}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 sm:max-w-[42%] sm:justify-end">
                          <Badge>{studentAnalyticsData.student.enrollmentNo}</Badge>
                          <Badge color="gray">Sem {studentAnalyticsData.student.semester}</Badge>
                          <Badge color="gray">Sec {String(studentAnalyticsData.student.section || "").toUpperCase()}</Badge>
                        </div>
                      </div>

                      <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4 sm:px-5">
                        <div className="rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Overall Attendance</p>
                          <p className="mt-2 text-2xl font-bold text-slate-900">
                            {formatPct(studentAnalyticsData.overview.overallAttendancePercentage)}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">
                            {studentAnalyticsData.overview.classesAttended} of {studentAnalyticsData.overview.totalClassesConducted} classes attended
                          </p>
                        </div>
                        <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Subjects Tracked</p>
                          <p className="mt-2 text-2xl font-bold text-slate-900">{studentAnalyticsData.overview.subjectCount}</p>
                          <p className="mt-1 text-sm text-slate-600">Attendance coverage across all allotted subjects</p>
                        </div>
                        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Healthy Subjects</p>
                          <p className="mt-2 text-2xl font-bold text-slate-900">{studentAnalyticsData.overview.strongSubjects}</p>
                          <p className="mt-1 text-sm text-slate-600">Subjects currently at or above 75%</p>
                        </div>
                        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Needs Attention</p>
                          <p className="mt-2 text-2xl font-bold text-slate-900">{studentAnalyticsData.overview.riskSubjects}</p>
                          <p className="mt-1 text-sm text-slate-600">Subjects currently below the safe threshold</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3">
                      <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Best Performing Subject</p>
                            <h4 className="mt-1 text-lg font-semibold text-slate-900">
                              {topPerformerSubject?.subjectName || "No data yet"}
                            </h4>
                          </div>
                          <CheckCircle2 className="text-emerald-500" size={22} />
                        </div>
                        {topPerformerSubject ? (
                          <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3">
                            <div className="flex items-center justify-between gap-4">
                              <Badge color={getAttendanceTone(topPerformerSubject.attendancePercentage).badge}>
                                {formatPct(topPerformerSubject.attendancePercentage)}
                              </Badge>
                              <span className="text-sm text-slate-500">
                                {topPerformerSubject.classesAttended}/{topPerformerSubject.totalClassesConducted} attended
                              </span>
                            </div>
                            <p className="mt-3 text-sm text-slate-600">
                              {topPerformerSubject.subjectCode || "No code"}
                            </p>
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-slate-500">This student does not have any completed class data yet.</p>
                        )}
                      </div>

                      <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Priority Focus</p>
                            <h4 className="mt-1 text-lg font-semibold text-slate-900">
                              {attentionSubject?.subjectName || "No risk subject"}
                            </h4>
                          </div>
                          <CalendarDays className="text-amber-500" size={22} />
                        </div>
                        {attentionSubject ? (
                          <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3">
                            <div className="flex items-center justify-between gap-4">
                              <Badge color={getAttendanceTone(attentionSubject.attendancePercentage).badge}>
                                {formatPct(attentionSubject.attendancePercentage)}
                              </Badge>
                              <span className="text-sm text-slate-500">
                                {attentionSubject.classesMissed} missed classes
                              </span>
                            </div>
                            <p className="mt-3 text-sm text-slate-600">
                              {attentionSubject.totalClassesConducted > 0
                                ? "This subject currently needs the most recovery."
                                : "No completed classes yet for this subject."}
                            </p>
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-slate-500">No immediate recovery subject detected.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Subject Breakdown</p>
                        <h4 className="mt-1 text-lg font-semibold text-slate-900">Interactive subject attendance view</h4>
                      </div>
                      <p className="text-sm text-slate-500">Risky subjects stand out instantly.</p>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      {studentAnalyticsData.subjects.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500 lg:col-span-2">
                          No completed class sessions found for this student yet.
                        </div>
                      ) : (
                        studentAnalyticsData.subjects.map((subject) => {
                          const tone = getAttendanceTone(subject.attendancePercentage);
                          const circumference = 2 * Math.PI * 32;
                          const dashOffset =
                            circumference - (Math.max(0, Math.min(subject.attendancePercentage, 100)) / 100) * circumference;
                          const gradientId = `subject-analytics-${subject.subjectId}`;

                          return (
                            <div
                              key={subject.subjectId}
                              className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff_0%,_#f8fafc_100%)] p-4 shadow-sm transition-transform duration-200 hover:-translate-y-0.5"
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h5 className="truncate text-base font-semibold text-slate-900">{subject.subjectName}</h5>
                                    <Badge color={tone.badge}>{tone.text}</Badge>
                                  </div>
                                  <p className="mt-1 text-sm text-slate-500">
                                    {subject.subjectCode || "No subject code"}
                                  </p>
                                  {subject.facultyNames.length > 0 ? (
                                    <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                                      Faculty: {subject.facultyNames.join(", ")}
                                    </p>
                                  ) : null}
                                </div>

                                <div className="relative h-16 w-16 shrink-0">
                                  <svg viewBox="0 0 80 80" className="h-16 w-16 -rotate-90">
                                    <circle cx="40" cy="40" r="32" stroke="#e2e8f0" strokeWidth="8" fill="none" />
                                    <circle
                                      cx="40"
                                      cy="40"
                                      r="32"
                                      stroke={`url(#${gradientId})`}
                                      strokeWidth="8"
                                      strokeLinecap="round"
                                      strokeDasharray={circumference}
                                      strokeDashoffset={dashOffset}
                                      fill="none"
                                    />
                                    <defs>
                                      <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" stopColor="#14b8a6" />
                                        <stop offset="100%" stopColor="#2563eb" />
                                      </linearGradient>
                                    </defs>
                                  </svg>
                                  <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-900">
                                    {Math.round(subject.attendancePercentage)}%
                                  </div>
                                </div>
                              </div>

                              <div className="mt-4">
                                <div className={`h-3 overflow-hidden rounded-full ${tone.rail}`}>
                                  <div
                                    className={`h-full rounded-full ${tone.fill}`}
                                    style={{ width: `${Math.max(4, Math.min(subject.attendancePercentage, 100))}%` }}
                                  />
                                </div>
                              </div>

                              <div className="mt-4 grid grid-cols-3 gap-2">
                                <div className="rounded-2xl bg-slate-50 px-3 py-2.5 text-center">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Total</p>
                                  <p className="mt-1.5 text-lg font-bold text-slate-900">{subject.totalClassesConducted}</p>
                                </div>
                                <div className="rounded-2xl bg-emerald-50 px-3 py-2.5 text-center">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-600">Attended</p>
                                  <p className="mt-1.5 text-lg font-bold text-emerald-700">{subject.classesAttended}</p>
                                </div>
                                <div className="rounded-2xl bg-rose-50 px-3 py-2.5 text-center">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-600">Missed</p>
                                  <p className="mt-1.5 text-lg font-bold text-rose-700">{subject.classesMissed}</p>
                                </div>
                              </div>

                              {subject.lastClassAt ? (
                                <p className="mt-3 text-xs text-slate-400">
                                  Last completed class: {new Date(subject.lastClassAt).toLocaleString()}
                                </p>
                              ) : (
                                <p className="mt-3 text-xs text-slate-400">No completed class recorded yet.</p>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Recent Classes</p>
                        <h4 className="mt-1 text-lg font-semibold text-slate-900">Latest attendance trail</h4>
                      </div>
                      <p className="text-sm text-slate-500">Quickly spot recent consistency.</p>
                    </div>

                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[760px] text-left text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-3">Subject</th>
                            <th className="px-4 py-3">Faculty</th>
                            <th className="px-4 py-3">Date</th>
                            <th className="px-4 py-3">Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {studentAnalyticsData.recentSessions.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-400">
                                No recent completed sessions are available yet.
                              </td>
                            </tr>
                          ) : (
                            studentAnalyticsData.recentSessions.map((session) => (
                              <tr key={session.sessionId} className="border-t border-slate-100">
                                <td className="px-4 py-3">
                                  <div className="font-semibold text-slate-800">{session.subjectName}</div>
                                  <div className="text-xs text-slate-500">{session.subjectCode || "No code"}</div>
                                </td>
                                <td className="px-4 py-3 text-slate-600">{session.facultyName || "Faculty"}</td>
                                <td className="px-4 py-3 text-slate-600">
                                  {session.endTime || session.startTime
                                    ? new Date(session.endTime || session.startTime || "").toLocaleString()
                                    : "-"}
                                </td>
                                <td className="px-4 py-3">
                                  <Badge color={session.status === "present" ? "green" : "red"}>
                                    {session.status === "present" ? "Present" : "Absent"}
                                  </Badge>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {showGenModal && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center overflow-hidden bg-black/40 p-3 sm:p-5">
          <div className="flex h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:h-[calc(100dvh-2.5rem)]">
            <div className="shrink-0 bg-[linear-gradient(135deg,_#0f172a_0%,_#1d4ed8_60%,_#38bdf8_100%)] px-4 py-5 text-white sm:px-6 sm:py-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em]">
                    <Sparkles size={14} />
                    Smart Access
                  </div>
                  <h3 className="break-words text-xl font-semibold sm:text-2xl">Generate Registration Link</h3>
                  <p className="mt-2 max-w-xl text-sm text-slate-100/90">
                    Control who can register, how long the link stays active, and how many accounts can be created from one invite.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGenModal(false)}
                  className="rounded-xl bg-white/10 p-2 text-white transition hover:bg-white/20"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-4 py-5 sm:px-6 sm:py-6">
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Role</label>
                  <select
                    value={genType}
                    onChange={(e) => setGenType(e.target.value as any)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="student">Student</option>
                    <option value="faculty">Faculty</option>
                  </select>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Expiry Time in Hours</label>
                    <Input
                      type="number"
                      min={1}
                      max={8760}
                      value={expiryHours}
                      onChange={(e) => setExpiryHours(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Registration Capacity</label>
                    <Input
                      type="number"
                      min={1}
                      max={10000}
                      value={maxRegistrations}
                      onChange={(e) => setMaxRegistrations(Number(e.target.value))}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Minimum 1. Set this to your batch size so the same link works for multiple users.
                    </p>
                  </div>
                </div>

                {/* informational boxes removed per UX request */}

                {genError ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {genError}
                  </div>
                ) : null}

                {generatedLink ? (
                  <div className="min-w-0 space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                        <Link2 size={16} className="text-blue-600" />
                        <span>Registration Link Ready</span>
                      </div>

                      {linkCountdown ? (
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shadow-xs ${
                            isLinkExpired
                              ? "border border-rose-200 bg-rose-50 text-rose-700"
                              : "border border-amber-200 bg-amber-50 text-amber-800"
                          }`}
                        >
                          <span>⏳</span>
                          <span>
                            {isLinkExpired ? "Link Expired" : `Expires in ${linkCountdown}`}
                          </span>
                        </span>
                      ) : null}
                    </div>

                    {/* QR CODE DISPLAY */}
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                      <div className="rounded-2xl border-4 border-slate-100 bg-white p-3 shadow-md">
                        <QRCode
                          value={generatedLink}
                          size={168}
                          level="M"
                          style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                        />
                      </div>
                      <div className="mt-3 text-center">
                        <p className="flex items-center justify-center gap-1.5 text-xs font-bold text-slate-800">
                          <QrCode size={14} className="text-blue-600" />
                          Scan to Register ({genType === "student" ? "Student" : "Faculty"})
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          Project on screen or screenshot to share directly with applicants
                        </p>
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
                      <input
                        readOnly
                        value={generatedLink}
                        onClick={(event) => event.currentTarget.select()}
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <Button onClick={copyToken} className="w-full shrink-0 sm:w-auto">
                        <Copy size={16} /> Copy Link
                      </Button>
                    </div>
                    {copyMessage ? (
                      <p className="text-xs font-semibold text-emerald-700">{copyMessage}</p>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl bg-white p-3 border border-slate-200">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Capacity</p>
                        <p className="mt-1 text-lg font-semibold text-slate-900">
                          {generatedConfig?.maxRegistrations || maxRegistrations} registrations
                        </p>
                      </div>
                      <div className="rounded-xl bg-white p-3 border border-slate-200">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Expiry Window</p>
                        <p className="mt-1 text-lg font-semibold text-slate-900">
                          {generatedConfig?.expiryHours || expiryHours} hours
                        </p>
                      </div>
                      <div className="rounded-xl bg-white p-3 border border-slate-200 sm:col-span-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Public Host</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900 break-all">
                          {new URL(generatedLink).origin}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Button
                        variant="secondary"
                        className="w-full sm:flex-1"
                        onClick={() => {
                          setGeneratedLink(null);
                          setGeneratedToken(null);
                          setGeneratedConfig(null);
                          setCopyMessage("");
                        }}
                      >
                        Create Another Link
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button
                      disabled={genLoading || genCooldownRemaining > 0}
                      onClick={handleGenerate}
                      className="w-full sm:w-auto"
                    >
                      {genLoading
                        ? "Generating..."
                        : genCooldownRemaining > 0
                        ? `Wait ${genCooldownRemaining}s...`
                        : "Generate Link"}
                    </Button>
                    <Button variant="secondary" onClick={() => setShowGenModal(false)} className="w-full sm:w-auto">
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
