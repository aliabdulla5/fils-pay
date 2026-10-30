package splits

import "github.com/filspay/settlement/internal/money"

// ChildWeight is one sub-merchant's configured share of a parent's payout.
type ChildWeight struct {
	WeightBps int64
}

// ChildShares distributes netPayout across children by their weights, and
// the shares always add up to exactly what the weights cover — every fils,
// never one more or one less. Rounding each share on its own does not: 100
// fils at 3333/3333/3334 rounds to 33+33+33 = 99, and 1001 at the same
// weights to 334+334+334 = 1002.
//
// Largest remainder: every child first gets the floor of its exact share;
// the fils still unallocated go one each to the children with the largest
// discarded fractions, ties to the earlier child, so the result is
// deterministic for a given (ordered) child list.
func ChildShares(netPayout money.Fils, children []ChildWeight) []money.Fils {
	out := make([]money.Fils, len(children))
	if len(children) == 0 {
		return out
	}

	var totalWeight int64
	for _, c := range children {
		totalWeight += c.WeightBps
	}
	// Weights normally sum to 10000 (the whole payout); if they don't, only
	// the covered part is allocated, rounded once as a whole.
	target := money.ApplyRateFils(netPayout, totalWeight)

	remainders := make([]int64, len(children))
	var allocated money.Fils
	for i, c := range children {
		exact := int64(netPayout) * c.WeightBps
		out[i] = money.Fils(exact / 10_000)
		remainders[i] = exact % 10_000
		allocated += out[i]
	}

	for left := target - allocated; left > 0; left-- {
		best := 0
		for i := 1; i < len(children); i++ {
			if remainders[i] > remainders[best] {
				best = i
			}
		}
		out[best]++
		remainders[best] = -1 // at most one extra fils per child
	}
	return out
}
