import React from 'react';

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'outline' }> = ({ 
  children, variant = 'primary', className = '', ...props 
}) => {
  const baseStyles = "inline-flex max-w-full items-center justify-center gap-2 rounded-lg border border-transparent px-4 py-2 text-center font-semibold tracking-[0.01em] transition-all duration-200 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none";
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 hover:shadow-md hover:shadow-blue-900/15 focus-visible:ring-blue-500",
    secondary: "bg-slate-50 text-slate-800 border-slate-200 hover:bg-white hover:border-blue-200 active:bg-blue-50 focus-visible:ring-blue-500",
    danger: "bg-red-50 text-red-700 border-red-100 hover:bg-red-100 hover:border-red-200 active:bg-red-200 focus-visible:ring-red-500",
    outline: "bg-transparent border-slate-300 text-slate-700 hover:border-blue-500 hover:text-blue-700 hover:bg-blue-50/70 active:bg-blue-100/70 focus-visible:ring-blue-600"
  };
  
  return (
    <button className={`${baseStyles} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
};

export const Card: React.FC<{ children: React.ReactNode; className?: string; title?: string }> = ({ children, className = "", title }) => (
  <div className={`w-full max-w-full overflow-auto rounded-xl border border-slate-200/80 bg-white/90 p-4 shadow-sm sm:p-5 lg:p-6 ${className}`}>
    {title && <h3 className="text-lg font-semibold text-slate-900 mb-4 tracking-tight">{title}</h3>}
    {children}
  </div>
);

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label?: string }> = ({ label, className = '', ...props }) => (
  <div className="mb-4 w-full min-w-0">
    {label && <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>}
    <input 
      className={`w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white/95 px-4 py-2 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500 ${className}`} 
      {...props} 
    />
  </div>
);

export const Badge: React.FC<{ children: React.ReactNode; color?: 'green' | 'red' | 'blue' | 'yellow' | 'gray' }> = ({ children, color = 'blue' }) => {
    const colors = {
        green: "bg-green-50 text-green-700 ring-1 ring-green-200",
        red: "bg-red-50 text-red-700 ring-1 ring-red-200",
        blue: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
        yellow: "bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200",
        gray: "bg-slate-100 text-slate-700 ring-1 ring-slate-200"
    }
    return (
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide whitespace-nowrap ${colors[color]}`}>
            {children}
        </span>
    )
}

export const Skeleton: React.FC<{ className?: string }> = ({ className = "" }) => (
  <div className={`animate-pulse rounded-xl bg-slate-200/80 ${className}`} />
);
