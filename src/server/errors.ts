export class AppError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class ConfigError extends AppError {
  constructor(message: string) {
    super(message, 500)
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400)
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'not found') {
    super(message, 404)
  }
}

export class ConflictError extends AppError {
  constructor(message = 'changed by someone else') {
    super(message, 409)
  }
}

export class UpstreamError extends AppError {
  constructor(message: string) {
    super(message, 502)
  }
}
