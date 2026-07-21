import { twMerge } from "tailwind-merge";

export const cn = (...c: (string | false | null | undefined)[]) =>
  twMerge(c.filter(Boolean).join(" "));
