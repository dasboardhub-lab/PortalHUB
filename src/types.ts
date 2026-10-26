export type Action = { label: string; url: string };
export type PortalLink = { id: string; title: string; description: string; category: string; group: string; hub: string; icon: string; color: string; status: string; actions: Action[]; pinned: boolean; sortOrder: number; updatedAt: string };
export type Category = { id: string; name: string; description: string; icon: string; sortOrder: number };
export type PortalSettings = { title: string; area: string; announcementTitle: string; announcement: string; updatedAt: string };
export type PortalData = { needsLogin?: boolean; accessPending?: boolean; userEmail?: string; links: PortalLink[]; categories: Category[]; settings: PortalSettings; canManage: boolean; signedIn: boolean; activity: {id: string; description: string; createdAt: string}[] };
export const HUBS = ["MKS", "BPP", "BJM", "PLK", "MND", "PAL", "KDI", "TAR", "Gateway"];
export const COLORS = ["orange", "blue", "green", "purple", "red", "teal"];
export const ICONS = ["globe", "chart", "package", "truck", "scan", "users", "clipboard", "shield", "headset", "book", "file", "clock", "handover", "grid", "link"];
