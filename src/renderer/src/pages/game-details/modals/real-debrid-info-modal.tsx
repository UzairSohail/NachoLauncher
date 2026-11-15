import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button, Link, Modal } from "@renderer/components";
import { LinkExternalIcon } from "@primer/octicons-react";
import { Downloader } from "@shared";
import { DOWNLOADER_NAME } from "@renderer/constants";
import "./real-debrid-info-modal.scss";

const realDebridReferralId = import.meta.env
  .RENDERER_VITE_REAL_DEBRID_REFERRAL_ID;

const REAL_DEBRID_URL = realDebridReferralId
  ? `https://real-debrid.com/?id=${realDebridReferralId}`
  : "https://real-debrid.com";

const SIGN_UP_URL: Partial<Record<Downloader, string>> = {
  [Downloader.AllDebrid]: "https://alldebrid.com",
  [Downloader.Premiumize]: "https://www.premiumize.me",
  [Downloader.TorBox]: "https://torbox.app",
};

export interface RealDebridInfoModalProps {
  visible: boolean;
  /** The debrid service the user picked; defaults to Real-Debrid. */
  downloader?: Downloader;
  onClose: () => void;
}

export function RealDebridInfoModal({
  visible,
  downloader = Downloader.RealDebrid,
  onClose,
}: Readonly<RealDebridInfoModalProps>) {
  const isRealDebrid = downloader === Downloader.RealDebrid;
  const name = DOWNLOADER_NAME[downloader];
  const { t } = useTranslation("game_details");
  const { t: tSettings } = useTranslation("settings");
  const navigate = useNavigate();

  return (
    <Modal
      visible={visible}
      title={
        isRealDebrid
          ? tSettings("enable_real_debrid")
          : t("set_up_debrid_title", { name })
      }
      onClose={onClose}
    >
      <div className="real-debrid-info-modal__content">
        <div className="real-debrid-info-modal__description-container">
          <p className="real-debrid-info-modal__description">
            {isRealDebrid
              ? tSettings("real_debrid_description")
              : t("set_up_debrid_description", { name })}
          </p>
          <Link
            to={SIGN_UP_URL[downloader] ?? REAL_DEBRID_URL}
            className="real-debrid-info-modal__create-account"
          >
            <LinkExternalIcon />
            {isRealDebrid
              ? tSettings("create_real_debrid_account")
              : t("set_up_debrid_create_account", { name })}
          </Link>
        </div>

        <Button
          onClick={() => {
            onClose();
            navigate("/settings?tab=integrations");
          }}
        >
          {t("go_to_settings")}
        </Button>
      </div>
    </Modal>
  );
}
