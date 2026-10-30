-- FP-201: the acquirer redelivers a callback (same callback_id) when our 200
-- is lost or slow, and applyAcquirerCallback inserted a fresh note each time
-- — the timeline showed the same fraud verdict two or three times. 0051's
-- comment points at processed_events and an FP-238 unique index for dedupe;
-- neither exists in any migration. callback_id is the acquirer's id for one
-- callback (a transaction with several distinct callbacks has several ids),
-- so uniqueness on it is exactly "apply each callback once".
--
-- Keep the earliest copy of any duplicate already recorded, then enforce.
DELETE FROM acquirer_callback_notes a
 USING acquirer_callback_notes b
 WHERE a.callback_id = b.callback_id
   AND (a.created_at, a.id) > (b.created_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_acquirer_callback_notes_callback_id
    ON acquirer_callback_notes (callback_id);
