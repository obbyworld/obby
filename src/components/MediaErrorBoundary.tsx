import { Component, type ReactNode } from "react";

/**
 * A media preview renders third-party code through lazy chunks and passive
 * effects, both of which can throw where no caller can catch them: a chunk
 * fetch fails after a deploy replaces it, or a pdf.js page effect calls into a
 * transport its Document already destroyed. An uncaught throw there takes down
 * the whole app, so we catch it and hand the failure to the caller.
 */
export class MediaErrorBoundary extends Component<
  { onError?: () => void; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onError?.();
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}
