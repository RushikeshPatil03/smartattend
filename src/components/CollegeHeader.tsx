import React from "react";
import ProfileMenu from "./ProfileMenu";

const CollegeHeader: React.FC<{
  collegeName?: string | null;
  profilePhotoUrl?: string | null;
  profileMenuPhotoUrl?: string | null;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  className?: string;
  user?: any;
  roleLabel: string;
  onLogout: () => void | Promise<void>;
  children?: React.ReactNode;
}> = ({
  collegeName,
  profilePhotoUrl,
  profileMenuPhotoUrl,
  title,
  subtitle,
  eyebrow = "Institution",
  className = "",
  user,
  roleLabel,
  onLogout,
  children,
}) => {
  const displayCollege = String(collegeName || "Smart Attendance System").trim() || "Smart Attendance System";
  const normalizedRole = String(roleLabel).toUpperCase();
  const showMiniCollegeLogo = normalizedRole === "ADMIN" || normalizedRole === "FACULTY" || normalizedRole === "STUDENT";
  const focusCollegeBrand = normalizedRole === "ADMIN" || normalizedRole === "FACULTY" || normalizedRole === "STUDENT";
  const portalStyles: Record<string, string> = {
    ADMIN: "border-rose-100 bg-rose-50 text-rose-700",
    FACULTY: "border-indigo-100 bg-indigo-50 text-indigo-700",
    STUDENT: "border-emerald-100 bg-emerald-50 text-emerald-700",
  };

  return (
    <div className={`relative z-30 w-full max-w-full rounded-[20px] border border-white/70 bg-white/90 px-4 ${focusCollegeBrand ? "py-3" : "py-2"} shadow-[0_8px_30px_-20px_rgba(15,23,42,0.15)] backdrop-blur-xl sm:px-5 mb-0 ${className}`}>
      <div className="flex items-center justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          {!focusCollegeBrand ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700">{eyebrow}</p>
          ) : null}
          <div className={`${focusCollegeBrand ? "" : "mt-1"} flex min-w-0 items-center gap-3 sm:gap-4`}>
            {showMiniCollegeLogo ? (
              <div className={`${focusCollegeBrand ? "h-14 w-14 rounded-[18px] shadow-[0_14px_34px_-24px_rgba(15,23,42,0.8)] ring-2 ring-white sm:h-[72px] sm:w-[72px] sm:rounded-[22px]" : "h-11 w-11 rounded-2xl"} flex shrink-0 overflow-hidden border border-slate-200 bg-slate-100`}>
                {profilePhotoUrl ? (
                  <img
                    src={profilePhotoUrl}
                    alt={`${displayCollege} logo`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-sky-600 via-cyan-500 to-teal-400 text-white">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 17.5h.01" />
                      <path d="M9.2 14.7a4 4 0 0 1 5.6 0" />
                      <path d="M6.3 11.8a8 8 0 0 1 11.4 0" />
                    </svg>
                  </div>
                )}
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <h2 className={`min-w-0 max-w-full font-semibold leading-tight tracking-tight text-slate-950 [overflow-wrap:anywhere] ${focusCollegeBrand ? "text-xl sm:text-2xl md:text-3xl" : "truncate text-lg sm:text-xl"}`}>{displayCollege}</h2>
              {focusCollegeBrand ? (
                <p className={`mt-1 inline-flex rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] shadow-sm ${portalStyles[normalizedRole] || "border-sky-100 bg-sky-50 text-sky-700"}`}>
                  {normalizedRole === "ADMIN" ? "Admin Portal" : normalizedRole === "FACULTY" ? "Faculty Portal" : "Student Portal"}
                </p>
              ) : null}
            </div>
          </div>
          {!focusCollegeBrand ? (
            <>
              <p className="truncate text-sm font-medium text-slate-600">{title}</p>
              {subtitle ? <p className="hidden truncate text-xs text-slate-500 sm:block">{subtitle}</p> : null}
            </>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {children}
          <div className="flex items-center">
            <ProfileMenu
              user={user}
              roleLabel={roleLabel}
              onLogout={onLogout}
              photoUrl={focusCollegeBrand ? profileMenuPhotoUrl : profileMenuPhotoUrl ?? profilePhotoUrl}
              variant={focusCollegeBrand ? "avatar" : "default"}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CollegeHeader;
