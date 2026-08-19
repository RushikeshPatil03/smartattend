// src/components/ErrorBoundary.tsx
import React, { Component, ErrorInfo, ReactNode } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught SmartAttend application error:", error, errorInfo);

    // If it's a dynamic module or context initialization error from a stale deployment cache, auto-reload once
    const errorMsg = error?.message || "";
    const isChunkOrInitError =
      errorMsg.includes("dynamically imported module") ||
      errorMsg.includes("createContext") ||
      errorMsg.includes("Loading chunk") ||
      errorMsg.includes("Failed to fetch");

    if (isChunkOrInitError) {
      const reloaded = sessionStorage.getItem("smartattend_error_autoreload");
      if (!reloaded) {
        sessionStorage.setItem("smartattend_error_autoreload", "true");
        window.location.reload();
      }
    }
  }

  private handleHardReload = () => {
    try {
      sessionStorage.clear();
      if ("caches" in window) {
        caches.keys().then((names) => {
          names.forEach((name) => caches.delete(name));
        });
      }
    } catch (e) {
      console.warn("Could not clear caches:", e);
    }
    window.location.href = "/";
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-[#070b14] text-slate-100 flex flex-col items-center justify-center p-6 text-center select-none">
          <div className="max-w-md w-full rounded-3xl border border-white/20 bg-white/95 p-8 shadow-2xl backdrop-blur-2xl text-slate-900 space-y-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 mx-auto">
              <AlertTriangle size={28} />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-black tracking-tight text-slate-900">
                Application Updated
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                A new version of SmartAttend has been deployed. Please reload to load the latest verified session.
              </p>
            </div>

            <button
              type="button"
              onClick={this.handleHardReload}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-600 py-3.5 px-5 text-sm font-bold text-white shadow-lg hover:shadow-xl hover:brightness-105 active:scale-[0.98] transition-all cursor-pointer"
            >
              <RefreshCw size={16} />
              <span>Reload SmartAttend</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
