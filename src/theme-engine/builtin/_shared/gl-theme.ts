// _shared/gl-theme.ts — ONE WebGL lifetime for every shader theme.
//
// Before this file there were three hand-rolled copies of the same plumbing
// (metaballs3d, lavalamp, and the orb adapter): create a 2x canvas, bail
// gracefully without a GL context, compile/link, upload the quad, run rAF,
// pause while the document is hidden, and dispose everything. Three copies of
// the part that must NOT be got wrong is three chances to leak a GL context or
// leave an orphan element behind.
//
// What this file owns: the canvas, the context, the program, shaders, the
// buffer and vertex attribute, the rAF loop (paused on `visibilitychange`),
// the frame timing, and full disposal. What a theme owns: its shader, its
// uniforms, and whatever it does per frame — that is the interesting part and
// it stays with the theme.
//
// The 2x supersample is deliberate and shared: at exactly 2:1 the compositor's
// bilinear downscale is an exact box filter (every source pixel contributes
// once), which is real anti-aliasing for a disc silhouette. At 3:1 it skips 5
// of every 9 source pixels and the staircase survives.
import type { ThemeInstance, ThemeSize } from "../../contract";

export interface GlSurfaceOptions {
  /** Theme id — every warning names it, so a host log is actionable. */
  id: string;
  size: ThemeSize;
  vert: string;
  frag: string;
  /** Supersample factor; 2 unless a theme has a reason (default 2). */
  renderScale?: number;
}

export interface GlSurface {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement;
  /** Uniform location, or null when the shader does not use it (GL allows null). */
  uniform(name: string): WebGLUniformLocation | null;
  /**
   * Start the render loop. `frame` gets seconds since the last frame (clamped
   * to 100 ms so a backgrounded tab does not jump the animation) and seconds
   * since mount.
   */
  run(frame: (dt: number, elapsed: number) => void): void;
  dispose(): void;
}

/**
 * Builds the surface, or returns a NO-OP instance when WebGL is unavailable or
 * the shader fails to compile: an embeddable theme must warn and disappear, not
 * crash the host.
 */
export function createGlSurface(
  container: HTMLElement,
  opts: GlSurfaceOptions,
): GlSurface | ThemeInstance {
  const renderScale = opts.renderScale ?? 2;
  const canvas = document.createElement("canvas");
  canvas.width = opts.size.width * renderScale;
  canvas.height = opts.size.height * renderScale;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);

  const bail = (reason: string): ThemeInstance => {
    console.warn(`${opts.id}: WebGL unavailable (${reason}), skipping`);
    canvas.remove();
    return { unmount() {} };
  };

  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
  }) as WebGLRenderingContext | null;
  if (!gl) return bail("no webgl context");

  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn(`${opts.id}: shader compile failed`, gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };

  const vs = compile(gl.VERTEX_SHADER, opts.vert);
  const fs = compile(gl.FRAGMENT_SHADER, opts.frag);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return bail("shader/program");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return bail(`link: ${gl.getProgramInfoLog(prog)}`);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // A full-screen TRIANGLE, not a quad: three vertices, no seam diagonal, and
  // it covers the viewport at any clip-space size (both shapes were in use
  // before; the triangle is the cheaper one and is what the shaders assume).
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  gl.viewport(0, 0, canvas.width, canvas.height);

  let raf = 0;
  let last = 0;
  let elapsed = 0;
  let frameCb: ((dt: number, elapsed: number) => void) | null = null;
  let disposed = false;

  const tick = (now: number) => {
    if (disposed || !frameCb) return;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    elapsed += dt;
    gl.clear(gl.COLOR_BUFFER_BIT);
    // The theme uploads its uniforms; the SURFACE draws the full-screen
    // triangle. Splitting it the other way is how a theme silently renders
    // nothing after a refactor (three vertices vs six, and nobody draws).
    frameCb(dt, elapsed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(tick);
  };

  const onVisibility = () => {
    if (disposed) return;
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf && frameCb) {
      last = performance.now(); // no jump for the time spent hidden
      raf = requestAnimationFrame(tick);
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    gl,
    canvas,
    uniform: (name: string) => gl.getUniformLocation(prog, name),
    run(frame: (dt: number, elapsed: number) => void) {
      frameCb = frame;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      gl.useProgram(null);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      canvas.remove();
    },
  };
}

/** Narrowing helper: `createGlSurface` returns an instance only when it bailed. */
export function isBailed(surface: GlSurface | ThemeInstance): surface is ThemeInstance {
  return typeof (surface as ThemeInstance).unmount === "function" && !("run" in surface);
}

export const FULLSCREEN_VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;
