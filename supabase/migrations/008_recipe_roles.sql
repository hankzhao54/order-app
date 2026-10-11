-- ============================================================
-- 008 — Two new roles for the merged recipes module
-- Run this ON ITS OWN, before 009 (Postgres needs a new enum value
-- committed before it can be used). Safe to re-run.
--
--   chef           can view and edit recipes (was "chef" in the recipes app)
--   kitchen_staff  can view recipes        (was "staff" in the recipes app)
-- ============================================================

alter type ordering.user_role add value if not exists 'chef';
alter type ordering.user_role add value if not exists 'kitchen_staff';
