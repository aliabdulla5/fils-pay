package settlement

import (
	"github.com/filspay/settlement/internal/money"
)

// NetPayableFils derives the net payout from frozen gross and fee totals.
// Integer fils throughout: the previous float32 BD round-trip has a 24-bit
// mantissa, so above ~16,777 BD it could no longer represent every fils and
// the payout drifted from gross - fee.
func NetPayableFils(grossFils, feeFils money.Fils) money.Fils {
	return grossFils - feeFils
}
