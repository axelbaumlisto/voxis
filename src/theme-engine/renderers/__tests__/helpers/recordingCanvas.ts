declare const require: (id: string) => { createHash: (algorithm: string) => { update: (data: string) => { digest: (encoding: "hex") => string } } };

const { createHash } = require("node:crypto");

export type DrawOp = string;

export type GoldenSummary = {
  hash: string;
  opCount: number;
  counts: Record<string, number>;
};

class MockGradient {
  private readonly stops: string[] = [];

  constructor(private readonly kind: string, private readonly args: number[]) {}

  addColorStop(offset: number, color: string): void {
    this.stops.push(`${round(offset)}:${color}`);
  }

  toString(): string {
    return `${this.kind}(${this.args.map(round).join(",")})[${this.stops.join("|")}]`;
  }
}

export class RecordingCanvasContext2D {
  fillStyle: string | MockGradient = "#000000";
  strokeStyle: string | MockGradient = "#000000";
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";

  constructor(private readonly ops: DrawOp[]) {}

  clearRect(): void {}
  beginPath(): void { this.push("beginPath"); }
  moveTo(x: number, y: number): void { this.push("moveTo", x, y); }
  lineTo(x: number, y: number): void { this.push("lineTo", x, y); }
  arc(x: number, y: number, r: number, start: number, end: number): void { this.push("arc", x, y, r, start, end); }
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void {
    this.push("ellipse", x, y, rx, ry, rotation, start, end);
  }
  closePath(): void { this.push("closePath"); }
  clip(): void { this.push("clip"); }
  save(): void { this.push("save"); }
  restore(): void { this.push("restore"); }
  translate(x: number, y: number): void { this.push("translate", x, y); }
  rotate(angle: number): void { this.push("rotate", angle); }

  fill(): void {
    this.pushWithStyle("fill", this.fillStyle);
  }

  stroke(): void {
    this.pushWithStyle("stroke", this.strokeStyle);
  }

  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): MockGradient {
    return new MockGradient("radial", [x0, y0, r0, x1, y1, r1]);
  }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): MockGradient {
    return new MockGradient("linear", [x0, y0, x1, y1]);
  }

  private push(name: string, ...nums: number[]): void {
    this.ops.push(nums.length === 0 ? name : `${name}(${nums.map(round).join(",")})`);
  }

  private pushWithStyle(name: "fill" | "stroke", style: string | MockGradient): void {
    this.ops.push([
      name,
      `style=${normalizeStyle(style)}`,
      `lineWidth=${round(this.lineWidth)}`,
      `lineCap=${this.lineCap}`,
      `lineJoin=${this.lineJoin}`,
    ].join(";"));
  }
}

export function round(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const fixed = (Math.round(n * 1000) / 1000).toFixed(3);
  return fixed.replace(/\.000$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function normalizeStyle(style: string | MockGradient): string {
  return typeof style === "string" ? style : style.toString();
}

export function installRecordingCanvas(ops: DrawOp[]): () => void {
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: (id: string) => unknown };
  const original = proto.getContext;
  proto.getContext = (id: string) => (id === "2d" ? new RecordingCanvasContext2D(ops) : null);
  return () => { proto.getContext = original; };
}

export function summarize(ops: DrawOp[]): GoldenSummary {
  const counts: Record<string, number> = {};
  for (const op of ops) {
    const key = op.split(/[;(]/, 1)[0];
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return {
    hash: createHash("sha256").update(ops.join("\n")).digest("hex").slice(0, 16),
    opCount: ops.length,
    counts,
  };
}
