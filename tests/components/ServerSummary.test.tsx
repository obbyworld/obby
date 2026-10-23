import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  isListableServer,
  ServerSummary,
} from "../../src/components/ui/HomeScreen";

describe("ServerSummary", () => {
  it("shows the description and the counts together", () => {
    render(
      <ServerSummary
        server={{
          name: "h4ks",
          description: "Tech talk",
          users: 1650,
          channels: 23,
        }}
      />,
    );
    expect(screen.getByText("Tech talk")).toBeInTheDocument();
    expect(screen.getByText("1,650")).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
  });

  it("shows only the counts when the description is empty", () => {
    const { container } = render(
      <ServerSummary
        server={{ name: "AIN", description: "", users: 4, channels: 2 }}
      />,
    );
    expect(
      container.querySelectorAll(".line-clamp-1, .line-clamp-2"),
    ).toHaveLength(0);
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows only the description when the counts are missing", () => {
    render(<ServerSummary server={{ name: "x", description: "Chat" }} />);
    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.queryByTitle("Users")).not.toBeInTheDocument();
  });

  it("renders an entry with no description and no counts", () => {
    const { container } = render(<ServerSummary server={{ name: "x" }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("isListableServer", () => {
  it("keeps entries with text names and descriptions and drops the rest", () => {
    const entries = [
      { name: "a", description: "text" },
      { name: "b" },
      { name: "c", description: 5 },
      { name: 7 },
      null,
    ] as never[];
    expect(entries.filter(isListableServer)).toEqual([
      { name: "a", description: "text" },
      { name: "b" },
    ]);
  });
});
