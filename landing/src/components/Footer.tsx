export default function Footer({ lang }: { lang?: "en" | "ru" }) {
  return (
    <footer className="w-full py-12 text-center text-zinc-500 text-sm border-t border-white/5 z-10 bg-black">
      <p>&copy; 2026 Voxis (SoupaWhisper) Project. Open source under the MIT License.</p>
    </footer>
  );
}
