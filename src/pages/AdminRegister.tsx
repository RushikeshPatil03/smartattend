// src/pages/AdminRegister.tsx
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
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
} from "lucide-react";
import { useApp, View } from "../store";
import apiClient from "../services/apiClient";

// --- Floating Label Input Component ---
interface FloatingInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  isPassword?: boolean;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const FloatingInput: React.FC<FloatingInputProps> = React.memo(({
  label,
  icon: Icon,
  isPassword = false,
  value,
  onChange,
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
            ? "border-indigo-500/90 bg-white ring-4 ring-indigo-500/10 shadow-[0_8px_24px_-8px_rgba(99,102,241,0.25)]"
            : "border-slate-200/90 hover:border-slate-300/90 hover:bg-white/95"
        }`}
      >
        {/* Leading Icon */}
        <div
          className={`pl-4 pr-2 flex items-center transition-colors duration-200 ${
            isFocused ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600"
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
                ? "top-1.5 text-[11px] font-semibold tracking-wider uppercase text-indigo-600"
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

const AdminRegister: React.FC = () => {
  const { navigateTo } = useApp();

  const [form, setForm] = useState({
    name: "",
    collegeName: "",
    email: "",
    password: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.collegeName.trim() || !form.email.trim() || !form.password) {
      setError("Please fill in all required fields.");
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const res = await apiClient.createAdmin({
        name: form.name.trim(),
        collegeName: form.collegeName.trim(),
        email: form.email.trim(),
        password: form.password,
      });

      setLoading(false);

      if (!res?.ok) {
        setError(res?.error || "Admin registration failed");
        return;
      }

      navigateTo(View.LOGIN);
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || "A network error occurred while creating the account.");
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[#070b14] text-slate-100 flex flex-col justify-between selection:bg-indigo-500 selection:text-white">
      {/* Ambient Gradient Mesh Background */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Animated Radial Orbs */}
        <motion.div
          animate={{
            scale: [1, 1.15, 1],
            x: [0, 20, 0],
            y: [0, -15, 0],
          }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[650px] h-[650px] rounded-full bg-gradient-to-tr from-indigo-600/25 via-blue-600/20 to-cyan-500/10 blur-[130px]"
        />
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            x: [0, -25, 0],
            y: [0, 25, 0],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -bottom-40 right-1/4 w-[600px] h-[600px] rounded-full bg-gradient-to-bl from-purple-500/20 via-indigo-600/15 to-transparent blur-[130px]"
        />

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
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-blue-500 to-cyan-400 p-[1.5px] shadow-[0_12px_30px_-8px_rgba(99,102,241,0.8)]">
              <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-slate-950/95 backdrop-blur">
                <QrCode className="h-6 w-6 text-cyan-400 animate-pulse" />
              </div>
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <span className="text-2xl sm:text-3xl font-black tracking-tight font-display text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-cyan-300 to-teal-300 drop-shadow-[0_2px_12px_rgba(56,189,248,0.3)]">
                  SmartAttend
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-0.5 text-[10px] font-bold text-indigo-400 tracking-wide uppercase shadow-[0_0_12px_rgba(99,102,241,0.25)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-ping" />
                  Admin Setup
                </span>
              </div>
              <p className="text-xs font-semibold text-slate-400 tracking-wide">QR & GPS Secured Institutional Portal</p>
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
              background: `linear-gradient(135deg, rgba(99, 102, 241, 0.35), transparent 70%)`,
            }}
          />

          {/* Elevated Card */}
          <div className="relative overflow-hidden rounded-[32px] border border-white/80 bg-white/95 p-6 sm:p-8 shadow-[0_25px_70px_-20px_rgba(0,0,0,0.35)] backdrop-blur-2xl text-slate-800">
            
            {/* Centered Form Header */}
            <div className="text-center space-y-1.5 mb-6">
              <div className="inline-flex items-center justify-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50/90 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-indigo-700 mx-auto shadow-xs">
                <Shield size={13} className="text-indigo-600" />
                Institution Setup
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight pt-1">
                Register Administrator
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 font-normal max-w-xs mx-auto">
                Create your institution’s primary administrator account to manage attendance.
              </p>
            </div>

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

            {/* Registration Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <FloatingInput
                label="Full Name"
                icon={User}
                type="text"
                required
                autoComplete="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />

              <FloatingInput
                label="College / Institution Name"
                icon={Building2}
                type="text"
                required
                autoComplete="organization"
                value={form.collegeName}
                onChange={(e) => setForm({ ...form, collegeName: e.target.value })}
              />

              <FloatingInput
                label="Administrator Email"
                icon={Mail}
                type="email"
                required
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />

              <FloatingInput
                label="Password"
                icon={Lock}
                isPassword
                required
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />

              {/* Primary CTA Submit Button */}
              <motion.button
                whileHover={{ scale: 1.012 }}
                whileTap={{ scale: 0.985 }}
                type="submit"
                disabled={loading}
                className="w-full relative overflow-hidden rounded-2xl py-3.5 px-5 font-bold text-sm text-white shadow-lg transition-all duration-300 flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-600 hover:shadow-xl hover:brightness-105 active:brightness-95 disabled:opacity-75 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw size={17} className="animate-spin text-white/90" />
                    <span>Creating Admin Account...</span>
                  </span>
                ) : (
                  <>
                    <span>Create Administrator Account</span>
                    <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </motion.button>
            </form>

            {/* Navigation Footer */}
            <div className="mt-6 pt-5 border-t border-slate-100 space-y-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
                <span>Already have an admin profile?</span>
                <button
                  type="button"
                  onClick={() => navigateTo(View.LOGIN)}
                  className="font-bold text-indigo-600 hover:text-indigo-800 hover:underline transition-colors focus:outline-none cursor-pointer"
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
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
              <span>256-bit Encrypted</span>
              <span className="text-slate-600">•</span>
              <span>GPS Geofenced</span>
              <span className="text-slate-600">•</span>
              <span>High Security Admin</span>
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

export default AdminRegister;

