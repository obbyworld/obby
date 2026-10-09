import type React from "react";
import type { Completion } from "../../hooks/useCompletion";
import SuggestionList from "./SuggestionList";

type ListProps = Omit<
  React.ComponentProps<typeof SuggestionList>,
  | "title"
  | "items"
  | "getKey"
  | "renderItem"
  | "selectedIndex"
  | "onHover"
  | "onPick"
>;

export function CompletionList<T>({
  completion,
  selectedIndex = completion.selectedIndex,
  ...listProps
}: ListProps & { completion: Completion<T>; selectedIndex?: number }) {
  const { provider } = completion;
  if (!provider || completion.items.length === 0) return null;
  return (
    <SuggestionList
      {...listProps}
      title={provider.title}
      items={completion.items}
      getKey={provider.getKey}
      renderItem={provider.renderItem}
      selectedIndex={selectedIndex}
      onHover={completion.setSelectedIndex}
      onPick={completion.pick}
    />
  );
}

export default CompletionList;
