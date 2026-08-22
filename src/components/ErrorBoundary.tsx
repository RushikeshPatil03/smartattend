// src/components/ErrorBoundary.tsx
import React, { Component, ErrorInfo, ReactNode } from "react";
import { RefreshCw, AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, showDetails: false };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught SmartAttend application error:", error, errorInfo);

    // If it's a dynamic module or chunk loading error from an updated build, auto-reload once safely
    const errorMsg = error?.message || "";
    const isChunkError =
      errorMsg.includes("dynamically imported module") ||
      errorMsg.includes("Loading chunk") ||
      errorMsg.includes("Failed to fetch dynamically imported module");

    if (isChunkError) {
      const reloaded = sessionStorage.getItem("smartattend_chunk_autoreload");
      if (!reloaded) {
        sessionStorage.setItem("smartattend_chunk_autoreload", "true");
        window.location.reload();
      }
    }
  }

  private handleHardReload = () => {
    try {
      sessionStorage.removeItem("smartattend_chunk_autoreload");
      sessionStorage.removeItem("smartattend_error_autoreload");
      sessionStorage.removeItem("retry-chunk-refreshed");
      if ("caches" in window) {
        caches.keys().then((names) => {
          names.forEach((name) => caches.delete(name));
        });
      }
    } catch (e) {
      console.warn("Could not clear caches:", e);
    }
    window.location.reload();
  };

  private handleReset = () => {
    try {
      sessionStorage.clear();
    } catch {
      // Ignore storage errors
    }
    this.setState({ hasError: false, error: null, showDetails: false });
    window.location.href = "/login";
  };

  public render() {
    if (this.state.hasError) {
      const errorMsg = this.state.error?.message || "An unexpected error occurred.";

      return (
        <div className="min-h-screen w-full bg-[#070b14] text-slate-100 flex flex-col items-center justify-center p-6 text-center select-none">
          {/* Ambient Background Glow */}
          <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.18)_0%,rgba(16,185,129,0.12)_45%,transparent_70%)] blur-3xl" />
          </div>

          <div className="relative z-10 max-w-md w-full rounded-[32px] border border-white/20 bg-white/95 p-8 shadow-2xl backdrop-blur-2xl text-slate-900 space-y-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 border border-amber-200 text-amber-600 mx-auto shadow-sm">
              <AlertTriangle size={28} />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-black tracking-tight text-slate-900">
                Application Recovery
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                SmartAttend encountered a temporary runtime state. Reload the application or return to the login screen.
              </p>
            </div>

            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={this.handleHardReload}
                className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 py-3.5 px-5 text-sm font-extrabold text-white shadow-[0_8px_24px_-4px_rgba(16,185,129,0.4)] hover:brightness-105 active:scale-[0.98] transition-all cursor-pointer"
              >
                <RefreshCw size={16} />
                <span>Reload Application</span>
              </button>

              <button
                type="button"
                onClick={this.handleReset}
                className="w-full flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-slate-100 py-3 px-5 text-xs font-bold text-slate-700 transition cursor-pointer"
              >
                <span>Return to Login</span>
                <ArrowRight size={14} />
              </button>
            </div>

            {/* Optional Details Toggle */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => this.setState((prev) => ({ showDetails: !prev.showDetails }))}
                className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 transition underline cursor-pointer"
              >
                {this.state.showDetails ? "Hide Error Details" : "View Technical Details"}
              </button>

              {this.state.showDetails && (
                <div className="mt-3 text-left rounded-xl bg-slate-950 p-3 text-[11px] font-mono text-emerald-400 overflow-x-auto max-h-36">
                  {errorMsg}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

