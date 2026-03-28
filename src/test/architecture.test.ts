import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Architecture tests verify that the frontend follows the thin-client pattern:
 * - Hooks only call Tauri commands, no business logic
 * - Components only handle UI state
 * - All validation and business logic is in the Rust backend
 */

const SRC_DIR = path.join(__dirname, "..");

describe("Architecture", () => {
  describe("Hooks", () => {
    const hooksDir = path.join(SRC_DIR, "hooks");

    it("useSettings only calls commands, no business logic", () => {
      const content = fs.readFileSync(
        path.join(hooksDir, "useSettings.ts"),
        "utf-8"
      );

      // Should import from commands
      expect(content).toContain('from "../lib/commands"');

      // Should not contain validation patterns (regex, string validation)
      expect(content).not.toMatch(/\.match\(/);
      expect(content).not.toMatch(/\.test\(/);
      expect(content).not.toMatch(/regex/i);

      // Should not contain business validation (min/max checks on values)
      expect(content).not.toMatch(/if\s*\([^)]*\s*[<>]\s*\d+\)/); // numeric comparisons like x > 10

      // Should use invoke/commands
      expect(content).toContain("getConfig");
      expect(content).toContain("saveConfig");
    });

    it("useHistory only calls commands, no business logic", () => {
      const content = fs.readFileSync(
        path.join(hooksDir, "useHistory.ts"),
        "utf-8"
      );

      // Should import from commands
      expect(content).toContain('from "../lib/commands"');

      // Should not contain date calculations
      expect(content).not.toMatch(/new Date\([^)]*\)/);
      expect(content).not.toMatch(/\.getTime\(\)/);

      // Should use invoke/commands
      expect(content).toContain("getHistory");
      expect(content).toContain("clearHistory");
    });

    it("useDictionary only calls commands, no business logic", () => {
      const content = fs.readFileSync(
        path.join(hooksDir, "useDictionary.ts"),
        "utf-8"
      );

      // Should import from commands
      expect(content).toContain('from "../lib/commands"');

      // Should not contain validation logic
      expect(content).not.toMatch(/if\s*\([^)]*\.includes\(/);
      expect(content).not.toMatch(/\.filter\(.*\.source/);

      // Should use invoke/commands
      expect(content).toContain("getDictionary");
      expect(content).toContain("addDictionaryEntry");
      expect(content).toContain("updateDictionaryEntry");
      expect(content).toContain("deleteDictionaryEntry");
    });
  });

  describe("Commands Layer", () => {
    it("commands.ts only wraps invoke calls", () => {
      const content = fs.readFileSync(
        path.join(SRC_DIR, "lib", "commands.ts"),
        "utf-8"
      );

      // Should import invoke
      expect(content).toContain('import { invoke } from "@tauri-apps/api/core"');

      // All exported functions should just call invoke
      const exportedFunctions = content.match(/export async function \w+/g) || [];
      expect(exportedFunctions.length).toBeGreaterThan(0);

      // Should not contain business logic
      expect(content).not.toMatch(/if\s*\([^)]*\)\s*{[^}]*return/);
      expect(content).not.toMatch(/\.map\(/);
      expect(content).not.toMatch(/\.filter\(/);
      expect(content).not.toMatch(/\.reduce\(/);
    });
  });

  describe("Forbidden Imports", () => {
    const getFilesRecursively = (dir: string): string[] => {
      const files: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip test directories and node_modules-like
          if (!entry.name.includes("__tests__") && !entry.name.includes("test")) {
            files.push(...getFilesRecursively(fullPath));
          }
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          files.push(fullPath);
        }
      }

      return files;
    };

    it("frontend does not import crypto for hashing", () => {
      const files = getFilesRecursively(SRC_DIR);

      for (const file of files) {
        // Skip test files
        if (file.includes("__tests__") || file.includes(".test.")) continue;

        const content = fs.readFileSync(file, "utf-8");
        expect(content).not.toMatch(
          /import.*from ['"]crypto['"]/
        );
        expect(content).not.toMatch(/crypto\.createHash/);
      }
    });

    it("frontend does not contain validation constants", () => {
      const files = getFilesRecursively(SRC_DIR);

      for (const file of files) {
        // Skip test files and settings registry (which has UI options, not validation)
        if (
          file.includes("__tests__") ||
          file.includes(".test.") ||
          file.includes("settingsRegistry")
        )
          continue;

        const content = fs.readFileSync(file, "utf-8");

        // Should not define validation patterns
        expect(content).not.toMatch(/VALID_[A-Z]+\s*=/);
        expect(content).not.toMatch(/const\s+[A-Z_]+_REGEX\s*=/);
      }
    });
  });

  describe("Component Responsibilities", () => {
    it("components directory structure follows feature-based organization", () => {
      const componentsDir = path.join(SRC_DIR, "components");
      const entries = fs.readdirSync(componentsDir, { withFileTypes: true });

      const directories = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

      // Should have feature-based directories
      expect(directories).toContain("settings");
      expect(directories).toContain("history");
      expect(directories).toContain("dictionary");
    });

    it("pages only compose components and hooks", () => {
      const pagesDir = path.join(SRC_DIR, "pages");
      const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith(".tsx"));

      // Pages that should use hooks (connected to backend)
      const pagesWithHooks = ["SettingsPage.tsx", "HistoryPage.tsx", "DictionaryPage.tsx"];

      for (const file of pagesWithHooks) {
        const content = fs.readFileSync(path.join(pagesDir, file), "utf-8");

        // Should import hooks
        expect(content).toMatch(/import.*from ['"]\.\.\/hooks\//);

        // Should not directly call invoke
        expect(content).not.toMatch(/invoke\(/);
      }

      // All pages should not directly call invoke
      for (const file of files) {
        const content = fs.readFileSync(path.join(pagesDir, file), "utf-8");
        expect(content).not.toMatch(/invoke\(/);
      }
    });
  });
});
