// Minimal shim to satisfy TS when bundler resolves ESM entry lacking types.
// 'pg' v8 ships types, but with bundler moduleResolution Next may not pick them.
// This avoids blocking build; runtime behavior is unaffected.
declare module 'pg';

