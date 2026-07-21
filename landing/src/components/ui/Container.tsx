import { cn } from "../../lib/cn";

type Width = "page" | "content" | "prose" | "card" | "full";

const widths: Record<Width, string> = {
  page: "max-w-[var(--container-page)]",
  content: "max-w-[var(--container-content)]",
  prose: "max-w-[var(--container-prose)]",
  card: "max-w-[var(--container-card)]",
  full: "max-w-none",
};

interface ContainerProps {
  as?: React.ElementType;
  width?: Width;
  className?: string;
  children: React.ReactNode;
}

export default function Container({
  as: Tag = "div",
  width = "page",
  className,
  children,
}: ContainerProps) {
  return (
    <Tag
      className={cn(
        "mx-auto w-full px-[var(--space-md)] lg:px-[var(--space-2xl)]",
        widths[width],
        className
      )}
    >
      {children}
    </Tag>
  );
}
