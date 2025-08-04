---
node_id: 5
title: Database Migrations
---

# Database Migrations

This document describes our database migration strategy using Alembic.

## Migration Structure
- All migrations stored in /migrations directory
- Each migration has unique revision ID
- Auto-generated from SQLAlchemy models

## Migration Commands
- `alembic revision --autogenerate -m "message"` - Create new migration
- `alembic upgrade head` - Apply pending migrations  
- `alembic downgrade -1` - Rollback last migration
- `alembic current` - Show current revision