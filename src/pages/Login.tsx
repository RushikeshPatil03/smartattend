// src/pages/Login.tsx
import React, { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { UserRole } from "../types";
import { useApp } from "../store";
import { Button, Card, Input, Skeleton } from "../components/Common";
import {
  UserCircle,
  Shield,
  GraduationCap,
  AlertCircle,
  Camera,
  RefreshCw,
  ArrowRight,
  CheckCircle2,
  Fingerprint,
  Sparkles,
} from "lucide-react";
import { getFingerprint } from "../services/attendanceClient";
import apiClient from "../services/apiClient";

const Login: React.FC = () => {
  const { login, goToAdminRegister } = useApp();

  const [selectedRole, setSelectedRole] = useState<UserRole>(UserRole.STUDENT);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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

  const roleOptions = [
    {
      role: UserRole.ADMIN,
      label: "Admin",
      hint: "Control departments, users, and institutional setup.",
      icon: Shield,
      accent: "from-sky-500 to-blue-600",
      selectedClass:
        "border-sky-400 bg-sky-50 text-sky-700 shadow-[0_18px_40px_-28px_rgba(14,165,233,0.9)]",
    },
    {
      role: UserRole.FACULTY,
      label: "Faculty",
      hint: "Run live sessions, track attendance, and manage devices.",
      icon: UserCircle,
      accent: "from-emerald-500 to-teal-600",
      selectedClass:
        "border-emerald-400 bg-emerald-50 text-emerald-700 shadow-[0_18px_40px_-28px_rgba(16,185,129,0.9)]",
    },
    {
      role: UserRole.STUDENT,
      label: "Student",
      hint: "Access classes, submit attendance, and monitor progress.",
      icon: GraduationCap,
      accent: "from-amber-400 to-orange-500",
      selectedClass:
        "border-amber-400 bg-amber-50 text-amber-700 shadow-[0_18px_40px_-28px_rgba(245,158,11,0.9)]",
    },
  ] as const;

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
    setError(null);
    setLoading(true);

    try {
      const fingerprint = getFingerprint();

      const res = await login(
        selectedRole,
        email,
        password,
        fingerprint
      );

      setLoading(false);

      if (!res || !res.ok) {
        setError(res?.error || "Login failed");
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
      setError(err?.message || "Login error");
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
    resetDeviceRequest();
    setDeviceLoading(true);
    try {
      const res: any = await apiClient.verifyDeviceChangeStudent({
        email: deviceEmail,
        password: devicePassword,
      });
      if (!res?.ok) {
        setDeviceError(res?.error || "Student verification failed.");
        return;
      }
      setDeviceVerifyToken(String(res.verifyToken || ""));
      setDeviceStudent(res.student || null);
      setDeviceMessage("Student verified. Capture a live photo.");
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
          width: { ideal: 360 },
          height: { ideal: 480 },
          frameRate: { ideal: 15, max: 24 },
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
      setDeviceError(err?.message || "Unable to open front camera.");
      stopFrontCamera();
    } finally {
      setCameraStarting(false);
    }
  };

  const captureSelfie = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setDeviceError("Camera is not ready yet.");
      return;
    }
    const maxWidth = 480;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setDeviceError("Unable to capture photo.");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setDeviceSelfie(canvas.toDataURL("image/jpeg", 0.75));
    setDeviceMessage("Live photo captured. Submit the request for faculty approval.");
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
      const res: any = await apiClient.submitDeviceChangeRequest({
        verifyToken: deviceVerifyToken,
        fingerprint: getFingerprint(),
        selfieDataUrl: deviceSelfie,
      });
      if (!res?.ok) {
        setDeviceError(res?.error || "Failed to submit request.");
        return;
      }
      setDeviceMessage(
        `Request submitted. It expires at ${new Date(res.request.expiresAt).toLocaleString()} if no faculty reviews it.`
      );
      setDeviceVerifyToken("");
      setDevicePassword("");
    } finally {
      setDeviceLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(20,184,166,0.18),_transparent_28%),linear-gradient(180deg,_#f8fbff_0%,_#eef6ff_42%,_#f8fafc_100%)]" />
      <div className="relative flex min-h-screen flex-col justify-center px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-2xl space-y-4">
            <Card className="overflow-hidden rounded-[32px] border-white/70 bg-white/92 p-0 shadow-[0_34px_90px_-52px_rgba(15,23,42,0.48)] backdrop-blur">
              <div className="border-b border-slate-100 bg-[linear-gradient(180deg,_rgba(248,250,252,0.9)_0%,_rgba(255,255,255,0.96)_100%)] p-4 text-center sm:p-5 sm:text-left">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Welcome Back
                </div>
              </div>

              <div className="space-y-3 px-4 py-4 sm:px-6">
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {roleOptions.map((option) => {
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
                        className={`min-w-0 rounded-2xl border px-2 py-3 text-center transition-all duration-200 sm:px-3 ${
                          isSelected
                            ? option.selectedClass
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex min-w-0 flex-col items-center gap-2">
                          <div className={`flex h-9 w-9 items-center justify-center rounded-xl sm:h-10 sm:w-10 ${
                            isSelected ? "bg-white/75" : "bg-slate-100"
                          }`}>
                            <Icon size={18} />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold sm:text-sm">{option.label}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Selected Role
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-700">
                    {roleOptions.find((option) => option.role === selectedRole)?.hint}
                  </p>
                </div>

                {error && (
                  <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <AlertCircle size={18} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <form onSubmit={handleLogin} className="space-y-3">
                  <Input
                    label="Email Address"
                    type="email"
                    placeholder="name@college.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 rounded-xl"
                  />

                  <Input
                    label="Password"
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 rounded-xl"
                  />

                  <Button type="submit" className="mt-2 w-full rounded-xl py-3.5 text-sm" disabled={loading}>
                    {loading ? "Signing in..." : "Login to Dashboard"}
                    {!loading ? <ArrowRight size={16} /> : null}
                  </Button>
                </form>
              </div>
            </Card>

            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                type="button"
                className="w-full rounded-2xl border-none bg-[linear-gradient(135deg,_#15803d_0%,_#16a34a_50%,_#22c55e_100%)] py-3.5 text-white shadow-[0_22px_45px_-28px_rgba(34,197,94,0.7)] hover:brightness-105"
                onClick={goToAdminRegister}
              >
                <Plus size={16} />
                New Admin Registration
              </Button>

              <Button
                type="button"
                variant="secondary"
                className="w-full rounded-2xl py-3.5"
                onClick={() => {
                  setDeviceFormOpen(true);
                  setDeviceError("");
                  setDeviceMessage("");
                }}
              >
                <Camera size={16} />
                Device Change Request
              </Button>
            </div>

            {deviceFormOpen ? (
              <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center sm:p-4">
                <div className="max-h-[88vh] w-full max-w-xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_28px_90px_-36px_rgba(15,23,42,0.65)]">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
                    <h3 className="text-lg font-semibold tracking-tight text-slate-900">Device Change Request</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setDeviceFormOpen(false);
                        resetDeviceRequest();
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                      aria-label="Close device change request"
                    >
                      x
                    </button>
                  </div>
                  <div className="max-h-[calc(88vh-58px)] overflow-y-auto p-4 sm:p-5">
                    <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Verify the student first, then capture a live photo for faculty review. The existing approval workflow remains unchanged.
                  </div>
                  {!deviceStudent ? (
                    <form onSubmit={verifyDeviceStudent} className="space-y-3">
                      <Input
                        label="Student Email"
                        type="email"
                        placeholder="student@college.edu"
                        value={deviceEmail}
                        onChange={(e) => setDeviceEmail(e.target.value)}
                        className="h-12 rounded-xl"
                      />
                      <Input
                        label="Student Password"
                        type="password"
                        placeholder="Password"
                        value={devicePassword}
                        onChange={(e) => setDevicePassword(e.target.value)}
                        className="h-12 rounded-xl"
                      />
                      <Button type="submit" className="w-full rounded-xl py-3" disabled={deviceLoading}>
                        {deviceLoading ? <><RefreshCw size={16} className="animate-spin" /> Verifying...</> : "Verify Student"}
                      </Button>
                    </form>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                        <p className="font-semibold text-slate-900">{deviceStudent.name}</p>
                        <p className="text-slate-600">{deviceStudent.enrollmentNo}</p>
                        <p className="text-slate-500">
                          Department: {deviceStudent.department?.name || "Assigned department"}
                          {deviceStudent.department?.code ? ` (${deviceStudent.department.code})` : ""}
                        </p>
                      </div>

                      {!deviceSelfie ? (
                        <div className="space-y-3">
                          <div className={`w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-black ${cameraActive || cameraStarting ? "" : "hidden"}`}>
                            <video ref={videoRef} className="max-h-72 w-full object-cover" autoPlay muted playsInline />
                          </div>
                          {!cameraActive && !cameraStarting ? (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">
                              Use the front camera for a live verification photo.
                            </div>
                          ) : null}
                          <canvas ref={canvasRef} className="hidden" />
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <Button type="button" variant="secondary" onClick={startFrontCamera} disabled={cameraActive || cameraStarting}>
                              {cameraStarting ? <><RefreshCw size={16} className="animate-spin" /> Opening...</> : <><Camera size={16} /> Open Camera</>}
                            </Button>
                            <Button type="button" onClick={captureSelfie} disabled={!cameraActive}>
                              Take Photo
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <img src={deviceSelfie} alt="Captured live verification" className="w-full max-w-full rounded-2xl border border-slate-200" />
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button type="button" variant="secondary" onClick={() => setDeviceSelfie("")}>
                              Retake
                            </Button>
                            <Button type="button" onClick={submitDeviceRequest} disabled={deviceLoading}>
                              {deviceLoading ? <><RefreshCw size={16} className="animate-spin" /> Submitting...</> : "Submit Request"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {deviceError ? <p className="text-sm text-red-600">{deviceError}</p> : null}
                  {deviceMessage ? <p className="text-sm text-green-700">{deviceMessage}</p> : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {loading ? (
              <div className="space-y-3">
                <Skeleton className="shimmer h-4 w-32" />
                <Skeleton className="shimmer h-20 w-full" />
              </div>
            ) : null}
        </div>
      </div>
    </div>
  );
};

export default Login;
