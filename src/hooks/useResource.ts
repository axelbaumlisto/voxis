import { useAsyncData, type AsyncDataOptions } from "./useAsyncData";

export interface UseResourceResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export interface UseResourceControls<T> extends UseResourceResult<T> {
  setData: React.Dispatch<React.SetStateAction<T | null>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useResource<T>(
  fetchFn: () => Promise<T>,
  options: AsyncDataOptions = {}
): UseResourceControls<T> {
  const { data, loading, error, reload, setData, setError } = useAsyncData<T | null>(
    fetchFn,
    null,
    options
  );

  return { data, loading, error, reload, setData, setError };
}
