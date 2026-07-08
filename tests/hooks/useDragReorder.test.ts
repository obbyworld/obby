import { act, renderHook } from "@testing-library/react";
import type React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { useDragReorder } from "../../src/hooks/useDragReorder";

describe("useDragReorder", () => {
  let onReorder: Mock<(reorderedIds: string[]) => void>;

  beforeEach(() => {
    onReorder = vi.fn<(reorderedIds: string[]) => void>();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  function createMockDraggableElement(
    itemId: string,
    top: number,
    height = 50,
  ) {
    const element = document.createElement("div");
    element.setAttribute("data-draggable-item", "true");
    element.setAttribute("data-item-id", itemId);

    element.getBoundingClientRect = vi.fn(() => ({
      top,
      height,
      bottom: top + height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    })) as () => DOMRect;

    element.setPointerCapture = vi.fn();
    element.releasePointerCapture = vi.fn();

    return element;
  }

  function setupDOMElements(items: string[]): void {
    document.body.innerHTML = "";
    const ITEM_HEIGHT = 50;

    items.forEach((itemId, index) => {
      const element = createMockDraggableElement(itemId, index * ITEM_HEIGHT);
      document.body.appendChild(element);
    });
  }

  function createPointerEvent(
    type: "pointerdown" | "pointermove" | "pointerup",
    config: {
      clientY: number;
      button?: number;
      pointerId?: number;
      currentTarget?: HTMLElement;
    },
  ): React.PointerEvent {
    const {
      clientY,
      button = 0,
      pointerId = 1,
      currentTarget: provided,
    } = config;

    let target: HTMLElement;
    if (provided) {
      target = provided;
    } else {
      target = document.createElement("div");
      target.setPointerCapture = vi.fn();
      target.releasePointerCapture = vi.fn();
    }

    return {
      clientY,
      button,
      pointerId,
      currentTarget: target,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      nativeEvent: {} as PointerEvent,
    } as unknown as React.PointerEvent;
  }

  it("should reorder item from position 0 to position 2", () => {
    const items = ["item-1", "item-2", "item-3", "item-4"];
    setupDOMElements(items);

    const { result } = renderHook(() =>
      useDragReorder({
        items,
        getItemId: (id) => id,
        onReorder,
      }),
    );

    const item1El = document.querySelector(
      '[data-item-id="item-1"]',
    ) as HTMLElement;

    act(() => {
      result.current.handlePointerDown(
        createPointerEvent("pointerdown", {
          clientY: 25,
          currentTarget: item1El,
        }),
        "item-1",
      );
    });

    act(() => {
      result.current.handlePointerMove(
        createPointerEvent("pointermove", { clientY: 35 }),
      );
    });

    expect(result.current.isDragging).toBe(true);
    expect(result.current.draggedItemId).toBe("item-1");

    act(() => {
      result.current.handlePointerMove(
        createPointerEvent("pointermove", { clientY: 125 }),
      );
    });

    expect(result.current.dragOverItemId).toBe("item-3");

    act(() => {
      result.current.handlePointerUp(
        createPointerEvent("pointerup", { clientY: 125 }),
      );
    });

    expect(onReorder).toHaveBeenCalledWith([
      "item-2",
      "item-3",
      "item-1",
      "item-4",
    ]);
    expect(result.current.isDragging).toBe(false);
    expect(result.current.draggedItemId).toBeNull();
    expect(result.current.dragOverItemId).toBeNull();
  });

  it("should not reorder when dragging to bottom and back to original position", () => {
    const items = ["item-1", "item-2", "item-3", "item-4"];
    setupDOMElements(items);

    const { result } = renderHook(() =>
      useDragReorder({
        items,
        getItemId: (id) => id,
        onReorder,
      }),
    );

    const item1El = document.querySelector(
      '[data-item-id="item-1"]',
    ) as HTMLElement;

    act(() => {
      result.current.handlePointerDown(
        createPointerEvent("pointerdown", {
          clientY: 25,
          currentTarget: item1El,
        }),
        "item-1",
      );
    });

    act(() => {
      result.current.handlePointerMove(
        createPointerEvent("pointermove", { clientY: 35 }),
      );
    });

    expect(result.current.isDragging).toBe(true);
    expect(result.current.draggedItemId).toBe("item-1");

    act(() => {
      result.current.handlePointerMove(
        createPointerEvent("pointermove", { clientY: 175 }),
      );
    });

    expect(result.current.dragOverItemId).toBe("item-4");

    act(() => {
      result.current.handlePointerMove(
        createPointerEvent("pointermove", { clientY: 25 }),
      );
    });

    expect(result.current.dragOverItemId).toBe("item-1");

    act(() => {
      result.current.handlePointerUp(
        createPointerEvent("pointerup", { clientY: 25 }),
      );
    });

    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.isDragging).toBe(false);
    expect(result.current.draggedItemId).toBeNull();
    expect(result.current.dragOverItemId).toBeNull();
  });
});
