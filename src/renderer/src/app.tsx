import { resolveThemeCode } from "@renderer/theme-presets";
import { AppTitleBar, Sidebar, Toast } from "@renderer/components";
import { AutoUpdateSubHeader } from "@renderer/components/header/auto-update-sub-header";
import { ScanGamesProvider } from "@renderer/context";
import {
  useAppDispatch,
  useAppSelector,
  useDownload,
  useDragTextSelection,
  useLibrary,
  useToast,
} from "@renderer/hooks";
import { useDownloadOptionsListener } from "@renderer/hooks/use-download-options-listener";
import i18n from "i18next";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import {
  clearExtraction,
  closeToast,
  showToast,
  failClassicsScan,
  failRetroArchScan,
  finishClassicsScan,
  finishRetroArchScan,
  hydrateClassicsScan,
  hydrateRetroArchScan,
  setExtractionProgress,
  setGameRunning,
  setUserPreferences,
  toggleDraggingDisabled,
  updateClassicsScanProgress,
  updateRetroArchScanProgress,
} from "@renderer/features";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { ArchiveDeletionModal } from "./pages/downloads/archive-deletion-error-modal";
import { ClassicsScanModal } from "./pages/settings/emulation/classics-scan-modal";
import { Ps4PkgJobHost } from "./components/ps4-pkg-job/ps4-pkg-job-host";
import { RetroArchScanModal } from "./pages/settings/emulation/retroarch-scan-modal";
import { GoogleSignInPrompt } from "./components/google-sign-in-prompt";
import { StartWithComputerPrompt } from "./components/start-with-computer-prompt";
import { useMissingScreenshotsToast } from "./hooks/use-missing-screenshots-toast";
import { usePersonalCloudSyncToasts } from "./pages/game-details/personal-cloud";

import type { UserPreferences } from "@types";
import "./app.scss";
import {
  getAchievementSoundUrl,
  getAchievementSoundVolume,
  injectCustomCss,
  removeCustomCss,
} from "./helpers";
import { levelDBService } from "./services/leveldb.service";

export interface AppProps {
  children: React.ReactNode;
}

export function App() {
  const contentRef = useRef<HTMLDivElement>(null);
  const { updateLibrary, library, downloadLibrary } = useLibrary();

  // Listen for new download options updates
  useDownloadOptionsListener();
  useDragTextSelection();

  const { t } = useTranslation("app");

  // Pages load on demand. Fetch the common ones once the app is idle so
  // switching to them is still instant.
  useEffect(() => {
    const preload = () => {
      void import("./pages/library/library");
      void import("./pages/catalogue/catalogue");
      void import("./pages/downloads/downloads");
      void import("./pages/game-details/game-details");
      void import("./pages/settings/settings");
    };
    const id = window.requestIdleCallback(preload, { timeout: 5_000 });
    return () => window.cancelIdleCallback(id);
  }, []);

  const { clearDownload, setLastPacket, lastPacket } = useDownload();

  const dispatch = useAppDispatch();

  const navigate = useNavigate();
  const location = useLocation();

  const draggingDisabled = useAppSelector(
    (state) => state.window.draggingDisabled
  );

  const toast = useAppSelector((state) => state.toast);

  const [version, setVersion] = useState("");

  useEffect(() => {
    window.electron.getVersion().then(setVersion);
  }, []);

  const { showSuccessToast, showErrorToast, showWarningToast } = useToast();
  useMissingScreenshotsToast();
  usePersonalCloudSyncToasts();

  const [showArchiveDeletionModal, setShowArchiveDeletionModal] =
    useState(false);
  const [archivePaths, setArchivePaths] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([window.electron.getUserPreferences(), updateLibrary()]).then(
      ([preferences]) => {
        dispatch(setUserPreferences(preferences as UserPreferences | null));
      }
    );
  }, [navigate, location.pathname, dispatch, updateLibrary]);

  useEffect(() => {
    const unsubscribe = window.electron.onUserPreferencesUpdated(
      (preferences) => {
        if (!preferences) {
          dispatch(setUserPreferences(null));
          return;
        }

        if (preferences.language && preferences.language !== i18n.language) {
          void i18n.changeLanguage(preferences.language);
        }

        dispatch(setUserPreferences(preferences));
      }
    );

    return () => {
      unsubscribe();
    };
  }, [dispatch]);

  useEffect(() => {
    const unsubscribe = window.electron.onDownloadProgress(
      (downloadProgress) => {
        if (
          downloadProgress?.progress === 1 &&
          !downloadProgress.isCheckingFiles &&
          !downloadProgress.isDownloadingMetadata
        ) {
          clearDownload();
          updateLibrary();
          return;
        }

        setLastPacket(downloadProgress);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [clearDownload, setLastPacket, updateLibrary]);

  useEffect(() => {
    const unsubscribe = window.electron.onHardDelete(() => {
      updateLibrary();
    });

    return () => unsubscribe();
  }, [updateLibrary]);

  useEffect(() => {
    const refreshLibrary = () => {
      void updateLibrary();
    };

    window.addEventListener("hydra:game-visibility-updated", refreshLibrary);
    return () =>
      window.removeEventListener(
        "hydra:game-visibility-updated",
        refreshLibrary
      );
  }, [updateLibrary]);

  useEffect(() => {
    if (!lastPacket?.gameId) return;

    const activeGame = downloadLibrary.find(
      (game) => game.id === lastPacket.gameId
    );

    if (!activeGame || activeGame.download?.status !== "active") {
      clearDownload();
    }
  }, [clearDownload, lastPacket?.gameId, downloadLibrary]);

  useEffect(() => {
    const unsubscribe = window.electron.onGamesRunning((gamesRunning) => {
      if (gamesRunning.length) {
        const runningIds = new Set(gamesRunning.map((game) => game.id));
        const concealedExecutables = new Set(
          downloadLibrary
            .filter(
              (game) =>
                game.isConcealed &&
                game.executablePath &&
                runningIds.has(game.id)
            )
            .map((game) => game.executablePath!.toLowerCase())
        );
        const lastGame = gamesRunning[gamesRunning.length - 1];
        const libraryGame = library.find(
          (library) => library.id === lastGame.id
        );

        if (
          libraryGame &&
          !concealedExecutables.has(
            libraryGame.executablePath?.toLowerCase() ?? ""
          )
        ) {
          dispatch(
            setGameRunning({
              ...libraryGame,
              coverImageUrl: libraryGame.coverImageUrl ?? null,
              sessionDurationInMillis: lastGame.sessionDurationInMillis,
            })
          );
          return;
        }
      }
      dispatch(setGameRunning(null));
    });

    return () => {
      unsubscribe();
    };
  }, [dispatch, library, downloadLibrary]);

  useEffect(() => {
    window.electron.getActiveClassicsImport().then((snapshot) => {
      if (snapshot) dispatch(hydrateClassicsScan(snapshot));
    });

    const unsubscribe = window.electron.onClassicsImportProgress((payload) => {
      if (payload.type === "error") {
        dispatch(failClassicsScan(payload.message));
        return;
      }

      if (payload.type === "progress") {
        dispatch(updateClassicsScanProgress(payload));
        return;
      }

      dispatch(
        finishClassicsScan({
          cancelled: payload.type === "cancelled",
          system: payload.system,
          result: {
            fileCount: payload.fileCount,
            sizeBytes: payload.sizeBytes,
            matched: payload.matched,
            unmatched: payload.unmatched,
            unmatchedFiles: payload.unmatchedFiles,
            unsupportedPackages: payload.unsupportedPackages,
          },
        })
      );
      if (payload.type === "done" && payload.unsupportedPackages > 0) {
        showWarningToast(
          t("ps4_pkg_not_supported", { count: payload.unsupportedPackages })
        );
      }
      updateLibrary();
    });

    return () => unsubscribe();
  }, [dispatch, updateLibrary, showWarningToast, t]);

  useEffect(() => {
    window.electron.getActiveRetroArchImport().then((snapshot) => {
      if (snapshot) dispatch(hydrateRetroArchScan(snapshot));
    });

    const unsubscribe = window.electron.onRetroArchImportProgress((payload) => {
      if (payload.type === "error") {
        dispatch(failRetroArchScan(payload.message));
        return;
      }

      if (payload.type === "progress") {
        dispatch(updateRetroArchScanProgress(payload));
        return;
      }

      dispatch(
        finishRetroArchScan({
          cancelled: payload.type === "cancelled",
          result: {
            fileCount: payload.fileCount,
            sizeBytes: payload.sizeBytes,
            matched: payload.matched,
            unmatched: payload.unmatched,
            unmatchedFiles: payload.unmatchedFiles,
          },
        })
      );
      updateLibrary();
    });

    return () => unsubscribe();
  }, [dispatch, updateLibrary]);

  useEffect(() => {
    const listeners = [
      window.electron.onLibraryBatchComplete(() => {
        updateLibrary();
      }),
      window.electron.onDownloadsUpdated(() => {
        updateLibrary();
      }),
      window.electron.onExtractionProgress((shop, objectId, progress) => {
        dispatch(setExtractionProgress({ shop, objectId, progress }));
      }),
      window.electron.onExtractionComplete(() => {
        dispatch(clearExtraction());
        updateLibrary();
      }),
      window.electron.onExtractionFailed((_shop, _objectId, failure) => {
        dispatch(clearExtraction());
        updateLibrary();

        if (failure?.reason === "unsupported-format") {
          showErrorToast(
            t("extraction_unsupported_format_title", { ns: "downloads" }),
            t("extraction_unsupported_format_description", {
              ns: "downloads",
              format: failure.format,
            })
          );
          return;
        }

        if (failure?.reason === "pkg-keys-unavailable") {
          showErrorToast(
            t("extraction_failed_title", { ns: "downloads" }),
            t("extraction_pkg_keys_unavailable_description", {
              ns: "downloads",
            })
          );
          return;
        }

        if (failure?.reason === "file-not-found") {
          showErrorToast(
            t("extraction_file_not_found_title", { ns: "downloads" }),
            t("extraction_file_not_found_description", { ns: "downloads" })
          );
          return;
        }

        showErrorToast(
          t("extraction_failed_title", { ns: "downloads" }),
          t("extraction_failed_description", { ns: "downloads" })
        );
      }),
      window.electron.onGameExecutableNotFound(() => {
        showErrorToast(
          t("executable_not_found_title", { ns: "game_details" }),
          t("executable_not_found_description", { ns: "game_details" })
        );
      }),
      window.electron.onDownloadHalted((gameTitle) => {
        updateLibrary();
        showErrorToast(
          t("download_halted_title", { ns: "downloads" }),
          t("download_halted_description", {
            ns: "downloads",
            title: gameTitle,
          })
        );
      }),
      window.electron.onArchiveDeletionPrompt((paths) => {
        setArchivePaths(paths);
        setShowArchiveDeletionModal(true);
      }),
      window.electron.onGameInstallerClosed(
        (_shop, _objectId, executableFound) => {
          updateLibrary();

          if (executableFound) {
            showSuccessToast(
              t("game_installed_title", { ns: "downloads" }),
              t("game_installed_description", { ns: "downloads" })
            );
            return;
          }

          showWarningToast(
            t("installed_game_not_found_title", { ns: "downloads" }),
            t("installed_game_not_found_description", { ns: "downloads" })
          );
        }
      ),
      window.electron.onCommonRedistProgress(({ complete }) => {
        if (!complete) return;

        showSuccessToast(
          t("installation_complete", { ns: "bottom_panel" }),
          t("installation_complete_message", { ns: "bottom_panel" })
        );
      }),
    ];

    return () => {
      listeners.forEach((unsubscribe) => unsubscribe());
    };
  }, [
    updateLibrary,
    dispatch,
    showErrorToast,
    showSuccessToast,
    showWarningToast,
    t,
  ]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [location.pathname, location.search]);

  useEffect(() => {
    new MutationObserver(() => {
      const modal = document.body.querySelector("[data-hydra-dialog]");

      dispatch(toggleDraggingDisabled(Boolean(modal)));
    }).observe(document.body, {
      attributes: false,
      childList: true,
    });
  }, [dispatch, draggingDisabled]);

  const loadAndApplyTheme = useCallback(async () => {
    const allThemes = (await levelDBService.values("themes")) as {
      id?: string;
      isActive?: boolean;
      code?: string;
    }[];
    const activeTheme = allThemes.find((theme) => theme.isActive);
    const code = activeTheme ? resolveThemeCode(activeTheme) : null;
    if (code) {
      injectCustomCss(code);
    } else {
      removeCustomCss();
    }
  }, []);

  useEffect(() => {
    loadAndApplyTheme();
  }, [loadAndApplyTheme]);

  useEffect(() => {
    const unsubscribe = window.electron.onCustomThemeUpdated(() => {
      loadAndApplyTheme();
    });

    return () => unsubscribe();
  }, [loadAndApplyTheme]);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onNavigate((path) => {
      navigate(path);
    });

    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onShowToast((toast) => {
      dispatch(showToast(toast));
    });

    return () => unsubscribe();
  }, [dispatch]);

  const playAudio = useCallback(async () => {
    const soundUrl = await getAchievementSoundUrl();
    const volume = await getAchievementSoundVolume();
    const audio = new Audio(soundUrl);
    audio.volume = volume;
    audio.play();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onAchievementUnlocked(
      (suppressSound) => {
        if (!suppressSound) playAudio();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [playAudio]);

  const handleToastClose = useCallback(() => {
    dispatch(closeToast());
  }, [dispatch]);

  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  useEffect(() => {
    if (
      window.electron.platform !== "linux" ||
      window.electron.hasNativeWindowDecorations
    ) {
      return;
    }

    if (window.electron.isWayland) {
      document.body.classList.add("window-rounded");
    }

    let cancelled = false;

    const applyMaximizeState = (isMaximized: boolean) => {
      if (cancelled) return;
      setIsWindowMaximized(isMaximized);
      document.body.classList.toggle("window-maximized", isMaximized);
    };

    window.electron.isMainWindowMaximized().then(applyMaximizeState);
    const unsubscribe =
      window.electron.onWindowMaximizeChange(applyMaximizeState);

    return () => {
      cancelled = true;
      unsubscribe();
      document.body.classList.remove("window-rounded");
      document.body.classList.remove("window-maximized");
    };
  }, []);

  return (
    <>
      <AppTitleBar version={version} isWindowMaximized={isWindowMaximized} />

      <Toast
        visible={toast.visible}
        title={toast.title}
        message={toast.message}
        type={toast.type}
        onClose={handleToastClose}
        duration={toast.duration}
      />

      <ArchiveDeletionModal
        visible={showArchiveDeletionModal}
        archivePaths={archivePaths}
        onClose={() => setShowArchiveDeletionModal(false)}
      />

      <GoogleSignInPrompt />
      <StartWithComputerPrompt />

      <ClassicsScanModal />
      <Ps4PkgJobHost />
      <RetroArchScanModal />

      <ScanGamesProvider>
        <main>
          <Sidebar />

          <article className="container">
            <AutoUpdateSubHeader />

            <section
              ref={contentRef}
              id="scrollableDiv"
              className="container__content"
            >
              <Suspense fallback={null}>
                <Outlet />
              </Suspense>
            </section>
          </article>
        </main>
      </ScanGamesProvider>
    </>
  );
}
