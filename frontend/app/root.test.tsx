import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ErrorBoundary } from "./root";

describe("ErrorBoundary", () => {
  it("explains that a requested page does not exist", () => {
    render(
      <ErrorBoundary
        error={{
          status: 404,
          statusText: "Not Found",
          internal: false,
          data: null,
        }}
        params={{}}
      />,
    );

    expect(screen.getByRole("heading", { name: "404" })).toBeInTheDocument();
    expect(
      screen.getByText("The requested page could not be found."),
    ).toBeInTheDocument();
  });

  it("displays the status text of other route errors", () => {
    render(
      <ErrorBoundary
        error={{
          status: 503,
          statusText: "Service Unavailable",
          internal: false,
          data: null,
        }}
        params={{}}
      />,
    );

    expect(screen.getByRole("heading", { name: "Error" })).toBeInTheDocument();
    expect(screen.getByText("Service Unavailable")).toBeInTheDocument();
  });

  it("provides a fallback for unknown errors", () => {
    render(<ErrorBoundary error={null} params={{}} />);

    expect(screen.getByRole("heading", { name: "Oops!" })).toBeInTheDocument();
    expect(
      screen.getByText("An unexpected error occurred."),
    ).toBeInTheDocument();
  });
});
