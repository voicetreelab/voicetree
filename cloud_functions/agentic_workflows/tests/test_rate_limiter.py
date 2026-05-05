"""
Unit tests for rate_limiter module.

Tests all rate limiting logic including edge cases, transaction handling,
and error scenarios.
"""

import json
import pytest
from unittest.mock import Mock, MagicMock, patch, call
from datetime import datetime, timedelta

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Mock firestore before importing rate_limiter
sys.modules['google.cloud.firestore'] = MagicMock()
sys.modules['google.cloud'] = MagicMock()

from rate_limiter import (
    check_global_rate_limit,
    check_rate_limit,
    is_ratelimited,
    DAILY_RATE_LIMIT,
    GLOBAL_DAILY_RATE_LIMIT
)


class TestCheckGlobalRateLimit:
    """Tests for check_global_rate_limit function"""

    def test_first_request_ever(self):
        """Test the first request when no document exists"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        # Mock document that doesn't exist
        mock_doc = Mock()
        mock_doc.exists = False
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_global_rate_limit(mock_db)

        assert is_allowed is True
        assert count == 1
        mock_doc_ref.set.assert_called_once()

    def test_request_within_limit(self):
        """Test request when under the daily limit"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        # Mock existing document with count below limit
        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': 100,
            'last_reset': datetime.now()
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_global_rate_limit(mock_db)

        assert is_allowed is True
        assert count == 101
        mock_doc_ref.update.assert_called_once()

    def test_request_at_exact_limit(self):
        """Test request when exactly at the limit"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': GLOBAL_DAILY_RATE_LIMIT,
            'last_reset': datetime.now()
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_global_rate_limit(mock_db)

        # At limit = not allowed
        assert is_allowed is False
        assert count == GLOBAL_DAILY_RATE_LIMIT
        # Should not increment
        mock_doc_ref.update.assert_not_called()

    def test_request_over_limit(self):
        """Test request when over the daily limit"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': GLOBAL_DAILY_RATE_LIMIT + 100,
            'last_reset': datetime.now()
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_global_rate_limit(mock_db)

        assert is_allowed is False
        assert count == GLOBAL_DAILY_RATE_LIMIT + 100
        # Should not increment
        mock_doc_ref.update.assert_not_called()

    def test_reset_after_24_hours(self):
        """Test that counter resets after 24 hours"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        # Document with old timestamp (more than 24 hours ago)
        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': GLOBAL_DAILY_RATE_LIMIT + 100,
            'last_reset': datetime.now() - timedelta(days=2)
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_global_rate_limit(mock_db)

        # Should reset and allow request
        assert is_allowed is True
        assert count == 1
        mock_doc_ref.set.assert_called_once()

    def test_reset_boundary_exact_24_hours(self):
        """Test reset boundary at exactly 24 hours"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': 5000,
            'last_reset': datetime.now() - timedelta(days=1, seconds=1)
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_global_rate_limit(mock_db)

        assert is_allowed is True
        assert count == 1

    def test_no_reset_before_24_hours(self):
        """Test that counter doesn't reset before 24 hours"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': 500,
            'last_reset': datetime.now() - timedelta(hours=23)
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_global_rate_limit(mock_db)

        # Should increment, not reset
        assert count == 501
        mock_doc_ref.update.assert_called_once()

    def test_missing_last_reset_field(self):
        """Test handling of document with missing last_reset field"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': 100
            # last_reset is missing
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_global_rate_limit(mock_db)

        # Should still increment
        assert count == 101

    def test_exception_fails_open(self):
        """Test that exceptions cause the system to fail open (allow request)"""
        mock_db = Mock()
        mock_db.collection.side_effect = Exception("Database connection failed")

        is_allowed, count = check_global_rate_limit(mock_db)

        # Should fail open
        assert is_allowed is True
        assert count == 0

    def test_one_below_limit_allowed(self):
        """Test that request at limit - 1 is allowed"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': GLOBAL_DAILY_RATE_LIMIT - 1,
            'last_reset': datetime.now()
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_global_rate_limit(mock_db)

        assert is_allowed is True
        assert count == GLOBAL_DAILY_RATE_LIMIT


class TestCheckRateLimit:
    """Tests for check_rate_limit function"""

    def test_first_request_from_user(self):
        """Test the first request from a new user"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = False
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_rate_limit(mock_db, "user123")

        assert is_allowed is True
        assert count == 1
        mock_doc_ref.set.assert_called_once()

    def test_request_within_user_limit(self):
        """Test request when user is under their daily limit"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': 5,
            'last_reset': datetime.now()
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_rate_limit(mock_db, "user123")

        assert is_allowed is True
        assert count == 6

    def test_request_at_exact_user_limit(self):
        """Test request when user is exactly at their limit"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': DAILY_RATE_LIMIT,
            'last_reset': datetime.now()
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_rate_limit(mock_db, "user123")

        # At limit = not allowed
        assert is_allowed is False
        assert count == DAILY_RATE_LIMIT
        mock_doc_ref.update.assert_not_called()

    def test_request_over_user_limit(self):
        """Test request when user is over their daily limit"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': DAILY_RATE_LIMIT + 5,
            'last_reset': datetime.now()
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_rate_limit(mock_db, "user123")

        assert is_allowed is False
        assert count == DAILY_RATE_LIMIT + 5
        mock_doc_ref.update.assert_not_called()

    def test_user_reset_after_24_hours(self):
        """Test that user counter resets after 24 hours"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': DAILY_RATE_LIMIT + 5,
            'last_reset': datetime.now() - timedelta(days=2)
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_rate_limit(mock_db, "user123")

        # Should reset and allow request
        assert is_allowed is True
        assert count == 1

    def test_different_users_independent_limits(self):
        """Test that different users have independent rate limits"""
        mock_db = Mock()

        # Mock for first user
        mock_doc_ref1 = Mock()
        mock_doc1 = Mock()
        mock_doc1.exists = False
        mock_doc_ref1.get.return_value = mock_doc1

        # Mock for second user
        mock_doc_ref2 = Mock()
        mock_doc2 = Mock()
        mock_doc2.exists = False
        mock_doc_ref2.get.return_value = mock_doc2

        mock_collection = Mock()
        mock_db.collection.return_value = mock_collection

        # Return different refs for different users
        mock_collection.document.side_effect = [mock_doc_ref1, mock_doc_ref2]

        check_rate_limit(mock_db, "user123")
        check_rate_limit(mock_db, "user456")

        # Verify different user IDs were used
        calls = mock_collection.document.call_args_list
        assert len(calls) == 2
        assert calls[0][0][0] == "user123"
        assert calls[1][0][0] == "user456"

    def test_user_exception_fails_open(self):
        """Test that exceptions cause the system to fail open for user limits"""
        mock_db = Mock()
        mock_db.collection.side_effect = Exception("Database connection failed")

        is_allowed, count = check_rate_limit(mock_db, "user123")

        # Should fail open
        assert is_allowed is True
        assert count == 0

    def test_one_below_user_limit_allowed(self):
        """Test that request at user limit - 1 is allowed"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': DAILY_RATE_LIMIT - 1,
            'last_reset': datetime.now()
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_rate_limit(mock_db, "user123")

        assert is_allowed is True
        assert count == DAILY_RATE_LIMIT


class TestIsRatelimited:
    """Tests for is_ratelimited function"""

    def test_both_limits_ok(self):
        """Test when both global and user limits are OK"""
        mock_db = Mock()
        headers = {'Access-Control-Allow-Origin': '*'}

        with patch('rate_limiter.check_global_rate_limit') as mock_global, \
             patch('rate_limiter.check_rate_limit') as mock_user:
            mock_global.return_value = (True, 100)
            mock_user.return_value = (True, 5)

            result = is_ratelimited(mock_db, "user123", headers)

        assert result is None

    def test_global_limit_exceeded(self):
        """Test when global limit is exceeded"""
        mock_db = Mock()
        headers = {'Access-Control-Allow-Origin': '*'}

        with patch('rate_limiter.check_global_rate_limit') as mock_global, \
             patch('rate_limiter.check_rate_limit') as mock_user:
            mock_global.return_value = (False, GLOBAL_DAILY_RATE_LIMIT + 100)
            mock_user.return_value = (True, 5)

            result = is_ratelimited(mock_db, "user123", headers)

        assert result is not None
        response_body, status_code, response_headers = result
        assert status_code == 429
        assert response_headers == headers

        response_data = json.loads(response_body)
        assert response_data['error'] == "Global rate limit exceeded"
        assert response_data['limit'] == GLOBAL_DAILY_RATE_LIMIT
        assert response_data['current'] == GLOBAL_DAILY_RATE_LIMIT + 100

    def test_user_limit_exceeded(self):
        """Test when user limit is exceeded"""
        mock_db = Mock()
        headers = {'Access-Control-Allow-Origin': '*'}

        with patch('rate_limiter.check_global_rate_limit') as mock_global, \
             patch('rate_limiter.check_rate_limit') as mock_user:
            mock_global.return_value = (True, 100)
            mock_user.return_value = (False, DAILY_RATE_LIMIT + 3)

            result = is_ratelimited(mock_db, "user123", headers)

        assert result is not None
        response_body, status_code, response_headers = result
        assert status_code == 429
        assert response_headers == headers

        response_data = json.loads(response_body)
        assert response_data['error'] == "Rate limit exceeded"
        assert response_data['limit'] == DAILY_RATE_LIMIT
        assert response_data['current'] == DAILY_RATE_LIMIT + 3

    def test_global_checked_before_user(self):
        """Test that global limit is checked before user limit"""
        mock_db = Mock()
        headers = {'Access-Control-Allow-Origin': '*'}

        with patch('rate_limiter.check_global_rate_limit') as mock_global, \
             patch('rate_limiter.check_rate_limit') as mock_user:
            mock_global.return_value = (False, GLOBAL_DAILY_RATE_LIMIT + 1)
            mock_user.return_value = (True, 5)

            result = is_ratelimited(mock_db, "user123", headers)

        # Global limit was checked
        mock_global.assert_called_once_with(mock_db)
        # User limit should NOT be checked since global failed
        mock_user.assert_not_called()

        assert result is not None

    def test_both_limits_exceeded_returns_global_error(self):
        """Test that global error is returned when both limits are exceeded"""
        mock_db = Mock()
        headers = {'Access-Control-Allow-Origin': '*'}

        with patch('rate_limiter.check_global_rate_limit') as mock_global, \
             patch('rate_limiter.check_rate_limit') as mock_user:
            mock_global.return_value = (False, GLOBAL_DAILY_RATE_LIMIT + 1)
            mock_user.return_value = (False, DAILY_RATE_LIMIT + 1)

            result = is_ratelimited(mock_db, "user123", headers)

        response_body, _, _ = result
        response_data = json.loads(response_body)
        # Should return global error, not user error
        assert response_data['error'] == "Global rate limit exceeded"

    def test_headers_preserved_in_response(self):
        """Test that custom headers are preserved in rate limit response"""
        mock_db = Mock()
        custom_headers = {
            'Access-Control-Allow-Origin': '*',
            'X-Custom-Header': 'custom-value'
        }

        with patch('rate_limiter.check_global_rate_limit') as mock_global, \
             patch('rate_limiter.check_rate_limit') as mock_user:
            mock_global.return_value = (True, 100)
            mock_user.return_value = (False, DAILY_RATE_LIMIT + 1)

            result = is_ratelimited(mock_db, "user123", custom_headers)

        _, _, response_headers = result
        assert response_headers == custom_headers
        assert response_headers['X-Custom-Header'] == 'custom-value'


class TestEdgeCases:
    """Tests for edge cases and boundary conditions"""

    def test_zero_count_increments_correctly(self):
        """Test that a count of 0 increments to 1"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': 0,
            'last_reset': datetime.now()
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_rate_limit(mock_db, "user123")

        assert count == 1
        assert is_allowed is True

    def test_negative_count_handled(self):
        """Test handling of negative count (corrupted data)"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': -5,
            'last_reset': datetime.now()
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_rate_limit(mock_db, "user123")

        # Negative count is below limit, so should be allowed
        assert is_allowed is True
        assert count == -4

    def test_empty_user_uuid(self):
        """Test behavior with empty user UUID"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = False
        mock_doc_ref.get.return_value = mock_doc

        # Should still work, creates document with empty string key
        is_allowed, count = check_rate_limit(mock_db, "")

        assert is_allowed is True
        assert count == 1

    def test_very_long_user_uuid(self):
        """Test behavior with very long user UUID"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = False
        mock_doc_ref.get.return_value = mock_doc

        long_uuid = "x" * 1000

        is_allowed, count = check_rate_limit(mock_db, long_uuid)

        assert is_allowed is True
        assert count == 1

    def test_special_characters_in_user_uuid(self):
        """Test behavior with special characters in user UUID"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = False
        mock_doc_ref.get.return_value = mock_doc

        special_uuid = "user@#$%^&*()_+-=[]{}|;:',.<>?/~`"

        is_allowed, count = check_rate_limit(mock_db, special_uuid)

        assert is_allowed is True
        assert count == 1

    def test_missing_count_field_defaults_to_zero(self):
        """Test that missing count field defaults to 0"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'last_reset': datetime.now()
            # count is missing
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_rate_limit(mock_db, "user123")

        # Should default to 0 and increment to 1
        assert is_allowed is True
        assert count == 1

    def test_none_last_reset_no_crash(self):
        """Test that None last_reset doesn't crash"""
        mock_db = Mock()
        mock_doc_ref = Mock()
        mock_db.collection.return_value.document.return_value = mock_doc_ref

        mock_doc = Mock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {
            'count': 5,
            'last_reset': None
        }
        mock_doc_ref.get.return_value = mock_doc

        is_allowed, count = check_rate_limit(mock_db, "user123")

        # Should still work (won't reset since last_reset is None)
        assert count == 6
