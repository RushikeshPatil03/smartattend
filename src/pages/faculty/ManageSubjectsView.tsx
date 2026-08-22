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
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white/80 p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100 mb-6">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700 shadow-xs mb-2">
              <Sparkles size={12} className="text-emerald-600" />
              Faculty Course Catalog
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <BookOpen size={22} className="text-emerald-600" />
              Allotted Academic Subjects
            </h2>
            <p className="text-xs text-slate-500 font-normal mt-0.5">
              Curriculum catalog allocated to your faculty credentials by college administration.
            </p>
          </div>
        </div>

        {mySubjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[32px] border border-dashed border-slate-200/80 bg-white/70 py-16 text-center shadow-xs">
            <BookOpen size={36} className="text-slate-300 mb-2" />
            <p className="font-extrabold text-sm text-slate-800">No subjects currently allotted</p>
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
                  className="group relative flex flex-col justify-between rounded-[28px] border border-slate-200/80 bg-white/90 p-6 shadow-xs hover:shadow-md hover:border-emerald-400/80 transition-all duration-200 backdrop-blur-md"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="inline-block rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1 font-mono text-[11px] font-extrabold text-emerald-800 shadow-2xs">
                          {sub.code}
                        </span>
                        <h3 className="mt-3.5 font-extrabold text-lg text-slate-900 leading-snug group-hover:text-emerald-700 transition">
                          {sub.name}
                        </h3>
                      </div>

                      <button
                        type="button"
                        onClick={() => onOpenSubjectAnalytics(sub)}
                        className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:border-emerald-400 hover:bg-emerald-50/50 shadow-xs transition shrink-0 cursor-pointer"
                      >
                        <BarChart3 size={14} className="text-emerald-600" />
                        <span>Insights</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <span className="flex items-center gap-1 font-medium">
                      <Building2 size={13} className="text-slate-400" />
                      Department
                    </span>
                    <span className="font-bold text-slate-800 text-right truncate max-w-[160px]">
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
