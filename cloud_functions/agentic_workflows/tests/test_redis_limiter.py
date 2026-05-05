"""
Integration tests for redis_limiter module.

Tests Redis connection and basic read/write operations.
"""

import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from redis_limiter import get_redis_client


class TestRedisConnection:
    """Tests for Redis connection and basic operations"""

    def test_redis_connection_and_write(self):
        """Test that we can connect to Redis and write a value"""
        redis = get_redis_client()

        # Write a test value
        test_key = "test_key"
        test_value = "test_value"

        result = redis.set(test_key, test_value)
        assert result is not None

    def test_redis_connection_and_read(self):
        """Test that we can connect to Redis and read a value"""
        redis = get_redis_client()

        # Write a test value
        test_key = "test_read_key"
        test_value = "test_read_value"

        redis.set(test_key, test_value)

        # Read it back
        retrieved_value = redis.get(test_key)
        assert retrieved_value == test_value

    def test_redis_read_write_cycle(self):
        """Test complete read/write cycle with verification"""
        redis = get_redis_client()

        # Test data
        test_key = "test_cycle_key"
        test_value = "test_cycle_value_12345"

        # Write
        redis.set(test_key, test_value)

        # Read back
        retrieved_value = redis.get(test_key)

        # Verify
        assert retrieved_value == test_value, f"Expected '{test_value}', got '{retrieved_value}'"

        # Clean up
        redis.delete(test_key)

        # Verify deletion
        deleted_value = redis.get(test_key)
        assert deleted_value is None, "Key should be deleted"
