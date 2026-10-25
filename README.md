# Lekha

Free, offline accounting software for Indian small and medium businesses.

Lekha runs on your own computer. Each company is one file on your disk, and
it works without an internet connection.

## Features

- Double-entry accounting: chart of accounts, journal entries, payments
- Sales and purchase invoices, quotations, returns and print templates
- Inventory: batches, serial numbers, FIFO valuation, stock reports
- Point of Sale with barcode scanning
- GST: GSTIN, HSN codes, GSTR-1 and GSTR-2 reports with export
- Reports: General Ledger, Profit and Loss, Balance Sheet, Trial Balance
- Interface in Hindi, Gujarati and other languages

## Development

Requires Node.js and the Visual Studio C++ build tools (Windows).

```sh
npx yarn@1.22.22 install --frozen-lockfile --ignore-scripts
node node_modules/electron/install.js
npx electron-rebuild
npx yarn@1.22.22 dev
```

`--ignore-scripts` skips building `better-sqlite3` against the system Node.js,
which fails on recent Node versions; `electron-rebuild` builds it for the
bundled Electron instead.

Build the sources without packaging:

```sh
node build/scripts/build.mjs --nopackage
```

## Credits

Lekha is a fork of [Frappe Books](https://github.com/frappe/books), the
Electron/Vue desktop app by Frappe Technologies Pvt. Ltd., which reached end of
life in October 2026. We are grateful to its authors and contributors.

## License

[GNU Affero General Public License v3.0 only](LICENSE), the same license as
Frappe Books. If you distribute Lekha or a modified version, you must make its
complete source code available under the same license.
