/**
 * Shared multipart-upload helper.
 *
 * Both the storage proxy (routes/storage.js) and the banner admin route
 * (routes/banners.js) accept a single ≤10 MB image via multer and must
 * translate multer-layer errors into clean JSON responses rather than
 * Express's default 500/HTML handler. That translation is identical in both
 * routes, so it lives here as a single source of truth for the 413/400
 * upload-error contract (and removes the duplicated block SonarCloud flags
 * as new-code duplication).
 */

/**
 * Wraps `upload.single(field)` so multer-layer errors become clean JSON
 * responses instead of Express's default 500/HTML:
 *   - `LIMIT_FILE_SIZE` → 413 `{ error: 'File too large (max 10 MB)' }`
 *   - any other error   → 400 `{ error: <err.message> }`
 * On success it delegates to the next handler. The second branch is
 * intentionally broad: multer forwards a `fileFilter` rejection as a plain
 * `Error` (no `.code`), so those land here too — not just `MulterError`s.
 *
 * @param {import('multer').Multer} upload a configured multer instance
 * @param {string} field the multipart field name (e.g. 'file')
 * @returns {import('express').RequestHandler}
 */
function singleFileUpload(upload, field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'File too large (max 10 MB)' });
        }
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  };
}

module.exports = { singleFileUpload };
