import React from "react";

export default function AppLogo({ size = 48 }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "10px",
        lineHeight: 1,
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          background:
            "linear-gradient(135deg, rgba(37,99,235,0.96) 0%, rgba(59,130,246,0.94) 56%, rgba(6,182,212,0.9) 100%)",
          borderRadius: "14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 16px 32px -20px rgba(37, 99, 235, 0.62)",
          border: "1px solid rgba(255,255,255,0.16)",
        }}
      >
        <svg
          width={size * 0.55}
          height={size * 0.55}
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* WiFi arcs */}
          <path d="M12 17.5h.01" />
          <path d="M9.2 14.7a4 4 0 0 1 5.6 0" />
          <path d="M6.3 11.8a8 8 0 0 1 11.4 0" />
          <path d="M3.4 8.9a12 12 0 0 1 17.2 0" />
        </svg>
      </div>

      {/* Text */}
      <div>
        <div
          style={{
            fontSize: "19px",
            fontWeight: 800,
            background: "linear-gradient(135deg, #2563eb 0%, #0284c7 50%, #06b6d4 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            fontFamily: "Inter, sans-serif",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          SmartAttend
        </div>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "#64748B",
            marginTop: "3px",
            fontFamily: "Inter, sans-serif",
            lineHeight: 1,
            letterSpacing: "0.04em",
          }}
        >
          QR & GPS Secured
        </div>
      </div>
    </div>
  );
}
