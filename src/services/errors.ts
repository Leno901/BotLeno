export class AppError extends Error {
  readonly code: string;
  readonly kind: "warning" | "error";

  constructor(
    message: string,
    code: string,
    kind: "warning" | "error" = "warning",
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.kind = kind;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
