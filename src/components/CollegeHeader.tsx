import React from "react";
import ProfileMenu from "./ProfileMenu";

export interface CollegeHeaderProps {
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
  isLive?: boolean;
  liveSessionActive?: boolean;
  children?: React.ReactNode;
}

const CollegeHeader: React.FC<CollegeHeaderProps> = ({
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
  isLive = false,
  liveSessionActive = false,
  children,
}) => {
  const displayCollege =
    String(collegeName || "Smart Attendance System").trim() ||
    "Smart Attendance System";
  const normalizedRole = String(roleLabel).toUpperCase();
  const showMiniCollegeLogo =
    normalizedRole === "ADMIN" ||
    normalizedRole === "FACULTY" ||
    normalizedRole === "STUDENT";
  const focusCollegeBrand =
    normalizedRole === "ADMIN" ||
    normalizedRole === "FACULTY" ||
    normalizedRole === "STUDENT";

  const isSessionLive = isLive || liveSessionActive;

  const portalStyles: Record<string, string> = {
    ADMIN: "border-rose-200/80 bg-rose-50/80 text-rose-700",
    FACULTY: "border-indigo-200/80 bg-indigo-50/80 text-indigo-700",
    STUDENT: "border-emerald-200/80 bg-emerald-50/80 text-emerald-700",
  };

  return (
    <header
      className={`relative z-30 w-full max-w-full rounded-[22px] border border-white/50 bg-white/70 px-4 ${
        focusCollegeBrand ? "py-3" : "py-2"
      } shadow-[0_8px_32px_-8px_rgba(15,23,42,0.10)] backdrop-blur-2xl sm:px-5 mb-0 transition-all duration-200 ${className}`}
    >
      <div className="flex items-center justify-between gap-3 sm:gap-4">
        {/* Left: Brand / College Identity */}
        <div className="min-w-0 flex-1">
          {!focusCollegeBrand ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700">
              {eyebrow}
            </p>
          ) : null}
          <div
            className={`${
              focusCollegeBrand ? "" : "mt-1"
            } flex min-w-0 items-center gap-3 sm:gap-4`}
          >
            {showMiniCollegeLogo ? (
              <div
                className={`${
                  focusCollegeBrand
                    ? "h-14 w-14 rounded-[18px] shadow-[0_14px_34px_-24px_rgba(15,23,42,0.8)] ring-2 ring-white/90 sm:h-[70px] sm:w-[70px] sm:rounded-[22px]"
                    : "h-11 w-11 rounded-2xl"
                } flex shrink-0 overflow-hidden border border-slate-200/80 bg-slate-100/80 backdrop-blur`}
              >
                {profilePhotoUrl ? (
                  <img
                    src={profilePhotoUrl}
                    alt={`${displayCollege} logo`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-sky-600 via-cyan-500 to-teal-400 text-white">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-6 w-6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 17.5h.01" />
                      <path d="M9.2 14.7a4 4 0 0 1 5.6 0" />
                      <path d="M6.3 11.8a8 8 0 0 1 11.4 0" />
                    </svg>
                  </div>
                )}
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  className={`min-w-0 max-w-full font-bold leading-tight tracking-tight text-slate-950 [overflow-wrap:anywhere] ${
                    focusCollegeBrand
                      ? "text-xl sm:text-2xl md:text-3xl"
                      : "truncate text-lg sm:text-xl"
                  }`}
                >
                  {displayCollege}
                </h2>

                {/* Faculty Live Active Session Pill */}
                {isSessionLive && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 shadow-[0_0_12px_rgba(16,185,129,0.25)] animate-pulse">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 duration-1000" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    <span className="tracking-wide uppercase font-extrabold">Live</span>
                  </span>
                )}
              </div>

              {focusCollegeBrand ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded-full border px-3 py-0.5 text-[11px] font-bold uppercase tracking-[0.16em] shadow-xs ${
                      portalStyles[normalizedRole] ||
                      "border-sky-100 bg-sky-50 text-sky-700"
                    }`}
                  >
                    {normalizedRole === "ADMIN"
                      ? "Admin Portal"
                      : normalizedRole === "FACULTY"
                      ? "Faculty Portal"
                      : "Student Portal"}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          {!focusCollegeBrand ? (
            <>
              <p className="truncate text-sm font-medium text-slate-600">{title}</p>
              {subtitle ? (
                <p className="hidden truncate text-xs text-slate-500 sm:block">
                  {subtitle}
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        {/* Right: Actions, Widgets & Profile */}
        <div className="flex shrink-0 items-center gap-2.5 sm:gap-3.5">
          {children}

          <div className="flex items-center">
            <ProfileMenu
              user={user}
              roleLabel={roleLabel}
              onLogout={onLogout}
              photoUrl={
                focusCollegeBrand
                  ? profileMenuPhotoUrl
                  : profileMenuPhotoUrl ?? profilePhotoUrl
              }
              variant={focusCollegeBrand ? "avatar" : "default"}
            />
          </div>
        </div>
      </div>
    </header>
  );
};

export default CollegeHeader;
