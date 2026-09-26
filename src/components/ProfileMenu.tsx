import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  GraduationCap,
  LogOut,
  Mail,
  ShieldCheck,
  UserRound,
  Edit,
  Camera,
  BookOpen,
  Award,
  Building2,
  TrendingUp,
  RefreshCw,
  Upload,
  X as XIcon,
  Trash2,
  Link as LinkIcon,
  Check,
} from "lucide-react";
import { useApp } from "../store";
import apiClient from "../services/apiClient";
import LivePhotoCapture from "./LivePhotoCapture";

/**
 * Uses browser-native HTMLCanvasElement to resize and compress a logo image.
 * Constrains dimensions to maximum 512x512 while maintaining aspect ratio.
 * Preserves PNG transparency if alpha channel is detected; otherwise uses WebP or JPEG.
 */
function processLogoFile(file: File): Promise<{ dataUrl: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    if (!file) {
      return reject(new Error("No file selected."));
    }

    const validMimes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!validMimes.includes(file.type.toLowerCase())) {
      return reject(new Error("Unsupported file format. Please choose a PNG, JPEG, or WebP image."));
    }

    if (file.size > 10 * 1024 * 1024) {
      return reject(new Error("File is too large. Please select an image under 10MB."));
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read the selected image file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image. The file may be corrupt."));
      img.onload = () => {
        try {
          const maxDim = 512;
          let width = img.naturalWidth || img.width;
          let height = img.naturalHeight || img.height;

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement("canvas");
          canvas.width = Math.max(width, 1);
          canvas.height = Math.max(height, 1);
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) {
            return reject(new Error("Browser does not support 2D canvas processing."));
          }

          ctx.drawImage(img, 0, 0, width, height);

          let isTransparent = false;
          if (file.type.toLowerCase() === "image/png") {
            try {
              const imgData = ctx.getImageData(0, 0, width, height).data;
              for (let i = 3; i < imgData.length; i += 4) {
                if (imgData[i] < 250) {
                  isTransparent = true;
                  break;
                }
              }
            } catch {
              isTransparent = true;
            }
          }

          let outputMime = "image/jpeg";
          let quality: number | undefined = 0.88;

          if (isTransparent) {
            outputMime = "image/png";
            quality = undefined;
          } else {
            const testWebp = canvas.toDataURL("image/webp");
            if (testWebp.startsWith("data:image/webp")) {
              outputMime = "image/webp";
            }
          }

          const dataUrl = canvas.toDataURL(outputMime, quality);
          resolve({ dataUrl, mimeType: outputMime });
        } catch (err: any) {
          reject(new Error(err?.message || "Failed to process logo image on canvas."));
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

type ProfileMenuProps = {
  user?: any;
  roleLabel: string;
  onLogout: () => void | Promise<void>;
  photoUrl?: string | null;
  variant?: "header" | "default" | "avatar";
  onOpenAcademicAttendance?: () => void;
  onOpenActivities?: () => void;
  onOpenProfileModal?: (tab?: "academics" | "activities" | "profile") => void;
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
  onOpenAcademicAttendance,
  onOpenActivities,
  onOpenProfileModal,
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
        ? photoUrl || user?.profilePhotoUrl || user?.adminProfilePhotoUrl || ""
      : photoUrl || user?.profilePhotoUrl || user?.studentProfilePhotoUrl || ""
  ).trim();
  const initials = useMemo(() => getInitials(displayName), [displayName]);
  const { updateCurrentUser, departments = [] } = useApp();

  const deptCode = useMemo(() => {
    if (user?.departmentCode) return String(user.departmentCode).toUpperCase();
    const rawDept = String(user?.departmentName || user?.department?.name || user?.department?.code || user?.department || "").trim();
    if (!rawDept) return "";
    const matched = departments.find(
      (d: any) =>
        String(d.id) === rawDept ||
        String(d.code).toUpperCase() === rawDept.toUpperCase() ||
        String(d.name).toUpperCase() === rawDept.toUpperCase()
    );
    if (matched?.code) return String(matched.code).toUpperCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawDept)) {
      if (rawDept.length <= 8) return rawDept.toUpperCase();
      const words = rawDept.replace(/[()]/g, "").split(/\s+/).filter(Boolean);
      if (words.length > 1) {
        return words.map(w => w[0]).join("").toUpperCase();
      }
      return rawDept.slice(0, 6).toUpperCase();
    }
    return "";
  }, [user?.departmentCode, user?.departmentName, user?.department, departments]);

  const studentCohortSummary = useMemo(() => {
    const sem = user?.semester != null ? user.semester : 1;
    const sec = user?.section || "A";
    if (deptCode) {
      return `${deptCode} · Sem ${sem} · Sec ${sec}`;
    }
    return `Sem ${sem} · Sec ${sec}`;
  }, [deptCode, user?.semester, user?.section]);

  // Local editor state for college profile (admin-only)
  const [editingCampus, setEditingCampus] = useState(false);
  const [campusName, setCampusName] = useState<string>(String(user?.collegeName || "").trim());
  const [campusPhoto, setCampusPhoto] = useState<string>(String(photoUrl || user?.profilePhotoUrl || "").trim());
  const [selectedLogoPreview, setSelectedLogoPreview] = useState<string | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [logoInputMode, setLogoInputMode] = useState<"file" | "url">("file");
  const [urlInputValue, setUrlInputValue] = useState<string>(String(photoUrl || user?.profilePhotoUrl || "").trim());
  const [savingCampus, setSavingCampus] = useState(false);
  const [campusMsg, setCampusMsg] = useState<string | null>(null);
  const [campusErr, setCampusErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [editingFacultyPhoto, setEditingFacultyPhoto] = useState(false);
  const [facultyPhoto, setFacultyPhoto] = useState<string>(String(photoUrl || user?.facultyProfilePhotoUrl || "").trim());
  const [savingFacultyPhoto, setSavingFacultyPhoto] = useState(false);
  const [facultyPhotoMsg, setFacultyPhotoMsg] = useState<string | null>(null);
  const [facultyPhotoErr, setFacultyPhotoErr] = useState<string | null>(null);

  useEffect(() => {
    setCampusName(String(user?.collegeName || "").trim());
    const currentLogo = String(photoUrl || user?.profilePhotoUrl || "").trim();
    setCampusPhoto(currentLogo);
    if (!editingCampus) {
      setSelectedLogoPreview(null);
      setLogoRemoved(false);
      setUrlInputValue(currentLogo);
    }
  }, [user?.collegeName, photoUrl, user?.profilePhotoUrl, editingCampus]);

  const resetCampusEditor = () => {
    setCampusName(String(user?.collegeName || "").trim());
    const currentLogo = String(photoUrl || user?.profilePhotoUrl || "").trim();
    setCampusPhoto(currentLogo);
    setSelectedLogoPreview(null);
    setLogoRemoved(false);
    setLogoInputMode("file");
    setUrlInputValue(currentLogo);
    setCampusMsg(null);
    setCampusErr(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setEditingCampus(false);
  };

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCampusErr(null);
    setCampusMsg(null);
    try {
      const { dataUrl } = await processLogoFile(file);
      setSelectedLogoPreview(dataUrl);
      setLogoRemoved(false);
    } catch (err: any) {
      setCampusErr(err?.message || "Failed to process selected file.");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const activeLogoPreview = useMemo(() => {
    if (logoRemoved) return null;
    if (selectedLogoPreview) return selectedLogoPreview;
    if (logoInputMode === "url" && urlInputValue.trim()) return urlInputValue.trim();
    if (campusPhoto) return campusPhoto;
    return null;
  }, [logoRemoved, selectedLogoPreview, logoInputMode, urlInputValue, campusPhoto]);

  const handleSaveCampus = async () => {
    setCampusErr(null);
    setCampusMsg(null);

    const trimmedName = campusName.trim();
    if (!trimmedName) {
      setCampusErr("Institution name cannot be empty.");
      return;
    }
    if (trimmedName.length > 255) {
      setCampusErr("Institution name cannot exceed 255 characters.");
      return;
    }

    setSavingCampus(true);

    let finalLogoUrl: string | null = null;
    let newStoragePath: string | null = null;

    try {
      if (logoRemoved) {
        finalLogoUrl = null;
      } else if (selectedLogoPreview) {
        // Upload local compressed image first
        const uploadRes: any = await apiClient.uploadAdminLogo({
          image: selectedLogoPreview,
        });

        if (!uploadRes?.ok || !uploadRes?.url) {
          setCampusErr(uploadRes?.error || "Failed to upload logo image. Institution name was not changed.");
          setSavingCampus(false);
          return;
        }

        finalLogoUrl = uploadRes.url;
        newStoragePath = uploadRes.storagePath || null;
      } else if (logoInputMode === "url" && urlInputValue.trim()) {
        const cleanUrl = urlInputValue.trim();
        if (!/^https?:\/\//i.test(cleanUrl)) {
          setCampusErr("Logo URL must be a valid HTTP or HTTPS address.");
          setSavingCampus(false);
          return;
        }
        finalLogoUrl = cleanUrl;
      } else {
        finalLogoUrl = campusPhoto || null;
      }

      const res: any = await apiClient.updateAdminProfile({
        collegeName: trimmedName,
        profilePhotoUrl: finalLogoUrl,
        newStoragePath,
      });

      if (!res?.ok) {
        setCampusErr(res?.error || "Failed to save institution profile.");
        return;
      }

      const savedName = String(res?.admin?.collegeName || trimmedName).trim();
      const savedPhoto = String(res?.admin?.profilePhotoUrl || "").trim() || null;

      updateCurrentUser({
        collegeName: savedName,
        profilePhotoUrl: savedPhoto,
      });

      setCampusName(savedName);
      setCampusPhoto(savedPhoto || "");
      setSelectedLogoPreview(null);
      setLogoRemoved(false);
      setUrlInputValue(savedPhoto || "");

      setCampusMsg("Profile saved successfully.");
      setTimeout(() => {
        setEditingCampus(false);
        setCampusMsg(null);
      }, 1000);
    } catch (err: any) {
      setCampusErr(err?.message || "Failed to save institution profile.");
    } finally {
      setSavingCampus(false);
    }
  };

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
        <div
          className={`absolute right-0 top-[calc(100%+10px)] z-[110] ${
            editingCampus && isAdmin
              ? "w-[min(360px,calc(100vw-24px))]"
              : "w-[min(320px,calc(100vw-32px))]"
          } overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_-34px_rgba(15,23,42,0.55)] transition-all`}
        >
          <div className="bg-[linear-gradient(135deg,_#f8fafc_0%,_#ecfeff_55%,_#fef9c3_100%)] p-4">
            <div className="flex items-center gap-3">
              {resolvedPhoto ? (
                <img
                  src={resolvedPhoto}
                  alt={displayName}
                  className="h-14 w-14 rounded-full border border-white object-cover shadow-sm"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = "/icon-192.png?v=5";
                  }}
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
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-base font-semibold text-slate-950">
                    {displayName}
                  </p>
                  {/* small edit icon to toggle campus editor for admins */}
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (editingCampus) {
                          resetCampusEditor();
                        } else {
                          setEditingCampus(true);
                        }
                      }}
                      title={editingCampus ? "Cancel edit" : "Edit institution profile"}
                      aria-label={editingCampus ? "Cancel institution edit" : "Edit institution profile"}
                      className="rounded-full p-1.5 text-slate-600 hover:bg-white/80 hover:text-slate-900 transition"
                    >
                      {editingCampus ? <XIcon size={14} /> : <Edit size={14} />}
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
              </div>
            </div>

            {/* Inline campus editor shown in the top section when toggled */}
            {editingCampus && isAdmin ? (
              <div className="mt-4 rounded-xl border border-sky-200/70 bg-white/95 p-3.5 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wide">
                    <Building2 size={13} className="text-sky-600" />
                    <span>Institution Settings</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">Public Branding</span>
                </div>

                {/* College / Institution Name Field */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Institution Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={campusName}
                    onChange={(e) => {
                      setCampusName(e.target.value);
                      if (campusErr) setCampusErr(null);
                    }}
                    maxLength={255}
                    disabled={savingCampus}
                    placeholder="Enter official college name"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-medium text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:opacity-60 transition"
                  />
                  <div className="mt-1 flex justify-end">
                    <span className="text-[10px] text-slate-400">{campusName.trim().length}/255</span>
                  </div>
                </div>

                {/* Institution Logo Picker & Preview */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Institution Logo
                  </label>
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-inner">
                      {activeLogoPreview ? (
                        <img
                          src={activeLogoPreview}
                          alt="Logo preview"
                          className="h-full w-full object-contain p-1"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src = "/icon-192.png?v=5";
                          }}
                        />
                      ) : (
                        <Building2 size={24} className="text-slate-300" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleLogoFileChange}
                        disabled={savingCampus}
                        className="sr-only"
                        id="admin-institution-logo-input"
                      />
                      <div className="flex flex-wrap items-center gap-1.5">
                        <label
                          htmlFor="admin-institution-logo-input"
                          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:border-slate-300 transition ${
                            savingCampus ? "pointer-events-none opacity-50" : ""
                          }`}
                        >
                          <Upload size={12} className="text-sky-600" />
                          <span>{activeLogoPreview ? "Change File" : "Choose File"}</span>
                        </label>
                        {activeLogoPreview ? (
                          <button
                            type="button"
                            onClick={() => {
                              setLogoRemoved(true);
                              setSelectedLogoPreview(null);
                              setUrlInputValue("");
                              if (fileInputRef.current) fileInputRef.current.value = "";
                            }}
                            disabled={savingCampus}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200/70 bg-rose-50/70 px-2 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition"
                          >
                            <Trash2 size={12} />
                            <span>Remove</span>
                          </button>
                        ) : null}
                      </div>
                      <p className="text-[10px] text-slate-400">PNG, JPEG, or WebP. Auto-optimized to 512x512.</p>
                    </div>
                  </div>

                  {/* Remote URL toggle option */}
                  <div className="mt-2.5 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setLogoInputMode((m) => (m === "file" ? "url" : "file"))}
                      disabled={savingCampus}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600 hover:text-sky-800 transition"
                    >
                      <LinkIcon size={11} />
                      <span>{logoInputMode === "file" ? "Or enter HTTPS image URL" : "Switch to device file upload"}</span>
                    </button>
                    {logoInputMode === "url" ? (
                      <input
                        type="url"
                        value={urlInputValue}
                        onChange={(e) => {
                          setUrlInputValue(e.target.value);
                          setLogoRemoved(false);
                          if (campusErr) setCampusErr(null);
                        }}
                        disabled={savingCampus}
                        placeholder="https://.../institution-logo.png"
                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />
                    ) : null}
                  </div>
                </div>

                {/* Save and Cancel buttons */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleSaveCampus}
                    disabled={savingCampus}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 active:scale-[0.98] disabled:opacity-60 transition"
                  >
                    {savingCampus ? (
                      <>
                        <RefreshCw size={12} className="animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Check size={12} />
                        <span>Save Changes</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={resetCampusEditor}
                    disabled={savingCampus}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                  >
                    Cancel
                  </button>
                </div>

                {campusMsg ? (
                  <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-200/60 animate-fade-in">
                    <Check size={12} className="shrink-0" />
                    <span>{campusMsg}</span>
                  </div>
                ) : null}
                {campusErr ? (
                  <div className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 border border-rose-200/60">
                    {campusErr}
                  </div>
                ) : null}
              </div>
            ) : null}
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

            {isStudent && (
              <div className="flex min-w-0 items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                <Building2 size={16} className="shrink-0 text-slate-400" />
                <span className="truncate font-medium">
                  {studentCohortSummary}
                </span>
              </div>
            )}

            {isStudent && (
              <div className="pt-2 pb-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenAcademicAttendance?.();
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-xl bg-indigo-50/90 hover:bg-indigo-100/90 px-3 py-2 text-xs font-semibold text-indigo-700 transition cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <TrendingUp size={15} className="text-indigo-600" />
                    <span>My Attendance</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-500 bg-white/80 px-1.5 py-0.5 rounded-md border border-indigo-200/60">
                      View
                    </span>
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full border border-indigo-200/60 bg-white/90 text-indigo-500 hover:text-indigo-700 hover:bg-white transition"
                      title="Sync and view My Attendance"
                    >
                      <RefreshCw size={10} />
                    </span>
                  </div>
                </button>
              </div>
            )}
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
