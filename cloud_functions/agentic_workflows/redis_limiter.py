"""
Rate limiting functionality using Upstash Redis.

Provides per-user and global rate limiting using Redis with sliding window algorithm.
"""

import json
import logging
import os
from pathlib import Path
from dotenv import load_dotenv
from upstash_ratelimit import Ratelimit, SlidingWindow
from upstash_redis import Redis

# Load .env from current directory (agentic_workflows)
env_path = Path(__file__).parent / ".env"
load_dotenv(env_path)

logger = logging.getLogger(__name__)

# Rate limit configuration (requests per day)
DAILY_RATE_LIMIT = 3000
GLOBAL_DAILY_RATE_LIMIT = 1000000

# Initialize Redis client (singleton)
_redis_client = None


def get_redis_client() -> Redis:
    """Get or create Redis client singleton."""
    global _redis_client
    if _redis_client is None:
        url = os.environ.get("UPSTASH_REDIS_REST_URL")
        token = os.environ.get("UPSTASH_REDIS_REST_TOKEN")

        if not url or not token:
            raise ValueError(
                "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in environment or .env file"
            )

        # Remove quotes if present (from .env file)
        url = url.strip('"').strip("'")
        token = token.strip('"').strip("'")

        _redis_client = Redis(url=url, token=token)
    return _redis_client


# Initialize rate limiters (singletons)
_user_limiter = None
_global_limiter = None


def get_user_limiter() -> Ratelimit:
    """Get or create per-user rate limiter singleton."""
    global _user_limiter
    if _user_limiter is None:
        redis = get_redis_client()
        # 10 requests per day per user
        _user_limiter = Ratelimit(
            redis=redis,
            limiter=SlidingWindow(max_requests=DAILY_RATE_LIMIT, window=86400),  # 86400s = 1 day
            prefix="user_ratelimit"
        )
    return _user_limiter


def get_global_limiter() -> Ratelimit:
    """Get or create global rate limiter singleton."""
    global _global_limiter
    if _global_limiter is None:
        redis = get_redis_client()
        # 1M requests per day across all cloud functions
        _global_limiter = Ratelimit(
            redis=redis,
            limiter=SlidingWindow(max_requests=GLOBAL_DAILY_RATE_LIMIT, window=86400),
            prefix="global_ratelimit"
        )
    return _global_limiter


def is_ratelimited(request_json: dict, headers: dict):
    """
    Check both global and per-user rate limits.

    Args:
        request_json: Request JSON containing user_uuid
        headers: HTTP response headers

    Returns:
        tuple | None: Returns HTTP response tuple if rate limited, None if allowed
    """
    # Extract and validate user_uuid
    user_uuid = request_json.get("user_uuid")
    if not user_uuid:
        logger.error("Missing user_uuid")
        return (json.dumps({"error": "Missing required parameter: user_uuid"}), 400, headers)

    try:
        # Check global rate limit first (use constant key for all functions)
        global_limiter = get_global_limiter()
        global_response = global_limiter.limit("all_functions")

        if not global_response.allowed:
            logger.warning(
                f"Global rate limit exceeded: {global_response.remaining}/{GLOBAL_DAILY_RATE_LIMIT}"
            )
            return (
                json.dumps({
                    "error": "Global rate limit exceeded",
                    "limit": GLOBAL_DAILY_RATE_LIMIT,
                    "remaining": global_response.remaining,
                    "reset": global_response.reset
                }),
                429,
                headers
            )

        # Check per-user rate limit
        user_limiter = get_user_limiter()
        user_response = user_limiter.limit(user_uuid)

        if not user_response.allowed:
            logger.warning(
                f"Rate limit exceeded for user {user_uuid}: {user_response.remaining}/{DAILY_RATE_LIMIT}"
            )
            return (
                json.dumps({
                    "error": "Rate limit exceeded",
                    "limit": DAILY_RATE_LIMIT,
                    "remaining": user_response.remaining,
                    "reset": user_response.reset
                }),
                429,
                headers
            )

        # Both checks passed
        return None

    except Exception as e:
        logger.error(f"Rate limit check failed: {str(e)}")
        # Fail closed - deny request if rate limiting fails
        return (
            json.dumps({
                "error": "Rate limit service unavailable",
                "details": str(e)
            }),
            503,
            headers
        )
