import { MagnifyingGlassIcon } from "@heroicons/react/24/solid";
import type React from "react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { escapeRegExp } from "../escapeRegExp";
import BaseModal, { type BaseModalProps } from "./BaseModal";

export interface SearchableItem {
  id: string;
  title: string;
  description?: string;
  category?: string;
  keywords?: string[];
  icon?: ReactNode;
  action?: () => void;
  priority?: number;
}

export interface SearchableModalProps extends Omit<BaseModalProps, "children"> {
  items: SearchableItem[];
  onSelect?: (item: SearchableItem) => void;
  placeholder?: string;
  emptyMessage?: string;
  maxResults?: number;
  autoFocus?: boolean;
  showCategories?: boolean;
  onSearch?: (query: string) => void;
  searchDelay?: number;
  highlightQuery?: boolean;
  renderItem?: (
    item: SearchableItem,
    isSelected: boolean,
    query: string,
  ) => ReactNode;
  renderEmptyState?: (query: string) => ReactNode;
  filterPredicate?: (item: SearchableItem, query: string) => boolean;
}

export const SearchableModal: React.FC<SearchableModalProps> = (props) => {
  const {
    items,
    onSelect,
    placeholder = "Search...",
    emptyMessage = "No results found",
    maxResults = 50,
    autoFocus = true,
    showCategories = true,
    onSearch,
    searchDelay = 200,
    highlightQuery = true,
    renderItem,
    renderEmptyState,
    filterPredicate,
    isOpen,
    ...baseModalProps
  } = props;
  const [query, setQuery] = useState("");
  const [filteredItems, setFilteredItems] = useState<SearchableItem[]>(items);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout>(undefined);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Default filter function
  const defaultFilter = useCallback(
    (item: SearchableItem, searchQuery: string): boolean => {
      const lowerQuery = searchQuery.toLowerCase();

      return (
        item.title.toLowerCase().includes(lowerQuery) ||
        item.description?.toLowerCase().includes(lowerQuery) ||
        item.category?.toLowerCase().includes(lowerQuery) ||
        item.keywords?.some((keyword) =>
          keyword.toLowerCase().includes(lowerQuery),
        ) ||
        false
      );
    },
    [],
  );

  // Filter items based on query
  useEffect(() => {
    if (!query.trim()) {
      setFilteredItems(items.slice(0, maxResults));
      setSelectedIndex(0);
      return;
    }

    const filterFunction = filterPredicate || defaultFilter;
    const filtered = items
      .filter((item) => filterFunction(item, query))
      .sort((a, b) => {
        // Sort by priority if available
        if (a.priority !== undefined && b.priority !== undefined) {
          return b.priority - a.priority;
        }
        return 0;
      })
      .slice(0, maxResults);

    setFilteredItems(filtered);
    setSelectedIndex(0);
  }, [query, items, maxResults, filterPredicate, defaultFilter]);

  // Handle search with debounce
  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);

      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      if (onSearch) {
        searchTimeoutRef.current = setTimeout(() => {
          onSearch(value);
        }, searchDelay);
      }
    },
    [onSearch, searchDelay],
  );

  // Store baseModalProps.onClose in a ref to stabilize dependency
  const onCloseRef = useRef(baseModalProps.onClose);
  onCloseRef.current = baseModalProps.onClose;

  // Handle item selection
  const handleSelect = useCallback(
    (item: SearchableItem) => {
      if (item.action) {
        item.action();
      }
      if (onSelect) {
        onSelect(item);
      }
      onCloseRef.current();
    },
    [onSelect],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredItems.length - 1 ? prev + 1 : 0,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredItems.length - 1,
          );
          break;
        case "Enter":
          e.preventDefault();
          if (filteredItems[selectedIndex]) {
            handleSelect(filteredItems[selectedIndex]);
          }
          break;
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            setSelectedIndex((prev) =>
              prev > 0 ? prev - 1 : filteredItems.length - 1,
            );
          } else {
            setSelectedIndex((prev) =>
              prev < filteredItems.length - 1 ? prev + 1 : 0,
            );
          }
          break;
      }
    },
    [filteredItems, selectedIndex, handleSelect],
  );

  // Auto-focus search input when modal opens
  useEffect(() => {
    if (isOpen && autoFocus) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen, autoFocus]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = resultsRef.current?.children[
      selectedIndex
    ] as HTMLElement;
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex]);

  // Highlight search query in text
  const highlightText = (text: string, searchQuery: string) => {
    if (!highlightQuery || !searchQuery.trim()) return text;

    const escaped = escapeRegExp(searchQuery);
    const parts = text
      .split(new RegExp(`(${escaped})`, "gi"))
      .map((part, i) => ({ part, i }));
    return parts.map(({ part, i }) =>
      part.toLowerCase() === searchQuery.toLowerCase() ? (
        <mark
          key={`highlight-${i}-${part}`}
          className="bg-yellow-400 text-base-content px-0.5"
        >
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };

  // Group items by category
  const groupedItems = showCategories
    ? filteredItems.reduce(
        (acc, item) => {
          const category = item.category || "Other";
          if (!acc[category]) acc[category] = [];
          acc[category].push(item);
          return acc;
        },
        {} as Record<string, SearchableItem[]>,
      )
    : { "": filteredItems };

  // Default item renderer
  const defaultRenderItem = (item: SearchableItem, isSelected: boolean) => (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
        isSelected ? "bg-primary/20 text-primary" : "hover:bg-base-100"
      }`}
      onClick={() => handleSelect(item)}
    >
      {item.icon && <div className="flex-shrink-0">{item.icon}</div>}
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">
          {highlightText(item.title, query)}
        </div>
        {item.description && (
          <div className="text-sm opacity-70 truncate">
            {highlightText(item.description, query)}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <BaseModal isOpen={isOpen} {...baseModalProps}>
      <div className="flex flex-col h-[60vh] max-h-[600px]">
        {/* Search Input */}
        <div className="p-4 border-b border-base-100">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-base-content/50" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="w-full pl-10 pr-4 py-2 bg-base-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Results */}
        <div ref={resultsRef} className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredItems.length === 0 ? (
            renderEmptyState ? (
              renderEmptyState(query)
            ) : (
              <div className="text-center py-8 text-base-content/50">
                {emptyMessage}
              </div>
            )
          ) : (
            Object.entries(groupedItems).map(([category, categoryItems]) => (
              <div key={category}>
                {category && showCategories && (
                  <div className="text-sm font-semibold text-base-content/50 mb-2 px-2">
                    {category}
                  </div>
                )}
                {categoryItems.map((item, index) => {
                  const globalIndex = filteredItems.indexOf(item);
                  const isSelected = globalIndex === selectedIndex;

                  return (
                    <div key={item.id}>
                      {renderItem
                        ? renderItem(item, isSelected, query)
                        : defaultRenderItem(item, isSelected)}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </BaseModal>
  );
};

export default SearchableModal;
