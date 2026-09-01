from dataclasses import dataclass


@dataclass(slots=True)
class SecureApiError(Exception):
    code: str
    status_code: int
    message: str


AUTH_REQUIRED = SecureApiError("AUTH_REQUIRED", 401, "Sign in to continue.")
FORBIDDEN = SecureApiError("FORBIDDEN", 403, "You are not allowed to perform this action.")
INPUT_TOO_LARGE = SecureApiError("INPUT_TOO_LARGE", 413, "The submitted source is too large.")
OUTPUT_TOO_LARGE = SecureApiError("OUTPUT_TOO_LARGE", 413, "The encoded result would be too large.")
INVALID_INPUT = SecureApiError("INVALID_INPUT", 422, "The request format is not valid.")
SERVICE_UNAVAILABLE = SecureApiError("SERVICE_UNAVAILABLE", 503, "The secure encoder service is temporarily unavailable.")
REPLAY_REJECTED = SecureApiError("REPLAY_REJECTED", 409, "This request was already processed. Create a new request and try again.")
RATE_LIMITED = SecureApiError("RATE_LIMITED", 429, "Too many requests. Please wait and try again.")
ACCOUNT_REVIEW = SecureApiError("ACCOUNT_REVIEW", 403, "Your account requires review before using this feature.")
INSUFFICIENT_TOKENS = SecureApiError("INSUFFICIENT_TOKENS", 402, "You do not have enough tokens for this request.")
CHALLENGE_REQUIRED = SecureApiError("CHALLENGE_REQUIRED", 403, "Additional verification is required before using this feature.")
