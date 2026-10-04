# Morning worksheet source mapping

108 source rows, each retained once. Section order follows the owner’s requested app order; row order within each section follows the supplied sheet. Supplied PAR values are preserved, including the updated salad PAR values. Local import verified 7/9/51/41 rows and PAR totals60/26/334/216. Historical HAVE/MAKE, date and time are not imported as current counts.

- morning-checklist.md: employee list, no PAR column.
- manager-par-list.csv: source PAR and stable row identifiers for preparation.
- morning-items.json: machine-readable configuration assigned locally to FM-615 University Place; no live counts.

## Confirmed shared-stock rule

Owner selected FM-615 University Place and separate display counts with shared backup counted once. Migrations21–22 permit the same product in separate sections. Exact matching names use the same product identity: 108 display rows, 103 catalog products. Shared backup is entered once in the earliest configured section (fruit mobile for all five repeated products). Combined MAKE = max(0, sum of section PARs − sum of display counts − shared backup). Pending shared groups are excluded from partial totals until each required section is finished. Display surpluses and backup reduce section shortages in the displayed section order; section filtering shows that allocation, while the overall total counts the shared stock once. Similar names such as mixed grapes / mixed grape bowl and clementine / mandarin are also preserved separately, without assuming identity equivalence.

| Repeated source name | Fruit mobile PAR | Fruit case PAR |
| --- | ---: | ---: |
| $5 PINEAPPLE KIWI STRAWBERRY | 10 | 6 |
| $5 MIXED BERRYS | 10 | 6 |
| $5 PINEAPPLE | 10 | 18 |
| $5 MIXED MELONS | 10 | 18 |
| $5 WATERMELON | 10 | 36 |
