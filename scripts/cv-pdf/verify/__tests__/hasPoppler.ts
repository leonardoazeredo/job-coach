import { findPoppler } from '../poppler.ts'

// Tests that run the real verifier skip on a machine without poppler instead of failing,
// because PDF export is optional.
export const hasPoppler = !('missing' in findPoppler())
