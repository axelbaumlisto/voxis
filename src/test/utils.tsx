import { render, RenderOptions } from "@testing-library/react";
import { ReactElement, ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";

// =============================================================================
// Test Wrappers
// =============================================================================

interface WrapperProps {
  children: ReactNode;
}

/**
 * Wrapper with Router for testing components that use react-router.
 */
function RouterWrapper({ children }: WrapperProps) {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      {children}
    </BrowserRouter>
  );
}

// =============================================================================
// Custom Render
// =============================================================================

interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  withRouter?: boolean;
}

/**
 * Custom render with optional providers.
 */
function customRender(
  ui: ReactElement,
  { withRouter = false, ...options }: CustomRenderOptions = {}
) {
  if (withRouter) {
    return render(ui, { wrapper: RouterWrapper, ...options });
  }
  return render(ui, options);
}

// Re-export everything
export * from "@testing-library/react";
export { customRender as render };
