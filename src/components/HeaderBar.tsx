import React from "react";
import AppLogo from "./AppLogo";

export default function HeaderBar() {
  return (
    <div
      style={{
        position: "static",
        width: "auto",
        boxSizing: "border-box",
        background: "transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          minHeight: "52px",
          width: "fit-content",
          maxWidth: "100%",
          padding: "10px 14px",
          borderRadius: "22px",
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          border: "1px solid rgba(148,163,184,0.22)",
          boxShadow: "0 20px 40px -26px rgba(15,23,42,0.24)",
        }}
      >
        <AppLogo size={36} />
      </div>
    </div>
  );
}
