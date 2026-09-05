import React, { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import QRCode from "react-qr-code";
import {
  MapPin,
  Crosshair,
  Smartphone,
  Play,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Sparkles,
  Building2,
  BookOpen,
  Calendar,
  Layers,
  Clock,
  Trash2,
  Shield,
  Navigation,
  Compass,
} from "lucide-react";
import { Button } from "../../components/Common";
import { RecentClassPreset } from "./types";

interface SessionSetupCardProps {
  departments: any[];
  mySubjects: any[];
  filteredSubjects: any[];
  formDepartment: string;
  formYear: string;
  formSem: string;
  formSection: string;
  formSubject: string;
  formRadius: string;
  locationState: { lat: number; lng: number } | null;
  isLocationConfirmed: boolean;
  manualLat: string;
  manualLng: string;
  showManualLocation: boolean;
  locating: boolean;
  locationError: string;
  sessionError: string;
  startLoading: boolean;
  mobileLocateLoading: boolean;
  mobileLocateToken: string | null;
  mobileLocateStatus: string;
  mobileLocateExpiresAt: number | null;
  mobileLocateUrl: string;
  capturedLocationLabel: string;
  capturedLocationMapUrl: string;
  recentClassCards: RecentClassPreset[];
  setFormDepartment: (val: string) => void;
  setFormYear: (val: string) => void;
  setFormSem: (val: string) => void;
  setFormSection: (val: string) => void;
  setFormSubject: (val: string) => void;
  setFormRadius: (val: string) => void;
  setManualLat: (val: string) => void;
  setManualLng: (val: string) => void;
  onCaptureLocation: () => void;
  onStartLocateViaMobile: () => Promise<void>;
  onCloseMobileLocate: () => void;
  onSetManualLocation: () => void;
  onShowManualLocationEditor: () => void;
  onOpenCapturedLocationInMaps: () => void;
  onApplyRecentClass: (preset: RecentClassPreset) => void;
  onRemoveRecentClass: (presetKey: string) => void;
  onResetConfirmedLocation: () => void;
  onStartSession: () => Promise<void>;
}

const YEAR_OPTIONS = ["1", "2", "3", "4"] as const;
const SEMESTER_OPTIONS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;
const SECTION_OPTIONS = ["A", "B", "C", "D"] as const;

export const SessionSetupCard: React.FC<SessionSetupCardProps> = React.memo(({
  departments,
  filteredSubjects,
  formDepartment,
  formYear,
  formSem,
  formSection,
  formSubject,
  formRadius,
  locationState,
  isLocationConfirmed,
  manualLat,
  manualLng,
  showManualLocation,
  locating,
  locationError,
  sessionError,
  startLoading,
  mobileLocateLoading,
  mobileLocateToken,
  mobileLocateStatus,
  mobileLocateExpiresAt,
  mobileLocateUrl,
  capturedLocationLabel,
  recentClassCards,
  setFormDepartment,
  setFormYear,
  setFormSem,
  setFormSection,
  setFormSubject,
  setFormRadius,
  setManualLat,
  setManualLng,
  onCaptureLocation,
  onStartLocateViaMobile,
  onCloseMobileLocate,
  onSetManualLocation,
  onShowManualLocationEditor,
  onOpenCapturedLocationInMaps,
  onApplyRecentClass,
  onRemoveRecentClass,
  onResetConfirmedLocation,
  onStartSession,
}) => {
  const isFormValid = Boolean(
    formDepartment &&
      formSubject &&
      locationState &&
      isLocationConfirmed &&
      Number(formRadius) > 0
  );

  return (
    <div className="space-y-6">
      {/* 1-Tap Quick Class Launch Presets */}
      {recentClassCards.length > 0 && (
        <div className="rounded-3xl border border-emerald-500/20 bg-gradient-to-r from-emerald-950/5 via-slate-900/5 to-teal-950/5 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl border-l-4 border-l-emerald-500">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200/60 mb-3.5">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 shadow-2xs">
                <Sparkles size={15} />
              </div>
              <div>
                <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                  1-Tap Class Presets
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.2 text-[10px] font-black text-emerald-700">
                    FAST LAUNCH
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500">Restore subject, section, and GPS lock in under 3 seconds</p>
              </div>
            </div>
            <span className="text-[11px] font-semibold text-emerald-700/80 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200/60 hidden sm:inline-block">
              1-Click Ready
            </span>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {recentClassCards.map((preset) => {
              const isSelected =
                Boolean(formDepartment && formSubject) &&
                String(preset.departmentId) === String(formDepartment) &&
                String(preset.year) === String(formYear) &&
                String(preset.semester) === String(formSem) &&
                String(preset.section || "").trim().toUpperCase() ===
                  String(formSection || "").trim().toUpperCase() &&
                String(preset.subjectId) === String(formSubject);

              // Formatted chip title, e.g., "CSE-4A • Advanced DB" or "CSE Sec A • DBMS"
              const deptCode = preset.departmentCode || preset.departmentName?.slice(0, 4)?.toUpperCase() || "CLS";
              const classChipLabel = `${deptCode}-${preset.year || ""}${preset.section || ""}`.trim();

              return (
                <div
                  key={preset.key}
                  className={`group relative flex items-center gap-2 rounded-2xl border p-2 pr-3 transition-all duration-200 backdrop-blur-xs ${
                    isSelected
                      ? "border-emerald-500/90 bg-emerald-50/95 shadow-[0_4px_20px_rgba(16,185,129,0.18)] ring-2 ring-emerald-500/30 scale-[1.02]"
                      : "border-slate-200/90 bg-white hover:border-emerald-400 hover:shadow-sm"
                  } active:scale-[0.98]`}
                >
                  <button
                    type="button"
                    onClick={() => onApplyRecentClass(preset)}
                    disabled={!preset.available}
                    title="Apply preset & enable 1-click launch"
                    className="flex items-center gap-2.5 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      className={`flex h-8 px-2 items-center justify-center rounded-xl font-black text-[11px] shadow-2xs tracking-wide transition-all duration-200 ${
                        isSelected
                          ? "bg-gradient-to-br from-emerald-600 to-teal-600 text-white border border-emerald-600 shadow-[0_2px_8px_rgba(16,185,129,0.4)]"
                          : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 group-hover:bg-emerald-500/20"
                      }`}
                    >
                      {classChipLabel}
                    </span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p
                          className={`font-extrabold text-xs leading-tight transition-colors ${
                            isSelected
                              ? "text-emerald-950 font-black"
                              : "text-slate-800 group-hover:text-emerald-700"
                          }`}
                        >
                          {preset.label}
                        </p>
                        {isSelected && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white shadow-2xs">
                            <CheckCircle2 size={10} /> Active
                          </span>
                        )}
                      </div>
                      <p
                        className={`text-[10px] font-medium mt-0.5 transition-colors ${
                          isSelected ? "text-emerald-700 font-semibold" : "text-slate-500"
                        }`}
                      >
                        Yr {preset.year} • Sem {preset.semester} • {preset.radiusMeters}m geofence
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => onRemoveRecentClass(preset.key)}
                    title="Remove preset"
                    className={`transition-colors p-1 rounded-lg cursor-pointer ${
                      isSelected
                        ? "text-emerald-700/60 hover:text-rose-600 hover:bg-rose-50"
                        : "text-slate-400 hover:text-rose-500 hover:bg-rose-50"
                    }`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Configuration Card */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white/80 p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700 shadow-xs mb-2">
              <Sparkles size={12} className="text-emerald-600" />
              Live Session Setup
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <BookOpen size={22} className="text-emerald-600" />
              Configure Class Session
            </h2>
            <p className="text-xs text-slate-500 font-normal mt-0.5">
              Select department, course attributes, and lock the high-precision GPS geofence before starting.
            </p>
          </div>
        </div>

        {/* Input Matrix with Floating Style */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {/* Department Select */}
          <div>
            <label className="block h-5 text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1">
              <Building2 size={13} className="text-emerald-600 shrink-0" />
              Department
            </label>
            <select
              className="w-full rounded-2xl border border-slate-200/90 bg-white px-3.5 py-3 text-xs font-semibold text-slate-800 transition-all duration-200 focus:border-emerald-500/90 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 shadow-xs hover:border-slate-300"
              value={formDepartment}
              onChange={(e) => {
                setFormDepartment(e.target.value);
                setFormSubject("");
                onResetConfirmedLocation();
              }}
            >
              <option value="">-- Choose Department --</option>
              {departments.map((d: any) => (
                <option key={d._id || d.id} value={d._id || d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          {/* Year */}
          <div>
            <label className="block h-5 text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1">
              <Calendar size={13} className="text-emerald-600 shrink-0" />
              Year
            </label>
            <select
              className="w-full rounded-2xl border border-slate-200/90 bg-white px-3.5 py-3 text-xs font-semibold text-slate-800 transition-all duration-200 focus:border-emerald-500/90 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 shadow-xs hover:border-slate-300 disabled:bg-slate-100/70 disabled:text-slate-400"
              value={formYear}
              onChange={(e) => {
                setFormYear(e.target.value);
                onResetConfirmedLocation();
              }}
              disabled={!formDepartment}
            >
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </div>

          {/* Semester */}
          <div>
            <label className="block h-5 text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1">
              <Layers size={13} className="text-emerald-600 shrink-0" />
              Semester
            </label>
            <select
              className="w-full rounded-2xl border border-slate-200/90 bg-white px-3.5 py-3 text-xs font-semibold text-slate-800 transition-all duration-200 focus:border-emerald-500/90 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 shadow-xs hover:border-slate-300 disabled:bg-slate-100/70 disabled:text-slate-400"
              value={formSem}
              onChange={(e) => {
                setFormSem(e.target.value);
                onResetConfirmedLocation();
              }}
              disabled={!formDepartment}
            >
              {SEMESTER_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  Semester {s}
                </option>
              ))}
            </select>
          </div>

          {/* Section */}
          <div>
            <label className="block h-5 text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1">
              <Clock size={13} className="text-emerald-600 shrink-0" />
              Section
            </label>
            <select
              className="w-full rounded-2xl border border-slate-200/90 bg-white px-3.5 py-3 text-xs font-semibold text-slate-800 transition-all duration-200 focus:border-emerald-500/90 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 shadow-xs hover:border-slate-300 disabled:bg-slate-100/70 disabled:text-slate-400"
              value={formSection}
              onChange={(e) => {
                setFormSection(e.target.value);
                onResetConfirmedLocation();
              }}
              disabled={!formDepartment}
            >
              {SECTION_OPTIONS.map((sec) => (
                <option key={sec} value={sec}>
                  Section {sec}
                </option>
              ))}
            </select>
          </div>

          {/* Subject */}
          <div>
            <label className="block h-5 text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1">
              <BookOpen size={13} className="text-emerald-600 shrink-0" />
              Subject
            </label>
            <select
              className="w-full rounded-2xl border border-slate-200/90 bg-white px-3.5 py-3 text-xs font-semibold text-slate-800 transition-all duration-200 focus:border-emerald-500/90 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 shadow-xs hover:border-slate-300 disabled:bg-slate-100/70 disabled:text-slate-400"
              value={formSubject}
              onChange={(e) => {
                setFormSubject(e.target.value);
                onResetConfirmedLocation();
              }}
              disabled={!formDepartment}
            >
              <option value="">-- Choose Subject --</option>
              {filteredSubjects.map((s: any) => (
                <option key={s._id || s.id} value={s._id || s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>

          {/* Radius (meters) */}
          <div>
            <label className="block h-5 text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center justify-between whitespace-nowrap">
              <span className="flex items-center gap-1">
                <Crosshair size={13} className="text-emerald-600 shrink-0" />
                Radius
              </span>
              <select
                className="text-[10px] font-bold text-emerald-700 bg-emerald-50/90 border border-emerald-200/80 rounded-md px-1.5 py-0.5 outline-none hover:bg-emerald-100/80 cursor-pointer disabled:opacity-50"
                value={["50", "75", "150"].includes(String(formRadius)) ? String(formRadius) : ""}
                onChange={(e) => {
                  if (e.target.value) {
                    setFormRadius(e.target.value);
                  }
                }}
                disabled={!formDepartment}
                title="Select preset range"
              >
                <option value="" disabled>Presets</option>
                <option value="50">Class 50m</option>
                <option value="75">Lab 75m</option>
                <option value="150">Aud 150m</option>
              </select>
            </label>

            <input
              type="number"
              min={5}
              max={1000}
              className="w-full rounded-2xl border border-slate-200/90 bg-white px-3.5 py-3 text-xs font-semibold text-slate-800 transition-all duration-200 focus:border-emerald-500/90 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 shadow-xs hover:border-slate-300 disabled:bg-slate-100/70 disabled:text-slate-400"
              value={formRadius}
              onChange={(e) => setFormRadius(e.target.value)}
              disabled={!formDepartment}
              placeholder="50"
            />
          </div>
        </div>

        {/* High-Tech Geofence Visualizer Widget with GPS Accuracy Pill */}
        <div className="rounded-3xl border border-slate-200/90 bg-gradient-to-br from-slate-50/90 via-emerald-50/30 to-teal-50/30 p-5 sm:p-6 transition-all shadow-xs">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3.5">
              <div
                className={`flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl border shadow-sm transition-colors duration-300 ${
                  isLocationConfirmed
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-600 shadow-[0_0_20px_rgba(16,185,129,0.2)]"
                    : "bg-slate-100 border-slate-200 text-slate-400"
                }`}
              >
                <Compass className={`h-6 w-6 ${isLocationConfirmed ? "text-emerald-600 animate-pulse" : ""}`} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-extrabold text-sm text-slate-900 tracking-tight">
                    Geofence Boundary & GPS Anchor
                  </h4>
                  {/* Visual Geofence Status Pill: Green badge: GPS Locked (±6m Accuracy) */}
                  {isLocationConfirmed && locationState ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-[10px] font-black text-emerald-800 shadow-2xs animate-in fade-in">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      GPS Locked (±6m Accuracy)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 shadow-2xs">
                      <AlertCircle size={11} /> GPS Lock Required
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <p className="font-mono text-xs text-slate-600">
                    {locationState && isLocationConfirmed
                      ? `Anchor: ${capturedLocationLabel} (±${formRadius}m Geofence)`
                      : "Capture live GPS from laptop browser or beam high-accuracy position from phone."}
                  </p>
                  {locationState && isLocationConfirmed && (
                    <button
                      type="button"
                      onClick={onOpenCapturedLocationInMaps}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:text-emerald-800 underline decoration-emerald-500/50 underline-offset-2 cursor-pointer ml-1"
                    >
                      <ExternalLink size={12} /> View on Map
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Geofence Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={onCaptureLocation}
                disabled={locating}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:border-emerald-400 hover:bg-emerald-50/60 transition duration-200 shadow-xs cursor-pointer disabled:opacity-50"
              >
                {locating ? (
                  <>
                    <RefreshCw size={14} className="animate-spin text-emerald-600" />
                    Locking GPS...
                  </>
                ) : (
                  <>
                    <Crosshair size={14} className="text-emerald-600" />
                    Capture GPS
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onStartLocateViaMobile}
                disabled={mobileLocateLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:border-emerald-400 hover:bg-emerald-50/60 transition duration-200 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <Smartphone size={14} className="text-teal-600" />
                Locate via Phone
              </button>

              {locationState && isLocationConfirmed && (
                <button
                  type="button"
                  onClick={onShowManualLocationEditor}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  <MapPin size={13} /> Edit
                </button>
              )}
            </div>
          </div>

          {/* Mobile QR Drawer */}
          {mobileLocateToken && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 pt-4 border-t border-slate-200/80"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h5 className="font-extrabold text-xs text-slate-900">
                    Scan to Capture GPS from Mobile
                  </h5>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Open your smartphone camera to beam high-accuracy outdoor GPS coordinates.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onCloseMobileLocate}
                  className="text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  Close
                </button>
              </div>

              <div className="mt-3 flex flex-col items-center">
                <div className="rounded-2xl border-4 border-white bg-white p-3 shadow-lg">
                  <QRCode
                    value={mobileLocateUrl}
                    size={180}
                    level="M"
                    style={{ width: "100%", maxWidth: 180, height: "auto" }}
                  />
                </div>
                <p className="mt-2.5 text-xs font-semibold text-emerald-700 text-center flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                  {mobileLocateStatus || "Awaiting GPS beam from phone..."}
                </p>
                {mobileLocateExpiresAt && (
                  <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                    QR expires at {new Date(mobileLocateExpiresAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
            </motion.div>
          )}

          {/* Manual Location Inputs */}
          {showManualLocation && (
            <div className="mt-4 pt-4 border-t border-slate-200/80 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-mono"
                placeholder="Latitude (e.g. 19.0760)"
                value={manualLat}
                onChange={(e) => setManualLat(e.target.value)}
              />
              <input
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-mono"
                placeholder="Longitude (e.g. 72.8777)"
                value={manualLng}
                onChange={(e) => setManualLng(e.target.value)}
              />
              <Button
                onClick={onSetManualLocation}
                variant="secondary"
                className="text-xs rounded-xl"
              >
                <MapPin size={13} /> Save Coordinates
              </Button>
            </div>
          )}
        </div>

        {/* Error Alerts */}
        {locationError && (
          <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700 shadow-xs">
            <AlertCircle size={16} className="shrink-0" />
            <span>{locationError}</span>
          </div>
        )}
        {sessionError && (
          <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700 shadow-xs">
            <AlertCircle size={16} className="shrink-0" />
            <span>{sessionError}</span>
          </div>
        )}

        {/* Launch Session CTA Bar */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-slate-500">
            {isFormValid ? (
              <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                <CheckCircle2 size={16} /> Ready to broadcast dynamic QR attendance.
              </span>
            ) : (
              <span>Select department, subject, and lock GPS to activate session launch.</span>
            )}
          </div>

          <motion.button
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={onStartSession}
            disabled={!isFormValid || startLoading}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-9 py-3.5 text-sm font-extrabold text-white shadow-[0_12px_28px_-6px_rgba(16,185,129,0.45)] hover:shadow-[0_16px_36px_-6px_rgba(16,185,129,0.55)] hover:brightness-105 active:scale-[0.98] transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none cursor-pointer"
          >
            {startLoading ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                Initializing Session...
              </>
            ) : (
              <>
                <Play size={18} />
                Launch Live Session
              </>
            )}
          </motion.button>
        </div>
      </div>
    </div>
  );
});

SessionSetupCard.displayName = "SessionSetupCard";
export default SessionSetupCard;
