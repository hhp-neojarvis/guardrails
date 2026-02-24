import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("renders the heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Guardrails",
    );
  });

  it("renders the tagline", () => {
    render(<App />);
    expect(
      screen.getByText("Media Executor Guardrails Tool"),
    ).toBeInTheDocument();
  });
});
