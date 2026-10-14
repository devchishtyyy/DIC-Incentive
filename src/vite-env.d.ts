/// <reference types="vite/client" />

/**
 * There are no SAP credentials in client code, and nothing here to declare for them.
 *
 * The signing key, client ID and company ID live on the server and are read from `SF_*`
 * environment variables in vite.config.ts — never `VITE_SF_*`, because Vite publishes
 * anything with that prefix into the browser bundle. The browser asks `/api/sap/roster`
 * for the finished list and holds no secret of any kind. See `server/sapRoster.ts`.
 */
