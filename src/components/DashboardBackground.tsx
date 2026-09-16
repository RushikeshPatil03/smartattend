import React from "react";

export interface DashboardBackgroundProps {
  children?: React.ReactNode;
  className?: string;
  role?: "admin" | "faculty" | "student" | "default";
  selectionColor?: string; // Tailwind class e.g. "selection:bg-indigo-500"
}

const roleOrbs: Record<string, { top: string; right: string; bottom: string }> = {
  admin:   { top: "rgba(56,189,248,0.22)",  right: "rgba(99,102,241,0.20)",  bottom: "rgba(20,184,166,0.16)" },
  faculty: { top: "rgba(56,189,248,0.20)",  right: "rgba(99,102,241,0.18)",  bottom: "rgba(16,185,129,0.14)" },
  student: { top: "rgba(56,189,248,0.18)",  right: "rgba(99,102,241,0.16)",  bottom: "rgba(20,184,166,0.12)" },
  default: { top: "rgba(56,189,248,0.18)",  right: "rgba(99,102,241,0.16)",  bottom: "rgba(20,184,166,0.10)" },
};

export const DashboardBackground: React.FC<DashboardBackgroundProps> = ({
  children,
  className = "",
  role = "default",
  selectionColor = "selection:bg-indigo-500 selection:text-white",
}) => {
  const orbs = roleOrbs[role] || roleOrbs.default;

  return (
    <div
      className={`relative min-h-screen w-full bg-[#f8fafc] ${selectionColor} ${className}`}
      style={{
        backgroundImage: `
          radial-gradient(ellipse 70% 55% at 10% 10%, ${orbs.top}, transparent 60%),
          radial-gradient(ellipse 70% 55% at 90% 90%, ${orbs.right}, transparent 60%),
          radial-gradient(ellipse 50% 40% at 50% 40%, ${orbs.bottom}, transparent 60%)
        `,
      }}
    >
      {/* High-Contrast Technical Dot Grid Matrix */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.28] sm:opacity-40"
        style={{
          backgroundImage: "radial-gradient(rgba(15, 23, 42, 0.28) 1.25px, transparent 1.25px)",
          backgroundSize: "24px 24px",
        }}
        aria-hidden="true"
      />

      {/* Floating Ambient Mesh Lighting Orbs */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute -top-24 -left-16 h-[580px] w-[580px] rounded-full blur-3xl will-change-transform"
          style={{
            background: `radial-gradient(circle, ${orbs.top} 0%, rgba(37,99,235,0.12) 45%, transparent 70%)`,
          }}
        />
        <div
          className="absolute top-1/3 -right-24 h-[620px] w-[620px] rounded-full blur-3xl will-change-transform"
          style={{
            background: `radial-gradient(circle, ${orbs.right} 0%, rgba(168,85,247,0.10) 45%, transparent 70%)`,
          }}
        />
        <div
          className="absolute -bottom-24 left-1/4 h-[520px] w-[520px] rounded-full blur-3xl will-change-transform"
          style={{
            background: `radial-gradient(circle, ${orbs.bottom} 0%, rgba(6,182,212,0.08) 45%, transparent 70%)`,
          }}
        />
      </div>

      {children && <div className="relative z-10 flex-1 flex flex-col">{children}</div>}
    </div>
  );
};

export default DashboardBackground;
