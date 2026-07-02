# @shake-defi/react

## 2.0.0

### Major Changes

- TokenPurchaseWidget now requires clientSecret even when params is also supplied

  Previously you could pass `params` alone to `TokenPurchaseWidget` and skip the backend call. Now the widget always needs a live buyer-bound voucher after wallet connect (via `POST /v1/widget/voucher`), which the `clientSecret` authorizes. The old "params only, zero backend calls" mode no longer exists — the constructor throws if `clientSecret` is missing.

  Migration: always pass `clientSecret` (the `tpi_…_secret_…` value from the create intent response) when constructing a `TokenPurchaseWidget`. `params` is now optional — if provided, it speeds up the first paint by skipping the initial params fetch.

### Patch Changes

- Updated dependencies
  - @shake-defi/js@2.0.0

## 2.0.0

### Breaking Changes

- **`clientSecret` is now required** in `<TokenPurchaseWidget>`, even when `params` is also supplied. The underlying `@shake-defi/js` widget always needs a live buyer-bound voucher after wallet connect, which the `clientSecret` authorizes. The old `params`-only mode no longer works — the widget constructor throws if `clientSecret` is missing.

  Migration: always pass `clientSecret` (the `tpi_…_secret_…` value from the create intent response) to `<TokenPurchaseWidget>`. If you were using `params` alone, you must now also provide the corresponding `clientSecret`.

- Updated dependencies
  - @shake-defi/js@2.0.0

## 1.0.1

### Patch Changes

- add README documentation
- Updated dependencies
  - @shake-defi/js@1.0.1
