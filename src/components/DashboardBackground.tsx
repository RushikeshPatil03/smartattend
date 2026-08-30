import React from "react";

export interface DashboardBackgroundProps {
  children?: React.ReactNode;
  className?: string;
}

export const DashboardBackground: React.FC<DashboardBackgroundProps> = ({
  children,
  className = "",
}) => {
  return (
    <div
      className={`relative min-h-screen w-full bg-[radial-gradient(ellipse_at_20%_10%,rgba(56,189,248,0.06),transparent_55%),radial-gradient(ellipse_at_80%_90%,rgba(99,102,241,0.06),transparent_55%),#f8fafc] ${className}`}
    >
      {/* Subtle Geometric Dot Matrix Grid (Matches Login / SaaS Premium aesthetic) */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.04]"
        style={{
          backgroundImage: "radial-gradient(#0f172a 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
        aria-hidden="true"
      />

      {/* Ambient Radial Mesh Lighting Orbs */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-32 -left-20 h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.08)_0%,transparent_70%)] blur-3xl will-change-transform" />
        <div className="absolute top-1/2 -right-32 h-[650px] w-[650px] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.07)_0%,transparent_70%)] blur-3xl will-change-transform" />
        <div className="absolute -bottom-32 left-1/3 h-[550px] w-[550px] rounded-full bg-[radial-gradient(circle,rgba(6,182,212,0.05)_0%,transparent_70%)] blur-3xl will-change-transform" />
      </div>

      {children && <div className="relative z-10">{children}</div>}
    </div>
  );
};

export default DashboardBackground;
