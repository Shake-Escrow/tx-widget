# @shake-defi/js

## 2.0.0

### Major Changes

- TokenPurchaseWidget now requires clientSecret even when params is also supplied

  Previously you could pass `params` alone to `TokenPurchaseWidget` and skip the backend call. Now the widget always needs a live buyer-bound voucher after wallet connect (via `POST /v1/widget/voucher`), which the `clientSecret` authorizes. The old "params only, zero backend calls" mode no longer exists — the constructor throws if `clientSecret` is missing.

  Migration: always pass `clientSecret` (the `tpi_…_secret_…` value from the create intent response) when constructing a `TokenPurchaseWidget`. `params` is now optional — if provided, it speeds up the first paint by skipping the initial params fetch.

## 2.0.0

### Breaking Changes

- **`clientSecret` is now required** in `TokenPurchaseWidgetOptions`, even when `params` is also supplied. Previously you could pass `params` alone and skip the backend call. Now the widget always needs a live buyer-bound voucher after wallet connect (via `POST /v1/widget/voucher`), which the `clientSecret` authorizes. The old "params only, zero backend calls" mode no longer exists.

  Migration: always pass `clientSecret` (the `tpi_…_secret_…` value from the create intent response) when constructing a `TokenPurchaseWidget`. If you were using the `params`-only shortcut, you must now also provide the corresponding `clientSecret`.

## 1.0.1

### Patch Changes

- add README documentation
