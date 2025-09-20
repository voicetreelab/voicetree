---
node_id: 6
title: Unit Testing Framework
---

# Unit Testing Framework

This document outlines our unit testing approach using pytest.

## Testing Structure
- Tests located in /tests directory
- One test file per module
- Test classes group related test methods
- Mock external dependencies

## Test Categories
- Unit tests for individual functions
- Integration tests for component interaction
- End-to-end tests for full workflows
- Performance tests for critical paths