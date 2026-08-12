/**
 * This module's own strings.
 *
 * Kept here rather than in `web/src/i18n/en.js` so that a module is one folder
 * you can copy, fork or delete whole. The browser merges these by globbing
 * `modules/*​/i18n/`; the server reads them from the manifest's `i18n` field.
 * Core keys win a collision, so a module cannot redefine "Save".
 *
 * Every key a module adds must exist in both languages — the contract test
 * fails otherwise, because a name that only exists in one shows a raw key in
 * the other.
 */
export default {
  'module.exampleBank.label': 'Example bank (CSV statements)',
  'module.exampleBank.config.profile': 'Institution wording',

  // A notification is stored as a key and rendered whenever it is opened, so it
  // reads in whatever language is current then. Both `.title` and `.body`.
  'notify.exampleBank.import.title': 'Example bank import',
  'notify.exampleBank.import.body': '{imported} new movements from {files} file(s)',
};
