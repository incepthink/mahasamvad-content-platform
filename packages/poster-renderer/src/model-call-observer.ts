// A slot through which @dgipr/content-engine's job tracing observes this package's model calls
// (gpt-image generate/edit). This package cannot import content-engine (content-engine depends
// on it), so the tracer registers itself here at API boot instead.
//
// The contract an observer must keep: call `run` exactly once, return its result unchanged and
// rethrow its error unchanged. With no observer registered the call is exactly `run()`.

export type ModelCallInfo = Readonly<{
  name: string;
  provider: string;
  model: string;
  input: Readonly<Record<string, unknown>>;
}>;

export type ModelCallObserver = <T>(
  info: ModelCallInfo,
  run: () => Promise<T>,
  describe: (result: T) => unknown,
) => Promise<T>;

let observer: ModelCallObserver | null = null;

export function setModelCallObserver(next: ModelCallObserver | null): void {
  observer = next;
}

export function observeModelCall<T>(
  info: ModelCallInfo,
  run: () => Promise<T>,
  describe: (result: T) => unknown,
): Promise<T> {
  return observer ? observer(info, run, describe) : run();
}
