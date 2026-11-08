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
      screen.getByText("対象が見つかりません。"),
    ).toBeInTheDocument();
  });

  it("uses a translated message instead of exposing server status text", () => {
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

    expect(screen.queryByText("Service Unavailable")).not.toBeInTheDocument();
  });

  it("provides a fallback for unknown errors", () => {
    render(<ErrorBoundary error={null} params={{}} />);

    expect(screen.getByRole("heading")).toBeInTheDocument();
    expect(screen.queryByText("Oops!")).not.toBeInTheDocument();
  });
});
