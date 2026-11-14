export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code = "error",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function notFound(message = "not found"): never {
  throw new AppError(404, message, "not_found");
}

export function invalid(message: string): never {
  throw new AppError(400, message, "invalid_request");
}

export function forbidden(message = "forbidden"): never {
  throw new AppError(403, message, "forbidden");
}

export function conflict(message: string): never {
  throw new AppError(409, message, "conflict");
}
