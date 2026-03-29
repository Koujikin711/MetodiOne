import type { ReactNode } from "react";

const variants = {
  indigo: "from-indigo-500 to-indigo-600 shadow-[0_0_18px_rgba(99,102,241,0.45)]",
  purple: "from-violet-500 to-purple-600 shadow-[0_0_18px_rgba(168,85,247,0.45)]",
  blue: "from-blue-500 to-indigo-600 shadow-[0_0_18px_rgba(59,130,246,0.45)]",
  pink: "from-fuchsia-500 to-pink-500 shadow-[0_0_18px_rgba(236,72,153,0.4)]",
  teal: "from-cyan-500 to-teal-600 shadow-[0_0_18px_rgba(20,184,166,0.35)]",
} as const;

export type GradientVariant = keyof typeof variants;

type Props = {
  children: ReactNode;
  variant?: GradientVariant;
  className?: string;
};

export function GradientIconBox({ children, variant = "purple", className = "" }: Props) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white ${variants[variant]} ${className}`}
    >
      <span className="flex items-center justify-center text-white [&_svg]:stroke-current">
        {children}
      </span>
    </div>
  );
}
