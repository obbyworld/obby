import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Menu, { type MenuItem } from "../../../src/components/ui/Menu";

describe("Menu", () => {
  let anchor: HTMLElement;

  const setup = (menuItems: MenuItem[], onClose = vi.fn()) => {
    anchor = document.createElement("button");
    document.body.appendChild(anchor);
    render(
      <Menu
        isOpen
        onClose={onClose}
        menuItems={menuItems}
        anchorElement={anchor}
      />,
    );
    return { onClose };
  };

  it("does not render items with show:false", () => {
    setup([
      { id: "a", label: "Visible", icon: null },
      { id: "b", label: "Hidden", icon: null, show: false },
    ]);
    expect(
      screen.getByRole("menuitem", { name: "Visible" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Hidden" }),
    ).not.toBeInTheDocument();
  });

  it("calls onClick and onClose when a normal item is clicked", () => {
    const onClick = vi.fn();
    const { onClose } = setup([
      { id: "a", label: "Item", icon: null, onClick },
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Item" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a danger item", () => {
    setup([
      { id: "a", label: "Delete", icon: null, danger: true, onClick: vi.fn() },
    ]);
    expect(
      screen.getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  it("opens a submenu on click without closing, and clicking a submenu item calls its onClick and onClose", () => {
    const parentOnClick = vi.fn();
    const submenuOnClick = vi.fn();
    const { onClose } = setup([
      {
        id: "parent",
        label: "Parent",
        icon: null,
        onClick: parentOnClick,
        submenu: [
          { id: "child", label: "Child", icon: null, onClick: submenuOnClick },
        ],
      },
    ]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Parent" }));
    expect(parentOnClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: "Child" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Child" }));
    expect(submenuOnClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
