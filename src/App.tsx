// src/App.tsx
import React, { Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import HeaderBar from "./components/HeaderBar";
import ProtectedRoute from "./routes/ProtectedRoute";

const Login = React.lazy(() => import("./pages/Login"));
const Register = React.lazy(() => import("./pages/Register"));
const AdminRegister = React.lazy(() => import("./pages/AdminRegister"));
const AdminDashboard = React.lazy(() => import("./pages/AdminDashboard"));
const FacultyDashboard = React.lazy(() => import("./pages/FacultyDashboard"));
const StudentDashboard = React.lazy(() => import("./pages/StudentDashboard"));
const MobileLocationCapture = React.lazy(() => import("./pages/MobileLocationCapture"));

const Container = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen page-enter flex flex-col bg-[linear-gradient(180deg,_#f8fbff_0%,_#eef6ff_42%,_#f8fafc_100%)]">
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
  const isMobileLocationPage = location.pathname === "/mobile-location";

  return (
    <Container>
      {!isMobileLocationPage ? <HeaderBar /> : null}
      <div className="flex-1">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
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
