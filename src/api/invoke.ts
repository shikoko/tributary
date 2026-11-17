// Calling the backend: Tauri's invoke, checked against the command list (each command's
// arguments and result, `Commands` in generated.ts), with a failure as an AppError.
import { invoke as tauriInvoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";
import type { Commands, ErrorKind, Failure } from "./generated";
export type { Commands, ErrorKind, Failure };

/** A command's name. */
export type Command = keyof Commands;
/** What `command` takes, as the frontend sends it. */
export type ArgsOf<C extends Command> = Commands[C]["args"];
/** What `command` gives back. */
export type ResultOf<C extends Command> = Commands[C]["returns"];
/** The arguments to pass: none at all for a command that takes none, or only optional ones. */
type Call<C extends Command> = [ArgsOf<C>] extends [Record<string, never>]
  ? [args?: ArgsOf<C>, options?: InvokeOptions]
  : Partial<ArgsOf<C>> extends ArgsOf<C>
    ? [args?: ArgsOf<C>, options?: InvokeOptions]
    : [args: ArgsOf<C>, options?: InvokeOptions];

/**
 * A command that failed: its message, worded for the person using the app, and the kind of
 * failure it is when the app knows, to explain it and offer the fix. It reads as its
 * message, so `String(error)` and `${error}` show just that.
 */
export class AppError extends Error {
  readonly kind: ErrorKind | null;

  constructor(message: string, kind: ErrorKind | null = null) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
  }

  override toString(): string {
    return this.message;
  }
}

function isFailure(value: unknown): value is Failure {
  return typeof value === "object" && value !== null && typeof (value as Failure).message === "string";
}

/** What a command (or anything else) failed with, as an AppError. */
export function asAppError(reason: unknown): AppError {
  if (reason instanceof AppError) return reason;
  if (isFailure(reason)) return new AppError(reason.message, reason.kind ?? null);
  if (reason instanceof Error) return new AppError(reason.message);
  return new AppError(String(reason));
}

/** The kind of failure `error` is, when it came from a command and the app knows it. */
export function errorKind(error: unknown): ErrorKind | null {
  return error instanceof AppError ? error.kind : null;
}

/** Run a backend command; a failure rejects with an AppError. */
export async function invoke<C extends Command>(command: C, ...[args, options]: Call<C>): Promise<ResultOf<C>> {
  try {
    return await tauriInvoke<ResultOf<C>>(command, args as InvokeArgs | undefined, options);
  } catch (reason) {
    throw asAppError(reason);
  }
}
