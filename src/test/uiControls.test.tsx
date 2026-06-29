import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toggle } from "../components/ui/Toggle";
import { NumberField } from "../components/ui/NumberField";

describe("Toggle", () => {
  it("calls onChange with the negated value on click", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not fire when disabled", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("NumberField", () => {
  it("clamps a value above max", () => {
    const onChange = vi.fn();
    render(<NumberField value={13} onChange={onChange} min={10} max={24} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "99" } });
    expect(onChange).toHaveBeenCalledWith(24);
  });

  it("clamps a value below min", () => {
    const onChange = vi.fn();
    render(<NumberField value={13} onChange={onChange} min={10} max={24} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith(10);
  });
});
