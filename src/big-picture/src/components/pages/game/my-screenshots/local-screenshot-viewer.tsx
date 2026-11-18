import type { LocalScreenshot } from "@types";
import { toLocalScreenshotUrl } from "@shared";

import { Modal } from "../../../common";

interface LocalScreenshotViewerProps {
  screenshot: LocalScreenshot | null;
  alt: string;
  onClose: () => void;
}

export function LocalScreenshotViewer({
  screenshot,
  alt,
  onClose,
}: Readonly<LocalScreenshotViewerProps>) {
  return (
    <Modal
      visible={screenshot !== null}
      title={alt}
      className="local-screenshot-viewer"
      onClose={onClose}
    >
      {screenshot ? (
        <img
          className="local-screenshot-viewer__image"
          src={toLocalScreenshotUrl(screenshot.path)}
          alt={alt}
          draggable={false}
        />
      ) : null}
    </Modal>
  );
}
