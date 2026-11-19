// The token the templates in templates/ put in values the user must replace. It counts anywhere
// in a file, comments included, so the template headers that name it must be stripped on write.
export const PLACEHOLDER = 'CHANGE_ME'

// Whether some text holds the token. The board asks it of a whole file, so a CHANGE_ME the user typed
// into a comment of their own still counts the file as unfinished: it is a reminder to themselves.
// The Draft asks it of one comment or value, and keeps a comment that no draft value answers, such
// as the user's note above a whole section, so the two can differ on the same file on purpose.
// Having the board judge comments as the Draft does would make it import the Draft's field tables.
export const holdsPlaceholder = (text: string): boolean => text.includes(PLACEHOLDER)
