import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { formatBhd, toFils } from "@filspay/money";
import { IconAlert, IconCheck, IconChevronLeft, IconLock } from "./icons.js";

/**
 * Presentational building blocks for the admin console. None of these
 * fetch, decide permissions, or transform data — they only lay out what a
 * page already has.
 */

function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Same formatter every admin page already uses for BHD. */
function bhd(fils: number): string {
  return `${formatBhd(toFils(fils, { allowNegative: true }))} BHD`;
}

/**
 * A BHD amount. The string is `formatBhd`'s own output, only split at the
 * decimal point so the fils digits can be styled a step quieter — the text
 * content is unchanged.
 */
export function Money({ fils, size }: { fils: number; size?: "lg" | "xl" }) {
  const text = bhd(fils);
  const space = text.indexOf(" ");
  const amount = space === -1 ? text : text.slice(0, space);
  const currency = space === -1 ? "" : text.slice(space);
  const dot = amount.indexOf(".");
  const whole = dot === -1 ? amount : amount.slice(0, dot);
  const fraction = dot === -1 ? "" : amount.slice(dot);
  return (
    <span className={classNames("admin-money", size && `admin-money-${size}`, fils < 0 && "admin-money-negative")}>
      <span className="admin-money-whole">{whole}</span>
      {fraction ? <span className="admin-money-fils">{fraction}</span> : null}
      {currency ? <span className="admin-money-currency">{currency}</span> : null}
    </span>
  );
}

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

/** Visual tone per stored status value. Unknown values fall back to neutral;
 *  the label always shows the value itself, so colour is never the only cue. */
const STATUS_TONES: Record<string, Tone> = {
  active: "success",
  approved: "success",
  posted: "success",
  paid: "success",
  succeeded: "success",
  live: "success",
  passed: "success",
  submitted: "info",
  under_review: "warning",
  pending_approval: "warning",
  pending: "warning",
  open: "warning",
  test: "info",
  rejected: "danger",
  failed: "danger",
  exhausted: "danger",
  suspended: "danger",
  not_passed: "warning",
  closed: "neutral",
  disabled: "neutral",
  revoked: "neutral",
};

/** `under_review` → `Under review`. Display only. */
export function statusLabel(status: string): string {
  const spaced = status.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONES[status] ?? "neutral";
  return <span className={`admin-badge admin-badge-${tone}`}>{label ?? statusLabel(status)}</span>;
}

export function PageHeader({
  title,
  description,
  actions,
  back,
  badge,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  badge?: ReactNode;
}) {
  return (
    <header className="admin-page-header">
      <div className="admin-page-heading">
        {back ? (
          <Link className="admin-back" to={back.to}>
            <IconChevronLeft />
            {back.label}
          </Link>
        ) : null}
        <div className="admin-page-title-row">
          <h1>{title}</h1>
          {badge}
        </div>
        {description ? <div className="admin-page-sub">{description}</div> : null}
      </div>
      {actions ? <div className="admin-page-actions">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  aside,
  children,
  footer,
  className,
  id,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={classNames("admin-card", className)} aria-labelledby={headingId} id={id}>
      {title || aside ? (
        <div className="admin-card-header">
          <div>{typeof title === "string" ? <h2 id={headingId}>{title}</h2> : title}</div>
          {aside ? <div>{aside}</div> : null}
        </div>
      ) : null}
      {children}
      {footer ? <div className="admin-card-footer">{footer}</div> : null}
    </section>
  );
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <div className="admin-error" role="alert">
      <IconAlert />
      <div>{children}</div>
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="admin-notice" role="status">
      <IconCheck />
      <div>{children}</div>
    </div>
  );
}

export function Loading({ label = "Loading..." }: { label?: string }) {
  return (
    <p className="admin-loading" role="status">
      {label}
    </p>
  );
}

/** The sentence shown in place of a control a role cannot use. The server
 *  enforces the same rule; this only explains why the control is absent. */
export function GateNote({ children }: { children: ReactNode }) {
  return (
    <p className="admin-gate-note">
      <IconLock />
      <span>{children}</span>
    </p>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td className="admin-table-empty" colSpan={colSpan}>
        {children}
      </td>
    </tr>
  );
}

/** "50 bps" → "0.50% (50 bps)". Display only. */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}% (${bps} bps)`;
}
