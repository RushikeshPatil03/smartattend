import React, { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useApp } from "../store";

export default function ProtectedRoute({ roles }: { roles: string[] }) {
  const location = useLocation();
  const { currentUser, restoreSession } = useApp();
  const [checking, setChecking] = useState(!currentUser);

  useEffect(() => {
    let cancelled = false;
    if (currentUser) {
      setChecking(false);
      return;
    }

    setChecking(true);
    restoreSession().finally(() => {
      if (!cancelled) setChecking(false);
    });

    return () => {
      cancelled = true;
    };
  }, [currentUser, restoreSession]);

  if (checking) {
    return (
      <div className="mx-auto mt-20 max-w-sm rounded-2xl border border-slate-200 bg-white/85 p-5 text-center text-sm font-medium text-slate-600 shadow-sm">
        Restoring session...
      </div>
    );
  }

  const role = String(currentUser?.role || "").toUpperCase();
  if (!currentUser || !roles.includes(role)) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
