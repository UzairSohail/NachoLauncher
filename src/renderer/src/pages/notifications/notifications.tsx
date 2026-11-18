import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@renderer/components";
import { useAppDispatch, useToast } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { logger } from "@renderer/logger";

import { LocalNotificationItem } from "./local-notification-item";
import type { LocalNotification } from "@types";
import "./notifications.scss";

type NotificationFilter = "all" | "unread";

const STAGGER_DELAY_MS = 70;
const EXIT_DURATION_MS = 250;

const byNewest = (a: LocalNotification, b: LocalNotification) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

export default function Notifications() {
  const { t } = useTranslation("notifications_page");
  const { showSuccessToast, showErrorToast } = useToast();
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(setHeaderTitle(t("title")));
  }, [dispatch, t]);

  const [notifications, setNotifications] = useState<LocalNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const clearingTimeoutsRef = useRef<NodeJS.Timeout[]>([]);

  const notifyCountChange = useCallback(() => {
    window.dispatchEvent(new CustomEvent("notificationsChanged"));
  }, []);

  useEffect(() => {
    window.electron
      .getLocalNotifications()
      .then(setNotifications)
      .catch((error) =>
        logger.error("Failed to fetch local notifications", error)
      )
      .finally(() => setIsLoading(false));

    return window.electron.onLocalNotificationCreated((notification) => {
      setNotifications((prev) => [notification, ...prev]);
    });
  }, []);

  useEffect(() => {
    return () => {
      clearingTimeoutsRef.current.forEach(clearTimeout);
    };
  }, []);

  const displayedNotifications = useMemo(() => {
    const visible =
      filter === "unread"
        ? notifications.filter((notification) => !notification.isRead)
        : notifications;
    return [...visible].sort(byNewest);
  }, [notifications, filter]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.isRead).length,
    [notifications]
  );

  const handleMarkAsRead = useCallback(
    async (id: string) => {
      try {
        await window.electron.markLocalNotificationRead(id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
        );
        notifyCountChange();
      } catch (error) {
        logger.error("Failed to mark notification as read", error);
      }
    },
    [notifyCountChange]
  );

  const handleMarkAllAsRead = useCallback(async () => {
    try {
      await window.electron.markAllLocalNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      notifyCountChange();
      showSuccessToast(t("marked_all_as_read"));
    } catch (error) {
      logger.error("Failed to mark all as read", error);
      showErrorToast(t("failed_to_mark_as_read"));
    }
  }, [showSuccessToast, showErrorToast, t, notifyCountChange]);

  const handleDismiss = useCallback(
    async (id: string) => {
      try {
        await window.electron.deleteLocalNotification(id);
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        notifyCountChange();
      } catch (error) {
        logger.error("Failed to dismiss notification", error);
        showErrorToast(t("failed_to_dismiss"));
      }
    },
    [showErrorToast, t, notifyCountChange]
  );

  const removeWithDelay = useCallback(
    (id: string, delayMs: number) =>
      new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          setNotifications((prev) => prev.filter((n) => n.id !== id));
          resolve();
        }, delayMs);
        clearingTimeoutsRef.current.push(timeout);
      }),
    []
  );

  const handleClearAll = useCallback(async () => {
    if (isClearing || displayedNotifications.length === 0) return;

    try {
      setIsClearing(true);
      clearingTimeoutsRef.current.forEach(clearTimeout);
      clearingTimeoutsRef.current = [];

      await Promise.all(
        displayedNotifications.map((notification, index) =>
          removeWithDelay(notification.id, index * STAGGER_DELAY_MS)
        )
      );
      await new Promise((resolve) => setTimeout(resolve, EXIT_DURATION_MS));

      await window.electron.clearAllLocalNotifications();
      notifyCountChange();
      showSuccessToast(t("cleared_all"));
    } catch (error) {
      logger.error("Failed to clear all notifications", error);
      showErrorToast(t("failed_to_clear"));
    } finally {
      setIsClearing(false);
      clearingTimeoutsRef.current = [];
    }
  }, [
    displayedNotifications,
    isClearing,
    removeWithDelay,
    showSuccessToast,
    showErrorToast,
    t,
    notifyCountChange,
  ]);

  const renderTab = (tab: NotificationFilter, label: string) => (
    <div className="notifications__tab-wrapper">
      <button
        type="button"
        className={`notifications__tab ${filter === tab ? "notifications__tab--active" : ""}`}
        onClick={() => setFilter(tab)}
      >
        {label}
        {tab === "unread" && unreadCount > 0 && (
          <span className="notifications__tab-badge">{unreadCount}</span>
        )}
      </button>
      {filter === tab && (
        <motion.div
          className="notifications__tab-underline"
          layoutId="notifications-tab-underline"
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />
      )}
    </div>
  );

  const hasNoNotifications = displayedNotifications.length === 0;

  return (
    <div className="notifications">
      <div className="notifications__header">
        <div className="notifications__filter-tabs">
          {renderTab("all", t("filter_all"))}
          {renderTab("unread", t("filter_unread"))}
        </div>
        <div className="notifications__actions">
          <Button
            theme="outline"
            onClick={handleMarkAllAsRead}
            disabled={isClearing || unreadCount === 0}
          >
            {t("mark_all_as_read")}
          </Button>
          <Button
            theme="danger"
            onClick={handleClearAll}
            disabled={isClearing || hasNoNotifications}
          >
            {t("clear_all")}
          </Button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={filter}
          className="notifications__content-wrapper"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 10 }}
          transition={{ duration: 0.2 }}
        >
          {isLoading ? (
            <div className="notifications__loading">
              <span>{t("loading")}</span>
            </div>
          ) : hasNoNotifications && !isClearing ? (
            <div className="notifications__empty">
              <div className="notifications__icon-container">
                <BellIcon size={24} />
              </div>
              <h2>{t("empty_title")}</h2>
              <p>
                {filter === "unread"
                  ? t("empty_filter_description")
                  : t("empty_description")}
              </p>
            </div>
          ) : (
            <div className="notifications__list">
              <AnimatePresence>
                {displayedNotifications.map((notification) => (
                  <motion.div
                    key={notification.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{
                      opacity: 0,
                      x: 80,
                      transition: { duration: EXIT_DURATION_MS / 1000 },
                    }}
                    transition={{ duration: 0.2 }}
                  >
                    <LocalNotificationItem
                      notification={notification}
                      onDismiss={handleDismiss}
                      onMarkAsRead={handleMarkAsRead}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
