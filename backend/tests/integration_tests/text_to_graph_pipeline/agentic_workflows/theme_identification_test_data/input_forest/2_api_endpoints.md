---
color: violet
node_id: 2
title: API Endpoints Design
---

# API Endpoints Design

This document outlines the REST API endpoints for our task management system.

## User Management
- POST /api/users - Create user
- GET /api/users/{id} - Get user details
- PUT /api/users/{id} - Update user

## Task Management  
- GET /api/tasks - List tasks
- POST /api/tasks - Create task
- PUT /api/tasks/{id} - Update task
- DELETE /api/tasks/{id} - Delete task