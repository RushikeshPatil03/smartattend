import React, { useEffect, useRef, useState } from "react";

export interface CountUpProps {
  value: number;
  duration?: number; // duration in ms, defaults to 600ms
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  formatFn?: (val: number) => string;
}

/**
 * useCountUp Hook - interpolates from previous value to new value over duration using requestAnimationFrame
 * Optimized for 60fps/120fps concurrency, cancellation on unmount, and reduced-motion safety.
 */
export function useCountUp(
  targetValue: number,
  duration: number = 600,
  decimals: number = 0
): number {
  const [displayValue, setDisplayValue] = useState<number>(() => targetValue);
  const prevValueRef = useRef<number>(targetValue);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const startValue = prevValueRef.current;
    const endValue = targetValue;
    prevValueRef.current = endValue;

    if (startValue === endValue || Number.isNaN(endValue)) {
      setDisplayValue(endValue);
      return;
    }

    // Respect reduced motion accessibility
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplayValue(endValue);
      return;
    }

    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / Math.max(duration, 1), 1);

      // Smooth ease-out cubic curve (starts lively, settles gently)
      const easeOutProgress = 1 - Math.pow(1 - progress, 3);
      const current = startValue + (endValue - startValue) * easeOutProgress;

      const factor = Math.pow(10, decimals);
      const rounded = Math.round(current * factor) / factor;
      setDisplayValue(rounded);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(endValue);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [targetValue, duration, decimals]);

  return displayValue;
}

/**
 * CountUp Component
 */
export const CountUp: React.FC<CountUpProps> = React.memo(({
  value,
  duration = 600,
  decimals = 0,
  prefix = "",
  suffix = "",
  className = "",
  formatFn,
}) => {
  const count = useCountUp(value, duration, decimals);

  const formatted = formatFn
    ? formatFn(count)
    : decimals > 0
    ? count.toFixed(decimals)
    : Math.round(count).toString();

  return (
    <span className={`tabular-nums ${className}`}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
});

CountUp.displayName = "CountUp";

/**
 * StatCard Component with built-in CountUp micro-animation
 */
export type StatCardVariant = "default" | "emerald" | "rose" | "indigo" | "sky" | "amber" | "teal";

export interface StatCardProps {
  title: string;
  value: number | string;
  countUp?: boolean;
  decimals?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  variant?: StatCardVariant;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  countUp = typeof value === "number",
  decimals = 0,
  duration = 600,
  prefix = "",
  suffix = "",
  subtitle,
  icon,
  variant = "default",
  className = "",
}) => {
  const variantStyles: Record<StatCardVariant, string> = {
    default: "border-slate-200/80 bg-white/95 text-slate-900 shadow-2xs",
    emerald: "border-emerald-200/80 bg-emerald-50/70 text-emerald-950 shadow-2xs",
    rose: "border-rose-200/80 bg-rose-50/70 text-rose-950 shadow-2xs",
    indigo: "border-indigo-200/80 bg-indigo-50/70 text-indigo-950 shadow-2xs",
    sky: "border-sky-200/80 bg-sky-50/70 text-sky-950 shadow-2xs",
    amber: "border-amber-200/80 bg-amber-50/70 text-amber-950 shadow-2xs",
    teal: "border-teal-200/80 bg-teal-50/70 text-teal-950 shadow-2xs",
  };

  const numberColors: Record<StatCardVariant, string> = {
    default: "text-slate-900",
    emerald: "text-emerald-700",
    rose: "text-rose-700",
    indigo: "text-indigo-700",
    sky: "text-sky-700",
    amber: "text-amber-700",
    teal: "text-teal-700",
  };

  const numericValue = typeof value === "number" ? value : parseFloat(value) || 0;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-4 sm:p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${variantStyles[variant]} ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
          {title}
        </p>
        {icon && <div className="text-slate-400 shrink-0">{icon}</div>}
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <p className={`font-mono text-2xl sm:text-3xl font-black tracking-tight ${numberColors[variant]}`}>
          {countUp && !Number.isNaN(numericValue) ? (
            <CountUp
              value={numericValue}
              duration={duration}
              decimals={decimals}
              prefix={prefix}
              suffix={suffix}
            />
          ) : (
            `${prefix}${value}${suffix}`
          )}
        </p>
      </div>

      {subtitle && (
        <p className="mt-1 text-xs font-medium text-slate-500 truncate">{subtitle}</p>
      )}
    </div>
  );
};
