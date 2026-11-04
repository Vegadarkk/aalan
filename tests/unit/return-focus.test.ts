import { afterEach, describe, expect, it, vi } from "vitest";
import { returnTarget } from "@/components/ui/return-focus";

// Where a dialog without a Dialog.Trigger sends the focus when it closes (audit zone 8, 5.2-1).

class FakeElement {
  constructor(
    readonly isConnected: boolean,
    private readonly disabled = false,
  ) {}
  matches(selector: string): boolean {
    return selector === ":disabled" && this.disabled;
  }
}

describe("returnTarget", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("takes the opener first, else the element focused before, skipping detached or disabled ones", () => {
    vi.stubGlobal("HTMLElement", FakeElement);
    const opener = new FakeElement(true);
    const before = new FakeElement(true);
    const detached = new FakeElement(false);
    const disabled = new FakeElement(true, true);
    const as = (element: FakeElement) => element as unknown as Element;
    expect(returnTarget(as(opener), as(before))).toBe(opener);
    expect(returnTarget(null, as(before))).toBe(before);
    expect(returnTarget(as(detached), as(before))).toBe(before);
    expect(returnTarget(as(disabled), as(before))).toBe(before);
    expect(returnTarget(undefined, null)).toBeNull();
    expect(returnTarget(as(detached), as(disabled))).toBeNull();
  });
});
