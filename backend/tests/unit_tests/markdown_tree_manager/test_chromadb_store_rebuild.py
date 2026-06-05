"""
Behavioural tests for open_persistent_client_or_rebuild.

The persisted ChromaDB store is a derived cache (embeddings are regenerated from the
markdown nodes). A store that cannot be opened — e.g. one written by a newer ChromaDB,
which makes ChromaDB's Rust layer raise a pyo3 PanicException (a BaseException) — must
not crash the backend: it should be discarded and rebuilt. These tests exercise that
through the real ChromaDB client (black box: open a store, observe the result).
"""

from pathlib import Path

import chromadb
import pytest
from chromadb.api.shared_system_client import SharedSystemClient
from chromadb.config import Settings

from backend.markdown_tree_manager.embeddings.chromadb_vector_store import (
    open_persistent_client_or_rebuild,
)


def _settings() -> Settings:
    return Settings(anonymized_telemetry=False, allow_reset=True, is_persistent=True)


@pytest.fixture(autouse=True)
def _isolate_chroma_system_cache():
    # ChromaDB caches systems by path process-wide; clear it around each test so opens
    # actually read from disk (mirroring a fresh backend process) and nothing leaks out.
    SharedSystemClient.clear_system_cache()
    yield
    SharedSystemClient.clear_system_cache()


def test_unreadable_store_is_rebuilt_instead_of_raising(tmp_path):
    store = str(tmp_path / "chromadb_data")
    # Arrange: a valid store holding data...
    seeded = chromadb.PersistentClient(path=store, settings=_settings())
    seeded.create_collection("voicetree_nodes").add(ids=["1"], documents=["hello"])

    # ...then make it unreadable (stand-in for a forward-versioned / corrupt store) and
    # drop the cached client so the next open hits the broken file on disk.
    SharedSystemClient.clear_system_cache()
    (Path(store) / "chroma.sqlite3").write_bytes(b"this is not a sqlite database")

    # Act: must not raise.
    rebuilt = open_persistent_client_or_rebuild(store, _settings())

    # Assert: the store was discarded and rebuilt fresh, and is usable again.
    assert rebuilt.list_collections() == []
    rebuilt.create_collection("voicetree_nodes").add(ids=["1"], documents=["world"])
    assert rebuilt.get_collection("voicetree_nodes").count() == 1


def test_valid_store_is_opened_in_place_not_wiped(tmp_path):
    store = str(tmp_path / "chromadb_data")
    seeded = chromadb.PersistentClient(path=store, settings=_settings())
    seeded.create_collection("voicetree_nodes").add(ids=["1"], documents=["keep me"])
    SharedSystemClient.clear_system_cache()

    reopened = open_persistent_client_or_rebuild(store, _settings())

    # A readable store must be preserved, not rebuilt — the seeded data survives.
    assert [c.name for c in reopened.list_collections()] == ["voicetree_nodes"]
    assert reopened.get_collection("voicetree_nodes").count() == 1
