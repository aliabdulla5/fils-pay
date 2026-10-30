import type { ReactNode } from "react";

/**
 * The console's icon set — the same hand-drawn 24×24 strokes as the merchant
 * dashboard, no icon-library dependency. Icons always sit beside a visible
 * text label, so they are `aria-hidden`.
 */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="admin-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconMerchants = () => (
  <Icon>
    <path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6" />
  </Icon>
);

export const IconCredit = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v10M8.5 10.5L12 7l3.5 3.5" />
  </Icon>
);

export const IconSettlement = () => (
  <Icon>
    <path d="M3 21h18M4 10h16M12 3l8 5H4l8-5zM6.5 10v8M10.5 10v8M13.5 10v8M17.5 10v8" />
  </Icon>
);

export const IconImport = () => (
  <Icon>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z" />
    <path d="M14 3v6h6M12 18v-6M9 15l3 3 3-3" />
  </Icon>
);

export const IconWebhook = () => (
  <Icon>
    <circle cx="12" cy="12" r="2" />
    <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
  </Icon>
);

export const IconLogout = () => (
  <Icon>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" />
  </Icon>
);

export const IconSearch = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Icon>
);

export const IconMenu = () => (
  <Icon>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const IconClose = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const IconChevronLeft = () => (
  <Icon>
    <path d="M15 18l-6-6 6-6" />
  </Icon>
);

export const IconCheck = () => (
  <Icon>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const IconAlert = () => (
  <Icon>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  </Icon>
);

export const IconLock = () => (
  <Icon>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Icon>
);

export const IconEye = () => (
  <Icon>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const IconPause = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M10 9v6M14 9v6" />
  </Icon>
);

export const IconExternal = () => (
  <Icon>
    <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Icon>
);

export const IconFile = () => (
  <Icon>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z" />
    <path d="M14 3v6h6M8 13h8M8 17h5" />
  </Icon>
);

export const IconRefresh = () => (
  <Icon>
    <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4" />
  </Icon>
);

export const IconKey = () => (
  <Icon>
    <circle cx="8" cy="15" r="4" />
    <path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2" />
  </Icon>
);

/** The FilsPay coin mark, shared with the merchant dashboard. */
export function BrandMark() {
  return (
    <svg className="admin-brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="15" fill="#762D3D" />
      <circle cx="16" cy="16" r="11.5" fill="none" stroke="#C49A45" strokeWidth="1.25" />
      <circle cx="16" cy="16" r="4.25" fill="#F8F5EF" />
      <circle cx="14.6" cy="14.6" r="1.25" fill="#ffffff" opacity="0.9" />
    </svg>
  );
}
