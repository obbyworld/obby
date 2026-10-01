import type React from "react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { FaChevronRight } from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { wasLastInputKeyboard } from "../../lib/focus";
import Popover, { type PopoverAnchor, type PopoverPlacement } from "./Popover";

export interface MenuItem {
  // We need a stable key when `label` is not a plain string.
  id?: string;
  label: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  show?: boolean;
  divider?: boolean;
  danger?: boolean;
  submenu?: MenuItem[];
}

interface MenuProps {
  isOpen: boolean;
  onClose: () => void;
  menuItems: MenuItem[];
  anchorElement: PopoverAnchor | null;
  placement?: PopoverPlacement;
  header?: ReactNode;
  width?: number | "auto";
  // A submenu closes only itself on dismissal and the whole tree on a pick.
  onItemPicked?: () => void;
}

const keyOf = (item: MenuItem) =>
  item.id ?? (typeof item.label === "string" ? item.label : "");

const itemToneClass = (item: MenuItem, isSubmenuOpen: boolean) => {
  if (item.danger) return "row-interactive-danger";
  if (isSubmenuOpen) return "row-interactive-active";
  return "";
};

const menuItemsIn = (list: HTMLElement | null) =>
  Array.from(list?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []);

function focusSibling(list: HTMLElement | null, key: string) {
  const items = menuItemsIn(list);
  if (items.length === 0) return;
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next =
    key === "Home"
      ? 0
      : key === "End"
        ? items.length - 1
        : key === "ArrowDown"
          ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
  items[next].focus();
}

// Keyboard users land on the first item when a menu opens and back on the
// trigger when it closes; touch users keep focus where it is.
function useMenuFocus(
  isOpen: boolean,
  isTouch: boolean,
  anchor: PopoverAnchor | null,
  listRef: React.RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!isOpen || isTouch) return;
    const frame = requestAnimationFrame(() =>
      (wasLastInputKeyboard()
        ? menuItemsIn(listRef.current)[0]
        : listRef.current
      )?.focus(),
    );
    return () => {
      cancelAnimationFrame(frame);
      const isFocusLost =
        !document.activeElement || document.activeElement === document.body;
      if (isFocusLost && anchor instanceof HTMLElement) anchor.focus();
    };
  }, [isOpen, isTouch, anchor, listRef]);
}

export const Menu: React.FC<MenuProps> = ({
  isOpen,
  onClose,
  menuItems,
  anchorElement,
  placement,
  onItemPicked,
  header,
  width = "auto",
}) => {
  const isTouch = useIsTouchInput();
  const listRef = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<{
    id: string;
    anchor: HTMLElement;
  } | null>(null);
  useMenuFocus(isOpen, isTouch, anchorElement, listRef);

  const closeAll = () => {
    setOpenSubmenu(null);
    onClose();
  };
  const finishPick = onItemPicked ?? closeAll;

  const visibleItems = menuItems.filter((item) => item.show ?? true);
  const submenuItems =
    visibleItems.find((item) => keyOf(item) === openSubmenu?.id)?.submenu ?? [];

  const openSubmenuFor = (item: MenuItem, anchor: HTMLElement) =>
    setOpenSubmenu(item.submenu ? { id: keyOf(item), anchor } : null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      focusSibling(listRef.current, e.key);
    } else if (e.key === "ArrowRight") {
      const focused = document.activeElement as HTMLElement;
      const item = visibleItems.find(
        (candidate) => keyOf(candidate) === focused.dataset.menuKey,
      );
      if (item?.submenu) {
        e.preventDefault();
        openSubmenuFor(item, focused);
      }
    } else if (e.key === "ArrowLeft" && onItemPicked) {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <>
      <Popover
        isOpen={isOpen}
        onClose={closeAll}
        anchor={anchorElement}
        width={width}
        role="menu"
        placement={placement}
      >
        <div
          ref={listRef}
          tabIndex={-1}
          className="surface-list outline-none"
          onKeyDown={handleKeyDown}
        >
          {header && <div className="px-2 pt-1 pb-1.5">{header}</div>}
          {visibleItems.map((item) => (
            <div key={keyOf(item)}>
              {item.divider && <hr className="divider-soft" />}
              <button
                type="button"
                role="menuitem"
                data-menu-key={keyOf(item)}
                aria-haspopup={item.submenu ? "menu" : undefined}
                aria-expanded={
                  item.submenu ? openSubmenu?.id === keyOf(item) : undefined
                }
                onMouseEnter={(e) => {
                  if (!isTouch) openSubmenuFor(item, e.currentTarget);
                }}
                onClick={(e) => {
                  if (item.submenu) {
                    openSubmenuFor(item, e.currentTarget);
                    return;
                  }
                  item.onClick?.();
                  finishPick();
                }}
                className={`row-interactive ${isTouch ? "py-3" : ""} ${itemToneClass(
                  item,
                  openSubmenu?.id === keyOf(item),
                )}`}
              >
                {item.icon && <span className="row-icon">{item.icon}</span>}
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{item.label}</span>
                  {item.description && (
                    <span className="row-meta block truncate">
                      {item.description}
                    </span>
                  )}
                </span>
                {item.trailing && (
                  <span className="row-meta shrink-0">{item.trailing}</span>
                )}
                {item.submenu && (
                  <FaChevronRight className="flex-shrink-0 text-[10px] opacity-70" />
                )}
              </button>
            </div>
          ))}
        </div>
      </Popover>
      {isOpen && openSubmenu && (
        <Menu
          isOpen
          onClose={() => setOpenSubmenu(null)}
          onItemPicked={closeAll}
          menuItems={submenuItems}
          anchorElement={openSubmenu.anchor}
          placement="side"
          width={width}
        />
      )}
    </>
  );
};

export default Menu;
