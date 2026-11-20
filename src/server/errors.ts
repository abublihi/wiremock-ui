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

/** A message that starts with a field path ("lookup.expression must be …") names that field. */
const FIELD_LEAD = /^([a-z_$][\w$-]*(?:\.[\w$-]+|\[\d+\])*):? (?:must|is|are|may|takes|has|matches|should|needs|cannot|does)\b/

/**
 * A 400. `field` is the request field it is about, as a stable path (`lookup.expression`, `exampleResponses.200`),
 * so a client can show the message next to the right input; taken from the message's first word when not given.
 */
export class ValidationError extends AppError {
  public readonly field?: string
  constructor(message: string, field?: string) {
    super(message, 400)
    const named = field ?? FIELD_LEAD.exec(message)?.[1]
    if (named) this.field = named
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
