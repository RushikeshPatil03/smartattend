import React from "react";
import {
  BarChart3,
  Filter,
  LoaderCircle,
  Search,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Users,
  X,
  Sparkles,
} from "lucide-react";
import { Badge, Button, CountUp } from "../../components/Common";
import { FacultySubjectAnalyticsData } from "./types";

interface FacultyAnalyticsModalProps {
  isOpen: boolean;
  loading: boolean;
  error: string;
  data: FacultySubjectAnalyticsData | null;
  targetSubject: any;
  classCodeFilter: string;
  attendanceFilter: string;
  searchQuery: string;
  filteredStudents: FacultySubjectAnalyticsData["students"];
  strongestClass: FacultySubjectAnalyticsData["classCodeInsights"][0] | null;
  weakestClass: FacultySubjectAnalyticsData["classCodeInsights"][0] | null;
  setClassCodeFilter: (val: string) => void;
  setAttendanceFilter: (val: string) => void;
  setSearchQuery: (val: string) => void;
  onClassCodeChange: (classCode: string) => Promise<void>;
  onClose: () => void;
}

const formatPercent = (value: number | null | undefined) =>
  `${Number(value || 0).toFixed(Number(value || 0) % 1 === 0 ? 0 : 1)}%`;

const getPercentBadgeColor = (value: number) =>
  value >= 85 ? "green" : value >= 75 ? "blue" : value >= 60 ? "yellow" : "red";

export const FacultyAnalyticsModal: React.FC<FacultyAnalyticsModalProps> = React.memo(({
  isOpen,
  loading,
  error,
  data,
  targetSubject,
  classCodeFilter,
  attendanceFilter,
  searchQuery,
  filteredStudents,
  strongestClass,
  weakestClass,
  setClassCodeFilter,
  setAttendanceFilter,
  setSearchQuery,
  onClassCodeChange,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="my-6 flex max-h-[92vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        {/* Modal Header */}
        <div className="border-b border-slate-200 bg-gradient-to-r from-slate-900 via-teal-950 to-emerald-950 px-6 py-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-300">
                <BarChart3 size={13} />
                <span>Subject Intelligence Hub</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-black tracking-tight">
                {data?.subject?.name || targetSubject?.name || "Subject Analytics"}
              </h3>
              <p className="mt-1 text-xs text-teal-100/80">
                Deep dive into class-wise attendance trends, at-risk student cohorts, and historical session trails.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-slate-300 hover:bg-white/10 hover:text-white transition cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="overflow-y-auto bg-slate-50/50 p-5 md:p-6 space-y-6">
          {loading ? (
            <div className="flex min-h-[360px] items-center justify-center">
              <div className="rounded-3xl border border-slate-200 bg-white px-8 py-10 text-center shadow-sm">
                <LoaderCircle size={32} className="mx-auto animate-spin text-emerald-600 mb-3" />
                <p className="text-base font-bold text-slate-900">Building Subject Intelligence</p>
                <p className="mt-1 text-xs text-slate-500">
                  Aggregating class-wise attendance telemetry and risk metrics...
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="flex min-h-[320px] items-center justify-center">
              <div className="max-w-md rounded-3xl border border-rose-200 bg-white px-6 py-8 text-center shadow-sm">
                <TriangleAlert size={28} className="mx-auto text-rose-500 mb-3" />
                <p className="text-base font-bold text-slate-900">Unable to load analytics</p>
                <p className="mt-1 text-xs text-slate-600">{error}</p>
              </div>
            </div>
          ) : data ? (
            <div className="space-y-6">
              {/* Executive Summary Cards */}
              <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
                <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      <Badge color="green">{data.subject.code}</Badge>
                      <span className="text-xs font-semibold text-slate-500">
                        {data.filters.classCodes.length} Assigned Class Section(s)
                      </span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4 shadow-2xs">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-sky-700">
                          Total Classes
                        </p>
                        <p className="mt-1 text-2xl font-black text-slate-900 font-mono">
                          <CountUp value={data.overview.totalClasses} />
                        </p>
                      </div>

                      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 shadow-2xs">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                          Avg Attendees %
                        </p>
                        <p className="mt-1 text-2xl font-black text-slate-900 font-mono">
                          <CountUp
                            value={data.overview.averageAttendancePercentage}
                            decimals={1}
                            suffix="%"
                          />
                        </p>
                      </div>

                      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 shadow-2xs">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                          Students
                        </p>
                        <p className="mt-1 text-2xl font-black text-slate-900 font-mono">
                          <CountUp value={data.overview.totalStudents} />
                        </p>
                      </div>

                      <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4 shadow-2xs">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-rose-700">
                          Below 75% At-Risk
                        </p>
                        <p className="mt-1 text-2xl font-black text-rose-900 font-mono">
                          <CountUp value={data.overview.studentsBelow75} />
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Highlights */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Strongest Class
                          </p>
                          <p className="mt-1 text-base font-bold text-slate-900">
                            {strongestClass?.classCode || "No data"}
                          </p>
                        </div>
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                          <TrendingUp size={16} />
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-slate-600">
                        {strongestClass
                          ? `${formatPercent(strongestClass.averageAttendancePercentage)} avg attendance across ${strongestClass.totalClasses} classes.`
                          : "No completed sessions yet."}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Needs Focus
                          </p>
                          <p className="mt-1 text-base font-bold text-slate-900">
                            {weakestClass?.classCode || "No data"}
                          </p>
                        </div>
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
                          <TrendingDown size={16} />
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-slate-600">
                        {weakestClass
                          ? `${formatPercent(weakestClass.averageAttendancePercentage)} avg attendance. Recommended for intervention.`
                          : "No risk sections flagged."}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Filters Bar */}
              <div className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm grid gap-3 lg:grid-cols-[220px_220px_1fr]">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Filter by Class Code
                  </label>
                  <select
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
                    value={classCodeFilter}
                    onChange={(e) => onClassCodeChange(e.target.value)}
                  >
                    <option value="">All Class Codes</option>
                    {data.filters.classCodes.map((item) => (
                      <option key={item.classCode} value={item.classCode}>
                        {item.classCode} • {item.departmentCode || item.departmentName} • Sec {item.section}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Attendance Range
                  </label>
                  <select
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
                    value={attendanceFilter}
                    onChange={(e) => setAttendanceFilter(e.target.value)}
                  >
                    <option value="all">All Students</option>
                    <option value="below_75">Below 75% (At-Risk)</option>
                    <option value="75_plus">75% and above</option>
                    <option value="90_plus">90% and above</option>
                    <option value="zero">Zero Attendance</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Search Student
                  </label>
                  <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <Search size={14} className="text-slate-400" />
                    <input
                      className="w-full bg-transparent text-xs font-medium text-slate-800 outline-none"
                      placeholder="Search by name, USN, or section..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Class Insights & Recent Sessions Grid */}
              <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                {/* Class Performance Progression */}
                <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
                  <h4 className="font-bold text-sm text-slate-900 mb-3">
                    Section Quorum Breakdown
                  </h4>
                  <div className="space-y-3">
                    {data.classCodeInsights.length === 0 ? (
                      <p className="text-xs text-slate-400 py-6 text-center">No completed class data.</p>
                    ) : (
                      data.classCodeInsights.map((item) => (
                        <div key={item.classCode} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">{item.classCode}</span>
                              <Badge color={getPercentBadgeColor(item.averageAttendancePercentage) as any}>
                                {formatPercent(item.averageAttendancePercentage)}
                              </Badge>
                            </div>
                            <span className="text-slate-500 font-mono">
                              {item.totalClasses} classes • {item.studentCount} students
                            </span>
                          </div>

                          <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500"
                              style={{ width: `${Math.min(100, Math.max(4, item.averageAttendancePercentage))}%` }}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Recent Completed Sessions */}
                <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
                  <h4 className="font-bold text-sm text-slate-900 mb-3">
                    Recent Session Attendance
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-100 text-slate-400 font-semibold uppercase text-[10px]">
                        <tr>
                          <th className="pb-2">Class</th>
                          <th className="pb-2">Date</th>
                          <th className="pb-2 text-right">Quorum</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.sessionInsights.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="py-6 text-center text-slate-400 text-xs">
                              No recent session history.
                            </td>
                          </tr>
                        ) : (
                          data.sessionInsights.map((session) => (
                            <tr key={session.sessionId}>
                              <td className="py-2.5 font-semibold text-slate-800">
                                <div>{session.classCode}</div>
                                {session.facultyName && (
                                  <div className="text-[10px] text-slate-400 font-normal">{session.facultyName}</div>
                                )}
                              </td>
                              <td className="py-2.5 text-slate-500">
                                {new Date(session.date).toLocaleDateString()}
                              </td>
                              <td className="py-2.5 text-right font-mono font-bold">
                                {session.presentCount}/{session.eligibleCount} (
                                {formatPercent(session.attendancePercentage)})
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Student Cohort Table */}
              <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                  <h4 className="font-bold text-sm text-slate-900">
                    Student-wise Attendance Register
                  </h4>
                  <span className="text-xs font-mono text-slate-500">
                    {filteredStudents.length} student(s) matched
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Student</th>
                        <th className="px-4 py-3">Class</th>
                        <th className="px-4 py-3">Quorum %</th>
                        <th className="px-4 py-3 text-center">Attended / Total</th>
                        <th className="px-4 py-3 text-center">Missed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {filteredStudents.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-400">
                            No students match the current filters.
                          </td>
                        </tr>
                      ) : (
                        filteredStudents.map((student) => (
                          <tr key={student.studentId} className="hover:bg-slate-50/60 transition">
                            <td className="px-4 py-3">
                              <p className="font-bold text-slate-900">{student.name}</p>
                              <p className="font-mono text-[11px] text-slate-500">{student.enrollmentNo}</p>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{student.classCode}</td>
                            <td className="px-4 py-3">
                              <Badge color={getPercentBadgeColor(student.attendancePercentage) as any}>
                                {formatPercent(student.attendancePercentage)}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-center font-mono font-bold text-slate-800">
                              {student.attendedClasses} / {student.totalClasses}
                            </td>
                            <td className="px-4 py-3 text-center font-mono text-rose-600 font-bold">
                              {student.missedClasses}
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
  );
});

FacultyAnalyticsModal.displayName = "FacultyAnalyticsModal";
export default FacultyAnalyticsModal;
