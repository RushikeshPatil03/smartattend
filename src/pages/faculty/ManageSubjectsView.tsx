import React from "react";
import { BarChart3, BookOpen, Building2, Sparkles } from "lucide-react";
import { Button } from "../../components/Common";

interface ManageSubjectsViewProps {
  mySubjects: any[];
  onOpenSubjectAnalytics: (subject: any) => Promise<void>;
}

export const ManageSubjectsView: React.FC<ManageSubjectsViewProps> = React.memo(({
  mySubjects,
  onOpenSubjectAnalytics,
}) => {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100 mb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <BookOpen size={20} className="text-emerald-600" />
              Allotted Academic Subjects
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Curriculum catalog allocated to your faculty credentials by college administration
            </p>
          </div>
        </div>

        {mySubjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50/50 py-16 text-center">
            <BookOpen size={36} className="text-slate-300 mb-2" />
            <p className="font-bold text-sm text-slate-700">No subjects currently allotted</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Contact your department administrator to assign course codes to your account.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {mySubjects.map((sub: any) => {
              const depts =
                Array.isArray(sub.departments) && sub.departments.length
                  ? sub.departments.map((d: any) => d.name).join(", ")
                  : sub.departmentName || "General Department";

              return (
                <div
                  key={sub._id || sub.id}
                  className="group relative flex flex-col justify-between rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm hover:shadow-md hover:border-emerald-400/80 transition duration-200"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="inline-block rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-[11px] font-bold text-emerald-800">
                          {sub.code}
                        </span>
                        <h3 className="mt-3 font-bold text-lg text-slate-900 leading-snug group-hover:text-emerald-700 transition">
                          {sub.name}
                        </h3>
                      </div>

                      <button
                        type="button"
                        onClick={() => onOpenSubjectAnalytics(sub)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:border-emerald-400 hover:bg-emerald-50/50 shadow-sm transition shrink-0 cursor-pointer"
                      >
                        <BarChart3 size={14} className="text-emerald-600" />
                        <span>Insights</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Building2 size={13} className="text-slate-400" />
                      Department
                    </span>
                    <span className="font-semibold text-slate-800 text-right truncate max-w-[160px]">
                      {depts}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

ManageSubjectsView.displayName = "ManageSubjectsView";
export default ManageSubjectsView;
