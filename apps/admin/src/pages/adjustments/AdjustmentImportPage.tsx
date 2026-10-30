import { Fragment, useCallback, useEffect, useState } from "react";
import { formatBhd, toFils } from "@filspay/money";
import {
  getAdjustmentImportRows,
  listAdjustmentImports,
  uploadAdjustmentImport,
} from "../../api/adjustmentImports.js";
import { describeError } from "../../api/client.js";
import { RequireRole } from "../../auth/RequireRole.js";
import { IconFile } from "../../components/icons.js";
import { Card, EmptyRow, ErrorMessage, GateNote, Money, Notice, PageHeader } from "../../components/ui.js";
import type {
  AdjustmentImportRowDetail,
  AdjustmentImportSummary,
} from "../../types.js";

// FH: another copy of bhd() in admin, claude says extract it
function bhd(fils: number): string {
  return `${formatBhd(toFils(fils, { allowNegative: true }))} BHD`;
}

const CSV_PLACEHOLDER = `merchantId,amount,reason
00000000-0000-0000-0000-000000000000,4.750,statement correction`;

/**
 * "Import adjustments" — paste a CSV of manual balance corrections and apply
 * them. There is no preview step: the paste box submits directly, because an
 * adjustment CSV is assembled and checked in the spreadsheet it came from.
 *
 * The history table below drills into per-row detail, which shows the raw
 * CSV text next to the integer that was actually posted.
 */
export function AdjustmentImportPage() {
  const [csvContent, setCsvContent] = useState("");
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [imports, setImports] = useState<AdjustmentImportSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const [openImportId, setOpenImportId] = useState<string | null>(null);
  const [rows, setRows] = useState<AdjustmentImportRowDetail[]>([]);
  const [rowsError, setRowsError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setListError(null);
    try {
      const page = await listAdjustmentImports({ limit: 25 });
      setImports(page.items);
    } catch (err) {
      setListError(describeError(err));
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  /** Amounts are BD with three decimals and are parsed server-side with parseBhdToFils. */
  async function handleApply(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await uploadAdjustmentImport(
        csvContent,
        filename.trim() ? filename.trim() : undefined,
      );
      setNotice(
        `Applied ${result.rowCount} row(s), posting ${bhd(result.totalPostedFils)} in total.`,
      );
      setCsvContent("");
      setFilename("");
      await loadHistory();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenRows(importId: string): Promise<void> {
    if (openImportId === importId) {
      setOpenImportId(null);
      setRows([]);
      return;
    }
    setRowsError(null);
    try {
      setRows(await getAdjustmentImportRows(importId));
      setOpenImportId(importId);
    } catch (err) {
      setRowsError(describeError(err));
    }
  }

  /** Fills the same two fields an operator could type or paste into — the
   *  Apply handler and what it sends are unchanged. Nothing is uploaded here. */
  async function handleFileChosen(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileError(null);
    try {
      setCsvContent(await file.text());
      setFilename(file.name);
    } catch {
      setFileError(`Could not read ${file.name}. Paste its contents into the CSV box instead.`);
    }
  }

  // Display only: a count of non-blank lines after the header, so the operator
  // can sanity-check the paste before applying. The server does the real parse.
  const contentLines = csvContent.split(/\r?\n/).filter((line) => line.trim() !== "");
  const dataLineCount = Math.max(
    0,
    contentLines.length - (contentLines[0]?.toLowerCase().startsWith("merchantid") ? 1 : 0),
  );

  return (
    <section className="admin-page">
      <PageHeader
        title="Import adjustments"
        description={
          <>
            Applies a CSV of manual balance corrections immediately — one balanced ledger posting per
            row. Uploading is gated server-side to the <code>finance</code> and{" "}
            <code>super_admin</code> roles.
          </>
        }
      />

      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {notice ? <Notice>{notice}</Notice> : null}

      <div className="admin-grid-detail">
        <Card title="New import" id="import-new">
          <div className="admin-card-body">
            <RequireRole
              allow={["finance", "super_admin"]}
              fallback={
                <GateNote>Your role is read-only here. The import history below is still available.</GateNote>
              }
            >
              <form className="admin-form" onSubmit={(e) => void handleApply(e)}>
                <label className="admin-file">
                  <span className="admin-file-icon">
                    <IconFile />
                  </span>
                  <span>
                    <strong>Choose a .csv file</strong>
                    Its contents load into the box below for review. Nothing is applied until you press
                    Apply.
                  </span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => void handleFileChosen(e)}
                  />
                </label>
                {fileError ? <ErrorMessage>{fileError}</ErrorMessage> : null}

                <label className="admin-field">
                  <span className="admin-field-label">
                    File name <span className="admin-field-optional">Optional</span>
                  </span>
                  <input
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    placeholder="march-corrections.csv"
                  />
                </label>
                <label className="admin-field">
                  <span className="admin-field-label">
                    CSV (columns: merchantId, amount, reason)
                    {csvContent.trim() ? (
                      <span className="admin-field-optional">
                        {dataLineCount} line{dataLineCount === 1 ? "" : "s"} below the header
                      </span>
                    ) : null}
                  </span>
                  <textarea
                    className="admin-mono"
                    value={csvContent}
                    onChange={(e) => setCsvContent(e.target.value)}
                    rows={8}
                    placeholder={CSV_PLACEHOLDER}
                    spellCheck={false}
                    required
                  />
                </label>
                <div className="admin-actions">
                  <button
                    type="submit"
                    className={busy ? "admin-button admin-button-primary admin-button-busy" : "admin-button admin-button-primary"}
                    disabled={busy || !csvContent.trim()}
                  >
                    {busy ? "Applying…" : "Apply"}
                  </button>
                  {csvContent ? (
                    <button
                      type="button"
                      className="admin-linkbutton"
                      disabled={busy}
                      onClick={() => {
                        setCsvContent("");
                        setFilename("");
                      }}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </form>
            </RequireRole>
          </div>
        </Card>

        <Card title="Format" id="import-format">
          <div className="admin-card-body">
            <p className="admin-muted">
              One adjustment per line, with a header row. Amounts are BD with three decimals and are
              parsed server-side.
            </p>
            <pre className="admin-secret">{CSV_PLACEHOLDER}</pre>
            <p className="admin-muted">
              Each row posts immediately when you press Apply. There is no preview step — check the
              CSV in the spreadsheet it came from first.
            </p>
          </div>
        </Card>
      </div>

      <Card title="Past imports" id="import-history">
        {listError ? (
          <div className="admin-card-body">
            <ErrorMessage>{listError}</ErrorMessage>
          </div>
        ) : null}
        {rowsError ? (
          <div className="admin-card-body">
            <ErrorMessage>{rowsError}</ErrorMessage>
          </div>
        ) : null}
        <div className="admin-table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Applied</th>
                <th>File</th>
                <th className="admin-num">Rows</th>
                <th className="admin-num">
                  <span className="admin-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {imports.map((item) => (
                <Fragment key={item.id}>
                  <tr className={openImportId === item.id ? "is-expanded" : undefined}>
                    <td className="admin-nowrap">{item.appliedAt}</td>
                    <td>{item.originalFilename}</td>
                    <td className="admin-num">{item.rowCount}</td>
                    <td className="admin-num">
                      <button
                        type="button"
                        className="admin-button admin-button-sm"
                        aria-expanded={openImportId === item.id}
                        onClick={() => void handleOpenRows(item.id)}
                      >
                        {openImportId === item.id ? "Hide rows" : "View rows"}
                      </button>
                    </td>
                  </tr>
                  {openImportId === item.id ? (
                    <tr>
                      <td className="admin-subtable-cell" colSpan={4}>
                        <div className="admin-subtable admin-table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
                          <table className="admin-table">
                            <thead>
                              <tr>
                                <th className="admin-num">#</th>
                                <th>Merchant</th>
                                <th className="admin-num">CSV amount</th>
                                <th className="admin-num">Posted</th>
                                <th>Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((row) => (
                                <tr key={row.rowNumber}>
                                  <td className="admin-num">{row.rowNumber}</td>
                                  <td>
                                    <code>{row.merchantId}</code>
                                  </td>
                                  <td className="admin-num">
                                    <code>{row.rawAmountText}</code>
                                  </td>
                                  <td className="admin-num admin-cell-strong">
                                    <Money fils={row.parsedAmountFils} />
                                  </td>
                                  <td>{row.reason ?? ""}</td>
                                </tr>
                              ))}
                              {rows.length === 0 ? <EmptyRow colSpan={5}>No rows.</EmptyRow> : null}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {imports.length === 0 ? <EmptyRow colSpan={4}>No imports yet.</EmptyRow> : null}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
