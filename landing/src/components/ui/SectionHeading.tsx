import { cn } from "../../lib/cn";

interface SectionHeadingProps {
  eyebrow?: React.ReactNode;
  eyebrowColor?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  as?: "h1" | "h2" | "h3";
  size?: "sm" | "md" | "lg" | "hero";
  align?: "left" | "center";
  gradient?: boolean;
  className?: string;
}

const titleSize = {
  sm: "text-2xl md:text-3xl",
  md: "text-4xl md:text-5xl",
  lg: "text-4xl md:text-6xl",
  hero: "text-5xl md:text-8xl tracking-tighter",
} as const;

const descSize = {
  sm: "text-sm",
  md: "text-base md:text-lg",
  lg: "text-lg md:text-xl",
  hero: "text-lg md:text-2xl",
} as const;

export default function SectionHeading({
  eyebrow,
  eyebrowColor,
  title,
  description,
  as: Tag = "h2",
  size = "md",
  align = "center",
  gradient = false,
  className,
}: SectionHeadingProps) {
  const alignCls =
    align === "center" ? "text-center items-center" : "text-left items-start";
  return (
    <div className={cn("flex flex-col", alignCls, className)}>
      {eyebrow && (
        <div
          className="pill mb-[var(--space-xs)]"
          style={eyebrowColor ? { color: eyebrowColor } : undefined}
        >
          {eyebrow}
        </div>
      )}
      <Tag
        className={cn(
          "font-extrabold text-white",
          titleSize[size],
          gradient && "text-gradient"
        )}
      >
        {title}
      </Tag>
      {description && (
        <p
          className={cn(
            "text-[var(--color-muted)] font-light mt-[var(--space-md)] max-w-[var(--container-prose)]",
            descSize[size]
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}
