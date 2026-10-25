# Publish one shared roadmap

Production website: <https://roadmap-ruby-eta.vercel.app>.

## Automatic updates from GitHub

Vercel is connected to `galkoso/roadmap`, with `main` as the production branch.
Commit your changes and push them to GitHub (`git push origin main`, or use
**Commit & Push**). Each push to `main` starts a build and updates the production
website after a successful build. Commits on your computer do not deploy until
you push them. Build failures keep the last successful website available.

`vercel.json` explicitly enables Git deployments. Other branches create preview
deployments; their shared database requires separate Preview environment settings.
Deployment status is available at <https://vercel.com/galkoso/roadmap>.

The hosted app uses one shared roadmap. Visitors sign in with the shared password before they can read, edit, delete,
or import a replacement. No username or account is required. Login sessions last
seven days and use a signed HttpOnly cookie; the data API rejects unauthenticated
requests. Use the navigation bar’s logout button to clear the browser session. Each browser keeps its
own zoom, filters, and collapsed groups. Other visitors see saved changes within
about 10 seconds while no editor is open. Concurrent saves use a revision check:
a stale save is rejected and its unsaved changes remain available for export.
This is shared editing with conflict detection, not simultaneous text merging.

## Connect Vercel and Upstash

1. Import `galkoso/roadmap` at <https://vercel.com/new>.
   `vercel.json` supplies the Angular build, output directory, and page routing.
2. Create an Upstash Redis database at <https://console.upstash.com/>.
3. In the Vercel project, open **Settings → Environment Variables**, and add:

   | Variable | Value |
   | --- | --- |
   | `UPSTASH_REDIS_REST_URL` | Database REST URL from the Upstash console |
   | `UPSTASH_REDIS_REST_TOKEN` | Database REST token with read/write access |
   | `ROADMAP_SESSION_SECRET` | Recommended: a long random secret used to sign login cookies. If omitted, the existing Redis REST token signs sessions. Changing the signing secret invalidates existing sessions. |
   | `ROADMAP_STORAGE_KEY` | Optional; defaults to `roadmap:shared:v1` |

   Keep the token in Vercel settings. It must not appear in source files or
   browser configuration. The password is verified by `/api/login` on the server; the browser bundle does
   not contain the password or its hash. The browser talks to `/api/roadmap`; only the server
   contacts Redis.
4. Set these for **Production**. For **Preview**, use a separate database or a
   distinct `ROADMAP_STORAGE_KEY`, such as `roadmap:preview:v1`, so test deployments
   cannot change the live roadmap. Preview deployments sharing a key share data.
5. Deploy/redeploy after adding the variables. Open the production URL in two
   browsers, edit a team or task in one, close the editor, and verify the other
   updates within about 10 seconds.

If the database is missing or unavailable, the hosted app shows an error and
never silently creates a separate browser-only roadmap. Restoring the database
connection and choosing Retry loads the shared data.

## Bring your existing roadmap online

Your current browser data is not uploaded automatically. This avoids having a
visitor's old local data overwrite the shared plan.

1. Before changing where you use the app, open your existing local app at the
   same address you previously used (`localhost` and `127.0.0.1` have separate data).
2. Open **⋯ → גיבוי ושחזור → ייצוא גיבוי JSON**.
3. Open the deployed website and use **⋯ → גיבוי ושחזור → בחירת קובץ לשחזור**.
4. Review the summary and confirm replacement. The import updates the shared
   roadmap for everyone. Keep your exported JSON as a backup.

An empty shared database starts with the app's sample roadmap. Local development
(`pnpm start` / `pnpm preview` on localhost) retains the original IndexedDB storage
and uses the same password-only login. The development command starts a local
authentication endpoint automatically. Restarting the local server clears local sessions.
To run the actual API locally, use Vercel's local environment with database variables;
the browser's shared-storage path is selected on a non-local hostname.

## Operational details

- `pnpm build` runs `pnpm check:api` before building Angular. This checks the server dependency graph using Node ESM resolution; server imports use explicit `.js` extensions so they run on Vercel.
- The API validates roadmap schema and references before writing; Redis performs
  the revision comparison and write atomically using Lua `EVAL`.
- View-only changes never write a shared roadmap revision.
- Refresh pauses during open editors, dialogs, unsaved capacity drafts, or saves.
  Loading another person's changes resets Undo/Redo so Undo cannot restore stale
  data over their changes.
- On a conflict, export unsaved changes if needed, then choose **טעינת הגרסה החדשה**
  and reapply your changes. The app does not merge conflicting documents.
- API writes are limited to about 3.5 MB. Large imported files may need reducing.
- Browser data is not used as a substitute if a shared save fails. Keep regular
  exported backups; all users with the shared password can replace or delete data.
- Polling generates database requests while visitors have the page open. Check
  your database plan's current request limits and pricing before wide usage.

References: [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js),
[Vercel environment variables](https://vercel.com/docs/environment-variables),
[Upstash REST API](https://upstash.com/docs/redis/features/restapi).
