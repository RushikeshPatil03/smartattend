// src/App.tsx
import React, { Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import HeaderBar from "./components/HeaderBar";
import ProtectedRoute from "./routes/ProtectedRoute";
import { useApp } from "./store";
import { initDeviceFingerprint, requestPersistentStorage } from "./services/attendanceClient";
import { DashboardBackground } from "./components/DashboardBackground";

// Helper to handle stale client cache / dynamic chunk loading retries
function lazyWithRetry<T extends React.ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>
) {
  return React.lazy(async () => {
    try {
      return await componentImport();
    } catch (error) {
      const reloadKey = "smartattend_chunk_autoreload_ts";
      const lastReload = Number(window.sessionStorage.getItem(reloadKey) || 0);
      const now = Date.now();

      // If a chunk fails due to a new deployment, purge stale caches and reload once safely
      if (now - lastReload > 15000) {
        window.sessionStorage.setItem(reloadKey, String(now));
        if ("caches" in window) {
          try {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          } catch {}
        }
        if ("serviceWorker" in navigator) {
          try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((r) => r.update()));
          } catch {}
        }
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
}

// Route-level code-split chunks
const importLogin = () => import("./pages/Login");
const importRegister = () => import("./pages/Register");
const importAdminRegister = () => import("./pages/AdminRegister");
const importAdminDashboard = () => import("./pages/AdminDashboard");
const importFacultyDashboard = () => import("./pages/FacultyDashboard");
const importStudentDashboard = () => import("./pages/StudentDashboard");
const importMobileLocationCapture = () => import("./pages/MobileLocationCapture");

const Login = lazyWithRetry(importLogin);
const Register = lazyWithRetry(importRegister);
const AdminRegister = lazyWithRetry(importAdminRegister);
const AdminDashboard = lazyWithRetry(importAdminDashboard);
const FacultyDashboard = lazyWithRetry(importFacultyDashboard);
const StudentDashboard = lazyWithRetry(importStudentDashboard);
const MobileLocationCapture = lazyWithRetry(importMobileLocationCapture);

// Role-specific idle prefetch triggers
export const preloadRoute = (role?: string) => {
  const normalized = String(role || "").toUpperCase();
  if (normalized === "STUDENT") {
    void importStudentDashboard();
  } else if (normalized === "FACULTY") {
    void importFacultyDashboard();
  } else if (normalized === "ADMIN") {
    void importAdminDashboard();
  }
};

const RootRedirect = () => {
  const { currentUser } = useApp();
  const role = String(currentUser?.role || "").toUpperCase();
  if (role === "STUDENT") return <Navigate to="/student" replace />;
  if (role === "FACULTY") return <Navigate to="/faculty" replace />;
  if (role === "ADMIN") return <Navigate to="/admin" replace />;
  return <Navigate to="/login" replace />;
};

const Container = ({ children }: { children: React.ReactNode }) => {
  const { currentUser } = useApp();
  const role = (currentUser?.role?.toLowerCase() || "default") as "admin" | "faculty" | "student" | "default";
  return (
    <DashboardBackground role={role} className="flex flex-col page-enter">
      {children}
    </DashboardBackground>
  );
};

const PageLoader = () => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-4">
    <div className="flex flex-col items-center gap-3 text-center">
      {/* Brand ring with spinner */}
      <div className="relative flex h-16 w-16 items-center justify-center">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 opacity-10 blur-xl" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-md">
          <svg
            className="h-8 w-8 animate-spin text-blue-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-80" fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      </div>
      <p className="text-sm font-semibold text-slate-600 tracking-wide">
        SmartAttend
      </p>
      <p className="text-xs text-slate-400">Loading your workspace…</p>
    </div>

    {/* Skeleton preview consistent with Card component */}
    <div className="w-full max-w-md animate-pulse space-y-3 rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-slate-200/80" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-36 rounded-md bg-slate-200/80" />
          <div className="h-2.5 w-24 rounded-md bg-slate-100" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 pt-1">
        <div className="h-16 rounded-xl bg-slate-100/90" />
        <div className="h-16 rounded-xl bg-slate-100/90" />
        <div className="h-16 rounded-xl bg-slate-100/90" />
      </div>
      <div className="h-24 rounded-xl bg-slate-100/70" />
    </div>
  </div>
);

const App = () => {
  const location = useLocation();
  const { currentUser } = useApp();

  // Initialize privacy-safe IndexedDB device fingerprint on app startup
  useEffect(() => {
    void initDeviceFingerprint();
  }, []);

  // Request durable persistent storage whenever a session is active
  useEffect(() => {
    if (currentUser) {
      void requestPersistentStorage();
    }
  }, [currentUser]);

  // Smart idle prefetch for current user role
  useEffect(() => {
    if (!currentUser?.role) return;
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const handle = (window as any).requestIdleCallback(() => {
        preloadRoute(currentUser.role);
      });
      return () => (window as any).cancelIdleCallback(handle);
    } else {
      const timer = setTimeout(() => {
        preloadRoute(currentUser.role);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [currentUser?.role]);

  const isAuthOrMobile =
    location.pathname === "/login" ||
    location.pathname === "/" ||
    location.pathname === "/admin/register" ||
    location.pathname === "/register" ||
    location.pathname === "/mobile-location";

  return (
    <Container>
      {!isAuthOrMobile ? <HeaderBar /> : null}
      <div className="flex-1">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/admin/register" element={<AdminRegister />} />
            <Route path="/mobile-location" element={<MobileLocationCapture />} />

            <Route element={<ProtectedRoute roles={["ADMIN"]} />}>
              <Route path="/admin" element={<AdminDashboard />} />
            </Route>
            <Route element={<ProtectedRoute roles={["FACULTY"]} />}>
              <Route path="/faculty" element={<FacultyDashboard />} />
            </Route>
            <Route element={<ProtectedRoute roles={["STUDENT"]} />}>
              <Route path="/student" element={<StudentDashboard />} />
            </Route>

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </div>
    </Container>
  );
};

export default App;

