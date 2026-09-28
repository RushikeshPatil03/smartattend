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

const Container = ({ children, isAuthOrMobile }: { children: React.ReactNode; isAuthOrMobile: boolean }) => {
  const { currentUser } = useApp();
  const role = (currentUser?.role?.toLowerCase() || "default") as "admin" | "faculty" | "student" | "default";
  if (isAuthOrMobile) {
    return <div className="min-h-screen w-full flex flex-col">{children}</div>;
  }
  return (
    <DashboardBackground role={role} className="flex flex-col page-enter">
      {children}
    </DashboardBackground>
  );
};

const PageLoader = () => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 bg-[#070b14] text-slate-100">
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-cyan-400 p-[1.5px] shadow-[0_12px_30px_-8px_rgba(59,130,246,0.8)]">
        <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-slate-950/95 p-1 backdrop-blur overflow-hidden">
          <img src="/icon-192.png?v=5" alt="SmartAttend Logo" className="h-full w-full object-contain" />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <span className="text-xl font-black tracking-tight font-display text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-cyan-300 to-teal-300">
          SmartAttend
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <svg
          className="h-4 w-4 animate-spin text-blue-400"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-80" fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>Loading workspace...</span>
      </div>
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
    <Container isAuthOrMobile={isAuthOrMobile}>
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

