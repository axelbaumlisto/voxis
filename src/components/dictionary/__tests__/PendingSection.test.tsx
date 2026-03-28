import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PendingSection from "../PendingSection";
import type { PendingSuggestion } from "../../../lib/commands";

const mockSuggestions: PendingSuggestion[] = [
  {
    id: 1,
    source: "solid",
    replacement: "SOLID",
    count: 2,
    first_seen: "2024-01-01",
    last_seen: "2024-01-02",
  },
  {
    id: 2,
    source: "dry",
    replacement: "DRY",
    count: 1,
    first_seen: "2024-01-01",
    last_seen: "2024-01-01",
  },
  {
    id: 3,
    source: "kiss",
    replacement: "KISS",
    count: 3,
    first_seen: "2024-01-01",
    last_seen: "2024-01-03",
  },
];

describe("PendingSection", () => {
  const defaultProps = {
    suggestions: mockSuggestions,
    threshold: 3,
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onApproveAll: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Header Tests
  // ===========================================================================
  describe("header", () => {
    it("shows suggestion count in title", () => {
      render(<PendingSection {...defaultProps} />);
      expect(screen.getByText(/Pending Suggestions \(3\)/)).toBeInTheDocument();
    });

    it("updates count when suggestions change", () => {
      const { rerender } = render(<PendingSection {...defaultProps} />);
      expect(screen.getByText(/\(3\)/)).toBeInTheDocument();

      rerender(<PendingSection {...defaultProps} suggestions={[mockSuggestions[0]]} />);
      expect(screen.getByText(/\(1\)/)).toBeInTheDocument();
    });

    it("shows 0 count when no suggestions", () => {
      render(<PendingSection {...defaultProps} suggestions={[]} />);
      expect(screen.getByText(/\(0\)/)).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Description Tests
  // ===========================================================================
  describe("description", () => {
    it("shows description when suggestions exist", () => {
      render(<PendingSection {...defaultProps} />);
      expect(
        screen.getByText(/LLM suggested these dictionary entries/)
      ).toBeInTheDocument();
    });

    it("shows empty state description when no suggestions", () => {
      render(<PendingSection {...defaultProps} suggestions={[]} />);
      expect(screen.getByText(/No pending suggestions/)).toBeInTheDocument();
    });

    it("mentions Generate from History in empty state", () => {
      render(<PendingSection {...defaultProps} suggestions={[]} />);
      expect(
        screen.getByText(/Generate from History/)
      ).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Approve All Button Tests
  // ===========================================================================
  describe("approve all button", () => {
    it("shows Approve All when more than 1 suggestion", () => {
      render(<PendingSection {...defaultProps} />);
      expect(screen.getByText("Approve All")).toBeInTheDocument();
    });

    it("hides Approve All when 1 or fewer suggestions", () => {
      render(<PendingSection {...defaultProps} suggestions={[mockSuggestions[0]]} />);
      expect(screen.queryByText("Approve All")).not.toBeInTheDocument();
    });

    it("calls onApproveAll when clicked", async () => {
      const onApproveAll = vi.fn().mockResolvedValue(undefined);
      render(<PendingSection {...defaultProps} onApproveAll={onApproveAll} />);

      fireEvent.click(screen.getByText("Approve All"));

      await waitFor(() => {
        expect(onApproveAll).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ===========================================================================
  // Generate from History Button Tests
  // ===========================================================================
  describe("generate from history button", () => {
    it("shows button when onGenerateFromHistory is provided", () => {
      render(
        <PendingSection
          {...defaultProps}
          onGenerateFromHistory={vi.fn()}
        />
      );
      expect(screen.getByText("Generate from History")).toBeInTheDocument();
    });

    it("hides button when onGenerateFromHistory is not provided", () => {
      render(<PendingSection {...defaultProps} />);
      expect(screen.queryByText("Generate from History")).not.toBeInTheDocument();
    });

    it("shows Generating... when generating", () => {
      render(
        <PendingSection
          {...defaultProps}
          onGenerateFromHistory={vi.fn()}
          generating={true}
        />
      );
      expect(screen.getByText("Generating...")).toBeInTheDocument();
    });

    it("disables button when generating", () => {
      render(
        <PendingSection
          {...defaultProps}
          onGenerateFromHistory={vi.fn()}
          generating={true}
        />
      );
      const button = screen.getByText("Generating...");
      expect(button).toBeDisabled();
    });

    it("calls onGenerateFromHistory when clicked", async () => {
      const onGenerateFromHistory = vi.fn().mockResolvedValue(undefined);
      render(
        <PendingSection
          {...defaultProps}
          onGenerateFromHistory={onGenerateFromHistory}
        />
      );

      fireEvent.click(screen.getByText("Generate from History"));

      await waitFor(() => {
        expect(onGenerateFromHistory).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ===========================================================================
  // Suggestion Item Tests
  // ===========================================================================
  describe("suggestion items", () => {
    it("renders all suggestions", () => {
      render(<PendingSection {...defaultProps} />);
      expect(screen.getByText("solid")).toBeInTheDocument();
      expect(screen.getByText("dry")).toBeInTheDocument();
      expect(screen.getByText("kiss")).toBeInTheDocument();
    });

    it("shows source and replacement", () => {
      render(<PendingSection {...defaultProps} />);
      expect(screen.getByText("SOLID")).toBeInTheDocument();
      expect(screen.getByText("DRY")).toBeInTheDocument();
      expect(screen.getByText("KISS")).toBeInTheDocument();
    });

    it("shows arrow between source and replacement", () => {
      render(<PendingSection {...defaultProps} />);
      const arrows = screen.getAllByText("→");
      expect(arrows.length).toBe(3);
    });

    it("shows count/threshold ratio", () => {
      render(<PendingSection {...defaultProps} />);
      expect(screen.getByText("2/3")).toBeInTheDocument();
      expect(screen.getByText("1/3")).toBeInTheDocument();
      expect(screen.getByText("3/3")).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Progress Bar Tests
  // ===========================================================================
  describe("progress bar", () => {
    it("calculates progress percentage correctly", () => {
      const { container } = render(<PendingSection {...defaultProps} />);
      const progressBars = container.querySelectorAll(".pending-progress");

      // 2/3 = 66.67%
      expect(progressBars[0]).toHaveStyle({ width: "66.66666666666666%" });
      // 1/3 = 33.33%
      expect(progressBars[1]).toHaveStyle({ width: "33.33333333333333%" });
      // 3/3 = 100%
      expect(progressBars[2]).toHaveStyle({ width: "100%" });
    });

    it("caps progress at 100%", () => {
      const overThreshold: PendingSuggestion = {
        ...mockSuggestions[0],
        count: 10,
      };
      const { container } = render(
        <PendingSection {...defaultProps} suggestions={[overThreshold]} />
      );

      const progressBar = container.querySelector(".pending-progress");
      expect(progressBar).toHaveStyle({ width: "100%" });
    });
  });

  // ===========================================================================
  // Ready State Tests
  // ===========================================================================
  describe("ready state", () => {
    it("marks item as ready when count >= threshold", () => {
      const { container } = render(<PendingSection {...defaultProps} />);
      const items = container.querySelectorAll(".pending-item");

      // Count 3 >= threshold 3 (kiss)
      expect(items[2]).toHaveClass("ready");
    });

    it("does not mark item as ready when count < threshold", () => {
      const { container } = render(<PendingSection {...defaultProps} />);
      const items = container.querySelectorAll(".pending-item");

      // Count 2 < threshold 3 (solid)
      expect(items[0]).not.toHaveClass("ready");
      // Count 1 < threshold 3 (dry)
      expect(items[1]).not.toHaveClass("ready");
    });
  });

  // ===========================================================================
  // Approve Button Tests
  // ===========================================================================
  describe("approve buttons", () => {
    it("renders approve button for each suggestion", () => {
      render(<PendingSection {...defaultProps} />);
      const approveButtons = screen.getAllByText("Approve");
      expect(approveButtons.length).toBe(3);
    });

    it("calls onApprove with correct id", async () => {
      const onApprove = vi.fn().mockResolvedValue(undefined);
      render(<PendingSection {...defaultProps} onApprove={onApprove} />);

      const approveButtons = screen.getAllByText("Approve");
      fireEvent.click(approveButtons[0]);

      await waitFor(() => {
        expect(onApprove).toHaveBeenCalledWith(1); // First suggestion id
      });
    });

    it("calls onApprove for second suggestion", async () => {
      const onApprove = vi.fn().mockResolvedValue(undefined);
      render(<PendingSection {...defaultProps} onApprove={onApprove} />);

      const approveButtons = screen.getAllByText("Approve");
      fireEvent.click(approveButtons[1]);

      await waitFor(() => {
        expect(onApprove).toHaveBeenCalledWith(2); // Second suggestion id
      });
    });

    it("has title attribute for accessibility", () => {
      render(<PendingSection {...defaultProps} />);
      const approveButtons = screen.getAllByText("Approve");
      expect(approveButtons[0]).toHaveAttribute("title", "Add to dictionary");
    });
  });

  // ===========================================================================
  // Reject Button Tests
  // ===========================================================================
  describe("reject buttons", () => {
    it("renders reject button for each suggestion", () => {
      render(<PendingSection {...defaultProps} />);
      const rejectButtons = screen.getAllByText("Reject");
      expect(rejectButtons.length).toBe(3);
    });

    it("calls onReject with correct id", async () => {
      const onReject = vi.fn().mockResolvedValue(undefined);
      render(<PendingSection {...defaultProps} onReject={onReject} />);

      const rejectButtons = screen.getAllByText("Reject");
      fireEvent.click(rejectButtons[0]);

      await waitFor(() => {
        expect(onReject).toHaveBeenCalledWith(1);
      });
    });

    it("has title attribute for accessibility", () => {
      render(<PendingSection {...defaultProps} />);
      const rejectButtons = screen.getAllByText("Reject");
      expect(rejectButtons[0]).toHaveAttribute("title", "Ignore this suggestion");
    });
  });

  // ===========================================================================
  // Empty State Tests
  // ===========================================================================
  describe("empty state", () => {
    it("renders empty list when no suggestions", () => {
      const { container } = render(
        <PendingSection {...defaultProps} suggestions={[]} />
      );
      const items = container.querySelectorAll(".pending-item");
      expect(items.length).toBe(0);
    });

    it("shows helpful message when empty", () => {
      render(<PendingSection {...defaultProps} suggestions={[]} />);
      expect(screen.getByText(/No pending suggestions/)).toBeInTheDocument();
    });

    it("hides Approve All when empty", () => {
      render(<PendingSection {...defaultProps} suggestions={[]} />);
      expect(screen.queryByText("Approve All")).not.toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Structure Tests
  // ===========================================================================
  describe("structure", () => {
    it("has card class", () => {
      const { container } = render(<PendingSection {...defaultProps} />);
      expect(container.querySelector(".card")).toBeInTheDocument();
    });

    it("has pending-section class", () => {
      const { container } = render(<PendingSection {...defaultProps} />);
      expect(container.querySelector(".pending-section")).toBeInTheDocument();
    });

    it("has pending-header", () => {
      const { container } = render(<PendingSection {...defaultProps} />);
      expect(container.querySelector(".pending-header")).toBeInTheDocument();
    });

    it("has pending-title", () => {
      const { container } = render(<PendingSection {...defaultProps} />);
      expect(container.querySelector(".pending-title")).toBeInTheDocument();
    });

    it("has pending-list", () => {
      const { container } = render(<PendingSection {...defaultProps} />);
      expect(container.querySelector(".pending-list")).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Different Threshold Tests
  // ===========================================================================
  describe("different thresholds", () => {
    it("calculates progress with threshold 5", () => {
      const { container } = render(
        <PendingSection {...defaultProps} threshold={5} />
      );

      // 2/5 = 40%
      expect(screen.getByText("2/5")).toBeInTheDocument();
    });

    it("shows ready at custom threshold", () => {
      const suggestion: PendingSuggestion = {
        id: 1,
        source: "test",
        replacement: "TEST",
        count: 10,
        first_seen: "2024-01-01",
        last_seen: "2024-01-01",
      };

      const { container } = render(
        <PendingSection
          {...defaultProps}
          suggestions={[suggestion]}
          threshold={10}
        />
      );

      const item = container.querySelector(".pending-item");
      expect(item).toHaveClass("ready");
    });
  });
});
