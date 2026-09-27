import type React from "react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { FaChevronRight } from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import Popover, { type PopoverPlacement } from "./Popover";

export interface MenuItem {
  // We need a stable key when `label` is not a plain string.
  id?: string;
  label: ReactNode;
  icon: ReactNode;
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
  anchorElement: HTMLElement | null;
  placement?: PopoverPlacement;
  // A submenu closes only itself on dismissal and the whole tree on a pick.
  onItemPicked?: () => void;
}

const MENU_WIDTH = 232;

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
  anchor: HTMLElement | null,
  listRef: React.RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!isOpen || isTouch) return;
    const frame = requestAnimationFrame(() =>
      menuItemsIn(listRef.current)[0]?.focus(),
    );
    return () => {
      cancelAnimationFrame(frame);
      if (!document.activeElement || document.activeElement === document.body)
        anchor?.focus();
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
        width={MENU_WIDTH}
        role="menu"
        placement={placement}
      >
        <div ref={listRef} className="surface-list" onKeyDown={handleKeyDown}>
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
                <span className="row-icon">{item.icon}</span>
                <span className="flex-1 min-w-0 truncate">{item.label}</span>
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
        />
      )}
    </>
  );
};

export default Menu;
