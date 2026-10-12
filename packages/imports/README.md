# CSV imports

This package plans CSV imports without reading or writing storage. The backend must execute commit and undo plans atomically.

The single Version 1 header is:

```csv
sourceId,date,merchant,amount,status,category,kind
```

`amount` is a non-negative USD decimal with at most two fractional digits. `status` is `pending` or `posted`; `kind` is `purchase`, `refund`, `payment`, `transfer`, or `cash`. `category` may be empty. Fields may use standard CSV quoting, including escaped double quotes and embedded commas/newlines.
