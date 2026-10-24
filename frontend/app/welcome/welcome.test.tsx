import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Welcome } from "./welcome";

describe("Welcome", () => {
  it("renders the welcome content", () => {
    render(<Welcome />);

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByText("What's next?")).toBeInTheDocument();
  });

  it("provides documentation and community links", () => {
    render(<Welcome />);

    expect(
      screen.getByRole("link", { name: "React Router Docs" }),
    ).toHaveAttribute("href", "https://reactrouter.com/docs");
    expect(screen.getByRole("link", { name: "Join Discord" })).toHaveAttribute(
      "href",
      "https://rmx.as/discord",
    );
  });
});
