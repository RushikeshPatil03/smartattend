import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

export * from './DashboardBackground';
export * from './CountUp';

// ==========================================
// BUTTON COMPONENT
// ==========================================
export type ButtonVariant = 
  | 'primary' 
  | 'secondary' 
  | 'danger' 
  | 'outline' 
  | 'gradient' 
  | 'ghost' 
  | 'success';

export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  loading?: boolean;
  shimmer?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  loading = false,
  shimmer = false,
  leftIcon,
  rightIcon,
  className = '',
  disabled,
  type = 'button',
  ...props
}, ref) => {
  const isBusy = isLoading || loading;
  const isDisabled = Boolean(disabled || isBusy);

  const hasCustomBg = className.includes("bg-");

  const baseStyles = 
    "relative inline-flex items-center justify-center gap-2 font-semibold tracking-[0.01em] select-none cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none disabled:active:translate-y-0";

  const sizeStyles: Record<ButtonSize, string> = {
    sm: "px-3 py-1.5 text-xs rounded-lg min-h-[32px]",
    md: "px-4 py-2 text-sm rounded-xl min-h-[40px]",
    lg: "px-5 py-2.5 text-base rounded-xl min-h-[46px]",
    icon: "p-2 rounded-xl min-h-[40px] min-w-[40px] aspect-square",
  };

  const variantStyles: Record<ButtonVariant, string> = {
    primary:
      "bg-blue-600 text-white shadow-[0_4px_0_0_#1d4ed8,0_4px_12px_rgba(37,99,235,0.25)] hover:bg-blue-500 hover:shadow-[0_4px_0_0_#1e40af,0_6px_16px_rgba(37,99,235,0.35)] active:translate-y-[2px] active:shadow-[0_1px_0_0_#1d4ed8,0_2px_4px_rgba(37,99,235,0.2)] focus-visible:ring-blue-500",
    gradient:
      "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white shadow-[0_4px_0_0_#4338ca,0_6px_16px_rgba(79,70,229,0.3)] hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 hover:shadow-[0_4px_0_0_#3730a3,0_8px_20px_rgba(79,70,229,0.4)] active:translate-y-[2px] active:shadow-[0_1px_0_0_#4338ca,0_2px_4px_rgba(79,70,229,0.2)] focus-visible:ring-indigo-500",
    secondary:
      "bg-white text-slate-800 border border-slate-200 shadow-[0_2px_0_0_#cbd5e1,0_2px_6px_rgba(0,0,0,0.04)] hover:bg-slate-50 hover:border-slate-300 hover:shadow-[0_2px_0_0_#94a3b8,0_4px_8px_rgba(0,0,0,0.06)] active:translate-y-[1px] active:shadow-[0_1px_0_0_#cbd5e1] focus-visible:ring-blue-500",
    danger:
      "bg-rose-600 text-white shadow-[0_4px_0_0_#be123c,0_4px_12px_rgba(225,29,72,0.25)] hover:bg-rose-500 hover:shadow-[0_4px_0_0_#9f1239,0_6px_16px_rgba(225,29,72,0.35)] active:translate-y-[2px] active:shadow-[0_1px_0_0_#be123c,0_2px_4px_rgba(225,29,72,0.2)] focus-visible:ring-rose-500",
    outline:
      "bg-transparent border border-slate-300 text-slate-700 shadow-sm hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50/60 active:translate-y-[1px] active:bg-blue-100/60 focus-visible:ring-blue-500",
    ghost:
      "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200/80 active:translate-y-[1px] focus-visible:ring-blue-500",
    success:
      "bg-emerald-600 text-white shadow-[0_4px_0_0_#047857,0_4px_12px_rgba(5,150,105,0.25)] hover:bg-emerald-500 hover:shadow-[0_4px_0_0_#065f46,0_6px_16px_rgba(5,150,105,0.35)] active:translate-y-[2px] active:shadow-[0_1px_0_0_#047857] focus-visible:ring-emerald-500",
  };

  const appliedVariant = hasCustomBg && variant === 'primary' ? '' : variantStyles[variant];

  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={isBusy ? true : undefined}
      whileTap={isDisabled ? undefined : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 450, damping: 25 }}
      className={`${baseStyles} ${sizeStyles[size]} ${appliedVariant} ${className}`}
      {...props}
    >
      {/* Shimmer sweep effect if loading or requested */}
      {(isBusy || shimmer) && (
        <span
          className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/35 to-transparent animate-[shimmer_1.4s_ease-in-out_infinite]"
          style={{ willChange: 'transform' }}
          aria-hidden="true"
        />
      )}

      {/* Loading Spinner */}
      {isBusy && (
        <svg
          className="h-4 w-4 animate-spin shrink-0 text-current"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}

      {!isBusy && leftIcon && (
        <span className="inline-flex shrink-0 items-center justify-center text-current" aria-hidden="true">
          {leftIcon}
        </span>
      )}

      {children}

      {!isBusy && rightIcon && (
        <span className="inline-flex shrink-0 items-center justify-center text-current" aria-hidden="true">
          {rightIcon}
        </span>
      )}
    </motion.button>
  );
});

Button.displayName = 'Button';


// ==========================================
// CARD COMPONENT
// ==========================================
export type CardVariant = 'flat' | 'glass';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerRight?: React.ReactNode;
  variant?: CardVariant;
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(({
  children,
  className = '',
  title,
  subtitle,
  headerRight,
  variant = 'flat',
  interactive = false,
  ...props
}, ref) => {
  const variantStyles: Record<CardVariant, string> = {
    flat: "border border-slate-200/80 bg-white/95 shadow-sm",
    glass: "border border-white/60 bg-white/80 backdrop-blur-xl shadow-[0_8px_32px_-8px_rgba(15,23,42,0.12)]",
  };

  const interactiveStyles = interactive
    ? "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300/80"
    : "";

  return (
    <div
      ref={ref}
      className={`w-full max-w-full overflow-hidden rounded-2xl p-4 sm:p-5 lg:p-6 transition-all duration-200 ${variantStyles[variant]} ${interactiveStyles} ${className}`}
      {...props}
    >
      {(title || headerRight || subtitle) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {title && (
              typeof title === 'string' ? (
                <h3 className="text-lg font-semibold text-slate-900 tracking-tight">{title}</h3>
              ) : (
                title
              )
            )}
            {subtitle && (
              typeof subtitle === 'string' ? (
                <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
              ) : (
                subtitle
              )
            )}
          </div>
          {headerRight && <div className="shrink-0">{headerRight}</div>}
        </div>
      )}
      {children}
    </div>
  );
});

Card.displayName = 'Card';


// ==========================================
// INPUT COMPONENT
// ==========================================
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  variant?: 'default' | 'glass';
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({
  label,
  error,
  helperText,
  leftIcon,
  rightIcon,
  variant = 'default',
  className = '',
  id,
  disabled,
  ...props
}, ref) => {
  const generatedId = React.useId();
  const inputId = id || (label ? `input-${generatedId}` : undefined);

  const variantStyles = {
    default: "bg-white/95 border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/25",
    glass: "bg-white/70 backdrop-blur-md border-white/70 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/30",
  };

  return (
    <div className="mb-4 w-full min-w-0">
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-700"
        >
          {label}
        </label>
      )}

      <div className="relative flex w-full items-center">
        {leftIcon && (
          <div className="pointer-events-none absolute left-3.5 flex items-center justify-center text-slate-400">
            {leftIcon}
          </div>
        )}

        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={error ? 'true' : undefined}
          className={`w-full min-w-0 max-w-full rounded-xl border px-3.5 py-2.5 text-sm font-medium outline-none transition-all duration-150 shadow-xs focus:ring-3 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 ${
            leftIcon ? 'pl-10' : ''
          } ${rightIcon ? 'pr-10' : ''} ${
            error
              ? 'border-rose-400 bg-rose-50/40 text-rose-900 focus:border-rose-500 focus:ring-rose-500/20'
              : variantStyles[variant]
          } ${className}`}
          {...props}
        />

        {rightIcon && (
          <div className="absolute right-3.5 flex items-center justify-center text-slate-400">
            {rightIcon}
          </div>
        )}
      </div>

      {error ? (
        <p className="mt-1.5 text-xs font-medium text-rose-600">{error}</p>
      ) : helperText ? (
        <p className="mt-1.5 text-xs text-slate-500">{helperText}</p>
      ) : null}
    </div>
  );
});

Input.displayName = 'Input';


// ==========================================
// BADGE COMPONENT
// ==========================================
export type BadgeColor = 
  | 'green' 
  | 'emerald' 
  | 'red' 
  | 'rose' 
  | 'blue' 
  | 'yellow' 
  | 'amber' 
  | 'gray' 
  | 'purple';

export type BadgeVariant = 'subtle' | 'solid' | 'outline' | 'pulse' | 'dot';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children?: React.ReactNode;
  color?: BadgeColor;
  variant?: BadgeVariant;
  pulse?: boolean;
  dot?: boolean;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  color = 'blue',
  variant = 'subtle',
  pulse = false,
  dot = false,
  className = '',
  ...props
}) => {
  const showDot = pulse || dot || variant === 'pulse' || variant === 'dot';
  const shouldAnimatePing = pulse || variant === 'pulse';

  const colorStyles: Record<BadgeColor, string> = {
    green: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80",
    emerald: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80",
    red: "bg-rose-50 text-rose-700 ring-1 ring-rose-200/80",
    rose: "bg-rose-50 text-rose-700 ring-1 ring-rose-200/80",
    blue: "bg-blue-50 text-blue-700 ring-1 ring-blue-200/80",
    yellow: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80",
    amber: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80",
    gray: "bg-slate-100 text-slate-700 ring-1 ring-slate-200/80",
    purple: "bg-purple-50 text-purple-700 ring-1 ring-purple-200/80",
  };

  const solidColors: Record<BadgeColor, string> = {
    green: "bg-emerald-600 text-white shadow-xs",
    emerald: "bg-emerald-600 text-white shadow-xs",
    red: "bg-rose-600 text-white shadow-xs",
    rose: "bg-rose-600 text-white shadow-xs",
    blue: "bg-blue-600 text-white shadow-xs",
    yellow: "bg-amber-500 text-white shadow-xs",
    amber: "bg-amber-500 text-white shadow-xs",
    gray: "bg-slate-600 text-white shadow-xs",
    purple: "bg-purple-600 text-white shadow-xs",
  };

  const appliedColor = variant === 'solid' ? solidColors[color] || solidColors.blue : colorStyles[color] || colorStyles.blue;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-wide whitespace-nowrap select-none transition-colors duration-150 ${appliedColor} ${className}`}
      {...props}
    >
      {showDot && (
        <span className="relative flex h-2 w-2 shrink-0 items-center justify-center" aria-hidden="true">
          {shouldAnimatePing && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75 duration-1000" />
          )}
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current" />
        </span>
      )}
      {children}
    </span>
  );
};


// ==========================================
// SKELETON COMPONENT
// ==========================================
export type SkeletonVariant = 'text' | 'circular' | 'rectangular' | 'card';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  variant?: SkeletonVariant;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  variant = 'rectangular',
  style,
  ...props
}) => {
  const variantStyles: Record<SkeletonVariant, string> = {
    text: "h-4 w-full rounded-md",
    circular: "rounded-full aspect-square",
    rectangular: "rounded-xl",
    card: "rounded-2xl h-48 w-full",
  };

  return (
    <div
      className={`relative overflow-hidden bg-slate-200/80 ${variantStyles[variant] || ''} ${className}`}
      style={style}
      aria-hidden="true"
      {...props}
    >
      <div
        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent animate-[shimmer_1.4s_ease-in-out_infinite]"
        style={{ willChange: 'transform' }}
      />
    </div>
  );
};
