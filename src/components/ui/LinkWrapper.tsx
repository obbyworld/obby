import type React from "react";
import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { compactUrl, makeUrlRegex } from "../../lib/ircUtils";
import { openExternalUrl } from "../../lib/openUrl";
import ExternalLinkWarningModal from "./ExternalLinkWarningModal";

interface EnhancedLinkWrapperProps {
  children: React.ReactNode;
  onIrcLinkClick?: (url: string) => void;
}

export const EnhancedLinkWrapper: React.FC<EnhancedLinkWrapperProps> = ({
  children,
  onIrcLinkClick,
}) => {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // dangerouslySetInnerHTML content doesn't go through React's synthetic event
  // system, so we need a DOM listener to intercept those link clicks.
  useEffect(() => {
    const handleDomLinkClick = (e: Event) => {
      const target = e.target as HTMLElement;
      let element: HTMLElement | null = target;
      while (element) {
        if (element.classList.contains("irc-link") && onIrcLinkClick) {
          e.preventDefault();
          e.stopPropagation();
          const url = element.getAttribute("href");
          if (url) {
            onIrcLinkClick(url);
          }
          break;
        }
        if (element.classList.contains("external-link-security")) {
          e.preventDefault();
          e.stopPropagation();
          const url = element.getAttribute("href");
          if (url) {
            setPendingUrl(url);
          }
          break;
        }
        element = element.parentElement;
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener("click", handleDomLinkClick, true);
      return () =>
        container.removeEventListener("click", handleDomLinkClick, true);
    }
  }, [onIrcLinkClick]);

  const handleConfirmOpen = async () => {
    if (pendingUrl) {
      await openExternalUrl(pendingUrl);
    }
    setPendingUrl(null);
  };

  const handleCancelOpen = () => {
    setPendingUrl(null);
  };

  const parseContent = useCallback((content: string): React.ReactNode[] => {
    const parts = content.split(makeUrlRegex());
    const matches = content.match(makeUrlRegex()) || [];

    return parts.map((part, index) => {
      const partKey = `text-${part}-${index}`;
      const textPart = <span key={partKey}>{part}</span>;

      if (index < matches.length) {
        const url = matches[index];
        const isWebLink = !/^ircs?:\/\//i.test(url);
        const fragmentKey = `fragment-${url}-${index}`;
        return (
          <Fragment key={fragmentKey}>
            {textPart}
            <a
              href={/^www\./i.test(url) ? `https://${url}` : url}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-blue-500 underline hover:text-blue-700 break-all ${
                isWebLink ? "external-link-security link-compact" : "irc-link"
              }`}
            >
              {isWebLink ? compactUrl(url) : url}
            </a>
          </Fragment>
        );
      }

      return textPart;
    });
  }, []);

  const processChildren = (node: React.ReactNode): React.ReactNode[] => {
    return (
      Children.map(node, (child) => {
        if (typeof child === "string") {
          return parseContent(child);
        }
        if (isValidElement(child)) {
          // Skip already-linkified anchors to avoid nested <a>
          if ((child as React.ReactElement).type === "a") {
            return child;
          }
          // Skip elements with dangerouslySetInnerHTML to avoid conflicts
          const childProps = (child as React.ReactElement).props as {
            dangerouslySetInnerHTML?: unknown;
            children?: React.ReactNode;
          };
          if (childProps?.dangerouslySetInnerHTML) {
            return child;
          }
          const processed = processChildren(childProps?.children);
          return cloneElement(
            child as React.ReactElement,
            undefined,
            processed,
          );
        }
        return child as React.ReactNode;
      }) ?? []
    );
  };

  return (
    <>
      <ExternalLinkWarningModal
        isOpen={!!pendingUrl}
        url={pendingUrl || ""}
        onConfirm={handleConfirmOpen}
        onCancel={handleCancelOpen}
      />
      <div ref={containerRef} data-link-wrapper>
        {processChildren(children)}
      </div>
    </>
  );
};
