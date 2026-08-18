import React, { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Clock3, Link2, GraduationCap, Users } from "lucide-react";
import { useApp, View } from "../store";
import { getFingerprint } from "../services/attendanceClient";
import apiClient from "../services/apiClient";
import { Department } from "../types";
import { Badge, Button, Card, Input } from "../components/Common";
import LivePhotoCapture from "../components/LivePhotoCapture";
import { buildFaceSignatures } from "../utils/faceSignature";

type RoleType = "admin" | "student" | "faculty" | null;

type RegistrationMeta = {
  collegeName?: string;
  expiresAt?: string;
  maxRegistrations?: number;
  usedRegistrations?: number;
  remainingRegistrations?: number;
};

const formatExpiry = (value?: string) => {
  if (!value) return "Not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not provided" : date.toLocaleString();
};

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

    setLinkError("Invalid or incomplete registration link. Please ask the admin for a fresh link.");
    setLoading(false);
  }, []);

  const fetchRegistrationContext = async (registrationToken: string) => {
    try {
      const res = await apiClient.get(`/api/public/departments?token=${encodeURIComponent(registrationToken)}`);
      if (!res?.ok) {
        setLinkError(res?.error || "Unable to validate registration link.");
        setDepartments([]);
        return;
      }

      setDepartments(Array.isArray(res.departments) ? res.departments : []);
      setRegistrationMeta(res.registration || null);
    } catch {
      setLinkError("Unable to load registration link details.");
      setDepartments([]);
    } finally {
      setLoading(false);
    }
  };

  const roleTitle = useMemo(() => {
    if (roleType === "admin") return "Admin Registration";
    if (roleType === "student") return "Student Registration";
    return "Faculty Registration";
  }, [roleType]);

  const roleDescription = useMemo(() => {
    if (roleType === "student") {
      return "One student account per device, unique enrollment number, and department-scoped onboarding.";
    }
    if (roleType === "faculty") {
      return "Secure faculty onboarding with device binding and controlled access from the admin link.";
    }
    return "Create the institution admin profile to start managing registrations.";
  }, [roleType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);

    try {
      if (roleType === "admin") {
        if (!name || !email || !password || !collegeName) {
          setSubmitError("All admin fields are required.");
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
          return;
        }
      } else {
        if (!token) {
          setSubmitError("Invalid or missing registration token.");
          return;
        }

        const fingerprint = getFingerprint();

        if (roleType === "student") {
          if (!name || !email || !password || !enrollmentNo || year === "" || semester === "" || !section || !departmentId || !profilePhotoUrl) {
            setSubmitError("All student fields are required.");
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
            return;
          }
        }

        if (roleType === "faculty") {
          if (!name || !email || !password || !departmentId) {
            setSubmitError("All faculty fields are required.");
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
            return;
          }
        }
      }

      setSuccess(true);
      setTimeout(() => navigateTo(View.LOGIN), 1600);
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="mt-20 text-center text-slate-600">Validating registration link...</div>;
  }

  if (linkError) {
    return (
      <div className="mx-auto mt-16 max-w-xl px-4">
        <Card className="border-rose-200 bg-rose-50/70 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
            <Link2 size={22} />
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">Registration Link Error</h2>
          <p className="mt-3 text-sm text-slate-600">{linkError}</p>
          <Button className="mt-6" onClick={() => navigateTo(View.LOGIN)}>
            Back to Login
          </Button>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="mx-auto mt-16 max-w-xl px-4">
        <Card className="border-emerald-200 bg-emerald-50/70 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            <ShieldCheck size={22} />
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">Registration Completed</h2>
          <p className="mt-3 text-sm text-slate-600">Your account is ready. Redirecting you to login...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-120px)] bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.15),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.16),_transparent_26%),linear-gradient(180deg,_#f8fafc_0%,_#eef6ff_100%)] px-4 py-10">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.05fr_1.25fr]">
        <Card className="overflow-hidden border-0 bg-slate-900 text-white shadow-xl">
          <div className="space-y-5">
            <Badge color="blue">{roleTitle}</Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Secure onboarding with clear rules.</h1>
              <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">{roleDescription}</p>
            </div>

            {roleType !== "admin" ? (
              <div className="grid gap-3 pt-2 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sky-300">
                    <Clock3 size={16} />
                    <span className="text-sm font-semibold">Link Expiry</span>
                  </div>
                  <p className="text-sm text-slate-200">{formatExpiry(registrationMeta?.expiresAt)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-2 flex items-center gap-2 text-emerald-300">
                    <Users size={16} />
                    <span className="text-sm font-semibold">Slots Left</span>
                  </div>
                  <p className="text-sm text-slate-200">
                    {registrationMeta?.remainingRegistrations ?? 0} of {registrationMeta?.maxRegistrations ?? 0} available
                  </p>
                </div>
              </div>
            ) : null}

            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-slate-200">
              <div className="flex items-start gap-3">
                <ShieldCheck size={18} className="mt-0.5 text-emerald-300" />
                <p>Each device can be linked to only one account. Reusing the same phone or laptop for another registration will be blocked.</p>
              </div>
              {roleType === "student" ? (
                <div className="flex items-start gap-3">
                  <GraduationCap size={18} className="mt-0.5 text-amber-300" />
                  <p>Enrollment number must be unique. Use the official institution format to avoid duplicate record errors.</p>
                </div>
              ) : null}
            </div>
          </div>
        </Card>

        <Card className="border-slate-200/80 bg-white/90 shadow-xl backdrop-blur">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-700">
              {registrationMeta?.collegeName || "Smart Attendance System"}
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{roleTitle}</h2>
            <p className="mt-2 text-sm text-slate-500">
              Fill the details carefully. The system verifies unique enrollment numbers and prevents multiple accounts from the same device.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-1">
            <Input label="Full Name" placeholder="Enter full name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="Email Address" placeholder="name@college.edu" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input label="Password" placeholder="Create a secure password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />

            {roleType === "admin" ? (
              <Input label="College Name" placeholder="Enter college name" value={collegeName} onChange={(e) => setCollegeName(e.target.value)} />
            ) : null}

            {roleType === "student" ? (
              <>
                <Input
                  label="Enrollment Number"
                  placeholder="Example: 22CSE1045"
                  value={enrollmentNo}
                  onChange={(e) => setEnrollmentNo(e.target.value.toUpperCase())}
                />
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600">Year</label>
                    <select
                      className="w-full rounded-lg border border-slate-300 px-4 py-2 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
                      value={year}
                      onChange={(e) => setYear(e.target.value ? Number(e.target.value) : "")}
                    >
                      <option value="">Select year</option>
                      {[1, 2, 3, 4].map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600">Semester</label>
                    <select
                      className="w-full rounded-lg border border-slate-300 px-4 py-2 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
                      value={semester}
                      onChange={(e) => setSemester(e.target.value ? Number(e.target.value) : "")}
                    >
                      <option value="">Select semester</option>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600">Section</label>
                    <select
                      className="w-full rounded-lg border border-slate-300 px-4 py-2 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
                      value={section}
                      onChange={(e) => setSection(e.target.value.toUpperCase())}
                    >
                      <option value="">Select section</option>
                      {["A", "B", "C", "D"].map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            ) : null}

            {roleType === "student" ? (
              <div className="pt-3">
                <LivePhotoCapture value={profilePhotoUrl} onChange={setProfilePhotoUrl} disabled={submitting} enableFaceQuality />
              </div>
            ) : null}

            {(roleType === "student" || roleType === "faculty") && (
              <div className="pt-3">
                <label className="mb-1 block text-sm font-medium text-slate-600">Department</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-4 py-2 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                >
                  <option value="">Select department</option>
                  {departments.map((department: any) => (
                    <option key={department._id || department.id} value={department._id || department.id}>
                      {department.name} {department.code ? `(${department.code})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {submitError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {submitError}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 pt-5 sm:flex-row">
              <Button className="flex-1" disabled={submitting}>
                {submitting ? "Submitting..." : "Complete Registration"}
              </Button>
              <Button type="button" variant="secondary" className="flex-1" onClick={() => navigateTo(View.LOGIN)}>
                Back to Login
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
};

export default Register;
