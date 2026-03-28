import { describe, it, expect } from "vitest";
import { registerCustomWidget, renderCustomWidget } from "../customWidgetRegistry";

describe("customWidgetRegistry", () => {
  it("returns null for unknown component", () => {
    const result = renderCustomWidget("unknown", {} as Parameters<typeof renderCustomWidget>[1]);
    expect(result).toBeNull();
  });

  it("renders registered component", () => {
    const FakeWidget = ({ label }: { label: string }) => <span>{label}</span>;
    registerCustomWidget("fake-widget", (props) => <FakeWidget label={props.label} />);
    const result = renderCustomWidget("fake-widget", { label: "Test" } as Parameters<typeof renderCustomWidget>[1]);
    expect(result).not.toBeNull();
  });
});
