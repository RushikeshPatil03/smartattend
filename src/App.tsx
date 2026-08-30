// src/App.tsx
import React, { Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import HeaderBar from "./components/HeaderBar";
import ProtectedRoute from "./routes/ProtectedRoute";
import { useApp } from "./store";

// Helper to handle stale client cache / dynamic chunk loading retries
function lazyWithRetry<T extends React.ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>
) {
  return React.lazy(async () => {
    const isRefreshed = JSON.parse(
      window.sessionStorage.getItem("retry-chunk-refreshed") || "false"
    );
    try {
      const component = await componentImport();
      window.sessionStorage.setItem("retry-chunk-refreshed", "false");
      return component;
    } catch (error) {
      if (!isRefreshed) {
        window.sessionStorage.setItem("retry-chunk-refreshed", "true");
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
}

const Login = lazyWithRetry(() => import("./pages/Login"));
const Register = lazyWithRetry(() => import("./pages/Register"));
const AdminRegister = lazyWithRetry(() => import("./pages/AdminRegister"));
const AdminDashboard = lazyWithRetry(() => import("./pages/AdminDashboard"));
const FacultyDashboard = lazyWithRetry(() => import("./pages/FacultyDashboard"));
const StudentDashboard = lazyWithRetry(() => import("./pages/StudentDashboard"));
const MobileLocationCapture = lazyWithRetry(() => import("./pages/MobileLocationCapture"));

const RootRedirect = () => {
  const { currentUser } = useApp();
  const role = String(currentUser?.role || "").toUpperCase();
  if (role === "STUDENT") return <Navigate to="/student" replace />;
  if (role === "FACULTY") return <Navigate to="/faculty" replace />;
  if (role === "ADMIN") return <Navigate to="/admin" replace />;
  return <Navigate to="/login" replace />;
};

const Container = ({ children }: { children: React.ReactNode }) => (
  <div
    className="relative min-h-screen page-enter flex flex-col bg-[#f8fafc]"
    style={{
      backgroundImage: `
        radial-gradient(ellipse 70% 55% at 10% 10%, rgba(56, 189, 248, 0.18), transparent 60%),
        radial-gradient(ellipse 70% 55% at 90% 90%, rgba(99, 102, 241, 0.16), transparent 60%),
        radial-gradient(ellipse 50% 40% at 50% 40%, rgba(20, 184, 166, 0.10), transparent 60%)
      `,
    }}
  >
    {/* Global High-Contrast Dot Grid Matrix */}
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

    <div className="relative z-10 flex-1 flex flex-col">{children}</div>
  </div>
);

const PageLoader = () => (
  <div className="mx-auto mt-20 max-w-sm rounded-2xl border border-slate-200 bg-white/85 p-5 text-center text-sm font-medium text-slate-600 shadow-sm">
    Loading page...
  </div>
);

const App = () => {
  const location = useLocation();
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
