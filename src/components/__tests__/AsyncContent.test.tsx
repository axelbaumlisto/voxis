import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AsyncContent from "../AsyncContent";

describe("AsyncContent", () => {
  describe("Loading state", () => {
    it("shows loading text when loading=true", () => {
      render(
        <AsyncContent loading={true}>
          <div>Content</div>
        </AsyncContent>
      );

      expect(screen.getByText("Loading...")).toBeInTheDocument();
      expect(screen.queryByText("Content")).not.toBeInTheDocument();
    });

    it("shows custom loading text", () => {
      render(
        <AsyncContent loading={true} loadingText="Please wait...">
          <div>Content</div>
        </AsyncContent>
      );

      expect(screen.getByText("Please wait...")).toBeInTheDocument();
    });

    it("renders loading in card container by default", () => {
      render(
        <AsyncContent loading={true}>
          <div>Content</div>
        </AsyncContent>
      );

      const card = document.querySelector(".card");
      expect(card).toBeInTheDocument();
      expect(card).toContainElement(screen.getByText("Loading..."));
    });
  });

  describe("Error state", () => {
    it("shows error message when error is provided", () => {
      render(
        <AsyncContent loading={false} error="Something went wrong">
          <div>Content</div>
        </AsyncContent>
      );

      expect(
        screen.getByText(/Error: Something went wrong/)
      ).toBeInTheDocument();
      expect(screen.queryByText("Content")).not.toBeInTheDocument();
    });

    it("renders error in card container", () => {
      render(
        <AsyncContent loading={false} error="Test error">
          <div>Content</div>
        </AsyncContent>
      );

      const card = document.querySelector(".card");
      expect(card).toBeInTheDocument();
    });

    it("does not show error when error is null", () => {
      render(
        <AsyncContent loading={false} error={null}>
          <div>Content</div>
        </AsyncContent>
      );

      expect(screen.queryByText(/Error:/)).not.toBeInTheDocument();
      expect(screen.getByText("Content")).toBeInTheDocument();
    });
  });

  describe("Empty state", () => {
    it("shows empty message when isEmpty=true", () => {
      render(
        <AsyncContent loading={false} isEmpty={true}>
          <div>Content</div>
        </AsyncContent>
      );

      expect(screen.getByText("No data available")).toBeInTheDocument();
      expect(screen.queryByText("Content")).not.toBeInTheDocument();
    });

    it("shows custom empty message", () => {
      render(
        <AsyncContent loading={false} isEmpty={true} emptyMessage="No items found">
          <div>Content</div>
        </AsyncContent>
      );

      expect(screen.getByText("No items found")).toBeInTheDocument();
    });

    it("shows empty hint when provided", () => {
      render(
        <AsyncContent
          loading={false}
          isEmpty={true}
          emptyMessage="No entries"
          emptyHint="Add some entries to get started"
        >
          <div>Content</div>
        </AsyncContent>
      );

      expect(screen.getByText("No entries")).toBeInTheDocument();
      expect(
        screen.getByText("Add some entries to get started")
      ).toBeInTheDocument();
    });

    it("does not show empty hint when not provided", () => {
      render(
        <AsyncContent loading={false} isEmpty={true} emptyMessage="Empty">
          <div>Content</div>
        </AsyncContent>
      );

      expect(screen.getByText("Empty")).toBeInTheDocument();
      expect(document.querySelector(".empty-hint")).not.toBeInTheDocument();
    });

    it("uses default empty-state CSS class", () => {
      render(
        <AsyncContent loading={false} isEmpty={true}>
          <div>Content</div>
        </AsyncContent>
      );

      expect(document.querySelector(".empty-state")).toBeInTheDocument();
    });

    it("uses custom empty CSS class when provided", () => {
      render(
        <AsyncContent loading={false} isEmpty={true} emptyClassName="custom-empty">
          <div>Content</div>
        </AsyncContent>
      );

      expect(document.querySelector(".custom-empty")).toBeInTheDocument();
      expect(document.querySelector(".empty-state")).not.toBeInTheDocument();
    });
  });

  describe("Content state", () => {
    it("renders children when loaded without error or empty", () => {
      render(
        <AsyncContent loading={false} isEmpty={false}>
          <div>Main Content</div>
        </AsyncContent>
      );

      expect(screen.getByText("Main Content")).toBeInTheDocument();
    });

    it("renders children without error prop", () => {
      render(
        <AsyncContent loading={false}>
          <div>Content without error prop</div>
        </AsyncContent>
      );

      expect(screen.getByText("Content without error prop")).toBeInTheDocument();
    });

    it("renders complex children", () => {
      render(
        <AsyncContent loading={false}>
          <div>
            <h1>Title</h1>
            <p>Paragraph</p>
            <button>Action</button>
          </div>
        </AsyncContent>
      );

      expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
      expect(screen.getByText("Paragraph")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Action" })).toBeInTheDocument();
    });

    it("renders children when empty is undefined", () => {
      render(
        <AsyncContent loading={false} error={null}>
          <div>Content</div>
        </AsyncContent>
      );

      expect(screen.getByText("Content")).toBeInTheDocument();
    });
  });

  describe("State priority", () => {
    it("loading takes priority over error", () => {
      render(
        <AsyncContent loading={true} error="Error">
          <div>Content</div>
        </AsyncContent>
      );

      expect(screen.getByText("Loading...")).toBeInTheDocument();
      expect(screen.queryByText(/Error:/)).not.toBeInTheDocument();
    });

    it("error takes priority over empty", () => {
      render(
        <AsyncContent loading={false} error="Error occurred" isEmpty={true}>
          <div>Content</div>
        </AsyncContent>
      );

      expect(screen.getByText(/Error: Error occurred/)).toBeInTheDocument();
      expect(screen.queryByText("No data available")).not.toBeInTheDocument();
    });

    it("empty takes priority over content", () => {
      render(
        <AsyncContent loading={false} isEmpty={true}>
          <div>Content</div>
        </AsyncContent>
      );

      expect(screen.getByText("No data available")).toBeInTheDocument();
      expect(screen.queryByText("Content")).not.toBeInTheDocument();
    });
  });

  describe("Custom container class", () => {
    it("uses custom container class when provided", () => {
      render(
        <AsyncContent loading={true} containerClassName="custom-card">
          <div>Content</div>
        </AsyncContent>
      );

      expect(document.querySelector(".custom-card")).toBeInTheDocument();
      expect(document.querySelector(".card")).not.toBeInTheDocument();
    });
  });
});
