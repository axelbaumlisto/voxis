import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockInvoke,
  mockConfig,
  mockHistoryEntries,
  mockDictionaryEntries,
  mockAudioDevices,
  mockTranscriptionResult,
  mockLlmProviders,
} from "../../test/mocks/tauri";
import {
  // Config
  getConfig,
  saveConfig,
  // History
  getHistory,
  addHistoryEntry,
  clearHistory,
  // Dictionary
  getDictionary,
  addDictionaryEntry,
  deleteDictionaryEntry,
  updateDictionaryEntry,
  // Pending suggestions
  getPendingSuggestions,
  getPendingCount,
  approveSuggestion,
  approveSuggestionBySource,
  rejectSuggestion,
  rejectSuggestionBySource,
  reprocessHistoryForSuggestions,
  // Recording
  listAudioDevices,
  startRecording,
  stopRecording,
  getRecordingStatus,
  getAudioLevel,
  // Transcription
  transcribeAudio,
  // Output
  copyToClipboard,
  typeText,
  // Overlay
  showOverlay,
  hideOverlay,
  updateOverlayPosition,
  getVisualizationThemes,
  previewVisualizationTheme,
  // Debug
  getDebugEntries,
  clearDebug,
  getDebugDir,
  // LLM Providers
  getLlmProviders,
  addLlmProvider,
  removeLlmProvider,
  updateLlmProvider,
  // Types
  AppConfig,
} from "../commands";

describe("commands.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Config Commands
  // ===========================================================================
  describe("Config Commands", () => {
    describe("getConfig", () => {
      it("calls invoke with correct command", async () => {
        const result = await getConfig();
        expect(mockInvoke).toHaveBeenCalledWith("get_config");
        expect(result).toEqual(mockConfig);
      });

      it("returns full AppConfig structure", async () => {
        const result = await getConfig();
        expect(result).toHaveProperty("api_key");
        expect(result).toHaveProperty("model");
        expect(result).toHaveProperty("language");
        expect(result).toHaveProperty("hotkey");
        expect(result).toHaveProperty("auto_type");
        expect(result).toHaveProperty("auto_enter");
        expect(result).toHaveProperty("typing_delay");
        expect(result).toHaveProperty("notifications");
        expect(result).toHaveProperty("backend");
        expect(result).toHaveProperty("debug");
        expect(result).toHaveProperty("audio_device");
        expect(result).toHaveProperty("history_enabled");
        expect(result).toHaveProperty("history_days");
        expect(result).toHaveProperty("active_provider");
        expect(result).toHaveProperty("cloud_provider");
        expect(result).toHaveProperty("local_backend");
        expect(result).toHaveProperty("text_processing");
        expect(result).toHaveProperty("vad");
        expect(result).toHaveProperty("overlay");
        expect(result).toHaveProperty("llm");
        expect(result).toHaveProperty("dictionary");
      });

      it("returns nested config objects", async () => {
        const result = await getConfig();
        expect(result.vad).toHaveProperty("enabled");
        expect(result.vad).toHaveProperty("threshold");
        expect(result.overlay).toHaveProperty("enabled");
        expect(result.overlay).toHaveProperty("position");
        expect(result.overlay).toHaveProperty("size");
        expect(result.overlay).toHaveProperty("margin");
        expect(result.llm).toHaveProperty("enabled");
        expect(result.llm).toHaveProperty("provider");
        expect(result.llm).toHaveProperty("api_url");
        expect(result.llm).toHaveProperty("api_key");
        expect(result.llm).toHaveProperty("model");
        expect(result.llm).toHaveProperty("prompt");
        expect(result.dictionary).toHaveProperty("path");
        expect(result.dictionary).toHaveProperty("learning_mode");
        expect(result.dictionary).toHaveProperty("learning_threshold");
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Config not found"));
        await expect(getConfig()).rejects.toThrow("Config not found");
      });
    });

    describe("saveConfig", () => {
      it("calls invoke with config object", async () => {
        const newConfig: AppConfig = { ...mockConfig, debug: true };
        await saveConfig(newConfig);
        expect(mockInvoke).toHaveBeenCalledWith("save_config", { config: newConfig });
      });

      it("handles save errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Validation failed"));
        await expect(saveConfig(mockConfig)).rejects.toThrow("Validation failed");
      });
    });
  });

  // ===========================================================================
  // History Commands
  // ===========================================================================
  describe("History Commands", () => {
    describe("getHistory", () => {
      it("calls invoke without limit", async () => {
        const result = await getHistory();
        expect(mockInvoke).toHaveBeenCalledWith("get_history", { limit: undefined });
        expect(result).toEqual(mockHistoryEntries);
      });

      it("calls invoke with limit", async () => {
        await getHistory(10);
        expect(mockInvoke).toHaveBeenCalledWith("get_history", { limit: 10 });
      });

      it("returns array of history entries", async () => {
        const result = await getHistory();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
        expect(result[0]).toHaveProperty("id");
        expect(result[0]).toHaveProperty("timestamp");
        expect(result[0]).toHaveProperty("text");
        expect(result[0]).toHaveProperty("language");
        expect(result[0]).toHaveProperty("duration");
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Database error"));
        await expect(getHistory()).rejects.toThrow("Database error");
      });
    });

    describe("addHistoryEntry", () => {
      it("calls invoke with text only", async () => {
        await addHistoryEntry("Hello world");
        expect(mockInvoke).toHaveBeenCalledWith("add_history_entry", {
          text: "Hello world",
          language: undefined,
          duration: undefined,
        });
      });

      it("calls invoke with all parameters", async () => {
        await addHistoryEntry("Hello world", "en", 2.5);
        expect(mockInvoke).toHaveBeenCalledWith("add_history_entry", {
          text: "Hello world",
          language: "en",
          duration: 2.5,
        });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Insert failed"));
        await expect(addHistoryEntry("test")).rejects.toThrow("Insert failed");
      });
    });

    describe("clearHistory", () => {
      it("calls invoke with correct command", async () => {
        await clearHistory();
        expect(mockInvoke).toHaveBeenCalledWith("clear_history");
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Permission denied"));
        await expect(clearHistory()).rejects.toThrow("Permission denied");
      });
    });
  });

  // ===========================================================================
  // Dictionary Commands
  // ===========================================================================
  describe("Dictionary Commands", () => {
    describe("getDictionary", () => {
      it("calls invoke with correct command", async () => {
        const result = await getDictionary();
        expect(mockInvoke).toHaveBeenCalledWith("get_dictionary");
        expect(result).toEqual(mockDictionaryEntries);
      });

      it("returns array with source and replacement", async () => {
        const result = await getDictionary();
        expect(Array.isArray(result)).toBe(true);
        expect(result[0]).toHaveProperty("id");
        expect(result[0]).toHaveProperty("source");
        expect(result[0]).toHaveProperty("replacement");
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("File not found"));
        await expect(getDictionary()).rejects.toThrow("File not found");
      });
    });

    describe("addDictionaryEntry", () => {
      it("calls invoke with source and replacement", async () => {
        await addDictionaryEntry("test", "TEST");
        expect(mockInvoke).toHaveBeenCalledWith("add_dictionary_entry", {
          source: "test",
          replacement: "TEST",
        });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Duplicate entry"));
        await expect(addDictionaryEntry("test", "TEST")).rejects.toThrow("Duplicate entry");
      });
    });

    describe("deleteDictionaryEntry", () => {
      it("calls invoke with id", async () => {
        await deleteDictionaryEntry(1);
        expect(mockInvoke).toHaveBeenCalledWith("delete_dictionary_entry", { id: 1 });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Entry not found"));
        await expect(deleteDictionaryEntry(999)).rejects.toThrow("Entry not found");
      });
    });

    describe("updateDictionaryEntry", () => {
      it("calls invoke with id, source, and replacement", async () => {
        await updateDictionaryEntry(1, "updated", "UPDATED");
        expect(mockInvoke).toHaveBeenCalledWith("update_dictionary_entry", {
          id: 1,
          source: "updated",
          replacement: "UPDATED",
        });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Update failed"));
        await expect(updateDictionaryEntry(1, "a", "b")).rejects.toThrow("Update failed");
      });
    });
  });

  // ===========================================================================
  // Pending Suggestions Commands
  // ===========================================================================
  describe("Pending Suggestions Commands", () => {
    const mockSuggestions = [
      {
        id: 1,
        source: "test",
        replacement: "TEST",
        count: 2,
        first_seen: "2024-01-01",
        last_seen: "2024-01-02",
      },
    ];

    describe("getPendingSuggestions", () => {
      it("calls invoke with correct command", async () => {
        const result = await getPendingSuggestions();
        expect(mockInvoke).toHaveBeenCalledWith("get_pending_suggestions");
        expect(Array.isArray(result)).toBe(true);
      });

      it("returns suggestions with all fields", async () => {
        mockInvoke.mockResolvedValueOnce(mockSuggestions);
        const result = await getPendingSuggestions();
        expect(result[0]).toHaveProperty("id");
        expect(result[0]).toHaveProperty("source");
        expect(result[0]).toHaveProperty("replacement");
        expect(result[0]).toHaveProperty("count");
        expect(result[0]).toHaveProperty("first_seen");
        expect(result[0]).toHaveProperty("last_seen");
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Database error"));
        await expect(getPendingSuggestions()).rejects.toThrow("Database error");
      });
    });

    describe("getPendingCount", () => {
      it("calls invoke with correct command", async () => {
        mockInvoke.mockResolvedValueOnce(5);
        const result = await getPendingCount();
        expect(mockInvoke).toHaveBeenCalledWith("get_pending_count");
        expect(result).toBe(5);
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Count failed"));
        await expect(getPendingCount()).rejects.toThrow("Count failed");
      });
    });

    describe("approveSuggestion", () => {
      it("calls invoke with id", async () => {
        await approveSuggestion(1);
        expect(mockInvoke).toHaveBeenCalledWith("approve_suggestion", { id: 1 });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Approval failed"));
        await expect(approveSuggestion(1)).rejects.toThrow("Approval failed");
      });
    });

    describe("approveSuggestionBySource", () => {
      it("calls invoke with source and replacement", async () => {
        await approveSuggestionBySource("test", "TEST");
        expect(mockInvoke).toHaveBeenCalledWith("approve_suggestion_by_source", {
          source: "test",
          replacement: "TEST",
        });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Not found"));
        await expect(approveSuggestionBySource("x", "y")).rejects.toThrow("Not found");
      });
    });

    describe("rejectSuggestion", () => {
      it("calls invoke with id", async () => {
        await rejectSuggestion(1);
        expect(mockInvoke).toHaveBeenCalledWith("reject_suggestion", { id: 1 });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Rejection failed"));
        await expect(rejectSuggestion(1)).rejects.toThrow("Rejection failed");
      });
    });

    describe("rejectSuggestionBySource", () => {
      it("calls invoke with source and replacement", async () => {
        await rejectSuggestionBySource("test", "TEST");
        expect(mockInvoke).toHaveBeenCalledWith("reject_suggestion_by_source", {
          source: "test",
          replacement: "TEST",
        });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Not found"));
        await expect(rejectSuggestionBySource("x", "y")).rejects.toThrow("Not found");
      });
    });

    describe("reprocessHistoryForSuggestions", () => {
      it("calls invoke without limit", async () => {
        const result = await reprocessHistoryForSuggestions();
        expect(mockInvoke).toHaveBeenCalledWith("reprocess_history_for_suggestions", {
          limit: undefined,
        });
        expect(result).toHaveProperty("processed");
        expect(result).toHaveProperty("suggestions_found");
        expect(result).toHaveProperty("recorded");
        expect(result).toHaveProperty("promoted");
        expect(result).toHaveProperty("skipped");
      });

      it("calls invoke with limit", async () => {
        await reprocessHistoryForSuggestions(50);
        expect(mockInvoke).toHaveBeenCalledWith("reprocess_history_for_suggestions", {
          limit: 50,
        });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("LLM unavailable"));
        await expect(reprocessHistoryForSuggestions()).rejects.toThrow("LLM unavailable");
      });
    });
  });

  // ===========================================================================
  // Recording Commands
  // ===========================================================================
  describe("Recording Commands", () => {
    describe("listAudioDevices", () => {
      it("calls invoke with correct command", async () => {
        const result = await listAudioDevices();
        expect(mockInvoke).toHaveBeenCalledWith("list_audio_devices");
        expect(result).toEqual(mockAudioDevices);
      });

      it("returns devices with required fields", async () => {
        const result = await listAudioDevices();
        expect(result[0]).toHaveProperty("id");
        expect(result[0]).toHaveProperty("name");
        expect(result[0]).toHaveProperty("is_default");
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Audio system unavailable"));
        await expect(listAudioDevices()).rejects.toThrow("Audio system unavailable");
      });
    });

    describe("startRecording", () => {
      it("calls invoke without device id", async () => {
        await startRecording();
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", { deviceId: undefined });
      });

      it("calls invoke with device id", async () => {
        await startRecording("hw:0,0");
        expect(mockInvoke).toHaveBeenCalledWith("start_recording", { deviceId: "hw:0,0" });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Device not found"));
        await expect(startRecording("invalid")).rejects.toThrow("Device not found");
      });
    });

    describe("stopRecording", () => {
      it("calls invoke with correct command", async () => {
        await stopRecording();
        expect(mockInvoke).toHaveBeenCalledWith("stop_recording");
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Not recording"));
        await expect(stopRecording()).rejects.toThrow("Not recording");
      });
    });

    describe("getRecordingStatus", () => {
      it("returns false when not recording", async () => {
        const result = await getRecordingStatus();
        expect(mockInvoke).toHaveBeenCalledWith("get_recording_status");
        expect(typeof result).toBe("boolean");
      });

      it("returns true when recording", async () => {
        await startRecording();
        const result = await getRecordingStatus();
        expect(result).toBe(true);
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("State error"));
        await expect(getRecordingStatus()).rejects.toThrow("State error");
      });
    });

    describe("getAudioLevel", () => {
      it("returns level as number", async () => {
        const result = await getAudioLevel();
        expect(mockInvoke).toHaveBeenCalledWith("get_audio_level");
        expect(typeof result).toBe("number");
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Level unavailable"));
        await expect(getAudioLevel()).rejects.toThrow("Level unavailable");
      });
    });
  });

  // ===========================================================================
  // Transcription Commands
  // ===========================================================================
  describe("Transcription Commands", () => {
    describe("transcribeAudio", () => {
      it("calls invoke with api key only", async () => {
        const result = await transcribeAudio("test-key");
        expect(mockInvoke).toHaveBeenCalledWith("transcribe_audio", {
          apiKey: "test-key",
          model: undefined,
          language: undefined,
        });
        expect(result).toEqual(mockTranscriptionResult);
      });

      it("calls invoke with all parameters", async () => {
        await transcribeAudio("test-key", "whisper-large-v3", "en");
        expect(mockInvoke).toHaveBeenCalledWith("transcribe_audio", {
          apiKey: "test-key",
          model: "whisper-large-v3",
          language: "en",
        });
      });

      it("returns transcription result", async () => {
        const result = await transcribeAudio("key");
        expect(result).toHaveProperty("text");
        expect(result).toHaveProperty("language");
        expect(result).toHaveProperty("duration");
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("No audio data"));
        await expect(transcribeAudio("key")).rejects.toThrow("No audio data");
      });
    });
  });

  // ===========================================================================
  // Output Commands
  // ===========================================================================
  describe("Output Commands", () => {
    describe("copyToClipboard", () => {
      it("calls invoke with text", async () => {
        await copyToClipboard("Hello world");
        expect(mockInvoke).toHaveBeenCalledWith("copy_to_clipboard", { text: "Hello world" });
      });

      it("handles empty string", async () => {
        await copyToClipboard("");
        expect(mockInvoke).toHaveBeenCalledWith("copy_to_clipboard", { text: "" });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Clipboard unavailable"));
        await expect(copyToClipboard("test")).rejects.toThrow("Clipboard unavailable");
      });
    });

    describe("typeText", () => {
      it("calls invoke with text", async () => {
        await typeText("Hello world");
        expect(mockInvoke).toHaveBeenCalledWith("type_text", { text: "Hello world" });
      });

      it("handles empty string", async () => {
        await typeText("");
        expect(mockInvoke).toHaveBeenCalledWith("type_text", { text: "" });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Typing failed"));
        await expect(typeText("test")).rejects.toThrow("Typing failed");
      });
    });
  });

  // ===========================================================================
  // Overlay Commands
  // ===========================================================================
  describe("Overlay Commands", () => {
    describe("showOverlay", () => {
      it("calls invoke with idle state", async () => {
        await showOverlay("idle");
        expect(mockInvoke).toHaveBeenCalledWith("show_overlay", { state: "idle" });
      });

      it("calls invoke with recording state", async () => {
        await showOverlay("recording");
        expect(mockInvoke).toHaveBeenCalledWith("show_overlay", { state: "recording" });
      });

      it("calls invoke with transcribing state", async () => {
        await showOverlay("transcribing");
        expect(mockInvoke).toHaveBeenCalledWith("show_overlay", { state: "transcribing" });
      });

      it("calls invoke with error state", async () => {
        await showOverlay({ error: "Something went wrong" });
        expect(mockInvoke).toHaveBeenCalledWith("show_overlay", {
          state: { error: "Something went wrong" },
        });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Overlay error"));
        await expect(showOverlay("idle")).rejects.toThrow("Overlay error");
      });
    });

    describe("hideOverlay", () => {
      it("calls invoke with correct command", async () => {
        await hideOverlay();
        expect(mockInvoke).toHaveBeenCalledWith("hide_overlay");
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Hide failed"));
        await expect(hideOverlay()).rejects.toThrow("Hide failed");
      });
    });

    describe("updateOverlayPosition", () => {
      it("calls invoke with position and margin", async () => {
        await updateOverlayPosition("bottom_right", 30);
        expect(mockInvoke).toHaveBeenCalledWith("update_overlay_position", {
          position: "bottom_right",
          margin: 30,
        });
      });

      it("handles all position values", async () => {
        const positions = [
          "bottom_left",
          "bottom_right",
          "top_left",
          "top_right",
          "center",
          "top_center",
          "bottom_center",
        ] as const;

        for (const pos of positions) {
          await updateOverlayPosition(pos, 10);
          expect(mockInvoke).toHaveBeenLastCalledWith("update_overlay_position", {
            position: pos,
            margin: 10,
          });
        }
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Invalid position"));
        await expect(updateOverlayPosition("bottom_right", 0)).rejects.toThrow("Invalid position");
      });
    });

    describe("getVisualizationThemes", () => {
      it("loads visualization themes from backend", async () => {
        const result = await getVisualizationThemes();
        expect(mockInvoke).toHaveBeenCalledWith("get_visualization_themes");
        expect(result).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "default", name: "Default" }),
            expect.objectContaining({ id: "living_reed", name: "Living Reed" }),
          ])
        );
      });
    });

    describe("previewVisualizationTheme", () => {
      it("calls invoke with theme id", async () => {
        await previewVisualizationTheme("living_reed");
        expect(mockInvoke).toHaveBeenCalledWith("preview_visualization_theme", {
          themeId: "living_reed",
          reloadFromDisk: false,
        });
      });

      it("can request reload from disk", async () => {
        await previewVisualizationTheme("living_reed", true);
        expect(mockInvoke).toHaveBeenCalledWith("preview_visualization_theme", {
          themeId: "living_reed",
          reloadFromDisk: true,
        });
      });
    });


  });

  // ===========================================================================
  // Debug Commands
  // ===========================================================================
  describe("Debug Commands", () => {
    const mockDebugEntries = [
      {
        timestamp: "2024-01-01T10:00:00",
        audio_file: "/tmp/audio.wav",
        audio_size_bytes: 1024,
        transcription: null,
        llm: null,
      },
    ];

    describe("getDebugEntries", () => {
      it("calls invoke without limit", async () => {
        mockInvoke.mockResolvedValueOnce(mockDebugEntries);
        const result = await getDebugEntries();
        expect(mockInvoke).toHaveBeenCalledWith("get_debug_entries", { limit: undefined });
        expect(result).toEqual(mockDebugEntries);
      });

      it("calls invoke with limit", async () => {
        mockInvoke.mockResolvedValueOnce([]);
        await getDebugEntries(5);
        expect(mockInvoke).toHaveBeenCalledWith("get_debug_entries", { limit: 5 });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Debug dir not found"));
        await expect(getDebugEntries()).rejects.toThrow("Debug dir not found");
      });
    });

    describe("clearDebug", () => {
      it("calls invoke with correct command", async () => {
        await clearDebug();
        expect(mockInvoke).toHaveBeenCalledWith("clear_debug");
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Clear failed"));
        await expect(clearDebug()).rejects.toThrow("Clear failed");
      });
    });

    describe("getDebugDir", () => {
      it("returns debug directory path", async () => {
        mockInvoke.mockResolvedValueOnce("/home/user/.config/soupawhisper/debug");
        const result = await getDebugDir();
        expect(mockInvoke).toHaveBeenCalledWith("get_debug_dir");
        expect(result).toBe("/home/user/.config/soupawhisper/debug");
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Path error"));
        await expect(getDebugDir()).rejects.toThrow("Path error");
      });
    });
  });

  // ===========================================================================
  // LLM Provider Commands
  // ===========================================================================
  describe("LLM Provider Commands", () => {
    describe("getLlmProviders", () => {
      it("calls invoke with correct command", async () => {
        const result = await getLlmProviders();
        expect(mockInvoke).toHaveBeenCalledWith("get_llm_providers");
        expect(result).toEqual(mockLlmProviders);
      });

      it("returns providers with all fields", async () => {
        const result = await getLlmProviders();
        expect(result[0]).toHaveProperty("id");
        expect(result[0]).toHaveProperty("name");
        expect(result[0]).toHaveProperty("api_url");
        expect(result[0]).toHaveProperty("models");
        expect(result[0]).toHaveProperty("default_model");
        expect(result[0]).toHaveProperty("builtin");
      });

      it("returns providers with models array", async () => {
        const result = await getLlmProviders();
        expect(Array.isArray(result[0].models)).toBe(true);
        expect(result[0].models[0]).toHaveProperty("id");
        expect(result[0].models[0]).toHaveProperty("name");
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Providers unavailable"));
        await expect(getLlmProviders()).rejects.toThrow("Providers unavailable");
      });
    });

    describe("addLlmProvider", () => {
      it("calls invoke with provider object", async () => {
        const provider = {
          id: "new-provider",
          name: "New Provider",
          api_url: "https://api.new.com/v1",
          models: [{ id: "model-1", name: "Model 1" }],
          default_model: "model-1",
        };
        await addLlmProvider(provider);
        expect(mockInvoke).toHaveBeenCalledWith("add_llm_provider", {
          provider: { ...provider, builtin: false },
        });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Duplicate ID"));
        await expect(
          addLlmProvider({
            id: "test",
            name: "Test",
            api_url: "",
            models: [],
            default_model: "",
          })
        ).rejects.toThrow("Duplicate ID");
      });
    });

    describe("removeLlmProvider", () => {
      it("calls invoke with id", async () => {
        await removeLlmProvider("custom-provider");
        expect(mockInvoke).toHaveBeenCalledWith("remove_llm_provider", { id: "custom-provider" });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Cannot remove builtin"));
        await expect(removeLlmProvider("openai")).rejects.toThrow("Cannot remove builtin");
      });
    });

    describe("updateLlmProvider", () => {
      it("calls invoke with provider object", async () => {
        const provider = {
          id: "custom-provider",
          name: "Updated Name",
          api_url: "https://api.updated.com/v1",
          models: [{ id: "model-2", name: "Model 2" }],
          default_model: "model-2",
          builtin: false,
        };
        await updateLlmProvider(provider);
        expect(mockInvoke).toHaveBeenCalledWith("update_llm_provider", { provider });
      });

      it("handles errors", async () => {
        mockInvoke.mockRejectedValueOnce(new Error("Provider not found"));
        await expect(
          updateLlmProvider({
            id: "nonexistent",
            name: "Test",
            api_url: "",
            models: [],
            default_model: "",
            builtin: false,
          })
        ).rejects.toThrow("Provider not found");
      });
    });
  });

  // ===========================================================================
  // Type Export Tests
  // ===========================================================================
  describe("Type Exports", () => {
    it("exports AppConfig type", () => {
      const config: AppConfig = mockConfig;
      expect(config.api_key).toBeDefined();
    });

    it("config has all nested types", () => {
      const config: AppConfig = mockConfig;
      expect(config.vad.enabled).toBeDefined();
      expect(config.overlay.position).toBeDefined();
      expect(config.llm.provider).toBeDefined();
      expect(config.dictionary.learning_mode).toBeDefined();
    });
  });
});
