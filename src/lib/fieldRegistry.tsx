import React from "react";
import SelectField from "../components/settings/SelectField";
import SwitchField from "../components/settings/SwitchField";
import InputField from "../components/settings/InputField";
import PasswordField from "../components/settings/PasswordField";
import { SettingOption } from "./settingsRegistry";

/**
 * Common props passed to all field components.
 */
export interface FieldProps {
  label: string;
  description?: string;
  value: unknown;
  onChange: (value: unknown) => void;
  options?: SettingOption[];
  placeholder?: string;
}

/**
 * Field component type for the registry.
 */
type FieldComponent = React.ComponentType<FieldProps>;

/**
 * Registry mapping widget types to their field components.
 * This allows adding new field types without modifying SettingsPage (OCP).
 */
const fieldRegistry: Record<string, FieldComponent> = {};

/**
 * Register a field component for a widget type.
 */
export function registerField(type: string, component: FieldComponent): void {
  fieldRegistry[type] = component;
}

/**
 * Check if a field type is registered.
 */
export function hasField(type: string): boolean {
  return type in fieldRegistry;
}

/**
 * Render a field by its widget type.
 * Returns null if the type is not registered.
 */
export function renderField(
  widgetType: string,
  props: FieldProps
): React.ReactNode {
  const Component = fieldRegistry[widgetType];
  if (!Component) {
    return null;
  }
  return <Component {...props} />;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Convert a string value to a typed value (number or string).
 * DRY: Single source of truth for type conversion across all field adapters.
 * Returns number only for pure digit strings (e.g., "123"), otherwise returns string.
 */
function convertToTypedValue(value: string): string | number {
  const trimmed = value.trim();
  if (trimmed === "") {
    return value;
  }
  // Support negative numbers and positive integers
  // Avoid converting "3.14" or "1e5" to preserve string semantics
  if (/^-?\d+$/.test(trimmed)) {
    return Number(value);
  }
  return value;
}

// =============================================================================
// Field Adapter Factory - DRY pattern to eliminate duplication
// =============================================================================

/**
 * Configuration for creating a field adapter.
 */
interface AdapterConfig {
  /** The base component to render */
  component: React.ComponentType<Record<string, unknown>>;
  /** Map the value prop to the component's expected format */
  valueKey: string;
  /** Transform the value before passing to component */
  mapValue: (v: unknown) => unknown;
  /** Transform the onChange value before calling props.onChange */
  mapOnChange?: (v: unknown) => unknown;
  /** Whether to pass options prop */
  hasOptions?: boolean;
  /** Whether to pass placeholder prop */
  hasPlaceholder?: boolean;
}

/**
 * Factory function to create field adapters.
 * DRY: Eliminates 75% code duplication across adapters.
 */
function createFieldAdapter(config: AdapterConfig): FieldComponent {
  const {
    component: Component,
    valueKey,
    mapValue,
    mapOnChange = (v: unknown) => v,
    hasOptions = false,
    hasPlaceholder = false,
  } = config;

  return function FieldAdapter(props: FieldProps) {
    const baseProps: Record<string, unknown> = {
      label: props.label,
      description: props.description,
      [valueKey]: mapValue(props.value),
      onChange: (v: unknown) => props.onChange(mapOnChange(v)),
    };

    if (hasOptions) {
      baseProps.options = props.options ?? [];
    }
    if (hasPlaceholder) {
      baseProps.placeholder = props.placeholder;
    }

    return <Component {...baseProps} />;
  };
}

// =============================================================================
// Field Adapter Configurations
// =============================================================================

const SelectFieldAdapter = createFieldAdapter({
  component: SelectField as unknown as React.ComponentType<Record<string, unknown>>,
  valueKey: "value",
  mapValue: (v) => String(v ?? ""),
  mapOnChange: (v) => convertToTypedValue(v as string),
  hasOptions: true,
});

const SwitchFieldAdapter = createFieldAdapter({
  component: SwitchField as unknown as React.ComponentType<Record<string, unknown>>,
  valueKey: "checked",
  mapValue: Boolean,
});

const InputFieldAdapter = createFieldAdapter({
  component: InputField as unknown as React.ComponentType<Record<string, unknown>>,
  valueKey: "value",
  mapValue: (v) => String(v ?? ""),
  mapOnChange: (v) => convertToTypedValue(v as string),
  hasPlaceholder: true,
});

const PasswordFieldAdapter = createFieldAdapter({
  component: PasswordField as unknown as React.ComponentType<Record<string, unknown>>,
  valueKey: "value",
  mapValue: (v) => String(v ?? ""),
  hasPlaceholder: true,
});

// =============================================================================
// Register Built-in Fields
// =============================================================================

registerField("select", SelectFieldAdapter);
registerField("switch", SwitchFieldAdapter);
registerField("input", InputFieldAdapter);
registerField("password", PasswordFieldAdapter);
registerField("hotkey", SelectFieldAdapter); // Hotkey uses select for now
