// src/pages/Register.tsx
import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GraduationCap,
  Briefcase,
  Shield,
  Building2,
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  QrCode,
  Sparkles,
  ShieldCheck,
  Link2,
  KeyRound,
  Fingerprint,
} from "lucide-react";
import { useApp, View } from "../store";
import {
  getFingerprint,
  initDeviceFingerprint,
  requestPersistentStorage,
} from "../services/attendanceClient";
import apiClient from "../services/apiClient";
import { Department } from "../types";
import LivePhotoCapture, { prewarmFrontCamera } from "../components/LivePhotoCapture";
import { buildFaceSignatures } from "../utils/faceSignature";

type RoleType = "admin" | "student" | "faculty" | null;

type RegistrationMeta = {
  collegeName?: string;
  expiresAt?: string;
  maxRegistrations?: number;
  usedRegistrations?: number;
  remainingRegistrations?: number;
};

// --- Floating Label Input Component ---
interface FloatingInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  isPassword?: boolean;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  accentColor?: string;
}

const FloatingInput: React.FC<FloatingInputProps> = React.memo(({
  label,
  icon: Icon,
  isPassword = false,
  value,
  onChange,
  accentColor = "#3b82f6",
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isFloating = isFocused || (value && value.length > 0);

  return (
    <div className="relative w-full group">
      <div
        className={`relative flex items-center w-full rounded-2xl border transition-all duration-300 bg-white/80 backdrop-blur-md ${
          isFocused
            ? "border-blue-500/90 bg-white ring-4 ring-blue-500/10 shadow-[0_8px_24px_-8px_rgba(59,130,246,0.25)]"
            : "border-slate-200/90 hover:border-slate-300/90 hover:bg-white/95"
        }`}
      >
        {/* Leading Icon */}
        <div
          className={`pl-4 pr-2 flex items-center transition-colors duration-200 ${
            isFocused ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600"
          }`}
        >
          <Icon size={19} />
        </div>

        {/* Input & Floating Label */}
        <div className="relative flex-1 py-3.5 pr-3">
          <input
            {...props}
            type={isPassword ? (showPassword ? "text" : "password") : props.type}
            value={value}
            onChange={onChange}
            onFocus={(e) => {
              setIsFocused(true);
              props.onFocus?.(e);
            }}
            onBlur={(e) => {
              setIsFocused(false);
              props.onBlur?.(e);
            }}
            className="w-full bg-transparent text-slate-900 text-sm font-medium focus:outline-none placeholder-transparent pt-3 pb-0"
            placeholder={label}
            id={props.id || label.toLowerCase().replace(/\s+/g, "-")}
          />
          <label
            htmlFor={props.id || label.toLowerCase().replace(/\s+/g, "-")}
            className={`absolute left-0 pointer-events-none transition-all duration-200 select-none ${
              isFloating
                ? "top-1.5 text-[11px] font-semibold tracking-wider uppercase text-blue-600"
                : "top-3.5 text-sm font-normal text-slate-500"
            }`}
          >
            {label}
          </label>
        </div>

        {/* Trailing Password Toggle */}
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="pr-4 pl-2 text-slate-400 hover:text-slate-700 transition-colors focus:outline-none cursor-pointer"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
    </div>
  );
});

const Register: React.FC = () => {
  const { navigateTo } = useApp();

  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token")?.trim() || "";
  const urlRole = params.get("role")?.trim().toLowerCase() || "";

  const [departments, setDepartments] = useState<Department[]>([]);
  const [roleType, setRoleType] = useState<RoleType>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [collegeName, setCollegeName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enrollmentNo, setEnrollmentNo] = useState("");
  const [year, setYear] = useState<number | "">("");
  const [semester, setSemester] = useState<number | "">("");
  const [section, setSection] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState("");

  const [linkError, setLinkError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [registrationMeta, setRegistrationMeta] = useState<RegistrationMeta | null>(null);

  useEffect(() => {
    // Prewarm front camera in background so student gets instant open
    void prewarmFrontCamera();

    if (urlRole === "admin") {
      setRoleType("admin");
      setLoading(false);
      return;
    }

    if (urlToken && (urlRole === "student" || urlRole === "faculty")) {
      setRoleType(urlRole as RoleType);
      setToken(urlToken);
      void fetchRegistrationContext(urlToken);
      return;
    }

    setLinkError("Invalid or incomplete registration link. Please ask your administrator for a fresh registration link.");
    setLoading(false);
  }, []);

  const fetchRegistrationContext = async (registrationToken: string) => {
    setLoading(true);
    setLinkError(null);
    try {
      const res = await apiClient.get(`/api/public/departments?token=${encodeURIComponent(registrationToken)}`);
      if (!res?.ok) {
        setLinkError(res?.error || "Unable to validate registration link.");
        setDepartments([]);
        return;
      }

      setDepartments(Array.isArray(res.departments) ? res.departments : []);
      setRegistrationMeta(res.registration || null);
      setLinkError(null);
    } catch {
      setLinkError("Unable to load registration link details. The server may be waking up (cold start) or your connection was interrupted.");
      setDepartments([]);
    } finally {
      setLoading(false);
    }
  };

  const roleConfig = useMemo(() => {
    if (roleType === "faculty") {
      return {
        badgeText: "Faculty Setup",
        badgeIcon: Briefcase,
        badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400",
        pingClass: "bg-emerald-400",
        headerBadgeClass: "border-emerald-200 bg-emerald-50/90 text-emerald-700",
        headerBadgeIcon: Briefcase,
        headerBadgeText: "Faculty Onboarding",
        title: "Register Faculty",
        description: registrationMeta?.collegeName
          ? `${registrationMeta.collegeName} • Faculty Portal`
          : "Register your faculty profile to host and manage classroom attendance sessions.",
        buttonGradient: "from-emerald-600 via-teal-600 to-cyan-600",
        buttonText: "Create Faculty Account",
        glowGradient: "rgba(16, 185, 129, 0.35)",
      };
    }
    if (roleType === "admin") {
      return {
        badgeText: "Admin Setup",
        badgeIcon: Shield,
        badgeClass: "border-indigo-500/40 bg-indigo-500/15 text-indigo-400",
        pingClass: "bg-indigo-400",
        headerBadgeClass: "border-indigo-200 bg-indigo-50/90 text-indigo-700",
        headerBadgeIcon: Shield,
        headerBadgeText: "Institution Setup",
        title: "Register Administrator",
        description: "Create your institution’s administrator profile.",
        buttonGradient: "from-indigo-600 via-blue-600 to-violet-600",
        buttonText: "Create Administrator Account",
        glowGradient: "rgba(99, 102, 241, 0.35)",
      };
    }
    return {
      badgeText: "Student Setup",
      badgeIcon: GraduationCap,
      badgeClass: "border-blue-500/40 bg-blue-500/15 text-blue-400",
      pingClass: "bg-blue-400",
      headerBadgeClass: "border-blue-200 bg-blue-50/90 text-blue-700",
      headerBadgeIcon: GraduationCap,
      headerBadgeText: "Student Onboarding",
      title: "Register Student",
      description: registrationMeta?.collegeName
        ? `${registrationMeta.collegeName} • Student Portal`
        : "Join your department with verified device & enrollment credentials.",
      buttonGradient: "from-blue-600 via-indigo-600 to-cyan-500",
      buttonText: "Complete Student Registration",
      glowGradient: "rgba(59, 130, 246, 0.35)",
    };
  }, [roleType, registrationMeta]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);

    try {
      if (roleType === "admin") {
        if (!name.trim() || !email.trim() || !password || !collegeName.trim()) {
          setSubmitError("All administrator fields are required.");
          setSubmitting(false);
          return;
        }

        const res = await apiClient.createAdmin({
          name: name.trim(),
          email: email.trim(),
          password,
          collegeName: collegeName.trim(),
        });

        if (!res?.ok) {
          setSubmitError(res?.error || "Admin registration failed.");
          setSubmitting(false);
          return;
        }
      } else {
        if (!token) {
          setSubmitError("Invalid or missing registration token.");
          setSubmitting(false);
          return;
        }

        await initDeviceFingerprint();
        const fingerprint = getFingerprint();

        if (roleType === "student") {
          if (
            !name.trim() ||
            !email.trim() ||
            !password ||
            !enrollmentNo.trim() ||
            year === "" ||
            semester === "" ||
            !section ||
            !departmentId ||
            !profilePhotoUrl
          ) {
            setSubmitError("All student fields including profile photo are required.");
            setSubmitting(false);
            return;
          }

          const faceSignatures = await buildFaceSignatures(profilePhotoUrl);

          const res = await apiClient.post("/api/student/register", {
            token,
            name: name.trim(),
            email: email.trim(),
            password,
            enrollmentNo: enrollmentNo.trim().toUpperCase(),
            year,
            semester,
            section: section.trim().toUpperCase(),
            departmentId,
            fingerprint,
            profilePhotoUrl,
            faceSignature: faceSignatures.signature,
            faceSignatureMirror: faceSignatures.mirrorSignature,
            faceSignatureVersion: faceSignatures.version,
          });

          if (!res?.ok) {
            setSubmitError(res?.error || "Student registration failed.");
            setSubmitting(false);
            return;
          }
        }

        if (roleType === "faculty") {
          if (!name.trim() || !email.trim() || !password || !departmentId) {
            setSubmitError("All faculty fields are required.");
            setSubmitting(false);
            return;
          }

          const res = await apiClient.post("/api/faculty/register", {
            token,
            name: name.trim(),
            email: email.trim(),
            password,
            departmentId,
            fingerprint,
          });

          if (!res?.ok) {
            setSubmitError(res?.error || "Faculty registration failed.");
            setSubmitting(false);
            return;
          }
        }
      }

      void requestPersistentStorage();
      setSuccess(true);
      setTimeout(() => navigateTo(View.LOGIN), 1600);
    } catch (err: any) {
      setSubmitError(err?.message || "A network error occurred. Please check your connection.");
    } finally {
      setSubmitting(false);
    }
  };

  // --- Loading State (Matches Dark Aesthetic) ---
  if (loading) {
    return (
      <div className="relative min-h-screen w-full overflow-x-hidden bg-[#070b14] text-slate-100 flex flex-col justify-center items-center px-4 selection:bg-blue-500 selection:text-white">
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[650px] h-[650px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.22)_0%,rgba(37,99,235,0.14)_45%,transparent_70%)] blur-3xl will-change-transform" />
        </div>
        <div className="relative z-10 w-full max-w-md overflow-hidden rounded-[32px] border border-white/80 bg-white/95 p-8 shadow-[0_25px_70px_-20px_rgba(0,0,0,0.35)] backdrop-blur-2xl text-slate-800 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-sm">
            <RefreshCw size={24} className="animate-spin" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Validating Link</h2>
          <p className="text-sm text-slate-500">Checking registration access and institution parameters...</p>
        </div>
      </div>
    );
  }

  // --- Link Error State (Matches Dark Aesthetic) ---
  if (linkError) {
    return (
      <div className="relative min-h-screen w-full overflow-x-hidden bg-[#070b14] text-slate-100 flex flex-col justify-between selection:bg-blue-500 selection:text-white">
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[650px] h-[650px] rounded-full bg-[radial-gradient(circle,rgba(239,68,68,0.18)_0%,rgba(99,102,241,0.12)_45%,transparent_70%)] blur-3xl will-change-transform" />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-md px-4 py-8 sm:px-6 flex-1 flex flex-col justify-center items-center">
          <div className="relative w-full">
            <div className="relative overflow-hidden rounded-[32px] border border-white/80 bg-white/95 p-6 sm:p-8 shadow-[0_25px_70px_-20px_rgba(0,0,0,0.35)] backdrop-blur-2xl text-slate-800 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600 shadow-sm">
                <Link2 size={24} />
              </div>
              <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Registration Link Error</h2>
              <p className="mt-2.5 text-sm text-slate-500 font-normal leading-relaxed">{linkError}</p>

              <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col gap-2.5">
                {token ? (
                  <button
                    type="button"
                    onClick={() => fetchRegistrationContext(token)}
                    className="w-full relative overflow-hidden rounded-2xl py-3 px-5 font-bold text-sm text-white shadow-lg transition-all duration-300 flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:shadow-xl hover:brightness-105 active:brightness-95 cursor-pointer"
                  >
                    <RefreshCw size={16} />
                    <span>Retry Connection</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => navigateTo(View.LOGIN)}
                  className="w-full relative overflow-hidden rounded-2xl py-3 px-5 font-bold text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <ArrowLeft size={16} />
                  <span>Back to Login</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <footer className="relative z-10 py-4 text-center text-xs text-slate-500">
          SmartAttend Unified Campus Systems • © {new Date().getFullYear()} All Rights Reserved.
        </footer>
      </div>
    );
  }

  // --- Success State (Matches Dark Aesthetic) ---
  if (success) {
    return (
      <div className="relative min-h-screen w-full overflow-x-hidden bg-[#070b14] text-slate-100 flex flex-col justify-between selection:bg-emerald-500 selection:text-white">
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[650px] h-[650px] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.22)_0%,rgba(59,130,246,0.12)_45%,transparent_70%)] blur-3xl will-change-transform" />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-md px-4 py-8 sm:px-6 flex-1 flex flex-col justify-center items-center">
          <div className="relative w-full">
            <div className="relative overflow-hidden rounded-[32px] border border-white/80 bg-white/95 p-6 sm:p-8 shadow-[0_25px_70px_-20px_rgba(0,0,0,0.35)] backdrop-blur-2xl text-slate-800 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 shadow-sm">
                <ShieldCheck size={28} />
              </div>
              <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Registration Completed</h2>
              <p className="mt-2 text-sm text-slate-600">Your profile has been created and bound to this device.</p>
              <div className="mt-5 flex items-center justify-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50/80 py-2 px-3 rounded-xl border border-emerald-200">
                <RefreshCw size={14} className="animate-spin text-emerald-600" />
                <span>Redirecting to login portal...</span>
              </div>
            </div>
          </div>
        </div>

        <footer className="relative z-10 py-4 text-center text-xs text-slate-500">
          SmartAttend Unified Campus Systems • © {new Date().getFullYear()} All Rights Reserved.
        </footer>
      </div>
    );
  }

  // --- Main Render (Clean Centered Page Identical to AdminRegister) ---
  const HeaderBadgeIcon = roleConfig.headerBadgeIcon;

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[#070b14] text-slate-100 flex flex-col justify-between selection:bg-blue-500 selection:text-white">
      {/* Ambient Gradient Mesh Background (Hardware Accelerated) */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[650px] h-[650px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.22)_0%,rgba(37,99,235,0.14)_45%,transparent_70%)] blur-3xl will-change-transform" />
        <div className="absolute -bottom-40 right-1/4 w-[600px] h-[600px] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.18)_0%,rgba(59,130,246,0.10)_45%,transparent_70%)] blur-3xl will-change-transform" />

        {/* Subtle Geometric Grid Matrix */}
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: `radial-gradient(rgba(255, 255, 255, 0.4) 1px, transparent 1px)`,
            backgroundSize: "28px 28px",
          }}
        />
      </div>

      {/* Main Centered Content Container */}
      <div className="relative z-10 mx-auto w-full max-w-lg px-4 py-8 sm:px-6 flex-1 flex flex-col justify-center items-center">
        
        {/* Dynamic Top Brand Identity & System Header */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center text-center mb-6 space-y-2"
        >
          {/* Logo Pill */}
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-blue-500 to-cyan-400 p-[1.5px] shadow-[0_12px_30px_-8px_rgba(59,130,246,0.8)]">
              <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-slate-950/95 p-1 backdrop-blur overflow-hidden">
                <img src="/icon-192.png?v=5" alt="SmartAttend Logo" className="h-full w-full object-contain" />
              </div>
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <span className="text-2xl sm:text-3xl font-black tracking-tight font-display text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-cyan-300 to-teal-300 drop-shadow-[0_2px_12px_rgba(56,189,248,0.3)]">
                  SmartAttend
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wide uppercase shadow-sm ${roleConfig.badgeClass}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${roleConfig.pingClass} animate-ping`} />
                  {roleConfig.badgeText}
                </span>
              </div>
              <p className="text-xs font-semibold text-slate-400 tracking-wide">
                {registrationMeta?.collegeName || "QR & GPS Secured Institutional Portal"}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Elevated Glassmorphism Registration Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full"
        >
          {/* Outer Card Ambient Glow */}
          <div
            className="absolute -inset-1 rounded-[36px] opacity-70 blur-xl transition-all duration-500"
            style={{
              background: `linear-gradient(135deg, ${roleConfig.glowGradient}, transparent 70%)`,
            }}
          />

          {/* Elevated Card */}
          <div className="relative overflow-hidden rounded-[32px] border border-white/80 bg-white/95 p-6 sm:p-8 shadow-[0_25px_70px_-20px_rgba(0,0,0,0.35)] backdrop-blur-2xl text-slate-800">
            
            {/* Centered Form Header */}
            <div className="text-center space-y-1.5 mb-6">
              <div className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider mx-auto shadow-xs ${roleConfig.headerBadgeClass}`}>
                <HeaderBadgeIcon size={13} />
                {roleConfig.headerBadgeText}
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight pt-1">
                {roleConfig.title}
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 font-normal max-w-xs mx-auto">
                {roleConfig.description}
              </p>
            </div>

            {/* Error Banner */}
            <AnimatePresence>
              {submitError && (
                <motion.div
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -8 }}
                  className="mb-4 overflow-hidden rounded-2xl border border-red-200 bg-red-50/90 p-3.5 text-xs font-medium text-red-700 flex items-start gap-2.5 shadow-sm"
                >
                  <AlertCircle size={17} className="mt-0.5 shrink-0 text-red-600" />
                  <span>{submitError}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Registration Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <FloatingInput
                label="Full Name"
                icon={User}
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <FloatingInput
                label="Institutional Email Address"
                icon={Mail}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <FloatingInput
                label="Password"
                icon={Lock}
                isPassword
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              {roleType === "admin" && (
                <FloatingInput
                  label="College / Institution Name"
                  icon={Building2}
                  type="text"
                  required
                  autoComplete="organization"
                  value={collegeName}
                  onChange={(e) => setCollegeName(e.target.value)}
                />
              )}

              {roleType === "student" && (
                <>
                  <FloatingInput
                    label="Enrollment Number"
                    icon={GraduationCap}
                    type="text"
                    required
                    value={enrollmentNo}
                    onChange={(e) => setEnrollmentNo(e.target.value.toUpperCase())}
                  />

                  {/* Academic Tri-Selector: Year / Semester / Section */}
                  <div className="grid grid-cols-3 gap-2.5">
                    {/* Year */}
                    <div className="relative rounded-2xl border border-slate-200/90 hover:border-slate-300/90 focus-within:border-blue-500/90 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-500/10 transition-all duration-300 bg-white/80 px-3 py-2">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-blue-600">Year</label>
                      <select
                        value={year}
                        onChange={(e) => setYear(e.target.value ? Number(e.target.value) : "")}
                        required
                        className="w-full bg-transparent text-slate-900 text-xs font-semibold focus:outline-none cursor-pointer pt-0.5"
                      >
                        <option value="">Year</option>
                        {[1, 2, 3, 4].map((item) => (
                          <option key={item} value={item}>Year {item}</option>
                        ))}
                      </select>
                    </div>

                    {/* Semester */}
                    <div className="relative rounded-2xl border border-slate-200/90 hover:border-slate-300/90 focus-within:border-blue-500/90 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-500/10 transition-all duration-300 bg-white/80 px-3 py-2">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-blue-600">Semester</label>
                      <select
                        value={semester}
                        onChange={(e) => setSemester(e.target.value ? Number(e.target.value) : "")}
                        required
                        className="w-full bg-transparent text-slate-900 text-xs font-semibold focus:outline-none cursor-pointer pt-0.5"
                      >
                        <option value="">Sem</option>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
                          <option key={item} value={item}>Sem {item}</option>
                        ))}
                      </select>
                    </div>

                    {/* Section */}
                    <div className="relative rounded-2xl border border-slate-200/90 hover:border-slate-300/90 focus-within:border-blue-500/90 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-500/10 transition-all duration-300 bg-white/80 px-3 py-2">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-blue-600">Section</label>
                      <select
                        value={section}
                        onChange={(e) => setSection(e.target.value.toUpperCase())}
                        required
                        className="w-full bg-transparent text-slate-900 text-xs font-semibold focus:outline-none cursor-pointer pt-0.5"
                      >
                        <option value="">Sec</option>
                        {["A", "B", "C", "D"].map((item) => (
                          <option key={item} value={item}>Sec {item}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              )}

              {/* Department Dropdown for Student & Faculty */}
              {(roleType === "student" || roleType === "faculty") && (
                <div className="relative w-full group">
                  <div className="relative flex items-center w-full rounded-2xl border border-slate-200/90 hover:border-slate-300/90 focus-within:border-blue-500/90 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-500/10 transition-all duration-300 bg-white/80 backdrop-blur-md">
                    <div className="pl-4 pr-2 flex items-center text-slate-400 group-hover:text-slate-600 transition-colors">
                      <Building2 size={19} />
                    </div>
                    <div className="relative flex-1 py-2.5 pr-3">
                      <label className="block text-[11px] font-semibold tracking-wider uppercase text-blue-600 mb-0.5">
                        Department
                      </label>
                      <select
                        value={departmentId}
                        onChange={(e) => setDepartmentId(e.target.value)}
                        required
                        className="w-full bg-transparent text-slate-900 text-sm font-medium focus:outline-none cursor-pointer"
                      >
                        <option value="">Select your department</option>
                        {departments.map((dept: any) => (
                          <option key={dept._id || dept.id} value={dept._id || dept.id}>
                            {dept.name} {dept.code ? `(${dept.code})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Student Live Selfie Photo Verification */}
              {roleType === "student" && (
                <div className="pt-1">
                  <LivePhotoCapture
                    value={profilePhotoUrl}
                    onChange={setProfilePhotoUrl}
                    disabled={submitting}
                    enableFaceQuality
                    showCapturedPreview
                    title="Student Official Face ID Photo"
                    description="Position your face inside the oval guide. The capture button enables as soon as your face is centered."
                  />
                </div>
              )}

              {/* Primary CTA Submit Button */}
              <motion.button
                whileHover={{ scale: 1.012 }}
                whileTap={{ scale: 0.985 }}
                type="submit"
                disabled={submitting}
                className={`w-full relative overflow-hidden rounded-2xl py-3.5 px-5 font-bold text-sm text-white shadow-lg transition-all duration-300 flex items-center justify-center gap-2 bg-gradient-to-r ${roleConfig.buttonGradient} hover:shadow-xl hover:brightness-105 active:brightness-95 disabled:opacity-75 disabled:cursor-not-allowed cursor-pointer`}
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw size={17} className="animate-spin text-white/90" />
                    <span>Submitting Registration...</span>
                  </span>
                ) : (
                  <>
                    <span>{roleConfig.buttonText}</span>
                    <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </motion.button>
            </form>

            {/* Navigation Footer */}
            <div className="mt-6 pt-5 border-t border-slate-100 space-y-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
                <span>Already have an active profile?</span>
                <button
                  type="button"
                  onClick={() => navigateTo(View.LOGIN)}
                  className="font-bold text-blue-600 hover:text-blue-800 hover:underline transition-colors focus:outline-none cursor-pointer"
                >
                  Sign in here
                </button>
              </div>

              {/* Back to Login Pill Button */}
              <div className="flex justify-center pt-0.5">
                <button
                  type="button"
                  onClick={() => navigateTo(View.LOGIN)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors py-1.5 px-3.5 rounded-xl border border-slate-200 bg-slate-50/80 hover:bg-slate-100 hover:border-slate-300 shadow-sm cursor-pointer"
                >
                  <ArrowLeft size={14} className="text-slate-500" />
                  <span>Back to Login</span>
                </button>
              </div>
            </div>

          </div>

          {/* Bottom Security & Trust Badge */}
          <div className="mt-5 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-[11px] font-medium text-slate-400 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
              <span>256-bit Encrypted</span>
              <span className="text-slate-600">•</span>
              <span>GPS Geofenced</span>
              <span className="text-slate-600">•</span>
              <span>Device Bound</span>
            </div>
          </div>

        </motion.div>

      </div>

      {/* Footer Branding */}
      <footer className="relative z-10 py-4 text-center text-xs text-slate-500">
        SmartAttend Unified Campus Systems • © {new Date().getFullYear()} All Rights Reserved.
      </footer>
    </div>
  );
};

export default Register;
