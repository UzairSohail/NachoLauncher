import {
  AppsIcon,
  GearIcon,
  HomeIcon,
  BookIcon,
  CpuIcon,
  BellIcon,
} from "@primer/octicons-react";

import { SidebarDownloadIcon } from "./sidebar-download-icon";

export const routes = [
  {
    path: "/",
    nameKey: "home",
    render: () => <HomeIcon />,
  },
  {
    path: "/catalogue",
    nameKey: "catalogue",
    render: () => <AppsIcon />,
  },
  {
    path: "/library",
    nameKey: "library",
    render: () => <BookIcon />,
  },
  {
    path: "/recomps",
    nameKey: "recomps",
    render: () => <CpuIcon />,
  },
  {
    path: "/downloads",
    nameKey: "downloads",
    render: () => <SidebarDownloadIcon />,
  },
  {
    path: "/notifications",
    nameKey: "notifications",
    render: () => <BellIcon />,
  },
  {
    path: "/settings",
    nameKey: "settings",
    render: () => <GearIcon />,
  },
];
