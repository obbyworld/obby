import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect } from "react";
import { FaExclamationTriangle, FaTimesCircle } from "react-icons/fa";
import useStore from "../../store";

export const GlobalNotifications: React.FC = () => {
  const { t } = useLingui();
  const { globalNotifications, removeGlobalNotification } = useStore();

  // Auto-remove notifications after 10 seconds
  useEffect(() => {
    const timeouts = globalNotifications.map((notification) => {
      return setTimeout(() => {
        removeGlobalNotification(notification.id);
      }, 10000); // 10 seconds
    });

    return () => {
      // Clear all timeouts when component unmounts or notifications change
      timeouts.forEach(clearTimeout);
    };
  }, [globalNotifications, removeGlobalNotification]);

  if (globalNotifications.length === 0) {
    return null;
  }

  const getIcon = (type: "fail" | "warn" | "note") => {
    switch (type) {
      case "fail":
        return <FaTimesCircle className="text-red-500 flex-shrink-0" />;
      case "warn":
        return (
          <FaExclamationTriangle className="text-yellow-500 flex-shrink-0" />
        );
      case "note":
        return null; // Notes don't need global notification treatment
      default:
        return null;
    }
  };

  const getBackgroundColor = (type: "fail" | "warn" | "note") => {
    switch (type) {
      case "fail":
        return "bg-red-50 dark:bg-red-950/90 border-red-200 dark:border-red-800";
      case "warn":
        return "bg-yellow-50 dark:bg-yellow-950/90 border-yellow-200 dark:border-yellow-800";
      case "note":
        return "bg-blue-50 dark:bg-blue-950/90 border-blue-200 dark:border-blue-800";
      default:
        return "bg-gray-50 dark:bg-gray-950/90 border-gray-200 dark:border-gray-800";
    }
  };

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  // Show FAIL, WARN, and NOTE notifications globally
  const visibleNotifications = globalNotifications.filter(
    (n: { type: "fail" | "warn" | "note" }) =>
      n.type === "fail" || n.type === "warn" || n.type === "note",
  );

  if (visibleNotifications.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed left-[calc(1rem+var(--safe-area-inset-left,0px))] sm:left-auto z-50 space-y-2 max-w-sm"
      style={{
        top: "calc(1rem + var(--safe-area-inset-top, 0px))",
        right: "calc(1rem + var(--safe-area-inset-right, 0px))",
      }}
    >
      {visibleNotifications.map(
        (notification: {
          id: string;
          type: "fail" | "warn" | "note";
          command: string;
          code: string;
          message: string;
          target?: string;
          serverId: string;
          timestamp: Date;
        }) => (
          <div
            key={notification.id}
            className={`p-3 rounded-lg border shadow-lg ${getBackgroundColor(notification.type)} animate-in slide-in-from-right-2 fade-in duration-300`}
          >
            <div className="flex items-start gap-2">
              {getIcon(notification.type)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {notification.message}
                  </div>
                  <button
                    onClick={() => removeGlobalNotification(notification.id)}
                    className="ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0"
                    aria-label={t`Dismiss notification`}
                  >
                    ×
                  </button>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {formatTime(notification.timestamp)}
                </div>
              </div>
            </div>
          </div>
        ),
      )}
    </div>
  );
};
