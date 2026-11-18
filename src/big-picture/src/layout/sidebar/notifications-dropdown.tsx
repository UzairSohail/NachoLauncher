import "./notifications-dropdown.scss";

import {
  CheckCircleIcon,
  DotsThreeVerticalIcon,
  DownloadSimpleIcon,
  MinusCircleIcon,
  TrashIcon,
  TrophyIcon,
  XIcon,
} from "@phosphor-icons/react";
import cn from "classnames";
import { createPortal } from "react-dom";
import {
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  ContextMenu,
  FocusItem,
  NavigationLayer,
  type ContextMenuItem,
  ScrollArea,
  VerticalFocusGroup,
} from "../../components";
import { FocusRegionContext } from "../../components/context";
import { IS_DESKTOP } from "../../constants";
import {
  useDate,
  useLibrary,
  useNavigationActions,
  useNavigationScreenActions,
} from "../../hooks";
import { getPreferredGameAssets } from "../../helpers";
import type { LibraryGame, LocalNotification } from "@types";

type MergedNotification = LocalNotification & { source: "local" };

const hydraIconUrl = new URL("../../assets/hydra-icon.svg", import.meta.url)
  .href;
const DROPDOWN_OFFSET = 16;
const DROPDOWN_REGION_ID = "sidebar-notifications-dropdown-region";

interface SidebarNotificationsDropdownProps {
  anchorRef: RefObject<HTMLButtonElement>;
  visible: boolean;
  onClose: () => void;
  onRestoringFocusChange: (isRestoring: boolean) => void;
  onUnreadCountChange: (count: number) => void;
  restoreFocusId: string;
}

interface SidebarNotificationsBackActionProps {
  onBack: () => void;
}

function SidebarNotificationsBackAction({
  onBack,
}: Readonly<SidebarNotificationsBackActionProps>) {
  useNavigationScreenActions({
    press: {
      b: onBack,
    },
  });

  return null;
}

function resolveBigPicturePath(path: string) {
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(path)) return path;
  if (path.startsWith("/big-picture")) return path;
  return `/big-picture${path}`;
}

function getNotificationContent(notification: MergedNotification) {
  return {
    title: notification.title,
    description: notification.description,
  };
}

function isAppNotification(notification: MergedNotification) {
  return (
    notification.source === "local" &&
    (notification.type === "UPDATE_AVAILABLE" ||
      notification.type === "SCAN_GAMES_COMPLETE")
  );
}

function isAchievementNotification(notification: MergedNotification) {
  return (
    notification.source === "local" &&
    notification.type === "ACHIEVEMENT_UNLOCKED"
  );
}

function getNotificationUrl(notification: MergedNotification) {
  return notification.url ?? null;
}

function getNotificationGameRoute(notification: MergedNotification) {
  const url = getNotificationUrl(notification);
  if (!url) return null;

  const pathname = url.startsWith("/big-picture")
    ? url.slice("/big-picture".length) || "/"
    : url;
  const match = pathname.match(/^\/game\/([^/?#]+)\/([^/?#]+)/);
  if (!match) return null;

  return {
    shop: decodeURIComponent(match[1]),
    objectId: decodeURIComponent(match[2]),
  };
}

function getGameImageUrlFromLibrary(
  notification: MergedNotification,
  library: LibraryGame[]
) {
  if (notification.pictureUrl) return notification.pictureUrl;

  const gameRoute = getNotificationGameRoute(notification);
  if (!gameRoute) return null;

  const game = library.find(
    (libraryGame) =>
      libraryGame.shop === gameRoute.shop &&
      libraryGame.objectId === gameRoute.objectId
  );

  return getPreferredGameAssets(game, null).iconUrl;
}

function getNotificationFocusKey(notification: MergedNotification) {
  return `${notification.source}:${notification.id}`;
}

function getNotificationItemFocusId(notification: MergedNotification) {
  return `sidebar-notifications-dropdown-item:${getNotificationFocusKey(notification)}`;
}

function getNotificationMenuFocusId(notification: MergedNotification) {
  return `sidebar-notifications-dropdown-menu:${getNotificationFocusKey(notification)}`;
}

export function SidebarNotificationsDropdown({
  anchorRef,
  visible,
  onClose,
  onRestoringFocusChange,
  onUnreadCountChange,
  restoreFocusId,
}: Readonly<SidebarNotificationsDropdownProps>) {
  const navigate = useNavigate();
  const { formatDistance } = useDate();
  const { library } = useLibrary();
  const { setFocus } = useNavigationActions();
  const [localNotifications, setLocalNotifications] = useState<
    LocalNotification[]
  >([]);
  const [menuNotification, setMenuNotification] =
    useState<MergedNotification | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [dropdownPosition, setDropdownPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  const fetchLocalNotifications = useCallback(async () => {
    if (!IS_DESKTOP) return;

    const notifications =
      await globalThis.window.electron.getLocalNotifications();
    setLocalNotifications(notifications);
  }, []);

  const refreshNotifications = useCallback(() => {
    if (!IS_DESKTOP) return;

    void fetchLocalNotifications();
  }, [fetchLocalNotifications]);

  useEffect(() => {
    refreshNotifications();
  }, [refreshNotifications]);

  useEffect(() => {
    if (!visible) return;
    refreshNotifications();
  }, [refreshNotifications, visible]);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    const unsubscribeLocal =
      globalThis.window.electron.onLocalNotificationCreated((notification) => {
        setLocalNotifications((current) => [notification, ...current]);
      });
    const handleNotificationsChanged = () => {
      refreshNotifications();
    };

    globalThis.window.addEventListener(
      "notificationsChanged",
      handleNotificationsChanged
    );

    return () => {
      unsubscribeLocal();
      globalThis.window.removeEventListener(
        "notificationsChanged",
        handleNotificationsChanged
      );
    };
  }, [refreshNotifications]);

  const mergedNotifications = useMemo<MergedNotification[]>(
    () =>
      localNotifications
        .map((notification) => ({ ...notification, source: "local" as const }))
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ),
    [localNotifications]
  );

  const unreadCount = useMemo(
    () =>
      localNotifications.filter((notification) => !notification.isRead).length,
    [localNotifications]
  );

  useEffect(() => {
    onUnreadCountChange(unreadCount);
  }, [onUnreadCountChange, unreadCount]);

  const initialFocusId =
    mergedNotifications.length > 0
      ? getNotificationItemFocusId(mergedNotifications[0])
      : undefined;

  useLayoutEffect(() => {
    if (!visible) return;

    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;

    setDropdownPosition({
      left: rect.right + DROPDOWN_OFFSET,
      top: rect.top - 24,
    });
  }, [anchorRef, visible]);

  const notifyCountChange = () => {
    globalThis.window.dispatchEvent(new CustomEvent("notificationsChanged"));
  };

  const closeAndRestoreFocus = useCallback(() => {
    onRestoringFocusChange(true);
    onClose();
    globalThis.window.requestAnimationFrame(() => {
      setFocus(restoreFocusId);
      globalThis.window.requestAnimationFrame(() => {
        onRestoringFocusChange(false);
      });
    });
  }, [onClose, onRestoringFocusChange, restoreFocusId, setFocus]);

  useEffect(() => {
    if (!visible) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(".sidebar-notifications-dropdown") ||
        target?.closest(".context-menu") ||
        target === anchorRef.current ||
        anchorRef.current?.contains(target)
      ) {
        return;
      }

      closeAndRestoreFocus();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAndRestoreFocus();
    };

    globalThis.document.addEventListener("mousedown", handlePointerDown);
    globalThis.window.addEventListener("keydown", handleEscape);

    return () => {
      globalThis.document.removeEventListener("mousedown", handlePointerDown);
      globalThis.window.removeEventListener("keydown", handleEscape);
    };
  }, [anchorRef, closeAndRestoreFocus, visible]);

  const markAsRead = async (notification: MergedNotification) => {
    await globalThis.window.electron.markLocalNotificationRead(notification.id);
    setLocalNotifications((current) =>
      current.map((item) =>
        item.id === notification.id ? { ...item, isRead: true } : item
      )
    );
    notifyCountChange();
  };

  const markAsUnread = async (notification: MergedNotification) => {
    await globalThis.window.electron.markLocalNotificationUnread(
      notification.id
    );
    setLocalNotifications((current) =>
      current.map((item) =>
        item.id === notification.id ? { ...item, isRead: false } : item
      )
    );
    notifyCountChange();
  };

  const dismissNotification = async (notification: MergedNotification) => {
    await globalThis.window.electron.deleteLocalNotification(notification.id);
    setLocalNotifications((current) =>
      current.filter((item) => item.id !== notification.id)
    );
    notifyCountChange();
  };

  const openNotification = async (notification: MergedNotification) => {
    if (!notification.isRead) {
      await markAsRead(notification);
    }

    const url = getNotificationUrl(notification);
    if (url) {
      navigate(resolveBigPicturePath(url));
      closeAndRestoreFocus();
    }
  };

  const openMenuFromElement = (
    element: HTMLElement | null,
    notification: MergedNotification
  ) => {
    if (!element) return;

    const rect = element.getBoundingClientRect();
    setMenuNotification(notification);
    setMenuPosition({ x: rect.right, y: rect.top });
  };

  const openMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    notification: MergedNotification
  ) => {
    event.stopPropagation();
    setMenuNotification(notification);
    setMenuPosition({ x: event.clientX, y: event.clientY });
  };

  const buildMenuItems = (
    notification: MergedNotification
  ): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    const notificationUrl = getNotificationUrl(notification);

    if (
      notification.source === "local" &&
      notification.type === "UPDATE_AVAILABLE"
    ) {
      items.push({
        id: "update-now",
        label: "Update Now",
        icon: <CheckCircleIcon size={18} />,
        onSelect: () => globalThis.window.electron.restartAndInstallUpdate(),
      });
    }

    if (
      notificationUrl &&
      notification.source === "local" &&
      (notification.type === "DOWNLOAD_COMPLETE" ||
        notification.type === "EXTRACTION_COMPLETE")
    ) {
      items.push({
        id: "open-game",
        label: "Open Game",
        icon: <DownloadSimpleIcon size={18} />,
        onSelect: () => {
          navigate(resolveBigPicturePath(notificationUrl));
          closeAndRestoreFocus();
        },
      });
    }

    items.push(
      notification.isRead
        ? {
            id: "mark-unread",
            label: "Mark as Unread",
            icon: <MinusCircleIcon size={18} />,
            onSelect: () => markAsUnread(notification),
          }
        : {
            id: "mark-read",
            label: "Mark as Read",
            icon: <CheckCircleIcon size={18} />,
            onSelect: () => markAsRead(notification),
          },
      {
        id: "dismiss",
        label: "Dismiss Notification",
        icon: <TrashIcon size={18} />,
        danger: true,
        onSelect: () => dismissNotification(notification),
      }
    );

    return items;
  };

  const renderNotificationIcon = (notification: MergedNotification) => {
    const gameImageUrl = getGameImageUrlFromLibrary(notification, library);

    if (gameImageUrl) {
      return <img src={gameImageUrl} alt="" />;
    }

    if (isAchievementNotification(notification)) {
      return (
        <div className="sidebar-notifications-dropdown__fallback-icon">
          <TrophyIcon
            size={24}
            className="sidebar-notifications-dropdown__fallback-symbol"
          />
        </div>
      );
    }

    if (isAppNotification(notification)) {
      return (
        <div className="sidebar-notifications-dropdown__fallback-icon">
          <img
            src={hydraIconUrl}
            alt=""
            className="sidebar-notifications-dropdown__fallback-image"
          />
        </div>
      );
    }

    return (
      <div className="sidebar-notifications-dropdown__fallback-icon">
        <img
          src={hydraIconUrl}
          alt=""
          className="sidebar-notifications-dropdown__fallback-image"
        />
      </div>
    );
  };

  if (!visible || globalThis.document === undefined) {
    return null;
  }

  const portalTarget =
    globalThis.document.getElementById("big-picture") ??
    globalThis.document.getElementById("root") ??
    globalThis.document.body;

  return createPortal(
    <FocusRegionContext.Provider value={null}>
      <NavigationLayer
        rootRegionId={DROPDOWN_REGION_ID}
        initialFocusId={initialFocusId}
      >
        <VerticalFocusGroup regionId={DROPDOWN_REGION_ID} asChild>
          <div
            className="sidebar-notifications-dropdown"
            style={{
              left: dropdownPosition?.left ?? 316,
              top: dropdownPosition?.top ?? 24,
            }}
          >
            <div className="sidebar-notifications-dropdown__header">
              <div className="sidebar-notifications-dropdown__title">
                Notifications
                {unreadCount > 0 ? (
                  <span className="sidebar-notifications-dropdown__badge">
                    {unreadCount}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="sidebar-notifications-dropdown__close"
                onClick={closeAndRestoreFocus}
                aria-label="Close notifications"
              >
                <XIcon size={28} />
              </button>
            </div>

            <div className="sidebar-notifications-dropdown__divider" />

            <ScrollArea className="sidebar-notifications-dropdown__scroll">
              <div className="sidebar-notifications-dropdown__list">
                {mergedNotifications.length === 0 ? (
                  <div className="sidebar-notifications-dropdown__empty">
                    No notifications
                  </div>
                ) : (
                  mergedNotifications.map((notification, index) => {
                    const content = getNotificationContent(notification);
                    const createdAt = new Date(notification.createdAt);
                    const itemFocusId =
                      getNotificationItemFocusId(notification);
                    const menuFocusId =
                      getNotificationMenuFocusId(notification);
                    const previousNotification = mergedNotifications[index - 1];
                    const nextNotification = mergedNotifications[index + 1];

                    return (
                      <FocusItem
                        key={`${notification.source}-${notification.id}`}
                        id={itemFocusId}
                        actions={{
                          primary: () => {
                            void openNotification(notification);
                          },
                          press: {
                            y: ({ itemId }) => {
                              openMenuFromElement(
                                globalThis.document.getElementById(itemId),
                                notification
                              );
                            },
                          },
                        }}
                        navigationOverrides={{
                          up: previousNotification
                            ? {
                                type: "item",
                                itemId:
                                  getNotificationItemFocusId(
                                    previousNotification
                                  ),
                              }
                            : {
                                type: "block",
                              },
                          down: nextNotification
                            ? {
                                type: "item",
                                itemId:
                                  getNotificationItemFocusId(nextNotification),
                              }
                            : {
                                type: "block",
                              },
                          right: {
                            type: "item",
                            itemId: menuFocusId,
                          },
                        }}
                        asChild
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          data-navigation-click
                          className={cn(
                            "sidebar-notifications-dropdown__item",
                            {
                              "sidebar-notifications-dropdown__item--unread":
                                !notification.isRead,
                            }
                          )}
                          onClick={() => {
                            void openNotification(notification);
                          }}
                          onKeyDown={(event) => {
                            if (event.currentTarget !== event.target) return;
                            if (event.key !== "Enter" && event.key !== " ") {
                              return;
                            }

                            event.preventDefault();
                            void openNotification(notification);
                          }}
                        >
                          <div className="sidebar-notifications-dropdown__media">
                            {renderNotificationIcon(notification)}
                            {!notification.isRead ? (
                              <span className="sidebar-notifications-dropdown__unread-dot" />
                            ) : null}
                          </div>
                          <div className="sidebar-notifications-dropdown__content">
                            <div className="sidebar-notifications-dropdown__item-title">
                              {content.title}
                            </div>
                            <div className="sidebar-notifications-dropdown__description">
                              {content.description}
                            </div>
                          </div>
                          <div className="sidebar-notifications-dropdown__meta">
                            <span>
                              {formatDistance(createdAt, new Date(), {
                                addSuffix: true,
                              })}
                            </span>
                            <FocusItem
                              id={menuFocusId}
                              actions={{
                                primary: "auto",
                                press: {
                                  y: ({ itemId }) => {
                                    openMenuFromElement(
                                      globalThis.document.getElementById(
                                        itemId
                                      ),
                                      notification
                                    );
                                  },
                                },
                              }}
                              navigationOverrides={{
                                left: {
                                  type: "item",
                                  itemId: itemFocusId,
                                },
                                up: previousNotification
                                  ? {
                                      type: "item",
                                      itemId:
                                        getNotificationMenuFocusId(
                                          previousNotification
                                        ),
                                    }
                                  : {
                                      type: "block",
                                    },
                                down: nextNotification
                                  ? {
                                      type: "item",
                                      itemId:
                                        getNotificationMenuFocusId(
                                          nextNotification
                                        ),
                                    }
                                  : {
                                      type: "block",
                                    },
                                right: {
                                  type: "block",
                                },
                              }}
                              asChild
                            >
                              <button
                                type="button"
                                className="sidebar-notifications-dropdown__menu-button"
                                onClick={(event) =>
                                  openMenu(event, notification)
                                }
                                aria-label="Open notification menu"
                              >
                                <DotsThreeVerticalIcon size={24} />
                              </button>
                            </FocusItem>
                          </div>
                        </div>
                      </FocusItem>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        </VerticalFocusGroup>
      </NavigationLayer>

      <ContextMenu
        visible={Boolean(menuNotification)}
        position={menuPosition}
        items={menuNotification ? buildMenuItems(menuNotification) : []}
        onClose={() => setMenuNotification(null)}
        ariaLabel="Notification menu"
      />
      {!menuNotification ? (
        <SidebarNotificationsBackAction onBack={closeAndRestoreFocus} />
      ) : null}
    </FocusRegionContext.Provider>,
    portalTarget
  );
}
