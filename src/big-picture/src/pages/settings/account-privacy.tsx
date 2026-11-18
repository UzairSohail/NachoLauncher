import "./account-privacy.scss";

import type {
  ProfileVisibility,
  ScreenshotCommentsPolicy,
  UserBlocks,
  UserFriend,
} from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  DropdownSelect,
  type DropdownSelectOption,
} from "../../components";
import {
  Feature,
  useBigPictureToast,
  useFeature,
  useNavigation,
  useUserDetails,
} from "../../hooks";
import type { FocusOverrides } from "../../services";
import {
  ACCOUNT_PRIVACY_PRIVACY_SELECT_ID,
  ACCOUNT_PRIVACY_SCREENSHOT_COMMENTS_SELECT_ID,
  ACCOUNT_PRIVACY_SCREENSHOTS_SELECT_ID,
  ACCOUNT_PRIVACY_SOUVENIRS_SELECT_ID,
  getAccountPrivacyBlockedUserButtonFocusId,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

interface SettingsSectionProps {
  className?: string;
}

const SETTINGS_TOAST_OPTIONS = {
  fallbackVisual: "settings" as const,
};

function getProfileVisibilityLabel(
  value: ProfileVisibility,
  t: (key: string) => string
) {
  switch (value) {
    case "FRIENDS":
      return t("friends_only");
    case "PRIVATE":
      return t("private");
    default:
      return t("public");
  }
}

export function AccountPrivacySettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const { setFocus } = useNavigation();
  const { userDetails, patchUser, unblockUser } = useUserDetails();
  const [profileVisibility, setProfileVisibility] =
    useState<ProfileVisibility>("PUBLIC");
  const [souvenirsVisibility, setSouvenirsVisibility] =
    useState<ProfileVisibility>("PRIVATE");
  const [screenshotsVisibility, setScreenshotsVisibility] =
    useState<ProfileVisibility | null>(null);
  const [screenshotCommentsPolicy, setScreenshotCommentsPolicy] =
    useState<ScreenshotCommentsPolicy | null>(null);
  const { isFeatureEnabled } = useFeature();
  const isScreenshotsEnabled = isFeatureEnabled(Feature.Screenshots);
  const showScreenshotsVisibility =
    isScreenshotsEnabled && screenshotsVisibility !== null;
  const showScreenshotCommentsPolicy =
    isScreenshotsEnabled &&
    isFeatureEnabled(Feature.ScreenshotComments) &&
    screenshotCommentsPolicy !== null;
  const [blockedUsers, setBlockedUsers] = useState<UserFriend[]>([]);
  const [isSavingVisibility, setIsSavingVisibility] = useState(false);
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!userDetails?.profileVisibility) return;

    setProfileVisibility(userDetails.profileVisibility);
  }, [userDetails?.profileVisibility]);

  useEffect(() => {
    if (!userDetails?.souvenirsVisibility) return;

    setSouvenirsVisibility(userDetails.souvenirsVisibility);
  }, [userDetails?.souvenirsVisibility]);

  useEffect(() => {
    if (!userDetails?.screenshotsVisibility) return;

    setScreenshotsVisibility(userDetails.screenshotsVisibility);
  }, [userDetails?.screenshotsVisibility]);

  useEffect(() => {
    if (!userDetails?.screenshotCommentsPolicy) return;

    setScreenshotCommentsPolicy(userDetails.screenshotCommentsPolicy);
  }, [userDetails?.screenshotCommentsPolicy]);

  const fetchBlockedUsers = useCallback(async () => {
    if (!userDetails) {
      setBlockedUsers([]);
      return [];
    }

    const response = await globalThis.window.electron.hydraApi
      .get<UserBlocks>("/profile/blocks", {
        params: { take: 12, skip: 0 },
      })
      .catch(() => ({ totalBlocks: 0, blocks: [] }) satisfies UserBlocks);

    const nextBlockedUsers = response.blocks ?? [];
    setBlockedUsers(nextBlockedUsers);
    return nextBlockedUsers;
  }, [userDetails]);

  useEffect(() => {
    void fetchBlockedUsers();
  }, [fetchBlockedUsers]);

  const visibilityOptions = useMemo<
    Array<DropdownSelectOption<ProfileVisibility>>
  >(
    () => [
      { value: "PUBLIC", label: t("public") },
      { value: "FRIENDS", label: t("friends_only") },
      { value: "PRIVATE", label: t("private") },
    ],
    [t]
  );

  const screenshotCommentsPolicyOptions = useMemo<
    DropdownSelectOption<ScreenshotCommentsPolicy>[]
  >(
    () => [
      {
        value: "EVERYONE",
        label: t("screenshots_comments_policy_everyone", {
          ns: "big_picture",
        }),
      },
      {
        value: "FRIENDS",
        label: t("screenshots_comments_policy_friends", { ns: "big_picture" }),
      },
      {
        value: "NOBODY",
        label: t("screenshots_comments_policy_nobody", { ns: "big_picture" }),
      },
    ],
    [t]
  );

  const blockedUserFocusIds = useMemo(
    () =>
      blockedUsers.map((user) => ({
        user,
        focusId: getAccountPrivacyBlockedUserButtonFocusId(user.id),
      })),
    [blockedUsers]
  );

  const handleProfileVisibilityChange = useCallback(
    async (value: ProfileVisibility) => {
      if (!userDetails || isSavingVisibility) return;

      const previousValue = profileVisibility;

      setProfileVisibility(value);
      setIsSavingVisibility(true);

      try {
        await patchUser({ profileVisibility: value });
        showSuccessToast("Profile visibility updated", {
          ...SETTINGS_TOAST_OPTIONS,
          message: `Your profile is now ${getProfileVisibilityLabel(value, t)}.`,
        });
      } catch {
        setProfileVisibility(previousValue);
        showErrorToast(
          "Failed to update profile visibility",
          SETTINGS_TOAST_OPTIONS
        );
      } finally {
        setIsSavingVisibility(false);
      }
    },
    [
      isSavingVisibility,
      patchUser,
      profileVisibility,
      showErrorToast,
      showSuccessToast,
      t,
      userDetails,
    ]
  );

  const handleSouvenirsVisibilityChange = useCallback(
    async (value: ProfileVisibility) => {
      if (!userDetails || isSavingVisibility) return;

      const previousValue = souvenirsVisibility;

      setSouvenirsVisibility(value);
      setIsSavingVisibility(true);

      try {
        await patchUser({ souvenirsVisibility: value });
        showSuccessToast(t("souvenirs_visibility_updated"), {
          ...SETTINGS_TOAST_OPTIONS,
          message: t("souvenirs_visibility_updated_description", {
            visibility: getProfileVisibilityLabel(value, t),
          }),
        });
      } catch {
        setSouvenirsVisibility(previousValue);
        showErrorToast(t("souvenir_visibility_failed"), SETTINGS_TOAST_OPTIONS);
      } finally {
        setIsSavingVisibility(false);
      }
    },
    [
      isSavingVisibility,
      patchUser,
      showErrorToast,
      showSuccessToast,
      souvenirsVisibility,
      t,
      userDetails,
    ]
  );

  const handleScreenshotsVisibilityChange = useCallback(
    async (value: ProfileVisibility) => {
      if (!userDetails || isSavingVisibility) return;

      const previousValue = screenshotsVisibility;

      setScreenshotsVisibility(value);
      setIsSavingVisibility(true);

      try {
        await patchUser({ screenshotsVisibility: value });
        showSuccessToast(
          t("screenshots_visibility_updated", { ns: "big_picture" }),
          {
            ...SETTINGS_TOAST_OPTIONS,
            message: t("screenshots_visibility_updated_description", {
              ns: "big_picture",
              visibility: getProfileVisibilityLabel(value, t),
            }),
          }
        );
      } catch {
        setScreenshotsVisibility(previousValue);
        showErrorToast(
          t("screenshots_privacy_update_failed", { ns: "big_picture" }),
          SETTINGS_TOAST_OPTIONS
        );
      } finally {
        setIsSavingVisibility(false);
      }
    },
    [
      isSavingVisibility,
      patchUser,
      screenshotsVisibility,
      showErrorToast,
      showSuccessToast,
      t,
      userDetails,
    ]
  );

  const handleScreenshotCommentsPolicyChange = useCallback(
    async (value: ScreenshotCommentsPolicy) => {
      if (!userDetails || isSavingVisibility) return;

      const previousValue = screenshotCommentsPolicy;

      setScreenshotCommentsPolicy(value);
      setIsSavingVisibility(true);

      try {
        await patchUser({ screenshotCommentsPolicy: value });
        showSuccessToast(t("changes_saved"), SETTINGS_TOAST_OPTIONS);
      } catch {
        setScreenshotCommentsPolicy(previousValue);
        showErrorToast(
          t("screenshots_privacy_update_failed", { ns: "big_picture" }),
          SETTINGS_TOAST_OPTIONS
        );
      } finally {
        setIsSavingVisibility(false);
      }
    },
    [
      isSavingVisibility,
      patchUser,
      screenshotCommentsPolicy,
      showErrorToast,
      showSuccessToast,
      t,
      userDetails,
    ]
  );

  const privacyFocusChain = useMemo(
    () =>
      [
        ACCOUNT_PRIVACY_PRIVACY_SELECT_ID,
        ACCOUNT_PRIVACY_SOUVENIRS_SELECT_ID,
        showScreenshotsVisibility
          ? ACCOUNT_PRIVACY_SCREENSHOTS_SELECT_ID
          : null,
        showScreenshotCommentsPolicy
          ? ACCOUNT_PRIVACY_SCREENSHOT_COMMENTS_SELECT_ID
          : null,
      ].filter((focusId): focusId is string => Boolean(focusId)),
    [showScreenshotCommentsPolicy, showScreenshotsVisibility]
  );

  const lastPrivacyFocusId = privacyFocusChain[privacyFocusChain.length - 1];

  const getPrivacyNavigationOverrides = useCallback(
    (focusId: string): FocusOverrides => {
      const index = privacyFocusChain.indexOf(focusId);
      const previousFocusId = privacyFocusChain[index - 1];
      const nextFocusId = privacyFocusChain[index + 1];

      return {
        up: previousFocusId
          ? { type: "item", itemId: previousFocusId }
          : SETTINGS_HEADER_RETURN_TARGET,
        down: nextFocusId
          ? { type: "item", itemId: nextFocusId }
          : blockedUserFocusIds[0]
            ? { type: "item", itemId: blockedUserFocusIds[0].focusId }
            : { type: "block" },
      };
    },
    [blockedUserFocusIds, privacyFocusChain]
  );

  const handleUnblock = useCallback(
    async (userId: string) => {
      const currentIndex = blockedUsers.findIndex((user) => user.id === userId);
      const nextUser = blockedUsers[currentIndex + 1];
      const previousUser = blockedUsers[currentIndex - 1];
      const nextFocusId = nextUser
        ? getAccountPrivacyBlockedUserButtonFocusId(nextUser.id)
        : previousUser
          ? getAccountPrivacyBlockedUserButtonFocusId(previousUser.id)
          : lastPrivacyFocusId;

      setUnblockingUserId(userId);

      try {
        await unblockUser(userId);
        await fetchBlockedUsers();
        globalThis.window.requestAnimationFrame(() => {
          setFocus(nextFocusId);
        });
      } finally {
        setUnblockingUserId(null);
      }
    },
    [blockedUsers, fetchBlockedUsers, lastPrivacyFocusId, setFocus, unblockUser]
  );

  const blockedUserNavigationOverrides = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    return Object.fromEntries(
      blockedUserFocusIds.map(({ focusId }, index) => {
        const previousItem = blockedUserFocusIds[index - 1];
        const nextItem = blockedUserFocusIds[index + 1];

        return [
          focusId,
          {
            up: previousItem
              ? { type: "item", itemId: previousItem.focusId }
              : { type: "item", itemId: lastPrivacyFocusId },
            down: nextItem
              ? { type: "item", itemId: nextItem.focusId }
              : { type: "block" },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [blockedUserFocusIds, lastPrivacyFocusId]);

  if (!userDetails) return null;

  return (
    <div
      className={
        className
          ? `account-privacy-settings-section ${className}`
          : "account-privacy-settings-section"
      }
    >
      <SettingsSection
        title={t("privacy")}
        description={t("profile_visibility_description")}
      >
        <div className="account-privacy-settings-section__section-content">
          <DropdownSelect
            className="account-privacy-settings-section__select"
            label={t("profile_visibility")}
            value={profileVisibility}
            options={visibilityOptions}
            disabled={isSavingVisibility}
            focusId={ACCOUNT_PRIVACY_PRIVACY_SELECT_ID}
            focusNavigationOverrides={getPrivacyNavigationOverrides(
              ACCOUNT_PRIVACY_PRIVACY_SELECT_ID
            )}
            onValueChange={(value) => {
              void handleProfileVisibilityChange(value);
            }}
          />

          <DropdownSelect
            className="account-privacy-settings-section__select"
            label={t("souvenirs_visibility")}
            value={souvenirsVisibility}
            options={visibilityOptions}
            disabled={isSavingVisibility}
            focusId={ACCOUNT_PRIVACY_SOUVENIRS_SELECT_ID}
            focusNavigationOverrides={getPrivacyNavigationOverrides(
              ACCOUNT_PRIVACY_SOUVENIRS_SELECT_ID
            )}
            onValueChange={(value) => {
              void handleSouvenirsVisibilityChange(value);
            }}
          />

          {showScreenshotsVisibility && screenshotsVisibility ? (
            <DropdownSelect
              className="account-privacy-settings-section__select"
              label={t("screenshots_visibility_setting", { ns: "big_picture" })}
              value={screenshotsVisibility}
              options={visibilityOptions}
              disabled={isSavingVisibility}
              focusId={ACCOUNT_PRIVACY_SCREENSHOTS_SELECT_ID}
              focusNavigationOverrides={getPrivacyNavigationOverrides(
                ACCOUNT_PRIVACY_SCREENSHOTS_SELECT_ID
              )}
              onValueChange={(value) => {
                void handleScreenshotsVisibilityChange(value);
              }}
            />
          ) : null}

          {showScreenshotCommentsPolicy && screenshotCommentsPolicy ? (
            <DropdownSelect
              className="account-privacy-settings-section__select"
              label={t("screenshots_comments_policy_setting", {
                ns: "big_picture",
              })}
              value={screenshotCommentsPolicy}
              options={screenshotCommentsPolicyOptions}
              disabled={isSavingVisibility}
              focusId={ACCOUNT_PRIVACY_SCREENSHOT_COMMENTS_SELECT_ID}
              focusNavigationOverrides={getPrivacyNavigationOverrides(
                ACCOUNT_PRIVACY_SCREENSHOT_COMMENTS_SELECT_ID
              )}
              onValueChange={(value) => {
                void handleScreenshotCommentsPolicyChange(value);
              }}
            />
          ) : null}
        </div>
      </SettingsSection>

      {/* <SettingsSection
        title="Account"
        description="Review your current account details and update your security settings."
      >
        <div className="account-privacy-settings-section__section-content account-privacy-settings-section__section-content--account">
          <div className="account-privacy-settings-section__detail-grid">
            <Input
              className="account-privacy-settings-section__readonly-field"
              label="Username"
              value={userDetails.username}
              readOnly
              focusNavigationState="disabled"
            />

            <Input
              className="account-privacy-settings-section__readonly-field"
              label="Current Email"
              value={userDetails.email ?? "You have not set an email yet"}
              readOnly
              focusNavigationState="disabled"
            />
          </div>

          <HorizontalFocusGroup
            className="account-privacy-settings-section__actions"
            asChild
          >
            <div className="account-privacy-settings-section__actions">
              <Button
                className="account-privacy-settings-section__action-button"
                variant="secondary"
                focusId={ACCOUNT_PRIVACY_UPDATE_EMAIL_BUTTON_ID}
                focusNavigationOverrides={updateEmailButtonOverrides}
                onClick={() => {
                  void globalThis.window.electron.openAuthWindow(
                    AuthPage.UpdateEmail
                  );
                }}
              >
                Update Email
              </Button>

              <Button
                className="account-privacy-settings-section__action-button"
                variant="secondary"
                focusId={ACCOUNT_PRIVACY_UPDATE_PASSWORD_BUTTON_ID}
                focusNavigationOverrides={updatePasswordButtonOverrides}
                onClick={() => {
                  void globalThis.window.electron.openAuthWindow(
                    AuthPage.UpdatePassword
                  );
                }}
              >
                Update Password
              </Button>
            </div>
          </HorizontalFocusGroup>
        </div>
      </SettingsSection> */}

      <SettingsSection
        title="Blocked Users"
        description="Review the users you have blocked and unblock them anytime."
      >
        <div className="account-privacy-settings-section__section-content">
          {blockedUserFocusIds.length > 0 ? (
            <div className="account-privacy-settings-section__blocked-users">
              {blockedUserFocusIds.map(({ user, focusId }) => (
                <div
                  key={user.id}
                  className="account-privacy-settings-section__blocked-user"
                >
                  <div className="account-privacy-settings-section__blocked-user-info">
                    {user.profileImageUrl ? (
                      <img
                        src={user.profileImageUrl}
                        alt={user.displayName}
                        className="account-privacy-settings-section__blocked-user-avatar"
                        width={40}
                        height={40}
                        draggable={false}
                      />
                    ) : (
                      <div className="account-privacy-settings-section__blocked-user-avatar account-privacy-settings-section__blocked-user-avatar--placeholder">
                        {user.displayName[0]?.toUpperCase() ?? "?"}
                      </div>
                    )}

                    <p className="account-privacy-settings-section__blocked-user-name">
                      {user.displayName}
                    </p>
                  </div>

                  <Button
                    variant="secondary"
                    loading={unblockingUserId === user.id}
                    focusId={focusId}
                    focusNavigationOverrides={
                      blockedUserNavigationOverrides[focusId]
                    }
                    onClick={() => {
                      void handleUnblock(user.id);
                    }}
                  >
                    Unblock
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="account-privacy-settings-section__empty">
              You have no blocked users.
            </p>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}
