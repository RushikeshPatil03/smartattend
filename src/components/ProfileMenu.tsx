import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, GraduationCap, LogOut, Mail, ShieldCheck, UserRound, Edit, Camera } from "lucide-react";
import { useApp } from "../store";
import apiClient from "../services/apiClient";
import LivePhotoCapture from "./LivePhotoCapture";

type ProfileMenuProps = {
  user?: any;
  roleLabel: string;
  onLogout: () => void | Promise<void>;
  photoUrl?: string | null;
  variant?: "header" | "default" | "avatar";
};

const getInitials = (name: string) => {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "U";
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
};

const ProfileMenu: React.FC<ProfileMenuProps> = ({
  user,
  roleLabel,
  onLogout,
  photoUrl,
  variant = "default",
}) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const displayName = String(user?.name || roleLabel || "User").trim();
  const email = String(user?.email || "Email not available").trim();
  const enrollmentNo = String(user?.enrollmentNo || user?.usn || "").trim();
  const isStudent = String(roleLabel || "").toLowerCase() === "student";
  const isFaculty = String(roleLabel || "").toLowerCase() === "faculty";
  const isAdmin = String(roleLabel || "").toLowerCase() === "admin";
  const resolvedPhoto = String(
    isFaculty
      ? photoUrl || user?.facultyProfilePhotoUrl || ""
      : isAdmin
        ? photoUrl || user?.adminProfilePhotoUrl || ""
      : photoUrl || user?.profilePhotoUrl || user?.studentProfilePhotoUrl || ""
  ).trim();
  const initials = useMemo(() => getInitials(displayName), [displayName]);
  const { updateCurrentUser } = useApp();

  // Local editor state for college profile (admin-only)
  const [editingCampus, setEditingCampus] = useState(false);
  const [campusName, setCampusName] = useState<string>(String(user?.collegeName || "").trim());
  const [campusPhoto, setCampusPhoto] = useState<string>(String(photoUrl || user?.profilePhotoUrl || "").trim());
  const [savingCampus, setSavingCampus] = useState(false);
  const [campusMsg, setCampusMsg] = useState<string | null>(null);
  const [campusErr, setCampusErr] = useState<string | null>(null);
  const [editingFacultyPhoto, setEditingFacultyPhoto] = useState(false);
  const [facultyPhoto, setFacultyPhoto] = useState<string>(String(photoUrl || user?.facultyProfilePhotoUrl || "").trim());
  const [savingFacultyPhoto, setSavingFacultyPhoto] = useState(false);
  const [facultyPhotoMsg, setFacultyPhotoMsg] = useState<string | null>(null);
  const [facultyPhotoErr, setFacultyPhotoErr] = useState<string | null>(null);

  useEffect(() => {
    setCampusName(String(user?.collegeName || "").trim());
    setCampusPhoto(String(photoUrl || user?.profilePhotoUrl || "").trim());
  }, [user?.collegeName, photoUrl, user?.profilePhotoUrl]);

  useEffect(() => {
    if (!isFaculty || editingFacultyPhoto) return;
    setFacultyPhoto(String(photoUrl || user?.facultyProfilePhotoUrl || "").trim());
  }, [editingFacultyPhoto, isFaculty, photoUrl, user?.facultyProfilePhotoUrl]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const isHeader = variant === "header";
  const isAvatar = variant === "avatar";

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Open profile menu"
        aria-expanded={open}
        className={
          isAvatar
            ? "group relative inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/80 bg-white p-1.5 text-slate-700 shadow-[0_18px_42px_-28px_rgba(15,23,42,0.8)] transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_22px_48px_-30px_rgba(15,23,42,0.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 sm:h-16 sm:w-16"
            : isHeader
            ? "group inline-flex h-14 min-w-[180px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-slate-700 shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            : "group inline-flex h-12 items-center gap-2 rounded-full border border-white/70 bg-white/90 p-1.5 pr-3 text-slate-700 shadow-[0_16px_42px_-28px_rgba(15,23,42,0.65)] backdrop-blur transition hover:-translate-y-0.5 hover:border-sky-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
        }
      >
        {resolvedPhoto ? (
          <img
            src={resolvedPhoto}
            alt={displayName}
            className={isAvatar ? "h-full w-full rounded-full border border-slate-200 object-cover" : isHeader ? "h-10 w-10 rounded-md object-cover" : "h-9 w-9 rounded-full border border-slate-200 object-cover"}
          />
        ) : isFaculty || isAdmin ? (
          <span className={isAvatar ? "flex h-full w-full items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-600" : isHeader ? "flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-slate-100 text-slate-600" : "flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-600"}>
            <UserRound size={isAvatar ? 26 : isHeader ? 20 : 18} />
          </span>
        ) : (
          <span className={isAvatar ? "flex h-full w-full items-center justify-center rounded-full bg-[linear-gradient(135deg,_#0f766e_0%,_#2563eb_100%)] text-base font-bold text-white" : isHeader ? "flex h-10 w-10 items-center justify-center rounded-md bg-[linear-gradient(135deg,_#0f766e_0%,_#2563eb_100%)] text-sm font-bold text-white" : "flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,_#0f766e_0%,_#2563eb_100%)] text-xs font-bold text-white"}>
            {initials}
          </span>
        )}
        {isHeader && (
          <span className="hidden min-w-0 truncate text-sm font-semibold text-slate-900 sm:inline-block">{roleLabel}</span>
        )}
        <ChevronDown
          size={isAvatar ? 14 : 16}
          className={`${isAvatar ? "absolute -bottom-0.5 -right-0.5 rounded-full border border-white bg-slate-900 p-0.5 text-white shadow-sm" : "text-slate-400"} transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+10px)] z-[110] w-[min(320px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_-34px_rgba(15,23,42,0.55)]">
          <div className="bg-[linear-gradient(135deg,_#f8fafc_0%,_#ecfeff_55%,_#fef9c3_100%)] p-4">
            <div className="flex items-center gap-3">
              {resolvedPhoto ? (
                <img
                  src={resolvedPhoto}
                  alt={displayName}
                  className="h-14 w-14 rounded-full border border-white object-cover shadow-sm"
                />
              ) : isFaculty || isAdmin ? (
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm">
                  <UserRound size={26} />
                </span>
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white shadow-sm">
                  {initials}
                </span>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-base font-semibold text-slate-950">
                    {displayName}
                  </p>
                  {/* small edit icon to toggle campus editor for admins */}
                  {String(roleLabel || "").toUpperCase() === "ADMIN" ? (
                    <button
                      type="button"
                      onClick={() => setEditingCampus((s) => !s)}
                      aria-label={editingCampus ? "Cancel campus edit" : "Edit campus profile"}
                      className="rounded-full p-1 text-slate-600 hover:bg-slate-100"
                    >
                      <Edit size={14} />
                    </button>
                  ) : null}
                  {isFaculty ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingFacultyPhoto((value) => !value);
                        setFacultyPhotoMsg(null);
                        setFacultyPhotoErr(null);
                      }}
                      aria-label={editingFacultyPhoto ? "Cancel faculty photo edit" : "Update faculty photo"}
                      className="rounded-full p-1 text-slate-600 hover:bg-slate-100"
                    >
                      <Camera size={14} />
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-sky-100 bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                  <ShieldCheck size={12} />
                  {roleLabel}
                </p>

                {/* Inline campus editor shown in the top section when toggled */}
                {editingCampus && String(roleLabel || "").toUpperCase() === "ADMIN" ? (
                  <div className="mt-3 space-y-2">
                    <label className="text-xs text-slate-600">Campus Name</label>
                    <input
                      value={campusName}
                      onChange={(e) => setCampusName(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder="College name"
                    />

                    <label className="text-xs text-slate-600">Campus Photo URL</label>
                    <input
                      value={campusPhoto}
                      onChange={(e) => setCampusPhoto(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder="https://.../logo.jpg"
                    />

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setCampusErr(null);
                          setCampusMsg(null);
                          setSavingCampus(true);
                          try {
                            const res: any = await apiClient.updateAdminProfile({
                              collegeName: campusName || null,
                              profilePhotoUrl: campusPhoto || null,
                            });
                            if (!res?.ok) {
                              setCampusErr(res?.error || "Failed to save campus profile.");
                            } else {
                              updateCurrentUser({
                                collegeName: String(res?.admin?.collegeName || campusName || "").trim(),
                                profilePhotoUrl: String(res?.admin?.profilePhotoUrl || campusPhoto || "").trim() || null,
                              });
                              setCampusMsg("Saved");
                              setEditingCampus(false);
                            }
                          } catch (err: any) {
                            setCampusErr(err?.message || "Failed to save campus profile.");
                          } finally {
                            setSavingCampus(false);
                          }
                        }}
                        disabled={savingCampus}
                        className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        {savingCampus ? "Saving..." : "Save"}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEditingCampus(false);
                          setCampusErr(null);
                          setCampusMsg(null);
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                      >
                        Cancel
                      </button>
                    </div>

                    {campusMsg && <div className="text-xs text-emerald-700">{campusMsg}</div>}
                    {campusErr && <div className="text-xs text-rose-700">{campusErr}</div>}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-2 p-3">
            <div className="flex min-w-0 items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
              <Mail size={16} className="shrink-0 text-slate-400" />
              <span className="truncate">{email}</span>
            </div>
            <div className="flex min-w-0 items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
              {isStudent ? (
                <GraduationCap size={16} className="shrink-0 text-slate-400" />
              ) : (
                <UserRound size={16} className="shrink-0 text-slate-400" />
              )}
              <span className="truncate">
                {isStudent
                  ? enrollmentNo || "USN not available"
                  : `${roleLabel} account`}
              </span>
            </div>
            {isFaculty && editingFacultyPhoto ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <LivePhotoCapture
                  value={facultyPhoto}
                  onChange={(nextValue) => {
                    setFacultyPhoto(nextValue);
                    setFacultyPhotoMsg(null);
                    setFacultyPhotoErr(null);
                  }}
                  disabled={savingFacultyPhoto}
                  compactMode
                  enableFaceQuality
                  title="Faculty Profile Photo"
                  description="Capture a clear front-camera photo for your faculty profile button."
                />
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const nextPhoto = String(facultyPhoto || "").trim();
                      if (!nextPhoto) {
                        setFacultyPhotoErr("Capture a photo first.");
                        return;
                      }

                      setFacultyPhotoErr(null);
                      setFacultyPhotoMsg(null);
                      setSavingFacultyPhoto(true);
                      try {
                        const res: any = await apiClient.updateFacultyProfile({
                          profilePhotoUrl: nextPhoto,
                        });
                        if (!res?.ok) {
                          setFacultyPhotoErr(res?.error || "Failed to save profile photo.");
                          return;
                        }

                        const savedPhoto = String(res?.faculty?.profilePhotoUrl || nextPhoto).trim();
                        updateCurrentUser({
                          facultyProfilePhotoUrl: savedPhoto,
                        });
                        setFacultyPhoto(savedPhoto);
                        setFacultyPhotoMsg("Saved");
                        setEditingFacultyPhoto(false);
                      } catch (err: any) {
                        setFacultyPhotoErr(err?.message || "Failed to save profile photo.");
                      } finally {
                        setSavingFacultyPhoto(false);
                      }
                    }}
                    disabled={savingFacultyPhoto || !facultyPhoto}
                    className="flex-1 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {savingFacultyPhoto ? "Saving..." : "Save Photo"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingFacultyPhoto(false);
                      setFacultyPhoto(String(photoUrl || user?.facultyProfilePhotoUrl || "").trim());
                      setFacultyPhotoErr(null);
                      setFacultyPhotoMsg(null);
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                  >
                    Cancel
                  </button>
                </div>
                {facultyPhotoMsg && <div className="mt-2 text-xs text-emerald-700">{facultyPhotoMsg}</div>}
                {facultyPhotoErr && <div className="mt-2 text-xs text-rose-700">{facultyPhotoErr}</div>}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void onLogout();
              }}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-700 transition hover:border-rose-200 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
            >
              <LogOut size={16} />
              Logout
            </button>

            {/* Admin campus editor moved to top (toggle via edit icon) */}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ProfileMenu;
