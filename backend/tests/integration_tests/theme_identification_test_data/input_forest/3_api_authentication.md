---
color: lime
node_id: 3
title: API Authentication
---

# API Authentication

This document describes the authentication mechanism for our REST API.

## JWT Token Authentication
- All API endpoints require valid JWT tokens
- Tokens expire after 24 hours
- Refresh tokens available for seamless user experience

## Authentication Flow
1. User provides credentials to /api/auth/login
2. Server validates and returns JWT token
3. Client includes token in Authorization header
4. Server validates token on each request