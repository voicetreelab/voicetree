---
node_id: 4
title: Database Schema Design
---

# Database Schema Design

This document outlines the PostgreSQL database schema for the task management system.

## Core Tables

### Users Table
- id (Primary Key)
- username (Unique)
- email (Unique) 
- password_hash
- created_at
- updated_at

### Tasks Table
- id (Primary Key)
- title
- description
- status (pending, in_progress, completed)
- user_id (Foreign Key to Users)
- created_at
- updated_at