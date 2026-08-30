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
  <div className="min-h-screen page-enter flex flex-col bg-[radial-gradient(ellipse_at_20%_10%,rgba(56,189,248,0.06),transparent_55%),radial-gradient(ellipse_at_80%_90%,rgba(99,102,241,0.06),transparent_55%),#f8fafc]">
    {children}
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
