/**
 * Admin suggestions routes — stub module.
 *
 * The admin suggestion routes (status changes, merge, disputes, blocked topics)
 * are defined in suggestions.js alongside the public routes because they share
 * the same router, helpers, and Firebase mock context in tests.
 *
 * This module exists as a mount point in index.js but delegates to
 * an empty router to avoid double-registering the suggestions routes.
 *
 * Routes (defined in suggestions.js):
 *   GET    /admin/suggestions                 -> all suggestions including pending
 *   PUT    /admin/suggestions/:id/status      -> change status
 *   PUT    /admin/suggestions/:id/link        -> link to roadmap feature
 *   POST   /admin/suggestions/:id/merge       -> merge as duplicate
 *   GET    /admin/suggestions/disputes        -> list pending disputes
 *   PUT    /admin/suggestions/disputes/:id    -> resolve dispute
 *   DELETE /admin/suggestions/blocked/:id     -> unblock topic
 *   POST   /suggestions/:id/dispute           -> dispute a merge (user)
 */

const router = require('express').Router();

// All admin suggestion routes live in suggestions.js to share the router.
// This empty router is exported for index.js compatibility.

module.exports = router;
