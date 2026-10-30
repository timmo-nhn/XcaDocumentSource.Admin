# XcaDocumentSource.Admin
Admin frontend for XcaDocumentSource
<<<<<<< HEAD

Enter the shared API key and click **Connect** to connect to every configured
instance concurrently. Instances are configured in [js/sources.js](js/sources.js).
Each instance has its own expandable accordion with connection status, Swagger
link, health/configuration panels, patient list, and upload forms. Multiple
accordions can stay open at the same time.

For an arbitrary instance, enter its HTTP(S) base URL in the override field and
click **Connect instance**. This adds an expanded accordion without replacing
existing connections; entering an already listed URL refreshes that instance.
The same API-key field is used for configured and custom instances. Custom URLs
are session-only; **Connect** reloads the configured list.

Each accordion header shows a compact health indicator and the last reported
uptime, even while collapsed. Refresh updates these values; unavailable health
checks or failed connections are shown explicitly instead of retaining stale
health information.

The header also shows the document entry count from
`/api/about/registryobjects` for each datacenter (BG, OSL, TRD), queried via
the instance URL with the host prefixed by `static-bg-`, `static-osl-` and
`static-trd-`. Counts are green when all match and yellow when they differ or
a datacenter is unavailable (shown as `—`; hover for details).

Use the **BG**, **OSL** and **TRD** buttons next to **Refresh** to point the
existing accordion at that datacenter's `static-<dc>-` host. A label to the
right of the buttons shows the current target (`Connected to: OSL`, or
`default`). Click the active datacenter again to return to the default URL.

Actions and automatic refreshes affect only their own instance. Use **Refresh**
inside an accordion to reload that instance or retry a failed connection.
An unreachable instance or invalid key does not block the other instances.
Clicking **Connect** again recreates the connections using the current shared key.

Patient document lists load 50 entries at a time. Use **Load more** below the
table to append the next page. Entries are sorted by title within each page.
Editing or deleting a document refreshes the list from page 1. Failed page
requests can be retried without losing the documents already displayed.
**Download all document entries as a ZIP** still includes all pages.

## ATNA Log Exporter

Open **ATNA Log Exporter** from the main page, or go to `/atna.html`. Select
Dev, Test, QA, Production or a custom HTTP(S) base URL, optionally enter an
API key, and click **Connect**. The connection is independent of the document
source page; credentials and audit results are not saved in browser storage.
Changing connection inputs takes effect only when you click **Connect**.

The page shows `/healthz`, including unhealthy reports returned with HTTP 503.
Health uses the same shared status cards and colors as the document-source
page, including loading and error cards when refreshing.
Search `/R4/fhir/AuditEvent` by local date/time range, patient identifier and
source identifier, or read by event ID. View JSON for complete event details.
Results use the main page's table styles, with an
`Events (count)` heading reflecting the displayed rows.
Click an event row to toggle read-only JSON in an
expandable row directly underneath it.
Recorded is the first column and uses local time with two fractional-second
digits (`YYYY-MM-DD HH:mm:ss.SS`); hover for the original timestamp.
Events are sorted newest-first by recorded time. Missing or invalid timestamps
appear last.
Searches reflect the exporter's available cache, not a full PostgreSQL history.
Dead letters are loaded explicitly from `/admin/dead-letter`; retry and resolve
require confirmation and affect the connected instance only. Resolve does not
reprocess an event. No audit events are written merely by connecting/searching.
The DLQ uses the same table and inline JSON expansion, a `Dead letters (count)`
heading, and compact emoji actions with accessible labels. Click a row or its
JSON action to expand details; retry/resolve do not toggle the row.
Failed at is the first column, formatted like Recorded, and failures sort
newest-first with missing/invalid dates last.

Run with `npm start`. ATNA requests use the existing local `/proxy` endpoint.
Restart the server after updating its code.
The proxy forwards the optional API key as `X-Api-Key`.
Do not expose this local administration server to untrusted clients.

## Verification

Run API regression tests with `node --test tests\documentsApi.test.js`.
Run ATNA API regression tests with `node --test tests\atnaApi.test.js`.
Open `/tests/atna.html` for ATNA browser regression checks using mocked
responses (no real instance mutations). Set `PORT` before starting Node to
use a port other than the default `8000`.
With the admin server running, open `/tests/multiInstance.html` to run the
multi-instance browser regression checks. These use mocked API responses and
do not connect to or modify real instances.
=======
>>>>>>> 2802192493c39ce276fa6d77ef47d2c064457dbc
