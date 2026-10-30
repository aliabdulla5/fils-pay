-- An adjustment import posts real ledger money, and nothing stopped the same
-- CSV being applied twice: on 2026-09-04 finance double-clicked and the
-- August file (31 rows) was posted twice, and had to be reversed by hand.
-- The "unique original_filename" a code comment relied on never existed.
--
-- content_sha256 fingerprints the rows themselves (merchant, amount text,
-- reason), so a second upload of the same corrections is refused whatever
-- the file is called. Imports from before this migration stay NULL, which
-- the partial index ignores — the historical double import cannot block it.
ALTER TABLE adjustment_imports ADD COLUMN content_sha256 TEXT;

CREATE UNIQUE INDEX uq_adjustment_imports_content_sha256
    ON adjustment_imports (content_sha256)
 WHERE content_sha256 IS NOT NULL;
