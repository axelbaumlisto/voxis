import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Voxis — Speak your code. Write at lightspeed.",
  description:
    "A completely private, blazing fast desktop voice dictation engine built with Tauri v2, Rust, and Whisper AI.",
  keywords: ["voice dictation", "speech to text", "Tauri", "Rust", "Whisper", "Groq", "desktop app"],
  openGraph: {
    title: "Voxis — Speak your code. Write at lightspeed.",
    description:
      "A completely private, blazing fast desktop voice dictation engine built with Tauri v2, Rust, and Whisper AI.",
    url: "https://voxis.top",
    siteName: "Voxis",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Voxis — Speak your code",
    description: "A completely private, blazing fast desktop voice dictation engine.",
  },
};

interface RootDocumentProps {
  lang: "en" | "ru";
  children: ReactNode;
}

export function RootDocument({ lang, children }: RootDocumentProps) {
  return (
    <html
      lang={lang}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
