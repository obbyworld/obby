import { Component, type ReactNode } from "react";

// Stable reference: react-pdf reloads the document whenever the `options` prop
// is a new object, so this must never be reallocated per render. isEvalSupported
// is disabled to stop pdf.js from running eval() on untrusted document content.
export const PDF_OPTIONS = { isEvalSupported: false } as const;

/**
 * react-pdf renders pages through pdf.js passive effects. When the surrounding
 * Document unmounts (channel switch, StrictMode re-invoke) the worker transport
 * is destroyed, but a still-pending Page effect can call into it and throw
 * "Cannot read properties of null (reading 'sendWithPromise')". Without a
 * boundary that throw is uncaught and takes down the whole app, so we catch it
 * and let the caller fall back to a non-pdf.js renderer.
 */
export class PdfErrorBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}
