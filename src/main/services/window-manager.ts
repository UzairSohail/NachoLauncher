import { is } from "@electron-toolkit/utils";
import { isStaging } from "@main/constants";
import { db, gamesSublevel, levelKeys } from "@main/level";
import icon from "@resources/icon.png?asset";
import trayIconDark from "@resources/tray-icon-dark.png?asset";
import trayIcon from "@resources/tray-icon.png?asset";
import {
  MAIN_WINDOW_TITLE_BAR_HEIGHT,
  NATIVE_WINDOW_DECORATIONS_ARGUMENT,
} from "@shared";
import type {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
  ScreenState,
  UserPreferences,
} from "@types";
import {
  BrowserWindow,
  Menu,
  MenuItem,
  MenuItemConstructorOptions,
  Tray,
  app,
  nativeImage,
  nativeTheme,
  screen,
  shell,
} from "electron";
import { t } from "i18next";
import { orderBy } from "lodash-es";
import path from "node:path";
import UserAgent from "user-agents";
import { logger } from "./logger";
import {
  addSteamGridDbCacheControl,
  isSteamGridDbArtworkRequest,
} from "./steam-grid-db-cache";
import { getRetroAchievementsConnectionWindowLayout } from "./retroachievements-connection-window-layout";

const isLinuxWayland =
  process.platform === "linux" &&
  (process.env.XDG_SESSION_TYPE === "wayland" ||
    Boolean(process.env.WAYLAND_DISPLAY));

interface CreateMainWindowOptions {
  forceBigPicture?: boolean;
  /** Open the desktop window even if Big Picture is the launch preference. */
  skipBigPicture?: boolean;
}

export class WindowManager {
  private static mainWindowInstance: Electron.BrowserWindow | null = null;
  private static gameLauncherWindowInstance: Electron.BrowserWindow | null =
    null;
  private static bigPicture: Electron.BrowserWindow | null = null;
  private static mainWindowShownResult: boolean | null = null;
  private static mainWindowShownListeners: Array<(shown: boolean) => void> = [];
  private static retroAchievementsConnectionWindow: Electron.BrowserWindow | null =
    null;
  private static deferredMainMaximize = false;

  private static isArtworkRendererRequest(
    webContentsId: number | undefined
  ): boolean {
    return [this.mainWindow, this.bigPicture].some(
      (window) =>
        window != null &&
        !window.isDestroyed() &&
        window.webContents.id === webContentsId
    );
  }

  private static readonly editorWindows: Map<string, BrowserWindow> = new Map();

  public static get mainWindow(): Electron.BrowserWindow | null {
    return this.mainWindowInstance;
  }

  public static get bigPictureWindow(): Electron.BrowserWindow | null {
    return this.bigPicture && !this.bigPicture.isDestroyed()
      ? this.bigPicture
      : null;
  }

  public static get gameLauncherWindow(): Electron.BrowserWindow | null {
    return this.gameLauncherWindowInstance;
  }

  public static clearMainWindow(): void {
    this.mainWindowInstance = null;
  }

  // A hidden desktop window keeps its whole renderer in memory. When nobody
  // can see it (Big Picture is open, or Nacho hid itself for a game) it is
  // closed instead and created again when it is next needed, the same way
  // closing it to the tray already works.
  private static releasingMainWindow = false;
  private static appQuitting = false;

  public static markAppQuitting() {
    this.appQuitting = true;
  }

  public static releaseMainWindow() {
    const main = this.mainWindow;
    if (!main || main.isDestroyed()) return;

    this.releasingMainWindow = true;
    main.close();
  }

  private static readonly DEFAULT_WINDOW_WIDTH = 1200;
  private static readonly DEFAULT_WINDOW_HEIGHT = 860;
  private static readonly MIN_WINDOW_WIDTH = 1024;
  private static readonly MIN_WINDOW_HEIGHT = 600;

  private static initialConfigInitializationMainWindow: Electron.BrowserWindowConstructorOptions =
    {
      width: WindowManager.DEFAULT_WINDOW_WIDTH,
      height: WindowManager.DEFAULT_WINDOW_HEIGHT,
      minWidth: WindowManager.MIN_WINDOW_WIDTH,
      minHeight: WindowManager.MIN_WINDOW_HEIGHT,
      icon,
      // Centers the traffic lights in the title bar.
      trafficLightPosition: { x: 16, y: 13 },
      show: false,
    };

  private static hasNativeWindowDecorations = false;

  public static async loadWindowDecorationsPreference() {
    if (process.platform !== "linux") return;

    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    this.hasNativeWindowDecorations = Boolean(
      userPreferences?.useNativeWindowDecorations
    );
  }

  private static getMainWindowFrameOptions(): Electron.BrowserWindowConstructorOptions {
    if (process.platform !== "linux") {
      return {
        backgroundColor: "#1c1c1c",
        titleBarStyle: "hidden",
        titleBarOverlay: {
          symbolColor: "#DADBE1",
          color: "#00000000",
          height: MAIN_WINDOW_TITLE_BAR_HEIGHT,
        },
      };
    }

    if (this.hasNativeWindowDecorations) {
      return { frame: true, backgroundColor: "#1c1c1c" };
    }

    return {
      frame: false,
      ...(isLinuxWayland
        ? { transparent: true, backgroundColor: "#00000000" }
        : { backgroundColor: "#1c1c1c" }),
    };
  }

  private static getDecoratedWindowWebPreferences(): Electron.WebPreferences {
    return {
      preload: path.join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      additionalArguments: this.hasNativeWindowDecorations
        ? [NATIVE_WINDOW_DECORATIONS_ARGUMENT]
        : [],
    };
  }

  private static formatVersionNumber(version: string) {
    return version.replaceAll(".", "-");
  }

  public static async loadWindowURL(window: BrowserWindow, hash: string = "") {
    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}#/${hash}`);
    } else if (import.meta.env.MAIN_VITE_LAUNCHER_SUBDOMAIN) {
      // Try to load from remote URL in production
      try {
        await window.loadURL(
          `https://release-v${this.formatVersionNumber(app.getVersion())}.${import.meta.env.MAIN_VITE_LAUNCHER_SUBDOMAIN}#/${hash}`
        );
      } catch (error) {
        // Fall back to local file if remote URL fails
        logger.error(
          "Failed to load from MAIN_VITE_LAUNCHER_SUBDOMAIN, falling back to local file:",
          error
        );
        window.loadFile(path.join(__dirname, "../renderer/index.html"), {
          hash,
        });
      }
    } else {
      window.loadFile(path.join(__dirname, "../renderer/index.html"), {
        hash,
      });
    }
  }

  private static async loadMainWindowURL(hash: string = "") {
    if (this.mainWindow) {
      await this.loadWindowURL(this.mainWindow, hash);
    }
  }

  private static disableMainWindowWhileBigPictureIsOpen() {
    this.releaseMainWindow();
  }

  private static restoreMainWindowAfterBigPictureCloses() {
    const main = this.mainWindow;

    if (!main || main.isDestroyed()) return;

    main.setIgnoreMouseEvents(false);
    main.setFocusable(true);
    main.setSkipTaskbar(false);
  }

  public static get appWindows() {
    return [this.mainWindow, this.bigPicture];
  }

  public static sendToAppWindows(channel: string, ...args: unknown[]) {
    const windows = [this.mainWindow, this.bigPicture];

    for (const window of windows) {
      if (!window || window.isDestroyed()) continue;
      window.webContents.send(channel, ...args);
    }
  }

  public static sendDownloadsUpdated() {
    this.sendToAppWindows("on-downloads-updated");
  }

  private static async saveScreenConfig(configScreenWhenClosed: ScreenState) {
    await db.put(levelKeys.screenState, configScreenWhenClosed, {
      valueEncoding: "json",
    });
  }

  private static async loadScreenConfig() {
    const data = await db.get<string, ScreenState | undefined>(
      levelKeys.screenState,
      {
        valueEncoding: "json",
      }
    );
    return (
      data ?? {
        isMaximized: false,
        height: this.DEFAULT_WINDOW_HEIGHT,
        width: this.DEFAULT_WINDOW_WIDTH,
      }
    );
  }

  private static fitToWorkArea<
    T extends { x?: number; y?: number; width?: number; height?: number },
  >(bounds: T) {
    const savedWidth = bounds.width ?? this.DEFAULT_WINDOW_WIDTH;
    const savedHeight = bounds.height ?? this.DEFAULT_WINDOW_HEIGHT;
    const savedX = bounds.x;
    const savedY = bounds.y;
    const hasSavedPosition = savedX !== undefined && savedY !== undefined;

    const { workArea } = hasSavedPosition
      ? screen.getDisplayMatching({
          x: savedX,
          y: savedY,
          width: savedWidth,
          height: savedHeight,
        })
      : screen.getPrimaryDisplay();

    const minWidth = Math.min(this.MIN_WINDOW_WIDTH, workArea.width);
    const minHeight = Math.min(this.MIN_WINDOW_HEIGHT, workArea.height);

    const width = Math.max(minWidth, Math.min(savedWidth, workArea.width));
    const height = Math.max(minHeight, Math.min(savedHeight, workArea.height));

    if (!hasSavedPosition) {
      return { ...bounds, minWidth, minHeight, width, height };
    }

    const maxX = Math.max(workArea.x, workArea.x + workArea.width - width);
    const maxY = Math.max(workArea.y, workArea.y + workArea.height - height);

    return {
      ...bounds,
      minWidth,
      minHeight,
      width,
      height,
      x: Math.min(Math.max(savedX, workArea.x), maxX),
      y: Math.min(Math.max(savedY, workArea.y), maxY),
    };
  }

  private static updateInitialConfig(
    newConfig: Partial<Electron.BrowserWindowConstructorOptions>
  ) {
    this.initialConfigInitializationMainWindow = {
      ...this.initialConfigInitializationMainWindow,
      ...newConfig,
    };
  }

  public static async createMainWindow(options?: CreateMainWindowOptions) {
    if (this.mainWindow) return;

    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    const { isMaximized = false, ...configWithoutMaximized } =
      await this.loadScreenConfig();

    this.updateInitialConfig(this.fitToWorkArea(configWithoutMaximized));

    const mainWindow = new BrowserWindow({
      ...this.initialConfigInitializationMainWindow,
      ...this.getMainWindowFrameOptions(),
      webPreferences: this.getDecoratedWindowWebPreferences(),
    });
    this.mainWindowInstance = mainWindow;

    this.deferredMainMaximize = false;

    const emitMaximizeState = () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          "on-window-maximize-change",
          mainWindow.isMaximized()
        );
      }
    };
    mainWindow.on("maximize", emitMaximizeState);
    mainWindow.on("unmaximize", emitMaximizeState);

    const shouldLaunchInBigPicture =
      !options?.skipBigPicture &&
      (options?.forceBigPicture ||
        Boolean(userPreferences?.launchInBigPicture));

    if (shouldLaunchInBigPicture) {
      mainWindow.setOpacity(0);
      mainWindow.setSkipTaskbar(true);
      if (isMaximized) {
        this.deferredMainMaximize = true;
      }
    } else if (isMaximized) {
      mainWindow.maximize();
    }

    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
      (details, callback) => {
        if (
          !this.isArtworkRendererRequest(details.webContentsId) ||
          details.url.includes("chatwoot")
        ) {
          return callback(details);
        }

        if (details.url.includes("workwonders")) {
          return callback({
            ...details,
            requestHeaders: {
              Origin: "https://workwonders.app",
              ...details.requestHeaders,
            },
          });
        }

        const userAgent = new UserAgent();

        callback({
          requestHeaders: {
            ...details.requestHeaders,
            "user-agent": userAgent.toString(),
          },
        });
      }
    );

    mainWindow.webContents.session.webRequest.onHeadersReceived(
      (details, callback) => {
        const isArtworkRendererRequest = this.isArtworkRendererRequest(
          details.webContentsId
        );
        const responseHeaders =
          isArtworkRendererRequest && isSteamGridDbArtworkRequest(details)
            ? addSteamGridDbCacheControl(details.responseHeaders)
            : details.responseHeaders;

        if (
          !isArtworkRendererRequest ||
          details.url.includes("featurebase") ||
          details.url.includes("chatwoot") ||
          details.url.includes("workwonders")
        ) {
          return callback({ ...details, responseHeaders });
        }

        const headers = {
          "access-control-allow-origin": ["*"],
          "access-control-allow-methods": ["GET, POST, PUT, DELETE, OPTIONS"],
          "access-control-expose-headers": ["ETag"],
          "access-control-allow-headers": [
            "Content-Type, Authorization, X-Requested-With, If-None-Match",
          ],
        };
        if (details.method === "OPTIONS") {
          return callback({
            cancel: false,
            responseHeaders: {
              ...responseHeaders,
              ...headers,
            },
            statusLine: "HTTP/1.1 200 OK",
          });
        }

        return callback({
          responseHeaders: {
            ...responseHeaders,
            ...headers,
          },
        });
      }
    );

    const initialHash = userPreferences?.launchToLibraryPage ? "library" : "";

    this.loadMainWindowURL(initialHash);
    mainWindow.removeMenu();

    mainWindow.on("ready-to-show", () => {
      if (!app.isPackaged || isStaging)
        WindowManager.mainWindow?.webContents.openDevTools();
      if (shouldLaunchInBigPicture) {
        void WindowManager.openBigPictureWindow();
        WindowManager.notifyMainWindowShown(false);
      } else {
        WindowManager.mainWindow?.show();
        WindowManager.notifyMainWindowShown(true);
      }
    });

    mainWindow.on("close", async () => {
      const isRelease = this.releasingMainWindow;
      // A window opened straight into Big Picture was never maximized yet.
      const wasDeferredMaximize = this.deferredMainMaximize;
      this.releasingMainWindow = false;
      this.mainWindowInstance = null;

      const userPreferences = await db.get<string, UserPreferences>(
        levelKeys.userPreferences,
        {
          valueEncoding: "json",
        }
      );

      mainWindow.setProgressBar(-1);

      const lastBounds = mainWindow.getBounds();
      const isMaximized =
        (mainWindow.isMaximized() ?? false) || wasDeferredMaximize;
      const screenConfig = isMaximized
        ? {
            x: undefined,
            y: undefined,
            height:
              this.initialConfigInitializationMainWindow.height ??
              this.DEFAULT_WINDOW_HEIGHT,
            width:
              this.initialConfigInitializationMainWindow.width ??
              this.DEFAULT_WINDOW_WIDTH,
            isMaximized: true,
          }
        : { ...lastBounds, isMaximized };

      await this.saveScreenConfig(screenConfig);

      if (userPreferences?.preferQuitInsteadOfHiding && !isRelease) {
        app.quit();
      }
    });

    mainWindow.webContents.setWindowOpenHandler((handler) => {
      shell.openExternal(handler.url);
      return { action: "deny" };
    });
  }

  public static isBigPictureSender(sender: Electron.WebContents) {
    return (
      this.bigPicture !== null &&
      !this.bigPicture.isDestroyed() &&
      this.bigPicture.webContents === sender
    );
  }

  public static async openBigPictureWindow() {
    if (this.bigPicture) {
      this.bigPicture.focus();
      return;
    }

    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    const mainWindow = this.mainWindow;
    const targetDisplay =
      mainWindow && !mainWindow.isDestroyed()
        ? screen.getDisplayMatching(mainWindow.getBounds())
        : screen.getPrimaryDisplay();
    const targetBounds = targetDisplay.bounds;

    this.bigPicture = new BrowserWindow({
      x: targetBounds.x,
      y: targetBounds.y,
      width: targetBounds.width,
      height: targetBounds.height,
      backgroundColor: "#0a0a0a",
      icon,
      frame: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
    });

    this.bigPicture.removeMenu();

    if (!app.isPackaged || isStaging) {
      this.bigPicture.webContents.openDevTools();
    }

    const bigPictureInitialHash =
      (userPreferences?.bigPictureLaunchToLibraryPage ??
      userPreferences?.launchToLibraryPage)
        ? "big-picture/library"
        : "big-picture";

    this.loadWindowURL(this.bigPicture, bigPictureInitialHash);

    this.bigPicture.once("ready-to-show", () => {
      const main = this.mainWindow;
      if (main && !main.isDestroyed()) {
        main.setOpacity(1);
        this.disableMainWindowWhileBigPictureIsOpen();
      }
      this.bigPicture?.show();
      this.bigPicture?.setFullScreen(true);
      this.bigPicture?.focus();
    });

    this.bigPicture.on("closed", () => {
      this.bigPicture = null;
      const main = this.mainWindow;
      if (!main || main.isDestroyed()) {
        // The desktop window was closed while Big Picture was open.
        if (!this.appQuitting) {
          void this.createMainWindow({ skipBigPicture: true });
        }
        return;
      }
      this.restoreMainWindowAfterBigPictureCloses();
      if (WindowManager.deferredMainMaximize) {
        main.maximize();
        WindowManager.deferredMainMaximize = false;
      }
      main.show();
      main.focus();
    });
  }

  public static waitForMainWindowShown() {
    if (this.mainWindowShownResult !== null) {
      return Promise.resolve(this.mainWindowShownResult);
    }

    return new Promise<boolean>((resolve) => {
      this.mainWindowShownListeners.push(resolve);
    });
  }

  private static notifyMainWindowShown(shown: boolean) {
    this.mainWindowShownResult = shown;
    const listeners = this.mainWindowShownListeners;
    this.mainWindowShownListeners = [];
    for (const listener of listeners) listener(shown);
  }

  public static isBigPictureOpen() {
    return Boolean(this.bigPicture && !this.bigPicture.isDestroyed());
  }

  public static isMainWindowFocused() {
    const mainWindow = this.mainWindow;
    return Boolean(
      mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.isVisible() &&
        !mainWindow.isMinimized() &&
        mainWindow.isFocused()
    );
  }

  public static sendToFirstLoadedWindow(channel: string, ...args: unknown[]) {
    const window = [this.mainWindow].find(
      (candidate) =>
        candidate &&
        !candidate.isDestroyed() &&
        !candidate.webContents.isLoading()
    );

    window?.webContents.send(channel, ...args);
    return Boolean(window);
  }

  public static minimizeMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.minimize();
    }
  }

  public static toggleMaximizeMainWindow() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    if (this.mainWindow.isMaximized()) {
      this.mainWindow.unmaximize();
    } else {
      this.mainWindow.maximize();
    }
  }

  public static closeMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.close();
    }
  }

  public static isMainWindowMaximized() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return false;
    return this.mainWindow.isMaximized();
  }

  private static focusMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.show();
      this.mainWindow.focus();
    } else {
      this.createMainWindow();
    }
  }

  public static focusMainWindowAndNavigate(path: string) {
    this.focusMainWindow();
    this.mainWindow?.webContents.send("on-navigate", path);
  }

  public static openRetroAchievementsConnectionWindow() {
    const existingWindow = this.retroAchievementsConnectionWindow;
    if (existingWindow && !existingWindow.isDestroyed()) {
      if (existingWindow.isMinimized()) existingWindow.restore();
      existingWindow.focus();
      return;
    }

    const parentWindow = this.mainWindow;
    if (!parentWindow || parentWindow.isDestroyed()) return;

    const layout = getRetroAchievementsConnectionWindowLayout(
      process.platform,
      this.hasNativeWindowDecorations
    );
    const connectionWindow = new BrowserWindow({
      width: layout.width,
      height: layout.height,
      title: "Nacho",
      backgroundColor: "#1c1c1c",
      parent: parentWindow,
      modal: true,
      show: false,
      maximizable: false,
      resizable: false,
      minimizable: layout.minimizable,
      frame: layout.frame,
      icon,
      webPreferences: this.getDecoratedWindowWebPreferences(),
    });

    this.retroAchievementsConnectionWindow = connectionWindow;
    connectionWindow.removeMenu();
    void this.loadWindowURL(connectionWindow, "retroachievements-connection");

    connectionWindow.once("ready-to-show", () => {
      connectionWindow.show();
      if (!app.isPackaged || isStaging) {
        connectionWindow.webContents.openDevTools();
      }
    });

    connectionWindow.once("closed", () => {
      this.retroAchievementsConnectionWindow = null;
      if (!parentWindow.isDestroyed()) parentWindow.focus();
    });
  }

  public static minimizeRetroAchievementsConnectionWindow() {
    const connectionWindow = this.retroAchievementsConnectionWindow;
    if (connectionWindow && !connectionWindow.isDestroyed()) {
      connectionWindow.minimize();
    }
  }

  public static closeRetroAchievementsConnectionWindow() {
    const connectionWindow = this.retroAchievementsConnectionWindow;
    if (connectionWindow && !connectionWindow.isDestroyed()) {
      connectionWindow.close();
    }
  }

  public static completeRetroAchievementsConnectionWindow() {
    this.sendToAppWindows("on-retroachievements-connected");
    this.closeRetroAchievementsConnectionWindow();
  }

  public static sendAchievementToFocusedWindow(
    position: AchievementCustomNotificationPosition,
    achievements: AchievementNotificationInfo[]
  ): boolean {
    const candidates = [this.bigPicture, this.mainWindow];

    for (const window of candidates) {
      if (window && !window.isDestroyed() && window.isFocused()) {
        window.webContents.send(
          "on-achievement-unlocked-in-app",
          position,
          achievements
        );
        return true;
      }
    }

    return false;
  }

  public static openEditorWindow(themeId: string) {
    if (this.mainWindow) {
      const existingWindow = this.editorWindows.get(themeId);
      if (existingWindow) {
        if (existingWindow.isMinimized()) {
          existingWindow.restore();
        }
        existingWindow.focus();
        return;
      }

      const editorWindow = new BrowserWindow({
        width: 720,
        height: 720,
        minWidth: 600,
        minHeight: 540,
        backgroundColor: "#1c1c1c",
        titleBarStyle: process.platform === "linux" ? "default" : "hidden",
        icon,
        trafficLightPosition: { x: 16, y: 16 },
        titleBarOverlay: {
          symbolColor: "#DADBE1",
          color: "#151515",
          height: 34,
        },
        webPreferences: {
          preload: path.join(__dirname, "../preload/index.mjs"),
          sandbox: false,
        },
        show: false,
      });

      this.editorWindows.set(themeId, editorWindow);

      editorWindow.removeMenu();

      this.loadWindowURL(editorWindow, `theme-editor?themeId=${themeId}`);

      editorWindow.once("ready-to-show", () => {
        editorWindow.show();
        this.mainWindow?.webContents.openDevTools();
        if (!app.isPackaged || isStaging) {
          editorWindow.webContents.openDevTools();
        }
      });

      editorWindow.webContents.on("before-input-event", (_event, input) => {
        if (input.key === "F12") {
          this.mainWindow?.webContents.toggleDevTools();
        }
      });

      editorWindow.on("close", () => {
        this.mainWindow?.webContents.closeDevTools();
        this.editorWindows.delete(themeId);
      });
    }
  }

  public static closeEditorWindow(themeId?: string) {
    if (themeId) {
      const editorWindow = this.editorWindows.get(themeId);
      if (editorWindow) {
        editorWindow.close();
      }
    } else {
      this.editorWindows.forEach((editorWindow) => {
        editorWindow.close();
      });
    }
  }

  private static readonly GAME_LAUNCHER_WINDOW_WIDTH = 550;
  private static readonly GAME_LAUNCHER_WINDOW_HEIGHT = 320;

  public static async createGameLauncherWindow(shop: string, objectId: string) {
    if (this.gameLauncherWindow) {
      this.gameLauncherWindow.close();
      this.gameLauncherWindowInstance = null;
    }

    const display = screen.getPrimaryDisplay();
    const { width: displayWidth, height: displayHeight } = display.bounds;

    const x = Math.round((displayWidth - this.GAME_LAUNCHER_WINDOW_WIDTH) / 2);
    const y = Math.round(
      (displayHeight - this.GAME_LAUNCHER_WINDOW_HEIGHT) / 2
    );

    const gameLauncherWindow = new BrowserWindow({
      width: this.GAME_LAUNCHER_WINDOW_WIDTH,
      height: this.GAME_LAUNCHER_WINDOW_HEIGHT,
      x,
      y,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      frame: false,
      backgroundColor: "#1c1c1c",
      icon,
      skipTaskbar: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
      show: false,
    });
    this.gameLauncherWindowInstance = gameLauncherWindow;

    gameLauncherWindow.removeMenu();

    this.loadWindowURL(
      gameLauncherWindow,
      `game-launcher?shop=${shop}&objectId=${objectId}`
    );

    gameLauncherWindow.on("closed", () => {
      this.gameLauncherWindowInstance = null;
    });

    if (!app.isPackaged || isStaging) {
      gameLauncherWindow.webContents.openDevTools();
    }
  }

  public static showGameLauncherWindow() {
    if (this.gameLauncherWindow && !this.gameLauncherWindow.isDestroyed()) {
      this.gameLauncherWindow.show();
    }
  }

  public static closeGameLauncherWindow() {
    if (this.gameLauncherWindow) {
      this.gameLauncherWindow.close();
      this.gameLauncherWindowInstance = null;
    }
  }

  public static openMainWindow() {
    if (this.bigPicture && !this.bigPicture.isDestroyed()) {
      this.bigPicture.focus();
      return;
    }

    if (this.mainWindow) {
      this.mainWindow.show();
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.focus();
    } else {
      this.createMainWindow();
    }
  }

  public static redirect(hash: string) {
    if (!this.mainWindow) this.createMainWindow();
    this.loadMainWindowURL(hash);

    if (this.bigPicture && !this.bigPicture.isDestroyed()) {
      return;
    }

    if (this.mainWindow?.isMinimized()) this.mainWindow.restore();
    this.mainWindow?.focus();
  }

  public static redirectToMainWindow(hash: string) {
    this.redirect(hash);

    if (this.bigPicture && !this.bigPicture.isDestroyed()) {
      this.bigPicture.close();
      return;
    }

    this.openMainWindow();
  }

  public static redirectToGameWindow(hash: string) {
    if (this.bigPicture && !this.bigPicture.isDestroyed()) {
      this.bigPicture.webContents.send(
        "on-navigate",
        `/big-picture/${hash.replace(/^\/+/, "")}`
      );
      this.bigPicture.show();
      this.bigPicture.focus();
      return;
    }

    this.redirectToMainWindow(hash);
  }

  public static async createSystemTray(language: string) {
    let tray: Tray;

    if (process.platform === "darwin") {
      const macIcon = nativeImage
        .createFromPath(trayIcon)
        .resize({ width: 24, height: 24 });
      tray = new Tray(macIcon);
    } else if (process.platform === "win32") {
      const getWindowsTrayIcon = () =>
        nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
          ? trayIcon
          : trayIconDark;

      tray = new Tray(getWindowsTrayIcon());

      nativeTheme.on("updated", () => {
        tray.setImage(getWindowsTrayIcon());
      });
    } else {
      tray = new Tray(trayIcon);
    }

    const updateSystemTray = async () => {
      const games = await gamesSublevel
        .values()
        .all()
        .then((games) => {
          const filteredGames = games.filter(
            (game) =>
              !game.isDeleted && game.executablePath && game.lastTimePlayed
          );

          const sortedGames = orderBy(filteredGames, "lastTimePlayed", "desc");

          return sortedGames.slice(0, 6);
        });

      const recentlyPlayedGames: Array<MenuItemConstructorOptions | MenuItem> =
        games.map(({ title, executablePath }) => ({
          label: title.length > 18 ? `${title.slice(0, 18)}…` : title,
          type: "normal",
          click: async () => {
            if (!executablePath) return;

            shell.openPath(executablePath);
          },
        }));

      const contextMenu = Menu.buildFromTemplate([
        {
          label: t("open", {
            ns: "system_tray",
            lng: language,
          }),
          type: "normal",
          click: () => {
            if (this.mainWindow) {
              this.mainWindow.show();
            } else {
              this.createMainWindow();
            }
          },
        },
        {
          type: "separator",
        },
        ...recentlyPlayedGames,
        {
          type: "separator",
        },
        {
          label: t("quit", {
            ns: "system_tray",
            lng: language,
          }),
          type: "normal",
          click: () => app.quit(),
        },
      ]);

      if (process.platform === "linux") {
        tray.setContextMenu(contextMenu);
      }

      return contextMenu;
    };

    const showContextMenu = async () => {
      const contextMenu = await updateSystemTray();
      tray.popUpContextMenu(contextMenu);
    };

    tray.setToolTip("Nacho Launcher");

    if (process.platform === "win32") {
      await updateSystemTray();

      tray.addListener("double-click", () => {
        if (this.mainWindow) {
          this.mainWindow.show();
        } else {
          this.createMainWindow();
        }
      });

      tray.addListener("right-click", showContextMenu);
    } else if (process.platform === "linux") {
      await updateSystemTray();

      tray.addListener("click", () => {
        if (this.mainWindow) {
          this.mainWindow.show();
        } else {
          this.createMainWindow();
        }
      });

      tray.addListener("right-click", showContextMenu);
    } else {
      tray.addListener("click", showContextMenu);
      tray.addListener("right-click", showContextMenu);
    }
  }
}
