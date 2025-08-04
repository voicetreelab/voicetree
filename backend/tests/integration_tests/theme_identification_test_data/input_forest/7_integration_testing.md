---
node_id: 7
title: Integration Testing Strategy
---

# Integration Testing Strategy

This document describes our approach to integration testing across system components.

## Test Scope
- API endpoint testing with real database
- Service layer integration
- External service mocking
- Database transaction rollback

## Test Environment
- Separate test database instance
- Docker containers for isolated testing
- Test data fixtures and factories
- Automated cleanup after tests