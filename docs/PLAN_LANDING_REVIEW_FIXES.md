# Plan — Landing Outstanding Review Fixes

Executes the remaining (non-blocking) findings from the final code review of the Voxis landing
(`reviewer-gpt55-arch` + `reviewer-gpt55-risk`). Critical/lint items were already fixed. These are
the important/structural leftovers. All work is inside `landing/`.

Verify command: `cd landing && npm run lint && npm run build`

---

## Step 1 — Gate desktop 3D board mount to desktop only (performance)

**Problem:** The desktop fly-through subtree (`useScroll`, `useMotionValueEvent`, all `BoardLayer`
instances with 4 `useTransform` chains each) is hidden with `hidden md:flex` but still MOUNTS and
runs on mobile, wasting CPU/battery.

**Files:** `landing/src/components/Architecture.tsx`, `landing/src/hooks/useMediaQuery.ts` (already scaffolded)

**Implementation:**
- Extract the desktop fly-through (everything under `hidden md:flex`, incl. `useScroll`,
  `useMotionValueEvent`, `BoardLayer` map, and its `containerRef`/height wrapper) into a child
  component `ArchitectureDesktop`.
- Use a client-safe `useMediaQuery("(min-width: 768px)")` hook. Render `ArchitectureDesktop` only
  when the query is true. The outer `section` still owns `md:h-[600vh]` so scroll height is correct
  on desktop; on mobile only the bento stack renders.
- Must remain SSR-safe: default to NOT mounting desktop tree during SSR/first paint, then mount
  after hydration when the media query resolves true (avoid hydration mismatch warnings).

**Acceptance:**
- On a <768px viewport, no `BoardLayer`/desktop SVG nodes exist in the DOM.
- On >=768px, the fly-through renders and animates exactly as before.
- `npm run lint` and `npm run build` pass. No hydration warnings.

---

## Step 2 — Adopt SectionHeading + Container to remove duplication

**Problem:** `SectionHeading` and `Container` were created but barely adopted; heading class bundles
(`text-5xl md:text-8xl font-extrabold tracking-tighter`, `text-4xl font-extrabold text-white`) and
the container contract (`mx-auto w-full px-[var(--space-md)] lg:px-[var(--space-2xl)]`) are still
duplicated inline.

**Files:** `landing/src/components/Hero.tsx`, `landing/src/components/Navbar.tsx`,
`landing/src/components/Architecture.tsx`

**Implementation:**
- `Navbar`: use `<Container as="nav" width="page">` instead of the duplicated inline container class.
- `Architecture` mobile header + bridge heading: use `SectionHeading` (wrap in motion where needed).
- Keep Hero's motion entrance, but route its heading/description through `SectionHeading` (or leave
  Hero as-is if wrapping breaks the per-line gradient — document the exception).
- Do NOT change visual output; this is a de-duplication refactor.

**Acceptance:**
- `SectionHeading` and `Container` are imported/used outside their own files.
- No visual regression vs current screenshots.
- `npm run lint` and `npm run build` pass.

---

## Step 3 — Extract shared LandingPage, make /ru locale-correct

**Problem:** `page.tsx` and `ru/page.tsx` duplicate the whole `main → Navbar → Hero → Architecture →
Footer` composition; `<html lang>` is always "en".

**Files:** `landing/src/app/page.tsx`, `landing/src/app/ru/page.tsx`,
`landing/src/components/LandingPage.tsx` (new), `landing/src/app/layout.tsx` or `ru/layout.tsx`

**Implementation:**
- Create `LandingPage` component that takes a `lang` + locale copy object + `steps`, and renders the
  full composition. Both page files just select locale data and render `<LandingPage .../>`.
- Make the `/ru` route render `lang="ru"` on `<html>` (Next.js: per-route metadata/layout or a
  `<html lang>` set via a segment layout). If a single root layout forces "en", add `ru/layout.tsx`.

**Acceptance:**
- EN/RU pages only select data + render the shared component.
- `/ru` produces `html[lang="ru"]`.
- `npm run lint` and `npm run build` pass; both routes still prerender.
