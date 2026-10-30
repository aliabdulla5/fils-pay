import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { bhd } from "../format.js";
import { classNames } from "../utils/helpers.js";
import { IconAlert, IconCheck, IconChevronLeft } from "./icons.js";

/**
 * Presentational building blocks for the merchant dashboard. None of these
 * fetch, decide permissions, or transform data — they only lay out what a
 * page already has.
 */

/**
 * A BHD amount, rendered from `bhd()`'s own output and never re-formatted:
 * the string is only split at the decimal point so the fils digits can be
 * styled a step quieter. The element's text content is byte-for-byte what
 * `bhd()` returned.
 */
export function Money({ fils, size, className }: { fils: number; size?: "lg" | "xl"; className?: string }) {
  const text = bhd(fils);
  const space = text.indexOf(" ");
  const amount = space === -1 ? text : text.slice(0, space);
  const currency = space === -1 ? "" : text.slice(space);
  const dot = amount.indexOf(".");
  const whole = dot === -1 ? amount : amount.slice(0, dot);
  const fraction = dot === -1 ? "" : amount.slice(dot);

  return (
    <span
      className={classNames(
        "dash-money",
        size && `dash-money-${size}`,
        fils < 0 && "dash-money-negative",
        className,
      )}
    >
      <span className="dash-money-whole">{whole}</span>
      {fraction ? <span className="dash-money-fils">{fraction}</span> : null}
      {currency ? <span className="dash-money-currency">{currency}</span> : null}
    </span>
  );
}

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

/** Visual tone per stored status value. Unknown values fall back to neutral
 *  rather than guessing — the label still shows the raw value. */
const STATUS_TONES: Record<string, Tone> = {
  captured: "success",
  paid: "success",
  succeeded: "success",
  active: "success",
  authorized: "warning",
  partially_captured: "warning",
  pending: "warning",
  reserved: "warning",
  open: "warning",
  failed: "danger",
  exhausted: "danger",
  chargeback: "danger",
  refunded: "info",
  partially_refunded: "info",
  voided: "neutral",
  canceled: "neutral",
  disabled: "neutral",
  closed: "neutral",
};

/** `partially_captured` → `Partially captured`. Display only. */
export function statusLabel(status: string): string {
  const spaced = status.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? "neutral";
  return <span className={`dash-badge dash-badge-${tone}`}>{statusLabel(status)}</span>;
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
    <header className="dash-page-header">
      <div className="dash-page-heading">
        {back ? (
          <Link className="dash-back" to={back.to}>
            <IconChevronLeft />
            {back.label}
          </Link>
        ) : null}
        <div className="dash-page-title-row">
          <h1>{title}</h1>
          {badge}
        </div>
        {description ? <p className="dash-page-sub">{description}</p> : null}
      </div>
      {actions ? <div className="dash-page-actions">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  aside,
  children,
  footer,
  className,
  labelledBy,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section className={classNames("dash-card", className)} aria-labelledby={labelledBy}>
      {title || aside ? (
        <div className="dash-card-header">
          <div>{typeof title === "string" ? <h2 id={labelledBy}>{title}</h2> : title}</div>
          {aside ? <div>{aside}</div> : null}
        </div>
      ) : null}
      {children}
      {footer ? <div className="dash-card-footer">{footer}</div> : null}
    </section>
  );
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p className="dash-error" role="alert">
      <IconAlert />
      <span>{children}</span>
    </p>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="dash-notice" role="status">
      <IconCheck />
      <span>{children}</span>
    </p>
  );
}

export function Loading({ label = "Loading..." }: { label?: string }) {
  return (
    <p className="dash-loading" role="status">
      {label}
    </p>
  );
}

/** The full-width "nothing here" row every list table ends with. */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td className="dash-table-empty" colSpan={colSpan}>
        {children}
      </td>
    </tr>
  );
}
