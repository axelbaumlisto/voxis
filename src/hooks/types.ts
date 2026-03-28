/**
 * Standard async state for data fetching hooks.
 */
export interface AsyncState<T> {
  data: T;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Extended async state with setters for manual updates.
 */
export interface AsyncStateWithSetters<T> extends AsyncState<T> {
  setData: React.Dispatch<React.SetStateAction<T>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

/**
 * Standard interface for CRUD operations on collections.
 *
 * @template T - The entity type
 * @template IdType - Type of the entity's ID (typically number or string)
 * @template CreateInput - Type for create operation input
 * @template UpdateInput - Type for update operation input (often Partial<T>)
 */
export interface CrudOperations<T, IdType, CreateInput, UpdateInput> {
  /** Create a new entity */
  create?: (input: CreateInput) => Promise<void>;
  /** Update an existing entity by ID */
  update?: (id: IdType, input: UpdateInput) => Promise<void>;
  /** Remove an entity by ID */
  remove: (id: IdType) => Promise<void>;
  /** Get an entity by ID from local state (no network call) */
  getById: (id: IdType) => T | undefined;
}

/**
 * Complete CRUD hook result combining async state and operations.
 *
 * @example
 * interface UseDictionaryResult extends CrudHookResult<
 *   DictionaryEntry,
 *   number,
 *   { source: string; replacement: string },
 *   { source?: string; replacement?: string }
 * > {}
 */
export interface CrudHookResult<T, IdType, CreateInput, UpdateInput>
  extends AsyncState<T[]>,
    CrudOperations<T, IdType, CreateInput, UpdateInput> {
  /** The items collection (alias for data for clarity) */
  items?: T[];
}

/**
 * Helper type for hooks that use numeric IDs.
 */
export type NumericCrudHookResult<T, CreateInput, UpdateInput> = CrudHookResult<
  T,
  number,
  CreateInput,
  UpdateInput
>;

/**
 * Helper type for hooks that use string IDs.
 */
export type StringCrudHookResult<T, CreateInput, UpdateInput> = CrudHookResult<
  T,
  string,
  CreateInput,
  UpdateInput
>;
