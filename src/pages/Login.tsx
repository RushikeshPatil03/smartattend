// src/pages/Login.tsx
import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  GraduationCap,
  Briefcase,
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Camera,
  RefreshCw,
  QrCode,
  X,
  ShieldCheck,
} from "lucide-react";
import { UserRole } from "../types";
import { useApp } from "../store";
import { getFingerprint } from "../services/attendanceClient";
import {
  signAttendanceChallenge,
  registerDevicePasskey,
  isWebAuthnSupported,
} from "../services/deviceAuth";
import apiClient from "../services/apiClient";

// --- Role Options Configuration ---
const ROLE_OPTIONS = [
  {
    role: UserRole.STUDENT,
    label: "Student",
    icon: GraduationCap,
    badge: "Fast Check-in",
    tagline: "Mark attendance via dynamic QR & geofenced verification",
    accentColor: "#3b82f6", // Blue
    activeGlow: "rgba(59, 130, 246, 0.35)",
    buttonGradient: "from-blue-600 via-indigo-600 to-cyan-500",
  },
  {
    role: UserRole.FACULTY,
    label: "Faculty",
    icon: Briefcase,
    badge: "Session Host",
    tagline: "Generate live dynamic QR codes & track real-time attendance",
    accentColor: "#10b981", // Emerald
    activeGlow: "rgba(16, 185, 129, 0.35)",
    buttonGradient: "from-emerald-600 via-teal-600 to-cyan-600",
  },
  {
    role: UserRole.ADMIN,
    label: "Admin",
    icon: Shield,
    badge: "Institution",
    tagline: "Manage departments, users, security locks & system policies",
    accentColor: "#6366f1", // Indigo
    activeGlow: "rgba(99, 102, 241, 0.35)",
    buttonGradient: "from-indigo-600 via-blue-600 to-violet-600",
  },
] as const;

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

// --- Main Centered Login Page Component ---
const Login: React.FC = () => {
  const { login, goToAdminRegister } = useApp();

  const [selectedRole, setSelectedRole] = useState<UserRole>(UserRole.STUDENT);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Device change modal states
  const [deviceFormOpen, setDeviceFormOpen] = useState(false);
  const [deviceEmail, setDeviceEmail] = useState("");
  const [devicePassword, setDevicePassword] = useState("");
  const [deviceVerifyToken, setDeviceVerifyToken] = useState("");
  const [deviceStudent, setDeviceStudent] = useState<any>(null);
  const [deviceSelfie, setDeviceSelfie] = useState("");
  const [deviceMessage, setDeviceMessage] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const activeRoleData = ROLE_OPTIONS.find((r) => r.role === selectedRole) || ROLE_OPTIONS[0];

  const stopFrontCamera = () => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    setCameraStarting(false);
  };

  useEffect(() => {
    return () => stopFrontCamera();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Please provide both email address and password.");
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const fingerprint = getFingerprint();
      let webauthnAssertion: any = undefined;
      let challengeKey: string | undefined = undefined;

      // If user is STUDENT or FACULTY and browser supports WebAuthn, attempt passkey assertion
      if (
        (selectedRole === UserRole.STUDENT || selectedRole === UserRole.FACULTY) &&
        isWebAuthnSupported()
      ) {
        try {
          const passkeyRes = await signAttendanceChallenge({
            email: email.trim(),
            role: selectedRole,
          });

          if (passkeyRes.ok && passkeyRes.assertion) {
            webauthnAssertion = passkeyRes.assertion;
            challengeKey = passkeyRes.challengeKey;
          }
        } catch (passkeyErr) {
          console.warn("Passkey login fallback:", passkeyErr);
        }
      }

      const res = await login(
        selectedRole,
        email.trim(),
        password,
        fingerprint,
        webauthnAssertion,
        challengeKey
      );
      setLoading(false);

      if (!res || !res.ok) {
        setError(res?.error || "Login failed. Please verify your credentials.");
        return;
      }

      if (String(res?.user?.role || "").toUpperCase() === "STUDENT") {
        try {
          sessionStorage.setItem("studentAttendanceAutoStart", "1");
        } catch {
          // Ignore session storage issues and continue login flow.
        }
      }
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || "An unexpected error occurred during login.");
    }
  };

  const resetDeviceRequest = () => {
    stopFrontCamera();
    setDeviceVerifyToken("");
    setDeviceStudent(null);
    setDeviceSelfie("");
    setDeviceMessage("");
    setDeviceError("");
  };

  const verifyDeviceStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceEmail.trim() || !devicePassword) {
      setDeviceError("Enter student email and password.");
      return;
    }
    resetDeviceRequest();
    setDeviceLoading(true);
    try {
      const res: any = await apiClient.verifyDeviceChangeStudent({
        email: deviceEmail.trim(),
        password: devicePassword,
      });
      if (!res?.ok) {
        setDeviceError(res?.error || "Student verification failed.");
        return;
      }
      setDeviceVerifyToken(String(res.verifyToken || ""));
      setDeviceStudent(res.student || null);
      setDeviceMessage("Student verified. Please capture a live photo.");
    } catch (err: any) {
      setDeviceError(err?.message || "Failed to verify student.");
    } finally {
      setDeviceLoading(false);
    }
  };

  const startFrontCamera = async () => {
    setDeviceError("");
    setDeviceMessage("");
    setCameraStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setDeviceError("Camera is not supported in this browser.");
        setCameraStarting(false);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 480 },
          height: { ideal: 640 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await Promise.race([
          videoRef.current.play(),
          new Promise((resolve) => window.setTimeout(resolve, 2500)),
        ]);
      }
      setCameraActive(true);
    } catch (err: any) {
      setDeviceError(err?.message || "Unable to open front camera. Please check permissions.");
      stopFrontCamera();
    } finally {
      setCameraStarting(false);
    }
  };

  const captureSelfie = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setDeviceError("Camera stream is not ready yet.");
      return;
    }
    const maxWidth = 540;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setDeviceError("Unable to capture photo.");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setDeviceSelfie(canvas.toDataURL("image/jpeg", 0.82));
    setDeviceMessage("Live verification photo captured. Submit for faculty review.");
    stopFrontCamera();
  };

  const submitDeviceRequest = async () => {
    setDeviceError("");
    setDeviceMessage("");
    if (!deviceVerifyToken || !deviceSelfie) {
      setDeviceError("Verify student and capture live photo first.");
      return;
    }
    setDeviceLoading(true);
    try {
      let requestedCredentialId: string | null = null;
      let requestedPublicKey: string | null = null;
      let requestedTransports: string[] = ["internal"];

      if (isWebAuthnSupported()) {
        try {
          const passkeyRes = await registerDevicePasskey({
            email: deviceEmail.trim(),
            role: "student",
          });
          if (passkeyRes.ok && passkeyRes.credential) {
            requestedCredentialId = passkeyRes.credential.id;
            requestedPublicKey = passkeyRes.credential.publicKey;
            requestedTransports = passkeyRes.credential.transports || ["internal"];
          }
        } catch (passkeyErr) {
          console.warn("Passkey binding on new device fallback:", passkeyErr);
        }
      }

      const res: any = await apiClient.submitDeviceChangeRequest({
        verifyToken: deviceVerifyToken,
        fingerprint: getFingerprint(),
        selfieDataUrl: deviceSelfie,
        requestedCredentialId,
        requestedPublicKey,
        requestedTransports,
      });
      if (!res?.ok) {
        setDeviceError(res?.error || "Failed to submit request.");
        return;
      }
      setDeviceMessage(
        `Request submitted successfully! Expires at ${new Date(
          res.request.expiresAt
        ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
      );
      setDeviceVerifyToken("");
      setDevicePassword("");
    } catch (err: any) {
      setDeviceError(err?.message || "Submission failed. Please try again.");
    } finally {
      setDeviceLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[#070b14] text-slate-100 flex flex-col justify-between selection:bg-blue-500 selection:text-white">
      {/* Ambient Gradient Mesh Background (Hardware Accelerated, Zero CPU Load) */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[650px] h-[650px] rounded-full bg-[radial-gradient(circle,rgba(37,99,235,0.22)_0%,rgba(99,102,241,0.14)_45%,transparent_70%)] blur-3xl will-change-transform" />
        <div className="absolute -bottom-40 right-1/4 w-[600px] h-[600px] rounded-full bg-[radial-gradient(circle,rgba(6,182,212,0.18)_0%,rgba(37,99,235,0.10)_45%,transparent_70%)] blur-3xl will-change-transform" />

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
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-cyan-400 p-[1.5px] shadow-[0_12px_30px_-8px_rgba(59,130,246,0.8)]">
              <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-slate-950/95 backdrop-blur">
                <QrCode className="h-6 w-6 text-cyan-400 animate-pulse" />
              </div>
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <span className="text-2xl sm:text-3xl font-black tracking-tight font-display text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-cyan-300 to-teal-300 drop-shadow-[0_2px_12px_rgba(56,189,248,0.3)]">
                  SmartAttend
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400 tracking-wide uppercase shadow-[0_0_12px_rgba(16,185,129,0.25)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  Live System
                </span>
              </div>
              <p className="text-xs font-semibold text-slate-400 tracking-wide">QR & GPS Secured Institutional Portal</p>
            </div>
          </div>
        </motion.div>

        {/* Elevated Glassmorphism Authentication Form Card */}
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
              background: `linear-gradient(135deg, ${activeRoleData.activeGlow}, transparent 70%)`,
            }}
          />

          {/* Elevated Card */}
          <div className="relative overflow-hidden rounded-[32px] border border-white/80 bg-white/95 p-6 sm:p-8 shadow-[0_25px_70px_-20px_rgba(0,0,0,0.35)] backdrop-blur-2xl text-slate-800">
            
            {/* Centered Form Header */}
            <div className="text-center space-y-1.5 mb-6">
              <div className="inline-flex items-center justify-center gap-1.5 rounded-full border border-blue-200 bg-blue-50/90 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-blue-700 mx-auto shadow-xs">
                <Sparkles size={13} className="text-blue-600" />
                Portal Access
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight pt-1">
                Welcome Back
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 font-normal max-w-xs mx-auto">
                Select your role and authenticate to access your dashboard.
              </p>
            </div>

            {/* Role Segmented Tab Selector */}
            <div className="relative mb-5 p-1 rounded-2xl bg-slate-100/90 border border-slate-200/80 flex items-center justify-between">
              {ROLE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isSelected = selectedRole === option.role;

                return (
                  <button
                    key={option.role}
                    type="button"
                    onClick={() => {
                      setSelectedRole(option.role);
                      setError(null);
                    }}
                    className={`relative z-10 flex-1 py-2.5 px-2 rounded-xl text-xs font-bold tracking-tight transition-colors duration-200 flex items-center justify-center gap-1.5 select-none cursor-pointer ${
                      isSelected
                        ? "text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="activeRoleTab"
                        transition={{ type: "spring", stiffness: 450, damping: 35 }}
                        className="absolute inset-0 rounded-xl bg-white shadow-md border border-slate-200/60"
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-1.5">
                      <Icon
                        size={16}
                        className={isSelected ? "text-blue-600" : "text-slate-400"}
                      />
                      {option.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Dynamic Role Context Micro-copy */}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeRoleData.role}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.2 }}
                className="mb-5 rounded-xl border border-slate-200/80 bg-slate-50/90 px-3.5 py-2.5 text-xs text-slate-600 flex items-center gap-2"
              >
                <div
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: activeRoleData.accentColor }}
                />
                <span className="font-medium text-slate-700">{activeRoleData.tagline}</span>
              </motion.div>
            </AnimatePresence>

            {/* Error Banner */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -8 }}
                  className="mb-4 overflow-hidden rounded-2xl border border-red-200 bg-red-50/90 p-3.5 text-xs font-medium text-red-700 flex items-start gap-2.5 shadow-sm"
                >
                  <AlertCircle size={17} className="mt-0.5 shrink-0 text-red-600" />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Login Form */}
            <form onSubmit={handleLogin} className="space-y-4">
              <FloatingInput
                label="Institutional Email"
                icon={Mail}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                accentColor={activeRoleData.accentColor}
              />

              <FloatingInput
                label="Password"
                icon={Lock}
                isPassword
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                accentColor={activeRoleData.accentColor}
              />

              {/* Primary CTA Submit Button */}
              <motion.button
                whileHover={{ scale: 1.012 }}
                whileTap={{ scale: 0.985 }}
                type="submit"
                disabled={loading}
                className={`w-full relative overflow-hidden rounded-2xl py-3.5 px-5 font-bold text-sm text-white shadow-lg transition-all duration-300 flex items-center justify-center gap-2 bg-gradient-to-r ${activeRoleData.buttonGradient} hover:shadow-xl hover:brightness-105 active:brightness-95 disabled:opacity-75 disabled:cursor-not-allowed cursor-pointer`}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw size={17} className="animate-spin text-white/90" />
                    <span>Authenticating {activeRoleData.label}...</span>
                  </span>
                ) : (
                  <>
                    <span>Sign in as {activeRoleData.label}</span>
                    <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </motion.button>
            </form>

            {/* Clean Secondary Navigation Footer */}
            <div className="mt-6 pt-5 border-t border-slate-100 space-y-3.5 text-center">
              {/* Primary Register Link (Disabled as of now to avoid more admins) */}
              <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
                <span>New to SmartAttend?</span>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="font-semibold text-slate-400 cursor-not-allowed opacity-60 transition-colors focus:outline-none select-none"
                  title="Registration is currently disabled"
                >
                  Register here
                </button>
              </div>

              {/* Centered Device Reset Request Button */}
              <div className="flex justify-center pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setDeviceFormOpen(true);
                    setDeviceError("");
                    setDeviceMessage("");
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors py-1.5 px-3.5 rounded-xl border border-slate-200 bg-slate-50/80 hover:bg-slate-100 hover:border-slate-300 shadow-sm cursor-pointer"
                >
                  <Camera size={14} className="text-slate-500" />
                  <span>Device Reset Request</span>
                </button>
              </div>
            </div>

          </div>

          {/* Bottom Security & Trust Badge */}
          <div className="mt-5 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-[11px] font-medium text-slate-400 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>256-bit Encrypted</span>
              <span className="text-slate-600">•</span>
              <span>GPS Geofenced</span>
              <span className="text-slate-600">•</span>
              <span>Device Bound</span>
            </div>
          </div>

        </motion.div>

      </div>

      {/* ======================================================== */}
      {/* DEVICE CHANGE REQUEST MODAL (High-End Glassmorphic UX)     */}
      {/* ======================================================== */}
      <AnimatePresence>
        {deviceFormOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop Blur Overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setDeviceFormOpen(false);
                resetDeviceRequest();
              }}
              className="absolute inset-0 bg-slate-950/75 backdrop-blur-md"
            />

            {/* Modal Dialog Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: "spring", stiffness: 350, damping: 30 }}
              className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-white/20 bg-white shadow-2xl text-slate-900 z-10"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/70">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                    <Camera size={18} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 tracking-tight">
                      Device Change Request
                    </h3>
                    <p className="text-xs text-slate-500">Live photo verification required</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDeviceFormOpen(false);
                    resetDeviceRequest();
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200/80 hover:text-slate-700 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Content Body */}
              <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
                <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-3.5 text-xs text-blue-800 flex items-start gap-2">
                  <ShieldCheck size={16} className="text-blue-600 mt-0.5 shrink-0" />
                  <span>
                    Verify your student account first, then take a live photo from your new device for faculty review and approval.
                  </span>
                </div>

                {!deviceStudent ? (
                  /* Step 1: Student Credentials Verification */
                  <form onSubmit={verifyDeviceStudent} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                        Student Email
                      </label>
                      <div className="relative flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
                        <Mail size={17} className="text-slate-400 mr-2.5" />
                        <input
                          type="email"
                          required
                          value={deviceEmail}
                          onChange={(e) => setDeviceEmail(e.target.value)}
                          placeholder="student@college.edu"
                          className="w-full text-sm font-medium text-slate-900 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                        Student Password
                      </label>
                      <div className="relative flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
                        <Lock size={17} className="text-slate-400 mr-2.5" />
                        <input
                          type="password"
                          required
                          value={devicePassword}
                          onChange={(e) => setDevicePassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full text-sm font-medium text-slate-900 focus:outline-none"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={deviceLoading}
                      className="w-full mt-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white shadow-md hover:bg-blue-700 active:scale-[0.99] transition-all disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {deviceLoading ? (
                        <>
                          <RefreshCw size={16} className="animate-spin" /> Verifying Student...
                        </>
                      ) : (
                        "Verify & Proceed to Photo"
                      )}
                    </button>
                  </form>
                ) : (
                  /* Step 2: Camera Capture Flow */
                  <div className="space-y-4">
                    {/* Student Info Card */}
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 text-sm">{deviceStudent.name}</span>
                        <span className="rounded-md bg-blue-100 px-2 py-0.5 font-mono text-[11px] font-bold text-blue-700">
                          {deviceStudent.enrollmentNo}
                        </span>
                      </div>
                      <p className="text-slate-600">
                        Department: {deviceStudent.department?.name || "Assigned Department"}
                        {deviceStudent.department?.code ? ` (${deviceStudent.department.code})` : ""}
                      </p>
                    </div>

                    {/* Live Camera Viewfinder or Captured Preview */}
                    {!deviceSelfie ? (
                      <div className="space-y-3">
                        <div
                          className={`relative w-full aspect-[4/3] overflow-hidden rounded-2xl bg-slate-950 border border-slate-800 ${
                            cameraActive || cameraStarting ? "" : "hidden"
                          }`}
                        >
                          <video
                            ref={videoRef}
                            className="h-full w-full object-cover -scale-x-100"
                            autoPlay
                            muted
                            playsInline
                          />
                          {/* Face Oval Guide Alignment Overlay */}
                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                            <div className="h-44 w-36 rounded-[50%] border-2 border-dashed border-cyan-400/70 shadow-[0_0_15px_rgba(6,182,212,0.3)]" />
                          </div>
                          <div className="absolute bottom-2 inset-x-0 text-center">
                            <span className="rounded-full bg-black/60 px-3 py-1 text-[10px] font-medium text-white backdrop-blur">
                              Align your face within the guide
                            </span>
                          </div>
                        </div>

                        {!cameraActive && !cameraStarting && (
                          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500 space-y-2">
                            <Camera size={28} className="mx-auto text-slate-400" />
                            <p className="font-medium text-slate-700">Camera ready to initialize</p>
                            <p className="text-[11px] text-slate-500">
                              Please enable camera permissions to take a live photo.
                            </p>
                          </div>
                        )}

                        <canvas ref={canvasRef} className="hidden" />

                        <div className="grid grid-cols-2 gap-2.5 pt-1">
                          <button
                            type="button"
                            onClick={startFrontCamera}
                            disabled={cameraActive || cameraStarting}
                            className="rounded-xl border border-slate-200 bg-slate-100 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            {cameraStarting ? (
                              <>
                                <RefreshCw size={14} className="animate-spin" /> Starting...
                              </>
                            ) : (
                              <>
                                <Camera size={14} /> Open Camera
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={captureSelfie}
                            disabled={!cameraActive}
                            className="rounded-xl bg-blue-600 py-2.5 text-xs font-bold text-white hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                          >
                            <Camera size={14} /> Capture Photo
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Captured Photo Preview */
                      <div className="space-y-3">
                        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-slate-200 shadow-inner">
                          <img
                            src={deviceSelfie}
                            alt="Captured Live Verification"
                            className="h-full w-full object-cover"
                          />
                          <div className="absolute top-2 right-2 rounded-full bg-emerald-500/90 px-2.5 py-0.5 text-[10px] font-bold text-white backdrop-blur flex items-center gap-1">
                            <CheckCircle2 size={11} /> Photo Captured
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                          <button
                            type="button"
                            onClick={() => setDeviceSelfie("")}
                            className="rounded-xl border border-slate-200 bg-slate-100 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
                          >
                            Retake Photo
                          </button>

                          <button
                            type="button"
                            onClick={submitDeviceRequest}
                            disabled={deviceLoading}
                            className="rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                          >
                            {deviceLoading ? (
                              <>
                                <RefreshCw size={14} className="animate-spin" /> Submitting...
                              </>
                            ) : (
                              "Submit Request"
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Error & Message Alerts */}
                {deviceError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-center gap-2">
                    <AlertCircle size={15} className="shrink-0 text-red-600" />
                    <span>{deviceError}</span>
                  </div>
                )}
                {deviceMessage && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center gap-2">
                    <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
                    <span>{deviceMessage}</span>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer Branding */}
      <footer className="relative z-10 py-4 text-center text-xs text-slate-500">
        SmartAttend Unified Campus Systems • © {new Date().getFullYear()} All Rights Reserved.
      </footer>
    </div>
  );
};

export default Login;


