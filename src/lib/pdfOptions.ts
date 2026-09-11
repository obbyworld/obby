// Stable reference: react-pdf reloads the document whenever the `options` prop
// is a new object, so this must never be reallocated per render. isEvalSupported
// is disabled to stop pdf.js from running eval() on untrusted document content.
export const PDF_OPTIONS = { isEvalSupported: false } as const;
