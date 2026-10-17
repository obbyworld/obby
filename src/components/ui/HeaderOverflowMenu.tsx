import type React from "react";
import type { ReactNode } from "react";
import Popover from "./Popover";

export interface HeaderOverflowMenuItem {
  label: ReactNode;
  icon: ReactNode;
  onClick: () => void;
  show: boolean;
  // Stable React key + title; required when `label` isn't a plain string.
  id?: string;
  // Draws a rule above this item, separating it from the group before it --
  // for a menu whose entries fall into a couple of clearly different kinds.
  divider?: boolean;
}

interface HeaderOverflowMenuProps {
  isOpen: boolean;
  onClose: () => void;
  menuItems: HeaderOverflowMenuItem[];
  anchorElement: HTMLElement | null;
}

// Flat action menu; the shared Popover owns positioning and dismissal.
export const HeaderOverflowMenu: React.FC<HeaderOverflowMenuProps> = ({
  isOpen,
  onClose,
  menuItems,
  anchorElement,
}) => {
  return (
    <Popover
      isOpen={isOpen}
      onClose={onClose}
      anchor={anchorElement}
      width={200}
      role="menu"
    >
      <div className="py-1">
        {menuItems
          .filter((item) => item.show)
          .map((item) => (
            <div
              key={typeof item.label === "string" ? item.label : item.id}
              className={
                item.divider
                  ? "mt-1 pt-1 border-t border-discord-dark-400"
                  : undefined
              }
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  item.onClick();
                  onClose();
                }}
                className="w-full px-3 py-2 text-left text-discord-text-normal hover:bg-discord-dark-200 hover:text-white transition-colors duration-150 flex items-center gap-2"
                title={typeof item.label === "string" ? item.label : undefined}
              >
                <span className="mt-0.5 flex-shrink-0 text-sm">
                  {item.icon}
                </span>
                <span className="text-sm">{item.label}</span>
              </button>
            </div>
          ))}
      </div>
    </Popover>
  );
};

export default HeaderOverflowMenu;
