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
      className={`relative min-h-screen w-full bg-[#f8fafc] ${className}`}
      style={{
        backgroundImage: `
          radial-gradient(ellipse 70% 55% at 10% 10%, rgba(56, 189, 248, 0.18), transparent 60%),
          radial-gradient(ellipse 70% 55% at 90% 90%, rgba(99, 102, 241, 0.16), transparent 60%),
          radial-gradient(ellipse 50% 40% at 50% 40%, rgba(20, 184, 166, 0.10), transparent 60%)
        `,
      }}
    >
      {/* High-Contrast Technical Dot Grid Matrix */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-40"
        style={{
          backgroundImage: "radial-gradient(rgba(15, 23, 42, 0.28) 1.25px, transparent 1.25px)",
          backgroundSize: "24px 24px",
        }}
        aria-hidden="true"
      />

      {/* Floating Ambient Mesh Lighting Orbs */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-24 -left-16 h-[580px] w-[580px] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.22)_0%,rgba(37,99,235,0.12)_45%,transparent_70%)] blur-3xl will-change-transform" />
        <div className="absolute top-1/3 -right-24 h-[620px] w-[620px] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.20)_0%,rgba(168,85,247,0.10)_45%,transparent_70%)] blur-3xl will-change-transform" />
        <div className="absolute -bottom-24 left-1/4 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(20,184,166,0.16)_0%,rgba(6,182,212,0.08)_45%,transparent_70%)] blur-3xl will-change-transform" />
      </div>

      {children && <div className="relative z-10">{children}</div>}
    </div>
  );
};

export default DashboardBackground;
