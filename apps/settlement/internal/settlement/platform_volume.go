package settlement

import (
	"context"
	"log"
	"math"

	"github.com/jackc/pgx/v5"
)

// ReadAndLockPlatformProcessedFils reads the platform-wide lifetime
// processed-volume counter with a row lock, so two batches closing
// concurrently for different merchants serialize on this single shared
// counter row instead of racing a lost update. Returns the current value
func ReadAndLockPlatformProcessedFils(ctx context.Context, tx pgx.Tx) (int32, error) {
	var current int32
	err := tx.QueryRow(ctx, `
		SELECT total_processed_fils FROM platform_stats WHERE id = 1 FOR UPDATE
	`).Scan(&current)
	return current, err
}

// RecordPlatformProcessedVolume adds this batch's gross fils to the
// already-locked running total and writes the result back. The addition
// happens here rather than as SQL `SET x = x + $2` so the value written is
// derived from exactly the value this batch's fee calculation read.
func RecordPlatformProcessedVolume(ctx context.Context, tx pgx.Tx, current int32, batchGrossFils int64) error {
	// The column is INTEGER and widening it needs an approved migration plan,
	// so the sum is clamped instead of wrapped. int32 addition wrapped
	// silently past 2,147,483,647 fils: the counter went negative, fell
	// below the volume-tier threshold (2,000,000,000), and switched the
	// platform-wide MDR bonus back off. Lifetime volume never decreases, so a
	// clamped counter keeps the tier decision right; the exact total needs
	// the column widened.
	sum := int64(current) + batchGrossFils
	if sum > math.MaxInt32 {
		log.Printf("settlement: platform_stats.total_processed_fils clamped at %d (INTEGER column is full)", math.MaxInt32)
		sum = math.MaxInt32
	}
	updated := int32(sum)
	_, err := tx.Exec(ctx, `
		UPDATE platform_stats SET total_processed_fils = $1, updated_at = now() WHERE id = 1
	`, updated)
	return err
}

// VolumeTierMdrBonusBps returns the platform-wide MDR reduction (in basis
// points) every merchant's effective rate receives once lifetime processed
// volume reaches the platform's volume-tier threshold — a loyalty-style
// discount for the platform having processed enough real activity to have
// earned better acquirer-side economics to pass through.
//
func VolumeTierMdrBonusBps(totalProcessedFils int32) int64 {
	const volumeTierThresholdFils int32 = 2_000_000_000 // 2,000,000.000 BD
	const volumeTierBonusBps int64 = 15                 // 0.15%
	if totalProcessedFils >= volumeTierThresholdFils {
		return volumeTierBonusBps
	}
	return 0
}
