import { RootDocument, metadata } from "../root-layout.shared";
import "../globals.css";

export { metadata };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <RootDocument lang="ru">{children}</RootDocument>;
}
