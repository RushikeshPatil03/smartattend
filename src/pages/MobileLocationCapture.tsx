import React, { useEffect, useMemo, useState } from "react";
import { Button, Card } from "../components/Common";
import { CheckCircle, MapPin, RefreshCw, Smartphone, XCircle } from "lucide-react";
import apiClient from "../services/apiClient";
import { getLiveLocationWithOptions } from "../utils/liveLocation";

const MobileLocationCapture: React.FC = () => {
  const params = useMemo(
    () => new URLSearchParams(window.location.search),
    []
  );
  const token = String(params.get("token") || "").trim();

  const [status, setStatus] = useState<"idle" | "capturing" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState(false);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!token) {
        setStatus("error");
        setMessage("Missing mobile location token.");
        return;
      }

      const res: any = await apiClient.getPublicMobileLocationCapture(token);
      if (cancelled) return;
      if (!res?.ok) {
        setExpired(true);
        setStatus("error");
        setMessage(res?.error || "This location capture request is not available.");
        return;
      }
      if (res.status === "captured") {
        setStatus("success");
        setMessage("Location already captured for this session.");
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const shareLocation = async () => {
    if (!token) return;
    setStatus("capturing");
    setAttempts((value) => value + 1);
    setMessage("Getting precise GPS. Keep this tab open and hold the phone still...");

    try {
      const coords = await getLiveLocationWithOptions({
        preferCached: false,
        maxAgeMs: 15000,
        timeoutMs: 15000,
      });
      const res: any = await apiClient.submitPublicMobileLocationCapture(token, {
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy,
        deviceLabel:
          `${navigator.platform || "mobile"} | ${navigator.userAgent || "browser"}`.slice(0, 180),
      });
      if (!res?.ok) {
        throw new Error(res?.error || "Failed to submit location.");
      }
      setStatus("success");
      setMessage(
        `Location shared successfully. Accuracy ~${Math.round(coords.accuracy)}m. You can return to the faculty screen.`
      );
    } catch (err: any) {
      setStatus("error");
      setMessage(
        err?.message ||
          "Unable to share location. Enable precise location, step near a window, and retry."
      );
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <Card className="text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-teal-100 text-teal-700">
          <Smartphone size={30} />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Share Mobile Location</h1>
        <p className="mt-2 text-sm text-slate-500">
          Use this phone GPS to send accurate session coordinates to the faculty screen.
        </p>

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          {status === "success" ? (
            <CheckCircle size={28} className="mx-auto text-green-600" />
          ) : status === "error" ? (
            <XCircle size={28} className="mx-auto text-red-600" />
          ) : (
            <MapPin size={28} className="mx-auto text-teal-600" />
          )}
          <p className="mt-3 text-sm text-slate-700">
            {message || "Tap below to capture and send this phone's live location."}
            {status === "error" && !expired && attempts > 0 ? (
              <span className="mt-2 block text-xs text-slate-500">
                Attempt {attempts}. You can retry without requesting a new link.
              </span>
            ) : null}
          </p>
        </div>

        <div className="mt-6">
          {status !== "success" && !expired ? (
            <Button onClick={shareLocation} disabled={status === "capturing"} className="w-full">
              {status === "capturing" ? (
                <>
                  <RefreshCw size={16} className="animate-spin" /> Capturing...
                </>
              ) : (
                <>
                  <MapPin size={16} /> {status === "error" ? "Retry Location" : "Share This Phone Location"}
                </>
              )}
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
};

export default MobileLocationCapture;
